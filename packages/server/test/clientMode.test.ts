/**
 * Client capabilities (docs/PROTOCOL.md §Initialization): every surface is
 * gated by the capability it needs, so a client can take the hover markup
 * without the commands or one command without the others. The deprecated
 * `clientCommands` boolean still resolves to all-on / all-off, and the rich
 * (VSCode) path stays byte-identical.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { allClientCommandIds, clientCommands, type ParadoxInitOptions } from "@px-lsp/protocol/protocol";
import { resolveClientCapabilities, setClientCapabilities } from "../src/clientMode";
import { colorSwatch, kindBadge, scopePill } from "../src/features/hoverRender";
import { provideCodeActions, type LocEditContext } from "../src/features/codeActions";
import type { ServerData } from "../src/serverData";
import type { Diagnostic } from "vscode-languageserver/node";

/** Install the capabilities a client declaring `init` would get. */
const asClient = (init: Partial<ParadoxInitOptions>): void =>
  setClientCapabilities(resolveClientCapabilities(init));

afterEach(() => asClient({ clientCommands: true }));

describe("capability resolution", () => {
  const allOff = { hoverHtml: false, commands: new Set<string>(), ownFileWatcher: false };

  it("deprecated clientCommands: true means every capability", () => {
    expect(resolveClientCapabilities({ clientCommands: true })).toEqual({
      hoverHtml: true,
      commands: new Set(allClientCommandIds),
      ownFileWatcher: true,
    });
  });

  it("clientCommands: false and an absent declaration are all-off", () => {
    expect(resolveClientCapabilities({ clientCommands: false })).toEqual(allOff);
    expect(resolveClientCapabilities({})).toEqual(allOff);
  });

  it("object form: each capability is independent", () => {
    expect(resolveClientCapabilities({ client: { commands: [clientCommands.showReferences] } })).toEqual({
      ...allOff,
      commands: new Set([clientCommands.showReferences]),
    });
    expect(resolveClientCapabilities({ client: { hoverHtml: true } })).toEqual({
      ...allOff,
      hoverHtml: true,
    });
    expect(resolveClientCapabilities({ client: { ownFileWatcher: true } })).toEqual({
      ...allOff,
      ownFileWatcher: true,
    });
    expect(resolveClientCapabilities({ client: {} })).toEqual(allOff);
  });

  it("the object wins over the deprecated boolean", () => {
    expect(resolveClientCapabilities({ client: { hoverHtml: true }, clientCommands: true })).toEqual({
      ...allOff,
      hoverHtml: true,
    });
  });
});

describe("hover markup per client mode", () => {
  it("emits sanitized spans for the command-capable client", () => {
    asClient({ clientCommands: true });
    expect(kindBadge("trigger")).toContain("<span");
    expect(scopePill("character", null)).toContain("<span");
    expect(colorSwatch([1, 0, 0])).toContain("rgb(255, 0, 0)");
  });

  it("emits plain text for bare clients, keeping the same content", () => {
    asClient({ clientCommands: false });
    expect(kindBadge("trigger")).toBe("■ trigger");
    expect(scopePill("character", null)).toBe("character");
    expect(scopePill("character", new Set(["character"]))).toBe("character");
    expect(colorSwatch([1, 0, 0])).toBe("■");
  });

  it("hoverHtml alone gives the spans, no commands needed", () => {
    asClient({ client: { hoverHtml: true } });
    expect(kindBadge("trigger")).toContain("<span");
    expect(scopePill("character", null)).toContain("<span");
  });

  it("commands alone leave the markup plain", () => {
    asClient({ client: { commands: allClientCommandIds } });
    expect(kindBadge("trigger")).toBe("■ trigger");
    expect(colorSwatch([1, 0, 0])).toBe("■");
  });
});

