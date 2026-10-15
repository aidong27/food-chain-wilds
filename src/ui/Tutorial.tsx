/**
 * The guided first match. A list of steps walks through the first two nights
 * of the scripted match in game/tutorial.ts: each step highlights what to look
 * at or press, and only that can be pressed until the step is done. From the
 * second night's drop the guidance shrinks to quiet hints in the action panel.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isAdjacent, phasesFor, region, type PhaseId } from '../game/data';
import { TUTORIAL_SEATS } from '../game/tutorial';
import type { GameView } from '../game/view';
import { endTutorial, leave, playAgain, setTutorialStep, toast, useApp, type AppState } from '../client/store';
import { composeMessage, focusTab, useLayout, type Layout, type PanelTab } from './common';
import { closeDialog } from './dialogs';
import { Icon } from './icons';

interface Ctx {
  view: GameView;
  app: AppState;
  layout: Layout;
}

interface Step {
  id: string;
  round: number;
  phase: PhaseId;
  /** data-tut names to highlight; the first one anchors the bubble. */
  focus?: string[];
  /** The panel that holds the focus, for layouts that show one panel at a time. */
  tab?: PanelTab;
  /** On phones, keep the note at this edge, e.g. clear of the newest messages. */
  dock?: 'top';
  title: string;
  text: (c: Ctx) => ComponentChildren;
  /** Steps you only read end with this button. */
  next?: string;
  /** Steps that wait for you end when this turns true. */
  done?: (c: Ctx) => boolean;
  /** Held back until this is true, e.g. until a reply arrives. */
  ready?: (c: Ctx) => boolean;
  enter?: (c: Ctx) => void;
  exit?: () => void;
  /** A quiet note in the action panel instead of a spotlight. */
  hint?: boolean;
  finale?: boolean;
}

const seatId = (view: GameView, seat: number) => view.players.find(p => p.seat === seat)?.id ?? '';
const me = (c: Ctx) => c.view.me!;
const hasFood = (c: Ctx, id: string | null | undefined) => !!id && c.view.resources[id as keyof GameView['resources']] > 0;
const spoke = (c: Ctx, seat: number) =>
  c.view.log.some(l => l.round === c.view.round && l.kind === 'public' && l.from === seatId(c.view, seat));
const wolf = (c: Ctx) => seatId(c.view, TUTORIAL_SEATS.wolf);
const reply = (c: Ctx) => c.view.log.find(l => l.kind === 'private' && l.from === wolf(c) && l.to === me(c).id);
const here = (c: Ctx) => region(me(c).location).name;

