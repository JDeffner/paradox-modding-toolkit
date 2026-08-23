/**
 * paradox/eventGraph: event ↔ trigger_event ↔ on_action chains as a graph, scoped
 * to a root definition or namespace to stay readable. Edges come from the
 * reference index (mod usage sites); node metadata from the definition index.
 *
 * Two things the naive reading gets wrong, both fixed here:
 *
 * - A namespace (or the whole mod) is its DEFINITIONS, not the endpoints of the
 *   edges between them. Deriving the node set from edges hides every event that
 *   nothing calls yet, which is exactly the event a modder just wrote.
 * - Most real mods route their event chains through scripted effects, so the
 *   `trigger_event` sits in a scripted_effect body and the event that calls that
 *   effect looks like it fires nothing. Those calls are followed transitively
 *   (bounded, visited-guarded) and reported as A → B labeled "via X", the same
 *   walk shape `gui/guiDependencies.ts` uses over the same reference index.
 */
import * as fs from "fs";
import type {
  EventGraph,
  EventGraphEdge,
  EventGraphNode,
  EventGraphParams,
  EventGraphSuggestions,
} from "@px-lsp/protocol/protocol";
import type { Reference } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import {
  decode,
  LineIndex,
  nodeAtOffset,
  parseScript,
  type BlockNode,
  type ParseResult,
  type ValueNode,
} from "../parser";

const DEFAULT_MAX_NODES = 400;
const GRAPH_KINDS = new Set(["event", "on_action", "decision"]);
/** A query box lists a page at a time; a whole big mod is enough to type against. */
const MAX_SUGGESTIONS = 2000;
/**
 * How many scripted-effect hops a chain follows. Three is what the readout
 * ("via effect_a → effect_b") stays legible at, and it bounds the expansion a
 * single request can do (guiDependencies.ts uses the same budget).
 */
