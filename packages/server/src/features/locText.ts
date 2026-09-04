/**
 * paradox/locText: a localization value as the PLAYER reads it.
 *
 * paradox/lookupLoc answers the value verbatim, which is what an editor needs.
 * A panel that SHOWS the value needs the sentence. Measured over the 609
 * `culture_parameter_*` values one game ships: 280 carry a real datafunction
 * call, 145 of them the single shape
 * `[GetTrait('rough_terrain_expert').GetName( GetNullCharacter )]`, and 130
 * values nest another key as `$key$`. A form that prints those verbatim shows
 * the modder brackets instead of "The Rough Terrain Expert Commander Trait is
 * more common".
 *
 * Nothing here is written for one game. The words come from the loc index, the
 * KIND a `Get<Something>('name')` chain names comes from the definition index,
 * and the loc key that kind's names take comes from the active profile's
 * schema. A profile whose schema knows the kind resolves the chain; one whose
 * schema does not falls back to the definition name and says so, which is the
 * same behavior for every game without a line of per-game code.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { LocTextResult, LocTextValue } from "@px-lsp/protocol/protocol";
import { chipFor, stripFormatting, tokenize } from "../gui/textResolve";

export interface LocTextDeps {
  /** The configured language's value for a loc key, or undefined. */
  loc(key: string): string | undefined;
  /**
   * The definition kinds a name is indexed under, shadow-resolved, WITHOUT the
   * loc_key kind (every name a value mentions is also a loc key).
   */
  kindsOf(name: string): string[];
  /**
   * The loc key patterns a kind's names take (`$` = the name), most specific
   * first, straight off the schema entry. An unknown kind has none.
   */
  patternsOf(kind: string): string[];
}

/**
 * The value, plus one level of whatever it inlines. A `$key$` hop or a
 * resolved chain lands on another value that may itself hold markup (the
 * `court_physician` key IS a `[GetCourtPositionType(...).GetName()]` call),
 * and one more pass turns that into words. Deeper is the game's own business.
 */
const MAX_DEPTH = 2;

/**
 * `$key$`, with an optional format spec (`$VALUE|0$`). A key the loc index has
 * is substituted; anything else stays verbatim and marks the value unresolved,
 * because a slot the panel cannot fill is not a word.
 */
const NESTED_KEY = /\$([A-Za-z0-9_.\-']+)(?:\|[^$]*)?\$/g;

/** `[prestige_i]`: an icon the game draws and plain text has no glyph for. */
const ICON_TAG = /^[a-z0-9_]+_i$/;

/** `[culture|E]`: a link to a game concept, shown as that concept's word. */
const CONCEPT_LINK = /^([A-Za-z0-9_]+)\|[A-Za-z]+$/;

/** `Localize('k')` / `Concept('k')` / `Concept('k','shown')`. */
const LOCALIZE_CALL = /^(?:Localize|Concept)\s*\(\s*'([^']*)'(?:\s*,\s*'([^']*)')?\s*\)$/;

/**
 * `SelectLocalization( HasDlcFeature('x'), 'on', 'off' )`: the game picks by a
 * condition the server cannot evaluate. The first branch is the one the
 * feature-on player reads, which is what a creator preview should show.
 */
const SELECT_CALL = /^SelectLocalization\s*\(.*?,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)$/s;

/**
 * `Get<Something>('name')` followed by member hops:
 * `GetTrait('brave').GetName( GetNullCharacter )`, `GetMaA('bowmen').GetName`,
 * `GetCourtPositionType('x').GetName()`.
 */
const DEF_CHAIN = /^Get(\w+)\s*\(\s*'([^']+)'\s*\)\s*((?:\.\s*\w+\s*(?:\([^()]*\))?\s*)*)$/;

/** The members that mean "the name the player reads", measured in the corpus. */
const NAME_MEMBERS = new Set(["GetName", "GetTypeName", "GetNameNoTooltip"]);

/** The concept kind's own schema entry states the key a `[x|E]` link reaches. */
const CONCEPT_KIND = "game_concept";

