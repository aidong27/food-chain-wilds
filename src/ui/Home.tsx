import { useEffect, useState } from 'preact/hooks';
import { RULES, SPECIES, species, type Diet, type SpeciesId } from '../game/data';
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
  useApp,
} from '../client/store';
import { Portrait, copyInvite, useLayout } from './common';
import { showBestiary, showRules } from './dialogs';
import { Icon, phaseIcon } from './icons';
import { WildsMap } from './WildsMap';

const DIFFICULTIES: { id: Difficulty; name: string; note: string }[] = [
  { id: 'easy', name: '入门', note: '捕食者较迟钝，适合第一次进入荒野。' },
  { id: 'normal', name: '标准', note: '电脑会推理、撒谎、追踪猎物。' },
  { id: 'hard', name: '老练', note: '捕食者更果断，几乎不浪费线索。' },
];

const DIET: Record<Diet, string> = { hunt: '捕食者', plant: '草食', scavenge: '食腐' };

const STEPS = [
  { phase: 'talk', name: '交流', text: '公开发言或私信试探。捕食者常常冒充草食动物。' },
  { phase: 'drop', name: '秘密投放', text: '选一个起点。全员锁定后，所有人的投放同时公开。' },
  { phase: 'action', name: '行动', text: '移动、躲藏、尖叫或使用技能，每次消耗 1 体力。' },
  { phase: 'food', name: '获取食物', text: '捕食、采食或食腐。食物只恢复体力，从不恢复生命。' },
] as const;

const SERVER_TEXT = {
  checking: '正在检查联机服务器…',
  ok: '联机服务器在线',
  outdated: '联机服务器仍是旧版本，暂时无法联机（等待维护者更新后端）',
  offline: '暂时连不上联机服务器；单人练习不受影响',
} as const;

function SoloForm({ name }: { name: () => string }) {
  const app = useApp();
  const [animal, setAnimal] = useState<SpeciesId | ''>('');
  const [difficulty, setDifficulty] = useState<Difficulty>(savedDifficulty);
  const save = app.hasSave ? savedSolo() : null;
  const saveMe = save?.game.players.find(p => p.id === save.playerId);
  const chosen = animal ? species(animal) : null;
  return (
    <>
      <div class="field">
        <span id="difficulty-label">练习难度</span>
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
        <small class="hint">{DIFFICULTIES.find(d => d.id === difficulty)!.note}</small>
      </div>
      <div class="field">
        <span id="role-label">练习身份</span>
        <div class="role-picker" role="radiogroup" aria-labelledby="role-label">
          <button
            role="radio"
            aria-checked={animal === ''}
            aria-label="随机身份"
            class={`role ${animal === '' ? 'on' : ''}`}
            onClick={() => setAnimal('')}
          >
            <Icon name="random" size={18} />
          </button>
          {SPECIES.map(s => (
            <button
              key={s.id}
              role="radio"
              aria-checked={animal === s.id}
              aria-label={`${s.name}，${s.title}`}
              title={s.name}
              class={`role ${animal === s.id ? 'on' : ''}`}
              data-animal={s.id}
              onClick={() => setAnimal(s.id)}
            >
              <Portrait animal={s.id} face />
            </button>
          ))}
        </div>
        <small class="hint">
          {chosen ? (
            <>
              <b>{chosen.name}</b> · {chosen.title}（{DIET[chosen.diet]}）
            </>
          ) : (
            <>
              <b>随机身份</b> · 开局才揭晓，最接近真实对局
            </>
          )}
        </small>
      </div>
      <button class="btn primary large block solo-start" onClick={() => startSolo({ name: name(), animal, difficulty })}>
        开始单人练习
        <Icon name="next" size={19} />
      </button>
      <p class="under">与 7 位电脑玩家对局 · 无需联网 · 随时暂停</p>
      {save && saveMe && save.game.phase !== 'finished' && (
        <button class="resume" onClick={resumeSolo}>
          <Portrait animal={saveMe.animal} face class="resume-face" />
          <span>
            <b>继续上次练习</b>
            <small>
              第 {save.game.round} 回合 · {species(saveMe.animal).name}
              {saveMe.alive ? '' : '（观战）'}
            </small>
          </span>
          <Icon name="next" size={18} />
        </button>
      )}
    </>
  );
}

