/**
 * The per-language-update capability probe (steam/languageProbe.ts). The gate
 * it feeds is what stops a translation submit from overwriting the item's
 * default-language text, so the probe must read the build's real capability:
 * steamworks.js 0.6.0 shipped language on the QUERY config but not on
 * UgcUpdate, and a version compare would have waved it through.
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { bundledSteamworksVersion, supportsLanguageUpdate } from "../src/steam/languageProbe";

const tmps: string[] = [];
function build(dts: string | null, version = "0.6.0"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-steamworks-"));
  tmps.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }), "utf8");
  if (dts !== null) fs.writeFileSync(path.join(dir, "client.d.ts"), dts, "utf8");
  return dir;
}
afterEach(() => {
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Shaped like the real napi output: doc comments with braces included. */
const DTS = (ugcUpdateExtra: string, queryExtra: string): string => `declare module "steamworks.js/client" {
  export interface UgcUpdate {
    title?: string
    description?: string
    /**
     * Developer-defined metadata.
     *
     * {@link https://partner.steamgames.com/doc/api/ISteamUGC#SetItemMetadata}
     */
    metadata?: string
${ugcUpdateExtra}
  }
  export interface WorkshopItemQueryConfig {
    includeLongDescription?: boolean
${queryExtra}
  }
  export function updateItem(itemId: bigint): Promise<void>
}
`;

describe("supportsLanguageUpdate", () => {
  it("accepts a build whose UgcUpdate carries language", () => {
    expect(supportsLanguageUpdate(build(DTS("    language?: string", "")))).toBe(true);
  });

  it("rejects the 0.6.0 shape: language on the query config only", () => {
    expect(supportsLanguageUpdate(build(DTS("", "    language?: string")))).toBe(false);
  });

  it("is not fooled by 'language' inside a doc comment", () => {
    const dts = DTS("    /** the item language is set elsewhere */\n    tags?: Array<string>", "");
    expect(supportsLanguageUpdate(build(dts))).toBe(false);
  });

  it("falls back to the version floor when there is no d.ts", () => {
    expect(supportsLanguageUpdate(build(null, "0.6.0"))).toBe(true);
    expect(supportsLanguageUpdate(build(null, "0.5.0"))).toBe(false);
  });

  it("reports the bundled version, 0.0.0 when unreadable", () => {
    expect(bundledSteamworksVersion(build(null, "0.6.0"))).toBe("0.6.0");
    expect(bundledSteamworksVersion(path.join(os.tmpdir(), "px-absent-dir"))).toBe("0.0.0");
  });
});
