/**
 * Texture preview on hover (rework plan Phase 3, adopted from the Sublime
 * JominiTools texture popups): hovering a `gfx/...*.dds` path shows the image
 * inline, resolved mod-first then vanilla, decoded to PNG by the pure-TS DDS
 * decoder — no external tools.
 */
import { MarkupKind, type Hover, type Position } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import * as fs from "fs";
import * as path from "path";
import { ddsFormatInfo, ddsToPngDataUri } from "../dds";
import { getLineText } from "../documents";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import { assetRoots, bareNameBaseDirs } from "./assetPaths";
import { fileLink, renderHoverMarkdown, type CardInput } from "./hoverRender";

const DDS_PATH = /[A-Za-z0-9_\-./\\]+\.dds/gi;
const CACHE_MAX = 100;

interface TexturePreview {
  /** PNG data URI, or null when the format can't be decoded. */
  uri: string | null;
  format: string;
  width: number;
  height: number;
  fileBytes: number;
}

/** Preview cache keyed by fsPath:mtime. */
const cache = new Map<string, TexturePreview | null>();

function cachedPreview(fsPath: string): TexturePreview | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fsPath);
  } catch {
    return null;
  }
  const key = `${fsPath}:${stat.mtimeMs}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let entry: TexturePreview | null = null;
  try {
    const buf = fs.readFileSync(fsPath);
    const info = ddsFormatInfo(buf);
    if (info) {
      let uri: string | null;
      try {
        uri = ddsToPngDataUri(buf, 256);
      } catch {
        uri = null; // unsupported format → caller degrades to a file link
      }
      entry = { uri, format: info.format, width: info.width, height: info.height, fileBytes: stat.size };
    }
  } catch {
    entry = null;
  }
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, entry);
  return entry;
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

export function provideTextureHover(
  settings: ParadoxSettings,
  document: TextDocument,
  position: Position,
  entryKind?: string | null
): Hover | null {
  const lineText = getLineText(document, position.line);
  DDS_PATH.lastIndex = 0;
  let m: RegExpExecArray | null;
  let hit: { text: string; start: number; end: number } | null = null;
  while ((m = DDS_PATH.exec(lineText)) !== null) {
    if (position.character >= m.index && position.character <= m.index + m[0].length) {
      hit = { text: m[0], start: m.index, end: m.index + m[0].length };
      break;
    }
  }
  if (!hit) return null;

  const rel = hit.text.replace(/\\/g, "/").replace(/^\/+/, "");
  // Mod shadows parents shadow vanilla, like every other asset.
  const candidates: Array<{ root: string | null; label: string }> = [
    { root: settings.modPath, label: "mod" },
    ...(settings.parentPaths ?? []).map((p) => ({ root: p as string | null, label: "parent" })),
    { root: settings.gamePath, label: "vanilla" },
  ];
  let resolved: { fsPath: string; label: string } | null = null;
  for (const { root, label } of candidates) {
    if (!root) continue;
    const full = path.join(root, ...rel.split("/"));
    if (fs.existsSync(full)) {
      resolved = { fsPath: full, label };
      break;
    }
  }
  // Also try relative to the hovered file's own folder (portrait/coa fragments).
  if (!resolved) {
    const docDir = path.dirname(URI.parse(document.uri).fsPath);
    const full = path.join(docDir, ...rel.split("/"));
    if (fs.existsSync(full)) resolved = { fsPath: full, label: "relative" };
  }
  // Bare filename (`icon = cultivation_realm_2.dds`): resolve against the
  // engine-fixed base dir for this field (trait icon → gfx/interface/icons/traits/).
  if (!resolved && !rel.includes("/")) {
    const keyMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?$/.exec(lineText.slice(0, hit.start));
    const dirs = keyMatch ? bareNameBaseDirs(entryKind, keyMatch[1]) : null;
    if (dirs) {
      outer: for (const { root, label } of assetRoots(settings)) {
        for (const dir of dirs) {
          const full = path.join(root, ...dir.split("/"), rel);
          if (fs.existsSync(full)) {
            resolved = { fsPath: full, label };
            break outer;
          }
        }
      }
    }
  }
  if (!resolved) return null;

  const range = {
    start: { line: position.line, character: hit.start },
    end: { line: position.line, character: hit.end },
  };
  // A client without `fileLinks` gets the resolved path as text instead of a
  // link its hover renderer would not navigate.
  const open = fileLink(resolved.fsPath, "open file", { plain: `\`${resolved.fsPath}\`` });
  const preview = cachedPreview(resolved.fsPath);
  // The same card every other hover draws: badge and name, the picture, then
  // one facts line with what the file itself knows (dimensions, encoding, size
  // on disk). The picture is the one slot in the design allowed to be tall.
  const card: CardInput = {
    kind: "texture",
    badgeLabel: "texture",
    name: path.basename(rel),
    headTail: `· ${resolved.label}`,
    provenance: open,
  };
  if (preview?.uri) card.doc = `![texture](${preview.uri})`;
  card.facts = preview
    ? `${preview.width}×${preview.height} · ${preview.format} · ${formatBytes(preview.fileBytes)}${
        preview.uri ? "" : " · not previewable"
      }`
    : "not previewable";
  return { contents: { kind: MarkupKind.Markdown, value: renderHoverMarkdown([card]) }, range };
}
