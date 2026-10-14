import { useState } from 'preact/hooks';
import {
  REGIONS,
  RULES,
  isAdjacent,
  phaseInfo,
  region,
  roundEvent,
  species,
  type FoodChoice,
  type PhaseId,
  type SpeciesId,
} from '../game/data';
import { visibleRegions, type GameView, type ViewEntry } from '../game/view';
import { answerCall, dismissCoach, joinVoice, send, skipToEnd, useApp } from '../client/store';
import { ClueBoard } from './Clues';
import { Chip, PlayerFace, entryTone, focusTab, numeral, playerById, seatName, type Layout } from './common';
import { Icon, entryIcon, foodIcon, phaseIcon, regionIcon, type IconName } from './icons';
import { useTutorialHint } from './Tutorial';
import { pickRegion } from './WildsMap';

function readyLabel(view: GameView, short = false): string {
  const p = view.me!;
  if (!p.alive) return '继续观战';
  if (p.ready) return short ? '已准备' : '已准备 · 等待其他玩家';
  switch (view.phase) {
    case 'talk':
      return view.mode === 'solo' ? '前往投放' : '我准备好了';
    case 'drop':
      return '锁定投放';
    case 'action':
      return '结束行动';
    case 'call':
      return '跳过通话';
    case 'food':
      return short ? '锁定进食' : '锁定食物行动';
    case 'settle':
      if (view.round >= RULES.rounds) return '查看最终结算';
      return short ? '下一回合' : '进入下一回合';
    default:
      return '继续';
  }
}

function readyBlocked(view: GameView, connected: boolean): boolean {
  const p = view.me!;
  if (!connected) return true;
  if (view.phase === 'call') return view.players[view.callIndex]?.id !== p.id || !!view.call;
  if (!p.alive) return false;
  return p.ready || (view.phase === 'drop' && !p.drop) || (view.phase === 'food' && !p.food);
}

export function PrimaryButton({ view, short }: { view: GameView; short?: boolean }) {
  const { connected } = useApp();
  const p = view.me!;
  const waiting = p.alive && p.ready && view.phase !== 'call';
  return (
    <button
      class={`btn primary ${short ? '' : 'large'} ready-btn`}
      data-tut="ready"
      disabled={readyBlocked(view, connected)}
      onClick={() => send({ type: 'ready' })}
    >
      {waiting && <Icon name="check" size={18} />}
      <span>{readyLabel(view, short)}</span>
      {!waiting && <Icon name="next" size={18} />}
    </button>
  );
}

function Tile({
  icon,
  title,
  note,
  tone = '',
  chosen,
  disabled,
  action,
  onClick,
}: {
  icon: IconName;
  title: string;
  note: string;
  tone?: string;
  chosen?: boolean;
  disabled?: boolean;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      class={`tile ${chosen ? 'chosen' : ''}`}
      data-action={action}
      data-tut={action}
      disabled={disabled}
      aria-pressed={chosen === undefined ? undefined : chosen}
      onClick={onClick}
    >
      <Icon name={icon} size={22} />
      <b>{title}</b>
      <small class={tone}>{note}</small>
    </button>
  );
}

/** Six regions as large touch targets, mirroring the map selection. */
function RegionPicker({ view, mode }: { view: GameView; mode: 'drop' | 'target' }) {
  const { selected } = useApp();
  const p = view.me!;
  const dropping = mode === 'drop';
  return (
    <div
      class="region-picker"
      data-tut="regions"
      role={dropping ? 'radiogroup' : 'group'}
      aria-label={dropping ? '选择投放地区' : '选择目标地区'}
    >
      {REGIONS.map(r => {
        const food = view.resources[r.id];
        const on = dropping ? p.drop === r.id : selected === r.id;
        const here = !dropping && p.location === r.id;
        const near = !dropping && isAdjacent(p.location, r.id);
        return (
          <button
            key={r.id}
            class={`region-tile ${on ? 'on' : ''} ${here ? 'here' : ''} ${!dropping && !here && !near ? 'far' : ''}`}
            data-region={r.id}
            role={dropping ? 'radio' : undefined}
            aria-checked={dropping ? on : undefined}
            aria-pressed={dropping ? undefined : on}
            disabled={dropping && p.ready}
            onClick={() => pickRegion(r.id)}
          >
            {here && <span class="tile-tag">你在这里</span>}
            {near && <span class="tile-tag go">可前往</span>}
            <Icon name={regionIcon(r.id)} size={20} />
            <b>{r.short}</b>
            <small class={food ? 'food' : ''}>{food ? `食物 ${food}` : '无食物'}</small>
          </button>
        );
      })}
    </div>
  );
}

