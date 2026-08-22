import { describe, expect, it } from "vitest";
import { parseLibraryFoldersVdf } from "../src/steamDetect";
import { checkedDownloadUrl, pickTigerAsset, preferPlainBinary, tigerFlavorFor } from "../src/tigerDownload";

describe("parseLibraryFoldersVdf", () => {
  it("extracts every library path with unescaped backslashes", () => {
    const vdf = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
	}
	"1"
	{
		"path"		"F:\\\\SteamLibrary"
		"apps" { "1158310" "123" }
	}
}`;
    expect(parseLibraryFoldersVdf(vdf)).toEqual(["C:\\Program Files (x86)\\Steam", "F:\\SteamLibrary"]);
  });

  it("returns empty for content without paths", () => {
    expect(parseLibraryFoldersVdf("nonsense")).toEqual([]);
  });
});

describe("tigerFlavorFor", () => {
  it("derives the flavor from the game meta, keeping CK3's legacy storage folder", () => {
    expect(tigerFlavorFor("ck3")).toEqual({
      prefix: "ck3-tiger",
      repoSlug: "amtep/tiger",
      subdir: "tiger",
    });
    expect(tigerFlavorFor("vic3")).toEqual({
      prefix: "vic3-tiger",
      repoSlug: "amtep/tiger",
      subdir: "tiger-vic3",
    });
  });

  it("is null for a game whose meta has no tiger", () => {
    expect(tigerFlavorFor("eu5")).toBeNull();
  });
});

describe("pickTigerAsset", () => {
  const ck3 = tigerFlavorFor("ck3")!;
  const assets = [
    { name: "ck3-tiger-linux-v1.19.0.tar.gz", browser_download_url: "u1" },
    { name: "ck3-tiger-windows-v1.19.0.zip", browser_download_url: "u2" },
    { name: "imperator-tiger-windows-v1.19.0.zip", browser_download_url: "u3" },
    { name: "vic3-tiger-linux-v1.19.0.tar.gz", browser_download_url: "u4" },
  ];

  it("picks the ck3 asset for the platform, never another game's", () => {
    expect(pickTigerAsset(assets, "win32", ck3)?.name).toBe("ck3-tiger-windows-v1.19.0.zip");
    expect(pickTigerAsset(assets, "linux", ck3)?.name).toBe("ck3-tiger-linux-v1.19.0.tar.gz");
  });

  it("returns null for macOS (no prebuilt) and when nothing matches", () => {
    expect(pickTigerAsset(assets, "darwin", ck3)).toBeNull();
    expect(pickTigerAsset([], "win32", ck3)).toBeNull();
  });
});

describe("preferPlainBinary", () => {
  it("prefers ck3-tiger over the -auto variant regardless of order", () => {
    const dir = "C:\\store\\tiger\\v1.19.0";
    // readdir sorts ck3-tiger-auto.exe before ck3-tiger.exe — the historical trap.
    expect(preferPlainBinary([`${dir}\\ck3-tiger-auto.exe`, `${dir}\\ck3-tiger.exe`])).toBe(
      `${dir}\\ck3-tiger.exe`
    );
    expect(preferPlainBinary([`${dir}/ck3-tiger`, `${dir}/ck3-tiger-auto`])).toBe(`${dir}/ck3-tiger`);
  });

  it("falls back to the only binary present and to null when empty", () => {
    expect(preferPlainBinary(["/x/ck3-tiger-auto.exe"])).toBe("/x/ck3-tiger-auto.exe");
    expect(preferPlainBinary([])).toBeNull();
  });
});

describe("checkedDownloadUrl", () => {
  it("accepts the two hosts a GitHub release download resolves to", () => {
    expect(checkedDownloadUrl("https://github.com/amtep/ck3-tiger/releases/download/v1/a.zip")?.host).toBe(
      "github.com"
    );
    expect(checkedDownloadUrl("https://objects.githubusercontent.com/x/a.zip")?.host).toBe(
      "objects.githubusercontent.com"
    );
  });

  it("refuses anything else, since the bytes are unpacked and executed", () => {
    expect(checkedDownloadUrl("http://github.com/a.zip")).toBeNull();
    expect(checkedDownloadUrl("https://github.com.evil.test/a.zip")).toBeNull();
    expect(checkedDownloadUrl("file:///C:/a.zip")).toBeNull();
    expect(checkedDownloadUrl("not a url")).toBeNull();
  });
});
