/** Context-sensitive graphics navigation. Only text definitions are read; binary
 * shape names remain opaque. Game vocabulary and relationships live in profiles. */
import * as fs from "fs";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind, type Position, type Location, type Hover } from "vscode-languageserver/node";
import { getParse } from "../parseCache";
import { parseScript, walkStatements, type AssignmentNode, type RootNode, type ScalarNode } from "../parser";
import type { AssetField, SchemaEntry } from "../schema/types";
import type { ServerData } from "../serverData";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import type { CompletionResult } from "./completion";
import type { Definition } from "@px-lsp/protocol/types";
import { provideAssetFileCompletion, resolveAssetPath } from "./assetPaths";

function scalar(node: AssignmentNode, key: string): ScalarNode | null {
  if (node.value?.kind !== "block") return null;
  const field = node.value.statements.find((s) => s.kind === "assignment" && s.key.text === key);
  return field?.kind === "assignment" && field.value?.kind === "scalar" ? field.value : null;
}

function contextAt(doc: TextDocument, pos: Position) {
  const offset = doc.offsetAt(pos);
  const { result } = getParse(doc);
  let parents: AssignmentNode[] = [];
  let hit: AssignmentNode | undefined;
  let onKey = false;
  walkStatements(result.root, (s, ancestors) => {
    if (s.kind !== "assignment") return;
    if (
      s.value?.kind === "block" &&
      offset > s.value.openBrace &&
      offset <= (s.value.closeBrace ?? doc.getText().length)
    ) {
      parents = [...ancestors.filter((a): a is AssignmentNode => a.kind === "assignment"), s];
    }
    const keyHit = offset >= s.key.range.start && offset <= s.key.range.end;
    const valueHit =
      s.value?.kind === "scalar" && offset >= s.value.range.start && offset <= s.value.range.end;
    if (keyHit || valueHit) {
      hit = s;
      onKey = keyHit;
      parents = ancestors.filter((a): a is AssignmentNode => a.kind === "assignment");
    }
  });
  return { parents, hit, onKey, path: parents.map((a) => a.key.text).join("/"), root: result.root };
}

export function assetField(entry: SchemaEntry, context: string, key: string): AssetField | undefined {
  return entry.assetFields?.[`${context}/${key}`] ?? entry.assetFields?.[`${context}/*`];
}

interface Candidate {
  name: string;
  location: Location;
}
const namespaces = new WeakMap<
  ServerData["index"],
  { revision: number; entries: Map<string, Definition[]> }
>();

function namespace(data: ServerData, kind: string, block: string, name?: string): Definition[] {
  const matches = (d: Definition) => d.kind === kind && d.container === block;
  if (name !== undefined) {
    const defs = data.index.lookupAll(name).filter(matches);
    const source = ["mod", "parent", "vanilla"].find((s) => defs.some((d) => d.source === s));
    return defs.filter((d) => d.source === source);
  }
  let cache = namespaces.get(data.index);
  if (!cache || cache.revision !== data.index.revision) {
    cache = { revision: data.index.revision, entries: new Map() };
    namespaces.set(data.index, cache);
  }
  const key = `${kind}/${block}`;
  let defs = cache.entries.get(key);
  if (!defs) {
    defs = data.index.allDefinitions().filter(matches);
    cache.entries.set(key, defs);
  }
  return defs;
}
function candidate(doc: TextDocument, name: ScalarNode): Candidate {
  return {
    name: name.text,
    location: {
      uri: doc.uri,
      range: { start: doc.positionAt(name.range.start), end: doc.positionAt(name.range.end) },
    },
  };
}

function namedBlocks(root: RootNode, block: string, name?: string): AssignmentNode[] {
  return root.statements.filter(
    (s): s is AssignmentNode =>
      s.kind === "assignment" &&
      s.key.text === block &&
      s.value?.kind === "block" &&
      (name === undefined || scalar(s, "name")?.text === name)
  );
}