const STEPS: Step[] = [
  {
    id: 'welcome',
    round: 1,
    phase: 'talk',
    title: '欢迎来到荒野',
    text: () => '这是 8 只动物的隐藏身份生存游戏：每个人只知道自己是什么。活过七个夜晚就是胜利。前两夜，我会一步一步带你走。',
    next: '开始',
  },
  {
    id: 'you',
    round: 1,
    phase: 'talk',
    focus: ['me'],
    tab: 'play',
    title: '你是一头麋鹿',
    text: () => (
      <>
        身份只有你知道。<b class="hp">红条是生命</b>，归零就出局；<b class="sp">青条是体力</b>
        ，每个行动花 1 点，吃到东西才能补回来。麋鹿吃草，唯一的天敌是<b>灰狼</b>。
      </>
    ),
    next: '明白了',
  },
  {
    id: 'liar',
    round: 1,
    phase: 'talk',
    focus: ['clues'],
    tab: 'play',
    ready: c => spoke(c, 2) && spoke(c, 3),
    title: '营地里有人在撒谎',
    text: () => (
      <>
        2 号和 3 号都说自己是野兔，可每种动物只有一只——<b>至少有一个人在说谎</b>。捕食者最喜欢冒充草食动物。
      </>
    ),
    next: '有意思',
  },
  {
    id: 'ask',
    round: 1,
    phase: 'talk',
    focus: ['composer'],
    tab: 'chat',
    enter: c => composeMessage(wolf(c), '你是什么动物？'),
    done: c => c.view.log.some(l => l.kind === 'private' && l.from === me(c).id && l.to === wolf(c)),
    title: '私信试探',
    text: () => '私信只有你们两个能看到。我替你写好了一句，发给 2 号试试。',
  },
  {
    id: 'reply',
    round: 1,
    phase: 'talk',
    focus: ['chat'],
    tab: 'chat',
    dock: 'top',
    ready: c => !!reply(c),
    title: 'Ta 的回答',
    text: c =>
      reply(c)?.text.includes('野兔')
        ? '2 号一口咬定自己是野兔。是真是假？先记在心里，荒野会给出答案。'
        : '回答未必是真话。先记在心里，荒野会给出答案。',
    next: '继续',
  },
  {
    id: 'to-drop',
    round: 1,
    phase: 'talk',
    focus: ['ready'],
    tab: 'play',
    title: '结束交流',
    text: () => '交流随时可以结束。点击「前往投放」。',
  },
  {
    id: 'drop',
    round: 1,
    phase: 'drop',
    focus: ['regions', 'map'],
    tab: 'play',
    done: c => hasFood(c, me(c).drop),
    title: '秘密投放',
    text: c =>
      me(c).drop && !hasFood(c, me(c).drop)
        ? '那里没有食物，麋鹿吃不到东西。换一个带绿叶标记的地区。'
        : c.layout === 'narrow'
          ? '选一个今晚的起点。麋鹿要吃草，在地图上点一个有食物（绿叶标记）的地区。'
          : '选一个今晚的起点。麋鹿要吃草，挑一个有食物（绿叶标记）的地区——点地图或下面的按钮都行。',
  },
  {
    id: 'lock',
    round: 1,
    phase: 'drop',
    focus: ['ready', 'regions', 'map'],
    tab: 'play',
    title: '锁定投放',
    text: () => '所有人锁定后，大家的起点会同时公开。点击「锁定投放」。',
  },
  {
    id: 'reveal',
    round: 1,
    phase: 'action',
    focus: ['map'],
    tab: 'play',
    title: '投放公开了',
    text: c => {
      const company = c.view.players.filter(p => p.alive && p.id !== me(c).id && p.drop === me(c).drop).map(p => `${p.seat} 号`);
      return (
        <>
          地图上的数字是其他居民的投放席位。和你一起投放在{here(c)}的有：{company.join('、') || '没有人'}。其中就有
          <b>那个自称野兔的 2 号</b>。
        </>
      );
    },
    next: '怎么办？',
  },
  {
    id: 'alert',
    round: 1,
    phase: 'action',
    focus: ['skill'],
    tab: 'play',
    done: c => me(c).skillUsed,
    title: '用技能确认',
    text: () => '麋鹿的技能「警觉」能得知同一地区有没有能吃掉你的天敌。花 1 体力用一下。',
  },
  {
    id: 'danger',
    round: 1,
    phase: 'action',
    focus: ['feed'],
    tab: 'play',
    title: '有天敌！',
    text: () => (
      <>
        警觉证实了：这里有能吃掉你的动物——多半就是冒充野兔的 2 号。<b>别冒险，趁还剩 1 次行动，离开这里。</b>
      </>
    ),
    next: '快走',
  },
  {
    id: 'escape',
    round: 1,
    phase: 'action',
    focus: ['regions', 'map'],
    tab: 'play',
    done: c => isAdjacent(me(c).location, c.app.selected) && hasFood(c, c.app.selected),
    title: '选一条退路',
    text: c =>
      isAdjacent(me(c).location, c.app.selected)
        ? '那里没有食物。再选一个带虚线圈、又有绿叶标记的地区。'
        : '只能走到相邻的地区——地图上带虚线圈的那些。选一个有食物（绿叶标记）的。',
  },
  {
    id: 'move',
    round: 1,
    phase: 'action',
    focus: ['move', 'regions', 'map'],
    tab: 'play',
    done: c => me(c).location !== me(c).drop,
    title: '移动',
    text: c =>
      isAdjacent(me(c).location, c.app.selected)
        ? `点击「移动到${region(c.app.selected).short}」。移动会在出发地和目的地都留下足迹。`
        : '先选一个带虚线圈的相邻地区，再点「移动」。',
  },
  {
    id: 'end-action',
    round: 1,
    phase: 'action',
    focus: ['ready'],
    tab: 'play',
    title: '结束行动',
    text: () => '两次行动都用完了。点「结束行动」，其他居民会同时行动。',
  },
  {
    id: 'traces',
    round: 1,
    phase: 'food',
    focus: ['map'],
    tab: 'play',
    title: '足迹',
    text: () => '现在能看到你所在和相邻地区的足迹（紫色数字）。足迹只说明有人来过，不代表 Ta 还在那里。你刚离开的地方也留下了你的足迹。',
    next: '明白',
  },
  {
    id: 'forage',
    round: 1,
    phase: 'food',
    focus: ['food'],
    tab: 'play',
    done: c => me(c).food === 'forage',
    title: '进食',
    text: () => '麋鹿是草食动物，选「采食」。获取食物要花 1 体力，吃到就能恢复 3 体力。',
  },
  {
    id: 'lock-food',
    round: 1,
    phase: 'food',
    focus: ['ready', 'food'],
    tab: 'play',
    title: '锁定',
    text: () => '所有人锁定后，按席位顺序轮流结算。点「锁定食物行动」。',
  },
  {
    id: 'report',
    round: 1,
    phase: 'settle',
    focus: ['report'],
    tab: 'play',
    title: '活过第一夜',
    text: c =>
      me(c).fed
        ? '你吃饱了。记住：食物只恢复体力，从不恢复生命。麋鹿连续两夜吃不到东西，就会开始每夜失去 1 点生命。'
        : '这一夜你没吃到东西。食物只恢复体力，从不恢复生命；连续两夜吃不到，就会开始每夜失去 1 点生命。',
    next: '记住了',
  },
  {
    id: 'next-night',
    round: 1,
    phase: 'settle',
    focus: ['ready'],
    tab: 'play',
    title: '天快亮了',
    text: () => '点「进入下一回合」，第二夜开始。',
  },
  {
    id: 'accused',
    round: 2,
    phase: 'talk',
    focus: ['chat'],
    tab: 'chat',
    dock: 'top',
    ready: c => spoke(c, 4),
    title: '真相浮出水面',
    text: () => (
      <>
        4 号说昨夜被 2 号咬了。被咬的居民会当众指认凶手——<b>2 号正是你昨晚躲开的灰狼</b>。
      </>
    ),
    next: '原来如此',
  },
  {
    id: 'mark',
    round: 2,
    phase: 'talk',
    focus: [`player-${TUTORIAL_SEATS.wolf}`],
    tab: 'people',
    done: c => me(c).guesses[wolf(c)] === 'wolf',
    exit: () => setTimeout(closeDialog, 500),
    title: '记下你的推理',
    text: () => '点开 2 号，把 Ta 标记为「灰狼」。推理只有你能看到，终局时每猜对一个 +2 分。',
  },
  {
    id: 'own',
    round: 2,
    phase: 'talk',
    tab: 'play',
    title: '接下来交给你',
    text: () => '这一夜由你自己决定：交流、投放、行动、进食。我只在行动面板里轻声提醒。小心，食物会越来越少。',
    next: '我来试试',
  },
  {
    id: 'hint-drop',
    round: 2,
    phase: 'drop',
    hint: true,
    title: '挑起点',
    text: () => '挑一个有食物的地区。谁和你投放在一起，要等全员锁定后才揭晓。',
  },
  {
    id: 'hint-action',
    round: 2,
    phase: 'action',
    hint: true,
    title: '看看身边',
    text: () => '先看谁和你投放在同一地区。觉得危险就用「警觉」确认，或移动到相邻地区；觉得安全，直接结束行动也可以。',
  },
  {
    id: 'hint-food',
    round: 2,
    phase: 'food',
    hint: true,
    title: '先手轮换',
    text: () => '先手顺序每夜轮换，今晚你最后结算：同一地区若有别的草食动物，食物可能先被吃掉。',
  },
  {
    id: 'finale',
    round: 2,
    phase: 'settle',
    finale: true,
    title: '教程完成',
    text: () => '你已经会识破谎言、秘密投放、用技能避险和进食了。剩下五夜，荒野不会再手下留情——活到第七夜吧。',
  },
];

