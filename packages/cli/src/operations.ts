import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SymbolInformation, Location } from "vscode-languageserver";
import type {
  ExampleWikiIndex,
  ExampleWikiDetail,
  DependenciesResult,
  OverrideInfo,
  SnippetCatalogueResult,
} from "@px-lsp/protocol/protocol";
import type { PxtkRequest, PxtkResult, PxtkSources } from "@px-lsp/protocol/agentTools";
import { detectGameVersion } from "@px-lsp/server/index/indexer";
import { requireWorkspace, type Configuration } from "./config";
import { withSession, type LspSession } from "./lsp";
import { fingerprint, referenceFingerprint, readSource, languageFor } from "./files";
import { decode } from "@px-lsp/server/parser";
import { ToolError } from "./errors";
import { validate, writeBaseline } from "./validation";
import { executeUtility, utilityOperations } from "./utilities";
import { validateRequest } from "./requests";

function sources(config: Configuration, session?: LspSession): PxtkSources {
  const status = session?.status;
  return {
    game: config.game,
    gamePath: config.gamePath,
    gameVersion: config.gamePath ? detectGameVersion(config.gamePath) : "unknown",
    mod: config.mod,
    parents: config.parents,
    logsPath: config.logsPath,
    documentation: !status
      ? "unknown"
      : status.tokens === 0
        ? "none"
        : status.tokensFromBundledDumps
          ? "bundled"
          : status.tokensFromScriptDocs
            ? "generated"
            : "wiki",
    documentationMatchesGame: "unknown",
    serverVersion: session?.serverVersion ?? "",
    savedFilesOnly: true,
  };
}
function result(config: Configuration, request: PxtkRequest, session?: LspSession): PxtkResult {
  const warnings: string[] = [];
  if (!config.gamePath)
    warnings.push("No game installation is loaded. Vanilla examples and definitions are unavailable.");
  if (!config.parents.length)
    warnings.push("No dependency mods are configured. Results cover this mod and the selected game only.");
  warnings.push("Documentation source does not certify a match with the installed game patch.");
  if (session?.status?.tokens === 0)
    warnings.push(
      "No script identifier documentation is loaded. Generate script_docs for the selected game."
    );
  return {
    schemaVersion: 1,
    operation: request.operation,
    status: "ok",
    sources: sources(config, session),
    warnings,
    data: {},
  };
}
function windowed<T>(items: T[], limit: number) {
  return { items: items.slice(0, limit), total: items.length, truncated: items.length > limit };
}
function score(name: string, description: string, query: string): number {
  const n = name.toLowerCase(),
    q = query.toLowerCase();
  if (n === q) return 1000;
  if (n.startsWith(q)) return 500;
  if (n.includes(q)) return 300;
  return q.split(/\s+/).every((term) => `${n} ${description.toLowerCase()}`.includes(term)) ? 100 : 0;
}
async function symbols(session: LspSession, query: string): Promise<SymbolInformation[]> {
  return session.request<SymbolInformation[]>("workspace/symbol", { query });
}
function symbolKind(symbol: SymbolInformation): string {
  return (symbol.containerName ?? "").replace(/ \([^)]*\)$/, "").replace(/ /g, "_");
}
export async function execute(
  config: Configuration,
  request: PxtkRequest,
  options: { signal?: AbortSignal; writeBaseline?: string } = {}
): Promise<PxtkResult> {
  validateRequest(request);
  if (request.language) config = { ...config, language: request.language };
  const limit = request.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new ToolError("invalid_limit", "limit must be an integer from 1 to 200.");
  if (request.operation !== "status") requireWorkspace(config);
  if (utilityOperations.has(request.operation)) {
    const out = result(config, request);
    out.data = await executeUtility(config, request, options.signal);
    if (out.data.found === false) out.status = "not_found";
    return out;
  }
  if (request.operation === "status" && config.issues.length) {
    const out = result(config, request);
    out.status = "incomplete";
    out.data = { configFile: config.configFile, issues: config.issues, indexed: false };
    return out;
  }
  const before = await fingerprint(config.mod);
  const referencesBefore = await referenceFingerprint(config);
  const assertUnchanged = async () => {
    if (
      before !== (await fingerprint(config.mod)) ||
      referencesBefore !== (await referenceFingerprint(config))
    ) {
      throw new ToolError(
        "workspace_changed",
        "Mod content or validation inputs changed during the operation. Run it again."
      );
    }
  };
  const output = await withSession(
    config,
    async (session) => {
      const out = result(config, request, session);
      switch (request.operation) {
        case "status": {
          let tigerExecutable = false;
          if (config.tigerPath) {
            try {
              tigerExecutable = (await fs.stat(config.tigerPath)).isFile();
            } catch {
              /* The missing file is reported below. */
            }
          }
          out.data = {
            configFile: config.configFile,
            index: session.status,
            capabilities: {
              knowledge: true,
              vanillaExamples: Boolean(config.gamePath),
              structuralValidation: true,
              tigerSupported: Boolean(config.meta.tiger),
              tigerConfigured: tigerExecutable && Boolean(config.gamePath),
            },
            tiger: {
              path: config.tigerPath,
              binaryName: config.meta.tiger?.binaryName ?? null,
              config: config.tigerConfig,
            },
            issues: [],
            nextSteps: [
              ...(!config.gamePath ? ["Set gamePath to load vanilla definitions and examples."] : []),
              ...(!tigerExecutable && config.meta.tiger
                ? ["Set tigerPath to the validator executable."]
                : []),
              ...(out.sources.documentation !== "generated"
                ? ["Generate script_docs for your game patch and set logsPath to its output folder."]
                : []),
            ],
          };
          if (!config.gamePath || !tigerExecutable || !config.meta.tiger) out.status = "incomplete";
          break;
        }
        case "search": {
          const query = request.query?.trim();
          if (!query) throw new ToolError("query_required", "Supply search text.");
          const catalog = await session.request<ExampleWikiIndex>("paradox/exampleWiki", null);
          const docs = catalog.entries
            .filter(
              (entry) =>
                (!request.kind || entry.kind === request.kind) && score(entry.name, entry.shortDoc, query) > 0
            )
            .sort(
              (a, b) =>
                score(b.name, b.shortDoc, query) - score(a.name, a.shortDoc, query) ||
                b.count - a.count ||
                a.name.localeCompare(b.name)
            );
          const definitions = (await symbols(session, query)).filter(
            (entry) => !request.kind || symbolKind(entry) === request.kind
          );
          out.data = {
            documentation: windowed(docs, limit),
            definitions: windowed(definitions, limit),
            documentationSources: catalog.sources,
          };
          out.warnings.push("Workspace-symbol results are capped by the LSP; totals count returned matches.");
          if (!docs.length && !definitions.length) out.status = "not_found";
          break;
        }
        case "inspect": {
          const name = request.name?.trim();
          if (!name) throw new ToolError("name_required", "Supply an exact identifier.");
          const catalog = await session.request<ExampleWikiIndex>("paradox/exampleWiki", null);
          const docs = catalog.entries.filter(
            (entry) => entry.name === name && (!request.kind || entry.kind === request.kind)
          );
          const defs = (await symbols(session, name)).filter(
            (entry) => entry.name === name && (!request.kind || symbolKind(entry) === request.kind)
          );
          if (docs.length + defs.length > 1 && !request.kind) {
            out.status = "ambiguous";
            out.data = {
              candidates: [
                ...docs.map((entry) => ({ name, kind: entry.kind, source: "documentation" })),
                ...defs.map((entry) => ({ name, kind: symbolKind(entry), source: entry.location })),
              ].slice(0, limit),
              nextStep: "Use --kind to select the intended meaning.",
            };
            break;
          }
          const roots = [
            config.mod,
            ...config.parents,
            ...(config.gamePath ? [config.gamePath, path.dirname(config.gamePath)] : []),
          ];
          const details = await Promise.all(
            docs
              .slice(0, limit)
              .map((entry) =>
                session.request<ExampleWikiDetail>("paradox/exampleWikiEntry", { name, kind: entry.kind })
              )
          );
          const definitions = await Promise.all(
            defs.slice(0, limit).map(async (entry) => ({
              name,
              kind: symbolKind(entry),
              source: await readSource(
                fileURLToPath(entry.location.uri),
                entry.location.range.start.line,
                roots
              ),
            }))
          );
          out.data = {
            documentation: { items: details, total: docs.length, truncated: docs.length > limit },
            definitions: { items: definitions, total: defs.length, truncated: defs.length > limit },
          };
          if (request.examples)
            out.data.examples = windowed(
              details.flatMap((detail) => detail.examples),
              limit
            );
          if (request.templates) {
            const catalogue = await session.request<SnippetCatalogueResult>("paradox/snippetCatalogue", {});
            const templates = catalogue.entries.filter(
              (entry) =>
                entry.label === name || entry.label === "new " + name || entry.id === "definition:" + name
            );
            out.data.templates = windowed(templates, limit);
          }
          if (
            !details.length &&
            !definitions.length &&
            !(out.data.templates as { total: number } | undefined)?.total
          )
            out.status = "not_found";
          break;
        }
        case "impact": {
          const name = request.name?.trim();
          if (!name) throw new ToolError("name_required", "Supply an exact definition name.");
          const candidates = (await symbols(session, name)).filter(
            (entry) => entry.name === name && (!request.kind || symbolKind(entry) === request.kind)
          );
          const kinds = [...new Set(candidates.map(symbolKind))];
          if (kinds.length > 1) {
            out.status = "ambiguous";
            out.data = { name, kinds, nextStep: "Use --kind to select a definition kind." };
            break;
          }
          const dependencies = await session.request<DependenciesResult>("paradox/dependencies", {
            name,
            kind: request.kind ?? kinds[0],
          });
          const overrides = await session.request<OverrideInfo[]>("paradox/overrides", {
            modRoot: config.mod,
          });
          let references: Location[] = [];
          if (candidates[0]) {
            const selected = candidates[0];
            const file = fileURLToPath(selected.location.uri);
            references = await session.withDocument(
              file,
              languageFor(file) ?? "paradox",
              decode(await fs.readFile(file)).text,
              (uri) =>
                session.request<Location[]>("textDocument/references", {
                  textDocument: { uri },
                  position: selected.location.range.start,
                  context: { includeDeclaration: false },
                })
            );
          }
          const callers = dependencies.dependents.flatMap((group) =>
            group.items.map((item) => ({ ...item, kind: group.kind, line: item.line + 1 }))
          );
          const targets = dependencies.dependencies.flatMap((group) =>
            group.items.map((item) => ({ ...item, kind: group.kind, line: item.line + 1 }))
          );
          out.data = {
            definition: dependencies.def ? { ...dependencies.def, line: dependencies.def.line + 1 } : null,
            callers: windowed(callers, limit),
            references: windowed(
              references.map((site) => ({
                file: fileURLToPath(site.uri),
                line: site.range.start.line + 1,
                column: site.range.start.character + 1,
              })),
              limit
            ),
            dependencies: windowed(targets, limit),
            overrides: windowed(
              overrides
                .filter((entry) => entry.name === name && (!request.kind || entry.kind === request.kind))
                .map((entry) => ({
                  ...entry,
                  mod: { ...entry.mod, line: entry.mod.line + 1 },
                  shadowed: entry.shadowed.map((site) => ({ ...site, line: site.line + 1 })),
                })),
              limit
            ),
            coverage: {
              callers:
                "Selected editable mod only; read-only dependency and vanilla callers are not indexed.",
              overrides: "LSP mod override catalog; catalog may be capped at 2000 entries.",
              lines: "1-based",
              references:
                "Standard LSP reference sites across indexed sources. Dynamic names and unsupported reference forms can be missed. Caller rows identify containing definitions.",
              precedence:
                "Each override entry reports LIOS (last-in-wins) or FIOS (first-in-wins), the candidates, and whether this mod wins.",
            },
          };
          if (!dependencies.def) out.status = "not_found";
          break;
        }
        case "validate": {
          const report = await validate(
            config,
            session,
            referencesBefore,
            request.baseline,
            options.signal,
            request.files
          );
          if (!report.complete) out.status = "incomplete";
          out.data = {
            ...report,
            findings: windowed(report.findings, limit),
            newFindings: windowed(report.newFindings, limit),
            resolvedFindings: windowed(report.resolvedFindings, limit),
            newErrors: report.newFindings.filter((finding) => finding.severity === "error").length,
            gameplayTested: false,
          };
          if (options.writeBaseline) {
            await assertUnchanged();
            await writeBaseline(options.writeBaseline, report, config.mod);
            out.data.baselineWritten = path.resolve(options.writeBaseline);
          }
          break;
        }
      }
      return out;
    },
    options.signal
  );
  await assertUnchanged();
  return output;
}
export function exitCode(result: PxtkResult): number {
  if (result.status === "incomplete") return 2;
  if (result.status !== "ok") return 1;
  if (result.operation === "format" && result.data.mode === "check" && Number(result.data.changed) > 0)
    return 1;
  if (result.operation === "loc" && Number(result.data.issues) > 0) return 1;
  return result.operation === "validate" && Number(result.data.newErrors) > 0 ? 1 : 0;
}
