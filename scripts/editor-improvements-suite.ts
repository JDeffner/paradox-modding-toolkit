import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { decodeDds, encodeDds, encodePng } from "../packages/server/src/dds";
import type { BatchResult } from "../packages/vscode/src/imageBatch";
import { run as checkBBCode } from "./ux-vscode-suite";
import { run as checkEncoding } from "./encoding-vscode-suite";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pick(index: number): Promise<void> {
  await pause(500);
  for (let i = 0; i < index; i++)
    await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
  await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
}

async function renderer() {
  const targets = (await (await fetch("http://127.0.0.1:9338/json/list")).json()) as {
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
  }[];
  const target = targets.find((item) => item.type === "page" && item.url.includes("workbench"));
  assert.ok(target, "isolated renderer exposes its workbench");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  type Replies = {
    "Page.captureScreenshot": { data: string };
    "Runtime.evaluate": { result: { value: string } };
    "Input.dispatchKeyEvent": void;
  };
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  socket.addEventListener("message", (event) => {
    const reply = JSON.parse(String(event.data));
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.error) waiter.reject(new Error(JSON.stringify(reply.error)));
    else waiter.resolve(reply.result);
  });
  const send = <M extends keyof Replies>(
    method: M,
    params: Record<string, unknown> = {}
  ): Promise<Replies[M]> =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve: (value) => resolve(value as Replies[M]), reject });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  return { send, close: () => socket.close() };
}

async function checks(): Promise<void> {
  const scratch = process.env.PX_EDITOR_TEST_SCRATCH!;
  assert.ok(scratch);
  const extension = vscode.extensions.getExtension("JDeffner.px-toolkit");
  assert.ok(extension);
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(!commands.includes("px.openCompatch"), "compatch is absent from the packaged extension");
  const cdp = await renderer();
  try {
    await vscode.commands.executeCommand("px.tools.focus");
    await pause(800);
    const initial = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    });
    for (const label of ["UTILS", "TEST & TROUBLESHOOT", "PATHS"])
      assert.ok(initial.result.value.toUpperCase().includes(label), `${label} is visible before opening it`);
    for (const id of ["view", "create", "publish", "info", "settings"])
      assert.ok(!commands.includes(`px.${id}.focus`), `${id} no longer occupies a separate view`);
    const initialShot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(scratch, "initial-sidebar.png"), Buffer.from(initialShot.data, "base64"));
    for (const id of ["tools", "utils", "test", "paths"]) {
      assert.ok(commands.includes(`px.${id}.focus`), `${id} has its own view`);
      await vscode.commands.executeCommand(`px.${id}.focus`);
    }
    await vscode.commands.executeCommand("px.utils.focus");
    await pause(1000);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(scratch, "sidebar.png"), Buffer.from(shot.data, "base64"));
    const text = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    });
    await fs.writeFile(path.join(scratch, "sidebar.txt"), text.result.value);
    assert.match(text.result.value, /UTILS/i);
    await vscode.commands.executeCommand("workbench.action.moveFocusedView", "px.utils");
    await pick(0);
    await pause(600);
    const moved = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    });
    await fs.writeFile(path.join(scratch, "moved-view.txt"), moved.result.value);
    assert.match(moved.result.value, /UTILS/i);
    const movedShot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(scratch, "moved-view.png"), Buffer.from(movedShot.data, "base64"));
    const dir = path.join(scratch, "Mod/images");
    await fs.mkdir(dir, { recursive: true });
    const pixels = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 128]);
    const source = path.join(dir, "alpha.dds");
    const sourceBytes = encodeDds(2, 1, pixels, "bgra8");
    await fs.writeFile(source, sourceBytes);
    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(source));
    await pause(300);
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "F10",
      code: "F10",
      modifiers: 8,
      windowsVirtualKeyCode: 121,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "F10",
      code: "F10",
      modifiers: 8,
      windowsVirtualKeyCode: 121,
    });
    await pause(300);
    const menu = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    });
    await fs.writeFile(path.join(scratch, "context-menu.txt"), menu.result.value);
    assert.match(menu.result.value, /PX: Convert DDS/);
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    for (const [index, ext, background] of [
      [0, "png", false],
      [1, "jpg", true],
      [2, "webp", false],
    ] as const) {
      const pending = vscode.commands.executeCommand<BatchResult>(
        "px.convertDdsToImage",
        vscode.Uri.file(source)
      );
      await pick(index);
      if (background) await pick(1);
      await pick(1);
      const result = await pending;
      assert.equal(result?.written.length, 1, JSON.stringify(result));
      assert.equal(result.failed.length, 0);
      const output = await fs.readFile(path.join(dir, `alpha.${ext}`));
      if (ext === "jpg") assert.deepEqual([...output.subarray(0, 2)], [255, 216]);
      else if (ext === "webp") assert.equal(output.toString("ascii", 8, 12), "WEBP");
      else assert.equal(output[0], 137);
    }
    assert.deepEqual(await fs.readFile(source), Buffer.from(sourceBytes));
    // Only a real output collision prompts; the toast can preserve existing files.
    const again = vscode.commands.executeCommand<BatchResult>(
      "px.convertDdsToImage",
      vscode.Uri.file(source)
    );
    await pick(0);
    await pick(1);
    await pause(400);
    const conflict = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    });
    assert.match(conflict.result.value, /An output already exists:/);
    await cdp.send("Runtime.evaluate", {
      expression:
        "[...document.querySelectorAll('.notifications-toasts .monaco-button')].find(e => e.textContent === 'Skip Existing').click()",
      returnByValue: true,
    });
    const skipped = await again;
    assert.equal(skipped?.skipped.length, 1);
    const input = path.join(dir, "other.png");
    await fs.writeFile(input, encodePng(2, 1, pixels));
    const toDds = vscode.commands.executeCommand<BatchResult>("px.convertToDds", vscode.Uri.file(input));
    await pick(3);
    await pick(0);
    await pick(1);
    assert.equal((await toDds)?.written.length, 1);
    assert.deepEqual(decodeDds(await fs.readFile(path.join(dir, "other.dds"))).pixels, pixels);
    const corrupt = path.join(dir, "broken.dds");
    await fs.writeFile(corrupt, "bad DDS");
    const failed = vscode.commands.executeCommand<BatchResult>(
      "px.convertDdsToImage",
      vscode.Uri.file(corrupt)
    );
    await pick(0);
    await pick(1);
    // Error summaries are notifications; close them after collecting the result.
    await pause(500);
    await vscode.commands.executeCommand("notifications.clearAll");
    const failure = await failed;
    assert.equal(failure?.failed.length, 1);
    assert.equal(failure.written.length, 0);
    const cancel = vscode.commands.executeCommand("px.convertDdsToImage", vscode.Uri.file(source));
    await pause(400);
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    assert.equal(await cancel, undefined);
    await checkBBCode();
    await checkEncoding();
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          checks: [
            "Project plus three movable utility views",
            "rendered sidebar screenshot",
            "Utils moved to its own panel",
            "direct DDS Explorer context actions",
            "DDS to PNG/JPEG/WebP through public commands",
            "PNG to DDS through Chromium",
            "source preservation and existing-output skip",
            "corrupt-file failure and picker cancellation",
            "BBCode native editor workflow",
            "encoding diagnostics and native quick fix",
          ],
        },
        null,
        2
      )
    );
  } finally {
    cdp.close();
  }
}

export async function run(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checks(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Packaged editor checks exceeded 180 seconds")), 180_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
