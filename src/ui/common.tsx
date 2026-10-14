import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { SPECIES, species, type SpeciesId } from '../game/data';
import type { GameView, PlayerSummary, ViewEntry } from '../game/view';
import { parseStatement } from '../game/bots/language';
import { toast, urls } from '../client/store';
import { Icon, type IconName } from './icons';

/** Where each portrait's face sits inside its sprite tile, for tight crops. */
const FACE: Record<SpeciesId, [number, number]> = {
  wolf: [0.5, 0.4],
  fox: [0.5, 0.4],
  lynx: [0.5, 0.38],
  snake: [0.56, 0.4],
  rabbit: [0.46, 0.5],
  deer: [0.5, 0.5],
  boar: [0.5, 0.48],
  crow: [0.55, 0.43],
};

/**
 * A crop of the animal sprite. The element's own size and shape decide the
 * crop; `face` centres it on the animal's head instead of the whole tile.
 */
export function Portrait({ animal, face, class: cls = '', label }: { animal: SpeciesId; face?: boolean; class?: string; label?: boolean }) {
  const index = SPECIES.findIndex(s => s.id === animal);
  const [fx, fy] = face ? FACE[animal] : [0.5, 0.5];
  return (
    <span
      class={`portrait ${cls}`}
      role={label ? 'img' : undefined}
      aria-label={label ? species(animal).name : undefined}
      aria-hidden={label ? undefined : 'true'}
    >
      <i style={{ '--col': index % 4, '--row': Math.floor(index / 4), '--fx': fx, '--fy': fy }} />
    </span>
  );
}

/** A player's token: their portrait if known (or guessed), otherwise their seat number. */
export function PlayerFace({ view, player, class: cls = '' }: { view: GameView; player: PlayerSummary; class?: string }) {
  const guess = !player.animal ? view.me?.guesses[player.id] : undefined;
  const animal = player.animal ?? guess;
  const state = [cls, !player.alive && 'dead', guess && 'guess', !animal && 'unknown'].filter(Boolean).join(' ');
  return (
    <span class={`face ${state}`} aria-hidden="true">
      {animal ? <Portrait animal={animal} face /> : <b>{player.seat}</b>}
      {animal && <em>{player.seat}</em>}
    </span>
  );
}

export function Pips({ value, max, kind }: { value: number; max: number; kind: 'hp' | 'sp' }) {
  return (
    <span
      class={`pips ${kind}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={kind === 'hp' ? '生命' : '体力'}
    >
      {Array.from({ length: max }, (_, i) => (
        <i key={i} class={i < value ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Chip({
  icon,
  tone = '',
  children,
  title,
}: {
  icon?: IconName;
  tone?: string;
  children: ComponentChildren;
  title?: string;
}) {
  return (
    <span class={`chip ${tone}`} title={title}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

export const pad = (n: number) => String(n).padStart(2, '0');

const NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
/** Round numbers in the brush face read better as Chinese numerals: 第三夜. */
export const numeral = (n: number) => NUMERALS[n] ?? String(n);

export function seatName(view: GameView | null, id?: string): string {
  const p = view?.players.find(q => q.id === id);
  return p ? `${p.seat} 号 ${p.name}` : '荒野';
}

/** What an animal eats, in one short line. */
export function dietText(id: SpeciesId): string {
  const s = species(id);
  const parts: string[] = [];
  if (s.prey.length) parts.push(`捕食${s.prey.map(p => species(p).name).join('、')}`);
  if (s.foods.includes('forage')) parts.push(s.diet === 'hunt' ? `小型猎物 +${s.gains.forage} SP` : `采食 +${s.gains.forage} SP`);
  if (s.foods.includes('scavenge')) parts.push(`食腐 +${s.gains.scavenge} SP`);
  if (s.foods.includes('hunt')) parts.push(`命中 +${s.gains.hunt} SP`);
  return parts.join(' · ');
}

/** Latest identity each player claimed where I could hear it. */
export function claimsFrom(view: GameView): Map<string, SpeciesId> {
  const out = new Map<string, SpeciesId>();
  for (const entry of view.log) {
    if ((entry.kind !== 'public' && entry.kind !== 'private') || !entry.from) continue;
    const claim = parseStatement(entry.text, view).claim;
    if (claim) out.set(entry.from, claim);
  }
  return out;
}

export function playerById(view: GameView, id?: string): PlayerSummary | undefined {
  return view.players.find(p => p.id === id);
}

export function entryTone(entry: ViewEntry): string {
  switch (entry.tag) {
    case 'attacked':
    case 'death':
    case 'hunger':
    case 'overdraw':
    case 'starved':
      return 'bad';
    case 'fed':
    case 'hit':
      return 'good';
    case 'round':
    case 'reveal':
    case 'finish':
      return 'quiet';
    default:
      return entry.kind === 'clue' ? 'clue' : '';
  }
}

/** Entries split into nights, oldest first, for feeds with round dividers. */
export function byRound<T extends { round: number }>(entries: T[]): { round: number; entries: T[] }[] {
  const out: { round: number; entries: T[] }[] = [];
  for (const entry of entries) {
    const last = out.at(-1);
    if (last && last.round === entry.round) last.entries.push(entry);
    else out.push({ round: entry.round, entries: [entry] });
  }
  return out;
}

export function RoundDivider({ round }: { round: number }) {
  return (
    <div class="round-divider" role="separator">
      <span>{round ? `第${numeral(round)}夜` : '开局之前'}</span>
    </div>
  );
}

export type Layout = 'wide' | 'medium' | 'narrow';

const WIDE = '(min-width: 1200px) and (min-height: 600px)';
/** Phones, portrait tablets and short landscape windows get the scrolling layout. */
const NARROW = '(max-width: 979px), (max-height: 559px)';

function currentLayout(): Layout {
  if (matchMedia(NARROW).matches) return 'narrow';
  return matchMedia(WIDE).matches ? 'wide' : 'medium';
}

/** Which arrangement of the play screen fits the window. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState(currentLayout);
  useEffect(() => {
    const queries = [matchMedia(WIDE), matchMedia(NARROW)];
    const update = () => setLayout(currentLayout());
    queries.forEach(q => q.addEventListener('change', update));
    update();
    return () => queries.forEach(q => q.removeEventListener('change', update));
  }, []);
  return layout;
}

export function copyInvite(code: string) {
  void navigator.clipboard
    ?.writeText(urls.invite(code))
    .then(() => toast('邀请链接已复制，发给朋友即可加入。'))
    .catch(() => toast(`房间码：${code}`));
  if (!navigator.clipboard) toast(`房间码：${code}`);
}
