/** Options parsed from a ` ```dbml ` fence's meta string. */
export interface DbmlFenceMeta {
  title?: string;
  height?: number | string;
  view?: string;
  /** URL of a layout file served by the site, e.g. `/layouts/shop.dbml.layout.json`. */
  layout?: string;
  /** Show "Diagram" / "Source" tabs. */
  source?: boolean;
  /** Render the fence as plain highlighted code instead of a diagram. */
  static?: boolean;
  detailLevel?: 'all' | 'keys' | 'names';
  /** Draw the diagram into the page's HTML at build time (`ssr=false` turns it off). */
  ssr?: boolean;
  /**
   * Lock the layout (`frozen`) or let readers drag tables right away (`frozen=false`). Overrides
   * `themeConfig.dbml.frozen`.
   */
  frozen?: boolean;
  /** The diagram's anchor on the page (`id="billing"` → `#billing`). */
  id?: string;
  /** ` ```dbml-diff ` only: show the change list under the diagram (`summary=false` hides it). */
  summary?: boolean;
}

const TOKEN = /([A-Za-z][\w-]*)(?:\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)))?/g;

function unescape(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

function flag(raw: string | undefined): boolean {
  return raw === undefined || !/^(false|0|no|off)$/i.test(raw);
}

/**
 * Parses `title="Billing" height=500 view="Billing" layout="/shop.layout.json" source ssr=false frozen=false id="billing"`.
 * Values may be double-quoted, single-quoted or bare; a bare key is a `true` flag. Unknown keys are
 * ignored, so other remark plugins can share the meta string.
 */
export function parseDbmlMeta(metastring: string | undefined | null): DbmlFenceMeta {
  const out: DbmlFenceMeta = {};
  if (!metastring) return out;
  for (const m of metastring.matchAll(TOKEN)) {
    const key = m[1]!.toLowerCase();
    const quoted = m[2] ?? m[3];
    const raw = quoted !== undefined ? unescape(quoted) : m[4];
    switch (key) {
      case 'title':
        if (raw !== undefined) out.title = raw;
        break;
      case 'height':
        if (raw !== undefined && raw !== '')
          out.height = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
        break;
      case 'view':
        if (raw) out.view = raw;
        break;
      case 'layout':
        if (raw) out.layout = raw;
        break;
      case 'source':
        out.source = flag(raw);
        break;
      case 'static':
        out.static = flag(raw);
        break;
      case 'ssr':
        out.ssr = flag(raw);
        break;
      case 'frozen':
        out.frozen = flag(raw);
        break;
      case 'id':
        if (raw && raw.trim()) out.id = raw.trim();
        break;
      case 'summary':
        out.summary = flag(raw);
        break;
      case 'detail':
      case 'detaillevel':
        if (raw === 'all' || raw === 'keys' || raw === 'names') out.detailLevel = raw;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * The two versions of a ` ```dbml-diff ` fence: the text before and after the first line that is
 * exactly `---` (three dashes alone on the line; CRLF line endings are fine). Null when the fence
 * has no such line.
 */
export function splitDiffFence(text: string): { old: string; new: string } | null {
  const m = /^---(?=\r?\n|$)/m.exec(text);
  if (!m) return null;
  const before = text.slice(0, m.index).replace(/\r?\n$/, '');
  const after = text
    .slice(m.index + m[0].length)
    .replace(/^\r?\n/, '')
    .replace(/\r?\n$/, '');
  return { old: before, new: after };
}
