import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { RULES, phasesFor, region, species, type PhaseId } from '../game/data';
import type { GameView } from '../game/view';
import { toggleSound, urls, useApp } from '../client/store';
import { ActionPanel, PrimaryButton } from './ActionPanel';
import {
  Chip,
  Pips,
  PlayerFace,
  Portrait,
  claimsFrom,
  copyInvite,
  dietText,
  numeral,
  pad,
  useFocusTab,
  useLayout,
  type PanelTab,
} from './common';
import { confirmLeave, showBestiary, showMenu, showPlayer, showRules } from './dialogs';
import { Icon, phaseIcon, type IconName } from './icons';
import { ChatPanel, JournalPanel } from './LogPanel';
import { WildsMap } from './WildsMap';

const DIFFICULTY_NAME = { easy: '入门', normal: '标准', hard: '老练' } as const;

/** Seconds left in the phase, corrected for the server clock. */
export function useCountdown(deadline: number, offset: number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => tick(n => n + 1), 500);
    return () => clearInterval(timer);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
}

export function Timer({ view }: { view: GameView }) {
  const { clockOffset } = useApp();
  const left = useCountdown(view.deadline, clockOffset);
  if (left === null)
    return (
      <span class="timer free" title="单人练习没有倒计时">
        <Icon name="timer" size={15} />
        不限时
      </span>
    );
  return (
    <span class={`timer ${left <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`剩余 ${left} 秒`}>
      <Icon name="timer" size={15} />
      {pad(Math.floor(left / 60))}:{pad(left % 60)}
    </span>
  );
}

function GameBar({ view, compact }: { view: GameView; compact: boolean }) {
  const { sound, connected } = useApp();
  const phases = phasesFor(view.mode);
  const current = phases.findIndex(p => p.id === view.phase);
  const brand = (
    <button class="gb-brand" onClick={confirmLeave} aria-label="离开对局，返回首页">
      <img src={urls.asset('favicon.svg')} alt="" width={32} height={32} />
    </button>
  );
  if (compact) {
    return (
      <header class="gamebar">
        <div class="gb-round" data-round={view.round}>
          <b>第{numeral(view.round)}夜</b>
          <span class="gb-phase-name">{phases[current]?.name}</span>
        </div>
        <Timer view={view} />
        <button class="icon-btn" onClick={showMenu} aria-label="菜单">
          <Icon name="menu" size={20} />
        </button>
        <div class="gb-progress" aria-hidden="true">
          {phases.map((p, i) => (
            <i key={p.id} class={i === current ? 'current' : i < current ? 'done' : ''} />
          ))}
        </div>
      </header>
    );
  }
  return (
    <header class="gamebar">
      {brand}
      <div class="gb-round" data-round={view.round}>
        <b>第{numeral(view.round)}夜</b>
        <small>
          {view.round} / {RULES.rounds}
        </small>
      </div>
      <ol class="gb-phases" aria-label="本回合阶段">
        {phases.map((p, i) => (
          <li
            key={p.id}
            class={i === current ? 'current' : i < current ? 'done' : ''}
            aria-current={i === current ? 'step' : undefined}
            title={p.name}
          >
            <span>
              <Icon name={i < current ? 'check' : phaseIcon(p.id)} size={15} />
              <span>{p.name}</span>
            </span>
          </li>
        ))}
      </ol>
      <Timer view={view} />
      <div class="gb-tools">
        {view.mode === 'solo' ? (
          <Chip icon="bot">单人练习 · {DIFFICULTY_NAME[view.difficulty]}</Chip>
        ) : (
          <>
            <span class={`conn ${connected ? 'on' : ''}`}>
              <Icon name={connected ? 'online' : 'offline'} size={15} />
              {connected ? '已连接' : '重连中'}
            </span>
            <button class="room-code" onClick={() => copyInvite(view.code)} title="复制邀请链接">
              {view.code}
              <Icon name="copy" size={14} />
            </button>
          </>
        )}
        <button class="icon-btn" onClick={showRules} aria-label="生存手册" title="生存手册">
          <Icon name="rules" />
        </button>
        <button class="icon-btn" onClick={() => showBestiary()} aria-label="动物图鉴" title="动物图鉴">
          <Icon name="bestiary" />
        </button>
        <button
          class="icon-btn"
          onClick={toggleSound}
          aria-label={sound ? '关闭音效' : '开启音效'}
          aria-pressed={sound}
          title={sound ? '关闭音效' : '开启音效'}
        >
          <Icon name={sound ? 'soundOn' : 'soundOff'} />
        </button>
        <button class="icon-btn" onClick={confirmLeave} aria-label="离开对局" title="离开对局">
          <Icon name="leave" />
        </button>
      </div>
    </header>
  );
}

function hungerText(view: GameView): { text: string; tone: string } {
  const p = view.me!;
  const left = species(p.animal).hunger - p.hunger;
  if (!p.alive) return { text: '已离开荒野', tone: '' };
  if (p.fed) return { text: '本回合已进食', tone: 'fed' };
  if (left <= 0) return { text: '正在挨饿 · 每回合 −1 生命', tone: 'warn' };
  if (left === 1) return { text: '本回合不进食将失去生命', tone: 'warn' };
  return { text: `还能空腹 ${left - 1} 回合`, tone: '' };
}

function Vitals({ view }: { view: GameView }) {
  const p = view.me!;
  const s = species(p.animal);
  return (
    <>
      <div class="vital hp">
        <span class="vital-label">
          <Icon name="hp" size={15} />
          <span class="vital-text">生命</span>
        </span>
        <Pips value={p.hp} max={s.hp} kind="hp" />
        <b>
          {p.hp}
          <small>/{s.hp}</small>
        </b>
      </div>
      <div class="vital sp">
        <span class="vital-label">
          <Icon name="sp" size={15} />
          <span class="vital-text">体力</span>
        </span>
        <Pips value={p.sp} max={s.sp} kind="sp" />
        <b>
          {p.sp}
          <small>/{s.sp}</small>
        </b>
      </div>
    </>
  );
}

function Hunger({ view }: { view: GameView }) {
  const { text, tone } = hungerText(view);
  return (
    <p class={`hunger ${tone}`}>
      <Icon name="hunger" size={15} />
      饥饿 · {text}
    </p>
  );
}

function SkillCard({ view }: { view: GameView }) {
  const p = view.me!;
  const s = species(p.animal);
  return (
    <div class="me-skill">
      <header>
        <Icon name="skill" size={15} />
        {s.skill}
        <small>1 SP{p.skillUsed ? ' · 本回合已用' : ''}</small>
      </header>
      <p>{s.skillText}</p>
    </div>
  );
}

function MeCard({ view }: { view: GameView }) {
  const p = view.me!;
  const s = species(p.animal);
  return (
    <section class={`card me-card ${p.alive ? '' : 'fallen'}`} aria-label="你的身份" data-tut="me">
      <div class="me-portrait">
        <Portrait animal={s.id} face />
        <span class="chip me-secret">
          <Icon name="lock" size={12} />
          仅你可见
        </span>
        <div class="me-id">
          <small>{s.title}</small>
          <h2>{s.name}</h2>
        </div>
      </div>
      <div class="me-body">
        <Vitals view={view} />
        <Hunger view={view} />
        <SkillCard view={view} />
        <p class="me-diet">{dietText(s.id)}</p>
      </div>
    </section>
  );
}

/** Identity, vitals and hunger in one row; details fold out on demand. */
function MeStrip({ view }: { view: GameView }) {
  const p = view.me!;
  const s = species(p.animal);
  const [open, setOpen] = useState(false);
  return (
    <section class={`card me-strip ${p.alive ? '' : 'fallen'}`} aria-label="你的身份" data-tut="me">
      <Portrait animal={s.id} face class="me-thumb" />
      <div class="me-strip-main">
        <div class="me-strip-title">
          <h2>{s.name}</h2>
          <small>{s.title} · 仅你可见</small>
          <button
            class={`chip ${open ? 'amber' : ''}`}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${s.skill} · ${open ? '收起' : '查看'}技能与食谱`}
          >
            <Icon name="skill" size={13} />
            {s.skill}
          </button>
        </div>
        <div class="me-strip-vitals">
          <Vitals view={view} />
        </div>
        <Hunger view={view} />
      </div>
      {open && (
        <div class="me-extra">
          <SkillCard view={view} />
          <p class="me-diet">{dietText(s.id)}</p>
        </div>
      )}
    </section>
  );
}

