// The slot between the MDX `code` hook (theme/MDXComponents/Code, on every MDX page) and the
// diagram code (client/DbmlFence, loaded only by pages with a ```dbml fence). Kept tiny on purpose:
// it is part of every MDX page's JavaScript.
import type { ComponentType, ReactNode } from 'react';

/** Props of the MDX `code` element as the fence component receives them. */
export interface DbmlFenceProps {
  className?: string;
  /** The fence's info string after the language. */
  metastring?: string;
  title?: unknown;
  children?: ReactNode;
  /** `@theme-init/MDXComponents/Code`: the site's code element, for fences that stay code. */
  original: ComponentType<Record<string, unknown>>;
  [prop: string]: unknown;
}

let fence: ComponentType<DbmlFenceProps> | null = null;

/**
 * Called by the lines the plugin's MDX loader (loaders/fence-import) adds to a page with a ```dbml
 * or ```dbml-diff fence, before the page renders (and hydrates).
 */
export function registerDbmlFence(component: ComponentType<DbmlFenceProps>): void {
  fence = component;
}

/** The fence component once a page that needs it has loaded it, else null. */
export function registeredDbmlFence(): ComponentType<DbmlFenceProps> | null {
  return fence;
}