/** Use the open document for same-file edits; read other definitions only on demand. */
function owners(
  data: ServerData,
  doc: TextDocument,
  root: RootNode,
  block: string,
  name: string
): Array<{ doc: TextDocument; node: AssignmentNode }> {
  const result = namedBlocks(root, block, name).map((node) => ({ doc, node }));
  if (result.length) return result;
  for (const def of namespace(data, "asset", block, name)) {
    if (URI.file(def.file).toString() === doc.uri) continue;
    try {
      const other = TextDocument.create(
        URI.file(def.file).toString(),
        "paradox",
        0,
        fs.readFileSync(def.file, "utf8")
      );
      for (const node of namedBlocks(parseScript(other.getText()).root, block, name))
        result.push({ doc: other, node });
    } catch {
      /* missing definitions have no target */
    }
  }
  return result;
}

function targets(
  data: ServerData,
  settings: ParadoxSettings,
  doc: TextDocument,
  ctx: ReturnType<typeof contextAt>,
  rule: AssetField,
  requestedName?: string
): Candidate[] {
  if (rule.shaderFile) {
    const parent = ctx.parents[ctx.parents.length - 1];
    const file = parent && scalar(parent, rule.shaderFile);
    const resolved = file && resolveAssetPath(settings, doc.uri, file.text);
    if (!resolved) return [];
    try {
      const text = fs.readFileSync(resolved.fsPath, "utf8");
      const shaderDoc = TextDocument.create(URI.file(resolved.fsPath).toString(), "plaintext", 0, text);
      // Preserve offsets while excluding comments in shader source.
      const source = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|#[^\r\n]*/g, (s) =>
        s.replace(/[^\r\n]/g, " ")
      );
      return [...source.matchAll(/^\s*Effect\s+([A-Za-z_][\w]*)\s*\{/gm)].map((m) => {
        const start = m.index! + m[0].indexOf(m[1]);
        return {
          name: m[1],
          location: {
            uri: shaderDoc.uri,
            range: { start: shaderDoc.positionAt(start), end: shaderDoc.positionAt(start + m[1].length) },
          },
        };
      });
    } catch {
      return [];
    }
  }
  const target = rule.target;
  if (!target) return [];
  if (!target.owner) {
    const out = namespace(data, target.kind ?? "asset", target.block, requestedName)
      .filter((d) => URI.file(d.file).toString() !== doc.uri)
      .map((d) => ({
        name: d.name,
        location: {
          uri: URI.file(d.file).toString(),
          range: { start: { line: d.line, character: 0 }, end: { line: d.line, character: 0 } },
        },
      }));
    for (const node of namedBlocks(ctx.root, target.block)) {
      const name = scalar(node, "name");
      if (name) out.unshift(candidate(doc, name));
    }
    return out;
  }
  let containers = ctx.parents.filter((p) => p.key.text === target.owner).map((node) => ({ doc, node }));
  if (containers.length === 0 && target.via && ctx.parents[0]) {
    const mesh = scalar(ctx.parents[0], target.via);
    if (mesh) containers = owners(data, doc, ctx.root, target.owner, mesh.text);
  }
  const out: Candidate[] = [];
  if (target.imports) {
    const imports = target.imports;
    const imported = containers.flatMap((owner) => {
      if (owner.node.value?.kind !== "block") return [];
      return owner.node.value.statements.flatMap((child) => {
        if (child.kind !== "assignment" || child.key.text !== imports.block) return [];
        const type = scalar(child, imports.typeKey)?.text;
        const name = scalar(child, imports.nameKey)?.text;
        return type === imports.type && name
          ? owners(data, owner.doc, parseScript(owner.doc.getText()).root, type, name)
          : [];
      });
    });
    containers = [...containers, ...imported];
  }
  for (const owner of containers) {
    if (owner.node.value?.kind !== "block") continue;
    for (const child of owner.node.value.statements) {
      if (child.kind !== "assignment" || child.key.text !== target.block) continue;
      const name = scalar(child, target.key ?? "name");
      if (name) out.push(candidate(owner.doc, name));
    }
  }
  return out;
}

