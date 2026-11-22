import { compileDbml, type DiagramModel } from '@relvista/core';
import { describe, expect, it } from 'vitest';
import { reuseSets, reuseUnchanged, sameIgnoringSpans, sameSet } from '../src/canvas/stable.js';

const SPAN_A = { file: 'a.dbml', start: { line: 1, column: 1 }, end: { line: 2, column: 1 } };
const SPAN_B = { file: 'a.dbml', start: { line: 9, column: 1 }, end: { line: 12, column: 1 } };

function compiled(source: string): DiagramModel {
  const { model } = compileDbml(source);
  if (!model) throw new Error('no model');
  return model;
}

const SCHEMA = `Table users {
  id int [pk]
  name varchar [note: 'display name']
}

Table posts {
  id int [pk]
  user_id int [ref: > users.id]
}
`;

describe('sameIgnoringSpans', () => {
  it('compares plain data deeply and skips every span key', () => {
    expect(sameIgnoringSpans({ a: 1, b: [1, { c: 'x' }] }, { a: 1, b: [1, { c: 'x' }] })).toBe(
      true,
    );
    expect(
      sameIgnoringSpans(
        { id: 't', span: SPAN_A, columns: [{ name: 'id', span: SPAN_A }] },
        { id: 't', span: SPAN_B, columns: [{ name: 'id', span: SPAN_B }] },
      ),
    ).toBe(true);
    expect(sameIgnoringSpans({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameIgnoringSpans([1, 2], [2, 1])).toBe(false);
    expect(sameIgnoringSpans([1], [1, 1])).toBe(false);
    expect(sameIgnoringSpans([1], { 0: 1 })).toBe(false);
    expect(sameIgnoringSpans(null, {})).toBe(false);
    expect(sameIgnoringSpans(undefined, null)).toBe(false);
    expect(sameIgnoringSpans('1', 1)).toBe(false);
  });

  it('tells a missing key from an undefined one', () => {
    expect(sameIgnoringSpans({ a: undefined }, {})).toBe(false);
    expect(sameIgnoringSpans({}, { a: undefined })).toBe(false);
    expect(sameIgnoringSpans({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('treats Maps, Sets, functions and class instances as equal only when identical', () => {
    const s = new Set([1]);
    expect(sameIgnoringSpans({ s }, { s })).toBe(true);
    expect(sameIgnoringSpans({ s }, { s: new Set([1]) })).toBe(false);
    expect(sameIgnoringSpans(new Map(), new Map())).toBe(false);
    const f = () => 1;
    expect(sameIgnoringSpans([f], [f])).toBe(true);
    expect(sameIgnoringSpans([f], [() => 1])).toBe(false);
    class P {
      x = 1;
    }
    expect(sameIgnoringSpans(new P(), new P())).toBe(false);
    expect(sameIgnoringSpans(Object.create(null), {})).toBe(true);
  });

  it('finds the tables of two compiles equal when only the text above them moved', () => {
    const a = compiled(SCHEMA);
    const b = compiled(`// a comment\n\n${SCHEMA}`);
    expect(b.tables[0]!.span).not.toEqual(a.tables[0]!.span);
    expect(a.tables.map((t, i) => sameIgnoringSpans(t, b.tables[i]))).toEqual([true, true]);
    expect(sameIgnoringSpans(a.refs, b.refs)).toBe(true);
    const c = compiled(SCHEMA.replace("'display name'", "'shown name'"));
    expect(a.tables.map((t, i) => sameIgnoringSpans(t, c.tables[i]))).toEqual([false, true]);
  });
});

interface El {
  id: string;
  data: { v: number; span?: typeof SPAN_A };
  measured?: { width: number; height: number };
  selected?: boolean;
  dragging?: boolean;
  resizing?: boolean;
}

describe('reuseUnchanged', () => {
  const el = (id: string, v: number, extra: Partial<El> = {}): El => ({
    id,
    data: { v },
    ...extra,
  });

  it('returns the previous array when every element draws the same', () => {
    const prev = [el('a', 1), el('b', 2)];
    const next = [el('a', 1), el('b', 2)];
    expect(reuseUnchanged(prev, next)).toBe(prev);
    expect(reuseUnchanged([], [])).toEqual([]);
  });

  it('keeps the unchanged elements and takes the changed, added and moved ones', () => {
    const a = el('a', 1);
    const b = el('b', 2);
    const c = el('c', 3);
    const next = [el('b', 2), el('a', 9), el('d', 4)];
    const out = reuseUnchanged([a, b, c], next);
    expect(out).not.toBe(next);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(next[1]);
    expect(out[2]).toBe(next[2]);
    // Same elements in another order: a new array of the old elements.
    const swapped = reuseUnchanged([a, b], [el('b', 2), el('a', 1)]);
    expect(swapped).toEqual([b, a]);
    expect(swapped[0]).toBe(b);
    // One element fewer.
    const fewer = reuseUnchanged([a, b], [el('a', 1)]);
    expect(fewer).toHaveLength(1);
    expect(fewer[0]).toBe(a);
  });

  it('ignores spans and what React Flow added (size, selection), and keeps it', () => {
    const shown = el('a', 1, { measured: { width: 10, height: 20 }, selected: true });
    shown.data.span = SPAN_A;
    const next = el('a', 1);
    next.data.span = SPAN_B;
    const [kept] = reuseUnchanged([shown], [next]);
    expect(kept).toBe(shown);
    expect(kept!.measured).toEqual({ width: 10, height: 20 });
  });

  it('never keeps an element in a drag or resize, nor one with other keys', () => {
    for (const gesture of [{ dragging: true }, { resizing: true }]) {
      const next = el('a', 1);
      expect(reuseUnchanged([el('a', 1, gesture)], [next])[0]).toBe(next);
    }
    const settled = el('a', 1, { dragging: false });
    expect(reuseUnchanged([settled], [el('a', 1)])[0]).toBe(settled);
    const extra = { ...el('a', 1), hidden: true };
    const next = el('a', 1);
    expect(reuseUnchanged([extra], [next])[0]).toBe(next);
    expect(reuseUnchanged([el('a', 1)], [extra])[0]).toBe(extra);
  });
});

describe('sameSet / reuseSets', () => {
  it('compares members', () => {
    expect(sameSet(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameSet(new Set([1, 2]), new Set([1]))).toBe(false);
    expect(sameSet(new Set([1, 3]), new Set([1, 2]))).toBe(false);
  });

  it('keeps the sets with the same members, and the map when nothing changed', () => {
    const x = new Set(['h-l-s']);
    const y = new Set(['c0-r-t']);
    const prev = new Map([
      ['a', x],
      ['b', y],
    ]);
    const same = new Map([
      ['b', new Set(['c0-r-t'])],
      ['a', new Set(['h-l-s'])],
    ]);
    expect(reuseSets(prev, same)).toBe(prev);
    const changed = reuseSets(
      prev,
      new Map([
        ['a', new Set(['h-l-s'])],
        ['b', new Set(['c1-r-t'])],
      ]),
    );
    expect(changed).not.toBe(prev);
    expect(changed.get('a')).toBe(x);
    expect(changed.get('b')).not.toBe(y);
    const grown = reuseSets(prev, new Map([...same, ['c', new Set(['x'])]]));
    expect(grown).not.toBe(prev);
    expect(grown.get('a')).toBe(x);
    expect(grown.get('b')).toBe(y);
    const shrunk = reuseSets(prev, new Map([['a', new Set(['h-l-s'])]]));
    expect(shrunk).not.toBe(prev);
    expect([...shrunk.keys()]).toEqual(['a']);
  });
});