function OnlineForm({ name, invite }: { name: () => string; invite: string }) {
  const app = useApp();
  const [code, setCode] = useState(invite);
  const ready = app.server === 'ok';
  return (
    <>
      <p class={`server-status ${app.server}`}>
        <i />
        {SERVER_TEXT[app.server]}
        {app.server === 'offline' && (
          <button class="link-btn" onClick={() => void refreshServer()}>
            重试
          </button>
        )}
      </p>
      <form
        class="join-form"
        onSubmit={e => {
          e.preventDefault();
          if (!ready) return toast(SERVER_TEXT[app.server]);
          void joinRoom(code, name());
        }}
      >
        <input
          id="room-input"
          class="input code-input"
          aria-label="六位房间码"
          maxLength={6}
          placeholder="6 位房间码"
          autocomplete="off"
          value={code}
          onInput={e => setCode((e.target as HTMLInputElement).value.toUpperCase())}
          pattern="[A-Za-z0-9]{6}"
          required
        />
        <button class={`btn ${invite ? 'primary' : 'ghost'}`} disabled={app.busy || !ready}>
          {app.busy ? '进入中…' : '加入房间'}
        </button>
      </form>
      <div class="or">
        <span>或者</span>
      </div>
      <button class="btn ghost large block create-room" disabled={app.busy || !ready} onClick={() => void createRoom(name())}>
        <Icon name="host" size={18} />
        创建联机房间
      </button>
      <p class="under">最多 8 人 · 空位由电脑补齐 · 支持语音</p>
    </>
  );
}

