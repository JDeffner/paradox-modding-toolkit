/**
 * One kind map, three surfaces.
 *
 * Every place the product names a concept - the hover badge, the completion
 * list icon, the tree leaf - reads its glyph and colour from here, so a trigger
 * looks like a trigger everywhere. Before this map the three disagreed: the
 * hover drew coloured `■` squares from one table, completion picked
 * `CompletionItemKind` values from another, and `views.ts` painted every leaf
 * `symbol-field` regardless of kind.
 *
 * Two facts shape the table and are easy to re-break:
 *
 *  1. **Codicon aliases collapse.** `symbol-method`, `symbol-function` and
 *     `symbol-constructor` are one codepoint, so they are one picture. Same for
 *     `symbol-enum`/`symbol-value` and `symbol-key`/`symbol-text`. Check a
 *     proposed mapping against codepoints, not against the enum names. The old
 *     `trigger -> Function` / `effect -> Method` split drew a condition and an
 *     action identically, which is the single worst case in Paradox script.
 *  2. **Only `CompletionItemKind` reaches the suggest widget.** 26 values, ~22
 *     distinct pictures after the collapse. A concept that appears in a
 *     completion list cannot use a glyph from outside that set without the two
 *     surfaces disagreeing, which is the thing this map exists to end.
 *
 * Uniqueness is promised *within a completion list*, not globally: script and
 * datafunction completions never appear together, so they may share glyphs.
 *
 * No imports: this is shared by the server and the VS Code client.
 */

/** Colour family. VS Code's own symbol palette is three colours plus default. */
export type KindFamily = "condition" | "action" | "data" | "default";

export interface KindStyle {
  /** Codicon id, drawn in the hover badge and the tree. */
  codicon: string;
  /** `CompletionItemKind` member name; the server maps it to the enum. */
  completionKind: string;
  family: KindFamily;
}

/** `--vscode-*` colour per family. "default" emits no span at all. */
export const FAMILY_COLOR: Record<Exclude<KindFamily, "default">, string> = {
  condition: "var(--vscode-symbolIcon-functionForeground)",
  action: "var(--vscode-symbolIcon-classForeground)",
  data: "var(--vscode-symbolIcon-variableForeground)",
};

const c = (codicon: string, completionKind: string, family: KindFamily): KindStyle => ({
  codicon,
  completionKind,
  family,
});

/**
 * Script layer. Engine and mod versions of one concept share a glyph on
 * purpose; the head tail (`· mod`, `· engine`) carries the difference.
 */
const SCRIPT: Record<string, KindStyle> = {
  trigger: c("symbol-method", "Function", "condition"),
  scripted_trigger: c("symbol-method", "Method", "condition"),
  effect: c("symbol-event", "Event", "action"),
  scripted_effect: c("symbol-event", "Event", "action"),
  event: c("symbol-class", "Class", "action"),
  on_action: c("symbol-operator", "Operator", "action"),
  decision: c("symbol-structure", "Struct", "action"),
  trait: c("symbol-enum-member", "EnumMember", "default"),
  modifier: c("symbol-property", "Property", "default"),
  scripted_modifier: c("symbol-ruler", "Unit", "default"),
  script_value: c("symbol-enum", "Value", "default"),
  define: c("symbol-constant", "Constant", "default"),
  namespace: c("symbol-namespace", "Module", "default"),
  // One family, one glyph: a name that resolves to a scope or a stored value.
  saved_scope: c("symbol-variable", "Variable", "data"),
  variable: c("symbol-variable", "Variable", "data"),
  local_variable: c("symbol-variable", "Variable", "data"),
  global_variable: c("symbol-variable", "Variable", "data"),
  variable_list: c("symbol-variable", "Variable", "data"),
  local_variable_list: c("symbol-variable", "Variable", "data"),
  global_variable_list: c("symbol-variable", "Variable", "data"),
  list: c("symbol-variable", "Variable", "data"),
  event_target: c("symbol-variable", "Variable", "data"),
  scope_word: c("symbol-variable", "Variable", "data"),
  macro_param: c("symbol-parameter", "TypeParameter", "default"),
  structure_key: c("symbol-field", "Field", "default"),
  keyword: c("symbol-keyword", "Keyword", "default"),
  loc_key: c("symbol-key", "Text", "default"),
  text_format: c("symbol-color", "Color", "default"),
  texture: c("symbol-file", "File", "default"),
  // GUI layer. `gui_type` and `gui_property` used to fall through to the
  // "definition kinds read green" default, which nobody chose.
  gui_type: c("symbol-class", "Class", "action"),
  gui_template: c("symbol-snippet", "Snippet", "action"),
  gui_property: c("symbol-field", "Field", "default"),
  gui_enum_value: c("symbol-enum-member", "EnumMember", "default"),
  descriptor_field: c("symbol-field", "Field", "default"),
  // Datafunction layer. Blue is a thing you have, purple is a call you make;
  // a member promote used to be a grey wrench and a global promote a blue
  // variable, for no reason.
  data_type: c("symbol-class", "Class", "action"),
  promote: c("symbol-variable", "Variable", "data"),
  datafn: c("symbol-method", "Method", "condition"),
  format_suffix: c("symbol-enum-member", "EnumMember", "default"),
};

/** Anything the map does not name: a definition we have no opinion about. */
export const DEFAULT_KIND_STYLE: KindStyle = c("go-to-file", "Reference", "default");

/** Glyph, completion kind and colour family for a kind name. Never throws. */
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
