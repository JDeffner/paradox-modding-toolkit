import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { eventSourceHash } from "@px-lsp/server/overview/eventSourceHash";
import type { PendingEdit } from "../src/webviews/eventGraph/history";
import type { AppToHost } from "../src/webviews/eventGraph/messages";

const host = vi.hoisted(() => ({
  text: "",
  saved: "",
  save: true,
  apply: true,
  changes: 0,
  file: "",
  mod: "",
  game: "",
  openError: "",
  showDocument: vi.fn(),
  showError: vi.fn(),
}));
vi.mock("vscode", async () => {
  const fs = await import("node:fs");
  class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position
    ) {}
  }
  class WorkspaceEdit {
    edits: Array<{ range: Range; text: string }> = [];
    insert(_uri: unknown, at: Position, text: string) {
      this.edits.push({ range: new Range(at, at), text });
    }
    replace(_uri: unknown, range: Range, text: string) {
      this.edits.push({ range, text });
    }
  }
  const offsetAt = (p: Position) =>
    host.text
      .split("\n")
      .slice(0, p.line)
      .reduce((n, s) => n + s.length + 1, 0) + p.character;
  const positionAt = (offset: number) => {
    const lines = host.text.slice(0, offset).split("\n");
    return new Position(lines.length - 1, lines.at(-1)!.length);
  };
  return {
    Uri: URI,
    Position,
    Range,
    WorkspaceEdit,
    EndOfLine: { LF: 1, CRLF: 2 },
    ViewColumn: { Beside: 2 },
    window: {
      visibleTextEditors: [],
      showTextDocument: host.showDocument,
      showErrorMessage: host.showError,
    },
    workspace: {
      get workspaceFolders() {
        return [{ uri: URI.file(host.mod) }, { uri: URI.file(host.game) }];
      },
      openTextDocument: async () => {
        if (host.openError) throw new Error(host.openError);
        return {
          uri: URI.file(host.file),
          version: 1,
          isClosed: false,
          encoding: "utf8",
          getText: () => host.text,
          positionAt,
          offsetAt,
          eol: 1,
          get lineCount() {
            return host.text.split("\n").length;
          },
          lineAt: (n: number) => ({
            text: host.text.split("\n")[n],
            range: new Range(new Position(n, 0), new Position(n, host.text.split("\n")[n].length)),
          }),
          save: async () => {
            if (host.save) {
              host.saved = host.text;
              fs.writeFileSync(host.file, host.saved);
            }
            return host.save;
          },
        };
      },
      applyEdit: async (edit: WorkspaceEdit) => {
        if (!host.apply) return false;
        const edits = edit.edits.map((e) => ({
          start: offsetAt(e.range.start),
          end: offsetAt(e.range.end),
          text: e.text,
        }));
        for (const e of edits.sort((a, b) => b.start - a.start))
          host.text = host.text.slice(0, e.start) + e.text + host.text.slice(e.end);
        host.changes++;
        return true;
      },
    },
  };
});
vi.mock("../src/webviews/devReload", () => ({}));
vi.mock("../src/webviews/tabIcons", () => ({}));
import { EventGraphPanel } from "../src/webviews/eventGraph/panel";
import { EventGraphWriters } from "../src/eventGraphWriters";

