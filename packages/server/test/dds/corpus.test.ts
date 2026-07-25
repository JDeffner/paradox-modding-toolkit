import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decodeDds, ddsFormatInfo } from "../../src/dds/decoder";
import { devPath } from "../../../../scripts/devPaths";

const GAME = devPath("gamePath");

function walkDds(root: string, limit: number): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < limit) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (name.toLowerCase().endsWith(".dds")) {
        out.push(full);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

function collectDds(dir: string, limit: number): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (name.toLowerCase().endsWith(".dds")) out.push(join(dir, name));
      if (out.length >= limit) break;
    }
  } catch {
    /* ignore */
  }
  return out;
}

describe.skipIf(!GAME)("CK3 corpus", () => {
  it("decodes trait icons and a sample of gfx textures", () => {
    const gamePath = GAME!;
    const traitsDir = join(gamePath, "gfx", "interface", "icons", "traits");
    const traitFiles = collectDds(traitsDir, 100000);

    const gfxDir = join(gamePath, "gfx");
    let randomFiles = walkDds(gfxDir, 4000);
    // shuffle deterministically-ish and take up to 300
    randomFiles = randomFiles.sort(() => Math.random() - 0.5).slice(0, 300);

    const allTargets = new Map<string, "trait" | "gfx">();
    for (const f of traitFiles) allTargets.set(f, "trait");
    for (const f of randomFiles) if (!allTargets.has(f)) allTargets.set(f, "gfx");

    const histogram = new Map<string, number>();
    let traitTotal = 0;
    let traitOk = 0;
    let overallTotal = 0;
    let overallOk = 0;
    let cleanUnsupported = 0;

    for (const [file, kind] of allTargets) {
      let buf: Uint8Array;
      try {
        buf = new Uint8Array(readFileSync(file));
      } catch {
        continue;
      }

      const info = ddsFormatInfo(buf);
      expect(info, `ddsFormatInfo null for ${file}`).not.toBeNull();
      const fmt = info!.format;
      histogram.set(fmt, (histogram.get(fmt) ?? 0) + 1);

      overallTotal++;
      if (kind === "trait") traitTotal++;

      try {
        const img = decodeDds(buf);
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
        expect(img.pixels.length).toBe(img.width * img.height * 4);
        overallOk++;
        if (kind === "trait") traitOk++;
      } catch (e) {
        const msg = (e as Error).message;
        // Only "unsupported format" (or clean truncation) is acceptable.
        expect(msg, `unexpected error for ${file}: ${msg}`).toMatch(
          /unsupported format|truncated|not a valid DDS/
        );
        if (/unsupported format/.test(msg)) cleanUnsupported++;
      }
    }

    // Log histogram + stats
    const sortedHist = [...histogram.entries()].sort((a, b) => b[1] - a[1]);

    console.log("\n=== DDS format histogram ===");
    for (const [fmt, n] of sortedHist) {
      console.log(`  ${fmt.padEnd(20)} ${n}`);
    }
    const overallRate = overallTotal ? ((overallOk / overallTotal) * 100).toFixed(1) : "n/a";
    const traitRate = traitTotal ? ((traitOk / traitTotal) * 100).toFixed(1) : "n/a";

    console.log(
      `\nOverall: ${overallOk}/${overallTotal} decoded (${overallRate}%), ` +
        `clean-unsupported: ${cleanUnsupported}`
    );

    console.log(`Trait icons: ${traitOk}/${traitTotal} decoded (${traitRate}%)\n`);

    if (traitTotal > 0) {
      expect(traitOk / traitTotal).toBeGreaterThanOrEqual(0.95);
    }
  }, 120000);
});
