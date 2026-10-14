export const REGIONS = [
  { id: 'forest', name: '雾松林', short: '森林', icon: '♧', x: 25, y: 31, adjacent: ['river', 'cliff', 'shrub'], description: '林影交错，进入的人都会留下足迹。' },
  { id: 'river', name: '月影河谷', short: '河谷', icon: '≈', x: 49, y: 44, adjacent: ['forest', 'cliff', 'meadow'], description: '水源将猎物与猎手引到同一处。' },
  { id: 'cliff', name: '回声山崖', short: '山崖', icon: '△', x: 73, y: 23, adjacent: ['forest', 'river', 'meadow'], description: '这里没有草食资源，只有风与回声。' },
  { id: 'meadow', name: '金穗草原', short: '草原', icon: '✳', x: 77, y: 62, adjacent: ['cliff', 'river', 'ruins'], description: '开阔草地上的一口食物，也可能是诱饵。' },
  { id: 'shrub', name: '荆棘灌丛', short: '灌丛', icon: '❋', x: 24, y: 67, adjacent: ['forest', 'ruins'], description: '道路狭窄。藏好足迹，再相信你的直觉。' },
  { id: 'ruins', name: '寂石荒地', short: '荒地', icon: '◇', x: 51, y: 82, adjacent: ['shrub', 'meadow'], description: '贫瘠的缓冲地带，连接灌丛与草原。' },
] as const;
export type RegionId = typeof REGIONS[number]['id'];
export const SPECIES = [
  { id: 'wolf', name: '灰狼', emoji: '🐺', title: '循迹的猎手', diet: 'hunt', hp: 5, sp: 4, hunger: 1, damage: 2, prey: ['deer', 'rabbit', 'boar'], skill: '嗅觉', skillText: '感知当前地区及相邻地区可捕食生物的总数。', color: '#a9bac1' },
  { id: 'fox', name: '赤狐', emoji: '🦊', title: '秘密的交易者', diet: 'hunt', hp: 4, sp: 5, hunger: 2, damage: 1, prey: ['rabbit', 'snake'], skill: '窃听', skillText: '读取本局一条涉及同地区其他玩家的历史私信。', color: '#dd925d' },
  { id: 'lynx', name: '山猫', emoji: '🐱', title: '无声的伏击者', diet: 'hunt', hp: 4, sp: 4, hunger: 2, damage: 1, prey: ['rabbit', 'crow', 'fox'], skill: '蓄势', skillText: '本回合下一次成功捕食伤害增加 1。', color: '#cdb185' },
  { id: 'snake', name: '游蛇', emoji: '🐍', title: '耐心的潜伏者', diet: 'hunt', hp: 3, sp: 4, hunger: 2, damage: 1, prey: ['rabbit', 'crow'], skill: '伏击', skillText: '抹除当前地区痕迹，下一次成功捕食伤害增加 1。', color: '#a4b577' },
  { id: 'rabbit', name: '野兔', emoji: '🐇', title: '林间的幸存者', diet: 'plant', hp: 4, sp: 5, hunger: 2, damage: 0, prey: [], skill: '疾跃', skillText: '跳到选定的相邻地区，抹除出发地与目的地的足迹。', color: '#ded4bc' },
  { id: 'deer', name: '麋鹿', emoji: '🦌', title: '警觉的漫游者', diet: 'plant', hp: 5, sp: 4, hunger: 2, damage: 0, prey: [], skill: '警觉', skillText: '得知当前地区是否有能够捕食自己的天敌。', color: '#c6a675' },
  { id: 'boar', name: '野猪', emoji: '🐗', title: '坚韧的守地者', diet: 'plant', hp: 5, sp: 4, hunger: 2, damage: 0, prey: [], skill: '硬皮', skillText: '本回合受到的每次捕食伤害减少 1，最低为 1。', color: '#b6a69d' },
  { id: 'crow', name: '渡鸦', emoji: '🐦‍⬛', title: '终局的见证者', diet: 'scavenge', hp: 3, sp: 5, hunger: 3, damage: 0, prey: [], skill: '俯瞰', skillText: '查看任意指定地区的痕迹，不会揭示真实位置。', color: '#a4a8be' },
] as const;
export type SpeciesId = typeof SPECIES[number]['id'];
export const species = (id: string) => SPECIES.find(s => s.id === id)!;
export const region = (id: string) => REGIONS.find(r => r.id === id)!;
export const PHASES = [
  { id: 'talk', name: '公共交流', seconds: 90, hint: '加入语音交换信息，或用公开消息试探。准备好可提前结束。' },
  { id: 'drop', name: '秘密投放', seconds: 40, hint: '选择本回合的初始地区。所有人锁定后，投放位置会公开。' },
  { id: 'action', name: '自由行动', seconds: 60, hint: '本回合有 2 次行动。移动、技能、躲藏与尖叫各消耗 1 SP。' },
  { id: 'traces', name: '观察痕迹', seconds: 25, hint: '只能查看当前位置和相邻地区的痕迹。足迹不等于实时位置。' },
  { id: 'call', name: '私下通话', seconds: 30, hint: '按席位依次选择通话对象。双方接受后通话 30 秒，各消耗一次机会。' },
  { id: 'food', name: '获取食物', seconds: 40, hint: '选择捕食、采食、食腐或放弃。锁定后按轮换顺序结算。' },
  { id: 'settle', name: '生存结算', seconds: 15, hint: '食物只恢复体力。达到饥饿周期会失去生命，七回合后结算。' },
] as const;
export type Phase = typeof PHASES[number]['id'] | 'lobby' | 'finished';
