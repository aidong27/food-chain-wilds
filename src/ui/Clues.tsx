import { SPECIES } from '../game/data';
import type { GameView } from '../game/view';
import { Portrait, claimsFrom } from './common';
import { showPlayer } from './dialogs';
import { Icon } from './icons';

/**
 * Who claims to be which animal. Every animal lives on the island exactly once,
 * so two claimants, or a claim to an animal already known, means someone lies.
 */
export function ClueBoard({ view }: { view: GameView }) {
  const me = view.me!;
  const claims = claimsFrom(view);
  const rows = SPECIES.map(s => {
    const holder = view.players.find(p => p.animal === s.id) ?? null;
    const claimants = view.players.filter(p => p.alive && p.id !== me.id && p.id !== holder?.id && claims.get(p.id) === s.id);
    const guessed = view.players.filter(p => p.alive && me.guesses[p.id] === s.id && !claimants.includes(p));
    const state = holder && claimants.length ? 'liar' : claimants.length > 1 ? 'clash' : '';
    return { s, holder, claimants, guessed, state };
  });
  return (
    <section class="clues" data-tut="clues" aria-labelledby="clues-title">
      <header class="clues-head">
        <Icon name="clues" size={16} />
        <b id="clues-title">线索板</b>
        <small>每种动物只有一只：撞了身份，就有人在说谎</small>
      </header>
      <ul class="clue-grid">
        {rows.map(({ s, holder, claimants, guessed, state }) => (
          <li key={s.id} class={`clue ${state} ${holder?.id === me.id ? 'mine' : ''}`}>
            <Portrait animal={s.id} face class="clue-face" />
            <div class="clue-body">
              <b>{s.name}</b>
              <span class="clue-who">
                {holder && (
                  <span class={`clue-tag ${holder.id === me.id ? 'self' : 'dead'}`}>
                    {holder.id === me.id ? '你' : `${holder.seat}号已死`}
                  </span>
                )}
                {claimants.map(p => (
                  <button key={p.id} class="seat" onClick={() => showPlayer(p.id)} aria-label={`${p.seat} 号自称${s.name}，查看`}>
                    {p.seat}
                  </button>
                ))}
                {guessed.map(p => (
                  <button
                    key={p.id}
                    class="seat guessed"
                    onClick={() => showPlayer(p.id)}
                    aria-label={`你推理 ${p.seat} 号是${s.name}，查看`}
                  >
                    {p.seat}
                  </button>
                ))}
                {!holder && !claimants.length && !guessed.length && <small>无人认领</small>}
              </span>
            </div>
            {state && (
              <em class="clue-flag">
                <Icon name="warning" size={12} />
                {state === 'liar' ? '冒名' : '冲突'}
              </em>
            )}
          </li>
        ))}
      </ul>
      <p class="clues-key">
        <span class="seat">3</span>自称 <span class="seat guessed">5</span>你的推理 · 点席位查看并记录推理
      </p>
    </section>
  );
}
