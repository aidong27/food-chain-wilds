import { SCORE, species } from '../game/data';
import type { GameView } from '../game/view';
import { survivedAs } from '../client/records';
import { leave, playAgain, useApp } from '../client/store';
import { Portrait, numeral } from './common';
import { showReview } from './dialogs';
import { Icon } from './icons';
import { Replay } from './Replay';

function download(view: GameView) {
  const blob = new Blob(
    [JSON.stringify({ game: '食物链', room: view.code, mode: view.mode, players: view.players, observations: view.log }, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `食物链-${view.code}-复盘.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What this match added to your records on this device. */
function RecordNote() {
  const { result, records } = useApp();
  if (!result) return null;
  const collected = survivedAs(records).length;
  const name = species(result.animal).name;
  return (
    <p class={`finish-record ${result.firstSurvival || result.newBest ? 'new' : ''}`}>
      <Icon name="award" size={17} />
      <span>
        {result.firstSurvival ? (
          <>
            生存图鉴新收录：<b>{name}</b>
          </>
        ) : result.survived ? (
          `又一次以${name}活到了最后`
        ) : (
          `以${name}活过七夜，就能把它收进生存图鉴`
        )}
        {` · 图鉴 ${collected}/8`}
        {result.newBest ? ' · 新的最高分！' : ` · 最高 ${records.best} 分`}
      </span>
    </p>
  );
}

export function Finish() {
  const { view } = useApp();
  const g = view!;
  const me = g.me!;
  const s = species(me.animal);
  const solo = g.mode === 'solo';
  const mine = g.players.find(p => p.id === me.id)!;
  const ranking = [...g.players].sort((a, b) => Number(b.alive) - Number(a.alive) || b.score! - a.score!);
  const guesses = Object.entries(me.guesses);
  const right = guesses.filter(([id, animal]) => g.players.find(p => p.id === id)?.animal === animal).length;
  const survivors = g.players.filter(p => p.alive).length;
  return (
    <main class="finish end-screen">
      <section class="finish-hero">
        <div class={`finish-portrait ${me.alive ? 'won' : 'lost'}`}>
          <Portrait animal={me.animal} face />
          <span class="chip">
            <Icon name={me.alive ? 'trophy' : 'death'} size={13} />
            {s.name}
          </span>
        </div>
        <div class="finish-copy">
          <p class="eyebrow">{me.alive ? '生存胜利' : `倒在第${numeral(me.diedRound ?? 0)}夜`}</p>
          <h1 class="brush">{me.alive ? '你听见了第八日的风。' : '荒野记得你的足迹。'}</h1>
          <p class="lead">
            {me.alive
              ? `作为${s.name}，你活过了全部七个回合。`
              : `你是${s.name}，在第 ${me.diedRound} 回合倒下。每一次选择，都为下一次生存留下了经验。`}
            本局共有 {survivors} 位居民活到最后。
          </p>
          <dl class="finish-stats">
            <div class="main">
              <dt>得分</dt>
              <dd>{mine.score}</dd>
            </div>
            <div>
              <dt>进食</dt>
              <dd>{me.meals}</dd>
            </div>
            <div>
              <dt>成功捕食</dt>
              <dd>{me.hunts}</dd>
            </div>
            <div>
              <dt>推理正确</dt>
              <dd>{guesses.length ? `${right}/${guesses.length}` : '—'}</dd>
            </div>
          </dl>
          <RecordNote />
          <div class="finish-actions">
            {solo && (
              <button class="btn primary large" onClick={playAgain}>
                <Icon name="again" size={18} />
                再来一局
              </button>
            )}
            <button class={`btn ${solo ? 'ghost' : 'primary'} large`} onClick={leave}>
              <Icon name="home" size={18} />
              {solo ? '返回首页' : '再入荒野'}
            </button>
            <button class="btn quiet" onClick={showReview}>
              <Icon name="journal" size={17} />
              完整记录
            </button>
            <button class="btn quiet" onClick={() => download(g)}>
              <Icon name="download" size={17} />
              下载复盘
            </button>
          </div>
        </div>
      </section>

      <section class="card ranking" aria-label="终局排名">
        <header class="section-head">
          <h2 class="brush">终局排名</h2>
          <span class="muted small">全部身份已揭晓</span>
        </header>
        <ol>
          {ranking.map((q, i) => {
            const animal = q.animal!;
            const guess = me.guesses[q.id];
            return (
              <li key={q.id} class={`rank-row ${q.id === me.id ? 'self' : ''} ${q.alive ? 'alive' : 'fallen'}`}>
                <span class="rank-no">{i + 1}</span>
                <Portrait animal={animal} face class="rank-face" />
                <span class="rank-who">
                  <b>
                    {q.name}
                    {q.id === me.id && <em>你</em>}
                  </b>
                  <small>
                    {q.seat} 号 · {species(animal).name}
                    {guess && (
                      <i class={guess === animal ? 'right' : 'wrong'}>
                        {guess === animal ? ' · 你猜对了' : ` · 你猜是${species(guess).name}`}
                      </i>
                    )}
                  </small>
                </span>
                <span class="rank-fate">
                  {q.alive ? (
                    <>
                      <Icon name="trophy" size={14} />
                      生存
                    </>
                  ) : (
                    `第 ${q.diedRound} 夜离开`
                  )}
                </span>
                <b class="rank-score">{q.score}</b>
              </li>
            );
          })}
        </ol>
        <p class="score-rule">
          得分 = 存活 {SCORE.alive} + 剩余生命 ×{SCORE.hp} + 进食 ×{SCORE.meal} + 捕食 ×{SCORE.hunt} + 推理正确 ×{SCORE.rightGuess} −
          推理错误（最低 0）
        </p>
      </section>

      <Replay view={g} />
    </main>
  );
}
