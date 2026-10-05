import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { renderScaffold } from "@px-lsp/server/games/renderScaffold";
import { provideFormattingEdits } from "@px-lsp/server/features/formatting";
import type { PxtkRequest } from "@px-lsp/protocol/agentTools";
import type { LocEntryInfo, LocCoverage } from "@px-lsp/protocol/protocol";
import { canonicalConfigPath, resolveConfigPath } from "@px-lsp/protocol/configDir";
import {
  parseLocalizationDefaults,
  suggestLocalizationTarget,
  upsertLocalizationText,
  generatedLocalizationSource,
} from "@px-lsp/protocol/localizationPolicy";
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
function localizationRoots(config: Configuration, request: PxtkRequest): string[] {
  if (request.stage) return [stageRoot(config, request) + "/localization"];
  return [...(config.meta.stageRoots ?? []).map((stage) => `${stage}/localization`), "localization"];
}
async function snapshots(config: Configuration): Promise<InputSnapshot[]> {
  const files = [
    ...(await contentFiles(config.mod)),
    ...["localization.json", "project.json"].flatMap((name) => [
      canonicalConfigPath(config.mod, config.meta, name),
      resolveConfigPath(config.mod, config.meta, name),
    ]),
  ];
  return Promise.all([...new Set(files)].map(async (file) => ({ file, bytes: await readOptional(file) })));
}
function locDefaults(config: Configuration, input: InputSnapshot[]) {
  const file = resolveConfigPath(config.mod, config.meta, "localization.json");
  const bytes = input.find((source) => source.file === file)?.bytes;
  return parseLocalizationDefaults(bytes ? JSON.parse(utf8(bytes).replace(/^\uFEFF/, "")) : undefined);
}
function locDocuments(config: Configuration, input: InputSnapshot[]) {
  return input
    .filter((source) => source.bytes && source.file.endsWith(".yml"))
    .map((source) => ({
      path: path.relative(config.mod, source.file).replace(/\\/g, "/"),
      text: utf8(source.bytes!),
    }));
}
function chooseLocFile(
  config: Configuration,
  input: InputSnapshot[],
  key: string,
  options: { roots: string[]; override?: boolean; sourcePath?: string; fallbackPath?: string }
): string {
  const suggestion = suggestLocalizationTarget({
    key,
    language: config.language,
    documents: locDocuments(config, input),
    locRoots: options.roots,
    defaults: locDefaults(config, input),
    ...options,
  });
  if (!suggestion.path)
    throw new ToolError(
      "ambiguous_localization",
      `Select --file or set localization.json defaults: ${suggestion.candidates?.join(", ")}`
    );
  return suggestion.path;
}
function writableLocText(text: string, file: string): void {
  const generated = generatedLocalizationSource(text);
  if (generated)
    throw new ToolError("generated_localization", `Use the source workflow for ${file}: ${generated}`);
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
      (s) => languageFor(s.file) === "paradox" && definition.test(utf8(s.bytes!).replace(/^\uFEFF/, ""))
    )
  )
    throw new ToolError("duplicate_definition", "This mod already defines " + name);
  const rendered = renderScaffold(template, {
    prefix,
    name: name!,
    locLanguage: config.language,
    stageRoot: stageRoot(config, request),
  });
  const changes: Change[] = [];
  const locChanges = new Map<string, Change>();
  const sourcePath = rendered.files.find((output) => !output.relPath.endsWith(".yml"))?.relPath;
  for (const output of rendered.files) {
    if (output.relPath.endsWith(".yml")) {
      const entries = [...output.content.matchAll(/^\s*([A-Za-z0-9_.\-']+):\d*\s*"(.*)"\s*$/gm)];
      for (const match of entries) {
        if (
          locDocuments(config, input).some(
            (source) =>
              source.path.endsWith(`_l_${config.language}.yml`) &&
              new RegExp("^\\s*" + escapeRegExp(match[1]) + ":", "m").test(source.text)
          )
        )
          throw new ToolError("duplicate_localization", "This mod already defines localization " + match[1]);
        const locRoot = path.posix.dirname(output.relPath).split("/localization")[0];
        const root = output.relPath.startsWith("localization/") ? "localization" : locRoot + "/localization";
        const file = await targetPath(
          config,
          chooseLocFile(config, input, match[1], {
            roots: [root],
            sourcePath,
            fallbackPath: output.relPath,
          })
        );
        const before = await readOptional(file);
        const text = locChanges.get(file)?.after.toString("utf8") ?? (before ? utf8(before) : "");
        writableLocText(text, file);
        const content = upsertLocalizationText(
          text.replace(/^\uFEFF/, ""),
          config.language,
          match[1],
          match[2].replace(/\\"/g, '"'),
          locDefaults(config, input).entryVersion ?? "zero"
        );
        locChanges.set(file, { file, before, after: Buffer.from("\uFEFF" + content), text: true });
      }
      continue;
    }
    const file = await targetPath(config, output.relPath);
    const before = await readOptional(file);
    let content = output.content;
    if (before) {
      const text = utf8(before).replace(/^\uFEFF/, "");
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      if (output.requiredHeader && text.split(/\r?\n/)[0].trim() !== output.requiredHeader)
        throw new ToolError("invalid_header", "Existing file has a different header: " + file);
      content =
        text +
        (text.endsWith("\n") ? eol : eol + eol) +
        (output.appendContent ?? output.content).replace(/\r?\n/g, eol);
    }
    changes.push({ file, before, after: Buffer.from("\uFEFF" + content), text: true });
  }
  changes.push(...locChanges.values());
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
      const roots = localizationRoots(config, request);
      const locRoot = roots[0];
      let file: string;
      if (request.file) file = await targetPath(config, request.file);
      else if (modEntries.length === 1) file = await targetPath(config, modEntries[0].file);
      else if (modEntries.length > 1)
        throw new ToolError("ambiguous_localization", "Several mod files define this key. Select --file.");
      else
        file = await targetPath(
          config,
          chooseLocFile(config, input, request.name!, {
            roots,
            override: vanilla,
            fallbackPath: path
              .join(
                locRoot,
                ...(vanilla ? ["replace"] : []),
                config.language,
                (vanilla ? "zzz_pxtk" : "pxtk") + "_l_" + config.language + ".yml"
              )
              .replace(/\\/g, "/"),
          })
        );
      if (!file.endsWith("_l_" + config.language + ".yml"))
        throw new ToolError("invalid_loc_file", "Filename must end in _l_" + config.language + ".yml.");
      const rel = path.relative(config.mod, file).split(path.sep);
      const relative = rel.join("/");
      if (!roots.some((root) => relative.startsWith(root + "/")))
        throw new ToolError("invalid_loc_file", "Localization must be inside a profile localization folder.");
      if (vanilla && !modEntries.length && !rel.includes("replace"))
        throw new ToolError("invalid_loc_file", "New vanilla overrides require a replace folder.");
      if (
        modEntries.length &&
        !modEntries.some((entry) => path.resolve(entry.file).toLowerCase() === file.toLowerCase())
      )
        throw new ToolError(
          "duplicate_localization",
          "Select one of the mod files that already defines this key."
        );
      const before = await readOptional(file);
      const text = before ? utf8(before).replace(/^\uFEFF/, "") : "";
      writableLocText(text, file);
      const content = upsertLocalizationText(
        text,
        config.language,
        request.name!,
        request.value!,
        locDefaults(config, input).entryVersion
      );
      return finishChanges(
        config,
        request,
        [{ file, before, after: Buffer.from("\uFEFF" + content), text: true }],
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
