/**
 * A tiny understanding of table talk: who claims to be what, where people say
 * they will go, and whom they accuse. Good enough for 50-character messages.
 */
import { region, species, type RegionId, type SpeciesId } from '../data';
import type { GameView } from '../view';

const SPECIES_WORDS: [SpeciesId, string[]][] = [
  ['wolf', ['灰狼', '狼']],
  ['fox', ['赤狐', '狐狸', '狐']],
  ['lynx', ['山猫', '猞猁', '猫']],
  ['snake', ['游蛇', '蛇']],
  ['rabbit', ['野兔', '兔子', '兔']],
  ['deer', ['麋鹿', '鹿']],
  ['boar', ['野猪', '猪']],
  ['crow', ['渡鸦', '乌鸦', '鸦']],
];

const REGION_WORDS: [RegionId, string[]][] = [
  ['forest', ['雾松林', '松林', '森林', '树林', '林子']],
  ['river', ['月影河谷', '河谷', '河边', '河']],
  ['cliff', ['回声山崖', '山崖', '悬崖', '崖']],
  ['meadow', ['金穗草原', '草原', '草地']],
  ['shrub', ['荆棘灌丛', '灌丛', '荆棘', '灌木']],
  ['ruins', ['寂石荒地', '荒地', '石地']],
];

const speciesPattern = SPECIES_WORDS.flatMap(([, words]) => words)
  .sort((a, b) => b.length - a.length)
  .join('|');
const CLAIM = new RegExp(`我(?:真的|其实|就|才|确实|也)?(不)?是(?:一只|一头|一条|只|头|条|个)?(${speciesPattern})`);
const HOSTILE = /咬|捕食|攻击|吃了|吃掉|袭击|下手|下了手|是狼|捕食者|天敌|凶手|小心|危险|可疑|怀疑|不太信|别信|记住你|骗|说谎/;
const QUESTION = /[?？吗呢]|谁|哪|什么|几号|是不是/;

export type Question = 'identity' | 'location' | 'suspect' | null;

export interface Statement {
  claim: SpeciesId | null;
  region: RegionId | null;
  /** Seats the speaker paints as dangerous or dishonest. */
  accused: number[];
  question: Question;
  /** Seats mentioned anywhere in the text. */
  mentions: number[];
}

export function speciesFromWord(word: string): SpeciesId | null {
  for (const [id, words] of SPECIES_WORDS) if (words.includes(word)) return id;
  return null;
}

function findRegion(text: string): RegionId | null {
  let best: { id: RegionId; at: number; len: number } | null = null;
  for (const [id, words] of REGION_WORDS) {
    for (const word of words) {
      const at = text.indexOf(word);
      if (at !== -1 && (!best || word.length > best.len)) best = { id, at, len: word.length };
    }
  }
  return best?.id ?? null;
}

function findSeats(text: string, view: GameView): number[] {
  const seats = new Set<number>();
  for (const match of text.matchAll(/([1-8])\s*号/g)) seats.add(Number(match[1]));
  for (const p of view.players) if (p.name.length >= 2 && text.includes(p.name)) seats.add(p.seat);
  return [...seats];
}

export function parseStatement(text: string, view: GameView): Statement {
  const claimMatch = text.match(CLAIM);
  const claim = claimMatch && !claimMatch[1] ? speciesFromWord(claimMatch[2]) : null;
  const mentions = findSeats(text, view);
  const asking = QUESTION.test(text);
  let question: Question = null;
  if (asking) {
    if (/去哪|在哪|哪里|哪儿|位置|往哪|落脚|投放/.test(text)) question = 'location';
    else if (/谁是|怀疑|可疑|哪个|危险|天敌|捕食者/.test(text)) question = 'suspect';
    else if (/你是|身份|什么动物|是不是/.test(text)) question = 'identity';
  }
  return {
    claim,
    region: findRegion(text),
    accused: HOSTILE.test(text) && (!asking || /说谎|骗|咬|攻击|捕食/.test(text)) ? mentions : [],
    question,
    mentions,
  };
}

export const tag = (p: { seat: number; name: string }) => `${p.seat}号${p.name}`;
export const regionName = (id: RegionId) => region(id).name;
export const speciesName = (id: SpeciesId) => species(id).name;

/** Keeps generated lines inside the 50-character message limit. */
export function clip(text: string): string {
  const chars = [...text];
  return chars.length <= 50 ? text : chars.slice(0, 49).join('') + '…';
}

export function choose<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)];
}

/**
 * Lines computer players say. Each family must read back the way it is meant
 * (tests/bots.test.ts checks this): claims contain 我是…, accusations name the
 * seat with a hostile word, plans name the region, and nothing else claims an identity.
 */