const source = "\uFEFFnamespace = test\ntest.1 = {\n  gold >= 10  prestige = 3 # keep this comment\n}\n";
const field = (
  value: string,
  overrides: Partial<Extract<PendingEdit, { kind: "setField" }>> = {}
): PendingEdit => ({
  kind: "setField",
  id: "test.1",
  file: host.file,
  key: "gold",
  value,
  line: 2,
  insertLine: 2,
  indent: 1,
  sourceHash: eventSourceHash(source),
  ...overrides,
});
function panel(actions: Record<string, unknown> = {}) {
  const instance = Object.create(EventGraphPanel.prototype);
  Object.assign(instance, {
    actions: {
      textureRoots: () => ({ modPath: host.mod, gamePath: host.game }),
      notifyChanged: vi.fn(),
      ...actions,
    },
    session: { focus: {}, positions: {}, pending: [] },
    unsavedFields: new Map(),
    scriptSources: new Map(),
  });
  return instance as {
    applyEdits(edits: PendingEdit[]): Promise<{ applied: number[]; error?: string }>;
    onMessage(message: AppToHost): Promise<void>;
    session: { pending: PendingEdit[] };
  };
}
beforeEach(() => {
  const base = path.resolve(".local/testing");
  fs.mkdirSync(base, { recursive: true });
  host.mod = fs.mkdtempSync(path.join(base, "graph-panel-"));
  host.game = path.join(host.mod, "vanilla");
  host.file = path.join(host.mod, "events.txt");
  fs.writeFileSync(host.file, source);
  Object.assign(host, { text: source, saved: source, apply: true, save: true, changes: 0, openError: "" });
  host.showDocument.mockClear();
  host.showError.mockClear();
});
afterEach(() => fs.rmSync(host.mod, { recursive: true, force: true }));
it.each([
  [undefined, 0],
  [0, 0],
  [1, 1],
  [2, 2],
  [-1, 0],
  [99, 4],
])("opens zero-based source line %s at editor line %s", async (line, expected) => {
  await panel().onMessage({ type: "open", file: host.file, line });
  expect(host.showDocument).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ uri: URI.file(host.file) }),
    {
      viewColumn: 2,
      preserveFocus: true,
      selection: {
        start: { line: expected, character: 0 },
        end: { line: expected, character: 0 },
      },
    }
  );
  expect(host.showError).not.toHaveBeenCalled();
});
it("reports a source-open failure instead of showing an editor", async () => {
  host.openError = "The source file no longer exists";
  await panel().onMessage({ type: "open", file: host.file, line: 2 });
  expect(host.showDocument).not.toHaveBeenCalled();
  expect(host.showError).toHaveBeenCalledExactlyOnceWith(
    `Event Graph: cannot open ${host.file}: The source file no longer exists`
  );
});
it("preserves the operator, spacing, neighboring statement and inline comment", async () => {
  expect(await panel().applyEdits([field("25")])).toEqual({ applied: [0] });
  expect(host.saved).toBe(source.replace("gold >= 10", "gold >= 25"));
});
it("rejects a stale form against current unsaved content", async () => {
  host.text = source.replace("gold >= 10", "gold >= 99");
  const result = await panel().applyEdits([field("25")]);
  expect(result).toMatchObject({ applied: [], error: expect.stringMatching(/changed|stale/i) });
  expect(host.text).toBe(source.replace("gold >= 10", "gold >= 99"));
  expect(host.changes).toBe(0);
});
it("does not report a failed document save as applied", async () => {
  host.save = false;
  const instance = panel();
  const result = await instance.applyEdits([field("25")]);
  expect(result).toMatchObject({ applied: [], error: expect.stringMatching(/save/i) });
  expect(host.saved).toBe(source);
});
it("saves the final repeated value and both insertions in one file edit", async () => {
  const edits = [
    field("20"),
    field("25"),
    field("4", { key: "new_field", line: null }),
    field("5", { key: "other_field", line: null }),
  ];
  expect(await panel().applyEdits(edits)).toEqual({ applied: [0, 1, 2, 3] });
  expect(host.saved).toBe(
    source
      .replace("gold >= 10", "gold >= 25")
      .replace("test.1 = {\n", "test.1 = {\n\tnew_field = 4\n\tother_field = 5\n")
  );
  expect(host.changes).toBe(1);
});
it("retains pending insertions on failed save and retries without inserting twice", async () => {
  const edits = [field("4", { key: "new_field", line: null })];
  const instance = panel();
  instance.session.pending = edits;
  host.save = false;
  expect(await instance.applyEdits(edits)).toMatchObject({ applied: [], error: expect.any(String) });
  expect(instance.session.pending).toEqual(edits);
  const dirty = host.text;
  host.save = true;
  expect(await instance.applyEdits(edits)).toEqual({ applied: [0] });
  expect(host.saved).toBe(dirty);
  expect(host.saved.match(/new_field/g)).toHaveLength(1);
  expect(instance.session.pending).toEqual([]);
  expect(host.changes).toBe(1);
});
it("refuses retry after unrelated unsaved changes and preserves rejected edits", async () => {
  const edits = [field("25")];
  const instance = panel();
  instance.session.pending = edits;
  host.save = false;
  await instance.applyEdits(edits);
  host.text += "# unrelated dirty work\n";
  const dirty = host.text;
  host.save = true;
  expect(await instance.applyEdits(edits)).toMatchObject({
    applied: [],
    error: expect.stringMatching(/changed/i),
  });
  expect(host.text).toBe(dirty);
  expect(instance.session.pending).toEqual(edits);
});
it("does not write vanilla even when the game directory is a workspace folder", async () => {
  expect(
    await panel().applyEdits([field("25", { file: path.join(host.game, "events/test.txt") })])
  ).toMatchObject({
    applied: [],
    error: expect.stringMatching(/refused/),
  });
  expect(host.changes).toBe(0);
});
it("keeps the original source and pending edits when applyEdit rejects the batch", async () => {
  host.apply = false;
  const edits = [field("25")];
  const instance = panel();
  instance.session.pending = edits;
  expect(await instance.applyEdits(edits)).toMatchObject({
    applied: [],
    error: expect.stringMatching(/edit was rejected/i),
  });
  expect(host.text).toBe(source);
  expect(instance.session.pending).toEqual(edits);
});
it("rejects a value that injects a neighboring statement", async () => {
  expect(await panel().applyEdits([field("25 prestige = 0")])).toMatchObject({
    applied: [],
    error: expect.stringMatching(/invalid field/),
  });
  expect(host.text).toBe(source);
});
it("adds the required UTF-8 BOM when editing a headerless script", async () => {
  host.text = source.slice(1);
  host.saved = host.text;
  fs.writeFileSync(host.file, host.saved);
  expect(await panel().applyEdits([field("25")])).toEqual({ applied: [0] });
  expect(fs.readFileSync(host.file).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(host.saved).toBe(source.replace("gold >= 10", "gold >= 25"));
});
it("rejects disk changes even when the open editor has the old content", async () => {
  const disk = source + "# external file change\n";
  fs.writeFileSync(host.file, disk);
  expect(await panel().applyEdits([field("25")])).toMatchObject({
    applied: [],
    error: expect.stringMatching(/changed/i),
  });
  expect(fs.readFileSync(host.file, "utf8")).toBe(disk);
  expect(host.text).toBe(source);
});
it("preserves quoting when the inspector submits a string without its surrounding quotes", async () => {
  const quoted = source.replace("gold >= 10", 'label = "first value"');
  host.text = quoted;
  host.saved = quoted;
  fs.writeFileSync(host.file, quoted);
  expect(
    await panel().applyEdits([field("next value", { key: "label", sourceHash: eventSourceHash(quoted) })])
  ).toEqual({ applied: [0] });
  expect(host.saved).toBe(quoted.replace('"first value"', '"next value"'));
});
it("inserts into an inline nested block while preserving its parent and existing statements", async () => {
  const inline = "\uFEFFnamespace = test\ntest.1 = { trigger = { gold >= 10 } }\n";
  host.text = inline;
  host.saved = inline;
  fs.writeFileSync(host.file, inline);
  expect(
    await panel().applyEdits([
      field("3", { key: "prestige", line: null, indent: 2, sourceHash: eventSourceHash(inline) }),
    ])
  ).toEqual({ applied: [0] });
  expect(host.saved).toBe(inline.replace("trigger = {", "trigger = {\n\t\tprestige = 3\n"));
});

it("saves two queued options in order after applying fields at their original positions", async () => {
  const writers = new EventGraphWriters();
  const localized: string[] = [];
  const instance = panel({
    addOption: (id: string, file: string, _endLine: number, count: number) =>
      writers.addOption(id, file, count, async (key) => {
        localized.push(key);
      }),
  });
  const option = (count: number): PendingEdit => ({
    kind: "addOption",
    id: "test.1",
    file: host.file,
    endLine: 3,
    count,
    sourceHash: eventSourceHash(source),
  });
  const edits = [option(0), option(1), field("4", { key: "new_field", line: null })];
  instance.session.pending = edits;
  expect(await instance.applyEdits(edits)).toEqual({ applied: [2, 0, 1] });
  expect(localized).toEqual(["test.1.a", "test.1.b"]);
  expect(host.saved).toContain("new_field = 4");
  expect(host.saved).toContain("gold >= 10  prestige = 3 # keep this comment");
  expect(host.saved.match(/name = test\.1\.[ab]/g)).toEqual(["name = test.1.a", "name = test.1.b"]);
  expect(instance.session.pending).toEqual([]);
});
