/**
 * Peer-to-peer voice for online rooms. Only SDP/ICE signalling passes through
 * the server; audio is never recorded.
 */
import type { GameView } from '../game/view';

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export class Voice {
  private mic: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private audio = new Map<string, HTMLAudioElement>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private view: GameView | null = null;
  private me = '';

  constructor(
    private sendSignal: (to: string, signal: Signal) => void,
    private notify: (message: string) => void,
  ) {}

  async startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持麦克风，请使用最新版浏览器并通过 HTTPS 打开。');
    if (this.mic) return;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch {
      throw new Error('无法使用麦克风。请允许麦克风权限，或继续使用书面消息。');
    }
  }

  private partners(): string[] {
    const g = this.view;
    if (!g?.me?.alive) return [];
    if (g.phase === 'drop' && g.me.voice) return g.players.filter(p => p.voice && p.alive && p.id !== this.me).map(p => p.id);
    const c = g.call;
    if (g.phase === 'call' && c?.accepted && (c.from === this.me || c.to === this.me)) return [c.from === this.me ? c.to : c.from];
    return [];
  }

  private closePeer(id: string) {
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.audio.get(id)?.remove();
    this.audio.delete(id);
    this.pendingIce.delete(id);
  }

  stop() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.mic?.getTracks().forEach(t => t.stop());
    this.mic = null;
  }

  private newPeer(id: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.peers.set(id, pc);
    this.mic?.getTracks().forEach(t => pc.addTrack(t, this.mic!));
    pc.onicecandidate = e => {
      if (e.candidate) this.sendSignal(id, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = e => {
      let el = this.audio.get(id);
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        document.body.append(el);
        this.audio.set(id, el);
      }
      el.srcObject = e.streams[0];
      void el.play().catch(() => this.notify('请点击页面允许播放语音。'));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.notify('语音未能穿透当前网络，请使用书面消息。');
    };
    return pc;
  }

  /** Opens and closes peer connections to match who is in the channel now. */
  async sync(view: GameView, me: string) {
    this.view = view;
    this.me = me;
    const partners = this.partners();
    for (const id of [...this.peers.keys()]) if (!partners.includes(id)) this.closePeer(id);
    if (!partners.length) {
      if (!(view.phase === 'drop' && view.me?.voice)) this.stop();
      return;
    }
    try {
      await this.startMicrophone();
    } catch (e) {
      this.notify((e as Error).message);
      return;
    }
    for (const id of partners) {
      // The lower id makes the offer so the two sides never collide.
      if (this.peers.has(id) || me > id) continue;
      const pc = this.newPeer(id);
      try {
        await pc.setLocalDescription(await pc.createOffer());
        this.sendSignal(id, { description: pc.localDescription! });
      } catch {
        this.closePeer(id);
      }
    }
  }

  async receive(from: string, data: unknown) {
    if (!this.partners().includes(from) || !data || typeof data !== 'object') return;
    const signal = data as Signal;
    try {
      await this.startMicrophone();
      const pc = this.peers.get(from) || this.newPeer(from);
      if (signal.description) {
        await pc.setRemoteDescription(signal.description);
        for (const candidate of this.pendingIce.get(from) || []) await pc.addIceCandidate(candidate);
        this.pendingIce.delete(from);
        if (signal.description.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.sendSignal(from, { description: pc.localDescription! });
        }
      } else if (signal.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else this.pendingIce.set(from, [...(this.pendingIce.get(from) || []), signal.candidate]);
      }
    } catch {
      this.notify('语音连接暂未建立，可以继续使用书面消息。');
    }
  }
}
