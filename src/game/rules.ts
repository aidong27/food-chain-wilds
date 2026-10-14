/**
 * Individual rules of the wilds: paying stamina, moving, skills, feeding and
 * death. Each function validates its own preconditions and throws RuleError
 * with a message suitable for players. Phase and turn checks live in engine.ts.
 */
import { RULES, canEat, isAdjacent, isRegion, region, species, type FoodChoice, type RegionId } from './data';
import { pick } from './rng';
import { RuleError, type Entry, type EntryInput, type Game, type Player } from './types';

export function fail(message: string): never {
  throw new RuleError(message);
}

export function findPlayer(g: Game, id: string | undefined): Player | undefined {
  return id ? g.players.find(p => p.id === id) : undefined;
}

export function label(p: Player): string {
  return `${p.seat} 号 ${p.name}`;
}

export function log(g: Game, text: string, extra: EntryInput = {}): Entry {
  const { scope = 'all', kind = 'system', ...rest } = extra;
  const entry: Entry = { id: ++g.serial, round: g.round, text, scope, kind, ...rest };
  g.log.push(entry);
  if (g.log.length > RULES.logLimit) g.log.splice(0, g.log.length - RULES.logLimit);
  return entry;
}

export function playersIn(g: Game, location: RegionId): Player[] {
  return g.players.filter(p => p.alive && p.location === location);
}

export function leaveTrace(g: Game, p: Player) {
  const list = (g.traces[p.location] ||= []);
  if (!list.includes(p.id)) list.push(p.id);
}

export function eraseTraces(g: Game, p: Player, locations: RegionId[]) {
  for (const loc of locations) g.traces[loc] = (g.traces[loc] || []).filter(id => id !== p.id);
}

export function kill(g: Game, p: Player, cause: 'hunt' | 'hunger' | 'overdraw') {
  if (p.hp > 0 || !p.alive) return;
  p.hp = 0;
  p.alive = false;
  p.diedRound = g.round;
  p.ready = true;
  p.voice = false;
  g.bodies.push({ location: p.location, expires: g.round + RULES.bodyRounds });
  const reason = { hunt: '捕食', hunger: '饥饿', overdraw: '透支' }[cause];
  log(g, `${label(p)}（${species(p.animal).name}）因${reason}退出了食物链。`, { tag: 'death', actor: p.id, animal: p.animal });
}

/**
 * Spends 1 SP. At 0 SP the animal overdraws: it loses 1 HP, recovers half its
 * SP (rounded up) and then pays. Returns false if the overdraw killed it.
 */
export function pay(g: Game, p: Player): boolean {
  if (!p.alive) return false;
  if (p.sp === 0) {
    p.hp--;
    p.sp = Math.ceil(species(p.animal).sp / 2);
    log(g, `体力透支：生命 −1，恢复 ${p.sp} SP，然后支付本次行动费用。`, { scope: [p.id], tag: 'overdraw' });
    kill(g, p, 'overdraw');
    if (!p.alive) return false;
  }
  p.sp--;
  return true;
}

function feed(g: Game, p: Player, source: Exclude<FoodChoice, 'skip'>) {
  const amount = species(p.animal).gains[source] ?? 0;
  p.sp = Math.min(species(p.animal).sp, p.sp + amount);
  p.fed = true;
  p.hunger = 0;
  p.meals++;
  log(g, `进食成功：恢复 ${amount} SP（不超过上限），本回合不再饥饿。生命不会恢复。`, { scope: [p.id], tag: 'fed', amount });
}

function spendAction(g: Game, p: Player): boolean {
  if (p.actions <= 0) fail('本回合行动次数已用完。');
  if (!pay(g, p)) return false;
  p.actions--;
  return true;
}

export function move(g: Game, p: Player, to: RegionId) {
  if (!isAdjacent(p.location, to)) fail('只能移动到相邻地区。');
  if (!spendAction(g, p)) return;
  leaveTrace(g, p);
  p.location = to;
  leaveTrace(g, p);
  log(g, `你移动到了${region(to).name}，在出发地和目的地都留下了痕迹。`, { scope: [p.id], tag: 'move', region: to });
}

