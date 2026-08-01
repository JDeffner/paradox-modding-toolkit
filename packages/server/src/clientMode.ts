/**
 * Client capability mode (docs/PROTOCOL.md §Initialization): a client that
 * declares `initializationOptions.clientCommands` registers the px.* command
 * ids and renders the sanitized hover HTML (the VSCode extension). Every
 * other client gets plain markdown, no `command:` links, and WorkspaceEdit
 * code actions. Defaults to true so the pure-render unit tests exercise the
 * rich output; server.ts sets the real value at initialize.
 */
let commandCapable = true;

export function setCommandCapableClient(value: boolean): void {
  commandCapable = value;
}

/** Whether the connected client registers px.* commands and renders rich hover markup. */
export function commandCapableClient(): boolean {
  return commandCapable;
}
