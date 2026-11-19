// What zenbot's host tells the page (the `zen` key of the MCP Apps host context, and the pane's size),
// kept as reactive state. Absent in the PWA and in other hosts: `active` stays false and the reader
// keeps its own title bar and close button. The host draws those when it is zenbot.
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';

export interface ZenContext {
  pane?: string;
  phone?: boolean;
  path?: string | null;
  mode?: string;
  slot?: string;
  /** The CSS font-family zenbot uses for titles (a serif). */
  headingFont?: string;
}

/** Narrower than this (CSS px) the page uses the small margins, as on a phone. */
export const NARROW = 560;

export const zen = $state({ active: false, pane: '', slot: '', phone: false, narrow: false, width: 0, height: 0 });

/** zenbot's part of a host context, or undefined (Claude, ChatGPT, …). */
export const zenOf = (ctx: McpUiHostContext | undefined): ZenContext | undefined => {
  const z = (ctx as { zen?: unknown } | undefined)?.zen;
  return z && typeof z === 'object' ? (z as ZenContext) : undefined;
};

/** The pane's width and height from `containerDimensions` (0 when the host gave only a maximum or none). */
export function sizeOf(ctx: McpUiHostContext | undefined): { width: number; height: number } {
  const d = ctx?.containerDimensions as { width?: number; height?: number } | undefined;
  return { width: typeof d?.width === 'number' ? d.width : 0, height: typeof d?.height === 'number' ? d.height : 0 };
}

/** Takes in a host context: the state above, and `data-*` and `--zen-heading` on the page for the CSS. */
export function applyZen(ctx: McpUiHostContext | undefined, root: HTMLElement = document.documentElement): void {
  if (!ctx) return;
  const z = zenOf(ctx);
  const { width, height } = sizeOf(ctx);
  zen.active = !!z;
  zen.pane = z?.pane ?? '';
  zen.slot = z?.slot ?? '';
  zen.phone = !!z?.phone;
  zen.width = width;
  zen.height = height;
  zen.narrow = zen.phone || (width > 0 && width < NARROW);
  const d = root.dataset;
  if (z) d.zen = ''; else delete d.zen;
  if (z?.pane) d.pane = z.pane; else delete d.pane;
  if (z?.slot) d.slot = z.slot; else delete d.slot;
  if (zen.narrow) d.narrow = ''; else delete d.narrow;
  if (z?.headingFont) root.style.setProperty('--zen-heading', z.headingFont);
  else root.style.removeProperty('--zen-heading');
}
