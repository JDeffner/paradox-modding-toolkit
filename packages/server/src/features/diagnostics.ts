/**
 * Structural diagnostics: the silent-failure class that makes the game ignore
 * content with zero error output. Everything here is *certain* — semantic
 * validation stays the tiger validator's job (rework plan AD-5/6).
 *
 * Each diagnostic carries a stable code; docs/diagnostics/<code>.md explains
 * the in-game consequence. The `source` label and game-name prose come from
 * the active profile.
 */
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver/node";
import type { LineIndex, LocParseResult, ParseResult, Range } from "../parser";
import type { Definition, Reference } from "@paradox-lsp/protocol/types";
import type { SchemaEntry } from "../schema/types";
import type { ServerData } from "../serverData";
import { activeProfile } from "../games/active";

export interface FileContext {
  /** Absolute path of the file on disk. */
  fsPath: string;
  /** The mod root, when known — folder-layout checks only apply to mod files. */
  modPath: string | null;
  /** Whether the file on disk starts with a UTF-8 BOM; null = unknown/unsaved. */
  bomOnDisk: boolean | null;
}

function isUnder(root: string | null, file: string): boolean {
  if (!root) return false;
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
  const f = norm(file);
  const r = norm(root);
  return f.startsWith(r + "/");
}

/** Path of `file` relative to the mod root, forward slashes, lowercase; null when outside. */
function modRelPath(ctx: FileContext): string | null {
  if (!isUnder(ctx.modPath, ctx.fsPath)) return null;
  return ctx.fsPath
    .replace(/\\/g, "/")
    .slice(ctx.modPath!.replace(/\\/g, "/").replace(/\/+$/, "").length + 1)
    .toLowerCase();
}

function diag(
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  severity: DiagnosticSeverity,
  code: string,
  message: string
): Diagnostic {
  return { range, severity, code, message, source: activeProfile().diagnosticSource };
}

function toRange(lines: LineIndex, range: Range) {
  return { start: lines.positionAt(range.start), end: lines.positionAt(range.end) };
}

const TOP_OF_FILE = { start: { line: 0, character: 0 }, end: { line: 0, character: 200 } };

// ---- script files ------------------------------------------------------------

const SCRIPT_ERROR_SEVERITY: Record<string, DiagnosticSeverity> = {
  "unclosed-brace": DiagnosticSeverity.Error,
  "stray-close": DiagnosticSeverity.Error,
  "unterminated-string": DiagnosticSeverity.Warning,
  "missing-value": DiagnosticSeverity.Warning,
};

function scriptErrorHint(code: string): string {
  const game = activeProfile().shortName;
  if (code === "unclosed-brace")
    return ` ${game} silently ignores everything in the file after an unbalanced brace.`;
  if (code === "stray-close") return ` ${game} may misread the rest of the file.`;
  return "";
}

export function computeScriptDiagnostics(
  parse: ParseResult,
  lines: LineIndex,
  ctx: FileContext
): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const err of parse.errors) {
    const severity = SCRIPT_ERROR_SEVERITY[err.code] ?? DiagnosticSeverity.Warning;
    out.push(diag(toRange(lines, err.range), severity, err.code, err.message + scriptErrorHint(err.code)));
  }

  const rel = modRelPath(ctx);
  if (rel) {
    // Only games whose schema reads common/on_action (singular) get the
    // plural-folder trap check (in other games the plural IS the real folder).
    const singular = activeProfile().schema.some((e) => e.path === "common/on_action");
    if (singular && rel.startsWith("common/on_actions/")) {
      out.push(
        diag(
          TOP_OF_FILE,
          DiagnosticSeverity.Error,
          "wrong-on-action-folder",
          `This file is under common/on_actions/ — ${activeProfile().shortName} reads common/on_action/ (singular). The game silently ignores this file.`
        )
      );
    }
  }

  return out;
}

// ---- index-backed conservative checks (mod content only) ----------------------

/**
 * Unknown event references — only for namespaces the mod itself declares, so
 * vanilla/DLC content can never false-positive (rework plan Phase 2).
 */