function sameDrop(view: GameView) {
  const me = view.me!;
  return view.players.filter(p => p.alive && p.id !== me.id && p.drop && p.drop === me.drop);
}

function VoiceCard({ view }: { view: GameView }) {
  const p = view.me!;
  const { connected } = useApp();
  const count = view.players.filter(q => q.voice).length;
  return (
    <div class="voice-card">
      <span class="voice-orb">
        <Icon name="voice" size={20} />
      </span>
      <div>
        <strong>公共语音营地</strong>
        <small>{count} 人参与 · 不录音、不转写</small>
      </div>
      <button class={`btn ${p.voice ? 'ghost' : 'primary'}`} disabled={!connected} onClick={() => void joinVoice(!p.voice)}>
        {p.voice ? '离开语音' : '加入语音'}
      </button>
    </div>
  );
}

function TalkControls({ view, layout }: { view: GameView; layout: Layout }) {
  const p = view.me!;
  const { unreadChat } = useApp();
  // The wide layout already shows the whole conversation beside the map.
  const latest = layout === 'wide' ? [] : view.log.filter(l => l.kind === 'public' && l.round === view.round && l.from !== p.id).slice(-3);
  return (
    <div class="camp">
      {view.mode === 'online' && <VoiceCard view={view} />}
      <ClueBoard view={view} />
      {latest.length > 0 && (
        <ul class="quotes" aria-label="最新发言">
          {latest.map(l => {
            const who = playerById(view, l.from);
            if (!who) return null;
            return (
              <li key={l.id}>
                <PlayerFace view={view} player={who} />
                <div>
                  <small>
                    {who.seat} 号 {who.name}
                  </small>
                  <p>{l.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p class="camp-intro">
        <Icon name="camp" size={18} />
        <span>
          <b>捕食者常冒充草食动物。</b>被咬的居民会当众指认凶手，死者的身份会揭穿冒名者。
        </span>
      </p>
      {layout !== 'wide' && (
        <div class="ap-row">
          <button class="btn ghost" onClick={() => focusTab('chat')}>
            <Icon name="public" size={16} />
            查看全部消息
            {unreadChat > 0 && <span class="badge">{unreadChat}</span>}
          </button>
        </div>
      )}
    </div>
  );
}

function DropControls({ view }: { view: GameView }) {
  const p = view.me!;
  const chosen = p.drop ? region(p.drop) : null;
  const food = chosen ? view.resources[chosen.id] : 0;
  return (
    <>
      <RegionPicker view={view} mode="drop" />
      <p class="ap-note">
        {chosen ? (
          <>
            将投放到 <b>{chosen.name}</b>：{food ? `${food} 份食物` : '没有食物'}。{chosen.description}
            {p.ready ? '' : ' 锁定前可以随时更改。'}
          </>
        ) : (
          '点地图或上方地区，选一个本回合的起点。有食物的地区容易吃饱，也更容易遇到捕食者。'
        )}
      </p>
    </>
  );
}

const ACTION_TAGS = new Set(['move', 'hide', 'skill', 'scream', 'overdraw']);

/** What your actions turned up this round, newest first, right where you took them. */
function RoundLog({ view }: { view: GameView }) {
  const entries = view.log.filter(l => l.round === view.round && l.tag && ACTION_TAGS.has(l.tag)).slice(-3);
  if (!entries.length) return null;
  return (
    <ul class="round-log" data-tut="feed" aria-label="本回合的行动结果" aria-live="polite">
      {entries.reverse().map(l => (
        <li key={l.id} class={entryTone(l)}>
          <Icon name={entryIcon(l)} size={15} />
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

const SKILL_NOTE: Record<SpeciesId, string> = {
  wolf: '感知附近猎物数量',
  fox: '读一条同地私信',
  lynx: '下次命中伤害 +1',
  snake: '抹痕迹，下次命中 +1',
  rabbit: '跳走并抹除足迹',
  deer: '得知本地有无天敌',
  boar: '本回合受伤 −1',
  crow: '查看该地足迹',
};

function ActionControls({ view }: { view: GameView }) {
  const { selected } = useApp();
  const p = view.me!;
  const s = species(p.animal);
  const r = region(selected);
  const busy = p.ready || p.actions <= 0;
  const adjacent = isAdjacent(p.location, selected);
  const skillLabel = s.skillTarget === 'any' ? `${s.skill}${r.short}` : s.skillTarget === 'adjacent' ? `${s.skill}到${r.short}` : s.skill;
  const skillBlocked = busy || p.skillUsed || (s.skillTarget === 'adjacent' && !adjacent);
  const neighbours = sameDrop(view);
  return (
    <>
      <div class="ap-row">
        <Chip icon={regionIcon(p.location)} tone="teal">
          你在{region(p.location).name}
        </Chip>
        <span class="ap-label">剩余行动</span>
        <span class="pips-inline" role="img" aria-label={`剩余 ${p.actions} 次行动`}>
          {Array.from({ length: RULES.actionsPerRound }, (_, i) => (
            <i key={i} class={i < p.actions ? 'on' : ''} />
          ))}
        </span>
        <span class="grow" />
        <Chip icon="sp" tone="teal">
          体力 {p.sp}/{s.sp}
        </Chip>
        {p.sp === 0 && (
          <Chip icon="overdraw" tone="red">
            再行动将透支 1 生命
          </Chip>
        )}
      </div>
      <RegionPicker view={view} mode="target" />
      <div class="tile-grid">
        <Tile
          action="move"
          icon="move"
          title={adjacent ? `移动到${r.short}` : '移动'}
          note={adjacent ? '1 SP · 两地留下足迹' : '先选一个可前往的地区'}
          disabled={busy || !adjacent}
          onClick={() => send({ type: 'move', region: selected })}
        />
        <Tile action="hide" icon="hide" title="躲藏" note="1 SP · 抹除本地足迹" disabled={busy} onClick={() => send({ type: 'hide' })} />
        <Tile
          action="skill"
          icon="skill"
          title={skillLabel}
          note={p.skillUsed ? '本回合已使用' : `1 SP · ${SKILL_NOTE[s.id]}`}
          disabled={skillBlocked}
          onClick={() => send({ type: 'skill', region: s.skillTarget === 'none' ? undefined : selected })}
        />
        <Tile
          action="scream"
          icon="scream"
          title="尖叫"
          note="1 SP · 让同地居民知道你在"
          disabled={busy}
          onClick={() => send({ type: 'scream' })}
        />
      </div>
      <RoundLog view={view} />
      <p class="ap-note">
        {neighbours.length ? (
          <>
            与你同地投放：<b>{neighbours.map(q => `${q.seat}号${q.name}`).join('、')}</b>。
          </>
        ) : (
          '没有人和你投放在同一地区。'
        )}
        {p.sp === 1 && s.foods.length > 0 ? ' 留 1 体力获取食物更稳妥。' : ''}
      </p>
    </>
  );
}

function TraceControls({ view }: { view: GameView }) {
  const p = view.me!;
  const sight = visibleRegions(p.location);
  const ordered = [...sight, ...REGIONS.map(r => r.id).filter(id => !sight.includes(id))];
  return (
    <>
      <ul class="list-rows">
        {ordered.map(id => {
          const traces = view.traces[id];
          const others = traces?.filter(t => t !== p.id) ?? [];
          return (
            <li key={id} class={traces === null ? 'dim' : ''}>
              <Icon name={regionIcon(id)} size={18} />
              <span>
                <b>{region(id).name}</b>
                {id === p.location ? ' · 你在这里' : ''}
                <br />
                <small class="muted">
                  {traces === null
                    ? '超出视野'
                    : others.length
                      ? `${others.map(t => seatName(view, t)).join('、')} 曾经过`
                      : traces.length
                        ? '只有你自己的足迹'
                        : '没有足迹'}
                </small>
              </span>
              {others.length > 0 && (
                <span class="seats">
                  {others.map(t => (
                    <span key={t} class="seat">
                      {playerById(view, t)?.seat}
                    </span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p class="ap-note">足迹不等于实时位置；躲藏、伏击与疾跃都会抹除足迹。</p>
    </>
  );
}

function CallControls({ view }: { view: GameView }) {
  const p = view.me!;
  const caller = view.players[view.callIndex];
  const call = view.call;
  const [target, setTarget] = useState('');
  return (
    <div class="call-card">
      <div class="ap-row">
        <Icon name="call" size={18} />
        <strong>
          {call ? `${seatName(view, call.from)} → ${seatName(view, call.to)}` : `轮到 ${seatName(view, caller?.id)} 选择通话`}
        </strong>
      </div>
      <p>
        {call?.accepted
          ? '通话中 · 30 秒 · 不录音、不转写'
          : call
            ? '等待对方接受。拒绝不消耗通话机会。'
            : '每人每回合仅一次；成功接通后，双方机会均被消耗。'}
      </p>
      {call ? (
        call.to === p.id && !call.accepted ? (
          <div class="row">
            <button class="btn primary" onClick={() => void answerCall(true)}>
              接受通话
            </button>
            <button class="btn ghost" onClick={() => void answerCall(false)}>
              婉拒
            </button>
          </div>
        ) : call.from === p.id || call.to === p.id ? (
          <div class="row">
            <button class="btn ghost" onClick={() => send({ type: 'hangup' })}>
              结束通话
            </button>
          </div>
        ) : null
      ) : caller?.id === p.id ? (
        <div class="row">
          <select aria-label="通话对象" value={target} onChange={e => setTarget((e.target as HTMLSelectElement).value)}>
            <option value="">选择通话对象</option>
            {view.players
              .filter(q => !q.bot && q.id !== p.id && q.alive && !q.called)
              .map(q => (
                <option key={q.id} value={q.id}>
                  {q.seat} 号 {q.name}
                </option>
              ))}
          </select>
          <button class="btn ghost" disabled={!target} onClick={() => send({ type: 'call', target })}>
            邀请通话
          </button>
        </div>
      ) : null}
    </div>
  );
}

const FOOD_NAME: Record<FoodChoice, string> = { hunt: '捕食', forage: '采食', scavenge: '食腐', skip: '放弃进食' };

function HuntTargets({ view, choose }: { view: GameView; choose: (choice: FoodChoice, target: string) => void }) {
  const p = view.me!;
  const here = p.location;
  const near = new Set([...(view.traces[here] || []), ...view.players.filter(q => q.drop === here).map(q => q.id)]);
  const others = view.players
    .filter(q => q.id !== p.id && q.alive)
    .sort((a, b) => Number(near.has(b.id)) - Number(near.has(a.id)) || a.seat - b.seat);
  return (
    <>
      <span class="ap-label">捕食目标</span>
      <div class="targets" role="radiogroup" aria-label="捕食目标">
        <button
          class={`target solo ${!p.target ? 'on' : ''}`}
          role="radio"
          aria-checked={!p.target}
          disabled={p.ready}
          onClick={() => choose('hunt', '')}
        >
          <Icon name="random" size={15} />
          机会捕食
        </button>
        {others.map(q => (
          <button
            key={q.id}
            class={`target ${p.target === q.id ? 'on' : ''}`}
            role="radio"
            aria-checked={p.target === q.id}
            aria-label={`${q.seat} 号 ${q.name}`}
            disabled={p.ready}
            onClick={() => choose('hunt', q.id)}
          >
            <PlayerFace view={view} player={q} />
            {q.name}
            {near.has(q.id) && <Icon name="move" size={13} label="曾在你所在地区出现" />}
          </button>
        ))}
      </div>
      <p class="ap-note">机会捕食随机命中同地区可捕食的对象；指定目标若不在场就会落空。带足迹图标的居民曾出现在你所在地区。</p>
    </>
  );
}

function FoodControls({ view }: { view: GameView }) {
  const p = view.me!;
  const s = species(p.animal);
  const here = p.location;
  const bodies = view.bodies.filter(b => b.location === here).length;
  const traces = (view.traces[here] || []).filter(id => id !== p.id);
  const food = view.resources[here];
  const choices: FoodChoice[] = [...s.foods, 'skip'];
  const note = (c: FoodChoice): [string, string] => {
    if (c === 'skip') return ['不消耗体力，也不会暴露', ''];
    if (c === 'hunt') return [`命中后 +${s.gains.hunt} SP`, ''];
    if (c === 'scavenge') return bodies ? [`这里有遗骸 · +${s.gains.scavenge} SP`, 'ok'] : ['这里没有遗骸', 'no'];
    return food ? [`这里有食物 · +${s.gains.forage} SP`, 'ok'] : ['这里没有食物', 'no'];
  };
  const choose = (choice: FoodChoice, target = p.target) =>
    send({ type: 'food', choice, target: choice === 'hunt' ? target || undefined : undefined });
  return (
    <>
      <div class="ap-row">
        <Chip icon={regionIcon(here)} tone="teal">
          {region(here).name}
        </Chip>
        <Chip icon="forage" tone={food ? 'green' : ''}>
          {food ? `${food} 份食物` : '没有食物'}
        </Chip>
        {bodies > 0 && (
          <Chip icon="scavenge" tone="red">
            {bodies} 份遗骸
          </Chip>
        )}
        <Chip icon="move" tone={traces.length ? 'violet' : ''}>
          {traces.length ? `足迹：${traces.map(id => `${playerById(view, id)?.seat}号`).join('、')}` : '没有他人足迹'}
        </Chip>
      </div>
      <div class={`tile-grid ${choices.length === 3 ? 'three' : 'two'}`} data-tut="food">
        {choices.map(c => {
          const [text, tone] = note(c);
          return (
            <Tile
              key={c}
              action={`food-${c}`}
              icon={foodIcon(c, p.animal)}
              title={c === 'forage' && s.diet === 'hunt' ? '小型猎物' : FOOD_NAME[c]}
              note={text}
              tone={tone}
              chosen={p.food === c}
              disabled={p.ready}
              onClick={() => choose(c)}
            />
          );
        })}
      </div>
      {s.foods.includes('hunt') && p.food === 'hunt' && <HuntTargets view={view} choose={choose} />}
      <p class="ap-note">获取食物消耗 1 SP，并向同地区玩家暴露；按席位轮换先手结算。</p>
    </>
  );
}

const REPORT_TAGS = new Set(['hit', 'attacked', 'miss', 'fed', 'starved', 'hunger', 'overdraw']);

function hungerForecast(view: GameView): string {
  const p = view.me!;
  const left = species(p.animal).hunger - p.hunger - 1;
  return left <= 0 ? '明夜再吃不到东西，就会失去 1 点生命。' : `还能再空腹 ${left} 夜。`;
}

export function NightReport({ view }: { view: GameView }) {
  const p = view.me!;
  const tonight = view.log.filter(l => l.round === view.round);
  const entries: ViewEntry[] = tonight.filter(l => (l.tag && REPORT_TAGS.has(l.tag)) || (l.tag === 'death' && l.actor === p.id));
  // What the rest of the island gave away tonight: who fell, and who you saw eating nearby.
  const wild = tonight.filter(l => (l.tag === 'death' || l.tag === 'food-attempt') && l.actor && l.actor !== p.id);
  const diedTonight = !p.alive && p.diedRound === view.round;
  const mood = !p.alive ? 'grim' : p.fed ? '' : 'hungry';
  const title = p.alive
    ? p.fed
      ? `你吃饱了，活过第${numeral(view.round)}夜`
      : `你饿着肚子熬过第${numeral(view.round)}夜`
    : diedTonight
      ? '你在今夜倒下了'
      : '你正在观战';
  return (
    <div class={`night-report ${mood}`} data-tut="report">
      <div class="nr-head">
        <span class="nr-icon">
          <Icon name={!p.alive ? 'death' : p.fed ? 'fed' : 'hunger'} size={24} />
        </span>
        <div>
          <strong class="nr-title">{title}</strong>
          {p.alive && (
            <small>
              剩余 {p.hp} 生命 · {p.sp} 体力。{view.round >= RULES.rounds ? '下一步揭晓全部身份与得分。' : '准备好就进入下一回合。'}
            </small>
          )}
        </div>
      </div>
      {entries.length ? (
        <ul class="nr-list">
          {entries.map(l => (
            <li key={l.id} class={entryTone(l)}>
              <Icon name={entryIcon(l)} size={16} />
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="ap-note">这一夜风平浪静。</p>
      )}
      {wild.length > 0 && (
        <section class="nr-wild" aria-label="今夜荒野">
          <h4>今夜荒野</h4>
          <ul>
            {wild.map(l => {
              const who = playerById(view, l.actor);
              return (
                <li key={l.id} class={l.tag === 'death' ? 'bad' : 'clue'}>
                  {who ? <PlayerFace view={view} player={who} /> : <Icon name={entryIcon(l)} size={16} />}
                  <span>{l.text}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {p.alive && view.round < RULES.rounds && (
        <p class="nr-next">
          <Icon name="round" size={15} />
          <span>
            第{numeral(view.round + 1)}夜：{roundEvent(view.round + 1)}。{p.fed ? '' : hungerForecast(view)}
          </span>
        </p>
      )}
    </div>
  );
}

const TIPS: Partial<Record<PhaseId, string>> = {
  talk: '营地里有人在撒谎：线索板会标出撞了身份的居民。可以私信电脑居民提问，也可以点开任何居民，记下你对 Ta 身份的推理。',
  drop: '点一个有食物的地区作为本回合起点（地图或地区按钮都可以），再锁定投放。所有人锁定后，投放会公开。',
  action: '地图上的数字是其他居民的投放席位。和可疑的居民挤在一起？选一个「可前往」的相邻地区移动，或使用技能。',
  food: '草食动物在有食物的地区采食；捕食者只能吃同一地区、食谱里的动物。选好后锁定。',
  settle: '这是今夜的结算。注意饥饿：连续不进食会开始失去生命，而食物只恢复体力。',
};

function CoachTip({ view }: { view: GameView }) {
  const { coach, tutorial } = useApp();
  const guide = useTutorialHint();
  if (guide)
    return (
      <div class="coach guide" role="note">
        <Icon name="tutorial" size={18} />
        <p>
          <b>{guide.title}</b> · {guide.text}
        </p>
      </div>
    );
  const tip = TIPS[view.phase as PhaseId];
  if (tutorial || !coach || view.mode !== 'solo' || view.round > 2 || !tip || !view.me?.alive) return null;
  return (
    <div class="coach" role="note">
      <Icon name="tip" size={18} />
      <p>
        <b>新手提示</b> · {tip}
      </p>
      <button class="icon-btn" onClick={dismissCoach} aria-label="知道了，不再提示" title="知道了，不再提示">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function ActionPanel({ view, layout }: { view: GameView; layout: Layout }) {
  const docked = layout === 'narrow';
  const p = view.me!;
  const phase = view.phase as PhaseId;
  const info = phaseInfo(phase);
  const hint = !p.alive
    ? '你已进入观战：只能看到自己倒下前所在位置的局部线索。'
    : view.mode === 'solo' && phase === 'food'
      ? '看看身边的足迹，再决定捕食、采食、食腐或放弃。'
      : info.hint;
  const controls = {
    talk: <TalkControls view={view} layout={layout} />,
    drop: <DropControls view={view} />,
    action: <ActionControls view={view} />,
    traces: <TraceControls view={view} />,
    call: <CallControls view={view} />,
    food: <FoodControls view={view} />,
    settle: <NightReport view={view} />,
  }[phase];
  const fastForward = view.mode === 'solo' && !p.alive && (
    <button class="btn ghost" onClick={skipToEnd}>
      <Icon name="fastForward" size={16} />
      快进到终局
    </button>
  );
  return (
    <section class={`card action-panel phase-${phase}`} aria-labelledby="ap-title">
      <header class="ap-head">
        <span class="ap-icon">
          <Icon name={phaseIcon(phase)} size={22} />
        </span>
        <div>
          <h2 id="ap-title">{info.name}</h2>
          <p>{hint}</p>
        </div>
        {!docked && (
          <div class="ap-cta">
            {fastForward}
            <PrimaryButton view={view} />
          </div>
        )}
      </header>
      <div class="ap-body">
        <CoachTip view={view} />
        {p.alive || phase === 'settle' ? controls : null}
        {docked && fastForward}
      </div>
    </section>
  );
}
