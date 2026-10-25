/**
 * Small stroke icon set (16px grid). Icons are decorative: the text next to
 * them always carries the meaning, so they are hidden from assistive tech.
 */
const PATHS = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  dash: <path d="M5 8h6" />,
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  "alert-circle": (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75v3.75M8 11.2v.05" />
    </>
  ),
  "check-circle": (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.4 8.2l1.8 1.8 3.4-3.9" />
    </>
  ),
  "help-circle": (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.25 6.35a1.8 1.8 0 1 1 2.5 1.65c-.48.2-.75.58-.75 1.08v.2M8 11.2v.05" />
    </>
  ),
  "slash-circle": (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M3.6 12.4l8.8-8.8" />
    </>
  ),
  "info-circle": (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.8v.05" />
    </>
  ),
  alert: (
    <>
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.45 9.75a1 1 0 0 1-.87 1.5H2.55a1 1 0 0 1-.87-1.5z" />
      <path d="M8 6.25v3M8 11.4v.05" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75V8l2.25 1.5" />
    </>
  ),
  spinner: (
    <>
      <circle cx="8" cy="8" r="6.25" opacity="0.25" />
      <path d="M8 1.75A6.25 6.25 0 0 1 14.25 8" />
    </>
  ),
  "chevron-right": <path d="M6 3.5L10.5 8 6 12.5" />,
  "chevron-left": <path d="M10 3.5L5.5 8l4.5 4.5" />,
  "arrow-up-right": <path d="M5 11l6-6M6 5h5v5" />,
  download: <path d="M8 2.5v8M4.75 7.5L8 10.75l3.25-3.25M3 13.5h10" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  play: <path d="M5 3.25v9.5L12.5 8z" />,
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2.5 11.5l3.5-3.5 3 3 1.5-1.5 3 3" />
      <circle cx="10.5" cy="6" r="1" />
    </>
  ),
  flag: <path d="M3.5 14V2.5M3.5 3h8l-1.75 2.75L11.5 8.5h-8" />,
  file: (
    <>
      <path d="M9.5 2H4.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5z" />
      <path d="M9.5 2v3h3" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, spin = false }: { name: IconName; size?: number; spin?: boolean }) {
  return (
    <svg
      className={`icon${spin ? " icon--spin" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={name === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Product mark: a reproduction "reticle" — corner brackets around a point. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand__mark" width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M2 7V3.5A1.5 1.5 0 0 1 3.5 2H7M15 2h3.5A1.5 1.5 0 0 1 20 3.5V7M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M7 20H3.5A1.5 1.5 0 0 1 2 18.5V15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="11" cy="11" r="3.5" fill="currentColor" />
    </svg>
  );
}
