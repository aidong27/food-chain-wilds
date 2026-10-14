import { useState } from 'preact/hooks';
import { RULES, isAdjacent, phaseInfo, region, species, type FoodChoice, type PhaseId } from '../game/data';
import type { GameView, ViewEntry } from '../game/view';
import { answerCall, dismissCoach, joinVoice, send, skipToEnd, useApp } from '../client/store';
import { entryIcon, entryTone, seatName } from './common';

function readyLabel(view: GameView): string {
  const p = view.me!;
  if (!p.alive) return '继续观战 →';
  if (p.ready) return '已准备 · 等待其他玩家';
  switch (view.phase) {
    case 'talk':
      return view.mode === 'solo' ? '前往投放 →' : '我准备好了 →';
    case 'drop':
      return '锁定投放 →';
    case 'action':
      return '结束行动 →';
    case 'call':
      return '跳过通话 →';
    case 'food':
      return '锁定食物行动 →';
    case 'settle':
      return view.round >= RULES.rounds ? '查看最终结算 →' : '进入下一回合 →';
    default:
      return '继续 →';
  }
}

function readyBlocked(view: GameView, connected: boolean): boolean {
  const p = view.me!;
  if (!connected) return true;
  if (view.phase === 'call') return view.players[view.callIndex]?.id !== p.id || !!view.call;
  if (!p.alive) return false;
  return p.ready || (view.phase === 'drop' && !p.drop) || (view.phase === 'food' && !p.food);
}

export function PrimaryButton({ view }: { view: GameView }) {
  const { connected } = useApp();
  return (
    <button class="primary" disabled={readyBlocked(view, connected)} onClick={() => send({ type: 'ready' })}>
      {readyLabel(view)}
    </button>
  );
}

function sameDrop(view: GameView) {
  const me = view.me!;
  return view.players.filter(p => p.alive && p.id !== me.id && p.drop && p.drop === me.drop);
}

function TalkControls({ view }: { view: GameView }) {
  const p = view.me!;
  const { connected } = useApp();
  if (view.mode === 'online') {
    const count = view.players.filter(q => q.voice).length;
    return (
      <div class="voice-card">
        <span class="voice-orb">◉</span>
        <div>
          <strong>公共语音营地</strong>
          <small>{count} 人参与 · 不录音、不转写</small>
        </div>
        <button class="secondary" disabled={!connected} onClick={() => void joinVoice(!p.voice)}>
          {p.voice ? '离开语音' : '加入语音'}
        </button>
      </div>
    );
  }
  return (
    <div class="camp-card">
      <p>
        营地里的居民会公开发言，也可能私信你。<b>捕食者常冒充草食动物</b>；被咬的动物会当众指认凶手，死者的身份会揭穿冒名者。
      </p>
      <button class="secondary" onClick={() => window.dispatchEvent(new CustomEvent('focus-chat'))}>
        查看营地消息
      </button>
    </div>
  );
}

function DropControls({ view }: { view: GameView }) {
  const { selected } = useApp();
  const p = view.me!;
  const r = region(selected);
  const food = view.resources[selected];
  return (
    <>
      <div class="decision-line">
        <div>
          <small>当前选择</small>
          <strong>{p.drop ? region(p.drop).name : '尚未选择地区'}</strong>
        </div>
        <button class="secondary" disabled={p.ready || p.drop === selected} onClick={() => send({ type: 'drop', region: selected })}>
          投放到{r.short}
        </button>
      </div>
      <p class="action-cost">
        {r.name}：{food ? `${food} 份食物` : '没有食物'} · {r.description}
      </p>
    </>
  );
}

function ActionControls({ view }: { view: GameView }) {
  const { selected } = useApp();
  const p = view.me!;
  const s = species(p.animal);
  const r = region(selected);
  const busy = p.ready || p.actions <= 0;
  const adjacent = isAdjacent(p.location, selected);
  const skillNeedsAdjacent = s.skillTarget === 'adjacent';
  const skillLabel = s.skillTarget === 'any' ? `${s.skill}${r.short}` : skillNeedsAdjacent ? `${s.skill}到${r.short}` : s.skill;
  const neighbours = sameDrop(view);
  return (
    <>
      <div class="action-buttons">
        <button
          class="secondary"
          disabled={busy || !adjacent}
          onClick={() => send({ type: 'move', region: selected })}
          title={adjacent ? '' : '先在地图上选择一个相邻地区'}
        >
          ↗ 移动到{r.short}
        </button>
        <button class="secondary" disabled={busy} onClick={() => send({ type: 'hide' })}>
          ◇ 躲藏
        </button>
        <button
          class="secondary skill"
          disabled={busy || p.skillUsed || (skillNeedsAdjacent && !adjacent)}
          onClick={() => send({ type: 'skill', region: s.skillTarget === 'none' ? undefined : selected })}
        >
          ◈ {skillLabel}
        </button>
        <button class="secondary" disabled={busy} onClick={() => send({ type: 'scream' })}>
          ≋ 尖叫
        </button>
      </div>
      <p class="action-cost">
        剩余 {p.actions} 次行动 · 每次 1 SP
        {p.sp === 0 && <b class="danger"> · 再行动将透支 1 HP</b>}
        {p.sp === 1 && s.foods.length > 0 && <span> · 留 1 SP 获取食物更稳妥</span>}
      </p>
      <p class="action-cost">
        {neighbours.length ? `与你同地投放：${neighbours.map(q => `${q.seat}号${q.name}`).join('、')}。` : '没有人和你投放在同一地区。'}
        {!adjacent && selected !== p.location ? ` ${r.name}不与你相邻。` : ''}
      </p>
    </>
  );
}

