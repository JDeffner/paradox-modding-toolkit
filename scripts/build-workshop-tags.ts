/** Harvest Steam's declared Workshop tags. Run with --game <id>. No Steam login required. */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseGameArg } from "./devPaths";
import { GAME_METAS } from "../packages/vscode/src/gameDetect";

async function main() {
  const { gameId } = parseGameArg(process.argv.slice(2));
  const appId = GAME_METAS[gameId].steamAppId;
  const source = `https://steamcommunity.com/workshop/browse/?appid=${appId}&l=english`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Steam returned ${response.status}`);
  const html = await response.text();
  const match = /window\.SSR\.loaderData = (\[.*?\]);/s.exec(html);
  if (!match) throw new Error("Steam's Workshop page has no loader data. Check the page format.");
  const data = (JSON.parse(match[1]) as string[]).map((entry) => JSON.parse(entry));
  const declared = data.find((entry) => entry?.declaredTags)?.declaredTags;
  const groups = declared?.readytouse_tags;
  if (!Array.isArray(groups)) throw new Error("Steam's Workshop page has no declared ready-to-use tags.");
  const tags = groups.map((group: { name: string; tags: { name: string; admin_only: boolean }[] }) => {
    if (typeof group.name !== "string" || !Array.isArray(group.tags)) throw new Error("Invalid tag group");
    return {
      label: group.name || "Category",
      tags: group.tags
        .filter((tag) => !tag.admin_only)
        .map((tag) => {
          if (typeof tag.name !== "string" || !tag.name.trim()) throw new Error("Invalid Workshop tag");
          return tag.name;
        }),
    };
  });
  if (!tags.some((group) => group.tags.length)) throw new Error("Steam returned no selectable tags");
  const target = path.join("packages/server/data", gameId, "workshopTags.json");
  fs.writeFileSync(target, JSON.stringify({ source, groups: tags }, null, 2) + "\n");
  console.log(`${gameId}: ${tags.reduce((sum, group) => sum + group.tags.length, 0)} tags -> ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