const MAX_EFFECT_HOPS = 3;

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
  // scripted_effect is in here so a reference written INSIDE an effect body is
  // attributed to that effect instead of being dropped.
  const defsByFile = new Map<string, Array<{ name: string; kind: string; line: number }>>();
  // Same pass feeds the query-box catalog and the namespace/all node sets: both
  // must list the mod's whole vocabulary, edges or no edges.
  const vocabulary = new Set<string>();
  for (const def of data.index.allDefinitions()) {
    if (def.source !== "mod" || !inFocus(def.file)) continue;
    const graphKind = GRAPH_KINDS.has(def.kind);
    if (!graphKind && def.kind !== "scripted_effect") continue;
    const key = def.file.toLowerCase();
    let list = defsByFile.get(key);
    if (!list) defsByFile.set(key, (list = []));
    list.push({ name: def.name, kind: def.kind, line: def.line });
    if (graphKind) vocabulary.add(def.name);
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
  const isScriptedEffect = (name: string): boolean =>
    data.index.lookup(name).some((d) => d.kind === "scripted_effect");

  // One pass over the reference index feeds three tables: the direct edges, what
  // each scripted effect fires, and who calls which scripted effect.
  const edges: Edge[] = [];
  const direct = new Set<string>();
  /** scripted effect -> the events / on_actions its own body fires. */
  const effectFires = new Map<string, Edge[]>();
  /** definition -> the scripted effects it calls (graph nodes and effects alike). */
  const effectCalls = new Map<string, Set<string>>();
  const addCall = (from: string, effect: string) => {
    let set = effectCalls.get(from);
    if (!set) effectCalls.set(from, (set = new Set()));
    set.add(effect);
  };

  for (const ref of data.refIndex.all()) {
    const fires = ref.kinds.some((k) => k === "event" || k === "on_action");
    const call = ref.call === true && ref.kinds.includes("scripted_effect");
    if (!fires && !call) continue;
    const from = containerOf(ref);
    if (!from) continue;
    if (from.name === ref.name) continue;
    if (call) {
      if (isScriptedEffect(ref.name)) addCall(from.name, ref.name);
      continue;
    }
    const edge: Edge = {
      from: from.name,
      to: ref.name,
      via: ref.kinds.includes("on_action") ? "on_action" : "event",
      file: ref.file,
      line: ref.line,
    };
    if (from.kind === "scripted_effect") {
      let list = effectFires.get(from.name);
      if (!list) effectFires.set(from.name, (list = []));
      list.push(edge);
    } else {
      edges.push(edge);
      direct.add(`${edge.from}→${edge.to}`);
    }
  }

  // Expand each graph node's scripted-effect calls into the events they reach.
  // The chain is carried so the edge can say which effect it went through; the
  // visited set is per START NODE, so two events sharing an effect both get it.
  for (const [from, firstHop] of effectCalls) {
    if (!vocabulary.has(from)) continue; // an effect calling an effect: expanded from its callers
    const visited = new Set<string>();
    let frontier: Array<{ effect: string; chain: string[] }> = [];
    for (const effect of firstHop) {
      visited.add(effect);
      frontier.push({ effect, chain: [effect] });
    }
    for (let hop = 0; hop < MAX_EFFECT_HOPS && frontier.length > 0; hop++) {
      const next: Array<{ effect: string; chain: string[] }> = [];
      for (const step of frontier) {
        for (const fired of effectFires.get(step.effect) ?? []) {
          if (fired.to === from || direct.has(`${from}→${fired.to}`)) continue;
          direct.add(`${from}→${fired.to}`);
          edges.push({
            from,
            to: fired.to,
            via: fired.via,
            file: fired.file,
            line: fired.line,
            label: `via ${step.chain.join(" → ")}`,
          });
        }
        for (const deeper of effectCalls.get(step.effect) ?? []) {
          if (visited.has(deeper)) continue;
          visited.add(deeper);
          next.push({ effect: deeper, chain: [...step.chain, deeper] });
        }
      }
      frontier = next;
    }
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
    // The mod's own definitions come first and unconditionally: an event nothing
    // references yet is still part of its namespace.
    const ids = new Set<string>();
    for (const id of vocabulary) {
      if (inScope(id)) ids.add(id);
    }
    // Then whatever those definitions are wired to, in or out.
    for (const e of edges) {
      if (!inScope(e.from) && !inScope(e.to)) continue;
      ids.add(e.from);
      ids.add(e.to);
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
    // A "via X" edge already knows its own origin; re-reading the effect's file
    // would relabel it with the section INSIDE the effect, which is not where
    // the reader's event calls it.
    if (e.label) out.label = e.label;
    else sites.set(out, e);
  }
  labelEdges(data, graphEdges, sites);

  // What each node fires, for the card's third line. Free: the edges are here.
  const firesCount = new Map<string, number>();
  for (const e of graphEdges) firesCount.set(e.from, (firesCount.get(e.from) ?? 0) + 1);

  const nodes: EventGraphNode[] = [];
  const factsOf = fileFacts();
  for (const id of selected) {
    const defs = data.index.lookup(id);
    const def = defs[0];
    const node: EventGraphNode = {
      id,
      kind: def?.kind ?? "unknown",
      source: def?.source ?? "vanilla",
      file: def?.file,
      line: def?.line,
      title: titleOf(data, id),
    };
    // Only this mod's own files are read: a card summarises what the author can
    // edit, and parsing every vanilla event file a graph touches is not cheap.
    const facts = def?.source === "mod" && def.file ? factsOf(def.file).get(id) : undefined;
    if (facts) {
      if (def?.kind === "event") node.options = facts.options;
      if (facts.trigger) node.triggerSummary = facts.trigger;
      if (params.themes && facts.theme) node.theme = facts.theme;
    }
    const fires = firesCount.get(id) ?? 0;
    if (fires > 0) node.fires = fires;
    nodes.push(node);
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, edges: graphEdges, truncated, suggestions: suggestionsOf(vocabulary) };
}

/** What a card says about one definition, all of it read from its own body. */
interface DefFacts {
  /** `option = { … }` blocks. */
  options: number;
  /** The first keys of the `trigger` block, or "" when there is no trigger. */
  trigger: string;
  /** `theme = X`, for the banner layer. */
  theme?: string;
}
/** Trigger keys named on a card before it says "…". Two fit the card's width. */
const TRIGGER_KEYS_SHOWN = 2;

/**
 * Every top-level definition of one file, summarised. Each file is parsed once
 * per request; a file that cannot be read simply has no facts, which the caller
 * renders as a card without a second and third line rather than a wrong one.
 */
function fileFacts(): (file: string) => Map<string, DefFacts> {
  const byFile = new Map<string, Map<string, DefFacts>>();
  return (file) => {
    const key = file.toLowerCase();
    let facts = byFile.get(key);
    if (facts) return facts;
    facts = new Map<string, DefFacts>();
    byFile.set(key, facts);
    try {
      const root = parseScript(decode(fs.readFileSync(file)).text).root;
      for (const stmt of root.statements) {
        if (stmt.kind !== "assignment") continue;
        const block = blockOf(stmt.value);
        if (!block) continue;
        const entry: DefFacts = { options: 0, trigger: "" };
        for (const child of block.statements) {
          if (child.kind !== "assignment") continue;
          const childKey = child.key.text.toLowerCase();
          if (childKey === "option") entry.options++;
          else if (childKey === "theme" && child.value?.kind === "scalar") entry.theme = child.value.text;
          else if (childKey === "trigger" && entry.trigger === "") entry.trigger = triggerKeys(child.value);
        }
        facts.set(stmt.key.text, entry);
      }
    } catch {
      /* unreadable: memoized as empty so it is attempted once */
    }
    return facts;
  };
}

function blockOf(value: ValueNode | null | undefined): BlockNode | null {
  if (value?.kind === "block") return value;
  if (value?.kind === "tagged-block") return value.block;
  return null;
}

/** "is_adult, has_trait…": what a `trigger` block asks, short enough for a card. */
function triggerKeys(value: ValueNode | null | undefined): string {
  const block = blockOf(value);
  if (!block) return "";
  const keys: string[] = [];
  let more = false;
  for (const stmt of block.statements) {
    if (stmt.kind !== "assignment") continue;
    if (keys.length < TRIGGER_KEYS_SHOWN) keys.push(stmt.key.text);
    else {
      more = true;
      break;
    }
  }
  if (keys.length === 0) return "";
  return keys.join(", ") + (more ? "…" : "");
}

/** The mod's own graph ids and the namespaces they imply, both sorted. */
function suggestionsOf(vocabulary: Set<string>): EventGraphSuggestions {
  const ids = [...vocabulary].sort();
  const namespaces = new Set<string>();
  for (const id of ids) {
    const dot = id.indexOf(".");
    if (dot > 0) namespaces.add(id.slice(0, dot));
  }
  return { ids: ids.slice(0, MAX_SUGGESTIONS), namespaces: [...namespaces].sort() };
}
