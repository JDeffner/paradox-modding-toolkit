/** Quick end-to-end completion probes against a real mod env (audit follow-up). */
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildEvalEnv } from "../packages/server/test/rankEvalCore";
import { loadTokenDataFromLogs, parseOnActionsLog } from "../packages/server/src/data/docsParser";
import { loadWikiTokens, mergeWikiTokens } from "../packages/server/src/data/wikiDocs";
import { classifyFile } from "../packages/server/src/index/indexer";
import { devPath, requireDevPath } from "./devPaths";

const modPath = process.argv[2] ?? requireDevPath("modPath", "probe-completion");
const gamePath = process.argv[3] ?? requireDevPath("gamePath", "probe-completion");
const logsPath = process.argv[4] ?? devPath("logsPath") ?? "";

function main(): void {
  const env = buildEvalEnv({
    wikidocsDir: path.join(__dirname, "..", "packages", "server", "data", "ck3", "wikidocs"),
    freqsDir: path.join(__dirname, "..", "packages", "server", "data", "ck3"),
    gamePath,
    modPath,
  });
  const logTokens = loadTokenDataFromLogs(logsPath);
  if (logTokens.tokens.length > 0) {
    env.data.setTokens(
      mergeWikiTokens(
        logTokens.tokens,
        loadWikiTokens(path.join(__dirname, "..", "packages", "server", "data", "ck3", "wikidocs"))
      )
    );
  }
  env.data.onActionScopes = parseOnActionsLog(logsPath);
  env.data.rootScopesForFile = (file: string) => {
    const e =
      classifyFile(modPath, file, env.schema.entries) ?? classifyFile(gamePath, file, env.schema.entries);
    return e?.rootScopes?.length ? new Set(e.rootScopes.map((x) => x.toLowerCase())) : null;
  };

  let probeN = 0;
  const probe = (label: string, folder: string, text: string) => {
    const offset = text.indexOf("|");
    const content = text.replace("|", "");
    const file = `${modPath}/${folder}/zz_probe_${++probeN}.txt`;
    const entry = classifyFile(modPath, file, env.schema.entries);
    const rootScopes = entry?.rootScopes?.length
      ? new Set<string>(entry.rootScopes.map((s) => s.toLowerCase()))
      : null;
    const doc = TextDocument.create(`file:///${file.replace(/\\/g, "/")}`, "paradox", 1, content);
    const res = env.completion.provide(doc, offset, rootScopes, entry, 12);
    console.log(`\n== ${label}`);
    for (const item of res.items.slice(0, 10)) {
      console.log(`   ${item.label.padEnd(38)} ${item.detail ?? ""}`);
    }
    if (res.items.length === 0) console.log("   (no items)");
  };

  probe(
    "local_var: offers ONLY local variables",
    "common/scripted_effects",
    "eff = {\n\tset_local_variable = { name = probe_local value = 5 }\n\tif = { limit = { local_var:| } }\n}"
  );
  probe(
    "var: offers scope-object variables (typed)",
    "common/scripted_effects",
    "eff = {\n\tif = { limit = { var:| } }\n}"
  );
  probe(
    "variable = | inside every_in_list offers LIST names",
    "common/scripted_effects",
    "eff = {\n\tevery_in_list = { variable = | }\n}"
  );
  probe("has_variable = | offers variables", "common/scripted_effects", "eff = {\n\thas_variable = |\n}");
  probe(
    "scope: in activity file offers ambient host/activity",
    "common/activities/activity_types",
    "probe_act = {\n\tis_valid = { exists = scope:| }\n}"
  );
  probe(
    "scripted-list iterators complete in effect blocks",
    "common/scripted_effects",
    "eff = {\n\tevery_held_c|\n}"
  );
}

main();
