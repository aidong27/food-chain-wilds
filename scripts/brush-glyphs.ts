/**
 * Prints every character the brush display face has to cover, for subsetting
 * the font in src/assets/fonts. The face is only used for names and headings,
 * so a few hundred glyphs keep the file small. Text set in it that is missing
 * here falls back to the system kai face, so keep this list in step with the
 * headings in src/ui:
 *
 *   npx tsx scripts/brush-glyphs.ts > /tmp/brush.txt
 *   pyftsubset MaShanZheng-Regular.ttf --text-file=/tmp/brush.txt --flavor=woff2 \
 *     --layout-features='*' --no-hinting --name-IDs='*' --output-file=src/assets/fonts/wilds-brush.woff2
 */
import { BOT_NAMES, PHASES, REGIONS, SPECIES } from '../src/game/data';

const HEADINGS = [
  // brand, home and lobby
  '食物链',
  '每一个秘密，都关乎生存。',
  '有人邀请你进入荒野。',
  '荒野居民',
  '一夜怎么过',
  '交流 秘密投放 行动 获取食物',
  '等待同伴入林',
  '正在进入荒野…',
  // match
  '第一二三四五六七八九十夜 开局之前',
  '你吃饱了，活过第夜',
  '你饿着肚子熬过第夜',
  '你在今夜倒下了',
  '你正在观战',
  // dialogs
  '生存手册 动物图鉴 菜单 本局完整记录 离开这场对局？',
  '六十秒上手',
  '号 · 与 Ta 有关的记录',
  // finish
  '你听见了第八日的风。',
  '荒野记得你的足迹。',
  '终局排名',
];

const text = [
  ...HEADINGS,
  ...REGIONS.flatMap(r => [r.name, r.short]),
  ...SPECIES.map(s => s.name),
  ...PHASES.map(p => p.name),
  ...BOT_NAMES,
  '0123456789',
  '·…—，。、：？！「」（）',
].join('');

const glyphs = [...new Set(text.replace(/\s/g, ''))].sort().join('');
process.stdout.write(glyphs + '\n');
