import { PHASES, REGIONS, SPECIES, region, species, type Phase, type RegionId, type SpeciesId } from './data';

export type FoodChoice = 'hunt' | 'forage' | 'scavenge' | 'skip';
export interface Player {
  id: string; name: string; bot: boolean; seat: number; animal: SpeciesId; hp: number; sp: number;
  alive: boolean; location: RegionId; drop: RegionId | null; actions: number; hidden: boolean;
  ready: boolean; skillUsed: boolean; boost: number; guard: boolean; hunger: number; fed: boolean;
  food: FoodChoice | null; target: string; privateCount: number; publicCount: number; voice: boolean;
  called: boolean; meals: number; hunts: number; guesses: Record<string, SpeciesId>; score: number;
}
export interface Entry { id: number; round: number; text: string; scope: 'all' | string[]; kind: 'system' | 'private' | 'public' | 'clue'; from?: string; to?: string }
export interface Game {
  code: string; mode: 'solo' | 'online'; host: string; phase: Phase; round: number; deadline: number;
  players: Player[]; traces: Record<string, string[]>; resources: Record<string, number>;
  bodies: { location: RegionId; expires: number }[]; log: Entry[]; serial: number; seed: number;
  callIndex: number; call: { from: string; to: string; accepted: boolean } | null;
  event: string; createdAt: number;
}
export type Command = { type: string; region?: string; target?: string; text?: string; choice?: string; animal?: string; accept?: boolean; joined?: boolean };
export const validRegion = (value: unknown): value is RegionId => REGIONS.some(r => r.id === value);
export function rand(g: Game) { g.seed = (g.seed * 1664525 + 1013904223) >>> 0; return g.seed / 4294967296; }
function pick<T>(g: Game, values: readonly T[]): T { return values[Math.floor(rand(g) * values.length)]; }
export function createGame(code: string, mode: 'solo' | 'online', seed = crypto.getRandomValues(new Uint32Array(1))[0]): Game {
  return { code, mode, host: '', phase: 'lobby', round: 0, deadline: 0, players: [], traces: {}, resources: {}, bodies: [], log: [], serial: 0, seed, callIndex: 0, call: null, event: '', createdAt: Date.now() };
}
export function addPlayer(g: Game, id: string, name: string, bot = false) {
  if (g.phase !== 'lobby') throw Error('对局已经开始，请等待下一局。');
  if (g.players.length >= 8) throw Error('房间已满，最多 8 名玩家。');
  const p: Player = { id, name: name.trim().slice(0, 12) || '无名旅人', bot, seat: g.players.length + 1, animal: 'rabbit', hp: 3, sp: 5, alive: true, location: 'forest', drop: null, actions: 0, hidden: false, ready: false, skillUsed: false, boost: 0, guard: false, hunger: 0, fed: false, food: null, target: '', privateCount: 0, publicCount: 0, voice: false, called: false, meals: 0, hunts: 0, guesses: {}, score: 0 };
  g.players.push(p); if (!g.host) g.host = p.id; return p;
}
export function addBots(g: Game) {
  const names = ['松风', '拾雾', '晚星', '青苔', '远山', '流萤', '寻川'];
  while (g.players.length < 8) addPlayer(g, `bot-${g.players.length + 1}`, names[g.players.length - 1] || '林客', true);
}
export function log(g: Game, text: string, scope: 'all' | string[] = 'all', kind: Entry['kind'] = 'system', from?: string, to?: string) {
  g.log.push({ id: ++g.serial, round: g.round, text, scope, kind, from, to });
  if (g.log.length > 800) g.log.splice(0, g.log.length - 800);
}
function localAudience(g: Game, loc: RegionId) { return g.players.filter(p => p.alive && p.location === loc).map(p => p.id); }
function trace(g: Game, p: Player) { const t = g.traces[p.location] ||= []; if (!t.includes(p.id)) t.push(p.id); }
function erase(g: Game, p: Player, locations: string[]) { for (const loc of locations) g.traces[loc] = (g.traces[loc] || []).filter(id => id !== p.id); p.hidden = true; }
function death(g: Game, p: Player, reason: string) {
  if (p.hp > 0 || !p.alive) return;
  p.hp = 0; p.alive = false; p.ready = true; p.voice = false;
  g.bodies.push({ location: p.location, expires: g.round + 2 });
  log(g, `${p.seat} 号 ${p.name}（${species(p.animal).name}）因${reason}退出了食物链。`);
}
export function pay(g: Game, p: Player) {
  if (!p.alive) return false;
  if (p.sp === 0) {
    p.hp--; p.sp = Math.ceil(species(p.animal).sp / 2);
    log(g, `体力透支：生命 −1，恢复 ${p.sp} SP，然后支付本次行动费用。`, [p.id]);
    death(g, p, '透支'); if (!p.alive) return false;
  }
  p.sp--; return true;
}
function feed(g: Game, p: Player, amount: number) {
  p.sp = Math.min(species(p.animal).sp, p.sp + amount); p.fed = true; p.hunger = 0; p.meals++;
  log(g, `进食成功：恢复 ${amount} SP（不超过上限），本回合不再饥饿。生命不会恢复。`, [p.id]);
}
export function start(g: Game, preferred?: string) {
  if (g.phase !== 'lobby') throw Error('游戏已经开始。');
  addBots(g);
  const roles: SpeciesId[] = SPECIES.map(a => a.id);
  for (let i = roles.length - 1; i > 0; i--) { const j = Math.floor(rand(g) * (i + 1)); [roles[i], roles[j]] = [roles[j], roles[i]]; }
  if (g.mode === 'solo' && SPECIES.some(s => s.id === preferred)) {
    const i = roles.indexOf(preferred as SpeciesId); [roles[0], roles[i]] = [roles[i], roles[0]];
  }
  g.players.forEach((p, i) => { p.animal = roles[i]; p.hp = species(p.animal).hp; p.sp = species(p.animal).sp; });
  g.round = 1; beginRound(g);
}
function setPhase(g: Game, phase: Phase) {
  g.phase = phase; g.call = null;
  g.players.forEach(p => { p.ready = p.bot || !p.alive; p.voice = false; });
  g.deadline = Date.now() + (PHASES.find(p => p.id === phase)?.seconds || 60) * 1000;
  if (g.mode === 'solo' && phase !== 'call') g.deadline = 0;
}
function beginRound(g: Game) {
  g.traces = {}; g.bodies = g.bodies.filter(b => b.expires >= g.round);
  g.resources = Object.fromEntries(REGIONS.map(r => [r.id, 0]));
  const fertile: RegionId[] = ['forest', 'river', 'meadow', 'shrub'];
  const count = g.round <= 2 ? 4 : g.round <= 5 ? 3 : 2;
  for (let i = 0; i < count; i++) g.resources[fertile[(i + g.round - 1) % 4]] = 1;
  g.event = g.round <= 2 ? '晨雾未散 · 四处草食资源，身份仍是秘密' : g.round <= 5 ? '旱意渐浓 · 草食资源缩减为三份' : '漫长寒夜 · 仅剩两份草食资源';
  g.players.forEach(p => { p.actions = 2; p.drop = null; p.hidden = false; p.skillUsed = false; p.boost = 0; p.guard = false; p.fed = false; p.food = null; p.target = ''; p.privateCount = 0; p.publicCount = 0; p.called = false; });
  setPhase(g, 'talk'); log(g, `第 ${g.round} 回合开始。${g.event}。`);
  const sayings = ['痕迹可能是旧的，我不会只凭足迹判断。', '我打算避开人多的地方。', '谁愿意交换一下附近的线索？', '这回合我会去有食物的地区。', '别急着相信我的投放位置。', '活到最后，比多走一步更重要。', '我不保证会待在原来的地方。'];
  for (const p of g.players.filter(p => p.bot && p.alive).slice(0, 2)) { p.publicCount++; log(g, pick(g, sayings), 'all', 'public', p.id); }
}
function skill(g: Game, p: Player, target?: string) {
  if (p.skillUsed) throw Error('本回合已经使用过技能。');
  if (p.animal === 'crow' && !validRegion(target)) throw Error('先在地图选择要俯瞰的地区。');
  if (p.animal === 'rabbit' && !(region(p.location).adjacent as readonly string[]).includes(target || '')) throw Error('先在地图选择一个相邻地区，再使用疾跃。');
  if (!pay(g, p)) return; p.skillUsed = true; p.actions--;
  const around: string[] = [p.location, ...region(p.location).adjacent];
  switch (p.animal) {
    case 'wolf': { const n = g.players.filter(q => q.alive && q.id !== p.id && around.includes(q.location) && (species(p.animal).prey as readonly string[]).includes(q.animal)).length; log(g, `嗅觉：你所在地区及相邻地区共存在 ${n} 名可捕食对象。`, [p.id], 'clue'); break; }
    case 'fox': { const ids = g.players.filter(q => q.alive && q.location === p.location && q.id !== p.id).map(q => q.id); const notes = g.log.filter(l => l.kind === 'private' && (ids.includes(l.from || '') || ids.includes(l.to || ''))); const note = notes.length ? pick(g, notes) : null; log(g, note ? `窃听到 ${g.players.find(q => q.id === note.from)?.name} → ${g.players.find(q => q.id === note.to)?.name}：「${note.text}」` : '窃听：附近没有可读取的历史私信。', [p.id], 'clue'); break; }
    case 'lynx': p.boost = 1; log(g, '蓄势完成：本回合下一次捕食伤害 +1。', [p.id]); break;
    case 'snake': p.boost = 1; erase(g, p, [p.location]); log(g, '伏击就绪：痕迹已抹除，本回合下一次捕食伤害 +1。', [p.id]); break;
    case 'rabbit': { const origin = p.location; p.location = target as RegionId; erase(g, p, [origin, p.location]); log(g, `疾跃至${region(p.location).name}：出发地与目的地足迹已抹除。你仍可被捕食。`, [p.id]); break; }
    case 'deer': { const danger = g.players.some(q => q.alive && q.location === p.location && (species(q.animal).prey as readonly string[]).includes(p.animal)); log(g, danger ? '警觉：同地区存在能捕食你的天敌！' : '警觉：此刻同地区没有能捕食你的天敌。', [p.id], 'clue'); break; }
    case 'boar': p.guard = true; log(g, '硬皮生效：本回合每次捕食伤害 −1（最低 1）。', [p.id]); break;
    case 'crow': { const names = (g.traces[target!] || []).map(id => g.players.find(q => q.id === id)?.name); log(g, `俯瞰 ${region(target!).name}：${names.length ? names.join('、') : '没有痕迹'}。痕迹不代表实时位置。`, [p.id], 'clue'); break; }
  }
}
function botDrop(g: Game, p: Player): RegionId {
  const role = species(p.animal);
  if (role.diet === 'hunt') {
    // Food supply and the previous round's visible footprints are public inference, never hidden identities.
    const candidates = REGIONS.filter(r => g.resources[r.id] > 0);
    return pick(g, candidates.length ? candidates : REGIONS).id;
  }
  const knownBodies = g.bodies.filter(b => b.location === p.location || (region(p.location).adjacent as readonly string[]).includes(b.location));
  if (role.diet === 'scavenge' && knownBodies.length) return pick(g, knownBodies).location;
  return pick(g, REGIONS.filter(r => g.resources[r.id] > 0)).id;
}
function botActions(g: Game) {
  for (const p of g.players.filter(p => p.bot && p.alive)) {
    if (p.sp <= 1 || rand(g) < 0.2) { p.actions = 0; continue; }
    if (p.animal === 'rabbit') {
      const next = [...region(p.location).adjacent].sort((a,b) => {
        const count = (loc:string) => g.players.filter(q=>q.id!==p.id&&q.alive&&q.drop===loc).length;
        return (count(a)*2-(g.resources[a]>0?1:0))-(count(b)*2-(g.resources[b]>0?1:0));
      })[0];
      skill(g, p, next);
    }
    else if (['snake', 'deer', 'wolf', 'boar'].includes(p.animal) && rand(g) < 0.55) skill(g, p);
    else if (rand(g) < 0.45) { if (pay(g, p)) { erase(g, p, [p.location]); p.actions--; } }
    else if (pay(g, p)) { trace(g, p); p.location = pick(g, region(p.location).adjacent); trace(g, p); p.hidden = false; p.actions--; }
    p.ready = true;
  }
}
function setupCalls(g: Game) { g.callIndex = 0; nextCaller(g, false); }
function nextCaller(g: Game, increment = true) {
  if (increment) g.callIndex++;
  g.call = null;
  while (g.callIndex < g.players.length) {
    const p = g.players[g.callIndex];
    if (p.alive && !p.called && !p.bot) break;
    g.callIndex++;
  }
  if (g.callIndex >= g.players.length) { setPhase(g, 'food'); return; }
  g.deadline = g.mode === 'solo' ? 0 : Date.now() + 15000;
}
export function settleFood(g: Game) {
  const rotation = (g.round - 1) % g.players.length;
  const ordered = [...g.players.slice(rotation), ...g.players.slice(0, rotation)];
  for (const p of ordered) {
    if (!p.alive) continue;
    if (!p.food && p.bot) p.food = species(p.animal).diet === 'hunt' ? 'hunt' : species(p.animal).diet === 'scavenge' && g.bodies.some(b => b.location === p.location) ? 'scavenge' : 'forage';
    if (!p.food || p.food === 'skip') continue;
    // Exposure is captured at the exact attempt, including failures and overdraw deaths.
    const audience = localAudience(g, p.location);
    log(g, `${p.seat} 号 ${p.name} 在${region(p.location).name}进行了获取食物的行动。`, audience, 'clue');
    if (!pay(g, p)) continue;
    if (p.food === 'hunt') {
      const possible = ordered.filter(q => q.id !== p.id && q.alive && q.location === p.location && (species(p.animal).prey as readonly string[]).includes(q.animal));
      const q = p.target ? possible.find(q => q.id === p.target) : possible.length ? pick(g, possible) : undefined;
      if (q) { const dmg = Math.max(1, species(p.animal).damage + p.boost - (q.guard ? 1 : 0)); q.hp -= dmg; p.boost = 0; p.hunts++;
        log(g, `捕食成功：命中 ${q.seat} 号 ${q.name}，造成 ${dmg} 点伤害。`, [p.id]);
        log(g, `你被 ${p.seat} 号 ${p.name} 捕食，生命 −${dmg}。躲藏无法抵挡捕食。`, [q.id]);
        feed(g, p, 3); death(g, q, '捕食');
      } else log(g, '捕食落空：目标不在这里，或不在你的食谱中。', [p.id]);
    } else if (p.food === 'forage') {
      if (g.resources[p.location] > 0) { g.resources[p.location]--; feed(g, p, p.animal === 'crow' ? 2 : 3); }
      else log(g, '采食失败：这里的草食资源已经耗尽。', [p.id]);
    } else if (p.food === 'scavenge') {
      const i = g.bodies.findIndex(b => b.location === p.location);
      if (i !== -1) { g.bodies.splice(i, 1); feed(g, p, 4); } else log(g, '食腐失败：这里没有可食用的遗骸。', [p.id]);
    }
  }
  for (const p of g.players.filter(p => p.alive)) {
    if (!p.fed) { p.hunger++; if (p.hunger >= species(p.animal).hunger) { p.hp--; log(g, '持续饥饿：生命 −1。进食才能重置饥饿，否则之后每回合继续扣血。', [p.id]); death(g, p, '饥饿'); } }
  }
}
function finish(g: Game) {
  g.phase = 'finished'; g.deadline = 0; g.call = null;
  for (const p of g.players) {
    p.voice = false;
    const deduction = Object.entries(p.guesses).reduce((sum, [id, guess]) => sum + (g.players.find(q => q.id === id)?.animal === guess ? 2 : -1), 0);
    p.score = Math.max(0, (p.alive ? 10 : 0) + p.hp * 2 + p.meals * 2 + p.hunts * 3 + deduction);
  }
  log(g, '七回合结束。所有动物身份揭晓；存活者共同获得生存胜利。');
}
export function advance(g: Game) {
  switch (g.phase) {
    case 'talk': setPhase(g, 'drop'); break;
    case 'drop':
      for (const p of g.players.filter(p => p.alive)) { p.drop ||= botDrop(g, p); p.location = p.drop; trace(g, p); }
      log(g, '投放完成。所有人的初始地区现已公开，之后的移动不会全图广播。');
      setPhase(g, 'action'); break;
    case 'action': botActions(g); setPhase(g, 'traces'); break;
    case 'traces': setPhase(g, 'call'); setupCalls(g); break;
    case 'call': nextCaller(g); break;
    case 'food': settleFood(g); setPhase(g, 'settle'); break;
    case 'settle': if (g.round >= 7) finish(g); else { g.round++; beginRound(g); } break;
  }
}
function requirePhase(g: Game, phase: Phase) { if (g.phase !== phase) throw Error('这个操作不属于当前阶段。'); }
export function command(g: Game, playerId: string, cmd: Command) {
  const p = g.players.find(p => p.id === playerId); if (!p) throw Error('玩家不存在。');
  if (cmd.type === 'start') { if (g.host !== p.id) throw Error('只有房主能开始游戏。'); start(g, cmd.animal); return; }
  if (cmd.type === 'bots') { if (g.host !== p.id) throw Error('只有房主能添加电脑玩家。'); requirePhase(g, 'lobby'); addBots(g); return; }
  if (g.phase === 'lobby' || g.phase === 'finished') throw Error('当前阶段不可执行此操作。');
  if (cmd.type === 'guess') {
    if (!p.alive) throw Error('观战时不能修改推理。');
    if (!g.players.some(q => q.id === cmd.target && q.id !== p.id && q.alive)) throw Error('请选择仍存活的其他玩家。');
    if (cmd.animal === '') delete p.guesses[cmd.target!];
    else if (SPECIES.some(s => s.id === cmd.animal)) p.guesses[cmd.target!] = cmd.animal as SpeciesId;
    else throw Error('请选择有效的动物身份。');
    return;
  }
  if (cmd.type === 'ready') {
    if (g.phase === 'call') { if (g.players[g.callIndex]?.id !== p.id) throw Error('还没轮到你选择通话。'); nextCaller(g); return; }
    if (g.phase === 'drop' && p.alive && !p.drop) throw Error('请先选择投放地区。');
    if (g.phase === 'food' && p.alive && !p.food) throw Error('请先选择获取食物的方式。');
    p.ready = true;
    const humans = g.players.filter(q => !q.bot && q.alive);
    if (humans.every(q => q.ready)) advance(g); return;
  }
  if (!p.alive) throw Error('你已进入观战，无法干预对局。');
  if (cmd.type === 'message') {
    const text = (cmd.text || '').trim(); if (!text || [...text].length > 50) throw Error('消息需为 1–50 个字。');
    if (cmd.target === 'all') { if (p.publicCount >= 1) throw Error('本回合公开消息额度已用完。'); p.publicCount++; log(g, text, 'all', 'public', p.id); }
    else { const q = g.players.find(q => q.id === cmd.target && q.id !== p.id && q.alive); if (!q) throw Error('请选择一位存活的收信人。'); if (p.privateCount >= 5) throw Error('本回合 5 条私信已用完。'); p.privateCount++; log(g, text, [p.id, q.id], 'private', p.id, q.id);
      if (q.bot && q.privateCount < 5) { q.privateCount++; log(g, pick(g, ['我只能确认自己附近的情况，你的消息我记下了。', '先别急着信任任何人。我想活过第七夜。', '我的投放地点是真的，但我可能会移动。', '附近的痕迹不一定是现在的位置，小心。']), [q.id, p.id], 'private', q.id, p.id); }
    } return;
  }
  if (cmd.type === 'voice') { requirePhase(g, 'talk'); p.voice = !!cmd.joined; return; }
  if (cmd.type === 'call') {
    requirePhase(g, 'call'); if (g.players[g.callIndex]?.id !== p.id || p.called || g.call) throw Error('现在无法发起通话。');
    const q = g.players.find(q => q.id === cmd.target && q.id !== p.id && q.alive && !q.called && !q.bot);
    if (!q) throw Error('请选择尚未使用通话机会的真人玩家。');
    g.call = { from: p.id, to: q.id, accepted: false }; g.deadline = Date.now() + 15000; return;
  }
  if (cmd.type === 'call-answer') {
    requirePhase(g, 'call'); if (!g.call || g.call.to !== p.id || g.call.accepted) throw Error('没有待接听的邀请。');
    if (!cmd.accept) { nextCaller(g); return; }
    const from = g.players.find(q => q.id === g.call!.from)!;
    p.called = true; from.called = true; g.call.accepted = true; g.deadline = Date.now() + 30000; return;
  }
  if (cmd.type === 'hangup') { requirePhase(g, 'call'); if (!g.call || ![g.call.from, g.call.to].includes(p.id)) throw Error('你没有正在进行的通话。'); nextCaller(g); return; }
  if (cmd.type === 'drop') { requirePhase(g, 'drop'); if (p.ready) throw Error('已锁定选择。'); if (!validRegion(cmd.region)) throw Error('请选择地图上的地区。'); p.drop = cmd.region; return; }
  if (cmd.type === 'food') {
    requirePhase(g, 'food'); if (p.ready) throw Error('已锁定选择。'); const allowed = species(p.animal).diet === 'hunt' ? ['hunt', 'skip'] : p.animal === 'crow' ? ['scavenge', 'forage', 'skip'] : ['forage', 'skip'];
    if (!allowed.includes(cmd.choice || '')) throw Error('这个食物来源不适合你的动物。');
    if (cmd.target && !g.players.some(q => q.id === cmd.target && q.id !== p.id && q.alive)) throw Error('无效的捕食目标。');
    p.food = cmd.choice as FoodChoice; p.target = cmd.target || ''; return;
  }
  requirePhase(g, 'action'); if (p.ready || p.actions <= 0) throw Error('本回合行动已结束。');
  if (cmd.type === 'skill') { skill(g, p, cmd.region); return; }
  if (!['move', 'hide', 'scream'].includes(cmd.type)) throw Error('未知操作。');
  if (cmd.type === 'move' && !(region(p.location).adjacent as readonly string[]).includes(cmd.region || '')) throw Error('只能移动到相邻地区。');
  if (!pay(g, p)) return; p.actions--;
  if (cmd.type === 'move') { trace(g, p); p.location = cmd.region as RegionId; p.hidden = false; trace(g, p); log(g, `你移动到了${region(p.location).name}，在出发地和目的地都留下了痕迹。`, [p.id]); }
  if (cmd.type === 'hide') { erase(g, p, [p.location]); log(g, '躲藏成功：本地区足迹已抹除。捕食判定仍然有效。', [p.id]); }
  if (cmd.type === 'scream') log(g, `${p.seat} 号 ${p.name} 的尖叫响彻${region(p.location).name}。此刻他就在这里。`, localAudience(g, p.location), 'clue');
}
export function view(g: Game, id: string) {
  const me = g.players.find(p => p.id === id)!;
  const visible = me && g.phase !== 'lobby' ? [me.location, ...region(me.location).adjacent] : [];
  const traceStage = ['traces', 'call', 'food', 'settle', 'finished'].includes(g.phase);
  return {
    code: g.code, mode: g.mode, host: g.host, phase: g.phase, round: g.round, deadline: g.deadline,
    me: g.phase === 'lobby' ? null : { ...me },
    players: g.players.map(p => ({ id: p.id, name: p.name, seat: p.seat, bot: p.bot, alive: p.alive, ready: p.ready, voice: p.voice, called: p.called,
      drop: ['lobby', 'talk', 'drop'].includes(g.phase) ? null : p.drop,
      animal: g.phase === 'finished' || (g.phase !== 'lobby' && (!p.alive || p.id === id)) ? p.animal : null,
      score: g.phase === 'finished' ? p.score : null,
      hp: g.phase === 'finished' ? p.hp : null, meals: g.phase === 'finished' ? p.meals : null, hunts: g.phase === 'finished' ? p.hunts : null,
    })),
    traces: Object.fromEntries(REGIONS.map(r => [r.id, traceStage && visible.includes(r.id) ? [...(g.traces[r.id] || [])] : null])),
    resources: { ...g.resources }, bodies: g.bodies.filter(b => visible.includes(b.location)),
    log: g.log.filter(l => l.scope === 'all' || l.scope.includes(id)).slice(-200).map(({ scope: _scope, ...l }) => l),
    callIndex: g.callIndex, call: g.call ? { ...g.call } : null, event: g.event,
  };
}
export type GameView = ReturnType<typeof view>;