describe("code actions per client mode", () => {
  const doc = (uri: string) =>
    TextDocument.create(uri, "paradox", 1, "some_decision = {\n\ttitle = a_key\n}\n");
  const missingLoc: Diagnostic = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    message: "missing loc",
    code: "missing-required-loc",
    data: { key: "some_decision_title" },
  };
  /** Range on the `title = a_key` line, where the two editor-command actions live. */
  const keyRange = { start: { line: 1, character: 10 }, end: { line: 1, character: 10 } };
  const stubData = { index: { lookup: () => [] } } as unknown as ServerData;
  const indexedKey = { index: { lookup: () => [{ kind: "loc_key" }] } } as unknown as ServerData;

  it("rich client: command-carrying actions, no edit", () => {
    asClient({ clientCommands: true });
    const actions = provideCodeActions(
      stubData,
      doc("file:///mod/common/decisions/d.txt"),
      missingLoc.range,
      [missingLoc]
    );
    const create = actions.find((a) => a.title.includes("Create localization"));
    expect(create?.command?.command).toBe("px.editLocalization");
    expect(create?.edit).toBeUndefined();
  });

  it("plain client: create-key action carries a real WorkspaceEdit; command actions absent", () => {
    asClient({ clientCommands: false });
    const modRoot = fs.mkdtempSync(path.join(os.tmpdir(), "px-locedit-"));
    try {
      const ctx: LocEditContext = {
        locLanguage: "english",
        modRootOf: () => modRoot,
        locRoots: ["localization"],
      };
      const uri = "file:///" + path.join(modRoot, "common", "decisions", "d.txt").replace(/\\/g, "/");
      const actions = provideCodeActions(stubData, doc(uri), missingLoc.range, [missingLoc], ctx);
      expect(actions).toHaveLength(1);
      const [action] = actions;
      expect(action.command).toBeUndefined();
      expect(action.edit?.documentChanges?.length).toBe(2);
      const [createFile, textEdit] = action.edit!.documentChanges! as [
        { kind: string; uri: string },
        { edits: { newText: string }[] },
      ];
      expect(createFile.kind).toBe("create");
      expect(createFile.uri).toContain("zzz_px_lsp_edits_l_english.yml");
      expect(textEdit.edits[0].newText).toBe('﻿l_english:\n some_decision_title: ""\n');
    } finally {
      fs.rmSync(modRoot, { recursive: true, force: true });
    }
  });

  it("plain client appends to an existing edits file without recreating it", () => {
    asClient({ clientCommands: false });
    const modRoot = fs.mkdtempSync(path.join(os.tmpdir(), "px-locedit-"));
    try {
      const locDir = path.join(modRoot, "localization", "english");
      fs.mkdirSync(locDir, { recursive: true });
      fs.writeFileSync(path.join(locDir, "zzz_px_lsp_edits_l_english.yml"), '﻿l_english:\n existing: "x"\n');
      const ctx: LocEditContext = {
        locLanguage: "english",
        modRootOf: () => modRoot,
        locRoots: ["localization"],
      };
      const uri = "file:///" + path.join(modRoot, "common", "decisions", "d.txt").replace(/\\/g, "/");
      const actions = provideCodeActions(stubData, doc(uri), missingLoc.range, [missingLoc], ctx);
      expect(actions).toHaveLength(1);
      const changes = actions[0].edit!.documentChanges!;
      expect(changes).toHaveLength(1);
      const textEdit = changes[0] as { edits: { newText: string }[] };
      expect(textEdit.edits[0].newText).toBe(' some_decision_title: ""\n');
    } finally {
      fs.rmSync(modRoot, { recursive: true, force: true });
    }
  });

  it("plain client without an edit context gets no dead actions", () => {
    asClient({ clientCommands: false });
    const actions = provideCodeActions(
      stubData,
      doc("file:///mod/common/decisions/d.txt"),
      missingLoc.range,
      [missingLoc]
    );
    expect(actions).toHaveLength(0);
  });

  it("a client registering only px.editLocalization gets that action and not the other", () => {
    asClient({ client: { commands: [clientCommands.editLocalization] } });
    const actions = provideCodeActions(indexedKey, doc("file:///mod/common/decisions/d.txt"), keyRange, []);
    expect(actions.map((a) => a.command?.command)).toEqual(["px.editLocalization"]);
  });

  it("a client registering only px.openLocalizationSideBySide gets that action and a WorkspaceEdit fix", () => {
    asClient({ client: { commands: [clientCommands.openLocalizationSideBySide] } });
    const modRoot = fs.mkdtempSync(path.join(os.tmpdir(), "px-locedit-"));
    try {
      const ctx: LocEditContext = {
        locLanguage: "english",
        modRootOf: () => modRoot,
        locRoots: ["localization"],
      };
      const uri = "file:///" + path.join(modRoot, "common", "decisions", "d.txt").replace(/\\/g, "/");
      const actions = provideCodeActions(indexedKey, doc(uri), keyRange, [missingLoc], ctx);
      const create = actions.find((a) => a.title.includes("Create localization"))!;
      expect(create.command).toBeUndefined();
      expect(create.edit).toBeDefined();
      expect(actions.map((a) => a.command?.command).filter(Boolean)).toEqual([
        "px.openLocalizationSideBySide",
      ]);
    } finally {
      fs.rmSync(modRoot, { recursive: true, force: true });
    }
  });
});
