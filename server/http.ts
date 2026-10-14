import { RULES } from '../src/game/data';
import { cleanName } from '../src/game/engine';

export const MAX_BODY = 2048;

export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function playerName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > RULES.nameLength) {
    throw new Error(`请输入 1–${RULES.nameLength} 字的玩家代号。`);
  }
  return cleanName(value);
}

/** Reads a small JSON object body, refusing anything larger than MAX_BODY bytes. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new Error('请求过长。');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error('请求过长。');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('无效请求。');
  return parsed as Record<string, unknown>;
}
