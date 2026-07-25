/**
 * paradox/eventGraph: event ↔ trigger_event ↔ on_action chains as a graph, scoped
 * to a root definition or namespace to stay readable. Edges come from the
 * reference index (mod usage sites); node metadata from the definition index.
 */
import * as fs from "fs";
import type {
  EventGraph,
  EventGraphEdge,
  EventGraphNode,
  EventGraphParams,
} from "@paradox-lsp/protocol/protocol";
import type { Reference } from "@paradox-lsp/protocol/types";
import type { ServerData } from "../serverData";
import { decode, LineIndex, nodeAtOffset, parseScript, type ParseResult } from "../parser";

const DEFAULT_MAX_NODES = 400;
const GRAPH_KINDS = new Set(["event", "on_action", "decision"]);

interface Edge {
  from: string;
  to: string;
  via: string;
  /** Reference site, for labeling the edge with its origin block. */
  file: string;
  line: number;
  label?: string;
}

/** Localized title of a definition, trying the common key conventions. */
function titleOf(data: ServerData, id: string): string | undefined {
  for (const key of [`${id}.t`, `${id.replace(/\./g, "_")}_t`, `${id}.title`, id]) {
    const loc = data.index.lookup(key).find((d) => d.kind === "loc_key");
    if (loc?.value) return loc.value;
  }
  return undefined;
}

/**
 * Label an edge with WHERE the reference lives inside the source event: the
 * text of its option, or the section name (immediate/after/on_actions…).
 * Parses each source file once per request; fail-soft to an unlabeled edge.
 */
function labelEdges(data: ServerData, edges: EventGraphEdge[], sites: Map<EventGraphEdge, Edge>): void {
  const parses = new Map<string, { result: ParseResult; li: LineIndex } | null>();
  const parseOf = (file: string) => {
    const key = file.toLowerCase();
    if (!parses.has(key)) {
      try {
        const text = decode(fs.readFileSync(file)).text;
        parses.set(key, { result: parseScript(text), li: new LineIndex(text) });
      } catch {
        parses.set(key, null);
      }
    }
    return parses.get(key)!;
  };

  for (const edge of edges) {
    const site = sites.get(edge);
    if (!site) continue;
    const parsed = parseOf(site.file);
    if (!parsed) continue;
    const offset = parsed.li.offsetAt({ line: site.line, character: 0 });
    const hit = nodeAtOffset(parsed.result.root, offset + 1);
    if (!hit) continue;
    let label: string | undefined;
    for (const stmt of hit.path) {
      if (stmt.kind !== "assignment") continue;
      const key = stmt.key.text.toLowerCase();
      if (key === "option") {
        // Use the option's localized text when available.
        const block =
          stmt.value?.kind === "block"
            ? stmt.value
            : stmt.value?.kind === "tagged-block"
              ? stmt.value.block
              : null;
        const nameStmt = block?.statements.find(
          (s) => s.kind === "assignment" && s.key.text.toLowerCase() === "name" && s.value?.kind === "scalar"
        );
        const nameKey =
          nameStmt?.kind === "assignment" && nameStmt.value?.kind === "scalar" ? nameStmt.value.text : null;
        const text = nameKey ? data.index.lookup(nameKey).find((d) => d.kind === "loc_key")?.value : null;
        label = text ? `option: ${text.length > 28 ? text.slice(0, 27) + "…" : text}` : "option";
      } else if (
        [
          "immediate",
          "after",
          "on_actions",
          "trigger",
          "effect",
          "events",
          "random_events",
          "first_valid",
        ].includes(key)
      ) {
        label = key;
      }
    }
    if (label) edge.label = label;
  }
}