/** `men_at_arms` -> `MenAtArms`, the spelling a datafunction name would use. */
function pascal(kind: string): string {
  return kind
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** The key patterns to try for a kind, most specific first, `$` last. */
function patternsWithFallback(kind: string | null, deps: LocTextDeps): string[] {
  const own = kind === null ? [] : deps.patternsOf(kind);
  return [...new Set([...own, "$"])];
}

/** The first pattern that resolves for `name`, or undefined. */
function locOfName(name: string, kind: string | null, deps: LocTextDeps): string | undefined {
  for (const pattern of patternsWithFallback(kind, deps)) {
    const value = deps.loc(pattern.replace("$", name));
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/**
 * The kinds to try for `Get<Head>('name')`, best first: a kind whose PascalCase
 * spelling the function name carries (`GetCourtPositionType` -> `court_position`)
 * outranks the rest, and a name the index does not know still gets the bare
 * `$` pattern from `patternsWithFallback`.
 */
function candidateKinds(head: string, name: string, deps: LocTextDeps): (string | null)[] {
  const kinds = deps.kindsOf(name);
  const named = kinds.filter((kind) => head.includes(pascal(kind)));
  const rest = kinds.filter((kind) => !named.includes(kind));
  return [...named, ...rest, null];
}

interface Rendered {
  text: string;
  resolved: boolean;
}

/**
 * A value a call resolved to, as words. One more pass turns its own markup
 * into text; past {@link MAX_DEPTH} the formatting is stripped and the rest
 * kept, so the recursion cannot run away on a self-referencing key.
 */
function inline(value: string, deps: LocTextDeps, depth: number): Rendered {
  if (depth + 1 >= MAX_DEPTH) return { text: stripFormatting(value).trim(), resolved: true };
  return render(value, deps, depth + 1);
}

/** One `[ ... ]` expression as words, and whether it became any. */
function renderFn(fn: string, deps: LocTextDeps, depth: number): Rendered {
  // `|0`, `|V`, `|E`: format specifiers after the chain. The concept-link form
  // needs its suffix, so it is matched before they are dropped.
  const concept = CONCEPT_LINK.exec(fn.trim());
  if (concept) {
    const value = locOfName(concept[1], CONCEPT_KIND, deps);
    return value === undefined ? { text: concept[1], resolved: false } : inline(value, deps, depth);
  }

  const source = fn.split("|")[0].trim();
  if (ICON_TAG.test(source)) return { text: "", resolved: true };

  const localize = LOCALIZE_CALL.exec(source);
  if (localize) {
    const key = localize[2] ?? localize[1];
    const value = deps.loc(key);
    return value === undefined ? { text: key, resolved: false } : inline(value, deps, depth);
  }

  const select = SELECT_CALL.exec(source);
  if (select) {
    const value = deps.loc(select[1]);
    return value === undefined ? { text: select[1], resolved: false } : inline(value, deps, depth);
  }

  const chain = DEF_CHAIN.exec(source);
  const members = chain ? [...chain[3].matchAll(/\.\s*(\w+)/g)].map((m) => m[1]) : [];
  if (chain && members.length > 0 && NAME_MEMBERS.has(members[members.length - 1])) {
    const name = chain[2];
    for (const kind of candidateKinds(chain[1], name, deps)) {
      const value = locOfName(name, kind, deps);
      if (value !== undefined) return inline(value, deps, depth);
    }
    return { text: name, resolved: false };
  }

  // Anything else is a value only the running game has. The chain's last word
  // is what the preview shows, never an invented one.
  return { text: chipFor(source), resolved: false };
}

/** `$key$` hops, one level per pass; an unfilled slot stays and marks the value. */
function substituteKeys(s: string, deps: LocTextDeps, resolved: { ok: boolean }): string {
  return s.replace(NESTED_KEY, (whole, key: string) => {
    const value = deps.loc(key);
    if (value === undefined) {
      resolved.ok = false;
      return whole;
    }
    return value;
  });
}

function render(raw: string, deps: LocTextDeps, depth: number): Rendered {
  const state = { ok: true };
  const parts = tokenize(substituteKeys(raw, deps, state)).map((part) => {
    if (part.fn === undefined) return { text: stripFormatting(part.literal ?? ""), resolved: true };
    const out = renderFn(part.fn, deps, depth);
    if (!out.resolved) state.ok = false;
    return out;
  });
  // A dropped icon leaves the space on both sides of it behind.
  const text = parts
    .map((part) => part.text)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text, resolved: state.ok };
}

/** One value rendered; exported for the unit test and for other server features. */
export function renderLocValue(raw: string, deps: LocTextDeps): LocTextValue {
  const out = render(raw, deps, 0);
  return { raw, text: out.text, resolved: out.resolved };
}

export function computeLocText(keys: readonly string[], deps: LocTextDeps): LocTextResult {
  const values: Record<string, LocTextValue> = {};
  for (const key of keys) {
    if (key in values) continue;
    const raw = deps.loc(key);
    // A key the loc index cannot find is absent: the client already shows the
    // key itself there, and an empty string would read as a defined blank.
    if (raw === undefined) continue;
    values[key] = renderLocValue(raw, deps);
  }
  return { values };
}
