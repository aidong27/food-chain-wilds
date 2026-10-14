import { useState } from 'preact/hooks';
import { REGIONS, region, species } from '../game/data';
import type { NightPlayer } from '../game/types';
import type { GameView, PlayerSummary } from '../game/view';
import { Portrait, numeral, playerById } from './common';
import { Icon } from './icons';

const who = (p: PlayerSummary) => `${p.seat}号${p.name}（${species(p.animal!).name}）`;

/**
 * Once the match is over, every night can be replayed as it really happened:
 * where each animal stood when food was served, who bit whom and who ate.
 */
export function Replay({ view }: { view: GameView }) {
  const nights = view.history ?? [];
  const me = view.me!;
  // Start on the night you fell, otherwise at the beginning.
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      nights.findIndex(n => n.players.some(p => p.id === me.id && !p.alive)),
    ),
  );
  if (!nights.length) return null;
  const night = nights[Math.min(index, nights.length - 1)];
  const bitten = new Set(night.hunts.map(h => h.prey));
  const deaths = view.log.filter(l => l.tag === 'death' && l.round === night.round);
  const fed = night.players.filter(p => p.fed).map(p => playerById(view, p.id)!);
  const mine = night.players.find(p => p.id === me.id);

  const face = (np: NightPlayer) => {
    const p = playerById(view, np.id)!;
    const state = [np.id === me.id && 'me', !np.alive && 'dead', bitten.has(np.id) && 'bitten', np.fed && 'fed'].filter(Boolean).join(' ');
    return (
      <span key={np.id} class={`rp-face ${state}`} title={who(p)}>
        <Portrait animal={p.animal!} face />
        <em>{p.seat}</em>
      </span>
    );
  };

  return (
    <section class="card replay" aria-labelledby="replay-title">
      <header class="section-head">
        <h2 class="brush" id="replay-title">
          真相回放
        </h2>
        <span class="muted small">进食时每个人真正的位置</span>
      </header>
      <div class="replay-nights" role="tablist" aria-label="选择夜晚">
        {nights.map((n, i) => (
          <button key={n.round} role="tab" aria-selected={i === index} class={i === index ? 'on' : ''} onClick={() => setIndex(i)}>
            {numeral(n.round)}
          </button>
        ))}
      </div>
      <div class="replay-body">
        <div class="replay-map" role="img" aria-label={`第${numeral(night.round)}夜的站位`}>
          <div class="map-art" />
          {REGIONS.map(r => {
            const here = night.players.filter(p => p.location === r.id);
            if (!here.length) return null;
            return (
              <div key={r.id} class="rp-spot" style={{ left: `${r.x}%`, top: `${r.y}%` }}>
                <span class="rp-faces">{here.map(face)}</span>
                <span class="rp-name">{r.short}</span>
              </div>
            );
          })}
        </div>
        <ul class="replay-events">
          {mine && (
            <li class="mine">
              <Icon name="eye" size={16} />
              <span>
                你从{region(mine.drop ?? mine.location).name}出发，最后停在{region(mine.location).name}，
                {mine.fed ? '吃到了东西。' : '没有吃到东西。'}
              </span>
            </li>
          )}
          {night.hunts.map((h, i) => {
            const hunter = playerById(view, h.hunter)!;
            const prey = playerById(view, h.prey)!;
            const at = night.players.find(p => p.id === h.hunter)?.location;
            return (
              <li key={i} class="bad">
                <Icon name="hit" size={16} />
                <span>
                  {who(hunter)}在{at ? region(at).name : '荒野'}咬了{who(prey)}，生命 −{h.damage}。
                </span>
              </li>
            );
          })}
          {deaths.map(l => (
            <li key={l.id} class="bad">
              <Icon name="death" size={16} />
              <span>{l.text}</span>
            </li>
          ))}
          <li class="good">
            <Icon name="fed" size={16} />
            <span>{fed.length ? `吃到东西：${fed.map(p => `${p.seat}号`).join('、')}。` : '这一夜没有人吃到东西。'}</span>
          </li>
          {!night.hunts.length && !deaths.length && (
            <li class="quiet">
              <Icon name="round" size={16} />
              <span>这一夜没有捕食，也没有人倒下。</span>
            </li>
          )}
        </ul>
      </div>
      <p class="replay-key">
        <span class="rp-face fed" />
        吃到东西
        <span class="rp-face bitten" />
        被咬
        <span class="rp-face dead" />
        当夜倒下
      </p>
    </section>
  );
}
