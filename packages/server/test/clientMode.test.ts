/**
 * Plain-LSP-client mode (no initializationOptions.clientCommands): hover
 * markup degrades to plain markdown and code actions carry WorkspaceEdits
 * instead of px.* commands. The VSCode client path (rich) stays byte-identical.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { setCommandCapableClient } from "../src/clientMode";
import { colorSwatch, kindBadge, scopePill } from "../src/features/hoverRender";
import { provideCodeActions, type LocEditContext } from "../src/features/codeActions";
import type { ServerData } from "../src/serverData";
import type { Diagnostic } from "vscode-languageserver/node";

afterEach(() => setCommandCapableClient(true));

describe("hover markup per client mode", () => {
  it("emits sanitized spans for the command-capable client", () => {
    setCommandCapableClient(true);
    expect(kindBadge("trigger")).toContain("<span");
    expect(scopePill("character", null)).toContain("<span");
    expect(colorSwatch([1, 0, 0])).toContain("rgb(255, 0, 0)");
  });

  it("emits plain text for bare clients, keeping the same content", () => {
    setCommandCapableClient(false);
    expect(kindBadge("trigger")).toBe("■ trigger");
    expect(scopePill("character", null)).toBe("character");
    expect(scopePill("character", new Set(["character"]))).toBe("character");
    expect(colorSwatch([1, 0, 0])).toBe("■");
  });
});

describe("code actions per client mode", () => {
  const doc = (uri: string) => TextDocument.create(uri, "paradox", 1, "some_decision = {\n}\n");
  const missingLoc: Diagnostic = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    message: "missing loc",
    code: "missing-required-loc",
    data: { key: "some_decision_title" },
  };
  const stubData = { index: { lookup: () => [] } } as unknown as ServerData;

  it("rich client: command-carrying actions, no edit", () => {
    setCommandCapableClient(true);
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
    setCommandCapableClient(false);
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
    setCommandCapableClient(false);
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
    setCommandCapableClient(false);
    const actions = provideCodeActions(
      stubData,
      doc("file:///mod/common/decisions/d.txt"),
      missingLoc.range,
      [missingLoc]
    );
    expect(actions).toHaveLength(0);
  });
});
