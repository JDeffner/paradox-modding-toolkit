/**
 * What a coat of arms is FOR, and the key the game reads it under.
 *
 * A modder thinks "arms for the Karlings"; the game reads a key in
 * `common/coat_of_arms/coat_of_arms`. This module is the translation, and it
 * is pure on purpose: the QuickPick flow (create.ts), the panel host
 * (panel.ts) and the app (app/main.ts) all decide with the same functions.
 */
import type { OverviewDef } from "@px-lsp/protocol/protocol";
import type { FlagEntry, FlagTarget } from "./messages";

/** A key the game accepts as a coat-of-arms definition name. */
const KEY_RE = /^[\w.-]+$/;

/** Longest label the panel shows next to the name; anything longer is noise. */
const LABEL_MAX = 80;

export interface CoaTargetKind {
  id: string;
  /** QuickPick label, and the parenthesis in the panel's target line. */
  label: string;
  detail: string;
  /** The `paradox/modOverview` kind whose definitions this lists. */
  defKind: string;
  /** Block scalar holding the readable name, when the key is not readable. */
  nameKey?: string;
  /** Block scalars holding the coa key, in order, when the definition's own
   * name is not the key. */
  keyFrom?: string[];
}

/**
 * The coat-of-arms key families, each read out of the vanilla files of
 * `common/coat_of_arms/coat_of_arms` (CK3 1.19):
 *
 * - a dynasty's arms sit under the dynasty's own key, numeric or named
 *   (`79 = { … } # Thouars` in `90_dynasties.txt`, `khayyam = k_khorasan` in
 *   `99_historical_character_coa.txt`); the key is unreadable on its own, so
 *   the picker shows the dynasty's `name` (a loc key such as `dynn_Orsini`);
 * - a house's arms sit under the house key (`house_clare = { … }`, same files);
 * - a landed title's under the title key (`b_appleby = { … }` in
 *   `01_landed_titles.txt`), which is readable as it stands;
 * - a character has NO key of their own. `99_historical_character_coa.txt`
 *   keys a historical figure's arms by their house and their dynasty, never
 *   by the character id, so a character pick resolves to `dynasty_house`
 *   first, then `dynasty` (the two scalars the character's own history block
 *   carries, e.g. `dynasty = 855` in `history/characters/persian.txt`).
 *
 * A kind is only offered when the mod's overview reports definitions of it,
 * so a game whose coa keys are shaped differently (Victoria 3 keys them by
 * country tag) never sees a row that does not fit it.
 */
export const COA_TARGET_KINDS: CoaTargetKind[] = [
  {
    id: "dynasty",
    label: "Dynasty",
    detail: "Every member of the dynasty who has no house arms.",
    defKind: "dynasty",
    nameKey: "name",
  },
  {
    id: "house",
    label: "House",
    detail: "One house of a dynasty; its arms win over the dynasty's.",
    defKind: "dynasty_house",
    nameKey: "name",
  },
  {
    id: "landed_title",
    label: "Landed title",
    detail: "A barony, county, duchy, kingdom or empire.",
    defKind: "landed_title",
  },
  {
    id: "character",
    label: "Character",
    detail: "Resolved to the character's house, or their dynasty.",
    defKind: "character",
    nameKey: "name",
    keyFrom: ["dynasty_house", "dynasty"],
  },
];

/** Everything before the first `#`: a comment never carries a scalar. */
function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return hash < 0 ? line : line.slice(0, hash);
}

/**
 * The `key = value` scalars directly inside the block that opens on `line`
 * (0-based, the line an index entry points at), stopping at the block's
 * closing brace. Sub-blocks are skipped whole: a character's dated blocks hold
 * effects, not the facts we want, and the first assignment wins so a later
 * dated override does not rewrite them. A line that opens no block (a coa
 * alias such as `98 = c_perigord`) has no scalars.
 */
export function blockScalars(text: string, line: number): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const out: Record<string, string> = {};
  if (line < 0 || line >= lines.length || !stripComment(lines[line]).includes("{")) return out;
  let depth = 0;
  for (let i = line; i < lines.length; i++) {
    const src = stripComment(lines[i]);
    if (depth === 1) {
      const m = /^\s*([\w.-]+)\s*=\s*"?([^"{}\s]+)"?/.exec(src);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2];
    }
    for (const ch of src) {
      if (ch === "{") depth++;
      else if (ch === "}" && --depth <= 0) return out;
    }
  }
  return out;
}

/** One thing the arms can be for, as the picker shows it. */
export interface CoaTargetItem {
  /** The key the definition is written under. */
  key: string;
  /** What the modder recognizes; the key itself when it is already readable. */
  title: string;
  /** Absolute path of the file the definition lives in. */
  file: string;
}

/**
 * The picker's rows for one kind. `scalars` reads a definition's block (the
 * caller owns the file access); it is only called for kinds that need it.
 * Definitions with no key to write arms under are left out: a character with
 * neither a house nor a dynasty has nothing the game would read them from.
 */
export function coaTargetItems(
  kind: CoaTargetKind,
  defs: readonly OverviewDef[],
  scalars: (def: OverviewDef) => Record<string, string>
): CoaTargetItem[] {
  const needsBlock = kind.nameKey !== undefined || kind.keyFrom !== undefined;
  const out: CoaTargetItem[] = [];
  for (const def of defs) {
    const s = needsBlock ? scalars(def) : {};
    const key = kind.keyFrom ? kind.keyFrom.map((k) => s[k]).find((v) => v) : def.name;
    if (!key || !KEY_RE.test(key)) continue;
    const title = (kind.nameKey ? s[kind.nameKey] : undefined) ?? def.name;
    out.push({ key, title, file: def.file });
  }
  return out;
}

/** "Karling (dynasty)": what the panel shows so the arms have a purpose. */
export function coaTargetLabel(kind: CoaTargetKind, item: CoaTargetItem): string {
  return `${item.title} (${kind.label.toLowerCase()})`;
}

/**
 * What the app does when a target arrives: edit the definition that already
 * exists under that key (from the game or a mod, exactly what the browser
 * would open), or start a fresh flag whose name is prefilled with it.
 */
export function targetAction(
  name: string,
  flags: readonly FlagEntry[]
): { kind: "open"; entry: FlagEntry } | { kind: "new"; name: string } {
  const entry = flags.find((f) => f.name === name);
  return entry ? { kind: "open", entry } : { kind: "new", name };
}

/**
 * The `px.openFlagBuilder` argument, validated. Other extensions and the
 * toolkit's own panels call the command, so the name is checked against the
 * charset the game accepts before it becomes a file's definition key.
 */
export function coaTargetArg(arg: unknown): FlagTarget | undefined {
  if (typeof arg !== "object" || arg === null) return undefined;
  const { name, label } = arg as { name?: unknown; label?: unknown };
  if (typeof name !== "string" || !KEY_RE.test(name)) return undefined;
  return {
    name,
    label: typeof label === "string" && label.trim() ? label.trim().slice(0, LABEL_MAX) : undefined,
  };
}
