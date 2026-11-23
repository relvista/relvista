import type { ReactNode } from 'react';
import DbmlDiagram from '@theme/DbmlDiagram';
import DbmlDiff from '@theme/DbmlDiff';
import { parseDbmlMeta, splitDiffFence } from '../meta.js';
import type { DbmlFenceProps } from './fence.js';

const DBML_DIFF_CLASS = /(?:^|\s)language-dbml-diff(?:\s|$)/;

/**
 * A ` ```dbml ` fence as a diagram, a ` ```dbml-diff ` fence (old and new version separated by a
 * line `---`) as a schema diff, a ` ```dbml static ` fence as the site's code block. The MDX `code`
 * stub (theme/MDXComponents/Code) renders it for fences whose text is plain.
 */
export default function DbmlFence({ original: Original, ...props }: DbmlFenceProps): ReactNode {
  const c = props.children;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.join('') : '';
  const meta = parseDbmlMeta(props.metastring);
  if (meta.static) return <Original {...props} />;
  const title = meta.title ?? (typeof props.title === 'string' ? props.title : undefined);
  if (DBML_DIFF_CLASS.test(props.className ?? '')) {
    // Without a `---` line the whole body is the new version, and the diff says the old is missing.
    const parts = splitDiffFence(text) ?? { new: text.replace(/\n$/, '') };
    return (
      <DbmlDiff
        {...parts}
        title={title}
        height={meta.height}
        view={meta.view}
        layout={meta.layout}
        detailLevel={meta.detailLevel}
        ssr={meta.ssr}
        frozen={meta.frozen}
        id={meta.id}
        summary={meta.summary}
      />
    );
  }
  return (
    <DbmlDiagram
      value={text.replace(/\n$/, '')}
      title={title}
      height={meta.height}
      view={meta.view}
      layout={meta.layout}
      source={meta.source}
      detailLevel={meta.detailLevel}
      ssr={meta.ssr}
      frozen={meta.frozen}
      id={meta.id}
    />
  );
}