function TraceDetail({ view }: { view: GameView }) {
  const { selected } = useApp();
  const r = region(selected);
  const traces = view.traces[selected];
  return (
    <div class="trace-detail">
      <span class="trace-icon">⌁</span>
      <div>
        <strong>{r.name}的痕迹</strong>
        <p>
          {traces === null
            ? '超出视野。移动到附近，或依靠渡鸦的俯瞰。'
            : traces.length
              ? `${traces.map(id => seatName(view, id)).join('、')} 曾在这里经过。`
              : '没有发现足迹，也可能有人抹除了痕迹。'}
        </p>
      </div>
    </div>
  );
}

function CallControls({ view }: { view: GameView }) {
  const p = view.me!;
  const caller = view.players[view.callIndex];
  const call = view.call;
  const [target, setTarget] = useState('');
  return (
    <div class="call-panel">
      <strong>{call ? `${seatName(view, call.from)} → ${seatName(view, call.to)}` : `轮到 ${caller?.name ?? '—'} 选择通话`}</strong>
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
            <button class="primary" onClick={() => void answerCall(true)}>
              接受通话
            </button>
            <button class="secondary" onClick={() => void answerCall(false)}>
              婉拒
            </button>
          </div>
        ) : call.from === p.id || call.to === p.id ? (
          <button class="secondary" onClick={() => send({ type: 'hangup' })}>
            结束通话
          </button>
        ) : null
      ) : caller?.id === p.id ? (
        <div class="row">
          <select aria-label="通话对象" value={target} onChange={e => setTarget((e.target as HTMLSelectElement).value)}>
            <option value="">选择通话对象</option>
            {view.players
              .filter(q => !q.bot && q.id !== p.id && q.alive && !q.called)
              .map(q => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
          </select>
          <button class="secondary" disabled={!target} onClick={() => send({ type: 'call', target })}>
            邀请通话
          </button>
        </div>
      ) : null}
    </div>
  );
}

const FOOD_TEXT: Record<FoodChoice, string> = { hunt: '捕食', forage: '采食', scavenge: '食腐', skip: '放弃进食' };

function FoodControls({ view }: { view: GameView }) {
  const p = view.me!;
  const s = species(p.animal);
  const locked = p.ready;
  const here = p.location;
  const bodies = view.bodies.filter(b => b.location === here).length;
  const traces = view.traces[here] || [];
  const choices: FoodChoice[] = [...s.foods, 'skip'];
  const note = (c: FoodChoice) => {
    if (c === 'skip') return '不消耗体力，也不会暴露';
    if (c === 'hunt') return `命中后 +${s.gains.hunt} SP`;
    if (c === 'scavenge') return bodies ? `这里有遗骸 · +${s.gains.scavenge} SP` : '这里没有遗骸';
    return view.resources[here] ? `这里有食物 · +${s.gains.forage} SP` : '这里没有食物';
  };
  const choose = (choice: FoodChoice, target = p.target) =>
    send({ type: 'food', choice, target: choice === 'hunt' ? target || undefined : undefined });
  return (
    <>
      <div class="food-choices">
        {choices.map(c => (
          <button
            key={c}
            class={`food-choice ${p.food === c ? 'chosen' : ''}`}
            disabled={locked}
            onClick={() => choose(c)}
            aria-pressed={p.food === c}
          >
            <strong>{c === 'forage' && s.diet === 'hunt' ? '小型猎物' : FOOD_TEXT[c]}</strong>
            <small>{note(c)}</small>
          </button>
        ))}
      </div>
      {s.foods.includes('hunt') && p.food === 'hunt' && (
        <select
          aria-label="捕食目标"
          disabled={locked}
          value={p.target}
          onChange={e => choose('hunt', (e.target as HTMLSelectElement).value)}
        >
          <option value="">机会捕食 · 随机命中同地区可捕食对象</option>
          {view.players
            .filter(q => q.id !== p.id && q.alive)
            .map(q => (
              <option key={q.id} value={q.id}>
                指定 {q.seat}号{q.name}
              </option>
            ))}
        </select>
      )}
      <p class="action-cost">
        你在{region(here).name}：{view.resources[here] ? `${view.resources[here]} 份食物` : '没有食物'}
        {bodies ? ` · ${bodies} 份遗骸` : ''} ·{' '}
        {traces.length
          ? `痕迹：${
              traces
                .filter(id => id !== p.id)
                .map(id => seatName(view, id))
                .join('、') || '只有你自己'
            }`
          : '没有痕迹'}
      </p>
      <p class="action-cost muted">获取食物消耗 1 SP，并向同地区玩家暴露；按席位轮换先手结算。</p>
    </>
  );
}

