/**
 * How a Crusader Kings III save is read for GUI preview values.
 *
 * CK3 packs its script into a zip holding one `gamestate` entry (gui/saveZip.ts
 * finds it; `-debug_mode` writes the same script as plain text instead), and
 * names the played character LAST, in `played_character`, long after the
 * `living` record a preview wants. That is what `record` below describes: find
 * the id first, then cut out `living.<id>`.
 *
 * CK3's player is a character, so most rows read that record; the three names
 * the load-game screen shows (character, primary title, house) the save already
 * carries ready-localized in `meta_data`, which is why no title or dynasty
 * block has to be cut out of a 70 MB gamestate to render them.
 */
import type { BlockNode } from "../../parser";
import {
  age,
  block,
  named,
  scalar,
  statements,
  thousands,
  type SaveContext,
  type SaveSchema,
  type ValueMapping,
} from "../../gui/saveSchema";

/** The living character's own state (currencies, variables) sits under here. */
function aliveData(ctx: SaveContext): BlockNode | undefined {
  return block(ctx.character, "alive_data");
}

function firstName(ctx: SaveContext): string | undefined {
  return named(ctx, scalar(ctx.character, "first_name"));
}

const CK3_MAPPINGS: ValueMapping[] = [
  {
    // `first_name` is a loc key (`Alp_Arslan`), which is what CK3's own
    // `GetName` renders for a character.
    chains: ["GetPlayer.GetName", "GetPlayer.GetFirstName"],
    read: (ctx) => firstName(ctx),
  },
  {
    chains: ["GetPlayer.GetFullName"],
    read: (ctx) => {
      const first = firstName(ctx);
      const house = scalar(ctx.meta, "meta_house_name");
      return first && house ? `${first} ${house}` : first;
    },
  },
  {
    chains: ["GetPlayer.GetAge"],
    read: (ctx) => age(scalar(ctx.character, "birth"), scalar(ctx.meta, "meta_date")),
  },
  {
    chains: ["GetPlayer.GetGold"],
    read: (ctx) => thousands(scalar(block(aliveData(ctx), "gold"), "value")),
  },
  {
    chains: ["GetPlayer.GetPrestige"],
    read: (ctx) => thousands(scalar(block(aliveData(ctx), "prestige"), "currency")),
  },
  {
    chains: ["GetPlayer.GetPiety"],
    read: (ctx) => thousands(scalar(block(aliveData(ctx), "piety"), "currency")),
  },
  {
    // `meta_title_name` IS the primary title's name, article and all.
    chains: ["GetPlayer.GetPrimaryTitle.GetName"],
    read: (ctx) => scalar(ctx.meta, "meta_title_name"),
  },
  {
    // The meta carries the HOUSE name; for most characters the dynasty reads
    // the same, and a preview shows what is knowable.
    chains: ["GetPlayer.GetDynasty.GetName", "GetPlayer.GetHouse.GetName"],
    read: (ctx) => scalar(ctx.meta, "meta_house_name"),
  },
  {
    chains: ["GetCurrentDate", "GetGameDate"],
    read: (ctx) => ctx.date,
  },
];

/**
 * The character variables the save holds, as the two chains a modder reads them
 * back with. `alive_data.variables.data` is a list of
 * `{ flag=<name> data={ type=… identity=… } }`; a script value is conventionally
 * named exactly like the variable it mirrors, so both chains answer from it.
 * A variable the save stores without a value (a bare flag) stays absent.
 */
function characterVariables(ctx: SaveContext): Record<string, string> {
  const out: Record<string, string> = {};
  const data = block(block(aliveData(ctx), "variables"), "data");
  for (const s of statements(data)) {
    if (s.kind !== "value" || s.value.kind !== "block") continue;
    const name = scalar(s.value, "flag");
    const text = variableValue(block(s.value, "data"));
    if (!name || text === undefined) continue;
    out[`GetPlayer.MakeScope.Var('${name}').GetValue`] = text;
    out[`GetPlayer.MakeScope.ScriptValue('${name}')`] = text;
  }
  return out;
}

/** One variable's stored value; `type=value` is fixed point, x100000. */
function variableValue(data: BlockNode | undefined): string | undefined {
  const identity = scalar(data, "identity");
  if (identity === undefined) return undefined;
  switch (scalar(data, "type")) {
    case "value":
      return fixedPoint(identity);
    case "boolean":
      return identity === "0" ? "no" : "yes";
    default:
      // A character/title/… variable: the id is all the save holds about it.
      return identity;
  }
}

/** `2700000` -> `27`, `25000` -> `0.25`. */
function fixedPoint(raw: string): string | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return String(Number((n / 100000).toFixed(5)));
}

export const CK3_SAVE_SCHEMA: SaveSchema = {
  dateKey: "meta_date",
  nameKey: "meta_player_name",
  mappings: CK3_MAPPINGS,
  expand: characterVariables,
  record: { marker: "\nplayed_character={", idKey: "character", block: "living" },
};
