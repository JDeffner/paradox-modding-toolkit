/**
 * The transport shim: the ONLY file under app/ that knows which host it runs
 * in. Everything else speaks messages.ts and nothing else, which is what makes
 * the editor portable.
 *
 * VS Code injects `acquireVsCodeApi` into the webview page. A different host
 * adds its branch here and changes nothing else.
 */
import type { AppToHost, HostToApp } from "../messages";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

export interface HostConnection {
  send(message: AppToHost): void;
}

export function connectHost(onMessage: (message: HostToApp) => void): HostConnection {
  const api = acquireVsCodeApi();
  window.addEventListener("message", (event: MessageEvent<HostToApp | undefined>) => {
    if (event.data) onMessage(event.data);
  });
  return { send: (message) => api.postMessage(message) };
}