export function Home() {
  const [name, setName] = useState(savedName);
  const [invite] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [mode, setMode] = useState<'solo' | 'online'>(invite ? 'online' : 'solo');
  const player = () => name.trim() || '林间旅人';

  useEffect(() => {
    void refreshServer();
  }, []);

  return (
    <main class="home">
      <section class="hero">
        <div class="hero-bg" aria-hidden="true" />
        <div class="hero-inner">
          <div class="hero-copy">
            <p class="eyebrow">七夜荒野 · 隐藏身份生存推理</p>
            <h1 class="hero-title">食物链</h1>
            <p class="hero-sub">{invite ? '有人邀请你进入荒野。' : '每一个秘密，都关乎生存。'}</p>
            <p class="hero-text">
              {invite
                ? `房间 ${invite} 正在等你。填好代号即可加入，未满的席位由电脑补齐。`
                : '成为荒野中的一种动物。七个回合里寻找食物、隐藏足迹、分辨谎言——活到第七夜，就是赢家。'}
            </p>
            <ul class="hero-facts">
              <li>
                <Icon name="people" size={16} />8 位居民
              </li>
              <li>
                <Icon name="round" size={16} />
                {RULES.rounds} 个回合
              </li>
              <li>
                <Icon name="lock" size={16} />
                身份只有你知道
              </li>
            </ul>
          </div>
          <div class="entry-card glass" id="play">
            <div class="tabs" role="tablist" aria-label="游戏方式">
              <button role="tab" class="tab" aria-selected={mode === 'solo'} onClick={() => setMode('solo')}>
                <Icon name="bot" size={17} />
                单人练习
              </button>
              <button role="tab" class="tab" aria-selected={mode === 'online'} onClick={() => setMode('online')}>
                <Icon name="people" size={17} />
                好友联机
              </button>
            </div>
            <div class="entry-body" role="tabpanel">
              <label class="field">
                <span>你的荒野代号</span>
                <input
                  id="nickname"
                  class="input"
                  maxLength={RULES.nameLength}
                  autocomplete="nickname"
                  placeholder="给自己起一个名字"
                  value={name}
                  onInput={e => setName((e.target as HTMLInputElement).value)}
                />
              </label>
              {mode === 'solo' ? <SoloForm name={player} /> : <OnlineForm name={player} invite={invite} />}
            </div>
          </div>
        </div>
      </section>

      <section class="home-section">
        <header class="home-head">
          <h2 class="brush">荒野居民</h2>
          <p>8 种动物，各有食谱、弱点与一项技能。开局随机分配，身份只有自己知道。</p>
        </header>
        <div class="species-grid">
          {SPECIES.map(s => (
            <button key={s.id} class="species-card" onClick={() => showBestiary(s.id)} aria-label={`了解${s.name}`}>
              <Portrait animal={s.id} face />
              <span class="species-info">
                <b>{s.name}</b>
                <small>{s.title}</small>
              </span>
              <em class={`diet ${s.diet}`}>{DIET[s.diet]}</em>
            </button>
          ))}
        </div>
      </section>

      <section class="home-section">
        <header class="home-head">
          <h2 class="brush">一夜怎么过</h2>
          <p>每回合都按同样的顺序推进，七个回合后仍然活着就是生存赢家。</p>
        </header>
        <ol class="step-list">
          {STEPS.map((s, i) => (
            <li key={s.phase}>
              <span class="step-icon">
                <Icon name={phaseIcon(s.phase)} size={22} />
              </span>
              <small>0{i + 1}</small>
              <b>{s.name}</b>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <div class="home-more">
          <button class="btn ghost" onClick={showRules}>
            <Icon name="rules" size={17} />
            阅读完整生存手册
          </button>
          <a class="btn quiet" href="#play">
            准备好了，进入荒野
            <Icon name="next" size={17} />
          </a>
        </div>
      </section>

      <footer class="page-footer">
        <span>食物链 · 荒野生存博弈</span>
        <span>单人练习完全在浏览器中运行</span>
      </footer>
    </main>
  );
}

export function Lobby() {
  const { view, connected, selected, playerId } = useApp();
  const narrow = useLayout() === 'narrow';
  const g = view!;
  const isHost = g.host === playerId;
  return (
    <main class="lobby">
      <div class="lobby-map">
        <WildsMap view={null} selected={selected} home cover={narrow} />
      </div>
      <aside class="card lobby-card">
        <p class="eyebrow">第一夜之前</p>
        <h1 class="brush">等待同伴入林</h1>
        <p class="muted">分享房间码邀请朋友。未满的席位会在开始时由电脑玩家补齐。</p>
        <button class="invite-code" onClick={() => copyInvite(g.code)} aria-label={`房间码 ${g.code}，复制邀请链接`}>
          <span>{g.code}</span>
          <small>
            <Icon name="copy" size={14} />
            复制邀请链接
          </small>
        </button>
        <ul class="lobby-seats">
          {Array.from({ length: RULES.maxPlayers }, (_, i) => {
            const p = g.players[i];
            return (
              <li key={i} class={p ? (p.id === playerId ? 'self' : '') : 'empty'}>
                <span class="face">
                  <b>{i + 1}</b>
                </span>
                <span>
                  <strong>{p ? p.name : '等待加入'}</strong>
                  <small>{p ? (p.id === g.host ? '房主' : p.bot ? '电脑' : '玩家') : '空席'}</small>
                </span>
                {p?.id === g.host && <Icon name="host" size={15} />}
              </li>
            );
          })}
        </ul>
        {isHost ? (
          <button class="btn primary large block" disabled={!connected} onClick={() => send({ type: 'start' })}>
            开始七夜旅程
            <Icon name="next" size={19} />
          </button>
        ) : (
          <p class="wait">
            <span class="spinner" aria-hidden="true" />
            等待房主开始游戏…
          </p>
        )}
        <p class="under">开始后随机分配身份 · 最多 8 人 · 支持语音</p>
      </aside>
    </main>
  );
}
