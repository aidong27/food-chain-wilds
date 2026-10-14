import { REGIONS, isAdjacent, region, type RegionId } from '../game/data';
import { visibleRegions, type GameView } from '../game/view';
import { getState, select, send } from '../client/store';
import { Portrait } from './common';
import { Icon, regionIcon } from './icons';

interface Props {
  view: GameView | null;
  selected: RegionId;
  /** A preview of the island outside a match. */
  home?: boolean;
  /** Fill the frame by cropping the sides (phones) instead of letterboxing. */
  cover?: boolean;
}

const PATHS = REGIONS.flatMap((r, i) => r.adjacent.filter(a => REGIONS.findIndex(x => x.id === a) > i).map(a => [r, region(a)] as const));

/**
 * Selecting a region on the map. While secretly dropping, choosing a region is
 * also your (still changeable) drop, so one tap is enough before locking in.
 */
export function pickRegion(id: RegionId) {
  select(id);
  const view = getState().view;
  const me = view?.me;
  if (view?.phase === 'drop' && me?.alive && !me.ready && me.drop !== id) send({ type: 'drop', region: id });
}

/** Seats that are publicly known to be somewhere this round. */
function dropsAt(view: GameView, id: RegionId) {
  return view.players.filter(p => p.alive && p.drop === id && p.id !== view.me?.id);
}

export function WildsMap({ view, selected, home, cover }: Props) {
  const me = view?.me ?? null;
  const playing = !!view && !home && !!me && view.phase !== 'lobby';
  const located = playing && view.phase !== 'talk' && view.phase !== 'drop';
  const tracesShown = playing && Object.values(view.traces).some(t => t !== null);
  const sight = located ? visibleRegions(me.location) : [];
  const moving = playing && view.phase === 'action' && me.alive && !me.ready && me.actions > 0;
  const dropping = playing && view.phase === 'drop' && me.alive;
  // A highlighted region only means something while choosing a place.
  const choosing = playing && (view.phase === 'drop' || view.phase === 'action' || view.phase === 'traces');
  const caption = home || !view ? '七夜荒野 · 六处地区彼此相连' : view.event;

  return (
    <section class={`map-stage ${cover ? 'cover' : ''}`} aria-label="荒野地图" data-tut="map">
      <div class="map-layer">
        <div class="map-art" />
        <svg class="map-paths" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {PATHS.map(([a, b]) => {
            const fromMe = moving && (a.id === me.location || b.id === me.location);
            const live = fromMe && (a.id === selected || b.id === selected);
            return <line key={a.id + b.id} class={live ? 'live' : ''} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </svg>
        {REGIONS.map(r => {
          const food = view ? view.resources[r.id] : r.fertile ? 1 : 0;
          const here = located && me.location === r.id;
          const chosen = dropping && me.drop === r.id;
          const traces = playing ? view.traces[r.id] : null;
          const unseen = tracesShown && !sight.includes(r.id);
          const reachable = moving && isAdjacent(me.location, r.id);
          const bodies = playing ? view.bodies.filter(b => b.location === r.id).length : 0;
          const others = located ? dropsAt(view, r.id) : [];
          const tag = here ? (me.alive ? '你在这里' : '倒下之处') : chosen ? '投放于此' : '';
          const classes = [
            'region',
            choosing && selected === r.id && 'is-selected',
            r.y > 75 && 'is-low',
            here && 'is-here',
            chosen && 'is-chosen',
            unseen && 'is-unseen',
            reachable && 'is-reachable',
          ]
            .filter(Boolean)
            .join(' ');
          const label = [
            r.name,
            food ? `${food} 份食物` : '没有食物',
            tag,
            reachable ? '可移动到这里' : '',
            traces?.length ? `${traces.length} 道足迹` : '',
            bodies ? `${bodies} 份遗骸` : '',
            others.length ? `投放于此：${others.map(p => `${p.seat}号`).join('、')}` : '',
          ]
            .filter(Boolean)
            .join('，');
          return (
            <button
              key={r.id}
              class={classes}
              style={{ left: `${r.x}%`, top: `${r.y}%` }}
              aria-label={label}
              aria-pressed={choosing ? selected === r.id : undefined}
              onClick={() => pickRegion(r.id)}
            >
              <span class="region-dot">
                {(here || chosen) && me ? <Portrait animal={me.animal} face /> : <Icon name={regionIcon(r.id)} size={22} />}
                {tag && <span class="region-tag">{tag}</span>}
              </span>
              <span class="region-name">{r.name}</span>
              <span class="region-meta">
                {food > 0 ? (
                  <span class="mark food">
                    <Icon name="forage" size={12} />
                    {food}
                  </span>
                ) : (
                  <span class="mark none">无食物</span>
                )}
                {!!traces?.length && (
                  <span class="mark trace">
                    <Icon name="move" size={12} />
                    {traces.length}
                  </span>
                )}
                {bodies > 0 && (
                  <span class="mark body">
                    <Icon name="scavenge" size={12} />
                    {bodies}
                  </span>
                )}
                {others.map(p => (
                  <span key={p.id} class="seat">
                    {p.seat}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <p class="map-caption">
        <Icon name="round" size={14} />
        {caption}
      </p>
      {!cover && (
        <div class="map-legend" aria-hidden="true">
          <span>
            <i class="line-key" />
            相邻路线
          </span>
          <span>
            <Icon name="forage" size={13} class="food" />
            食物
          </span>
          {!home && (
            <>
              <span>
                <span class="seat">3</span>
                投放席位
              </span>
              <span>
                <Icon name="move" size={13} class="trace" />
                足迹不等于实时位置
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
