import * as path from "path";
import type { ExampleWikiContext } from "@px-lsp/protocol/protocol";
import { allProfiles } from "../games/registry";
import { loadTokenDataFromLogs } from "../data/docsParser";
import { loadDataTypes } from "../data/dataTypes";
import { loadDataBindingMacros } from "../data/dataBindingMacros";
import { loadDataFnUsageAsync } from "../data/dataFnUsage";
import { loadWikiTokens, mergeWikiTokens } from "../data/wikiDocs";
import { loadFreqs } from "../schema/freqs";
import { SiteFinder, type ExampleWikiSources } from "./exampleWiki";

/** One reference snapshot for the open browser. It never reads workspace indexes. */
export class ExampleWikiReference {
  private key = "";
  private snapshot: Promise<ReferenceSnapshot> | undefined;

  load(
    context: ExampleWikiContext,
    dataRoot: string,
    storageDir: string,
    refresh = false
  ): Promise<ReferenceSnapshot> {
    const key = JSON.stringify([context, dataRoot]);
    if (refresh || key !== this.key || !this.snapshot) {
      this.key = key;
      this.snapshot = loadReference(context, dataRoot, storageDir, refresh);
    }
    return this.snapshot;
  }
}

interface ReferenceSnapshot {
  gameId: string;
  gameName: string;
  sources: ExampleWikiSources;
  sites: SiteFinder;
  notes: string[];
}

function referencePath(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error(`${label} must be an absolute path.`);
  return value;
}

async function loadReference(
  context: ExampleWikiContext,
  dataRoot: string,
  storageDir: string,
  refresh: boolean
): Promise<ReferenceSnapshot> {
  const profile = allProfiles().find((candidate) => candidate.id === context?.gameId);
  if (!profile) throw new Error("The Examples Wiki reference game is not supported.");
  const gamePath = referencePath(context.gamePath, "Reference game folder");
  const logsPath = referencePath(context.logsPath, "Reference logs folder");
  const language = context.locLanguage ?? "english";
  if (typeof language !== "string" || !/^[A-Za-z_]+$/.test(language))
    throw new Error("Reference localization language is invalid.");
  const gameData = path.join(dataRoot, profile.id);
  const own = logsPath ? loadTokenDataFromLogs(logsPath, profile) : null;
  const ownDump = !!own?.tokens.length;
  const dump = ownDump ? own! : loadTokenDataFromLogs(path.join(gameData, "script_docs"), profile);
  const wiki = loadWikiTokens(path.join(gameData, "wikidocs"));
  const tokens = mergeWikiTokens(dump.tokens, wiki, { dropUnknownNames: ownDump }).tokens;
  const bundledTypes = path.join(gameData, "data_types");
  const typeDirs: Array<string | null> = [bundledTypes];
  if (logsPath) {
    const sibling = path.resolve(logsPath, "..", "logs");
    if (sibling.toLowerCase() !== path.resolve(logsPath).toLowerCase()) typeDirs.push(sibling);
    typeDirs.push(logsPath);
  }
  const dataTypes = loadDataTypes(typeDirs, bundledTypes, profile);
  if (gamePath) loadDataBindingMacros([gamePath], dataTypes);
  const usage = await loadDataFnUsageAsync(
    gamePath,
    language,
    storageDir ? path.join(storageDir, `wikiUsage-${profile.id}-${language}.json`) : null,
    refresh
  );
  const sites = new SiteFinder();
  sites.setRoots(gamePath, [
    ...new Set(
      profile.schema
        .filter((entry) => entry.completable !== false && (entry.ext ?? ".txt") === ".txt")
        .map((entry) => entry.path)
    ),
  ]);
  const notes = [
    `${profile.name} reference. Workspace mod variables and dependency macros are not included when browsing another game.`,
  ];
  if (!tokens.length)
    notes.push(
      `No trigger, effect, target or modifier documentation is available for ${profile.name}. Generate script_docs for this game and configure its logs folder.`
    );
  if (!dataTypes.count)
    notes.push(
      `No data-type documentation is available for ${profile.name}. Generate its data-type dump and configure its logs folder.`
    );
  const tokenSource = ownDump
    ? "your own script_docs logs, so they match your game version."
    : dump.tokens.length
      ? "the bundled script_docs snapshot. Run script_docs in this game to match your game version."
      : wiki.length
        ? "the bundled wiki tables."
        : "no available script_docs or bundled token reference.";
  return {
    gameId: profile.id,
    gameName: profile.name,
    sites,
    notes,
    sources: {
      tokens,
      dataTypes,
      usage: usage.usage,
      counts: loadFreqs(gameData).tokens,
      tokenSource,
      needsScriptDocs: !ownDump,
      gamePath,
      variables: new Map(),
    },
  };
}
