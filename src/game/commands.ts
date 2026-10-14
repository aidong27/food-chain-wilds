/** Turns untrusted JSON from a socket into a well-typed Command, or throws. */
import { isRegion, isSpecies, type FoodChoice, type SpeciesId } from './data';
import { RuleError, type Command } from './types';

const FOODS: FoodChoice[] = ['hunt', 'forage', 'scavenge', 'skip'];
const MAX_FIELD = 200;

function invalid(): never {
  throw new RuleError('操作参数格式无效。');
}

function text(value: unknown, required = true): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > MAX_FIELD) invalid();
  return value;
}

export function parseCommand(input: unknown): Command {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const raw = input as Record<string, unknown>;
  switch (raw.type) {
    case 'start':
      if (raw.animal !== undefined && raw.animal !== '' && !isSpecies(raw.animal)) invalid();
      return { type: 'start', animal: isSpecies(raw.animal) ? raw.animal : undefined };
    case 'bots':
    case 'ready':
    case 'hangup':
    case 'hide':
    case 'scream':
      return { type: raw.type };
    case 'guess': {
      const animal = text(raw.animal);
      if (animal !== '' && !isSpecies(animal)) invalid();
      return { type: 'guess', target: text(raw.target), animal: animal as SpeciesId | '' };
    }
    case 'message':
      return { type: 'message', target: text(raw.target), text: text(raw.text) };
    case 'voice':
      if (typeof raw.joined !== 'boolean') invalid();
      return { type: 'voice', joined: raw.joined };
    case 'call':
      return { type: 'call', target: text(raw.target) };
    case 'call-answer':
      if (typeof raw.accept !== 'boolean') invalid();
      return { type: 'call-answer', accept: raw.accept };
    case 'drop':
    case 'move':
      if (!isRegion(raw.region)) throw new RuleError('请选择地图上的有效地区。');
      return { type: raw.type, region: raw.region };
    case 'skill':
      if (raw.region !== undefined && raw.region !== '' && !isRegion(raw.region)) invalid();
      return { type: 'skill', region: isRegion(raw.region) ? raw.region : undefined };
    case 'food': {
      if (!FOODS.includes(raw.choice as FoodChoice)) throw new RuleError('请选择有效的进食方式。');
      const target = text(raw.target, false);
      return { type: 'food', choice: raw.choice as FoodChoice, target: target || undefined };
    }
    default:
      throw new RuleError('未知操作。');
  }
}
