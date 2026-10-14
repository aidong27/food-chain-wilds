/**
 * Static game content and tunable numbers.
 *
 * Everything that changes game balance lives in this file so a designer can
 * adjust it without touching the rule engine.
 */

export type RegionId = 'forest' | 'river' | 'cliff' | 'meadow' | 'shrub' | 'ruins';
export type SpeciesId = 'wolf' | 'fox' | 'lynx' | 'snake' | 'rabbit' | 'deer' | 'boar' | 'crow';
export type FoodChoice = 'hunt' | 'forage' | 'scavenge' | 'skip';
export type Diet = 'hunt' | 'plant' | 'scavenge';
export type PhaseId = 'talk' | 'drop' | 'action' | 'traces' | 'call' | 'food' | 'settle';

export interface Region {
  id: RegionId;
  name: string;
  short: string;
  icon: string;
  /** Pin position on the island illustration, in percent. */
  x: number;
  y: number;
  adjacent: readonly RegionId[];
  /** Fertile regions take turns receiving the round's plant food. */
  fertile: boolean;
  description: string;
}

export interface Species {
  id: SpeciesId;
  name: string;
  title: string;
  diet: Diet;
  hp: number;
  sp: number;
  /** Rounds without food before hunger starts costing 1 HP per round. */
  hunger: number;
  damage: number;
  prey: readonly SpeciesId[];
  /** Food actions this animal may choose, besides skipping. */
  foods: readonly Exclude<FoodChoice, 'skip'>[];
  /** SP restored by each successful food action. */
  gains: Partial<Record<Exclude<FoodChoice, 'skip'>, number>>;
  skill: string;
  skillText: string;
  /** Whether the skill needs a region chosen on the map. */
  skillTarget: 'none' | 'any' | 'adjacent';
  color: string;
}

export interface PhaseInfo {
  id: PhaseId;
  name: string;
  seconds: number;
  hint: string;
  /** Phases with nothing to do when you are the only human. */
  skipInSolo?: boolean;
}

export const REGIONS: readonly Region[] = [
  {
    id: 'forest',
    name: '雾松林',
    short: '森林',
    icon: '♧',
    x: 25,
    y: 31,
    adjacent: ['river', 'cliff', 'shrub'],
    fertile: true,
    description: '林影交错，进入的人都会留下足迹。',
  },
  {
    id: 'river',
    name: '月影河谷',
    short: '河谷',
    icon: '≈',
    x: 49,
    y: 44,
    adjacent: ['forest', 'cliff', 'meadow'],
    fertile: true,
    description: '水源将猎物与猎手引到同一处。',
  },
  {
    id: 'cliff',
    name: '回声山崖',
    short: '山崖',
    icon: '△',
    x: 73,
    y: 23,
    adjacent: ['forest', 'river', 'meadow'],
    fertile: false,
    description: '这里没有草食资源，只有风与回声。',
  },
  {
    id: 'meadow',
    name: '金穗草原',
    short: '草原',
    icon: '✳',
    x: 77,
    y: 62,
    adjacent: ['cliff', 'river', 'ruins'],
    fertile: true,
    description: '开阔草地上的一口食物，也可能是诱饵。',
  },
  {
    id: 'shrub',
    name: '荆棘灌丛',
    short: '灌丛',
    icon: '❋',
    x: 24,
    y: 67,
    adjacent: ['forest', 'ruins'],
    fertile: true,
    description: '道路狭窄。藏好足迹，再相信你的直觉。',
  },
  {
    id: 'ruins',
    name: '寂石荒地',
    short: '荒地',
    icon: '◇',
    x: 51,
    y: 82,
    adjacent: ['shrub', 'meadow'],
    fertile: false,
    description: '贫瘠的缓冲地带，连接灌丛与草原。',
  },
];

