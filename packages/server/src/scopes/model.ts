/**
 * Scope model (rework plan AD-5): the link table derived from script_docs /
 * wiki token data — event targets with input/output scopes, iterator target
 * scopes, and per-token supported input scopes.
 *
 * Everything here is *derived per patch* from the user's own game logs; there
 * is no hand-maintained scope table to rot.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { TokenData } from "@px-lsp/protocol/types";

/** Canonical scope names are plain lowercase strings ("character", "landed_title"...). */
export type Scope = string;

export interface LinkInfo {
  /** Scopes the link can be used from; null = unknown/any. */
  inputs: Set<Scope> | null;
  /** Scopes the link produces; null = unknown. */
  outputs: Set<Scope> | null;
}

const TARGETS_META = /Supported Targets:\s*(.+)/;

function splitScopes(raw: string): Set<Scope> {
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s !== "" && s !== "none")
  );
}

/**
 * Engine-doc gaps: script_docs entries that omit "Output Scopes" for links
 * whose output IS fixed (verified against the wiki / vanilla usage). Applied
 * after parsing so the user's own logs stay authoritative for everything else.
 */
const LINK_OUTPUT_PATCHES: Record<string, string[]> = {
  special_guest: ["character"],
};

export class ScopeModel {
  /** Event-target links: liege, primary_title, faith, ... */
  readonly links = new Map<string, LinkInfo>();
  /** Iterator base name → scope of the iterated items (every_vassal → character). */
  readonly iteratorTargets = new Map<string, Set<Scope>>();
  /** token "kind:name" → supported input scopes (null = unknown/any). */
  private readonly tokenScopes = new Map<string, Set<Scope> | null>();

  constructor(tokens: TokenData[]) {
    for (const t of tokens) {
      if (t.kind === "event_target") {
        const inputs = new Set<Scope>();
        const outputs = new Set<Scope>();
        for (const s of t.scopes) {
          const lower = s.toLowerCase();
          if (lower.startsWith("input:")) for (const x of splitScopes(lower.slice(6))) inputs.add(x);
          else if (lower.startsWith("output:")) for (const x of splitScopes(lower.slice(7))) outputs.add(x);
        }
        const existing = this.links.get(t.name);
        if (existing) {
          // Merge duplicate rows (wiki sections list one link per input scope).
          if (existing.inputs && inputs.size > 0) for (const x of inputs) existing.inputs.add(x);
          if (existing.outputs && outputs.size > 0) for (const x of outputs) existing.outputs.add(x);
        } else {
          this.links.set(t.name, {
            inputs: inputs.size > 0 ? inputs : null,
            outputs: outputs.size > 0 ? outputs : null,
          });
        }
        continue;
      }

      if (t.kind === "trigger" || t.kind === "effect") {
        // Supported input scopes for validity ranking.
        const inputs = splitScopes(t.scopes.filter((s) => !s.includes(":")).join(" "));
        this.tokenScopes.set(`${t.kind}:${t.name}`, inputs.size > 0 ? inputs : null);

        // Iterators: every_/any_/random_/ordered_<base>; the iterated scope is
        // the token's "Supported Targets" metadata line.
        const m = /^(every|any|random|ordered)_(.+)$/.exec(t.name);
        if (m && t.traits) {
          const targets = TARGETS_META.exec(t.traits);
          if (targets) {
            const scopes = splitScopes(targets[1]);
            if (scopes.size > 0 && !this.iteratorTargets.has(m[2])) {
              this.iteratorTargets.set(m[2], scopes);
            }
          }
        }
      }
    }
    for (const [name, outputs] of Object.entries(LINK_OUTPUT_PATCHES)) {
      const link = this.links.get(name);
      if (link && !link.outputs) link.outputs = new Set(outputs);
    }
  }

  /**
   * Scripted lists (common/scripted_lists) generate every_/any_/random_/
   * ordered_<name> iterators that script_docs does NOT dump. Each list narrows
   * a `base` iterator/link, so the iterated scope is the base's target scope.
   * Called whenever the definition index changes; replaces the previous set.
   */
  setScriptedLists(lists: ReadonlyArray<{ name: string; base?: string }>): void {
    for (const name of this.scriptedListNames) this.iteratorTargets.delete(name);
    this.scriptedListNames.clear();
    const byName = new Map<string, string | undefined>();
    for (const l of lists) byName.set(l.name, l.base);
    const resolve = (name: string, seen: Set<string>): Set<Scope> | null => {
      if (this.iteratorTargets.has(name)) return this.iteratorTargets.get(name) ?? null;
      const link = this.links.get(name);
      if (link?.outputs) return link.outputs;
      if (seen.has(name) || !byName.has(name)) return null;
      seen.add(name);
      const base = byName.get(name);
      return base ? resolve(base, seen) : null;
    };
    for (const [name, base] of byName) {
      if (this.iteratorTargets.has(name)) continue; // engine iterator wins
      const targets = base ? resolve(base, new Set([name])) : null;
      if (targets && targets.size > 0) {
        this.iteratorTargets.set(name, new Set(targets));
        this.scriptedListNames.add(name);
      }
    }
  }
  private readonly scriptedListNames = new Set<string>();

  /** Supported input scopes of an engine trigger/effect; null = unknown/any. */
  inputScopesOf(kind: "trigger" | "effect", name: string): Set<Scope> | null {
    return this.tokenScopes.get(`${kind}:${name}`) ?? null;
  }

  /** Output scope of following a link/iterator base from `name`, or null. */
  outputOf(name: string): Set<Scope> | null {
    const iter = /^(?:every|any|random|ordered)_(.+)$/.exec(name);
    if (iter) {
      const targets = this.iteratorTargets.get(iter[1]);
      if (targets) return targets;
      // `every_in_list`-style iterators have no fixed target scope.
      const linked = this.links.get(iter[1]);
      return linked?.outputs ?? null;
    }
    return this.links.get(name)?.outputs ?? null;
  }
}
