/**
 * The per-mod calendar file (calendarFile.ts): read from the mod's config dir
 * (legacy name included), absent vs unusable told apart, written through the
 * config-dir migration, and recognized by path for cache invalidation.
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isCalendarFile, readCalendarFile, writeCalendarFile } from "../src/calendarFile";

const NAMES = { configDirName: ".px-toolkit", legacyConfigDirName: ".ck3modding" };
const CAL = { epoch: 4000, after: "AD", before: "BC" };

const tmps: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-calfile-"));
  tmps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function write(root: string, dirName: string, text: string): string {
  const file = path.join(root, dirName, "calendar.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

describe("readCalendarFile", () => {
  it("returns null without a file and the sanitized calendar with one", () => {
    const root = tmp();
    expect(readCalendarFile(root, NAMES)).toBeNull();
    const file = write(root, ".px-toolkit", "\uFEFF" + JSON.stringify({ ...CAL, extra: 1 }));
    expect(readCalendarFile(root, NAMES)).toEqual({ file, calendar: CAL });
  });

  it("reads a legacy config dir when the current one is absent", () => {
    const root = tmp();
    const file = write(root, ".ck3modding", JSON.stringify(CAL));
    expect(readCalendarFile(root, NAMES)?.file).toBe(file);
  });

  it("tells an unparsable file apart from an unusable calendar, both without a calendar", () => {
    const root = tmp();
    write(root, ".px-toolkit", "{ epoch: 4000 ");
    const broken = readCalendarFile(root, NAMES);
    expect(broken?.calendar).toBeUndefined();
    expect(broken?.error).toMatch(/not valid JSON/);
    write(root, ".px-toolkit", JSON.stringify({ epoch: "soon", after: "AD" }));
    const unusable = readCalendarFile(root, NAMES);
    expect(unusable?.calendar).toBeUndefined();
    expect(unusable?.error).toMatch(/not a usable calendar/);
  });
});

describe("writeCalendarFile", () => {
  it("writes into the current config dir, renaming a legacy one first", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, ".ck3modding"));
    const file = writeCalendarFile(root, NAMES, CAL);
    expect(file).toBe(path.join(root, ".px-toolkit", "calendar.json"));
    expect(fs.existsSync(path.join(root, ".ck3modding"))).toBe(false);
    expect(readCalendarFile(root, NAMES)?.calendar).toEqual(CAL);
  });
});

describe("isCalendarFile", () => {
  it("matches calendar.json directly under a config dir only", () => {
    expect(isCalendarFile("C:\\mods\\m\\.px-toolkit\\calendar.json", NAMES)).toBe(true);
    expect(isCalendarFile("/mods/m/.ck3modding/calendar.json", NAMES)).toBe(true);
    expect(isCalendarFile("/mods/m/.px-toolkit/workshop/calendar.json", NAMES)).toBe(false);
    expect(isCalendarFile("/mods/m/calendar.json", NAMES)).toBe(false);
    expect(isCalendarFile("/mods/m/.px-toolkit/schema.json", NAMES)).toBe(false);
  });
});