export const SPECIES: readonly Species[] = [
  {
    id: 'wolf',
    name: '灰狼',
    title: '循迹的猎手',
    diet: 'hunt',
    hp: 5,
    sp: 5,
    hunger: 1,
    damage: 2,
    prey: ['deer', 'rabbit', 'boar'],
    foods: ['hunt', 'scavenge'],
    gains: { hunt: 3, scavenge: 3 },
    skill: '嗅觉',
    skillText: '感知当前地区及相邻地区可捕食生物的总数。',
    skillTarget: 'none',
    color: '#a9bac1',
  },
  {
    id: 'fox',
    name: '赤狐',
    title: '秘密的交易者',
    diet: 'hunt',
    hp: 5,
    sp: 5,
    hunger: 3,
    damage: 1,
    prey: ['rabbit', 'snake', 'crow'],
    foods: ['hunt', 'scavenge'],
    gains: { hunt: 3, scavenge: 3 },
    skill: '窃听',
    skillText: '读取本局一条涉及同地区其他玩家的历史私信。',
    skillTarget: 'none',
    color: '#dd925d',
  },
  {
    id: 'lynx',
    name: '山猫',
    title: '无声的伏击者',
    diet: 'hunt',
    hp: 4,
    sp: 4,
    hunger: 2,
    damage: 1,
    prey: ['rabbit', 'crow', 'fox'],
    foods: ['hunt'],
    gains: { hunt: 3 },
    skill: '蓄势',
    skillText: '本回合下一次成功捕食伤害增加 1。',
    skillTarget: 'none',
    color: '#cdb185',
  },
  {
    id: 'snake',
    name: '游蛇',
    title: '耐心的潜伏者',
    diet: 'hunt',
    hp: 3,
    sp: 4,
    hunger: 3,
    damage: 1,
    prey: ['rabbit', 'crow'],
    foods: ['hunt', 'forage'],
    gains: { hunt: 3, forage: 2 },
    skill: '伏击',
    skillText: '抹除当前地区痕迹，下一次成功捕食伤害增加 1。',
    skillTarget: 'none',
    color: '#a4b577',
  },
  {
    id: 'rabbit',
    name: '野兔',
    title: '林间的幸存者',
    diet: 'plant',
    hp: 4,
    sp: 5,
    // Everyone's prey, but it lives on scraps: the longest hunger cycle among grazers.
    hunger: 3,
    damage: 0,
    prey: [],
    foods: ['forage'],
    gains: { forage: 3 },
    skill: '疾跃',
    skillText: '跳到选定的相邻地区，抹除出发地与目的地的足迹。',
    skillTarget: 'adjacent',
    color: '#ded4bc',
  },
  {
    id: 'deer',
    name: '麋鹿',
    title: '警觉的漫游者',
    diet: 'plant',
    hp: 5,
    sp: 4,
    hunger: 2,
    damage: 0,
    prey: [],
    foods: ['forage'],
    gains: { forage: 3 },
    skill: '警觉',
    skillText: '得知当前地区是否有能够捕食自己的天敌。',
    skillTarget: 'none',
    color: '#c6a675',
  },
  {
    id: 'boar',
    name: '野猪',
    title: '坚韧的守地者',
    diet: 'plant',
    hp: 4,
    sp: 4,
    hunger: 2,
    damage: 0,
    prey: [],
    foods: ['forage'],
    gains: { forage: 3 },
    skill: '硬皮',
    skillText: '本回合受到的每次捕食伤害减少 1，最低为 1。',
    skillTarget: 'none',
    color: '#b6a69d',
  },
  {
    id: 'crow',
    name: '渡鸦',
    title: '终局的见证者',
    diet: 'scavenge',
    hp: 3,
    sp: 5,
    hunger: 3,
    damage: 0,
    prey: [],
    foods: ['scavenge', 'forage'],
    gains: { scavenge: 4, forage: 2 },
    skill: '俯瞰',
    skillText: '查看任意指定地区的痕迹，不会揭示真实位置。',
    skillTarget: 'any',
    color: '#a4a8be',
  },
];

