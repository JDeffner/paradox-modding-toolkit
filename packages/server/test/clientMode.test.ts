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
import { provideHover } from "../src/features/hover";
import { provideGuiHover } from "../src/features/guiLanguage";
import { ServerData } from "../src/serverData";
import type { Diagnostic } from "vscode-languageserver/node";
import { URI } from "vscode-uri";

/** Install the capabilities a client declaring `init` would get. */
const asClient = (init: Partial<ParadoxInitOptions>): void =>
  setClientCapabilities(resolveClientCapabilities(init));

/**
 * A real OS path as a file URI. Hand-building `"file:///" + p` only works where
 * paths start with a drive letter: on POSIX it yields `file:////tmp/...`, whose
 * path opens with `//` and no authority, which vscode-uri rejects outright.
 */
const fileUri = (p: string): string => URI.file(p).toString();

afterEach(() => asClient({ clientCommands: true }));

describe("capability resolution", () => {
  const allOff = {
    hoverHtml: false,
    commands: new Set<string>(),
    ownFileWatcher: false,
    snippetSupport: false,
    fileLinks: false,
    hoverIcons: false,
  };
  /** What a client declares in the STANDARD LSP initialize params. */
  const withSnippets = { textDocument: { completion: { completionItem: { snippetSupport: true } } } };

  it("deprecated clientCommands: true means every capability", () => {
    expect(resolveClientCapabilities({ clientCommands: true })).toEqual({
      hoverHtml: true,
      commands: new Set(allClientCommandIds),
      ownFileWatcher: true,
      snippetSupport: true,
      fileLinks: true,
      hoverIcons: true,
    });
  });

  it("snippetSupport comes from the LSP capabilities, not initializationOptions", () => {
    expect(resolveClientCapabilities({}, withSnippets)).toEqual({ ...allOff, snippetSupport: true });
    expect(resolveClientCapabilities({ client: {} }, withSnippets)).toEqual({
      ...allOff,
      snippetSupport: true,
    });
    expect(resolveClientCapabilities({ client: {} }, { textDocument: { completion: {} } })).toEqual(allOff);
  });

  it("fileLinks is its own axis on the capability object", () => {
    expect(resolveClientCapabilities({ client: { fileLinks: true } })).toEqual({
      ...allOff,
      fileLinks: true,
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
    expect(resolveClientCapabilities({ client: { hoverIcons: true } })).toEqual({
      ...allOff,
      hoverIcons: true,
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

describe("hover degradation for bare clients", () => {
  /** Hover over the call site of an indexed scripted effect that has one reference. */
  function effectHover(): string {
    const data = new ServerData();
    const file = path.join(path.sep === "\\" ? "C:\\mod" : "/mod", "common", "scripted_effects", "a.txt");
    data.index.addAll([{ name: "my_effect", kind: "scripted_effect", file, line: 3, source: "mod" }]);
    data.refIndex.addAll([
      { name: "my_effect", kinds: ["scripted_effect"], file, line: 9, startChar: 1, endChar: 10 },
    ]);
    const text = "e = {\n\tmy_effect = yes\n}";
    const doc = TextDocument.create("file:///mod/events/caps.txt", "paradox", 1, text);
    const hover = provideHover(data, doc, { line: 1, character: 3 }, null);
    expect(hover).not.toBeNull();
    return (hover!.contents as { value: string }).value;
  }

  it("command-capable client: reference count links, provenance is a file link", () => {
    asClient({ clientCommands: true });
    const md = effectHover();
    expect(md).toContain("1 reference");
    expect(md).toContain("command:px.showReferences");
    expect(md).toContain("](file:");
  });

  it("bare client: no reference line at all, provenance as a plain label", () => {
    asClient({ clientCommands: false });
    const md = effectHover();
    // A count nobody can click answers no question (owner's call, 2026-08-26).
    expect(md).not.toMatch(/reference/);
    expect(md).not.toContain("](file:");
    expect(md).toContain("a.txt:4"); // the same provenance, minus the link
  });

  it("fileLinks alone restores the provenance link without the reference count", () => {
    asClient({ client: { fileLinks: true } });
    const md = effectHover();
    expect(md).toContain("](file:");
    expect(md).not.toMatch(/reference/);
  });

  /** Hover over `var:my_toll`, whose definition card carries the wiki link. */
  function variableHover(): string {
    const data = new ServerData();
    const file = path.join(path.sep === "\\" ? "C:\\mod" : "/mod", "events", "toll.txt");
    data.index.addAll([{ name: "my_toll", kind: "variable", file, line: 3, source: "mod", value: "5" }]);
    const text = "e = {\n\tadd_gold = var:my_toll\n}";
    const doc = TextDocument.create("file:///mod/events/spend.txt", "paradox", 1, text);
    const hover = provideHover(data, doc, { line: 1, character: 17 }, null);
    expect(hover).not.toBeNull();
    return (hover!.contents as { value: string }).value;
  }

  it("a variable card links into the Examples Wiki, and only for clients with the command", () => {
    asClient({ clientCommands: true });
    const md = variableHover();
    expect(md).toContain("command:px.showExamplesWiki");
    // The article the link names, so the panel can select it straight away.
    expect(md).toContain(encodeURIComponent(JSON.stringify([{ name: "my_toll", kind: "variable" }])));

    asClient({ clientCommands: false });
    expect(variableHover()).not.toContain("Examples Wiki");
  });

  /** Hover over `using = <template>`, whose card is built by guiLanguage.ts, not hover.ts. */
  function guiTemplateHover(): string {
    const data = new ServerData();
    const file = path.join(path.sep === "\\" ? "C:\\mod" : "/mod", "gui", "my_templates.gui");
    data.index.addAll([{ name: "MyModTemplate", kind: "gui_type", file, line: 3, source: "mod" }]);
    const doc = TextDocument.create(
      "file:///mod/gui/caps.gui",
      "paradox-gui",
      1,
      "widget = {\n\tusing = MyModTemplate\n}"
    );
    const hover = provideGuiHover(data, doc, { line: 1, character: 10 });
    expect(hover).not.toBeNull();
    return (hover!.contents as { value: string }).value;
  }

  // Every hover renderer shares one gate, so a card hover.ts never touches
  // degrades the same way (Sourcery on #23: gui/datafunction links were raw).
  it("gui hovers route their definition link through the same gate", () => {
    asClient({ clientCommands: true });
    expect(guiTemplateHover()).toContain("](file:");

    asClient({ clientCommands: false });
    const bare = guiTemplateHover();
    expect(bare).not.toContain("](file:");
    expect(bare).toContain("my_templates.gui:4"); // the same location, minus the link
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
      const uri = fileUri(path.join(modRoot, "common", "decisions", "d.txt"));
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
      const uri = fileUri(path.join(modRoot, "common", "decisions", "d.txt"));
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
      const uri = fileUri(path.join(modRoot, "common", "decisions", "d.txt"));
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