/** Steps you see in the spotlight, for the progress count. */
const SHOWN = STEPS.filter(s => !s.hint);

const ORDER = phasesFor('solo').map(p => p.id);
const moment = (round: number, phase: string) => round * 10 + ORDER.indexOf(phase as PhaseId);

/** Moves past steps that are done or belong to a moment the match has already left. */
function settle(index: number, c: Ctx): number {
  const now = c.view.phase === 'finished' ? Infinity : moment(c.view.round, c.view.phase);
  let i = index;
  while (i < STEPS.length) {
    const s = STEPS[i];
    const at = moment(s.round, s.phase);
    if (at > now) break;
    if (at < now || s.done?.(c)) i++;
    else break;
  }
  return i;
}

/** The note the action panel shows during the free part of the tutorial. */
export function useTutorialHint(): { title: string; text: ComponentChildren } | null {
  const app = useApp();
  const layout = useLayout();
  const step = STEPS.find(s => s.id === app.tutorial?.id);
  if (!step?.hint || !app.view?.me) return null;
  return { title: step.title, text: step.text({ view: app.view, app, layout }) };
}

/** Runs the tutorial while the match is on screen. */
export function Tutorial() {
  const app = useApp();
  const layout = useLayout();
  const view = app.view;
  const progress = app.tutorial;
  const ctx: Ctx | null = view?.me && progress ? { view, app, layout } : null;
  const index = ctx ? settle(progress!.step, ctx) : -1;
  const step = ctx && index < STEPS.length ? STEPS[index] : null;
  // Each step waits for its moment, for anything it depends on, and for the night's title card to clear.
  const live = !!(
    ctx &&
    step &&
    moment(step.round, step.phase) === moment(view!.round, view!.phase) &&
    (step.ready?.(ctx) ?? true) &&
    app.banner?.kind !== 'night'
  );
  const shown = live ? step : null;

  useEffect(() => {
    if (!ctx || !progress) return;
    if (index >= STEPS.length) return endTutorial(true);
    for (let i = progress.step; i < index; i++) STEPS[i].exit?.();
    const id = shown?.id ?? null;
    if (index !== progress.step || id !== progress.id) setTutorialStep(index, id);
  });

  useEffect(() => {
    if (!shown || !ctx) return;
    if (shown.tab) focusTab(shown.tab);
    shown.enter?.(ctx);
  }, [shown?.id]);

  // A step due now but still waiting (for the title card or a reply) keeps the board still.
  const waiting = !!(ctx && step && !shown && !step.hint && moment(step.round, step.phase) === moment(view!.round, view!.phase));
  if (waiting) return <Hold key={step!.id} />;
  if (!ctx || !shown || shown.hint) return null;
  return (
    <Spotlight key={shown.id} step={shown} ctx={ctx} position={SHOWN.indexOf(shown) + 1} next={() => setTutorialStep(index + 1, null)} />
  );
}

