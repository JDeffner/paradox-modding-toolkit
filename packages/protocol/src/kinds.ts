/**
 * One kind map, three surfaces.
 *
 * Every place the product names a concept - the hover badge, the completion
 * list icon, the tree leaf - reads its glyph from here, so a trigger looks like
 * a trigger everywhere.
 *
 * The colour is not a second decision. VS Code paints a completion row from the
 * `symbolIcon.*Foreground` token of the `CompletionItemKind` we send, and we
 * cannot override it, so the kind IS the colour. The hover badge reuses that
 * same token, which is why there is no colour column to keep in sync. Four
 * groups come out of that, and choosing the kind is choosing the group:
 *
 *   purple   asks a question        Method
 *   orange   makes it happen        Class, Event, Enum, Value
 *   blue     you stored it          Variable, Field, Interface, EnumMember
 *   grey     syntax, everything else  all the rest
 *
 * Two facts shape the table and are easy to re-break:
 *
 *  1. **Codicon aliases collapse.** `symbol-method`, `symbol-function` and
 *     `symbol-constructor` are one codepoint, so they are one picture. Same for
 *     `symbol-enum`/`symbol-value`, `symbol-key`/`symbol-text`,
 *     `symbol-struct`/`symbol-structure`, `symbol-unit`/`symbol-ruler` and
 *     `symbol-type-parameter`/`symbol-parameter`. Check a proposed mapping
 *     against codepoints, not against the names. Prefer the canonical name of a
 *     pair: only it carries the `symbolIcon.*Foreground` rule, so a themed tree
 *     leaf tints and an alias does not.
 *  2. **Only `CompletionItemKind` reaches the suggest widget.** 25 values,
 *     22 distinct pictures after the collapse. A concept that appears in a
 *     completion list cannot use a glyph from outside that set in the list,
 *     even though the hover and the tree can draw all 461 codicons.
 *
 * `codicon` and `completionKind` are separate fields for exactly that reason.
 * They name the same picture everywhere except `texture`, whose `file-media`
 * glyph no completion kind can produce.
 *
 * Uniqueness is promised *within a completion list*, not globally: script, gui
 * and datafunction completions never appear together, so they may share glyphs.
 *
 * No imports: this is shared by the server and the VS Code client.
 */

export interface KindStyle {
  /** Codicon id, drawn in the hover badge and the tree. */
  codicon: string;
  /** `CompletionItemKind` member name; the server maps it to the enum. */
  completionKind: string;
  /** Hover badge colour as a `--vscode-symbolIcon-*` var, or null for none. */
  color: string | null;
}

/**
 * The only completion kinds VS Code tints; the other 15 render in the plain
 * editor foreground, so their badge emits no span at all.
 */
const TINT: Record<string, string> = {
  Method: "method",
  Function: "function",
  Constructor: "constructor",
  Class: "class",
  Enum: "enumerator",
  Value: "enumerator",
  Event: "event",
  Variable: "variable",
  Field: "field",
  Interface: "interface",
  EnumMember: "enumeratorMember",
};

/**
 * `colorFrom` defaults to the completion kind, which is what keeps the badge
 * and the row the same colour. `on_action` is the one entry that overrides it:
 * it wants the interface glyph with the orange of the group it belongs to, and
 * a completion row cannot have both.
 */
const c = (codicon: string, completionKind: string, colorFrom = completionKind): KindStyle => ({
  codicon,
  completionKind,
  color: TINT[colorFrom] ? `var(--vscode-symbolIcon-${TINT[colorFrom]}Foreground)` : null,
});

const SCRIPT: Record<string, KindStyle> = {
  // purple: asks a question.
  trigger: c("symbol-method", "Method"),
  scripted_trigger: c("symbol-method", "Method"),
  datafn: c("symbol-method", "Method"),

  // orange: makes it happen.
  effect: c("symbol-event", "Event"),
  scripted_effect: c("symbol-event", "Event"),
  event: c("symbol-class", "Class"),
  decision: c("symbol-class", "Class"),
  gui_type: c("symbol-class", "Class"),
  data_type: c("symbol-class", "Class"),
  on_action: c("symbol-interface", "Interface", "Class"),
  trait: c("symbol-value", "Value"),

  // blue: you stored it. A name that resolves to a scope or a stored value.
  variable: c("symbol-variable", "Variable"),
  local_variable: c("symbol-variable", "Variable"),
  global_variable: c("symbol-variable", "Variable"),
  promote: c("symbol-variable", "Variable"),
  saved_scope: c("symbol-field", "Field"),
  event_target: c("symbol-interface", "Interface"),
  list: c("symbol-enum-member", "EnumMember"),
  variable_list: c("symbol-enum-member", "EnumMember"),
  local_variable_list: c("symbol-enum-member", "EnumMember"),
  global_variable_list: c("symbol-enum-member", "EnumMember"),

  // grey: syntax and everything else.
  scope_word: c("symbol-constant", "Constant"),
  structure_key: c("symbol-struct", "Struct"),
  descriptor_field: c("symbol-struct", "Struct"),
  keyword: c("symbol-keyword", "Keyword"),
  modifier: c("symbol-property", "Property"),
  scripted_modifier: c("symbol-property", "Property"),
  gui_property: c("symbol-property", "Property"),
  script_value: c("symbol-operator", "Operator"),
  define: c("symbol-unit", "Unit"),
  namespace: c("symbol-module", "Module"),
  loc_key: c("symbol-text", "Text"),
  macro_param: c("symbol-type-parameter", "TypeParameter"),
  text_format: c("symbol-color", "Color"),
  gui_enum_value: c("symbol-constant", "Constant"),
  format_suffix: c("symbol-constant", "Constant"),
  gui_template: c("symbol-snippet", "Snippet"),
  // The picture-frame glyph no completion kind can draw: the hover and the tree
  // get `file-media`, the completion row falls back to the plain file glyph.
  texture: c("file-media", "File"),
};

/** Anything the map does not name: a definition we have no opinion about. */
export const DEFAULT_KIND_STYLE: KindStyle = c("go-to-file", "Reference");

/** Glyph, completion kind and badge colour for a kind name. Never throws. */
export function kindStyle(kind: string): KindStyle {
  return SCRIPT[kind] ?? DEFAULT_KIND_STYLE;
}

/** True when the map has an opinion, i.e. the kind is not falling through. */
export function hasKindStyle(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCRIPT, kind);
}

/** Every mapped kind, for the coverage test that keeps this table honest. */
export function mappedKinds(): string[] {
  return Object.keys(SCRIPT);
}
