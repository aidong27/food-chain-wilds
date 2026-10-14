import { useEffect, useState } from 'preact/hooks';
import { RULES, SPECIES, species, type SpeciesId } from '../game/data';
import type { Difficulty } from '../game/types';
import { savedSolo } from '../client/links';
import {
  createRoom,
  joinRoom,
  refreshServer,
  resumeSolo,
  savedDifficulty,
  savedName,
  send,
  startSolo,
  toast,
  urls,
  useApp,
} from '../client/store';
import { Avatar, pad } from './common';
import { showBestiary, showRules } from './dialogs';
import { WildsMap } from './WildsMap';

const DIFFICULTIES: { id: Difficulty; name: string; note: string }[] = [
  { id: 'easy', name: '入门', note: '捕食者较迟钝，适合第一次进入荒野' },
  { id: 'normal', name: '标准', note: '电脑会推理、撒谎、追踪猎物' },
  { id: 'hard', name: '老练', note: '捕食者更果断，几乎不浪费线索' },
];

export function Home() {
  const app = useApp();
  const [name, setName] = useState(savedName);
  const [animal, setAnimal] = useState<SpeciesId | ''>('');
  const [difficulty, setDifficulty] = useState<Difficulty>(savedDifficulty);
  const [invite] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [code, setCode] = useState(invite);
  const save = app.hasSave ? savedSolo() : null;
  const saveMe = save?.game.players.find(p => p.id === save.playerId);
  const onlineReady = app.server === 'ok';
  const player = () => name.trim() || '林间旅人';

  useEffect(() => {
    void refreshServer();
  }, []);

  const serverText = {
    checking: '正在检查联机服务器…',
    ok: '联机服务器在线',
    outdated: '联机服务器仍是旧版本，暂时无法联机（等待维护者更新后端）',
    offline: '暂时连不上联机服务器；单人练习不受影响',
  }[app.server];

  const solo = (
    <>
      <span class="field-label" id="difficulty-label">
        练习难度
      </span>
      <div class="segmented" role="radiogroup" aria-labelledby="difficulty-label">
        {DIFFICULTIES.map(d => (
          <button
            key={d.id}
            role="radio"
            aria-checked={difficulty === d.id}
            class={difficulty === d.id ? 'on' : ''}
            onClick={() => setDifficulty(d.id)}
          >
            {d.name}
          </button>
        ))}
      </div>
      <p class="hint">{DIFFICULTIES.find(d => d.id === difficulty)!.note}</p>

      <label class="field-label" for="practice-role">
        练习身份
      </label>
      <select id="practice-role" value={animal} onChange={e => setAnimal((e.target as HTMLSelectElement).value as SpeciesId | '')}>
        <option value="">随机身份 · 保持未知</option>
        {SPECIES.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.title}
          </option>
        ))}
      </select>

      <button
        class={`${invite ? 'secondary' : 'primary'} large solo-start`}
        onClick={() => startSolo({ name: player(), animal, difficulty })}
      >
        开始单人练习 <span>↗</span>
      </button>
      <p class="under-button">与 7 位电脑玩家对局 · 无需联网 · 随时暂停</p>
      {save && saveMe && save.game.phase !== 'finished' && (
        <button class="secondary large resume" onClick={resumeSolo}>
          继续上次练习
          <small>
            第 {save.game.round} 回合 · {species(saveMe.animal).name}
            {saveMe.alive ? '' : '（观战）'}
          </small>
        </button>
      )}
    </>
  );

  const online = (
    <>
      <p class={`server-status ${app.server}`}>
        <i />
        {serverText}
        {app.server === 'offline' && (
          <button class="link-button" onClick={() => void refreshServer()}>
            重试
          </button>
        )}
      </p>
      <form
        class="join-form"
        onSubmit={e => {
          e.preventDefault();
          if (!onlineReady) return toast(serverText);
          void joinRoom(code, player());
        }}
      >
        <input
          id="room-input"
          aria-label="六位房间码"
          maxLength={6}
          placeholder="输入 6 位房间码"
          value={code}
          onInput={e => setCode((e.target as HTMLInputElement).value.toUpperCase())}
          pattern="[A-Za-z0-9]{6}"
          required
        />
        <button class={invite ? 'primary' : 'secondary'} disabled={app.busy || !onlineReady}>
          {app.busy ? '进入中…' : '加入'}
        </button>
      </form>
      <button class="secondary large create-room" disabled={app.busy || !onlineReady} onClick={() => void createRoom(player())}>
        创建联机房间
      </button>
    </>
  );

  return (
    <main class="home-layout">
      <div class="world-preview">
        <WildsMap view={null} selected={app.selected} home />
        <div class="animal-ribbon">
          <span>
            荒野居民<small>8 种隐藏身份</small>
          </span>
          {SPECIES.map(s => (
            <button key={s.id} onClick={() => showBestiary(s.id)} aria-label={`了解${s.name}`}>
              <Avatar animal={s.id} label={false} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      </div>
      <aside class="panel entry-panel">
        <span class="eyebrow gold">SURVIVE THE SEVENTH NIGHT</span>
        <h1>
          {invite ? (
            <>
              有人邀请你
              <br />
              进入荒野。
            </>
          ) : (
            <>
              每一个秘密，
              <br />
              都关乎生存。
            </>
          )}
        </h1>
        <p class="intro">
          {invite
            ? `房间 ${invite} 正在等你。填好代号即可加入，未满的席位由电脑补齐。`
            : '成为荒野中的一种动物。在七个回合里寻找食物、隐藏踪迹，判断谁在说谎。'}
        </p>
        <div class="game-facts">
          <span>8 位居民</span>
          <span>{RULES.rounds} 个回合</span>
          <span>隐藏身份 · 生存推理</span>
        </div>

        <label class="field-label" for="nickname">
          你的荒野代号
        </label>
        <input
          id="nickname"
          maxLength={RULES.nameLength}
          autocomplete="nickname"
          placeholder="给自己起一个名字"
          value={name}
          onInput={e => setName((e.target as HTMLInputElement).value)}
        />

        {invite ? online : solo}
        <div class="divider">
          <span>{invite ? '或者先单人练习' : '和朋友一起'}</span>
        </div>
        {invite ? solo : online}

        <div class="entry-note">
          <span>◇</span>
          <p>
            身份只有你知道。
            <br />
            活到第七夜，即为生存赢家。
          </p>
        </div>
      </aside>
    </main>
  );
}

export function HomeFooter() {
  return (
    <footer class="page-footer">
      <span>食物链 · 荒野生存博弈</span>
      <span>单人练习完全在浏览器中运行</span>
      <button onClick={showRules}>第一次来？阅读生存手册 ↗</button>
    </footer>
  );
}

export function Lobby() {
  const { view, connected, selected, playerId } = useApp();
  const g = view!;
  const isHost = g.host === playerId;
  return (
    <main class="lobby-layout">
      <WildsMap view={null} selected={selected} home />
      <aside class="panel entry-panel">
        <span class="eyebrow gold">BEFORE THE FIRST NIGHT</span>
        <h1>等待同伴入林</h1>
        <p class="intro">分享房间码邀请朋友。未满的席位会在开始时由电脑玩家补齐。</p>
        <button class="invite-code" onClick={() => copyInvite(g.code)} aria-label="复制邀请链接">
          {g.code} <small>点击复制邀请链接 ↗</small>
        </button>
        <div class="lobby-players">
          {Array.from({ length: RULES.maxPlayers }, (_, i) => {
            const p = g.players[i];
            return (
              <div key={i} class={p ? '' : 'empty'}>
                <span class="seat-number">{pad(i + 1)}</span>
                <strong>{p ? p.name : '等待加入'}</strong>
                <small>{p ? (p.bot ? '电脑' : p.id === g.host ? '房主' : '玩家') : '空席'}</small>
              </div>
            );
          })}
        </div>
        {isHost ? (
          <button class="primary large" disabled={!connected} onClick={() => send({ type: 'start' })}>
            开始七夜旅程
          </button>
        ) : (
          <p class="wait-text">等待房主开始游戏…</p>
        )}
        <p class="under-button">开始后随机分配身份 · 最多 8 人 · 支持语音</p>
      </aside>
    </main>
  );
}

export function copyInvite(code: string) {
  void navigator.clipboard
    ?.writeText(urls.invite(code))
    .then(() => toast('邀请链接已复制，发给朋友即可加入。'))
    .catch(() => toast(`房间码：${code}`));
  if (!navigator.clipboard) toast(`房间码：${code}`);
}
