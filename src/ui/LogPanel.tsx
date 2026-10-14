import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { RULES } from '../game/data';
import type { GameView, ViewEntry } from '../game/view';
import { send, setChatOpen, toast, useApp } from '../client/store';
import { entryIcon, entryTone, seatName } from './common';

const QUICK = ['你是什么动物？', '你今晚去哪？', '你觉得谁是捕食者？', '我是…'];

function entryTitle(view: GameView, l: ViewEntry): string {
  if (l.kind === 'private') return `${seatName(view, l.from)} → ${seatName(view, l.to)}`;
  if (l.kind === 'public') return `${seatName(view, l.from)} · 公开`;
  if (l.kind === 'clue') return '局部线索';
  return '荒野记录';
}

export function LogPanel({ view }: { view: GameView }) {
  const { unreadChat, connected } = useApp();
  const [tab, setTab] = useState<'clue' | 'chat'>('clue');
  const [draft, setDraft] = useState('');
  const [recipient, setRecipient] = useState('all');
  const feed = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const me = view.me!;
  const isChat = (l: ViewEntry) => l.kind === 'public' || l.kind === 'private';
  const logs = view.log.filter(l => (tab === 'chat' ? isChat(l) : !isChat(l)));
  const living = view.players.filter(q => q.id !== me.id && q.alive);

  useEffect(() => {
    setChatOpen(tab === 'chat');
    return () => setChatOpen(false);
  }, [tab]);

  useEffect(() => {
    const focus = () => {
      setTab('chat');
      panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('focus-chat', focus);
    return () => window.removeEventListener('focus-chat', focus);
  }, []);

  // Stay pinned to the newest line unless the reader scrolled up on purpose.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = feed.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [logs.length, tab]);

  useEffect(() => {
    if (recipient !== 'all' && !living.some(q => q.id === recipient)) setRecipient('all');
  }, [living.length]);

  const submit = () => {
    const message = draft.trim();
    if (!message) return;
    if ([...message].length > RULES.messageLength) return toast(`消息最多 ${RULES.messageLength} 个字。`);
    // Keep the draft when the quota is already spent, instead of losing it to a server error.
    if (recipient === 'all' && me.publicCount >= RULES.publicMessages) return toast('本回合公开消息额度已用完，可以改发私信。');
    if (recipient !== 'all' && me.privateCount >= RULES.privateMessages) return toast(`本回合 ${RULES.privateMessages} 条私信已用完。`);
    send({ type: 'message', target: recipient, text: message });
    setDraft('');
    setTab('chat');
    pinned.current = true;
  };

  const quota =
    recipient === 'all'
      ? `公开 ${RULES.publicMessages - me.publicCount}/${RULES.publicMessages}`
      : `私信 ${RULES.privateMessages - me.privateCount}/${RULES.privateMessages}`;

  return (
    <aside class="panel message-panel" ref={panel}>
      <div class="message-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'clue'} class={tab === 'clue' ? 'active' : ''} onClick={() => setTab('clue')}>
          观察记录
        </button>
        <button role="tab" aria-selected={tab === 'chat'} class={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          消息往来{unreadChat > 0 && tab !== 'chat' && <span class="badge">{unreadChat}</span>}
        </button>
      </div>
      <div
        class="log-feed"
        ref={feed}
        role="log"
        aria-live="polite"
        onScroll={e => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {logs.length ? (
          logs.map(l => (
            <article key={l.id} class={`log-entry ${l.kind} ${entryTone(l)} ${l.from === me.id ? 'mine' : ''}`}>
              <div>
                <span>
                  <i aria-hidden="true">{entryIcon(l)}</i> {entryTitle(view, l)}
                </span>
                <small>R{l.round}</small>
              </div>
              <p>{l.text}</p>
            </article>
          ))
        ) : (
          <div class="empty-log">
            <span>⌁</span>
            <p>
              荒野暂时安静。
              <br />
              每一次行动都会留下信息。
            </p>
          </div>
        )}
      </div>
      <form
        class="message-compose"
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <div class="compose-meta">
          <label for="recipient">发送给</label>
          <select id="recipient" value={recipient} onChange={e => setRecipient((e.target as HTMLSelectElement).value)}>
            <option value="all">所有人 · 公开</option>
            {living.map(q => (
              <option key={q.id} value={q.id}>
                {q.seat}号 {q.name} · 私信
              </option>
            ))}
          </select>
        </div>
        <div class="quick">
          {QUICK.map(q => (
            <button
              type="button"
              key={q}
              disabled={!me.alive}
              onClick={() => {
                setDraft(q === '我是…' ? '我是' : q);
                text.current?.focus();
              }}
            >
              {q}
            </button>
          ))}
        </div>
        <textarea
          id="message-text"
          ref={text}
          rows={2}
          placeholder={me.alive ? '一句真话，或一个试探…（Enter 发送）' : '观战中无法发言'}
          aria-label="消息内容"
          disabled={!me.alive}
          value={draft}
          onInput={e => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div class="compose-footer">
          <small>
            {quota} · {[...draft.trim()].length}/{RULES.messageLength}
          </small>
          <button class="send-button" disabled={!me.alive || !connected || !draft.trim()}>
            发送 ↗
          </button>
        </div>
      </form>
      <div class="privacy-note">书面消息留存于本局。赤狐可能窃听私信。</div>
    </aside>
  );
}
