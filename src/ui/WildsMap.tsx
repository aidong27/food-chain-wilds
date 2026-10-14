import { REGIONS, isAdjacent, region, type RegionId } from '../game/data';
import { visibleRegions, type GameView } from '../game/view';
import { select } from '../client/store';

interface Props {
  view: GameView | null;
  selected: RegionId;
  home?: boolean;
}

const PATHS = REGIONS.flatMap((r, i) => r.adjacent.filter(a => REGIONS.findIndex(x => x.id === a) > i).map(a => [r, region(a)] as const));

/** Seats that are publicly known to be somewhere this round. */
function dropsAt(view: GameView, id: RegionId) {
  return view.players.filter(p => p.alive && p.drop === id && p.id !== view.me?.id);
}

export function WildsMap({ view, selected, home }: Props) {
  const me = view?.me;
  const playing = !!view && !home && view.phase !== 'lobby';
  const located = playing && me && view.phase !== 'talk' && view.phase !== 'drop';
  const tracesShown = playing && Object.values(view.traces).some(t => t !== null);
  const sight = me && playing ? visibleRegions(me.location) : [];
  const moving = playing && view.phase === 'action' && me?.alive;
  const dropping = playing && view.phase === 'drop' && me?.alive;
  const title = home ? '七夜荒野' : '荒野地图';
  const subtitle = home ? '在每一道足迹里，寻找生存的可能。' : view?.event;

  return (
    <section class={`map-card ${home ? 'home' : ''}`} aria-label="六地区荒野地图">
      <header class="map-head">
        <div>
          <span class="eyebrow">THE WILDS</span>
          <h2>{title}</h2>
        </div>
        <p>{subtitle}</p>
      </header>
      <div class="map">
        <div class="map-layer">
          <div class="map-art" />
          <svg class="map-paths" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {PATHS.map(([a, b]) => (
              <line key={a.id + b.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            ))}
          </svg>
          {REGIONS.map(r => {
            const food = view ? view.resources[r.id] : r.fertile ? 1 : 0;
            const here = located && me?.location === r.id;
            const traces = view?.traces[r.id];
            const unseen = tracesShown && !sight.includes(r.id);
            const reachable = moving && me && isAdjacent(me.location, r.id);
            const chosen = dropping && me?.drop === r.id;
            const bodies = view?.bodies.filter(b => b.location === r.id).length || 0;
            const others = playing && view.phase !== 'drop' && view.phase !== 'talk' ? dropsAt(view, r.id) : [];
            const classes = [
              'pin',
              selected === r.id && 'selected',
              here && 'here',
              unseen && 'unseen',
              reachable && 'reachable',
              chosen && 'chosen',
            ]
              .filter(Boolean)
              .join(' ');
            const label = [
              r.name,
              food ? `${food} 份食物` : '没有食物',
              here ? '你在这里' : '',
              traces ? `${traces.length} 道痕迹` : '',
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
                aria-pressed={selected === r.id}
                onClick={() => select(r.id)}
              >
                <span class="pin-icon" aria-hidden="true">
                  {here ? '◉' : r.icon}
                </span>
                <span class="pin-card" aria-hidden="true">
                  <b>
                    {r.name}
                    {here && <i>你在这里</i>}
                    {chosen && <i>已选投放</i>}
                  </b>
                  <small>
                    {food ? <em class="food">✦ {food}</em> : <em class="none">无食物</em>}
                    {traces && <em class="trace">⌁ {traces.length}</em>}
                    {bodies > 0 && <em class="body">† {bodies}</em>}
                  </small>
                  {others.length > 0 && (
                    <span class="seats">
                      {others.map(p => (
                        <span key={p.id} class="seat-chip">
                          {p.seat}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <footer class="map-legend">
        <span>
          <i class="line-key" /> 相邻路线
        </span>
        <span>
          <em class="food">✦</em> 食物
        </span>
        {!home && (
          <>
            <span>
              <span class="seat-chip">3</span> 投放的席位
            </span>
            <span>
              <em class="trace">⌁</em> 痕迹 ≠ 实时位置
            </span>
          </>
        )}
      </footer>
    </section>
  );
}