function Roster({ view, bare }: { view: GameView; bare?: boolean }) {
  const me = view.me!;
  const claims = claimsFrom(view);
  const alive = view.players.filter(p => p.alive).length;
  return (
    <section class={`roster ${bare ? 'bare' : 'card'}`} aria-label="荒野居民">
      <div class="section-head">
        <h3 class="brush">荒野居民</h3>
        <Chip icon="people">
          {alive}/{view.players.length} 存活
        </Chip>
      </div>
      <ul class="roster-list">
        {view.players.map(p => {
          const guess = me.guesses[p.id];
          const claim = claims.get(p.id);
          const known = p.animal ? species(p.animal).name : null;
          const identity = known
            ? p.alive
              ? known
              : `${known} · 第 ${p.diedRound} 夜倒下`
            : guess
              ? `你推理：${species(guess).name}`
              : claim
                ? `自称${species(claim).name}`
                : '身份未知';
          const facts = [identity, p.drop && p.alive ? `投放${region(p.drop).short}` : ''].filter(Boolean).join(' · ');
          return (
            <li key={p.id}>
              <button
                class={`player-row ${p.id === me.id ? 'self' : ''} ${p.alive ? '' : 'dead'}`}
                data-tut={`player-${p.seat}`}
                onClick={() => showPlayer(p.id)}
                aria-label={`${p.seat} 号 ${p.name}：${facts}。查看与记录推理`}
              >
                <PlayerFace view={view} player={p} />
                <span class="pr-main">
                  <b>
                    {p.name}
                    {p.id === me.id && <em>你</em>}
                    {p.bot && view.mode === 'online' && <Icon name="bot" size={13} label="电脑玩家" />}
                    {p.voice && <Icon name="voice" size={13} label="语音中" />}
                  </b>
                  <small class={known ? 'known' : guess ? 'guess' : ''}>{facts}</small>
                </span>
                <span class={`pr-status ${!p.alive ? 'dead' : p.ready ? 'ready' : ''}`} aria-hidden="true">
                  {!p.alive ? (
                    <Icon name="death" size={16} />
                  ) : p.ready ? (
                    <Icon name="check" size={16} />
                  ) : (
                    <span class="thinking">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type SideTab = Exclude<PanelTab, 'play'>;

function TabButton<T extends string>({
  id,
  current,
  set,
  children,
  badge,
}: {
  id: T;
  current: T;
  set: (t: T) => void;
  children: ComponentChildren;
  badge?: number;
}) {
  return (
    <button role="tab" class="tab" aria-selected={current === id} onClick={() => set(id)}>
      {children}
      {!!badge && current !== id && <span class="badge">{badge}</span>}
    </button>
  );
}

function FeedTabs({ view, people }: { view: GameView; people?: boolean }) {
  const { unreadChat } = useApp();
  const [tab, setTab] = useState<SideTab>(people ? 'people' : 'chat');
  useFocusTab(t => {
    if (t === 'chat' || t === 'log' || (t === 'people' && people)) setTab(t);
  });
  return (
    <section class="card side-panel">
      <div class="tabs" role="tablist">
        {people && (
          <TabButton id="people" current={tab} set={setTab}>
            <Icon name="people" size={16} />
            居民
          </TabButton>
        )}
        <TabButton id="chat" current={tab} set={setTab} badge={unreadChat}>
          <Icon name="public" size={16} />
          消息
        </TabButton>
        <TabButton id="log" current={tab} set={setTab}>
          <Icon name="journal" size={16} />
          观察记录
        </TabButton>
      </div>
      {people && tab === 'people' && <Roster view={view} bare />}
      <ChatPanel view={view} active={tab === 'chat'} />
      <JournalPanel view={view} active={tab === 'log'} />
    </section>
  );
}

function Dock({ view, tab, setTab }: { view: GameView; tab: PanelTab; setTab: (t: PanelTab) => void }) {
  const { unreadChat } = useApp();
  const tabs: { id: PanelTab; label: string; icon: IconName }[] = [
    { id: 'play', label: '行动', icon: phaseIcon(view.phase as PhaseId) },
    { id: 'chat', label: '消息', icon: 'public' },
    { id: 'people', label: '居民', icon: 'people' },
    { id: 'log', label: '记录', icon: 'journal' },
  ];
  return (
    <nav class="dock" aria-label="对局导航">
      <div class="dock-tabs" role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" class="dock-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={19} />
            {t.label}
            {t.id === 'chat' && unreadChat > 0 && tab !== 'chat' && <span class="badge">{unreadChat}</span>}
          </button>
        ))}
      </div>
      <PrimaryButton view={view} short />
    </nav>
  );
}

function PhonePlay({ view }: { view: GameView }) {
  const { selected } = useApp();
  const [tab, setTab] = useState<PanelTab>('play');
  const go = (t: PanelTab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  useFocusTab(t => {
    if (t !== tab) go(t);
  });
  // A new phase brings you back to the decision at hand.
  const phaseKey = `${view.round}:${view.phase}`;
  useEffect(() => {
    if (tab === 'people') go('play');
  }, [phaseKey]);
  return (
    <main class={`play play-narrow phase-${view.phase}`}>
      <GameBar view={view} compact />
      <div class="tab-view map-view" hidden={tab !== 'play'}>
        <WildsMap view={view} selected={selected} cover />
        <MeStrip view={view} />
        <ActionPanel view={view} layout="narrow" />
      </div>
      <div class="tab-view chat-view" hidden={tab !== 'chat'}>
        <section class="card">
          <ChatPanel view={view} active={tab === 'chat'} />
        </section>
      </div>
      {tab === 'people' && (
        <div class="tab-view">
          <Roster view={view} />
        </div>
      )}
      <div class="tab-view log-view" hidden={tab !== 'log'}>
        <section class="card">
          <JournalPanel view={view} active={tab === 'log'} />
        </section>
      </div>
      <Dock view={view} tab={tab} setTab={go} />
    </main>
  );
}

export function Play() {
  const { view, selected } = useApp();
  const layout = useLayout();
  const g = view!;
  if (layout === 'narrow') return <PhonePlay view={g} />;
  if (layout === 'medium')
    return (
      <main class={`play play-medium phase-${g.phase}`}>
        <GameBar view={g} compact={false} />
        <section class="play-stage">
          <WildsMap view={g} selected={selected} />
          <ActionPanel view={g} layout="medium" />
        </section>
        <aside class="play-side">
          <MeStrip view={g} />
          <FeedTabs view={g} people />
        </aside>
      </main>
    );
  return (
    <main class={`play play-wide phase-${g.phase}`}>
      <GameBar view={g} compact={false} />
      <aside class="play-left">
        <MeCard view={g} />
        <Roster view={g} />
      </aside>
      <section class="play-stage">
        <WildsMap view={g} selected={selected} />
        <ActionPanel view={g} layout="wide" />
      </section>
      <aside class="play-right">
        <FeedTabs view={g} />
      </aside>
    </main>
  );
}
