/**
 * Keeps React Flow nodes and edges (and the handle sets) identical across compiles while they draw
 * the same (internal). Every compile gives fresh model objects, and their source spans shift
 * whenever text above them changes; without this, a keystroke in a 600-table schema draws every
 * table card and ref line again. With it, React Flow and the memoised cards skip what did not
 * change.
 */

const isPlain = (o: object): boolean => {
  const p: unknown = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
};

/**
 * Deep equality of plain data (objects, arrays, primitives), ignoring every `span` key (source
 * positions). Other objects (Map, Set, functions, class instances) are equal only when identical.
 */
export function sameIgnoringSpans(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameIgnoringSpans(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b) || !isPlain(a) || !isPlain(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  for (const k of ka) {
    if (k === 'span') continue;
    if (!Object.hasOwn(rb, k) || !sameIgnoringSpans(ra[k], rb[k])) return false;
  }
  return true;
}

/** Keys React Flow adds to the nodes it was given (measured size, selection, gesture state). */
const FLOW_KEYS = new Set(['measured', 'selected', 'dragging', 'resizing']);

/**
 * `next` with each element replaced by the element of `prev` with the same id when it draws the
 * same (`sameIgnoringSpans`). `prev` may hold what React Flow made of the elements given last time:
 * the keys it adds (measured size, selection, gesture state) are not compared and stay with the
 * element kept, and an element in a drag or resize is never kept. Returns `prev` itself when every
 * element is kept, in the same order.
 */
export function reuseUnchanged<T extends { id: string }>(
  prev: readonly T[],
  next: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const p of prev) byId.set(p.id, p);
  let all = prev.length === next.length;
  const out = next.map((n, i) => {
    const p = byId.get(n.id);
    const keep = p !== undefined && sameElement(p, n);
    if (!keep || prev[i] !== p) all = false;
    return keep ? p : n;
  });
  return all ? (prev as T[]) : out;
}

function sameElement(prev: object, next: object): boolean {
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  if (p.dragging === true || p.resizing === true) return false;
  for (const k of Object.keys(n)) {
    if (FLOW_KEYS.has(k)) continue;
    if (!Object.hasOwn(p, k) || !sameIgnoringSpans(p[k], n[k])) return false;
  }
  for (const k of Object.keys(p)) if (!FLOW_KEYS.has(k) && !Object.hasOwn(n, k)) return false;
  return true;
}

/** Whether two sets have the same members. */
export function sameSet<V>(a: ReadonlySet<V>, b: ReadonlySet<V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of b) if (!a.has(v)) return false;
  return true;
}

/**
 * `next` with each set replaced by `prev`'s set for the same key when it has the same members;
 * `prev` itself when nothing changed.
 */
export function reuseSets<K, V>(
  prev: ReadonlyMap<K, ReadonlySet<V>>,
  next: ReadonlyMap<K, ReadonlySet<V>>,
): ReadonlyMap<K, ReadonlySet<V>> {
  let all = prev.size === next.size;
  const out = new Map<K, ReadonlySet<V>>();
  for (const [k, s] of next) {
    const p = prev.get(k);
    const keep = p !== undefined && sameSet(p, s);
    if (!keep) all = false;
    out.set(k, keep ? p : s);
  }
  return all ? prev : out;
}
