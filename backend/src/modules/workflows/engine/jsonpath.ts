/**
 * Minimal JSONPath resolver: supports `$.foo`, `$.foo.bar`, `$.arr[0]`.
 * Returns `undefined` if any segment is missing.
 */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  if (!path || path === '$') return obj;
  if (!path.startsWith('$')) return undefined;
  let cursor: any = obj;
  const segments = path.slice(1).split('.').filter(Boolean);
  for (const seg of segments) {
    if (cursor == null) return undefined;
    const m = /^(.+?)(?:\[(\d+)\])?$/.exec(seg);
    if (!m) return undefined;
    cursor = cursor[m[1]];
    if (m[2] !== undefined) cursor = cursor?.[parseInt(m[2], 10)];
  }
  return cursor;
}
