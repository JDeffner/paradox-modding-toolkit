import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  readWorkshopMeta,
  steamLanguageForLoc,
  steamLanguageLabel,
  STEAM_LANGUAGES,
  upsertWorkshopMeta,
} from "../src/workshopMeta";
import { LOC_LANGUAGES } from "../src/translationCore";

const tmpMod = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "px-workshop-meta-"));

describe("workshopMeta", () => {
  it("returns null for a mod without the file", () => {
    expect(readWorkshopMeta(path.join(tmpMod(), ".px-toolkit"))).toBeNull();
  });

  it("round-trips a record and creates the config dir", () => {
    const cfg = path.join(tmpMod(), ".px-toolkit");
    upsertWorkshopMeta(cfg, {
      publishedFileId: "123",
      description: "[b]Hello[/b]",
      translations: { german: { title: "Hallo", description: "Beschreibung" } },
    });
    expect(readWorkshopMeta(cfg)).toEqual({
      publishedFileId: "123",
      description: "[b]Hello[/b]",
      translations: { german: { title: "Hallo", description: "Beschreibung" } },
    });
  });

  it("merges patches and preserves keys it does not know", () => {
    const cfg = path.join(tmpMod(), ".px-toolkit");
    const file = path.join(cfg, "workshop.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ publishedFileId: "7", futureKey: true }), "utf8");
    upsertWorkshopMeta(cfg, { description: "text" });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      publishedFileId: "7",
      futureKey: true,
      description: "text",
    });
  });

  it("leaves fields alone when the patch omits them", () => {
    const cfg = path.join(tmpMod(), ".px-toolkit");
    upsertWorkshopMeta(cfg, { publishedFileId: "9", description: "keep" });
    upsertWorkshopMeta(cfg, { translations: { french: { title: "t" } } });
    expect(readWorkshopMeta(cfg)).toEqual({
      publishedFileId: "9",
      description: "keep",
      translations: { french: { title: "t" } },
    });
  });

  it("maps every Paradox loc language to a real Steam language code", () => {
    for (const loc of LOC_LANGUAGES) {
      const api = steamLanguageForLoc(loc);
      expect(api, loc).not.toBeNull();
      expect(
        STEAM_LANGUAGES.some((l) => l.api === api),
        `${loc} -> ${api}`
      ).toBe(true);
    }
  });

  it("labels known codes and echoes unknown ones", () => {
    expect(steamLanguageLabel("koreana")).toBe("Korean");
    expect(steamLanguageLabel("elvish")).toBe("elvish");
  });
});
