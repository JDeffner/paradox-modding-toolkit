/**
 * Inspector rows: the widget's effective properties, each labelled with where
 * its value came from.
 *
 * The server resolves the chain (`paradox/guiWidgetInfo`, through the same def
 * store the canvas laid out with); this module only turns it into the words the
 * panel shows. PURE, so the labels are asserted without a DOM.
 *
 * A row with an EMPTY origin is authored in the widget's own body: that is the
 * one an inspector write rewrites in place. Everything else is inherited, and
 * writing it will add an override at the use site (G3.3), never touch the
 * definition's own bytes.
 */
import type { GuiWidgetInfo, GuiWidgetOrigin } from "@px-lsp/protocol/protocol";

export interface InspectorRow {
  key: string;
  value: string;
  /** Empty for a locally authored property; else "template X", "type y in …". */
  origin: string;
  local: boolean;
}

/**
 * "template PxDeco", "type px_card", "template PxDeco in type px_card" — the
 * chain innermost first, read as "spliced from A, which came in through B".
 */
export function originLabel(origin: readonly GuiWidgetOrigin[]): string {
  return origin.map((step) => `${step.kind} ${step.name}`).join(" in ");
}

export function inspectorRows(info: GuiWidgetInfo): InspectorRow[] {
  return info.properties.map((p) => ({
    key: p.key,
    value: p.value,
    origin: originLabel(p.origin),
    local: p.origin.length === 0,
  }));
}

/** The header line: `key#name`, plus the type chain when the key resolves to one. */
export function widgetTitle(info: { key: string; name?: string }): string {
  return info.name ? `${info.key}#${info.name}` : info.key;
}
