import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import * as path from "node:path";
import { URI } from "vscode-uri";
import type { AppToHost, HostToApp, CharacterForm } from "../src/webviews/dynastyTree/messages";
import type { PxConfig } from "../src/config";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { computeDefinitionEdits } from "@px-lsp/server/creators/definitionEdit";
import { characterForm } from "../src/webviews/dynastyTree/blocks";

const host = vi.hoisted(() => ({
  text: "",
  file: "",
  mod: "",
  posted: [] as HostToApp[],
  receive: (_msg: AppToHost) => {},
  close: () => {},
  save: vi.fn(),
  settings: {} as Record<string, boolean>,
}));

vi.mock("vscode", async () => {
  const { URI } = await import("vscode-uri");
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    ViewColumn: { Active: 1 },
    workspace: {
      openTextDocument: async () => ({ getText: () => host.text, positionAt: () => ({ line: 0 }) }),
      getConfiguration: () => ({ get: (key: string, fallback: boolean) => host.settings[key] ?? fallback }),
    },
    window: {
      createWebviewPanel: () => ({
        reveal() {},
        dispose() {},
        onDidDispose: (cb: () => void) => {
          host.close = cb;
          return disposable;
        },
        webview: {
          html: "",
          cspSource: "test",
          asWebviewUri: (uri: URI) => uri,
          postMessage: (msg: HostToApp) => {
            host.posted.push(msg);
            return Promise.resolve(true);
          },
          onDidReceiveMessage: (cb: (msg: AppToHost) => void) => {
            host.receive = cb;
            return disposable;
          },
        },
      }),
    },
  };
});
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/extension"), watch: false }),
  bundleUri: () => "app.js",
  watchBundle: () => ({ dispose() {} }),
}));
vi.mock("../src/webviews/tabIcons", () => ({ tabIcon: () => undefined }));
vi.mock("../src/creators/save", async (original) => ({
  ...(await original<typeof import("../src/creators/save")>()),
  defaultSaveTarget: () => ({ modPath: host.mod, modLabel: "Mod", file: "characters.txt" }),
  openSaveTarget: async () => ({ abs: host.file, text: host.text }),
  applyDefinitionEdits: (...args: unknown[]) => host.save(...args),
}));

import { DynastyTreePanel, type DynastyTreeActions } from "../src/webviews/dynastyTree/panel";

let scratch: string;
let actions: DynastyTreeActions;
const SOURCE =
  "42 = {\n    name = Old # } is a comment, not the closing brace\n    culture = norse\n    900.1.1 = { death = { death_reason = death_murder killer = 5 } }\n}";

beforeEach(() => {
  const base = path.resolve(".local/testing");
  mkdirSync(base, { recursive: true });
  scratch = mkdtempSync(path.join(base, "dynasty-save-"));
  host.mod = path.join(scratch, "Mod");
  host.file = path.join(host.mod, "history/characters/characters.txt");
  host.text = SOURCE;
  host.posted = [];
  host.settings = {};
  host.save.mockReset().mockImplementation(async (_file, before, edits) => {
    if (before !== host.text) return "stale";
    for (const edit of [...edits].sort((a, b) => b.start - a.start))
      host.text = host.text.slice(0, edit.start) + edit.newText + host.text.slice(edit.end);
    return "saved";
  });
  actions = {
    fetchTree: vi.fn(async () => ({ supported: true, dynasties: [] })),
    fetchOptions: vi.fn(async () => null),
    editDefinition: vi.fn(async (params) => computeDefinitionEdits(params)),
    writeLoc: vi.fn(),
  };
  DynastyTreePanel.show(
    { globalStorageUri: URI.file(scratch) } as import("vscode").ExtensionContext,
    actions,
    {
      cfg: { gameId: "ck3", modPath: host.mod, workspaceMods: [], parentPaths: [] } as unknown as PxConfig,
      meta: { name: "CK3" } as GameMeta,
      mods: [{ path: host.mod, label: "Mod" }],
      modRoot: host.mod,
    }
  );
});
afterEach(() => {
  host.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function open(): Promise<CharacterForm> {
  host.receive({ type: "target", file: host.file, character: "42", sourceFile: host.file });
  await vi.waitFor(() => expect(host.posted.some((m) => m.type === "characterSource")).toBe(true));
  const msg = host.posted.find((m) => m.type === "characterSource")!;
  if (msg.type !== "characterSource") throw new Error("No source response");
  return msg.form;
}
async function save(form: CharacterForm, existing = true): Promise<void> {
  host.receive({ type: "saveCharacter", form, file: existing ? host.file : undefined });
  await vi.waitFor(() =>
    expect(host.posted.some((m) => m.type === "saved" || m.type === "characterSaveFailed")).toBe(true)
  );
}

it("opens unsaved text and preserves unrelated unsaved edits when saving through the panel", async () => {
  host.text = SOURCE.replace("name = Old", "name = Unsaved");
  const form = await open();
  expect(form.name).toBe("Unsaved");
  expect(form.deathReason).toBe("death_murder");
  host.text += "\n77 = { name = Other } # unsaved sibling\n";
  const before = host.text;
  form.culture = "anglo_saxon";
  await save(form);
  expect(host.text).toBe(before.replace("culture = norse", "culture = anglo_saxon"));
  expect(host.posted.some((m) => m.type === "saved")).toBe(true);
});

it("refuses a form whose character changed after it opened", async () => {
  const form = await open();
  host.text = SOURCE.replace("killer = 5", "killer = 6");
  await save({ ...form, name: "Changed" });
  expect(host.save).not.toHaveBeenCalled();
  expect(host.posted).toContainEqual({
    type: "characterSaveFailed",
    message: expect.stringContaining("changed since"),
  });
  expect(host.text).toContain("killer = 6");
});

it("rechecks the source after the asynchronous server edit request", async () => {
  const form = await open();
  actions.editDefinition = async (params) => {
    host.text = SOURCE.replace("name = Old", "name = Newer");
    return computeDefinitionEdits(params);
  };
  await save({ ...form, name: "Changed" });
  expect(host.save).not.toHaveBeenCalled();
  expect(host.text).toContain("name = Newer");
});

it("reports failed writes without a success message or undo entry", async () => {
  const form = await open();
  host.save.mockResolvedValue("failed");
  await save({ ...form, name: "Changed" });
  expect(host.posted.some((m) => m.type === "saved" || m.type === "journal")).toBe(false);
  expect(host.text).toBe(SOURCE);
});

it("refuses to replace an existing id with a new character", async () => {
  await save(characterForm(SOURCE), false);
  expect(host.save).not.toHaveBeenCalled();
  expect(host.posted).toContainEqual({
    type: "characterSaveFailed",
    message: expect.stringContaining("already contains 42"),
  });
});

it("reads the project's separate quotation defaults for a new character", async () => {
  host.text = "";
  host.settings = {
    "characterHistory.quoteNames": false,
    "characterHistory.quoteCultures": false,
    "characterHistory.quoteReligions": true,
  };
  await save(
    {
      id: "99",
      name: "My_name_key",
      culture: "norse",
      religion: "catholic",
      female: false,
      traits: [],
      spouses: [],
    },
    false
  );
  expect(host.text).toContain("name = My_name_key");
  expect(host.text).toContain("culture = norse");
  expect(host.text).toContain('religion = "catholic"');
});