export function computeReferenceDiagnostics(references: Reference[], data: ServerData): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const ref of references) {
    if (!ref.kinds.includes("event")) continue;
    const dot = ref.name.indexOf(".");
    if (dot <= 0) continue;
    const ns = ref.name.slice(0, dot);
    if (!data.modNamespaces.has(ns)) continue;
    if (data.index.lookupAll(ref.name).length > 0) continue;
    out.push(
      diag(
        {
          start: { line: ref.line, character: ref.startChar },
          end: { line: ref.line, character: ref.endChar },
        },
        DiagnosticSeverity.Warning,
        "unknown-event",
        `Event "${ref.name}" is not defined anywhere, but its namespace "${ns}" belongs to this mod. Triggering it will silently do nothing.`
      )
    );
  }
  return out;
}

/** Schema-declared required localization keys missing for mod definitions. */
export function computeRequiredLocDiagnostics(
  defs: Definition[],
  entry: SchemaEntry,
  data: ServerData
): Diagnostic[] {
  const patterns = entry.requiredLoc ?? [];
  if (patterns.length === 0) return [];
  const out: Diagnostic[] = [];
  for (const def of defs) {
    if (def.source !== "mod") continue;
    for (const pattern of patterns) {
      const key = pattern.replace(/\$/g, def.name);
      if (data.index.lookup(key).some((d) => d.kind === "loc_key")) continue;
      const d = diag(
        { start: { line: def.line, character: 0 }, end: { line: def.line, character: 200 } },
        DiagnosticSeverity.Warning,
        "missing-required-loc",
        `Missing localization key "${key}" — ${entry.kind.replace(/_/g, " ")} definitions show raw keys in game without it.`
      );
      d.data = { key };
      out.push(d);
    }
  }
  return out;
}

// ---- localization files --------------------------------------------------------

const LOC_ERROR_SEVERITY: Record<string, DiagnosticSeverity> = {
  "no-header": DiagnosticSeverity.Error,
  "bad-entry": DiagnosticSeverity.Warning,
  "tab-indent": DiagnosticSeverity.Error,
  "unterminated-value": DiagnosticSeverity.Warning,
  "content-before-header": DiagnosticSeverity.Warning,
};

function locErrorHint(code: string): string {
  if (code === "no-header") return " Without an l_<language>: header the game loads none of these entries.";
  if (code === "tab-indent")
    return ` ${activeProfile().shortName} rejects tab indentation in localization files.`;
  return "";
}

const FILENAME_LANG = /_l_([a-z_]+)\.ya?ml$/i;

export function computeLocDiagnostics(loc: LocParseResult, lines: LineIndex, ctx: FileContext): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const err of loc.errors) {
    const severity = LOC_ERROR_SEVERITY[err.code] ?? DiagnosticSeverity.Warning;
    out.push(
      diag(toRange(lines, err.range), severity, `loc-${err.code}`, err.message + locErrorHint(err.code))
    );
  }

  // BOM is checked against the bytes on disk (editors strip it from the buffer text).
  if (ctx.bomOnDisk === false) {
    out.push(
      diag(
        TOP_OF_FILE,
        DiagnosticSeverity.Error,
        "missing-bom",
        `This localization file has no UTF-8 BOM. ${activeProfile().shortName} requires UTF-8 with BOM; without it the game ignores the file. Save with encoding "UTF-8 with BOM".`
      )
    );
  }

  const basename = ctx.fsPath.replace(/\\/g, "/").split("/").pop() ?? "";
  const fileLang = FILENAME_LANG.exec(basename)?.[1]?.toLowerCase() ?? null;
  if (loc.language !== null && fileLang !== null && loc.language.toLowerCase() !== fileLang) {
    const range = loc.headerRange ? toRange(lines, loc.headerRange) : TOP_OF_FILE;
    out.push(
      diag(
        range,
        DiagnosticSeverity.Error,
        "loc-header-mismatch",
        `Header l_${loc.language}: does not match the filename marker _l_${fileLang}.yml — the game will not load these entries.`
      )
    );
  }

  const rel = modRelPath(ctx);
  if (rel) {
    if (fileLang === null && rel.startsWith("localization/")) {
      out.push(
        diag(
          TOP_OF_FILE,
          DiagnosticSeverity.Error,
          "loc-bad-filename",
          `Localization files must end in _l_<language>.yml (e.g. ${basename.replace(/\.ya?ml$/i, "")}_l_english.yml); the game silently ignores this file.`
        )
      );
    }
    if (rel.startsWith("localisation/")) {
      out.push(
        diag(
          TOP_OF_FILE,
          DiagnosticSeverity.Error,
          "wrong-localization-folder",
          `This folder is localisation/ (British spelling) — ${activeProfile().shortName} reads localization/. The game silently ignores this file.`
        )
      );
    }
  }

  return out;
}
