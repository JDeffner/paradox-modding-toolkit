/**
 * Descriptions for [ ... ] datafunction names. Neither the game dump nor the
 * wiki tables carry prose, so hovers are built from two layers:
 *
 *  - CURATED_DOCS: hand-written docs for the small, engine-stable set of
 *    utility functions every gui/loc file uses (And, ObjectsEqual, Concat…).
 *    Callers only show these for names that exist in the harvested/dump data,
 *    so a renamed engine function can never surface a stale doc.
 *  - describeDataFn: a deduction from the name's morphology (Get→returns,
 *    Is/Has→condition, On→command…), always available, clearly heuristic.
 *
 * No vscode imports: unit-tested in plain Node.
 */
import type { DataTypeMember } from "./dataTypes";

export const CURATED_DOCS: ReadonlyMap<string, string> = new Map<string, string>([
  // Logic
  ["And", "Logical AND of two or more boolean arguments."],
  ["Or", "Logical OR of two or more boolean arguments."],
  ["Not", "Logical negation of a boolean argument."],
  ["ObjectsEqual", "True when both arguments resolve to the same game object (compare with `.Self`)."],
  ["IsDataModelEmpty", "True when the given data model (list) has no entries."],
  ["GetDataModelSize", "Number of entries in the given data model (list)."],
  // Selection / text
  [
    "SelectLocalization",
    "Picks between two loc keys: `SelectLocalization( bool, key_if_true, key_if_false )`.",
  ],
  ["Select_CString", "Picks between two strings by a boolean: `Select_CString( bool, if_true, if_false )`."],
  ["Concatenate", "Concatenates its string arguments into one string."],
  ["Localize", "Looks up a localization key by name and returns its text."],
  ["GetHerHis", "Possessive pronoun for the character (her/his). `|U` capitalizes."],
  ["GetSheHe", "Subject pronoun for the character (she/he). `|U` capitalizes."],
  ["GetHerHim", "Object pronoun for the character (her/him). `|U` capitalizes."],
  [
    "Custom",
    "Runs a customizable localization (common/customizable_localization) on this object: `Custom('key')`.",
  ],
  ["Custom2", "Customizable localization taking a second scope argument: `Custom2('key', OtherScope)`."],
  // Commands / gui plumbing
  ["IsValidCommand", "True when the given gui command is currently allowed (drives enabled states)."],
  ["GetCommandDesc", "Tooltip text explaining the given gui command's current state."],
  [
    "GetVariableSystem",
    "The gui-local variable store; chain `.Set/.Toggle/.Exists/.HasValue` for pure-UI state.",
  ],
  [
    "GetNullCharacter",
    "An empty Character reference; used to blank a datacontext or as a comparison target.",
  ],
  ["EmptyScope", "An empty scope object; used to blank out a context."],
  ["GetPlayer", "The local player's character."],
  ["GetScriptedGui", "Looks up a scripted_gui by name: chain `.IsShown/.IsValid/.Execute` with a GuiScope."],
  ["GuiScope", "Builds a scope bundle for scripted_gui calls: `.SetRoot(...).AddScope('name', ...).End`."],
  [
    "AddScope",
    "Adds a named scope to the bundle: `AddScope( 'name', object )` (read as `scope:name` in script).",
  ],
  ["SetRoot", "Sets the scripted_gui's root scope in a GuiScope chain."],
  ["MakeScope", "Wraps an object as a script scope (for GuiScope chains and scripted_gui calls)."],
  ["End", "Finishes a GuiScope builder chain."],
]);

/** Arithmetic/compare families are generated, not listed one by one. */
const TYPED_FAMILY =
  /^(Add|Subtract|Multiply|Divide|Min|Max|EqualTo|NotEqualTo|LessThan|GreaterThan|LessThanOrEqualTo|GreaterThanOrEqualTo|IntTo|FixedPointTo|FloatTo)_?([A-Za-z0-9]+)?$/;
const FAMILY_DOC: Record<string, string> = {
  Add: "Sum of the two arguments",
  Subtract: "First argument minus the second",
  Multiply: "Product of the two arguments",
  Divide: "First argument divided by the second",
  Min: "Smaller of the two arguments",
  Max: "Larger of the two arguments",
  EqualTo: "True when the arguments are equal",
  NotEqualTo: "True when the arguments differ",
  LessThan: "True when the first argument is smaller",
  GreaterThan: "True when the first argument is larger",
  LessThanOrEqualTo: "True when the first argument is smaller or equal",
  GreaterThanOrEqualTo: "True when the first argument is larger or equal",
  IntTo: "Converts an integer",
  FixedPointTo: "Converts a fixed-point number",
  FloatTo: "Converts a float",
};

/** "GetHouseAspiration" → ["House", "Aspiration"]; tolerates ALL_CAPS and digits. */
function splitWords(name: string): string[] {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function lowerPhrase(words: string[]): string {
  return words.map((w) => (/^[A-Z0-9]+$/.test(w) && w.length > 1 ? w : w.toLowerCase())).join(" ");
}

/**
 * Curated doc when available, else a description deduced from the name.
 * `member` sharpens the wording (promote vs function, return type) when known.
 */
export function describeDataFn(name: string, member: DataTypeMember | null): string | null {
  const curated = CURATED_DOCS.get(name);
  if (curated) return curated;

  const family = TYPED_FAMILY.exec(name);
  if (family && FAMILY_DOC[family[1]]) {
    const suffix = family[2] ? ` (${family[2]})` : "";
    return `${FAMILY_DOC[family[1]]}${suffix}.`;
  }

  if (/^[A-Z0-9_]+$/.test(name) && name.length > 2) {
    return "Context promote: available where the game (event, interaction, gui datacontext…) binds this scope.";
  }

  const words = splitWords(name);
  if (words.length < 2) return null;
  const head = words[0];
  const rest = lowerPhrase(words.slice(1));
  switch (head) {
    case "Get":
      return `Returns the ${rest}${member?.ret ? "" : " (deduced from the name)"}.`;
    case "Is":
    case "Are":
    case "Was":
    case "Has":
    case "Have":
    case "Can":
    case "Should":
    case "Will":
      return `Whether ${head.toLowerCase()} ${rest} (boolean, deduced from the name).`;
    case "On":
      return `Command: runs when triggered (button click, …) — ${rest}.`;
    case "Set":
    case "Toggle":
    case "Make":
    case "Add":
    case "Remove":
    case "Clear":
    case "Open":
    case "Close":
    case "Show":
    case "Hide":
    case "Select":
      return `Command: ${head.toLowerCase()} ${rest}.`;
    case "Format":
      return `Formats ${rest} as text.`;
    default:
      return null;
  }
}
