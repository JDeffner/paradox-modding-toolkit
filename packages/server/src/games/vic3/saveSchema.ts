/**
 * How a Victoria 3 save is read for GUI preview values.
 *
 * A Vic3 save is plain Jomini script (a big campaign runs ~115 MB and 6.5
 * million lines) and writes its registries in the order the reader needs them:
 * `meta_data`, `country_manager`, `states`, `character_manager`. The played
 * country's own entry names its capital, ruler and heir, so those ids are
 * already known when the later registries go by and one streaming pass answers
 * everything.
 */
import type { BlockNode } from "../../parser";
import {
  block,
  META_MAPPINGS,
  named,
  scalar,
  thousands,
  type SaveContext,
  type SaveSchema,
  type ValueMapping,
} from "../../gui/saveSchema";

/** `first_name` + `last_name`, each resolved through loc when it is a key. */
function characterName(ctx: SaveContext, character: BlockNode | undefined): string | undefined {
  const parts = [scalar(character, "first_name"), scalar(character, "last_name")]
    .map((p) => named(ctx, p))
    .filter((p): p is string => !!p);
  return parts.length ? parts.join(" ") : undefined;
}

const VIC3_MAPPINGS: ValueMapping[] = [
  ...META_MAPPINGS,
  {
    chains: ["GetPlayer.GetAdjective"],
    read: (ctx) => (ctx.tag ? ctx.loc(`${ctx.tag}_ADJ`) : undefined),
  },
  {
    // A character's `GetName` and `GetFullName` both render the whole name;
    // only `GetFirstName` is narrower.
    chains: ["GetPlayer.GetRuler.GetName", "GetPlayer.GetRuler.GetFullName"],
    read: (ctx) => characterName(ctx, ctx.ruler),
  },
  {
    chains: ["GetPlayer.GetRuler.GetFirstName"],
    read: (ctx) => named(ctx, scalar(ctx.ruler, "first_name")),
  },
  {
    chains: ["GetPlayer.GetHeir.GetName"],
    read: (ctx) => characterName(ctx, ctx.heir),
  },
  {
    chains: ["GetPlayer.GetCapital.GetName"],
    read: (ctx) => {
      const region = scalar(ctx.capital, "region");
      return region ? (ctx.loc(region) ?? region) : undefined;
    },
  },
  {
    chains: ["GetPlayer.GetGold", "GetPlayer.GetBudget.GetGold"],
    read: (ctx) => thousands(scalar(block(ctx.country, "budget"), "money")),
  },
];

export const VIC3_SAVE_SCHEMA: SaveSchema = {
  mappings: VIC3_MAPPINGS,
  registry: {
    entries: "database",
    countryBlock: "country_manager",
    tagKey: "definition",
    mainKey: "is_main_tag",
    links: [
      { slot: "ruler", key: "ruler", block: "character_manager" },
      { slot: "heir", key: "heir", block: "character_manager" },
      { slot: "capital", key: "capital", block: "states" },
    ],
  },
};
