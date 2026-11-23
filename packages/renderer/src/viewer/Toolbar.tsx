import { DEFAULT_VIEW, type DetailLevel } from '@relvista/core';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { DETAIL_LEVELS } from '../nav/DetailSwitch.js';
import {
  CheckIcon,
  ChevronIcon,
  CollapseIcon,
  DownloadIcon,
  ExpandIcon,
  ExternalIcon,
  FitIcon,
  LayersIcon,
  LinkIcon,
  LockIcon,
  PrintIcon,
  RowsIcon,
  SearchIcon,
  UnlockIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './icons.js';

/**
 * A viewer toolbar button. `'lock'` (lock / unlock the layout) shows only in a `frozen` viewer
 * whose nodes can be dragged; `'link'` only with an `anchor`; `'open-in-editor'` only with an
 * `editorUrl`.
 */
export type ToolbarItem =
  | 'view'
  | 'search'
  | 'detail'
  | 'zoom'
  | 'fit'
  | 'lock'
  | 'fullscreen'
  | 'export'
  | 'print'
  | 'link'
  | 'open-in-editor';

/** Every toolbar item, in the default order (docs/design/phase3-v1.md §4.7). */
export const DEFAULT_TOOLBAR: ToolbarItem[] = [
  'view',
  'search',
  'detail',
  'zoom',
  'fit',
  'lock',
  'fullscreen',
  'export',
  'print',
  'link',
  'open-in-editor',
];

/** 'pdf' opens the PDF dialog. */
export type ExportKind = 'svg' | 'png' | 'pdf';

export interface ToolbarProps {
  items: readonly ToolbarItem[];
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  fullscreen: boolean;
  onToggleFullscreen(): void;
  onExport(kind: ExportKind): void;
  onPrint(): void;
  views: readonly string[];
  view: string;
  onViewChange(view: string): void;
  editorHref: string | null;
  /** 'search': opens the search panel. Without it the button is hidden. */
  onSearch?(): void;
  searchOpen?: boolean;
  /** 'detail': the current level and its setter. Without `onDetailChange` the menu is hidden. */
  detail?: DetailLevel;
  onDetailChange?(level: DetailLevel): void;
  /** 'link': copies a link to the diagram's current state. Without it the button is hidden. */
  onCopyLink?(): void;
  /** 'lock': whether the layout is locked now. */
  locked?: boolean;
  /** 'lock': locks or unlocks the layout. Without it the button is hidden. */
  onToggleLock?(): void;
  /** Offer "PDF…" in the export menu. Default true. */
  pdf?: boolean;
}

function Button({
  title,
  onClick,
  children,
  pressed,
  expanded,
  popup,
  buttonRef,
  item,
  shortcut,
}: {
  title: string;
  onClick(): void;
  children: ReactNode;
  pressed?: boolean;
  expanded?: boolean;
  popup?: 'menu' | 'dialog';
  buttonRef?: Ref<HTMLButtonElement>;
  /** Toolbar item this button belongs to (CSS hides some in narrow viewers). */
  item?: ToolbarItem;
  /** aria-keyshortcuts value. */
  shortcut?: string;
}): ReactElement {
  return (
    <button
      ref={buttonRef}
      data-rv-item={item}
      type="button"
      className="rv-tb-button"
      title={title}
      aria-label={title.replace(/ \(.*\)$/, '')}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={popup}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/**
 * A toolbar button with a menu: focus lands on the checked (or first) item when it opens; arrow
 * keys / Home / End move, Esc closes and returns to the button, Tab or a click outside closes.
 */
function MenuButton({
  title,
  label,
  icon,
  item,
  children,
}: {
  title: string;
  label: string;
  icon: ReactNode;
  item: ToolbarItem;
  children(close: () => void): ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // The menu hangs from the button's right edge; in a narrow viewer it would pass the viewer's
  // left edge, so it is shifted right to stay 8 px inside.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = wrap.current?.querySelector<HTMLElement>('[role="menu"]');
    const viewer = wrap.current?.closest('.rv-viewer');
    if (!menu || !viewer) return;
    menu.style.transform = '';
    const overflow = viewer.getBoundingClientRect().left + 8 - menu.getBoundingClientRect().left;
    if (overflow > 0) menu.style.transform = `translateX(${Math.ceil(overflow)}px)`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const menu = wrap.current?.querySelector('[role="menu"]');
    const target =
      menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>(MENU_ITEMS);
    target?.focus();
    const onMouse = (e: MouseEvent) => {
      if (wrap.current?.contains(e.target as globalThis.Node)) return;
      setOpen(false);
    };
    // Capture phase, so the menu sees Esc before the fullscreen overlay does; preventDefault
    // tells the overlay this press is taken (one layer closes per press).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(wrap.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') setOpen(false);
    // Arrow keys stay in the menu (the toolbar's own arrow keys do not apply here).
    if (e.key.startsWith('Arrow')) e.stopPropagation();
    if (next >= 0) {
      e.preventDefault();
      items[next]!.focus();
    }
  };

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div className="rv-tb-menu-wrap" ref={wrap}>
      <Button
        title={title}
        item={item}
        expanded={open}
        popup="menu"
        buttonRef={button}
        onClick={() => setOpen((m) => !m)}
      >
        {icon}
      </Button>
      {open ? (
        <div className="rv-tb-menu" role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ onSelect, children }: { onSelect(): void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" tabIndex={-1} onClick={onSelect}>
      {children}
    </button>
  );
}

/** Controls of the toolbar the arrow keys move between (menus and the view select excluded). */
const CONTROLS = '.rv-tb-button, .rv-tb-select select';

export function Toolbar(p: ToolbarProps): ReactElement {
  const has = (i: ToolbarItem) => p.items.includes(i);
  const root = useRef<HTMLDivElement>(null);

  /** ArrowLeft / ArrowRight / Home / End between the toolbar's buttons (Tab still works). */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const t = e.target as HTMLElement;
    // Inside a menu, or on the view select (arrow keys change its value on some platforms).
    if (t.closest('[role="menu"]') || t.tagName === 'SELECT') return;
    // Buttons narrow viewers hide (display: none) are skipped.
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>(CONTROLS) ?? []).filter(
      (el) => el === t || getComputedStyle(el).display !== 'none',
    );
    const i = items.indexOf(t);
    if (i < 0) return;
    const n = items.length;
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : n - 1;
    e.preventDefault();
    items[next]!.focus();
  };

  const groups: ReactNode[] = [];
  if (has('view') && p.views.length > 0) {
    groups.push(
      <label key="view" className="rv-tb-select" title="Diagram view">
        <LayersIcon />
        <select
          aria-label="Diagram view"
          value={p.view}
          onChange={(e) => p.onViewChange(e.target.value)}
        >
          <option value={DEFAULT_VIEW}>All tables</option>
          {p.views.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <ChevronIcon />
      </label>,
    );
  }

  const find: ReactNode[] = [];
  if (has('search') && p.onSearch) {
    find.push(
      <Button
        key="search"
        title="Search (/)"
        item="search"
        shortcut="/ Control+K Meta+K"
        expanded={!!p.searchOpen}
        onClick={p.onSearch}
      >
        <SearchIcon />
      </Button>,
    );
  }
  if (has('detail') && p.onDetailChange) {
    const current = p.detail ?? 'all';
    find.push(
      <MenuButton
        key="detail"
        title="Detail level"
        label="Detail level"
        item="detail"
        icon={<RowsIcon />}
      >
        {(close) =>
          DETAIL_LEVELS.map((d) => (
            <button
              key={d.value}
              type="button"
              role="menuitemradio"
              aria-checked={d.value === current}
              tabIndex={-1}
              className="rv-tb-menu-radio"
              onClick={() => {
                close();
                p.onDetailChange?.(d.value);
              }}
            >
              <span className="rv-tb-menu-check" aria-hidden="true">
                {d.value === current ? <CheckIcon /> : null}
              </span>
              <span>
                {d.label}
                <small>{d.hint}</small>
              </span>
            </button>
          ))
        }
      </MenuButton>,
    );
  }
  if (find.length)
    groups.push(
      <div key="find" className="rv-tb-group">
        {find}
      </div>,
    );

  const nav: ReactNode[] = [];
  if (has('zoom')) {
    nav.push(
      <Button key="zi" title="Zoom in" item="zoom" onClick={p.onZoomIn}>
        <ZoomInIcon />
      </Button>,
      <Button key="zo" title="Zoom out" item="zoom" onClick={p.onZoomOut}>
        <ZoomOutIcon />
      </Button>,
    );
  }
  if (has('fit')) {
    nav.push(
      <Button key="fit" title="Fit to view" item="fit" onClick={p.onFit}>
        <FitIcon />
      </Button>,
    );
  }
  if (has('lock') && p.onToggleLock) {
    // Pressed while locked (like Fullscreen while full screen); the label says what a press does.
    nav.push(
      <Button
        key="lock"
        title={
          p.locked
            ? 'Unlock layout (to move tables and collapse groups)'
            : 'Lock layout (puts everything back where it was)'
        }
        item="lock"
        pressed={!!p.locked}
        onClick={p.onToggleLock}
      >
        {p.locked ? <LockIcon /> : <UnlockIcon />}
      </Button>,
    );
  }
  if (has('fullscreen')) {
    nav.push(
      <Button
        key="fs"
        title={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        item="fullscreen"
        pressed={p.fullscreen}
        onClick={p.onToggleFullscreen}
      >
        {p.fullscreen ? <CollapseIcon /> : <ExpandIcon />}
      </Button>,
    );
  }
  if (nav.length)
    groups.push(
      <div key="nav" className="rv-tb-group">
        {nav}
      </div>,
    );

  const out: ReactNode[] = [];
  if (has('export')) {
    out.push(
      <MenuButton key="export" title="Export" label="Export" item="export" icon={<DownloadIcon />}>
        {(close) => (
          <>
            <MenuItem
              onSelect={() => {
                close();
                p.onExport('svg');
              }}
            >
              Download SVG
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                p.onExport('png');
              }}
            >
              Download PNG
            </MenuItem>
            {p.pdf !== false ? (
              <MenuItem
                onSelect={() => {
                  close();
                  p.onExport('pdf');
                }}
              >
                PDF…
              </MenuItem>
            ) : null}
          </>
        )}
      </MenuButton>,
    );
  }
  if (has('print')) {
    out.push(
      <Button key="print" title="Print" item="print" onClick={p.onPrint}>
        <PrintIcon />
      </Button>,
    );
  }
  if (has('link') && p.onCopyLink) {
    out.push(
      <Button key="link" title="Copy link to this diagram" item="link" onClick={p.onCopyLink}>
        <LinkIcon />
      </Button>,
    );
  }
  if (has('open-in-editor') && p.editorHref) {
    out.push(
      <a
        key="edit"
        className="rv-tb-button"
        data-rv-item="open-in-editor"
        href={p.editorHref}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in editor"
        aria-label="Open in editor"
      >
        <ExternalIcon />
      </a>,
    );
  }
  if (out.length)
    groups.push(
      <div key="out" className="rv-tb-group">
        {out}
      </div>,
    );

  return (
    <div
      ref={root}
      className="rv-toolbar nodrag nopan"
      role="toolbar"
      aria-label="Diagram tools"
      onKeyDown={onKeyDown}
    >
      {groups}
    </div>
  );
}
