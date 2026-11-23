import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import type { Props as MDXCodeProps } from '@theme/MDXComponents/Code';
import OriginalMDXCode from '@theme-init/MDXComponents/Code';
import { registeredDbmlFence, type DbmlFenceProps } from '../../../client/fence.js';

const DBML_CLASS = /(?:^|\s)language-dbml(?:-diff)?(?:\s|$)/;

function isText(children: ReactNode): boolean {
  return (
    typeof children === 'string' ||
    (Array.isArray(children) && children.every((c) => typeof c === 'string'))
  );
}

/** MDX passes the fence's info string after the language as `metastring`. */
type Props = MDXCodeProps & { metastring?: string; title?: unknown };

const Original = OriginalMDXCode as unknown as ComponentType<Record<string, unknown>>;

// Only for MDX the plugin's loader did not see (it registers the fence component before the page
// renders, see client/fence.ts): loaded on demand, the code block shows until then. It also makes
// the fence chunk exist on every site, which `themeChunkGroup` (src/index.ts) relies on.
const LazyFence = lazy(
  () => import(/* webpackChunkName: "relvista-fence" */ '../../../client/DbmlFence.js'),
);

/**
 * Wraps the MDX `code` element (`@theme-init/MDXComponents/Code`): a ` ```dbml ` fence becomes a
 * diagram and a ` ```dbml-diff ` fence (old and new version separated by a line `---`) a schema
 * diff; every other fence goes on to the site's `CodeBlock` unchanged.
 *
 * This component is on every MDX page, so it stays a stub: the diagram code (client/DbmlFence)
 * is loaded by the pages that have a dbml fence, before they render (the plugin's MDX loader,
 * loaders/fence-import, adds the import), so pages without diagrams load none of it.
 *
 * relvista hooks in here rather than at `@theme/CodeBlock` on purpose. `CodeBlock` is where other
 * plugins (`@docusaurus/theme-live-codeblock`) and sites (`swizzle CodeBlock --wrap`) add their own
 * behaviour, and only one `@theme-init/CodeBlock` wrapper can be active: two plugins wrapping it
 * silently disable one another. Nothing else wraps `MDXComponents/Code`, so relvista, live code
 * blocks, mermaid and a site's own `CodeBlock` wrapper all work together, whatever their order
 * (relvista only has to load after the classic theme, see `registrationProblem`).
 * `<CodeBlock language="dbml">` and ` ```dbml static ` stay code.
 */
export default function MDXCodeWithDbml(props: Props): ReactNode {
  if (!DBML_CLASS.test(props.className ?? '') || !isText(props.children))
    return <OriginalMDXCode {...props} />;
  const fenceProps = { ...props, original: Original } as DbmlFenceProps;
  const Fence = registeredDbmlFence();
  if (Fence) return <Fence {...fenceProps} />;
  return (
    <Suspense fallback={<OriginalMDXCode {...props} />}>
      <LazyFence {...fenceProps} />
    </Suspense>
  );
}
