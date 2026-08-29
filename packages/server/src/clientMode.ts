/**
 * Resolved client capabilities (docs/PROTOCOL.md §Initialization). A client
 * declares what it implements in `initializationOptions.client`; every gate
 * site here asks a semantic question (`hoverHtml()`, `canRunCommand(id)`)
 * instead of "is this the VSCode client", so a client can take the rich hover
 * markup without the commands, or one command without the others.
 *
 * Defaults to fully capable so the pure-render unit tests exercise the rich
 * output; server.ts installs the resolved value at initialize.
 */
import { allClientCommandIds, type ParadoxInitOptions } from "@px-lsp/protocol/protocol";

export interface ClientCapabilities {
  /** Client renders the sanitized `<span style="color:var(--*)">` hover markup. */
  hoverHtml: boolean;
  /** Command ids the client registers; anything else must not be emitted. */
  commands: ReadonlySet<string>;
  /** Client watches the mod tree itself and pushes paradox/modFileChanged. */
  ownFileWatcher: boolean;
  /** Client expands `${1:…}` completion snippets (standard LSP capability). */
  snippetSupport: boolean;
  /** Client's hover renderer navigates `file:` links. */
  fileLinks: boolean;
  /** Client renders `$(codicon)` in hover markdown (supportThemeIcons). */
  hoverIcons: boolean;
}

/** The one standard LSP capability read here, structurally. */
interface LspClientCapabilities {
  textDocument?: { completion?: { completionItem?: { snippetSupport?: boolean } } };
}

/**
 * Read the capabilities off initializationOptions plus the standard LSP
 * `capabilities` of the initialize params. The deprecated `clientCommands:
 * true` boolean is an alias for "everything on" (what the VSCode extension
 * sent before the object existed); the object wins when both are present.
 *
 * `snippetSupport` is NOT an initializationOption: it is the client's own
 * `textDocument.completion.completionItem.snippetSupport`, so a client that
 * declares nothing paradox-specific still gets snippets when LSP says it can.
 */
export function resolveClientCapabilities(
  init: Partial<ParadoxInitOptions>,
  lspCaps?: LspClientCapabilities
): ClientCapabilities {
  const snippetSupport = lspCaps?.textDocument?.completion?.completionItem?.snippetSupport === true;
  if (init.client) {
    return {
      hoverHtml: init.client.hoverHtml === true,
      commands: new Set(init.client.commands ?? []),
      ownFileWatcher: init.client.ownFileWatcher === true,
      snippetSupport,
      fileLinks: init.client.fileLinks === true,
      hoverIcons: init.client.hoverIcons === true,
    };
  }
  if (init.clientCommands === true) {
    return {
      hoverHtml: true,
      commands: new Set(allClientCommandIds),
      ownFileWatcher: true,
      snippetSupport: true,
      fileLinks: true,
      hoverIcons: true,
    };
  }
  return {
    hoverHtml: false,
    commands: new Set(),
    ownFileWatcher: false,
    snippetSupport,
    fileLinks: false,
    hoverIcons: false,
  };
}

let caps: ClientCapabilities = resolveClientCapabilities({ clientCommands: true });

export function setClientCapabilities(value: ClientCapabilities): void {
  caps = value;
}

export function clientCapabilities(): ClientCapabilities {
  return caps;
}

/** Whether hover markdown may carry the sanitized colored spans. */
export function hoverHtml(): boolean {
  return caps.hoverHtml;
}

/** Whether hover badges may use `$(codicon)` glyphs instead of a `■` square. */
export function hoverIcons(): boolean {
  return caps.hoverIcons;
}

/** Whether the client registers `id`, so a `command:` link or command action reaches it. */
export function canRunCommand(id: string): boolean {
  return caps.commands.has(id);
}

/** Whether a completion item may carry `${…}` snippet syntax. */
export function snippetSupport(): boolean {
  return caps.snippetSupport;
}

/** Whether hover provenance may be a `file:` markdown link instead of a label. */
export function fileLinks(): boolean {
  return caps.fileLinks;
}
