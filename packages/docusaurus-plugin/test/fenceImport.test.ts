// The MDX loader that makes pages with a ```dbml fence load the fence component themselves.
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import fenceImportLoader, { fenceImport } from '../src/loaders/fence-import.js';

/** A compiled MDX page with a code element of class `className` (as MDX and babel write it). */
const page = (className: string, text = 'Table a {}') =>
  `import { jsx as _jsx } from "react/jsx-runtime";
function _createMdxContent(props) {
  const _components = { code: "code", pre: "pre", ...props.components };
  return _jsx(_components.pre, { children: _jsx(_components.code, { className: "${className}", children: ${JSON.stringify(`${text}\n`)} }) });
}
export default function MDXContent(props = {}) { return _createMdxContent(props); }
`;

/** The string literals of the `import` statements and `import()` calls in `code`. */
const specifiers = (code: string) =>
  [...code.matchAll(/(?:from |import\((?:\/\*[^*]*\*\/ )?)("(?:[^"\\]|\\.)*")/g)].map(
    (m) => JSON.parse(m[1]!) as string,
  );

/** The plugin's client directory, and a module in it as a string literal. */
const dir = join(sep, 'lib', 'client');
const lit = (file: string) => JSON.stringify(join(dir, file));

describe('fenceImport', () => {
  it('leaves pages without a dbml fence alone', () => {
    expect(fenceImport(page('language-js'))).toBeNull();
    expect(fenceImport(page('language-dbmlx'))).toBeNull();
    // A fence that shows a dbml fence as text (```md around it) is not one.
    expect(fenceImport(page('language-md', '```dbml\nTable a {}\n```'))).toBeNull();
    // Not compiled MDX (a .md file another rule reads as text).
    expect(fenceImport('```dbml\nTable a {}\n```\nclassName: "language-dbml"')).toBeNull();
  });

  it('finds dbml and dbml-diff fences, whatever other classes the element has', () => {
    for (const c of ['language-dbml', 'language-dbml-diff', 'x language-dbml', 'language-dbml y'])
      expect(fenceImport(page(c))).not.toBeNull();
  });

  it('browser: waits for the fence component with a top-level await, in its own chunk', () => {
    const added = fenceImport(page('language-dbml'), {}, dir)!;
    expect(added).toContain(
      `import { registerDbmlFence as __relvistaRegister } from ${lit('fence.js')};`,
    );
    expect(added).toContain(
      `(await import(/* webpackChunkName: "relvista-fence" */ ${lit('DbmlFence.js')})).default`,
    );
    expect(added).toMatch(/__relvistaRegister\(\s*\(await import\([^)]*\)\)\.default,\s*\);/);
    // No static import of the component: it would join the page's own chunk.
    expect(added).not.toMatch(/import __RelvistaFence/);
  });

  it('server: imports it statically', () => {
    const added = fenceImport(page('language-dbml'), { server: true }, dir)!;
    expect(added).toContain(`import __RelvistaFence from ${lit('DbmlFence.js')};`);
    expect(added).toContain('__relvistaRegister(__RelvistaFence);');
    expect(added).not.toContain('await');
  });

  it('writes Windows paths as valid string literals', () => {
    const win = 'C:\\Users\\me\\site\\node_modules\\@relvista\\docusaurus-plugin\\lib\\client';
    for (const server of [false, true]) {
      const found = specifiers(fenceImport(page('language-dbml'), { server }, win)!);
      expect(found).toHaveLength(2);
      for (const s of found) expect(s.startsWith(`${win}\\`)).toBe(true);
    }
  });

  it('as a loader: appends to the source and passes the source map on', () => {
    const calls: unknown[][] = [];
    const ctx = {
      getOptions: () => ({ server: true }),
      callback: (...args: unknown[]) => void calls.push(args),
    };
    const map = { version: 3 };
    const source = page('language-dbml');
    fenceImportLoader.call(ctx, source, map);
    expect(calls[0]![0]).toBeNull();
    expect(String(calls[0]![1]).startsWith(source)).toBe(true);
    expect(String(calls[0]![1])).toContain('import __RelvistaFence');
    expect(calls[0]![2]).toBe(map);
    fenceImportLoader.call(ctx, page('language-js'), map);
    expect(calls[1]).toEqual([null, page('language-js'), map]);
  });
});
