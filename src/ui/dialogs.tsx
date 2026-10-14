import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useReducer, useRef } from 'preact/hooks';
import { RULES, SPECIES, region, species, type SpeciesId } from '../game/data';
import { getState, leave, send, useApp } from '../client/store';
import { Avatar, claimsFrom, dietText, playerById, seatName } from './common';

interface DialogSpec {
  title: string;
  body: () => JSX.Element;
  wide?: boolean;
}

let current: DialogSpec | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function openDialog(spec: DialogSpec) {
  current = spec;
  emit();
}

export function closeDialog() {
  current = null;
  emit();
}

export function DialogHost() {
  const [, force] = useReducer((n: number, _: void) => n + 1, 0);
  useEffect(() => {
    const listener = () => force();
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  useApp(); // re-render dialog contents when the game changes
  return current ? <Modal spec={current} /> : null;
}

function Modal({ spec }: { spec: DialogSpec }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    const onClose = () => closeDialog();
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, [spec]);
  return (
    <dialog ref={ref} class={spec.wide ? 'wide' : ''} onClick={e => e.target === ref.current && ref.current?.close()}>
      <div class="dialog-top">
        <h2>{spec.title}</h2>
        <button class="icon-button" aria-label="关闭" onClick={() => ref.current?.close()}>
          ×
        </button>
      </div>
      <div class="dialog-content">
        <spec.body />
      </div>
    </dialog>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function showRules() {
  openDialog({ title: '生存手册', wide: true, body: RulesBody });
}

function RulesBody() {
  return (
    <>
      <div class="quickstart">
        <h3>60 秒上手</h3>
        <ol>
          <li>
            <b>你是谁</b>：开局随机成为 8 种动物之一，身份只有你知道。
          </li>
          <li>
            <b>每回合</b>：交流 → 秘密投放到一个地区 → 2 次行动 → 获取食物 → 结算饥饿。
          </li>
          <li>
            <b>看投放</b>：全员锁定后投放位置公开。谁和你在一起？谁可能吃掉你？
          </li>
          <li>
            <b>活下来</b>：第 7 回合结束时仍存活，就是生存赢家。
          </li>
        </ol>
      </div>
      <div class="rule-grid">
        <Section title="01 · 生存资源">
          <p>
            生命归零即死亡。食物只恢复体力（SP），绝不恢复生命（HP）。体力为 0 时继续行动：失去 1
            HP，体力恢复至上限的一半（向上取整），再支付本次 1 SP。若因此死亡，行动失败。
          </p>
        </Section>
        <Section title="02 · 回合流程">
          <p>
            交流 → 秘密投放 → 2 次行动 → 痕迹观察 → 依次通话 → 获取食物 →
            饥饿结算。单人练习没有其他真人，跳过痕迹与通话两个阶段（痕迹在获取食物时查看），由你掌握节奏；联机全员准备或倒计时结束时推进。
          </p>
        </Section>
        <Section title="03 · 痕迹与位置">
          <p>
            投放在全员锁定后公开，之后的移动只在出发地与目的地留下痕迹。你只能看到所在地区及相邻地区的痕迹。躲藏会抹除当前地区的足迹，但挡不住捕食。痕迹每回合清空。
          </p>
        </Section>
        <Section title="04 · 食物与饥饿">
          <p>
            地图食物每回合 {RULES.resourcesByRound.slice(0, 2).join(' / ')} → {RULES.resourcesByRound[2]} → {RULES.resourcesByRound[5]}{' '}
            份，轮流出现在四个肥沃地区，每处每回合最多一份。获取食物消耗 1
            SP，无论成败都会向同地区玩家暴露。按席位轮换先手结算。连续未进食达到饥饿周期后，每回合扣 1 HP，直到进食。
          </p>
        </Section>
        <Section title="05 · 捕食与遗骸">
          <p>
            捕食只能命中同地区、在你食谱中的动物。机会捕食随机选一个合格目标，指定目标不在场就落空。命中即进食，无需击杀。死亡留下一份遗骸，保留{' '}
            {RULES.bodyRounds} 个回合，可被食腐动物吃掉。
          </p>
        </Section>
        <Section title="06 · 交流与谎言">
          <p>
            每回合 {RULES.privateMessages} 条私信、{RULES.publicMessages} 条公开消息，每条最多 {RULES.messageLength}{' '}
            字。电脑玩家会说真话，也会撒谎：捕食者常冒充草食动物。被咬的动物会当众指认凶手；死者的身份会揭穿冒名者。
          </p>
        </Section>
        <Section title="07 · 推理笔记">
          <p>点击居民为 Ta 标记身份，只有你能看见。终局时每个正确判断 +2 分、错误 −1 分。得分只用于比较表现，活下来本身就是胜利。</p>
        </Section>
        <Section title="08 · 联机与观战">
          <p>
            联机房间最多 8
            人，空位由电脑补齐；支持公共语音和私下通话（浏览器点对点，不录音）。同一标签页刷新可重连。死亡后进入观战，仍只看到自己的局部线索。房间
            24 小时后清除。
          </p>
        </Section>
      </div>
    </>
  );
}

export function showBestiary(only?: SpeciesId) {
  openDialog({ title: only ? species(only).name : '动物图鉴', wide: !only, body: () => <BestiaryBody only={only} /> });
}

function BestiaryBody({ only }: { only?: SpeciesId }) {
  return (
    <div class={`animal-grid ${only ? 'single' : ''}`}>
      {SPECIES.filter(s => !only || s.id === only).map(s => (
        <article key={s.id}>
          <Avatar animal={s.id} />
          <div>
            <h3>
              {s.name}
              <small>{s.title}</small>
            </h3>
            <p class="stats">
              HP {s.hp} · SP {s.sp} · 饥饿周期 {s.hunger} 回合{s.damage ? ` · 伤害 ${s.damage}` : ''}
            </p>
            <b>
              {s.skill} <small>· 1 SP</small>
            </b>
            <p>{s.skillText}</p>
            <small class="diet">{dietText(s.id)}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

export function showPlayer(id: string) {
  const p = playerById(getState().view!, id);
  if (!p) return;
  openDialog({ title: `${p.seat} 号 · ${p.name}`, body: () => <PlayerBody id={id} /> });
}

function PlayerBody({ id }: { id: string }) {
  const { view } = useApp();
  if (!view) return <p>对局已结束。</p>;
  const p = playerById(view, id)!;
  const me = view.me!;
  const claim = claimsFrom(view).get(id);
  const related = view.log.filter(l => [l.actor, l.target, l.from].includes(id) && l.kind !== 'public' && l.kind !== 'private').slice(-6);
  const canGuess = p.id !== me.id && p.alive && me.alive;
  return (
    <div class="player-detail">
      <div class="who">
        {p.animal ? <Avatar animal={p.animal} /> : <div class="animal-art unknown">?</div>}
        <div>
          <p>{p.animal ? `已知身份：${species(p.animal).name}` : 'Ta 的身份仍然未知。结合痕迹、进食与交流，记下你的判断。'}</p>
          {claim && !p.animal && <p class="muted">自称：{species(claim).name}（可能是谎言）</p>}
          {p.drop && <p class="muted">本回合投放：{region(p.drop).name}。之后可能已经移动。</p>}
          {!p.alive && <p class="muted">已在第 {p.diedRound} 回合离开荒野。</p>}
        </div>
      </div>
      {canGuess && (
        <>
          <label class="field-label" for="guess">
            我的身份推理 · 仅你可见
          </label>
          <select
            id="guess"
            value={me.guesses[id] || ''}
            onChange={e => send({ type: 'guess', target: id, animal: (e.target as HTMLSelectElement).value as SpeciesId | '' })}
          >
            <option value="">暂不判断</option>
            {SPECIES.filter(s => s.id !== me.animal).map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p class="muted small">终局时正确 +2 分，错误 −1 分。</p>
        </>
      )}
      {related.length > 0 && (
        <>
          <h3>与 Ta 有关的记录</h3>
          <ul class="related">
            {related.map(l => (
              <li key={l.id}>
                <small>R{l.round}</small> {l.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function confirmLeave() {
  const view = getState().view;
  if (!view || view.phase === 'lobby' || view.phase === 'finished') return leave();
  openDialog({
    title: '离开这场对局？',
    body: () => (
      <>
        <p>{view.mode === 'solo' ? '离开后这局练习会被放弃。' : '离开后你的席位由电脑托管，这局仍会继续。'}</p>
        <div class="dialog-actions">
          <button class="secondary" onClick={closeDialog}>
            继续游戏
          </button>
          <button
            class="primary"
            onClick={() => {
              closeDialog();
              leave();
            }}
          >
            返回首页
          </button>
        </div>
      </>
    ),
  });
}

export function showReview() {
  openDialog({
    title: '本局观察记录',
    wide: true,
    body: () => {
      const view = getState().view!;
      return (
        <div class="review">
          {view.log.map(l => (
            <article key={l.id} class={`log-entry ${l.kind}`}>
              <small>
                第 {l.round} 回合 ·{' '}
                {l.kind === 'private'
                  ? `私信 ${seatName(view, l.from)} → ${seatName(view, l.to)}`
                  : l.kind === 'public'
                    ? `公开 · ${seatName(view, l.from)}`
                    : '观察'}
              </small>
              <p>{l.text}</p>
            </article>
          ))}
        </div>
      );
    },
  });
}
