import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseScript, parseLoc, decode } from "../../src/parser/index";
import { devPath } from "../../../../scripts/devPaths";

const GAME_PATH = devPath("gamePath");

function walk(dir: string, exts: string[], out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((x) => e.name.toLowerCase().endsWith(x))) {
      out.push(full);
    }
  }
}

describe("corpus", () => {
  it.skipIf(!GAME_PATH)(
    "parses every vanilla .txt and .yml without throwing, under thresholds",
    async () => {
      const root = GAME_PATH as string;
      const txtDirs = ["common", "events", "history", "gui"].map((d) => path.join(root, d));
      const ymlDir = path.join(root, "localization", "english");

      const txtFiles: string[] = [];
      for (const d of txtDirs) walk(d, [".txt"], txtFiles);
      const ymlFiles: string[] = [];
      walk(ymlDir, [".yml"], ymlFiles);

      const start = Date.now();

      // Read all buffers concurrently (bounded pool) — file I/O over thousands
      // of small files is the dominant cost on Windows, so overlap it.
      const readAll = async (files: string[]): Promise<Buffer[]> => {
        const out: Buffer[] = new Array(files.length);
        const CONCURRENCY = 32;
        let next = 0;
        const worker = async (): Promise<void> => {
          while (true) {
            const idx = next++;
            if (idx >= files.length) return;
            out[idx] = await fs.promises.readFile(files[idx]);
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
        return out;
      };

      const [txtBufs, ymlBufs] = await Promise.all([readAll(txtFiles), readAll(ymlFiles)]);

      let txtWithErrors = 0;
      const txtOffenders: Array<{ file: string; first: string }> = [];
      for (let bi = 0; bi < txtFiles.length; bi++) {
        const f = txtFiles[bi];
        const { text } = decode(txtBufs[bi]);
        const res = parseScript(text);
        if (res.errors.length > 0) {
          txtWithErrors++;
          if (txtOffenders.length < 25) {
            const e = res.errors[0];
            txtOffenders.push({
              file: path.relative(root, f),
              first: `${e.code}: ${e.message} @${e.range.start}`,
            });
          }
        }
      }

      let ymlWithErrors = 0;
      const ymlOffenders: Array<{ file: string; first: string }> = [];
      for (let bi = 0; bi < ymlFiles.length; bi++) {
        const f = ymlFiles[bi];
        const { text } = decode(ymlBufs[bi]);
        const res = parseLoc(text);
        if (res.errors.length > 0) {
          ymlWithErrors++;
          if (ymlOffenders.length < 25) {
            const e = res.errors[0];
            ymlOffenders.push({
              file: path.relative(root, f),
              first: `${e.code}: ${e.message} @${e.range.start}`,
            });
          }
        }
      }

      const elapsed = Date.now() - start;
      const txtRatio = txtFiles.length ? txtWithErrors / txtFiles.length : 0;
      const ymlRatio = ymlFiles.length ? ymlWithErrors / ymlFiles.length : 0;

      // eslint-disable-next-line no-console
      console.log(
        `\n[corpus] txt files: ${txtFiles.length}, with-errors: ${txtWithErrors} (${(txtRatio * 100).toFixed(
          3
        )}%)`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[corpus] yml files: ${ymlFiles.length}, with-errors: ${ymlWithErrors} (${(ymlRatio * 100).toFixed(
          3
        )}%)`
      );
      // eslint-disable-next-line no-console
      console.log(`[corpus] elapsed: ${elapsed}ms`);
      if (txtOffenders.length) {
        // eslint-disable-next-line no-console
        console.log("[corpus] txt offenders (sample):");
        for (const o of txtOffenders) {
          // eslint-disable-next-line no-console
          console.log(`  ${o.file} :: ${o.first}`);
        }
      }
      if (ymlOffenders.length) {
        // eslint-disable-next-line no-console
        console.log("[corpus] yml offenders (sample):");
        for (const o of ymlOffenders) {
          // eslint-disable-next-line no-console
          console.log(`  ${o.file} :: ${o.first}`);
        }
      }

      expect(txtFiles.length).toBeGreaterThan(0);
      expect(txtRatio).toBeLessThan(0.005); // < 0.5% of txt files with structural errors
      expect(elapsed).toBeLessThan(30000);
    },
    60000
  );
});
