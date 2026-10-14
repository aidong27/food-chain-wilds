import { useEffect, useState } from 'preact/hooks';
import { phasesFor, region, species, type PhaseId } from '../game/data';
import type { GameView } from '../game/view';
import { useApp } from '../client/store';
import { ActionPanel, PrimaryButton } from './ActionPanel';
import { Avatar, Meter, claimsFrom, pad } from './common';
import { showPlayer } from './dialogs';
import { LogPanel } from './LogPanel';
import { WildsMap } from './WildsMap';

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
  if (left === null) return <span class="timer free">自由推进</span>;
  return (
    <span class={`timer ${left <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`剩余 ${left} 秒`}>
      {pad(Math.floor(left / 60))}:{pad(left % 60)}
    </span>
  );
}

function PhaseBar({ view }: { view: GameView }) {
  const phases = phasesFor(view.mode);
  const current = phases.findIndex(p => p.id === view.phase);
  return (
    <div class="round-bar">
      <div class="round-count">
        <span>ROUND</span>
        <b>{pad(view.round)}</b>
        <small>/ 07</small>
      </div>
      <ol class="phase-strip">
        {phases.map((p, i) => (
          <li key={p.id} class={i === current ? 'active' : i < current ? 'done' : ''} aria-current={i === current ? 'step' : undefined}>
            <i>{i < current ? '✓' : pad(i + 1)}</i>
            <span>{p.name}</span>
          </li>
        ))}
      </ol>
      <Timer view={view} />
    </div>
  );
}

function StatusCard({ view }: { view: GameView }) {
  const p = view.me!;
  const s = species(p.animal);
  const hungerLeft = s.hunger - p.hunger;
  return (
    <section class={`panel character-card ${p.alive ? '' : 'fallen'}`}>
      <div class="character-portrait">
        <Avatar animal={s.id} />
        <span class="secret-label">◇ 仅你可见</span>
        <div class="identity-caption">
          <span>{s.title}</span>
          <h2>{s.name}</h2>
        </div>
      </div>
      <div class="character-body">
        <div class="stat-label">
          <span class="hp">♥ 生命</span>
          <strong>
            {p.hp}
            <small> / {s.hp}</small>
          </strong>
        </div>
        <Meter value={p.hp} max={s.hp} kind="hp" />
        <div class="stat-label">
          <span class="sp">ϟ 体力</span>
          <strong>
            {p.sp}
            <small> / {s.sp}</small>
          </strong>
        </div>
        <Meter value={p.sp} max={s.sp} kind="sp" />
        <div class={`hunger ${!p.fed && hungerLeft <= 1 ? 'warn' : ''}`}>
          <span>饥饿</span>
          <b>
            {!p.alive
              ? '已离开荒野'
              : p.fed
                ? '本回合已进食'
                : hungerLeft <= 0
                  ? '正在挨饿 · 每回合 −1 HP'
                  : hungerLeft === 1
                    ? '本回合不进食将扣血'
                    : `可再空腹 ${hungerLeft - 1} 回合`}
          </b>
        </div>
        <div class="skill-description">
          <span>
            {s.skill} <small>· 1 SP{p.skillUsed ? ' · 本回合已用' : ''}</small>
          </span>
          <p>{s.skillText}</p>
        </div>
        <p class="diet">
          {s.prey.length ? `可捕食：${s.prey.map(id => species(id).name).join('、')}` : ''}
          {s.foods.includes('scavenge') ? `${s.prey.length ? ' · ' : ''}食腐 +${s.gains.scavenge}` : ''}
          {s.foods.includes('forage')
            ? `${s.prey.length || s.foods.includes('scavenge') ? ' · ' : ''}${s.diet === 'hunt' ? '小型猎物' : '采食'} +${s.gains.forage}`
            : ''}
        </p>
      </div>
    </section>
  );
}

function Roster({ view }: { view: GameView }) {
  const me = view.me!;
  const claims = claimsFrom(view);
  const alive = view.players.filter(p => p.alive).length;
  return (
    <section class="panel roster">
      <div class="section-title">
        <h3>荒野居民</h3>
        <span>
          {alive} / {view.players.length} 存活
        </span>
      </div>
      {view.players.map(p => {
        const guess = me.guesses[p.id];
        const claim = claims.get(p.id);
        const known = p.animal ? species(p.animal).name : null;
        const facts = [
          known ?? (guess ? `推理：${species(guess).name}` : claim ? `自称${species(claim).name}` : '身份未知'),
          p.bot && view.mode === 'online' ? '电脑' : '',
          p.drop ? `投放${region(p.drop).short}` : '',
        ].filter(Boolean);
        return (
          <button
            key={p.id}
            class={`player-row ${p.id === me.id ? 'self' : ''} ${p.alive ? '' : 'dead'}`}
            onClick={() => showPlayer(p.id)}
            aria-label={`查看 ${p.name} 的信息`}
          >
            <span class="seat-number">{pad(p.seat)}</span>
            <span class="player-info">
              <b>
                {p.name}
                {p.id === me.id && <small>你</small>}
                {p.voice && <small class="voice">语音</small>}
              </b>
              <small class={guess && !known ? 'guess' : ''}>{facts.join(' · ')}</small>
            </span>
            <span class="ready-symbol" aria-label={!p.alive ? '已死亡' : p.ready ? '已准备' : '思考中'}>
              {!p.alive ? '†' : p.ready ? '✓' : '·'}
            </span>
          </button>
        );
      })}
    </section>
  );
}

/** Small screens keep the timer and the main button within thumb reach. */
function Dock({ view }: { view: GameView }) {
  const name = phasesFor(view.mode).find(p => p.id === view.phase)?.name ?? '';
  return (
    <div class="dock">
      <div>
        <small>
          第 {view.round} 回合 · {name}
        </small>
        <Timer view={view} />
      </div>
      <PrimaryButton view={view} />
    </div>
  );
}

export function Play() {
  const { view, selected } = useApp();
  const g = view!;
  return (
    <main class={`play-layout phase-${g.phase as PhaseId}`}>
      <PhaseBar view={g} />
      <aside class="left-sidebar">
        <StatusCard view={g} />
        <Roster view={g} />
      </aside>
      <div class="center-stage">
        <WildsMap view={g} selected={selected} />
        <ActionPanel view={g} />
      </div>
      <LogPanel view={g} />
      <Dock view={g} />
    </main>
  );
}
