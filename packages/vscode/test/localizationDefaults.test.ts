import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { PxConfig } from "../src/config";

const host = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  documents: new Map<string, { text: string; version: number }>(),
  rejectSave: false,
}));
vi.mock("vscode", () => ({
  Uri: class {
    readonly scheme = "file";
    constructor(public fsPath: string) {}
    static file(file: string) {
      return new this(file);
    }
  },
  Range: class {},
  WorkspaceEdit: class {
    file!: string;
    text!: string;
    replace(uri: { fsPath: string }, _range: unknown, text: string) {
      this.file = uri.fsPath;
      this.text = text;
    }
  },
  window: host,
  workspace: {
    openTextDocument: async (uri: { fsPath: string }) => {
      let state = host.documents.get(uri.fsPath);
      if (!state) {
        state = { text: fs.readFileSync(uri.fsPath, "utf8"), version: 1 };
        host.documents.set(uri.fsPath, state);
      }
      const document = state;
      return {
        uri,
        encoding: "utf8",
        get version() {
          return document.version;
        },
        getText: () => document.text,
        positionAt: (offset: number) => offset,
        save: async () => {
          if (host.rejectSave) return false;
          fs.writeFileSync(uri.fsPath, document.text);
          return true;
        },
      };
    },
    applyEdit: async (edit: { file: string; text: string }) => {
      const document = host.documents.get(edit.file)!;
      document.text = edit.text;
      document.version++;
      return true;
    },
  },
}));
vi.mock("../src/localizationProject", () => ({
  localizationDefaultsFile: (cfg: PxConfig) => path.join(cfg.modPath!, ".px-toolkit", "localization.json"),
  localizationRoots: () => ["localization"],
}));
import { configureLocalizationDefaults } from "../src/localizationDefaults";

let root: string;
let file: string;
let cfg: PxConfig;
beforeEach(() => {
  vi.resetAllMocks();
  host.documents.clear();
  host.rejectSave = false;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-loc-defaults-"));
  file = path.join(root, ".px-toolkit", "localization.json");
  cfg = { gameId: "ck3", modPath: root, gamePath: null, locLanguage: "english" } as PxConfig;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function existing(
  text = '{"language":"german","overrideFile":"localization/replace/{language}/custom_l_{language}.yml"}'
) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe("localization defaults command", () => {
  it("cancels a new draft without creating a defaults file", async () => {
    host.showQuickPick.mockResolvedValueOnce(undefined);
    await configureLocalizationDefaults(cfg);
    expect(fs.existsSync(file)).toBe(false);
  });
  it("edits current dirty JSON, resets Auto and preserves other defaults", async () => {
    existing();
    host.documents.set(file, { text: '{"language":"french","entryVersion":"zero"}', version: 3 });
    host.showQuickPick
      .mockResolvedValueOnce({ field: "language" })
      .mockResolvedValueOnce({ value: "" })
      .mockResolvedValueOnce({ field: "save" });
    await configureLocalizationDefaults(cfg);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ entryVersion: "zero" });
    expect(host.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Saved localization defaults")
    );
  });

  it("preserves fields added by another version", async () => {
    existing('{"language":"german","future":{"retain":true}}');
    host.showQuickPick.mockResolvedValueOnce({ field: "save" });
    await configureLocalizationDefaults(cfg);
    expect(host.showErrorMessage.mock.calls).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      language: "german",
      future: { retain: true },
    });
  });

  it("writes the current file from a dirty legacy source when an unrelated current folder exists", async () => {
    const legacy = path.join(root, ".ck3modding", "localization.json");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '{"language":"german"}');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(path.join(path.dirname(file), "schema.json"), "{}");
    host.documents.set(legacy, { text: '{"language":"french","future":7}', version: 2 });
    host.showQuickPick.mockResolvedValueOnce({ field: "save" });
    await configureLocalizationDefaults(cfg);
    expect(host.showErrorMessage.mock.calls).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ language: "french", future: 7 });
    expect(fs.readFileSync(legacy, "utf8")).toBe('{"language":"german"}');
  });

  it("refuses an invalid current file instead of taking legacy defaults", async () => {
    existing("broken");
    const legacy = path.join(root, ".ck3modding", "localization.json");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '{"language":"german"}');
    await configureLocalizationDefaults(cfg);
    expect(fs.readFileSync(file, "utf8")).toBe("broken");
    expect(host.showErrorMessage).toHaveBeenCalled();
    expect(host.showQuickPick).not.toHaveBeenCalled();
  });
  it("writes portable templates and the selected entry style", async () => {
    host.showQuickPick
      .mockResolvedValueOnce({ field: "newKeyFile" })
      .mockResolvedValueOnce({ field: "entryVersion" })
      .mockResolvedValueOnce({ value: "none" })
      .mockResolvedValueOnce({ field: "save" });
    host.showInputBox.mockResolvedValueOnce("localization/{language}/{source}_l_{language}.yml");
    await configureLocalizationDefaults(cfg);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      newKeyFile: "localization/{language}/{source}_l_{language}.yml",
      entryVersion: "none",
    });
    expect(host.showInputBox.mock.calls[0][0].validateInput("../outside_l_{language}.yml")).toContain(
      "relative"
    );
  });
  it("rejects an existing file changed during the picker", async () => {
    existing();
    const changed = '{"language":"spanish"}';
    host.showQuickPick.mockImplementationOnce(async () => {
      fs.writeFileSync(file, changed);
      return { field: "save" };
    });
    await configureLocalizationDefaults(cfg);
    expect(fs.readFileSync(file, "utf8")).toBe(changed);
    expect(host.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("changed during the operation")
    );
  });
  it("rejects a file created while a new draft was open", async () => {
    const changed = '{"language":"spanish"}';
    host.showQuickPick.mockImplementationOnce(async () => {
      existing(changed);
      return { field: "save" };
    });
    await configureLocalizationDefaults(cfg);
    expect(fs.readFileSync(file, "utf8")).toBe(changed);
    expect(host.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("changed during the operation")
    );
  });
  it("reports a rejected save and retains the editor draft", async () => {
    existing();
    host.rejectSave = true;
    host.showQuickPick
      .mockResolvedValueOnce({ field: "language" })
      .mockResolvedValueOnce({ value: "french" })
      .mockResolvedValueOnce({ field: "save" });
    await configureLocalizationDefaults(cfg);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).language).toBe("german");
    expect(JSON.parse(host.documents.get(file)!.text).language).toBe("french");
    expect(host.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("could not be saved"));
  });
});
