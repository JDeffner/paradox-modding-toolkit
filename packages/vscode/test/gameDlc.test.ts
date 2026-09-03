/**
 * The game's own DLC list (steam/gameDlc.ts). The fixture files copy the
 * shape of the real ones: CK3's `dlc003.dlc` (The Northern Lords) and
 * Victoria 3's `dlc007_ap1.dlc`, both read off the live installs.
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dlcFolderNumber, parseDlcFile, readGameDlc } from "../src/steam/gameDlc";

const tmps: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-dlc-"));
  tmps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const CK3_FP1 = `name = "The Northern Lords"
path = "dlc/dlc003_fp1"
steam_id = "1303183"
pops_id = "ck3_dlc003_fp1"
affects_checksum = yes
localizable_name = "DLC003_FP1"
`;

describe("parseDlcFile", () => {
  it("reads name and steam_id", () => {
    expect(parseDlcFile(CK3_FP1)).toEqual({ name: "The Northern Lords", steamId: 1303183 });
  });

  it("accepts an unquoted steam_id", () => {
    expect(parseDlcFile('name = "X"\nsteam_id = 42\n')).toEqual({ name: "X", steamId: 42 });
  });

  it("rejects a file without a steam id", () => {
    // dlc001_preorder-style entries with no Steam app cannot be a requirement.
    expect(parseDlcFile('name = "X"\npath = "dlc/x"\n')).toBeNull();
  });

  it("does not mistake localizable_name for name", () => {
    expect(parseDlcFile('localizable_name = "DLC003"\nsteam_id = "7"\n')).toBeNull();
  });
});

describe("dlcFolderNumber", () => {
  it("pads the folder's number to three digits", () => {
    expect(dlcFolderNumber("dlc3_fp1")).toBe("003");
    expect(dlcFolderNumber("dlc012_afr")).toBe("012");
    expect(dlcFolderNumber("not_a_dlc")).toBeNull();
  });
});

describe("readGameDlc", () => {
  it("lists every DLC folder and finds its icon", () => {
    const game = tmp();
    const dir = path.join(game, "dlc", "dlc003_fp1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "dlc003.dlc"), CK3_FP1, "utf8");
    const icons = path.join(game, "gfx", "interface", "icons", "dlc");
    fs.mkdirSync(icons, { recursive: true });
    fs.writeFileSync(path.join(icons, "dlc_003.dds"), "");

    expect(readGameDlc(game, "gfx/interface/icons/dlc")).toEqual([
      {
        name: "The Northern Lords",
        steamId: 1303183,
        dir,
        iconPath: path.join(icons, "dlc_003.dds"),
      },
    ]);
  });

  it("falls back to the DLC folder's own thumbnail when no icon folder matches", () => {
    const game = tmp();
    const dir = path.join(game, "dlc", "dlc007_ap1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "dlc007_ap1.dlc"),
      'name = "Dawn of Wonder"\nsteam_id = "2411230"\n',
      "utf8"
    );
    fs.writeFileSync(path.join(dir, "thumbnail.png"), "");

    expect(readGameDlc(game, undefined)).toEqual([
      { name: "Dawn of Wonder", steamId: 2411230, dir, iconPath: path.join(dir, "thumbnail.png") },
    ]);
  });

  it("is empty for an install with no dlc folder", () => {
    expect(readGameDlc(tmp(), undefined)).toEqual([]);
  });
});
