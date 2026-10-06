import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function connect(
  marker = "Boolean(document.getElementById('scope') && document.getElementById('categories'))"
) {
  const version = (await (await fetch("http://127.0.0.1:9339/json/version")).json()) as {
    webSocketDebuggerUrl: string;
  };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map<
    number,
    { resolve(value: Record<string, unknown>): void; reject(error: Error): void }
  >();
  const contexts = new Map<string, number[]>();
  socket.addEventListener("message", (event) => {
    const reply = JSON.parse(String(event.data));
    if (reply.method === "Runtime.executionContextCreated" && reply.params.context.auxData?.isDefault) {
      const list = contexts.get(reply.sessionId) ?? [];
      list.push(reply.params.context.id);
      contexts.set(reply.sessionId, list);
    }
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.error) waiter.reject(new Error(JSON.stringify(reply.error)));
    else waiter.resolve(reply.result);
  });
  const send = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const next = ++id;
      const timer = setTimeout(
        () => {
          pending.delete(next);
          reject(new Error(`CDP request timed out: ${method}`));
        },
        method === "Runtime.evaluate" ? 190_000 : 30_000
      );
      pending.set(next, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
  const sessions = new Map<string, string>();
  let workbench = "";
  let app: { session: string; context: number } | undefined;
  const evaluate = async (expression: string, session: string, context?: number) => {
    const reply = await send(
      "Runtime.evaluate",
      { expression, contextId: context, returnByValue: true, awaitPromise: true },
      session
    );
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return (reply.result as { value: unknown }).value;
  };
  for (let attempt = 0; attempt < 80 && !app; attempt++) {
    const { targetInfos } = (await send("Target.getTargets")) as {
      targetInfos: { targetId: string; type: string; url: string }[];
    };
    for (const target of targetInfos.filter((t) => ["page", "iframe"].includes(t.type))) {
      let session = sessions.get(target.targetId);
      if (!session) {
        const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
        session = attached.sessionId as string;
        sessions.set(target.targetId, session);
        await send("Runtime.enable", {}, session);
      }
      if (target.url.includes("workbench")) workbench = session;
      for (const context of contexts.get(session) ?? []) {
        try {
          if (await evaluate(marker, session, context)) {
            app = { session, context };
            break;
          }
        } catch {
          /* Contexts can be replaced while the webview starts. */
        }
      }
    }
    if (!app) await pause(250);
  }
  assert.ok(app, "webview app loaded in the packaged webview");
  const active = app;
  return {
    eval: (expression: string) => evaluate(expression, active.session, active.context),
    evalWorkbench: (expression: string) => evaluate(expression, workbench),
    sendWorkbench: (method: string, params: Record<string, unknown>) => send(method, params, workbench),
    screenshot: async (file: string, fromSurface = false) => {
      await vscode.commands.executeCommand("notifications.clearAll");
      await send("Page.bringToFront", {}, workbench);
      await pause(250);
      await evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        workbench
      );
      const shot = await send("Page.captureScreenshot", { format: "png", fromSurface }, workbench);
      await fs.writeFile(file, Buffer.from(shot.data as string, "base64"));
    },
    close: () => socket.close(),
  };
}
