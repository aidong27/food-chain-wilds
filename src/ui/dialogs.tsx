import type { ComponentChildren, JSX } from 'preact';
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useReducer, useRef } from 'preact/hooks';
import { RULES, SPECIES, predatorsOf, region, species, type Diet, type SpeciesId } from '../game/data';
import { TUTORIAL_SEATS } from '../game/tutorial';
import { getState, leave, markTutorial, send, startTutorial, toggleSound, useApp } from '../client/store';
import { Portrait, RoundDivider, byRound, claimsFrom, copyInvite, dietText, entryTone, numeral, playerById, seatName } from './common';
import { Icon, entryIcon, type IconName } from './icons';

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
  // Opened in the same task as the tap that asked for it, so Chrome lets the very first Esc close it.
  useLayoutEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    const onClose = () => closeDialog();
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, [spec]);
  return (
    <dialog
      ref={ref}
      class={spec.wide ? 'wide' : ''}
      aria-labelledby="dialog-title"
      onClick={e => e.target === ref.current && ref.current?.close()}
    >
      <div class="dialog-top">
        <h2 id="dialog-title">{spec.title}</h2>
        <button class="icon-btn" aria-label="关闭" onClick={() => ref.current?.close()}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div class="dialog-content">
        <spec.body />
      </div>
    </dialog>
  );
}

const DIET: Record<Diet, string> = { hunt: '捕食者', plant: '草食', scavenge: '食腐' };

// ------------------------------------------------------------------ rules

function Rule({ icon, title, children }: { icon: IconName; title: string; children: ComponentChildren }) {
  return (
    <section class="rule">
      <h3>
        <span>
          <Icon name={icon} size={17} />
        </span>
        {title}
      </h3>
      <p>{children}</p>
    </section>
  );
}

export function showRules() {
  openDialog({ title: '生存手册', wide: true, body: RulesBody });
}

function RulesBody() {
  const { link } = useApp();
  return (
    <>
      {!link && (
        <div class="tutorial-callout">
          <Icon name="tutorial" size={20} />
          <p>
            <b>不想读规则？</b>跟着新手教程玩两夜，3 分钟就能上手。
          </p>
          <button
            class="btn primary"
            onClick={() => {
              closeDialog();
              startTutorial();
            }}
          >
            开始教程
          </button>
        </div>
      )}
      <div class="quickstart">
        <h3 class="brush">六十秒上手</h3>
        <ol>
          <li>
            <b>你是谁</b>
            <span>开局随机成为 8 种动物之一，身份只有你知道。</span>
          </li>
          <li>
            <b>每回合</b>
            <span>交流与投放 → 2 次行动 → 获取食物 → 天亮结算。</span>
          </li>
          <li>
            <b>看投放</b>
            <span>全员锁定后投放位置公开。谁和你在一起？谁可能吃掉你？</span>
          </li>
          <li>
            <b>活下来</b>
            <span>第 7 回合结束时仍存活，就是生存赢家。</span>
          </li>
        </ol>
      </div>
      <div class="rule-grid">
        <Rule icon="hp" title="生存资源">
          生命归零即死亡。食物只恢复体力（SP），绝不恢复生命（HP）。体力为 0 时继续行动：失去 1
          生命，体力恢复至上限的一半（向上取整），再支付本次 1 SP。若因此死亡，行动失败。
        </Rule>
        <Rule icon="round" title="回合流程">
          交流与投放（边听营地发言边选起点）→ 2 次行动（用完自动结束）→ 依次通话（仅联机且有其他真人时）→ 获取食物（这时能看到身边的足迹）→
          天亮结算。单人练习由你掌握节奏；联机时全员准备或倒计时结束就推进，其他人都准备好后，最后一位最多再等 {RULES.lastCallSeconds} 秒。
        </Rule>
        <Rule icon="move" title="痕迹与位置">
          投放在全员锁定后公开，之后的移动只在出发地与目的地留下足迹。你只能看到所在地区及相邻地区的足迹。躲藏会抹除当前地区的足迹，但挡不住捕食。足迹每回合清空。
        </Rule>
        <Rule icon="food" title="食物与饥饿">
          地图食物每回合 {RULES.resourcesByRound.slice(0, 2).join(' / ')} → {RULES.resourcesByRound[2]} → {RULES.resourcesByRound[5]}{' '}
          份，轮流出现在四个肥沃地区，每处每回合最多一份。获取食物消耗 1
          SP，无论成败都会向同地区玩家暴露，按席位轮换先手结算。连续未进食达到饥饿周期后，每回合失去 1 生命，直到进食。
        </Rule>
        <Rule icon="hunt" title="捕食与遗骸">
          捕食只能命中同地区、在你食谱中的动物。机会捕食随机选一个合格目标，指定目标不在场就落空。命中即进食，无需击杀。死亡留下一份遗骸，保留{' '}
          {RULES.bodyRounds} 个回合，可被食腐动物吃掉。
        </Rule>
        <Rule icon="public" title="交流与谎言">
          每回合 {RULES.privateMessages} 条私信、{RULES.publicMessages} 条公开消息，每条最多 {RULES.messageLength}{' '}
          字。电脑玩家会说真话，也会撒谎：捕食者常冒充草食动物。被咬的动物会当众指认凶手；死者的身份会揭穿冒名者。
        </Rule>
        <Rule icon="journal" title="推理笔记">
          点击居民为 Ta 标记身份，只有你能看见。终局时每个正确判断 +2 分、错误 −1 分。得分只用于比较表现，活下来本身就是胜利。
        </Rule>
        <Rule icon="people" title="联机与观战">
          联机房间最多 8
          人，空位由电脑补齐；支持公共语音和私下通话（浏览器点对点，不录音）。同一标签页刷新可重连。死亡后进入观战，仍只看到自己的局部线索。房间
          24 小时后清除。
        </Rule>
      </div>
    </>
  );
}