export const PHASES: readonly PhaseInfo[] = [
  { id: 'talk', name: '公共交流', seconds: 90, hint: '交换情报、试探身份。准备好可以提前结束。' },
  { id: 'drop', name: '秘密投放', seconds: 40, hint: '在地图上选择本回合的初始地区。所有人锁定后，投放位置会公开。' },
  { id: 'action', name: '自由行动', seconds: 60, hint: '本回合有 2 次行动。移动、技能、躲藏与尖叫各消耗 1 SP。' },
  { id: 'traces', name: '观察痕迹', seconds: 25, hint: '只能查看当前位置和相邻地区的痕迹。足迹不等于实时位置。', skipInSolo: true },
  { id: 'call', name: '私下通话', seconds: 30, hint: '按席位依次选择通话对象。双方接受后通话 30 秒，各消耗一次机会。', skipInSolo: true },
  { id: 'food', name: '获取食物', seconds: 40, hint: '选择捕食、采食、食腐或放弃。锁定后按轮换顺序结算。' },
  { id: 'settle', name: '生存结算', seconds: 15, hint: '食物只恢复体力。达到饥饿周期会失去生命，七回合后结算。' },
];

export const RULES = {
  rounds: 7,
  maxPlayers: 8,
  actionsPerRound: 2,
  privateMessages: 5,
  publicMessages: 1,
  messageLength: 50,
  nameLength: 12,
  /** A carcass stays until the end of the round it died in plus this many rounds. */
  bodyRounds: 2,
  /** Plant food on the map for rounds 1–7. */
  resourcesByRound: [4, 4, 3, 3, 3, 2, 2],
  callChooseSeconds: 15,
  callTalkSeconds: 30,
  logLimit: 800,
  viewLogLimit: 240,
} as const;

/** Score = survive 10 + HP×2 + meals×2 + hits×3 + correct guess×2 − wrong guess. */
export const SCORE = { alive: 10, hp: 2, meal: 2, hunt: 3, rightGuess: 2, wrongGuess: -1 } as const;

export const BOT_NAMES = ['松风', '拾雾', '晚星', '青苔', '远山', '流萤', '寻川', '白桦', '落叶'] as const;

const regionById = new Map(REGIONS.map(r => [r.id, r]));
const speciesById = new Map(SPECIES.map(s => [s.id, s]));

export const region = (id: RegionId): Region => regionById.get(id)!;
export const species = (id: SpeciesId): Species => speciesById.get(id)!;
export const isRegion = (value: unknown): value is RegionId => typeof value === 'string' && regionById.has(value as RegionId);
export const isSpecies = (value: unknown): value is SpeciesId => typeof value === 'string' && speciesById.has(value as SpeciesId);
export const isAdjacent = (from: RegionId, to: RegionId) => region(from).adjacent.includes(to);
export const canEat = (hunter: SpeciesId, prey: SpeciesId) => species(hunter).prey.includes(prey);
/** Animals that can hunt the given species. */
export const predatorsOf = (id: SpeciesId): SpeciesId[] => SPECIES.filter(s => s.prey.includes(id)).map(s => s.id);
export const phaseInfo = (id: PhaseId) => PHASES.find(p => p.id === id)!;
export const phasesFor = (mode: 'solo' | 'online') => PHASES.filter(p => mode === 'online' || !p.skipInSolo);

/** Fertile regions that receive plant food in a round. Food rotates so no region is always safe to rely on. */
export function foodRegions(round: number): RegionId[] {
  const fertile = REGIONS.filter(r => r.fertile).map(r => r.id);
  const count = RULES.resourcesByRound[Math.min(round, RULES.rounds) - 1] ?? 2;
  return Array.from({ length: Math.min(count, fertile.length) }, (_, i) => fertile[(i + round - 1) % fertile.length]);
}

const CHINESE_COUNT = ['零', '一', '两', '三', '四', '五', '六'];

export function roundEvent(round: number): string {
  const count = CHINESE_COUNT[RULES.resourcesByRound[round - 1] ?? 2];
  if (round <= 2) return `晨雾未散 · ${count}处食物，身份仍是秘密`;
  if (round <= 5) return `旱意渐浓 · 食物缩减为${count}份`;
  return `漫长寒夜 · 仅剩${count}份食物`;
}
