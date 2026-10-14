/**
 * One icon vocabulary for the whole interface. Components ask for a meaning
 * ("hp", "hide", "forest") instead of a drawing, so the set stays consistent.
 */
import {
  ArrowRight,
  Ban,
  BatteryWarning,
  Bone,
  BookOpen,
  Bot,
  Bug,
  Check,
  CircleDashed,
  CircleQuestionMark,
  Copy,
  Crosshair,
  Crown,
  Download,
  Drumstick,
  EllipsisVertical,
  Eye,
  EyeOff,
  FastForward,
  Flame,
  Footprints,
  Heart,
  HeartCrack,
  Hourglass,
  House,
  Leaf,
  Lightbulb,
  Lock,
  LogOut,
  MapPinned,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Mic,
  Moon,
  MoonStar,
  Mountain,
  PawPrint,
  Phone,
  RotateCcw,
  ScanEye,
  ScrollText,
  Search,
  SendHorizontal,
  Shrub,
  Shuffle,
  Skull,
  Sparkles,
  Stone,
  Sunrise,
  Swords,
  Timer,
  Trees,
  Trophy,
  Users,
  Utensils,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  WavesHorizontal,
  Wheat,
  Wifi,
  WifiOff,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-preact';
import type { FoodChoice, PhaseId, RegionId, SpeciesId } from '../game/data';
import type { ViewEntry } from '../game/view';

const ICONS = {
  // regions
  forest: Trees,
  river: WavesHorizontal,
  cliff: Mountain,
  meadow: Wheat,
  shrub: Shrub,
  ruins: Stone,
  // phases
  talk: MessagesSquare,
  drop: MapPinned,
  action: Footprints,
  traces: ScanEye,
  call: Phone,
  food: Utensils,
  settle: MoonStar,
  // vitals
  hp: Heart,
  sp: Zap,
  hunger: Hourglass,
  // actions and food
  move: Footprints,
  hide: EyeOff,
  skill: Sparkles,
  scream: Megaphone,
  hunt: Crosshair,
  forage: Leaf,
  smallPrey: Bug,
  scavenge: Bone,
  skip: Ban,
  // journal
  round: Moon,
  reveal: MapPinned,
  death: Skull,
  finish: Sunrise,
  overdraw: BatteryWarning,
  hit: Swords,
  attacked: HeartCrack,
  miss: CircleDashed,
  fed: Drumstick,
  starved: UtensilsCrossed,
  clue: Search,
  public: MessageCircle,
  private: Lock,
  // interface
  rules: BookOpen,
  bestiary: PawPrint,
  soundOn: Volume2,
  soundOff: VolumeX,
  leave: LogOut,
  menu: EllipsisVertical,
  copy: Copy,
  online: Wifi,
  offline: WifiOff,
  people: Users,
  host: Crown,
  bot: Bot,
  voice: Mic,
  timer: Timer,
  send: SendHorizontal,
  random: Shuffle,
  check: Check,
  close: X,
  next: ArrowRight,
  fastForward: FastForward,
  download: Download,
  journal: ScrollText,
  again: RotateCcw,
  home: House,
  lock: Lock,
  tip: Lightbulb,
  camp: Flame,
  trophy: Trophy,
  eye: Eye,
  unknown: CircleQuestionMark,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, class: cls, label }: { name: IconName; size?: number; class?: string; label?: string }) {
  const Svg = ICONS[name];
  return (
    <Svg
      size={size}
      strokeWidth={1.9}
      class={cls ? `icon ${cls}` : 'icon'}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}

export const regionIcon = (id: RegionId): IconName => id;
export const phaseIcon = (id: PhaseId): IconName => id;

export function foodIcon(choice: FoodChoice, animal: SpeciesId): IconName {
  if (choice === 'forage' && animal === 'snake') return 'smallPrey';
  return choice;
}

const TAG_ICON: Partial<Record<NonNullable<ViewEntry['tag']>, IconName>> = {
  round: 'round',
  reveal: 'reveal',
  death: 'death',
  finish: 'finish',
  move: 'move',
  hide: 'hide',
  scream: 'scream',
  skill: 'skill',
  overdraw: 'overdraw',
  'food-attempt': 'food',
  hit: 'hit',
  attacked: 'attacked',
  miss: 'miss',
  fed: 'fed',
  starved: 'starved',
  hunger: 'hunger',
};

export function entryIcon(entry: ViewEntry): IconName {
  if (entry.kind === 'public') return 'public';
  if (entry.kind === 'private') return 'private';
  return (entry.tag && TAG_ICON[entry.tag]) || 'clue';
}
