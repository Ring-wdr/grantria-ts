// Inline SVG icons of the touch controls (24x24 grid, stroked with currentColor; ui.css sizes them).
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  sword: svg('<path d="M14.5 17.5 4 7V4h3l10.5 10.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>'),
  menu: svg('<path d="M5 7h14M5 12h14M5 17h14"/>'),
  quest: svg('<path d="M7 4h10a2 2 0 0 1 2 2v14l-3-2-2.5 2-2.5-2-2.5 2L6 18V5a1 1 0 0 1 1-1z"/><path d="M10 9h6M10 13h4"/>'),
  save: svg('<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>'),
  shop: svg('<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>'),
  coupon: svg('<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M15 7v10" stroke-dasharray="1.5 2.5"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>'),
  chevron: svg('<path d="m6 15 6-6 6 6"/>'),
} as const;