const REPORT_TAGS = new Set(['hit', 'attacked', 'miss', 'fed', 'starved', 'hunger', 'overdraw', 'death']);

export function NightReport({ view }: { view: GameView }) {
  const p = view.me!;
  const entries: ViewEntry[] = view.log.filter(l => l.round === view.round && l.tag && REPORT_TAGS.has(l.tag));
  const diedTonight = !p.alive && p.diedRound === view.round;
  return (
    <div class={`night-report ${diedTonight ? 'grim' : ''}`}>
      <div class="headline">
        <span>{p.alive ? (p.fed ? '✦' : '◌') : '†'}</span>
        <strong>
          {p.alive
            ? p.fed
              ? `你吃饱了，活过第 ${view.round} 夜`
              : `你饿着肚子熬过第 ${view.round} 夜`
            : diedTonight
              ? '你在今夜倒下了'
              : '你正在观战'}
        </strong>
      </div>
      {entries.length ? (
        <ul>
          {entries.map(l => (
            <li key={l.id} class={entryTone(l)}>
              <i>{entryIcon(l)}</i>
              {l.text}
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">这一夜风平浪静。</p>
      )}
      {p.alive && (
        <p class="muted">
          剩余 {p.hp} HP · {p.sp} SP。{view.round >= RULES.rounds ? '下一步揭晓全部身份与得分。' : '准备好就进入下一回合。'}
        </p>
      )}
    </div>
  );
}

const TIPS: Partial<Record<PhaseId, string>> = {
  talk: '先看看「消息往来」里大家说了什么——有人在撒谎。也可以私信电脑居民提问，点左侧居民记录你的推理。',
  drop: '在地图上点一个有 ✦ 的地区（那里有食物），再点「投放到…」，最后锁定。所有人锁定后投放会公开。',
  action: '地图上的数字牌是其他居民的投放席位。和可疑的居民挤在一起？移动到虚线框的相邻地区，或使用技能。',
  food: '草食动物在有 ✦ 的地区采食；捕食者只能吃同一地区、食谱里的动物。选好后锁定。',
  settle: '这是今夜的结算。注意饥饿周期：连续不进食会开始扣生命，而食物只恢复体力。',
};

function CoachTip({ view }: { view: GameView }) {
  const { coach } = useApp();
  const tip = TIPS[view.phase as PhaseId];
  if (!coach || view.mode !== 'solo' || view.round > 2 || !tip || !view.me?.alive) return null;
  return (
    <div class="coach" role="note">
      <b>新手提示</b>
      <p>{tip}</p>
      <button class="link-button" onClick={dismissCoach}>
        知道了，不再提示
      </button>
    </div>
  );
}

export function ActionPanel({ view }: { view: GameView }) {
  const p = view.me!;
  const phase = view.phase as PhaseId;
  const info = phaseInfo(phase);
  const placed = phase !== 'talk' && phase !== 'drop';
  const hint = !p.alive
    ? '你已进入观战：只能看到自己倒下前所在位置的局部线索。'
    : view.mode === 'solo' && phase === 'food'
      ? '查看身边的痕迹，再决定捕食、采食、食腐或放弃。'
      : info.hint;
  const controls = {
    talk: <TalkControls view={view} />,
    drop: <DropControls view={view} />,
    action: <ActionControls view={view} />,
    traces: <TraceDetail view={view} />,
    call: <CallControls view={view} />,
    food: <FoodControls view={view} />,
    settle: <NightReport view={view} />,
  }[phase];
  return (
    <section class="panel action-panel">
      <div class="action-heading">
        <div>
          <span class="eyebrow">YOUR NEXT MOVE</span>
          <h2>{info.name}</h2>
        </div>
        <span class="location-chip">
          {placed ? `⌖ ${region(p.location).name}` : view.round === 1 ? '尚未投放' : `上回合 · ${region(p.location).short}`}
        </span>
      </div>
      <p class="phase-hint">{hint}</p>
      <CoachTip view={view} />
      {p.alive || phase === 'settle' ? controls : null}
      <div class="action-footer">
        <span>{view.mode === 'solo' ? '单人练习 · 由你掌握节奏' : '全部准备或倒计时结束后推进'}</span>
        <div class="row">
          {view.mode === 'solo' && !p.alive && (
            <button class="secondary" onClick={skipToEnd}>
              快进到终局
            </button>
          )}
          <PrimaryButton view={view} />
        </div>
      </div>
    </section>
  );
}
