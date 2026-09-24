import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { renderScaffold } from "@px-lsp/server/games/renderScaffold";
import { provideFormattingEdits } from "@px-lsp/server/features/formatting";
import type { PxtkRequest } from "@px-lsp/protocol/agentTools";
import type { LocEntryInfo, LocCoverage } from "@px-lsp/protocol/protocol";
import { escapeRegExp } from "@px-lsp/protocol/regex";
import type { Configuration } from "./config";
import { ToolError } from "./errors";
import { contentFiles, languageFor } from "./files";
import { withSession } from "./lsp";
import {
  changeFor,
  finishChanges,
  readOptional,
  targetPath,
  utf8,
  type Change,
  type InputSnapshot,
} from "./writes";
import { logs } from "./logs";
import { images } from "./images";

export const utilityOperations = new Set(["init", "create", "loc", "logs", "format", "image"]);
function identifier(value: string | undefined, label: string): string {
  if (!value || !/^[a-z][a-z0-9_]*$/.test(value))
    throw new ToolError(
      "invalid_identifier",
      label + " must start with a letter and use lowercase letters, digits or underscores."
    );
  return value;
}
function stageRoot(config: Configuration, request: PxtkRequest): string {
  const stages = config.meta.stageRoots ?? [];
  if (request.stage && !stages.includes(request.stage))
    throw new ToolError("invalid_stage", "Supported stages: " + stages.join(", "));
  return request.stage ?? stages[0] ?? "";
}
async function snapshots(config: Configuration): Promise<InputSnapshot[]> {
  return Promise.all(
    (await contentFiles(config.mod)).map(async (file) => ({ file, bytes: await fs.readFile(file) }))
  );
}
async function create(config: Configuration, request: PxtkRequest, signal?: AbortSignal) {
  const templates = config.meta.scaffolds ?? [];
  if (!request.kind)
    return {
      supported: templates.map((t) => ({
        kind: t.id,
        detail: t.detail,
        nameKind: t.nameKind,
        choices: t.picks,
      })),
    };
  const template = templates.find((t) => t.id === request.kind);
  if (!template)
    throw new ToolError("unsupported_kind", "Supported kinds: " + templates.map((t) => t.id).join(", "));
  const prefix = identifier(request.prefix ?? request.name?.split(".")[0], "Prefix");
  const name = request.name;
  if (template.nameKind === "eventId") {
    if (!name || !new RegExp("^" + escapeRegExp(prefix) + "\\.\\d+$").test(name))
      throw new ToolError("invalid_identifier", "Event ID must be " + prefix + ".<number>.");
  } else identifier(name, "Name");
  const input = await snapshots(config);
  const definition = new RegExp("^\\s*" + escapeRegExp(name!) + "\\s*=", "m");
  if (
    input.some(
      (s) => languageFor(s.file) === "paradox" && definition.test(utf8(s.bytes).replace(/^\uFEFF/, ""))
    )
  )
    throw new ToolError("duplicate_definition", "This mod already defines " + name);
  const rendered = renderScaffold(template, {
    prefix,
    name: name!,
    locLanguage: config.language,
    stageRoot: stageRoot(config, request),
  });
  for (const output of rendered.files.filter((file) => file.relPath.endsWith(".yml"))) {
    for (const match of output.content.matchAll(/^\s*([A-Za-z0-9_.\-']+):\d*\s*"/gm)) {
      const pattern = new RegExp("^\\s*" + escapeRegExp(match[1]) + ":", "m");
      if (
        input.some(
          (source) =>
            source.file.endsWith("_l_" + config.language + ".yml") && pattern.test(utf8(source.bytes))
        )
      )
        throw new ToolError("duplicate_localization", "This mod already defines localization " + match[1]);
    }
  }
  const changes: Change[] = [];
  for (const output of rendered.files) {
    const file = await targetPath(config, output.relPath);
    const before = await readOptional(file);
    let content = output.content;
    if (before) {
      const text = utf8(before).replace(/^\uFEFF/, "");
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const header =
        output.requiredHeader ?? (output.relPath.endsWith(".yml") ? "l_" + config.language + ":" : undefined);
      if (header && text.split(/\r?\n/)[0].trim() !== header)
        throw new ToolError("invalid_header", "Existing file has a different header: " + file);
      const addition = output.appendContent ?? output.content;
      if (output.relPath.endsWith(".yml")) {
        for (const match of addition.matchAll(/^\s*([A-Za-z0-9_.\-']+):/gm)) {
          if (new RegExp("^\\s*" + escapeRegExp(match[1]) + ":", "m").test(text))
            throw new ToolError("duplicate_localization", "Localization already exists: " + match[1]);
        }
      }
      content = text + (text.endsWith("\n") ? eol : eol + eol) + addition.replace(/\r?\n/g, eol);
    }
    changes.push({ file, before, after: Buffer.from("\uFEFF" + content), text: true });
  }
  return finishChanges(config, request, changes, input, signal);
}
async function localization(config: Configuration, request: PxtkRequest, signal?: AbortSignal) {
  const action = request.action ?? "check";
  if (!["get", "set", "check"].includes(action))
    throw new ToolError("invalid_action", "Use loc get, set or check.");
  if (action !== "check" && (!request.name || !/^[A-Za-z0-9_.\-']+$/.test(request.name)))
    throw new ToolError("invalid_key", "Supply a valid localization key.");
  if (action === "set" && request.value === undefined)
    throw new ToolError("value_required", "Supply --value, including an empty string when intended.");
  return withSession(
    config,
    async (session) => {
      if (action === "check") {
        const all = await session.request<LocCoverage[]>("paradox/locCoverage", { modRoot: config.mod });
        const coverage = all.find((item) => item.language === config.language);
        if (!coverage)
          throw new ToolError(
            "unsupported_language",
            "No localization coverage is available for " + config.language
          );
        const limit = request.limit ?? 20;
        const window = <T>(items: T[]) => ({
          items: items.slice(0, limit),
          total: items.length,
          truncated: items.length > limit,
        });
        return {
          ...coverage,
          missing: window(coverage.missing),
          orphaned: window(coverage.orphaned),
          untranslated: window(coverage.untranslated),
          issues: coverage.missing.length + coverage.untranslated.length,
          coverage: "Schema and indexed references; dynamic keys can be missed.",
        };
      }
      const entries = await session.request<LocEntryInfo[]>("paradox/lookupLoc", {
        key: request.name,
        language: config.language,
      });
      if (action === "get")
        return {
          key: request.name,
          language: config.language,
          entries: entries.slice(0, request.limit ?? 20).map((entry) => ({ ...entry, line: entry.line + 1 })),
          total: entries.length,
          truncated: entries.length > (request.limit ?? 20),
          found: entries.length > 0,
        };
      const input = await snapshots(config);
      const modEntries = entries.filter((entry) => entry.source === "mod");
      const vanilla = entries.some((entry) => entry.source === "vanilla");
      const locRoot = path.join(stageRoot(config, request), "localization");
      let file: string;
      if (request.file) file = await targetPath(config, request.file);
      else if (modEntries.length === 1) file = await targetPath(config, modEntries[0].file);
      else if (modEntries.length > 1)
        throw new ToolError("ambiguous_localization", "Several mod files define this key. Select --file.");
      else if (vanilla)
        file = await targetPath(
          config,
          path.join(locRoot, "replace", config.language, "zzz_pxtk_l_" + config.language + ".yml")
        );
      else {
        const prefix = request.name!.includes(".")
          ? request.name!.split(".")[0] + "."
          : request.name!.split("_")[0] + "_";
        const candidates = input.filter(
          (s) =>
            s.file.endsWith("_l_" + config.language + ".yml") &&
            !path.relative(config.mod, s.file).split(path.sep).includes("replace")
        );
        candidates.sort((a, b) => {
          const score = (s: InputSnapshot) =>
            [...utf8(s.bytes).matchAll(/^\s*([A-Za-z0-9_.\-']+):\d*\s*"/gm)].reduce(
              (n, m) => n + (m[1].startsWith(prefix) ? 10000 : 1),
              0
            );
          return score(b) - score(a) || a.file.localeCompare(b.file);
        });
        file =
          candidates[0]?.file ??
          (await targetPath(
            config,
            path.join(locRoot, config.language, "pxtk_l_" + config.language + ".yml")
          ));
      }
      if (!file.endsWith("_l_" + config.language + ".yml"))
        throw new ToolError("invalid_loc_file", "Filename must end in _l_" + config.language + ".yml.");
      const rel = path.relative(config.mod, file).split(path.sep);
      if (!rel.includes("localization"))
        throw new ToolError("invalid_loc_file", "Localization must be inside a localization folder.");
      if (rel.includes("replace") && !vanilla)
        throw new ToolError("not_vanilla_override", "Only vanilla keys belong in localization/replace.");
      if (
        modEntries.length &&
        !modEntries.some((entry) => path.resolve(entry.file).toLowerCase() === file.toLowerCase())
      )
        throw new ToolError(
          "duplicate_localization",
          "Select one of the mod files that already defines this key."
        );
      const before = await readOptional(file);
      const text = before ? utf8(before).replace(/^\uFEFF/, "") : "l_" + config.language + ":\n";
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const lines = text.split(/\r?\n/);
      const header = lines.find((line) => line.trim() && !line.trimStart().startsWith("#"));
      if (!new RegExp("^\\s*l_" + config.language + ":\\s*(?:#.*)?$").test(header ?? ""))
        throw new ToolError("invalid_header", "Localization header does not match the selected language.");
      const pattern = new RegExp("^(\\s*" + escapeRegExp(request.name!) + ':\\d*\\s*")(.*)("[^"]*)$');
      const matches = lines
        .map((line, index) => ({ index, match: pattern.exec(line) }))
        .filter((row) => row.match);
      if (matches.length > 1)
        throw new ToolError("duplicate_localization", "The target contains duplicate entries for this key.");
      const value = request
        .value!.replace(/\r\n|\r|\n/g, "\\n")
        .replace(/\\"/g, '"')
        .replace(/"/g, '\\"');
      if (matches.length) {
        const { index, match } = matches[0];
        lines[index] = match![1] + value + match![3];
      } else {
        if (new RegExp("^\\s*" + escapeRegExp(request.name!) + ":", "m").test(text))
          throw new ToolError(
            "malformed_localization",
            "Existing key is malformed; repair it before updating."
          );
        if (lines.at(-1) === "") lines.pop();
        lines.push(" " + request.name + ':0 "' + value + '"', "");
      }
      return finishChanges(
        config,
        request,
        [{ file, before, after: Buffer.from("\uFEFF" + lines.join(eol)), text: true }],
        input,
        signal
      );
    },
    signal
  );
}
async function format(config: Configuration, request: PxtkRequest, signal?: AbortSignal) {
  if (!request.files?.length) throw new ToolError("files_required", "Supply files to format.");
  const changes: Change[] = [];
  for (const name of request.files) {
    const file = await targetPath(config, name);
    const language = languageFor(file);
    if (!language || language === "paradox-loc")
      throw new ToolError("unsupported_format", "Formatting supports script and GUI files: " + file);
    const before = await fs.readFile(file);
    const text = utf8(before);
    const document = TextDocument.create(pathToFileURL(file).href, language, 1, text);
    const edits = provideFormattingEdits(document);
    const after = TextDocument.applyEdits(document, edits);
    changes.push({ file, before, after: Buffer.from(after), text: true });
  }
  return finishChanges(config, request, changes, [], signal);
}
export async function executeUtility(
  config: Configuration,
  request: PxtkRequest,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  if (request.write && request.check) throw new ToolError("invalid_arguments", "Choose --check or --write.");
  switch (request.operation) {
    case "init": {
      const file = await targetPath(config, ".px-toolkit/pxtk.json");
      if (await readOptional(file))
        throw new ToolError("config_exists", "Configuration already exists: " + file);
      const change = await changeFor(
        config,
        file,
        JSON.stringify({ game: config.game, mod: ".", language: config.language }, null, 2) + "\n"
      );
      return {
        ...(await finishChanges(config, request, [change], [], signal)),
        gamePath: config.gamePath,
        note: "Installation paths stay in environment variables or local configuration. Existing mod files are unchanged.",
      };
    }
    case "create":
      return create(config, request, signal);
    case "loc":
      return localization(config, request, signal);
    case "format":
      return format(config, request, signal);
    case "logs":
      return logs(config, request, signal);
    case "image":
      return images(config, request, signal);
    default:
      throw new ToolError("unknown_command", "Unknown utility.");
  }
}