/**
 * Lets only `names`, the tutorial note and open dialogs take input. Everything
 * else is swallowed on the way down, so the match cannot move on by accident.
 */
function useGate(names: string[], onBlocked?: () => void) {
  useEffect(() => {
    const allowed = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return true;
      if (target.closest('.tut-bubble, dialog')) return true;
      return names.some(n => target.closest(`[data-tut~="${n}"]`));
    };
    const gate = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      if (allowed(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'click') onBlocked?.();
    };
    const types = ['click', 'pointerdown', 'mousedown', 'keydown', 'submit'];
    types.forEach(t => document.addEventListener(t, gate, true));
    return () => types.forEach(t => document.removeEventListener(t, gate, true));
  }, [names.join(' ')]);
}

/** Holds input for a moment while the next step gets ready; gives up after a few seconds. */
function Hold() {
  const [holding, setHolding] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setHolding(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  return holding ? <HoldGate /> : null;
}

function HoldGate() {
  useGate([]);
  return null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 6;

function targets(name: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-tut~="${name}"]`)].filter(el => el.getClientRects().length > 0);
}

/**
 * The part of a target you can actually see: page content scrolled under the
 * phone's sticky game bar or behind its dock is left dark.
 */
function rectOf(el: Element): Rect | null {
  const r = el.getBoundingClientRect();
  let top = Math.max(r.top, 0);
  let bottom = Math.min(r.bottom, window.innerHeight);
  if (!el.closest('.gamebar, .dock')) {
    top = Math.max(top, document.querySelector('.gamebar')?.getBoundingClientRect().bottom ?? 0);
    bottom = Math.min(bottom, document.querySelector('.dock')?.getBoundingClientRect().top ?? Infinity);
  }
  if (bottom - top < 16) return null;
  return { x: Math.round(r.left), y: Math.round(top), w: Math.round(r.width), h: Math.round(bottom - top) };
}

const rectsOf = (names: string[]) => names.flatMap(n => targets(n).map(rectOf)).filter((r): r is Rect => r !== null);

interface Place {
  left: number;
  top: number;
  /** On short screens: how far to scroll the page so the note fits beside its target. */
  scroll?: number;
}

/** Where the bubble goes: beside its target if there is room, otherwise docked to the far edge. */
function placeBubble(anchor: Rect | null, w: number, h: number, layout: Layout, dock?: 'top'): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 12;
  // Clear of the game bar, and on phones of the dock (hidden while typing).
  const bar = document.querySelector('.gamebar')?.getBoundingClientRect().bottom ?? 60;
  const tabs = document.querySelector('.dock')?.getBoundingClientRect();
  const top0 = bar + 10;
  const bottom0 = layout === 'narrow' && tabs?.height ? tabs.top - 12 : vh - margin;
  const clampX = (x: number) => Math.min(Math.max(x, margin), Math.max(margin, vw - w - margin));
  const clampY = (y: number) => Math.min(Math.max(y, top0), Math.max(top0, bottom0 - h));
  if (!anchor) return { left: clampX((vw - w) / 2), top: clampY((vh - h) / 2) };
  if (dock && layout === 'narrow') return { left: clampX((vw - w) / 2), top: top0 };
  const gap = 14 + PAD;
  const cx = anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;
  const below = { ok: anchor.y + anchor.h + gap + h <= bottom0, left: clampX(cx - w / 2), top: anchor.y + anchor.h + gap };
  const above = { ok: anchor.y - gap - h >= top0, left: clampX(cx - w / 2), top: anchor.y - gap - h };
  const right = { ok: anchor.x + anchor.w + gap + w <= vw - margin, left: anchor.x + anchor.w + gap, top: clampY(cy - h / 2) };
  const left = { ok: anchor.x - gap - w >= margin, left: anchor.x - gap - w, top: clampY(cy - h / 2) };
  // Tall panels on wide screens read best with the note beside them.
  const order = layout !== 'narrow' && anchor.h >= h ? [right, left, below, above] : [below, above, right, left];
  const fit = order.find(o => o.ok);
  if (fit) return fit;
  // Nothing fits beside it. On a phone, scrolling the target to one edge of the screen frees the other.
  const docked = { left: clampX(cx - w / 2), top: cy > (top0 + bottom0) / 2 ? top0 : bottom0 - h };
  if (layout !== 'narrow' || anchor.h + gap + h > bottom0 - top0 - 8) return docked;
  const toBottom = anchor.y + anchor.h - (bottom0 - 8);
  const toTop = anchor.y - (top0 + 8);
  const room = { up: window.scrollY, down: document.documentElement.scrollHeight - window.innerHeight - window.scrollY };
  const moves = [toBottom < 0 && -toBottom <= room.up && toBottom, toTop > 0 && toTop <= room.down && toTop].filter(
    (m): m is number => typeof m === 'number',
  );
  const scroll = moves.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  return { ...docked, scroll };
}

function Spotlight({ step, ctx, position, next }: { step: Step; ctx: Ctx; position: number; next: () => void }) {
  const names = step.focus ?? [];
  const [rects, setRects] = useState<Rect[]>(() => rectsOf(names));
  const [hidden, setHidden] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [nudges, setNudges] = useState(0);
  const bubble = useRef<HTMLDivElement>(null);
  const shifted = useRef(false);

  // Targets move as panels open, scroll and animate, so follow them every frame.
  useEffect(() => {
    let frame = 0;
    let last = '';
    const follow = () => {
      const found = rectsOf(names);
      const dialog = !!document.querySelector('dialog[open]');
      const key = JSON.stringify(found) + dialog;
      if (key !== last) {
        last = key;
        setRects(found);
        setHidden(dialog);
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [step.id]);

  // Bring the target into view once the right panel is showing.
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = names.length ? targets(names[0])[0] : null;
      if (!el || shifted.current) return;
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 90) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
    if (step.next || step.finale) bubble.current?.querySelector<HTMLButtonElement>('.tut-actions .btn')?.focus({ preventScroll: true });
    return () => clearTimeout(timer);
  }, [step.id]);

  // Only the highlighted controls, the note itself and open dialogs take input.
  useGate(names, () => setNudges(n => n + 1));

  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    const next = placeBubble(rects[0] ?? null, el.offsetWidth, el.offsetHeight, ctx.layout, step.dock);
    if (next.scroll && !shifted.current) {
      // Once per step; the targets are followed every frame, so the note settles beside them.
      shifted.current = true;
      window.scrollBy({ top: next.scroll });
    }
    if (!place || next.left !== place.left || next.top !== place.top) setPlace(next);
  });

  const skip = () => {
    endTutorial(false);
    toast('已退出教程，这一局可以继续玩下去。');
  };
  const finish = (then?: () => void) => {
    endTutorial(true);
    then?.();
  };

  return (
    <div class={`tut-layer ${hidden ? 'is-hidden' : ''}`}>
      <svg class="tut-dim" aria-hidden="true">
        <defs>
          <mask id="tut-holes">
            <rect width="100%" height="100%" fill="white" />
            {rects.map((r, i) => (
              <rect key={i} x={r.x - PAD} y={r.y - PAD} width={r.w + PAD * 2} height={r.h + PAD * 2} rx="14" fill="black" />
            ))}
          </mask>
        </defs>
        <rect class="tut-shade" width="100%" height="100%" mask="url(#tut-holes)" />
      </svg>
      {rects.map((r, i) => (
        <div key={i} class="tut-ring" style={{ left: r.x - PAD, top: r.y - PAD, width: r.w + PAD * 2, height: r.h + PAD * 2 }} />
      ))}
      <div
        ref={bubble}
        class={`tut-bubble ${step.finale ? 'finale' : ''} ${nudges ? 'nudged' : ''}`}
        data-nudge={nudges % 2}
        role="dialog"
        aria-labelledby="tut-title"
        aria-describedby="tut-text"
        style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}
      >
        <div class="tut-meta">
          <Icon name="tutorial" size={15} />
          新手教程
          <span>
            {position} / {SHOWN.length}
          </span>
        </div>
        <h3 id="tut-title">{step.title}</h3>
        <p id="tut-text">{step.text(ctx)}</p>
        {!step.next && !step.finale && (
          <p class="tut-do">
            <Icon name="tap" size={15} />
            按提示操作，完成后自动继续
          </p>
        )}
        <div class="tut-actions">
          {step.finale ? (
            <>
              <button class="btn primary" onClick={() => finish()}>
                继续这一局
                <Icon name="next" size={17} />
              </button>
              <button class="btn ghost" onClick={() => finish(playAgain)}>
                开始新的练习
              </button>
              <button class="btn quiet" onClick={() => finish(leave)}>
                返回首页
              </button>
            </>
          ) : (
            <>
              <button class="link-btn tut-skip" onClick={skip}>
                退出教程
              </button>
              {step.next && (
                <button class="btn primary" onClick={next}>
                  {step.next}
                  <Icon name="next" size={17} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
