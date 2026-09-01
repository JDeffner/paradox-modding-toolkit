/**
 * The wire between the Examples Wiki host (panel.ts) and its app (app/main.ts).
 * The app never touches the filesystem or the language server: it asks for an
 * entry, or asks for a file to be opened, and the host does the rest.
 */
import type { ExampleWikiDetail, ExampleWikiIndex, ExampleWikiKind } from "@px-lsp/protocol/protocol";

export type HostToApp =
  | { type: "loading" }
  | { type: "index"; index: ExampleWikiIndex }
  | { type: "entry"; name: string; kind: ExampleWikiKind; detail: ExampleWikiDetail | null }
  | { type: "error"; message: string };

export type AppToHost =
  | { type: "select"; name: string; kind: ExampleWikiKind }
  | { type: "open"; file: string; line: number }
  | { type: "refresh" };
