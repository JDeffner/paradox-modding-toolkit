import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const host = vi.hoisted(() => {
  const changes = new Set<(event: { document: unknown }) => void>();
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  class TabInputCustom {
    constructor(
      public uri: unknown,
      public viewType: string
    ) {}
  }
  return {
    changes,
    commands,
    TabInputCustom,
    window: {
      activeTextEditor: undefined as { document: unknown } | undefined,
      tabGroups: {
        activeTabGroup: { activeTab: undefined as { input: unknown } | undefined, viewColumn: 2 },
      },
      registerCustomEditorProvider: vi.fn(),
      showInformationMessage: vi.fn(),
      showTextDocument: vi.fn(),
    },
    openTextDocument: vi.fn(),
    executeCommand: vi.fn(),
  };
});

vi.mock("vscode", () => ({
  window: host.window,
  workspace: {
    openTextDocument: host.openTextDocument,
    onDidChangeTextDocument: (callback: (event: { document: unknown }) => void) => {
      host.changes.add(callback);
      return { dispose: () => host.changes.delete(callback) };
    },
    registerFileSystemProvider: vi.fn(),
  },
  commands: {
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
      host.commands.set(name, callback);
      return { dispose: () => host.commands.delete(name) };
    },
    executeCommand: host.executeCommand,
  },
  languages: { registerCompletionItemProvider: vi.fn() },
  EventEmitter: class {
    event = vi.fn();
  },
  TabInputCustom: host.TabInputCustom,
  ViewColumn: { Active: -1, Beside: -2 },
}));
vi.mock("../src/webviews/wiki/panel", () => ({ STEAM_BBCODE_ARTICLE: "BBCode" }));

import { BBCodePreviewProvider, registerBBCodeSupport } from "../src/bbcodeSupport";

function document(name: string, initialText = "[b]Unsaved[/b]") {
  let text = initialText;
  const uri = { scheme: "file", path: `/${name}.bbcode`, toString: () => `file:///${name}.bbcode` };
  return {
    uri,
    languageId: "bbcode",
    isDirty: true,
    getText: () => text,
    setText: (value: string) => {
      text = value;
    },
  } as unknown as vscode.TextDocument & { setText: (value: string) => void };
}

function panel() {
  let message: (value: unknown) => void;
  let dispose: () => void;
  const webview = {
    html: "",
    options: {},
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn((callback: (value: unknown) => void) => {
      message = callback;
      return { dispose: vi.fn() };
    }),
  };
  const view = {
    webview,
    onDidDispose: (callback: () => void) => {
      dispose = callback;
    },
  } as unknown as vscode.WebviewPanel;
  return { view, webview, ready: () => message({ type: "ready" }), dispose: () => dispose() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  host.changes.clear();
  host.commands.clear();
  host.window.activeTextEditor = undefined;
  host.window.tabGroups.activeTabGroup.activeTab = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BBCode custom text preview", () => {
  it("renders dirty text when the webview is ready and keeps file views independent", () => {
    const provider = new BBCodePreviewProvider();
    const first = document("first");
    const second = document("second", "[i]Second[/i]");
    const firstPanel = panel();
    const secondPanel = panel();
    provider.resolveCustomTextEditor(first, firstPanel.view);
    provider.resolveCustomTextEditor(second, secondPanel.view);
    expect(firstPanel.webview.postMessage).not.toHaveBeenCalled();
    firstPanel.ready();
    secondPanel.ready();
    expect(firstPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: "render",
      html: '<strong class="bb-b">Unsaved</strong>',
    });
    first.setText("[b]Changed[/b]");
    for (const callback of host.changes) callback({ document: first });
    vi.advanceTimersByTime(150);
    expect(firstPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: "render",
      html: '<strong class="bb-b">Changed</strong>',
    });
    expect(secondPanel.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(first.languageId).toBe("bbcode");
    expect(first.isDirty).toBe(true);
    expect(firstPanel.webview.html).toContain('vscode.postMessage({ type: "ready" })');
    expect(firstPanel.webview.html).toContain("default-src 'none'");
    expect(firstPanel.webview.options).toEqual({ enableScripts: true, localResourceRoots: [] });
    firstPanel.dispose();
    secondPanel.dispose();
    expect(host.changes.size).toBe(0);
  });

  it("disposes pending updates when a preview closes", () => {
    const source = document("closing");
    const preview = panel();
    new BBCodePreviewProvider().resolveCustomTextEditor(source, preview.view);
    for (const callback of host.changes) callback({ document: source });
    preview.dispose();
    vi.advanceTimersByTime(150);
    expect(preview.webview.postMessage).not.toHaveBeenCalled();
  });

  it("uses the renderer's escaping and URL restrictions", () => {
    const preview = panel();
    new BBCodePreviewProvider().resolveCustomTextEditor(
      document("unsafe", "<script>bad()</script>[url=javascript:bad()]link[/url]"),
      preview.view
    );
    preview.ready();
    const html = preview.webview.postMessage.mock.calls[0][0].html as string;
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript:');
    preview.dispose();
  });
});

describe("BBCode editor commands", () => {
  beforeEach(() => {
    registerBBCodeSupport({ subscriptions: [] } as unknown as vscode.ExtensionContext);
  });

  it("registers the preview as a custom text editor with multiple views", () => {
    expect(host.window.registerCustomEditorProvider).toHaveBeenCalledWith(
      "px.bbcodePreview",
      expect.any(BBCodePreviewProvider),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }
    );
  });

  it("opens an Explorer target instead of the unrelated active editor", async () => {
    const target = document("selected");
    host.window.activeTextEditor = { document: document("other") };
    host.openTextDocument.mockResolvedValue(target);
    await host.commands.get("px.openBBCodePreview")!(target.uri);
    expect(host.openTextDocument).toHaveBeenCalledWith(target.uri);
    expect(host.executeCommand).toHaveBeenCalledWith("vscode.openWith", target.uri, "px.bbcodePreview", {
      viewColumn: -1,
      preserveFocus: false,
      preview: false,
    });
  });

  it("opens the active source to the side using the same provider", async () => {
    const source = document("source");
    host.window.activeTextEditor = { document: source };
    await host.commands.get("px.openBBCodePreviewSide")!();
    expect(host.executeCommand).toHaveBeenCalledWith("vscode.openWith", source.uri, "px.bbcodePreview", {
      viewColumn: -2,
      preserveFocus: true,
      preview: false,
    });
  });

  it("returns to the active preview's source despite another visible text editor", async () => {
    const source = document("preview-source");
    host.window.activeTextEditor = { document: document("other") };
    host.window.tabGroups.activeTabGroup.activeTab = {
      input: new host.TabInputCustom(source.uri, "px.bbcodePreview"),
    };
    host.openTextDocument.mockResolvedValue(source);
    await host.commands.get("px.openBBCodeSource")!();
    expect(host.executeCommand).toHaveBeenCalledWith("vscode.openWith", source.uri, "default", {
      viewColumn: 2,
      preview: false,
    });
  });
});
