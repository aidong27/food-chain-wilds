import type { ComponentChildren } from 'preact';
import { SPECIES, species, type SpeciesId } from '../game/data';
import type { GameView, PlayerSummary, ViewEntry } from '../game/view';
import { parseStatement } from '../game/bots/language';

export function Avatar({ animal, class: cls = '', label = true }: { animal: SpeciesId; class?: string; label?: boolean }) {
  const index = SPECIES.findIndex(s => s.id === animal);
  return (
    <div
      class={`animal-art ${cls}`}
      style={{ '--col': index % 4, '--row': Math.floor(index / 4) }}
      role={label ? 'img' : undefined}
      aria-label={label ? species(animal).name : undefined}
      aria-hidden={label ? undefined : 'true'}
    />
  );
}

export const pad = (n: number) => String(n).padStart(2, '0');

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

const TAG_ICON: Partial<Record<NonNullable<ViewEntry['tag']>, string>> = {
  round: '☾',
  reveal: '◎',
  death: '†',
  finish: '✦',
  move: '↗',
  hide: '◇',
  scream: '≋',
  skill: '◈',
  overdraw: 'ϟ',
  'food-attempt': '⌁',
  hit: '⚔',
  attacked: '✖',
  miss: '○',
  fed: '✦',
  starved: '○',
  hunger: '◌',
};

export function entryIcon(entry: ViewEntry): string {
  if (entry.kind === 'public') return '❝';
  if (entry.kind === 'private') return '✉';
  return (entry.tag && TAG_ICON[entry.tag]) || '·';
}

export function entryTone(entry: ViewEntry): string {
  switch (entry.tag) {
    case 'attacked':
    case 'death':
    case 'hunger':
    case 'overdraw':
      return 'bad';
    case 'fed':
    case 'hit':
      return 'good';
    default:
      return entry.kind === 'clue' ? 'clue' : '';
  }
}

export function Field({ label, children, for: htmlFor }: { label: string; children: ComponentChildren; for?: string }) {
  return (
    <>
      <label class="field-label" for={htmlFor}>
        {label}
      </label>
      {children}
    </>
  );
}

export function Meter({ value, max, kind }: { value: number; max: number; kind: 'hp' | 'sp' }) {
  return (
    <div
      class={`meter ${kind}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={kind === 'hp' ? '生命' : '体力'}
    >
      {Array.from({ length: max }, (_, i) => (
        <i key={i} class={i < value ? 'on' : ''} />
      ))}
    </div>
  );
}