// --------------------------------------------------------------- bestiary

export function showBestiary(only?: SpeciesId) {
  openDialog({ title: only ? species(only).name : '动物图鉴', wide: !only, body: () => <BestiaryBody only={only} /> });
}

function BestiaryBody({ only }: { only?: SpeciesId }) {
  return (
    <div class={`beasts ${only ? 'single' : ''}`}>
      {SPECIES.filter(s => !only || s.id === only).map(s => {
        const hunters = predatorsOf(s.id);
        return (
          <article key={s.id} class="beast">
            <Portrait animal={s.id} face class="beast-art" />
            <div class="beast-body">
              <header>
                <h3 class="brush">{s.name}</h3>
                <em class={`diet ${s.diet}`}>{DIET[s.diet]}</em>
              </header>
              <small class="beast-title">{s.title}</small>
              <dl class="beast-stats">
                <div>
                  <dt>
                    <Icon name="hp" size={13} />
                    生命
                  </dt>
                  <dd>{s.hp}</dd>
                </div>
                <div>
                  <dt>
                    <Icon name="sp" size={13} />
                    体力
                  </dt>
                  <dd>{s.sp}</dd>
                </div>
                <div>
                  <dt>
                    <Icon name="hunger" size={13} />
                    饥饿周期
                  </dt>
                  <dd>{s.hunger}</dd>
                </div>
                {s.damage > 0 && (
                  <div>
                    <dt>
                      <Icon name="hit" size={13} />
                      伤害
                    </dt>
                    <dd>{s.damage}</dd>
                  </div>
                )}
              </dl>
              <p class="beast-skill">
                <Icon name="skill" size={14} />
                <span>
                  <b>{s.skill}</b> · 1 SP · {s.skillText}
                </span>
              </p>
              <p class="beast-diet">{dietText(s.id)}</p>
              {hunters.length > 0 && <p class="beast-danger">天敌：{hunters.map(h => species(h).name).join('、')}</p>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------- player

export function showPlayer(id: string) {
  const p = playerById(getState().view!, id);
  if (!p) return;
  openDialog({ title: `${numeral(p.seat)}号 · ${p.name}`, body: () => <PlayerBody id={id} /> });
}

function PlayerBody({ id }: { id: string }) {
  const { view, tutorial } = useApp();
  if (!view) return <p>对局已结束。</p>;
  const p = playerById(view, id)!;
  const me = view.me!;
  const coached = tutorial?.id === 'mark' && p.seat === TUTORIAL_SEATS.wolf;
  const claim = claimsFrom(view).get(id);
  const related = view.log.filter(l => [l.actor, l.target, l.from].includes(id) && l.kind !== 'public' && l.kind !== 'private').slice(-6);
  const canGuess = p.id !== me.id && p.alive && me.alive;
  const guess = me.guesses[id] || '';
  const setGuess = (animal: SpeciesId | '') => send({ type: 'guess', target: id, animal });
  return (
    <div class="player-detail">
      <div class="who">
        {p.animal ? (
          <Portrait animal={p.animal} face class="who-face" />
        ) : (
          <span class="who-face unknown">
            <Icon name="unknown" size={30} />
          </span>
        )}
        <div>
          <p>
            {p.id === me.id
              ? `这是你：${species(me.animal).name}。`
              : p.animal
                ? `已知身份：${species(p.animal).name}`
                : 'Ta 的身份仍然未知。结合足迹、进食与交流，记下你的判断。'}
          </p>
          {claim && !p.animal && <p class="muted">自称：{species(claim).name}（可能是谎言）</p>}
          {p.drop && <p class="muted">本回合投放：{region(p.drop).name}。之后可能已经移动。</p>}
          {!p.alive && <p class="muted">已在第 {p.diedRound} 回合离开荒野。</p>}
        </div>
      </div>
      {canGuess && (
        <div class="field">
          {coached && (
            <p class="tutorial-callout compact">
              <Icon name="tutorial" size={17} />
              <span>
                <b>新手教程</b> · 选择「灰狼」：4 号的指认说明了一切。
              </span>
            </p>
          )}
          <span id="guess-label">我的身份推理 · 仅你可见</span>
          <div class="guess-picker" role="radiogroup" aria-labelledby="guess-label">
            <button role="radio" aria-checked={!guess} class={`guess-opt ${!guess ? 'on' : ''}`} onClick={() => setGuess('')}>
              <span class="guess-face">
                <Icon name="unknown" size={20} />
              </span>
              暂不判断
            </button>
            {SPECIES.filter(s => s.id !== me.animal).map(s => (
              <button
                key={s.id}
                role="radio"
                aria-checked={guess === s.id}
                class={`guess-opt ${guess === s.id ? 'on' : ''} ${coached && s.id === 'wolf' && guess !== s.id ? 'tut-pick' : ''}`}
                onClick={() => setGuess(s.id)}
              >
                <Portrait animal={s.id} face class="guess-face" />
                {s.name}
              </button>
            ))}
          </div>
          <small class="hint">终局时正确 +2 分，错误 −1 分。</small>
        </div>
      )}
      {related.length > 0 && (
        <div class="related">
          <h3 class="brush">与 Ta 有关的记录</h3>
          <ul>
            {related.map(l => (
              <li key={l.id} class={`jentry ${entryTone(l)}`}>
                <span class="jicon">
                  <Icon name={entryIcon(l)} size={14} />
                </span>
                <p>
                  <small>第 {l.round} 夜</small> {l.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- welcome

/** Offered once, on the first visit: a guided first match or straight into the game. */
export function showWelcome(returning: boolean) {
  markTutorial('offered');
  openDialog({ title: returning ? '新手教程上线了' : '初入荒野', body: () => <WelcomeBody returning={returning} /> });
}

function WelcomeBody({ returning }: { returning: boolean }) {
  return (
    <div class="welcome">
      <div class="welcome-cast" aria-hidden="true">
        <Portrait animal="rabbit" face />
        <Portrait animal="deer" face />
        <Portrait animal="wolf" face />
      </div>
      <p class="lead-text">
        {returning ? '想重温规则，或者带朋友入门？' : '第一次来到荒野？'}
        跟着向导走完前两夜，大约 3 分钟，之后这一局可以接着玩下去。
      </p>
      <ul class="welcome-list">
        <li>
          <Icon name="clues" size={18} />
          <span>
            <b>识破谎言</b>谁在冒充别的动物？
          </span>
        </li>
        <li>
          <Icon name="drop" size={18} />
          <span>
            <b>投放与行动</b>去哪里，怎样躲开天敌
          </span>
        </li>
        <li>
          <Icon name="food" size={18} />
          <span>
            <b>进食与饥饿</b>怎样撑过七个夜晚
          </span>
        </li>
      </ul>
      <div class="dialog-actions">
        <button
          class="btn ghost"
          onClick={() => {
            markTutorial('skipped');
            closeDialog();
          }}
        >
          {returning ? '以后再说' : '我会玩，直接开始'}
        </button>
        <button
          class="btn primary"
          onClick={() => {
            closeDialog();
            startTutorial();
          }}
        >
          开始新手教程
          <Icon name="next" size={17} />
        </button>
      </div>
      <p class="welcome-foot">随时可以在首页重新打开教程。</p>
    </div>
  );
}

// ------------------------------------------------------------------ leave

export function confirmLeave() {
  const view = getState().view;
  if (!view || view.phase === 'lobby' || view.phase === 'finished') return leave();
  openDialog({
    title: '离开这场对局？',
    body: () => (
      <>
        <p class="lead-text">{view.mode === 'solo' ? '离开后这局练习会被放弃。' : '离开后你的席位由电脑托管，这局仍会继续。'}</p>
        <div class="dialog-actions">
          <button class="btn ghost" onClick={closeDialog}>
            继续游戏
          </button>
          <button
            class="btn primary"
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

// ----------------------------------------------------------------- review

export function showReview() {
  openDialog({
    title: '本局完整记录',
    wide: true,
    body: () => {
      const view = getState().view!;
      return (
        <div class="review">
          {byRound(view.log).map(group => (
            <Fragment key={group.round}>
              <RoundDivider round={group.round} />
              {group.entries.map(l => (
                <article key={l.id} class={`jentry ${entryTone(l)} ${l.kind}`}>
                  <span class="jicon">
                    <Icon name={entryIcon(l)} size={14} />
                  </span>
                  <p>
                    {(l.kind === 'private' || l.kind === 'public') && (
                      <small>
                        {l.kind === 'private'
                          ? `私信 ${seatName(view, l.from)} → ${seatName(view, l.to)}`
                          : `公开 · ${seatName(view, l.from)}`}
                      </small>
                    )}
                    {l.text}
                  </p>
                </article>
              ))}
            </Fragment>
          ))}
        </div>
      );
    },
  });
}

// ------------------------------------------------------------------- menu

export function showMenu() {
  openDialog({ title: '菜单', body: MenuBody });
}

function MenuBody() {
  const { view, sound, connected } = useApp();
  return (
    <div class="menu-list">
      {view?.mode === 'online' && (
        <button class="menu-item" onClick={() => copyInvite(view.code)}>
          <Icon name="copy" />
          <span>
            复制邀请链接
            <small>
              房间 {view.code} · {connected ? '已连接' : '重连中'}
            </small>
          </span>
        </button>
      )}
      <button class="menu-item" onClick={showRules}>
        <Icon name="rules" />
        <span>生存手册</span>
      </button>
      <button class="menu-item" onClick={() => showBestiary()}>
        <Icon name="bestiary" />
        <span>动物图鉴</span>
      </button>
      <button class="menu-item" onClick={toggleSound} aria-pressed={sound}>
        <Icon name={sound ? 'soundOn' : 'soundOff'} />
        <span>{sound ? '音效已开启' : '音效已关闭'}</span>
      </button>
      <button class="menu-item danger" onClick={confirmLeave}>
        <Icon name="leave" />
        <span>离开对局</span>
      </button>
    </div>
  );
}
