/**
 * The baked data contract for the browser build.
 *
 * On node the server parses `data/<game>/script_docs/*.log` at startup. A
 * browser cannot: the logs are 1.1 MB of text and there is no filesystem. So
 * `scripts/bake-browser-data.ts` runs the same parsers at build time and emits
 * the result as JSON, split in two by how often it is needed:
 *
 *   tokens.json  name/kind/scopes/traits for every token   ~28 KB brotli
 *   docs.json    the doc + usage prose, index-aligned      ~85 KB brotli
 *
 * Completion, diagnostics and scope inference read only the first. The prose is
 * needed the first time someone hovers, so a host can fetch it late (or never).
 * Splitting them is what keeps the startup payload smaller than the editor.
 */
import type { TokenData, TokenKind } from "@px-lsp/protocol/types";

/** Bumped when the payload shape changes; `applyTokens` refuses a mismatch. */
export const BROWSER_DATA_VERSION = 1;

/** One token minus its prose. Field names match `TokenData` so the merge is a spread. */
export interface BakedToken {
  name: string;
  kind: TokenKind;
  scopes: string[];
  traits?: string;
}

export interface BakedTokens {
  version: number;
  gameId: string;
  /** The game build the script_docs logs were dumped from, for provenance. */
  source: string;
  tokens: BakedToken[];
  /** Templated modifier tags ($CULTURE$_opinion), kept whole: they carry prose. */
  templates: TokenData[];
  /** on_action name -> expected root scope, from on_actions.log. */
  onActionScopes: Record<string, string>;
}

/**
 * Prose for the tokens in `BakedTokens.tokens`, in the same order. A pair per
 * token, `["", ""]` where the log had neither. Positional rather than keyed
 * because a name can be both a trigger and an effect, so a name alone is not a
 * key, and the aligned form is a third smaller than emitting one.
 */
export interface BakedDocs {
  version: number;
  gameId: string;
  /** `[doc, usage]` per token, aligned with `BakedTokens.tokens`. */
  prose: Array<[string, string]>;
}

/** The per-context completion frequency tables, copied from `freqs.json`. */
export type BakedFreqs = unknown;

export function assertVersion(payload: { version: number }, what: string): void {
  if (payload.version !== BROWSER_DATA_VERSION) {
    throw new Error(
      `px-lsp browser ${what}: payload version ${payload.version}, expected ${BROWSER_DATA_VERSION}. ` +
        `Re-run \`pnpm run bake:browser\` against this version of the server.`
    );
  }
}

/** Rehydrate baked tokens into the `TokenData` the features expect. */
export function toTokenData(baked: BakedTokens, docs?: BakedDocs): TokenData[] {
  const prose = docs?.prose;
  return baked.tokens.map((t, i) => ({
    name: t.name,
    kind: t.kind,
    scopes: t.scopes,
    ...(t.traits === undefined ? {} : { traits: t.traits }),
    doc: prose?.[i]?.[0] ?? "",
    ...(prose?.[i]?.[1] ? { usage: prose[i][1] } : {}),
  }));
}
