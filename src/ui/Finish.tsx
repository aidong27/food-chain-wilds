import { SCORE, species } from '../game/data';
import type { GameView } from '../game/view';
import { leave, playAgain, useApp } from '../client/store';
import { Avatar, pad } from './common';
import { showReview } from './dialogs';

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

export function Finish() {
  const { view } = useApp();
  const g = view!;
  const me = g.me!;
  const mine = g.players.find(p => p.id === me.id)!;
  const ranking = [...g.players].sort((a, b) => Number(b.alive) - Number(a.alive) || b.score! - a.score!);
  const guesses = Object.entries(me.guesses);
  const right = guesses.filter(([id, s]) => g.players.find(p => p.id === id)?.animal === s).length;
  return (
    <main class="end-screen">
      <span class="eyebrow gold">AFTER THE SEVENTH NIGHT</span>
      <h1>{me.alive ? '你听见了第八日的风。' : '荒野记得你的足迹。'}</h1>
      <p>{me.alive ? '你成功活过七个回合，获得生存胜利。' : `你在第 ${me.diedRound} 回合倒下。每一次选择，都为下一次生存留下了经验。`}</p>
      <div class="end-score">
        <Avatar animal={me.animal} />
        <div>
          <small>你的身份 · {species(me.animal).name}</small>
          <strong>
            {mine.score} <span>分</span>
          </strong>
          <p>
            {me.meals} 次进食 · {me.hunts} 次成功捕食{guesses.length ? ` · 推理 ${right}/${guesses.length} 正确` : ''}
          </p>
        </div>
      </div>
      <div class="ranking" role="table" aria-label="终局排名">
        <div class="ranking-head" role="row">
          <span>席位 / 玩家</span>
          <span>真实身份</span>
          <span>结局</span>
          <span>得分</span>
        </div>
        {ranking.map(q => {
          const myGuess = me.guesses[q.id];
          return (
            <div key={q.id} role="row" class={`ranking-row ${q.id === me.id ? 'self' : ''}`}>
              <span>
                <b>{pad(q.seat)}</b> {q.name}
                {q.id === me.id ? ' · 你' : ''}
              </span>
              <span>
                {species(q.animal!).name}
                {myGuess && (
                  <em class={myGuess === q.animal ? 'right' : 'wrong'}>
                    {myGuess === q.animal ? ' ✓' : ` ✗ 你猜${species(myGuess).name}`}
                  </em>
                )}
              </span>
              <span class={q.alive ? 'survived' : 'muted'}>{q.alive ? '生存胜利' : `第 ${q.diedRound} 回合离开`}</span>
              <strong>{q.score}</strong>
            </div>
          );
        })}
      </div>
      <p class="score-rule">
        得分 = 存活 {SCORE.alive} + 剩余 HP ×{SCORE.hp} + 进食 ×{SCORE.meal} + 捕食 ×{SCORE.hunt} + 推理正确 ×{SCORE.rightGuess} −
        推理错误（最低 0）
      </p>
      <div class="end-actions">
        {g.mode === 'solo' ? (
          <button class="primary" onClick={playAgain}>
            再来一局
          </button>
        ) : null}
        <button class={g.mode === 'solo' ? 'secondary' : 'primary'} onClick={leave}>
          {g.mode === 'solo' ? '返回首页' : '再入荒野'}
        </button>
        <button class="secondary" onClick={showReview}>
          查看完整记录
        </button>
        <button class="secondary" onClick={() => download(g)}>
          下载本局复盘
        </button>
      </div>
    </main>
  );
}
