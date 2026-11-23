import type { ReactElement, ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ZoomInIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14M5 7h4M7 5v4" />
  </Icon>
);
export const ZoomOutIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14M5 7h4" />
  </Icon>
);
export const FitIcon = () => (
  <Icon>
    <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
    <rect x="5.5" y="5.5" width="5" height="5" rx="1" />
  </Icon>
);
export const ExpandIcon = () => (
  <Icon>
    <path d="M9.5 2H14v4.5M14 2 9 7M6.5 14H2V9.5M2 14l5-5" />
  </Icon>
);
export const CollapseIcon = () => (
  <Icon>
    <path d="M13.5 6.5H9.5V2.5M9.5 6.5 14 2M2.5 9.5h4v4M6.5 9.5 2 14" />
  </Icon>
);
export const DownloadIcon = () => (
  <Icon>
    <path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />
  </Icon>
);
export const PrintIcon = () => (
  <Icon>
    <path d="M4.5 6V2h7v4M4.5 11.5h-2v-5.5h11v5.5h-2" />
    <rect x="4.5" y="9.5" width="7" height="4.5" rx="0.5" />
  </Icon>
);
export const ExternalIcon = () => (
  <Icon>
    <path d="M9.5 2H14v4.5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" />
  </Icon>
);
export const LayersIcon = () => (
  <Icon>
    <path d="m8 2 6 3.25-6 3.25-6-3.25L8 2Z" />
    <path d="m2 8.25 6 3.25 6-3.25M2 11.25l6 3.25 6-3.25" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);
export const AlertIcon = () => (
  <Icon>
    <path d="M8 1.75 14.5 13.5h-13L8 1.75Z" />
    <path d="M8 6v3.5M8 11.5v.01" />
  </Icon>
);
export const ChevronIcon = () => (
  <Icon>
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
  </Icon>
);
export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </Icon>
);
/** Detail level: rows of a table. */
export const RowsIcon = () => (
  <Icon>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 6h12M5 8.75h6M5 11h4" />
  </Icon>
);
export const LinkIcon = () => (
  <Icon>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.47-2.47a2.5 2.5 0 0 0-3.54-3.54l-.9.9" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.24 9.22a2.5 2.5 0 0 0 3.54 3.54l.9-.9" />
  </Icon>
);
/** Path between two tables. */
export const RouteIcon = () => (
  <Icon>
    <circle cx="3.5" cy="12.5" r="1.75" />
    <circle cx="12.5" cy="3.5" r="1.75" />
    <path d="M5.25 12.5h4a2.25 2.25 0 0 0 0-4.5h-2.5a2.25 2.25 0 0 1 0-4.5h4" />
  </Icon>
);
export const MinusIcon = () => (
  <Icon>
    <path d="M4 8h8" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon>
    <path d="M4 8h8M8 4v8" />
  </Icon>
);
export const SwapIcon = () => (
  <Icon>
    <path d="M5 2.5v11M2.5 5 5 2.5 7.5 5M11 13.5v-11M8.5 11l2.5 2.5 2.5-2.5" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);
/** Layout locked (frozen diagram). */
export const LockIcon = () => (
  <Icon>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2M8 10v1.5" />
  </Icon>
);
/** Layout unlocked: the shackle open. */
export const UnlockIcon = () => (
  <Icon>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7M8 10v1.5" />
  </Icon>
);
