import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { parseDescriptor } from "@px-lsp/protocol/descriptorMod";
import type { PublishInfo } from "../src/steam/workshop";
import {
  createLegacyVersion,
  legacyDirectory,
  legacyPublishInfo,
  legacyVersion,
  legacyVersions,
  lockLegacyUpload,
  prepareLegacyContent,
  readLegacyItem,
  updateLegacyItem,
} from "../src/steam/legacyWorkshop";

const base = path.resolve(".local/testing");
const temporary: string[] = [];
function fixture() {
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "legacy-workshop-"));
  temporary.push(root);
  const main = path.join(root, "workshop");
  fs.mkdirSync(main);
  const thumbnail = path.join(root, "thumbnail.png");
  fs.writeFileSync(thumbnail, Buffer.from([0, 1, 2, 3]));
  const info: PublishInfo = {
    name: "Main title",
    tags: ["Test tag"],
    publishedId: "111111",
    description: "[b]Main description[/b]",
    translations: { german: { title: "Titel", description: "Beschreibung" } },
    markdown: [],
    previewPath: thumbnail,
    version: "2.3.4",
    supportedVersion: "1.20.*",
  };
  fs.writeFileSync(
    path.join(main, "item.json"),
    JSON.stringify({ title: info.name, publishedfileid: info.publishedId })
  );
  fs.writeFileSync(path.join(main, "description.bbcode"), info.description!);
  fs.mkdirSync(path.join(main, "previews"));
  fs.writeFileSync(path.join(main, "previews", "image.png"), "preview bytes");
  fs.writeFileSync(path.join(main, "previews", "videos.txt"), "123456\n");
  fs.writeFileSync(path.join(main, "previews", "order.txt"), "image.png\n");
  fs.writeFileSync(path.join(main, "dependencies.json"), '{"dlc":[123],"items":["456"]}\n');
  return { root, main, thumbnail, info };
}

