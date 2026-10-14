/**
 * Optional WebMCP tools so a browser assistant can read what this player may
 * see and point at the map. They never commit moves or spend stamina.
 */
import { REGIONS } from '../game/data';
import type { GameView } from '../game/view';

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};

type ModelContext = { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> };

export function registerGameTools(read: () => GameView | null, select: (id: string) => void) {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const tools: Tool[] = [
    {
      name: 'inspect_food_chain_game',
      title: '查看我的食物链对局',
      description: '读取当前玩家有权看到的游戏状态。不会揭示其他玩家隐藏身份、远处痕迹或他人的私信。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => read() || { phase: 'home' },
    },
    {
      name: 'select_food_chain_region',
      title: '查看荒野地区',
      description: '在可见地图上选中一个地区以查看它。只改变地图选择，不会提交投放、移动或消耗体力。',
      inputSchema: {
        type: 'object',
        properties: { region: { type: 'string', enum: REGIONS.map(r => r.id) } },
        required: ['region'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: input => {
        const id = input && typeof input === 'object' && 'region' in input ? (input as { region: unknown }).region : null;
        if (typeof id !== 'string' || !REGIONS.some(r => r.id === id)) throw new Error('请选择有效地区。');
        select(id);
        return { selected: id, committed: false };
      },
    },
  ];
  for (const tool of tools) {
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
    } catch {
      // Optional progressive enhancement.
    }
  }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