export function hide(g: Game, p: Player) {
  if (!spendAction(g, p)) return;
  eraseTraces(g, p, [p.location]);
  log(g, '躲藏成功：本地区足迹已抹除。捕食判定仍然有效。', { scope: [p.id], tag: 'hide', region: p.location });
}

export function scream(g: Game, p: Player) {
  if (!spendAction(g, p)) return;
  const audience = playersIn(g, p.location).map(q => q.id);
  log(g, `${label(p)} 的尖叫响彻${region(p.location).name}。此刻 Ta 就在这里。`, {
    scope: audience,
    kind: 'clue',
    tag: 'scream',
    actor: p.id,
    region: p.location,
  });
}

export function useSkill(g: Game, p: Player, target?: RegionId) {
  const s = species(p.animal);
  if (p.skillUsed) fail('本回合已经使用过技能。');
  if (s.skillTarget === 'any' && !isRegion(target)) fail('先在地图选择要俯瞰的地区。');
  if (s.skillTarget === 'adjacent' && !(isRegion(target) && isAdjacent(p.location, target))) {
    fail('先在地图选择一个相邻地区，再使用疾跃。');
  }
  if (!spendAction(g, p)) return;
  p.skillUsed = true;
  const result = (text: string, extra: EntryInput = {}) =>
    log(g, text, { scope: [p.id], kind: 'clue', tag: 'skill', skill: p.animal, ...extra });

  switch (p.animal) {
    case 'wolf': {
      const around: RegionId[] = [p.location, ...region(p.location).adjacent];
      const count = g.players.filter(q => q.alive && q.id !== p.id && around.includes(q.location) && canEat(p.animal, q.animal)).length;
      result(`嗅觉：你所在地区及相邻地区共存在 ${count} 名可捕食对象。`, { amount: count, region: p.location });
      break;
    }
    case 'fox': {
      const nearby = playersIn(g, p.location)
        .filter(q => q.id !== p.id)
        .map(q => q.id);
      const notes = g.log.filter(l => l.kind === 'private' && (nearby.includes(l.from || '') || nearby.includes(l.to || '')));
      const note = notes.length ? pick(g, notes) : null;
      if (note) {
        const from = findPlayer(g, note.from),
          to = findPlayer(g, note.to);
        result(`窃听到 ${from?.name} → ${to?.name}：「${note.text}」`, { actor: note.from, target: note.to });
      } else {
        result('窃听：附近没有可读取的历史私信。');
      }
      break;
    }
    case 'lynx':
      p.boost = 1;
      result('蓄势完成：本回合下一次捕食伤害 +1。');
      break;
    case 'snake':
      p.boost = 1;
      eraseTraces(g, p, [p.location]);
      result('伏击就绪：痕迹已抹除，本回合下一次捕食伤害 +1。');
      break;
    case 'rabbit': {
      const origin = p.location;
      p.location = target!;
      eraseTraces(g, p, [origin, p.location]);
      result(`疾跃至${region(p.location).name}：出发地与目的地足迹已抹除。你仍可被捕食。`, { region: p.location });
      break;
    }
    case 'deer': {
      const danger = playersIn(g, p.location).some(q => canEat(q.animal, p.animal));
      result(danger ? '警觉：同地区存在能捕食你的天敌！' : '警觉：此刻同地区没有能捕食你的天敌。', {
        amount: danger ? 1 : 0,
        region: p.location,
      });
      break;
    }
    case 'boar':
      p.guard = true;
      result('硬皮生效：本回合每次捕食伤害 −1（最低 1）。');
      break;
    case 'crow': {
      const ids = [...(g.traces[target!] || [])];
      const names = ids.map(id => findPlayer(g, id)?.name);
      result(`俯瞰 ${region(target!).name}：${names.length ? names.join('、') : '没有痕迹'}。痕迹不代表实时位置。`, {
        region: target,
        actor: ids.join(','),
      });
      break;
    }
  }
}