export function assetDefinitions(
  data: ServerData,
  settings: ParadoxSettings,
  doc: TextDocument,
  pos: Position,
  entry: SchemaEntry
): Location[] {
  const ctx = contextAt(doc, pos);
  if (!ctx.hit || ctx.onKey || ctx.hit.value?.kind !== "scalar") return [];
  const rule = assetField(entry, ctx.path, ctx.hit.key.text);
  if (!rule) return [];
  if (rule.files) {
    const found = resolveAssetPath(settings, doc.uri, ctx.hit.value.text);
    return found
      ? [
          {
            uri: URI.file(found.fsPath).toString(),
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          },
        ]
      : [];
  }
  const name = ctx.hit.value.text;
  return targets(data, settings, doc, ctx, rule, name)
    .filter((c) => c.name === name)
    .map((c) => c.location);
}

export function assetCompletion(
  data: ServerData,
  settings: ParadoxSettings,
  doc: TextDocument,
  pos: Position,
  entry: SchemaEntry
): CompletionResult {
  const ctx = contextAt(doc, pos);
  const offset = doc.offsetAt(pos);
  if (getParse(doc).result.comments.some((c) => offset >= c.range.start && offset <= c.range.end))
    return { isIncomplete: false, items: [] };
  const line = doc.getText({ start: { line: pos.line, character: 0 }, end: pos });
  const value = /"?([\w]+)"?\s*=\s*"?([\w.\-/]*)$/.exec(line);
  if (value) {
    const rule = assetField(entry, ctx.path, value[1]);
    if (rule?.files)
      return provideAssetFileCompletion(settings, doc, line, {
        ...entry,
        fileFields: { [value[1]]: rule.files },
      });
    if (!rule) return { isIncomplete: false, items: [] };
    const seen = new Set<string>();
    return {
      isIncomplete: true,
      items: targets(data, settings, doc, ctx, rule)
        .filter(
          (c) =>
            c.name.toLowerCase().startsWith(value[2].toLowerCase()) && !seen.has(c.name) && !!seen.add(c.name)
        )
        .map((c) => ({ label: c.name, kind: CompletionItemKind.Reference, detail: rule.doc })),
    };
  }
  if (line.trimStart().startsWith("#")) return { isIncomplete: false, items: [] };
  const prefix = /[\w]*$/.exec(line)![0];
  return {
    isIncomplete: false,
    items: Object.entries(entry.assetVocabulary?.[ctx.path] ?? {})
      .filter(([key]) => key.startsWith(prefix))
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({
        label: key,
        kind: CompletionItemKind.Property,
        detail: `${ctx.path || "asset root"}; ${count} vanilla uses`,
        documentation: assetField(entry, ctx.path, key)?.doc,
        insertText: key,
      })),
  };
}

export function assetHover(
  data: ServerData,
  settings: ParadoxSettings,
  doc: TextDocument,
  pos: Position,
  entry: SchemaEntry
): Hover | null {
  const ctx = contextAt(doc, pos);
  if (!ctx.hit) return null;
  const key = ctx.hit.key.text;
  const rule = assetField(entry, ctx.path, key);
  const count = entry.assetVocabulary?.[ctx.path]?.[key];
  if (!rule && !count) return null;
  const found = ctx.onKey ? [] : assetDefinitions(data, settings, doc, pos, entry);
  const text = [
    `**${key}** (${ctx.path || "asset root"})`,
    rule?.doc ?? `Graphics property observed in ${count} vanilla declarations.`,
  ];
  if (found.length)
    text.push(
      `Resolved to ${found.length} declaration${found.length === 1 ? "" : "s"}. Use Go to Definition to open.`
    );
  return { contents: { kind: "markdown", value: text.join("\n\n") } };
}
