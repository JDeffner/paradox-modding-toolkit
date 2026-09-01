/**
 * Stray px.calendar detection (calendarSettingsCheck.ts): a calendar declared
 * in a mod's or mod project's own .vscode/settings.json while the opened
 * folder's configuration has none is found (VS Code ignores such a file, so
 * every calendar feature silently does nothing without a warning), and
 * settings files under an opened root are never reported.
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findStrayCalendar, jsoncToJson } from "../src/calendarSettingsCheck";

const tmps: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-calcheck-"));
  tmps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeSettings(dir: string, text: string): string {
  const file = path.join(dir, ".vscode", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

const CAL = '{ "px.calendar": { "epoch": 4000, "after": "AD", "before": "BC" } }';

describe("jsoncToJson", () => {
  it("strips comments and trailing commas but keeps them inside strings", () => {
    const text = `{
      // line comment
      "url": "https://a/b", /* block */
      "note": "keep // this and /* that */",
      "last": 1,
    }`;
    const parsed = JSON.parse(jsoncToJson(text)) as Record<string, unknown>;
    expect(parsed.url).toBe("https://a/b");
    expect(parsed.note).toBe("keep // this and /* that */");
    expect(parsed.last).toBe(1);
  });
});

describe("findStrayCalendar", () => {
  it("finds the calendar in a mod project's ignored settings file", () => {
    const opened = tmp();
    const project = path.join(opened, "My Mod");
    const modRoot = path.join(project, "mod");
    fs.mkdirSync(modRoot, { recursive: true });
    const file = writeSettings(project, `{\n  // era math\n  ${CAL.slice(1)}`);
    const hit = findStrayCalendar([modRoot], [opened]);
    expect(hit?.file).toBe(file);
    expect(hit?.calendar).toEqual({ epoch: 4000, after: "AD", before: "BC" });
  });

  it("skips settings under an opened root and reports nothing when clean", () => {
    const opened = tmp();
    writeSettings(opened, CAL);
    expect(findStrayCalendar([opened], [opened])).toBeNull();
    const bare = tmp();
    fs.mkdirSync(path.join(bare, "mod"), { recursive: true });
    expect(findStrayCalendar([path.join(bare, "mod")], [tmp()])).toBeNull();
  });

  it("still reports a declaration it cannot use", () => {
    const opened = tmp();
    const modRoot = path.join(opened, "proj", "mod");
    fs.mkdirSync(modRoot, { recursive: true });
    writeSettings(path.join(opened, "proj"), '{ "px.calendar": { "epoch": "soon" } }');
    const hit = findStrayCalendar([modRoot], [opened]);
    expect(hit).not.toBeNull();
    expect(hit?.calendar).toBeUndefined();
  });
});