export const PHRASES = {
  claim: [
    (s: string) => `我是${s}，只想安安静静找口吃的。`,
    (s: string) => `坦白说，我是${s}。大家别互相猜了。`,
    (s: string) => `我是${s}。谁对我动手，我会记住的。`,
    (s: string) => `我就是${s}，就这么简单。`,
    (s: string) => `我是${s}，不惹事，也不怕事。`,
    (s: string) => `先说清楚：我是${s}，别把我当猎物。`,
    (s: string) => `我是${s}。今晚只想填饱肚子。`,
    (s: string) => `我其实是${s}，信不信由你。`,
  ],
  plan: [
    (r: string) => `今晚我会去${r}。`,
    (r: string) => `我打算在${r}落脚，别跟我抢食物。`,
    (r: string) => `我去${r}，有同路的吗？`,
    (r: string) => `${r}。`,
    (r: string) => `今晚想去${r}碰碰运气。`,
    (r: string) => `我在${r}过夜，有事去那儿找我。`,
    (r: string) => `别问了，${r}。`,
  ],
  accuse: [
    (x: string) => `昨夜${x}咬了我！Ta 是捕食者，大家小心。`,
    (x: string) => `${x}昨晚对我下了手。别信 Ta 说的任何话。`,
    (x: string) => `我被${x}捕食过，这不是猜测。`,
    (x: string) => `${x}，我记住你了。`,
    (x: string) => `${x}咬了我一口，伤口还在。`,
    (x: string) => `昨晚袭击我的就是${x}，别被 Ta 骗了。`,
    (x: string) => `离${x}远点，Ta 昨夜咬了我。`,
  ],
  warn: [
    (r: string) => `昨晚${r}有我的天敌出没，草食的朋友当心。`,
    (r: string) => `${r}不安全，我亲自确认过。`,
    (r: string) => `${r}有捕食者的气息，今晚别去。`,
    (r: string) => `提醒一句：${r}昨夜有危险。`,
  ],
  suspect: [
    (x: string) => `我怀疑${x}不是看起来那么无害。`,
    (x: string) => `${x}的足迹太巧了，我不太信 Ta。`,
    (x: string) => `如果要我指一个可疑的人，我会指${x}。`,
    (x: string) => `${x}有点可疑。`,
    (x: string) => `${x}说话躲躲闪闪，我怀疑 Ta。`,
    (x: string) => `留意${x}，Ta 很可能是捕食者。`,
  ],
  saw: [
    (x: string, r: string) => `我在${r}看到了${x}的足迹。`,
    (x: string, r: string) => `昨晚${r}留下过${x}的痕迹，信不信由你。`,
    (x: string, r: string) => `${x}昨晚去过${r}，足迹还在。`,
  ],
  liar: [
    (x: string, s: string) => `${x}说自己是${s}？我才是${s}，Ta 在说谎。`,
    (x: string, s: string) => `两个${s}？我才是${s}。${x}，你骗得了别人骗不了我。`,
    (x: string, s: string) => `别信${x}，我才是${s}。`,
  ],
  mourn: [
    (x: string, s: string) => `${x}原来是${s}……愿荒野安息。`,
    (x: string, s: string) => `又少了一位。${x}是${s}，记住这点。`,
    (x: string, s: string) => `${x}倒下了，原来 Ta 是${s}。`,
  ],
  idle: [
    '痕迹可能是旧的，我不会只凭足迹判断。',
    '我打算避开人多的地方。',
    '谁愿意交换一下附近的线索？',
    '别急着相信我的投放位置。',
    '活到最后，比多走一步更重要。',
    '我不保证会待在原来的地方。',
    '食物越来越少了，大家各凭本事。',
    '风向变了，今晚可能不太平。',
    '我只相信自己看到的东西。',
    '说得越多，暴露得越多。',
    '夜还长，先保存体力。',
    '有食物的地方，往往也有獠牙。',
  ],
  replyIdentity: [
    (s: string) => `我是${s}。你呢？`,
    (s: string) => `我是${s}。换你说了。`,
    (s: string) => `告诉你也无妨：我是${s}。`,
    (s: string) => `我是${s}，可别告诉别人。`,
  ],
  replyDodge: ['身份这种事，等你先说。', '你先告诉我你是谁。', '现在说这个还太早。', '这可不能随便说。'],
  replyLocation: [
    (r: string) => `今晚大概去${r}。`,
    (r: string) => `我会在${r}附近。`,
    (r: string) => `${r}吧，你别跟我抢。`,
    (r: string) => `可能是${r}，到时候看情况。`,
  ],
  replyNoPlan: ['还没想好，看情况。', '不告诉你。', '去哪都一样危险。', '走到哪算哪。'],
  replySuspect: [(x: string) => `我最怀疑${x}。`, (x: string) => `说不准，但${x}有点可疑。`, (x: string) => `盯紧${x}，我不太信 Ta。`],
  replyNoSuspect: ['还看不出来，再观察一轮。', '我也在找答案。', '线索太少，不好乱说。'],
  ackPreyClaim: [
    (s: string) => `${s}啊……那今晚我们一起行动？你去哪？`,
    (s: string) => `原来是${s}。告诉我你的落脚点，我帮你望风。`,
    (s: string) => `难得遇到${s}，我们结伴吧，你在哪落脚？`,
  ],
  ackFriendClaim: [
    (s: string) => `原来你是${s}。我们别去同一个地方抢食物。`,
    (s: string) => `${s}？好，我们互通消息。`,
    (s: string) => `${s}啊，那我们算是同路人。`,
  ],
  ackPlanAvoid: [(r: string) => `好，那我避开${r}。`, (r: string) => `${r}归你，我去别处。`, (r: string) => `明白，今晚我不去${r}。`],
  ackPlanNote: [(r: string) => `收到，${r}。`, (r: string) => `${r}，记下了。`, (r: string) => `${r}是吧，我心里有数了。`],
  ackOther: ['嗯。荒野里谁都不能全信。', '我记下了。', '好。', '你说的我会考虑。', '有意思，继续说。'],
  defend: ['我不是捕食者，别冤枉我。', '血口喷人。看痕迹再说话。', '指控需要证据。', '冤枉！我只是路过。'],
  opener: ['想交换情报吗？你今晚去哪？', '我们结个盟吧。你是什么动物？', '我注意到了一些痕迹，想聊聊吗？', '你昨晚看到什么了吗？'],
} as const;