export function computeEventGraph(
  data: ServerData,
  params: EventGraphParams,
  inFocus: (file: string) => boolean = () => true
): EventGraph {
  const maxNodes = params.maxNodes ?? DEFAULT_MAX_NODES;

  // Definitions per file, sorted by line, to resolve a reference's containing
  // definition. The focus filter scopes the graph to one workspace mod: edges
  // originate only from focus files (targets may resolve anywhere).
  const defsByFile = new Map<string, Array<{ name: string; kind: string; line: number }>>();
  for (const def of data.index.allDefinitions()) {
    if (def.source !== "mod" || !GRAPH_KINDS.has(def.kind) || !inFocus(def.file)) continue;
    const key = def.file.toLowerCase();
    let list = defsByFile.get(key);
    if (!list) defsByFile.set(key, (list = []));
    list.push({ name: def.name, kind: def.kind, line: def.line });
  }
  for (const list of defsByFile.values()) list.sort((a, b) => a.line - b.line);

  const containerOf = (ref: Reference): { name: string; kind: string } | null => {
    const list = defsByFile.get(ref.file.toLowerCase());
    if (!list) return null;
    let best: { name: string; kind: string } | null = null;
    for (const d of list) {
      if (d.line <= ref.line) best = d;
      else break;
    }
    return best;
  };

  // All candidate edges from event/on_action references in mod files.
  const edges: Edge[] = [];
  for (const ref of data.refIndex.all()) {
    if (!ref.kinds.some((k) => k === "event" || k === "on_action")) continue;
    const from = containerOf(ref);
    if (!from) continue;
    if (from.name === ref.name) continue;
    edges.push({
      from: from.name,
      to: ref.name,
      via: ref.kinds.includes("on_action") ? "on_action" : "event",
      file: ref.file,
      line: ref.line,
    });
  }

  // Adjacency for BFS in both directions.
  const adj = new Map<string, Edge[]>();
  const addAdj = (id: string, e: Edge) => {
    let list = adj.get(id);
    if (!list) adj.set(id, (list = []));
    list.push(e);
  };
  for (const e of edges) {
    addAdj(e.from, e);
    addAdj(e.to, e);
  }

  // Select nodes: BFS from root, or namespace filter, or all (capped).
  const selected = new Set<string>();
  let truncated = false;
  if (params.root) {
    const queue = [params.root];
    selected.add(params.root);
    while (queue.length > 0 && selected.size < maxNodes) {
      const id = queue.shift()!;
      for (const e of adj.get(id) ?? []) {
        for (const next of [e.from, e.to]) {
          if (selected.has(next)) continue;
          if (selected.size >= maxNodes) {
            truncated = true;
            break;
          }
          selected.add(next);
          queue.push(next);
        }
      }
    }
  } else {
    const ns = params.namespace;
    const inScope = (id: string): boolean => (ns ? id.startsWith(ns + ".") : true);
    const ids = new Set<string>();
    for (const e of edges) {
      if (inScope(e.from) || inScope(e.to)) {
        ids.add(e.from);
        ids.add(e.to);
      }
    }
    for (const id of [...ids].sort()) {
      if (selected.size >= maxNodes) {
        truncated = true;
        break;
      }
      selected.add(id);
    }
  }

  const graphEdges: EventGraphEdge[] = [];
  const sites = new Map<EventGraphEdge, Edge>();
  const edgeSeen = new Set<string>();
  for (const e of edges) {
    if (!selected.has(e.from) || !selected.has(e.to)) continue;
    const key = `${e.from}→${e.to}:${e.via}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    const out: EventGraphEdge = { from: e.from, to: e.to, via: e.via };
    graphEdges.push(out);
    sites.set(out, e);
  }
  labelEdges(data, graphEdges, sites);

  const nodes: EventGraphNode[] = [];
  for (const id of selected) {
    const defs = data.index.lookup(id);
    const def = defs[0];
    nodes.push({
      id,
      kind: def?.kind ?? "unknown",
      source: def?.source ?? "vanilla",
      file: def?.file,
      line: def?.line,
      title: titleOf(data, id),
    });
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, edges: graphEdges, truncated };
}