afterEach(() => {
  for (const root of temporary.splice(0)) {
    if (!root.startsWith(base + path.sep)) throw new Error("Unexpected test cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("legacy Workshop versions", () => {
  it.each([
    ["1.19", "1.19", "1.19.*"],
    [" 1.19.* ", "1.19", "1.19.*"],
    ["1.19.2", "1.19.2", "1.19.2"],
    ["1.19.2.3", "1.19.2.3", "1.19.2.3"],
  ])("normalizes %s without losing explicit patch precision", (input, key, supportedVersion) => {
    expect(legacyVersion(input)).toEqual({ key, supportedVersion });
  });

  it.each([
    "",
    "1",
    "../1.19",
    "1.19/../../mod",
    "1.19\\..",
    "/1.19",
    "1.19:*",
    "01.19",
    "1.19.2beta",
    "1.19\u0000",
  ])("rejects invalid version %j", (input) => {
    expect(() => legacyVersion(input)).toThrow();
    expect(() => legacyDirectory(path.resolve("workshop"), input)).toThrow();
  });

  it("copies independent listing files and previews without inheriting the main Workshop ID", () => {
    const { main, thumbnail, info } = fixture();
    const mainItem = fs.readFileSync(path.join(main, "item.json"));
    const key = createLegacyVersion(main, "1.19", info);
    const dir = legacyDirectory(main, key);
    expect(dir).toBe(path.join(main, "legacy_version", "1.19"));
    expect(legacyPublishInfo(dir)).toEqual({
      ...info,
      publishedId: null,
      supportedVersion: "1.19.*",
      previewPath: path.join(dir, "thumbnail.png"),
    });
    expect(readLegacyItem(dir).legacy).toEqual({
      supportedVersion: "1.19.*",
      version: "2.3.4",
      content: "new",
    });
    expect(fs.readFileSync(path.join(dir, "thumbnail.png"))).toEqual(fs.readFileSync(thumbnail));
    for (const name of [
      "previews/image.png",
      "previews/videos.txt",
      "previews/order.txt",
      "dependencies.json",
    ])
      expect(fs.readFileSync(path.join(dir, name))).toEqual(fs.readFileSync(path.join(main, name)));
    updateLegacyItem(dir, { title: "Legacy title" });
    fs.writeFileSync(path.join(dir, "previews", "image.png"), "changed legacy preview");
    expect(fs.readFileSync(path.join(main, "previews", "image.png"), "utf8")).toBe("preview bytes");
    expect(fs.readFileSync(path.join(main, "item.json"))).toEqual(mainItem);
    expect(info.name).toBe("Main title");
  });

  it("converts inherited Markdown without changing the main drafts", () => {
    const { main, info } = fixture();
    info.description = "**Main**";
    info.translations.german.description = "**Deutsch**";
    info.markdown = ["", "german"];
    const key = createLegacyVersion(main, "1.19", info);
    const legacy = legacyPublishInfo(legacyDirectory(main, key));
    expect(legacy.description).toBe("[b]Main[/b]");
    expect(legacy.translations.german.description).toBe("[b]Deutsch[/b]");
    expect(legacy.markdown).toEqual([]);
    expect(info.description).toBe("**Main**");
    expect(info.translations.german.description).toBe("**Deutsch**");
  });

  it("rejects the same version directory and preserves its saved content", () => {
    const { main, info } = fixture();
    createLegacyVersion(main, "1.19", info);
    const dir = legacyDirectory(main, "1.19");
    updateLegacyItem(dir, { title: "Keep this title", publishedfileid: "222222" });
    const before = fs.readFileSync(path.join(dir, "item.json"));
    expect(() => createLegacyVersion(main, "1.19.*", { ...info, name: "Replacement" })).toThrow(
      /Delete that local directory/
    );
    expect(fs.readFileSync(path.join(dir, "item.json"))).toEqual(before);
  });

  it("keeps each game version and assigned Workshop ID immutable", () => {
    const { main, info } = fixture();
    createLegacyVersion(main, "1.19", info);
    const dir = legacyDirectory(main, "1.19");
    const item = updateLegacyItem(dir, { publishedfileid: "222222" });
    const before = fs.readFileSync(path.join(dir, "item.json"));
    expect(() => updateLegacyItem(dir, { publishedfileid: "333333" })).toThrow(/ID cannot change/);
    expect(() => updateLegacyItem(dir, { publishedfileid: undefined })).toThrow(/ID cannot change/);
    expect(() => updateLegacyItem(dir, { legacy: { ...item.legacy, supportedVersion: "1.18.*" } })).toThrow(
      /game version cannot change|Invalid legacy item/
    );
    expect(fs.readFileSync(path.join(dir, "item.json"))).toEqual(before);
  });

  it("persists interrupted creation and submission states across reloads", () => {
    const { main, info } = fixture();
    createLegacyVersion(main, "1.19", info);
    const dir = legacyDirectory(main, "1.19");
    const item = readLegacyItem(dir);
    updateLegacyItem(dir, { legacy: { ...item.legacy, content: "creating" } });
    expect(readLegacyItem(dir).legacy.content).toBe("creating");
    updateLegacyItem(dir, { publishedfileid: "222222", legacy: { ...item.legacy, content: "ready" } });
    updateLegacyItem(dir, { legacy: { ...item.legacy, content: "submitted" } });
    expect(readLegacyItem(dir)).toMatchObject({
      publishedfileid: "222222",
      legacy: { content: "submitted" },
    });
    expect(legacyPublishInfo(dir).publishedId).toBe("222222");
  });

  it("refuses invalid state updates without corrupting the saved item", () => {
    const { main, info } = fixture();
    createLegacyVersion(main, "1.19", info);
    const dir = legacyDirectory(main, "1.19");
    const item = readLegacyItem(dir);
    const before = fs.readFileSync(path.join(dir, "item.json"));
    expect(() => updateLegacyItem(dir, { legacy: { ...item.legacy, content: "published" } })).toThrow();
    expect(() => updateLegacyItem(dir, { publishedfileid: "invalid" })).toThrow();
    expect(fs.readFileSync(path.join(dir, "item.json"))).toEqual(before);
  });

  it("does not reopen content upload after submission or publication", () => {
    const { main, info } = fixture();
    const dir = legacyDirectory(main, createLegacyVersion(main, "1.19", info));
    const item = readLegacyItem(dir);
    updateLegacyItem(dir, {
      publishedfileid: "222222",
      legacy: { ...item.legacy, content: "submitted" },
    });
    const submitted = fs.readFileSync(path.join(dir, "item.json"));
    expect(() => updateLegacyItem(dir, { legacy: { ...item.legacy, content: "ready" } })).toThrow();
    expect(fs.readFileSync(path.join(dir, "item.json"))).toEqual(submitted);
    updateLegacyItem(dir, { legacy: { ...item.legacy, content: "published" } });
    expect(() => updateLegacyItem(dir, { legacy: { ...item.legacy, content: "new" } })).toThrow();
    updateLegacyItem(dir, { title: "Updated listing title" });
    expect(readLegacyItem(dir)).toMatchObject({
      title: "Updated listing title",
      publishedfileid: "222222",
      legacy: { content: "published", supportedVersion: "1.19.*" },
    });
  });

  it("reports failed creation and keeps the reserved directory for explicit recovery", () => {
    const { main, info, root } = fixture();
    const before = fs.readFileSync(path.join(main, "item.json"));
    expect(() =>
      createLegacyVersion(main, "1.19", { ...info, previewPath: path.join(root, "missing.png") })
    ).toThrow();
    const dir = legacyDirectory(main, "1.19");
    expect(fs.existsSync(dir)).toBe(true);
    expect(() => legacyPublishInfo(dir)).toThrow();
    expect(() => createLegacyVersion(main, "1.19", info)).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(main, "item.json"))).toEqual(before);
  });

  it.each([
    "{broken",
    '{"legacy":{}}',
    '{"publishedfileid":123,"legacy":{"supportedVersion":"1.19.*","version":"1","content":"published"}}',
  ])("does not fall back to main metadata on malformed legacy state", (content) => {
    const { main, info } = fixture();
    createLegacyVersion(main, "1.19", info);
    const dir = legacyDirectory(main, "1.19");
    fs.writeFileSync(path.join(dir, "item.json"), content);
    expect(() => readLegacyItem(dir)).toThrow();
    expect(() => legacyPublishInfo(dir)).toThrow();
    expect(() => updateLegacyItem(dir, { title: "Do not replace" })).toThrow();
    expect(fs.readFileSync(path.join(dir, "item.json"), "utf8")).toBe(content);
    expect(legacyVersions(main)).toEqual([{ key: "1.19", supportedVersion: "1.19" }]);
  });

  it("locks simultaneous uploads and allows a new upload after release", () => {
    const { main, info } = fixture();
    const dir = legacyDirectory(main, createLegacyVersion(main, "1.19", info));
    const release = lockLegacyUpload(dir);
    expect(() => lockLegacyUpload(dir)).toThrow(/upload lock/);
    expect(fs.existsSync(path.join(dir, ".upload-lock"))).toBe(true);
    release();
    const nextRelease = lockLegacyUpload(dir);
    nextRelease();
    expect(fs.existsSync(path.join(dir, ".upload-lock"))).toBe(false);
  });

  it.each([ck3Meta, vic3Meta, eu5Meta])("stages $id metadata without changing project content", (meta) => {
    const { root, main, info } = fixture();
    const mod = path.join(root, "mod");
    const staging = path.join(root, "staging");
    fs.mkdirSync(path.join(mod, ".metadata"), { recursive: true });
    const descriptor =
      '\uFEFF# Keep this comment\nname="Main title"\nsupported_version="1.20.*"\nremote_file_id="111111"\nversion="2.3.4"\nreplace_path="history/characters"\n';
    const metadata = JSON.stringify({
      name: "Main title",
      supported_game_version: "1.20.*",
      version: "2.3.4",
      custom: { preserve: true },
    });
    fs.writeFileSync(path.join(mod, "descriptor.mod"), descriptor);
    fs.writeFileSync(path.join(mod, ".metadata/metadata.json"), metadata);
    fs.writeFileSync(path.join(mod, "content.txt"), "current project files");
    fs.cpSync(mod, staging, { recursive: true });
    const legacy = legacyPublishInfo(legacyDirectory(main, createLegacyVersion(main, "1.19", info)));
    prepareLegacyContent(staging, meta, { ...legacy, name: "Legacy title" }, "222222");
    expect(fs.readFileSync(path.join(mod, "descriptor.mod"), "utf8")).toBe(descriptor);
    expect(fs.readFileSync(path.join(mod, ".metadata/metadata.json"), "utf8")).toBe(metadata);
    expect(fs.readFileSync(path.join(staging, "content.txt"), "utf8")).toBe("current project files");
    if (meta.descriptor === "mod") {
      const staged = fs.readFileSync(path.join(staging, "descriptor.mod"), "utf8");
      expect(
        Object.fromEntries(parseDescriptor(staged).map(({ key, value }) => [key, JSON.parse(value)]))
      ).toMatchObject({
        name: "Legacy title",
        supported_version: "1.19.*",
        remote_file_id: "222222",
        version: "2.3.4",
      });
      expect(staged).toContain("# Keep this comment");
      expect(staged).toContain('replace_path="history/characters"');
      expect(staged.charCodeAt(0)).toBe(0xfeff);
      expect(fs.readFileSync(path.join(staging, ".metadata/metadata.json"), "utf8")).toBe(metadata);
    } else {
      expect(JSON.parse(fs.readFileSync(path.join(staging, ".metadata/metadata.json"), "utf8"))).toEqual({
        name: "Legacy title",
        supported_game_version: "1.19.*",
        version: "2.3.4",
        custom: { preserve: true },
      });
      expect(fs.readFileSync(path.join(staging, "descriptor.mod"), "utf8")).toBe(descriptor);
    }
  });
});