export function allowedFoods(p: Player): FoodChoice[] {
  return [...species(p.animal).foods, 'skip'];
}

/**
 * Resolves every food choice in rotating seat order, then applies hunger.
 * Each attempt costs 1 SP and is seen by everyone in the same region.
 */
export function resolveFood(g: Game) {
  const rotation = (g.round - 1) % g.players.length;
  const ordered = [...g.players.slice(rotation), ...g.players.slice(0, rotation)];
  for (const p of ordered) {
    if (!p.alive || !p.food || p.food === 'skip') continue;
    // Exposure is captured at the attempt itself, including failures and overdraw deaths.
    const audience = playersIn(g, p.location).map(q => q.id);
    log(g, `${label(p)} 在${region(p.location).name}进行了获取食物的行动。`, {
      scope: audience,
      kind: 'clue',
      tag: 'food-attempt',
      actor: p.id,
      region: p.location,
    });
    if (!pay(g, p)) continue;
    if (p.food === 'hunt') hunt(g, p, ordered);
    else if (p.food === 'forage') {
      if (g.resources[p.location] > 0) {
        g.resources[p.location]--;
        feed(g, p, 'forage');
      } else log(g, '采食失败：这里的草食资源已经耗尽。', { scope: [p.id], tag: 'starved' });
    } else if (p.food === 'scavenge') {
      const i = g.bodies.findIndex(b => b.location === p.location);
      if (i !== -1) {
        g.bodies.splice(i, 1);
        feed(g, p, 'scavenge');
      } else log(g, '食腐失败：这里没有可食用的遗骸。', { scope: [p.id], tag: 'starved' });
    }
  }
  for (const p of g.players) {
    if (!p.alive || p.fed) continue;
    p.hunger++;
    if (p.hunger >= species(p.animal).hunger) {
      p.hp--;
      log(g, '持续饥饿：生命 −1。进食才能重置饥饿，否则之后每回合继续扣血。', { scope: [p.id], tag: 'hunger' });
      kill(g, p, 'hunger');
    }
  }
}

function hunt(g: Game, p: Player, ordered: Player[]) {
  const possible = ordered.filter(q => q.id !== p.id && q.alive && q.location === p.location && canEat(p.animal, q.animal));
  const prey = p.target ? possible.find(q => q.id === p.target) : possible.length ? pick(g, possible) : undefined;
  if (!prey) {
    log(g, '捕食落空：目标不在这里，或不在你的食谱中。', { scope: [p.id], tag: 'miss' });
    return;
  }
  const damage = Math.max(1, species(p.animal).damage + p.boost - (prey.guard ? 1 : 0));
  prey.hp -= damage;
  p.boost = 0;
  p.hunts++;
  log(g, `捕食成功：命中 ${label(prey)}，造成 ${damage} 点伤害。`, { scope: [p.id], tag: 'hit', target: prey.id, amount: damage });
  log(g, `你被 ${label(p)} 捕食，生命 −${damage}。躲藏无法抵挡捕食。`, { scope: [prey.id], tag: 'attacked', actor: p.id, amount: damage });
  feed(g, p, 'hunt');
  kill(g, prey, 'hunt');
}

export function postMessage(g: Game, p: Player, target: string, rawText: string) {
  const text = rawText.trim();
  if (!text || [...text].length > RULES.messageLength) fail(`消息需为 1–${RULES.messageLength} 个字。`);
  if (target === 'all') {
    if (p.publicCount >= RULES.publicMessages) fail('本回合公开消息额度已用完。');
    p.publicCount++;
    log(g, text, { kind: 'public', from: p.id });
    return;
  }
  const q = g.players.find(q => q.id === target && q.id !== p.id && q.alive);
  if (!q) fail('请选择一位存活的收信人。');
  if (p.privateCount >= RULES.privateMessages) fail(`本回合 ${RULES.privateMessages} 条私信已用完。`);
  p.privateCount++;
  log(g, text, { scope: [p.id, q.id], kind: 'private', from: p.id, to: q.id });
}
