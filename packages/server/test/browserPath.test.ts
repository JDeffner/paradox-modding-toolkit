/**
 * The browser build aliases node's `path` to src/browser/shims/path.ts. That
 * shim is load-bearing: `classifyFile` decides which schema entry a file gets
 * from `path.relative` + `path.sep`, so a shim that disagrees with node by one
 * segment produces a wrong diagnostic rather than a visible failure.
 *
 * So this suite does not assert hand-written expectations. It asserts that the
 * shim agrees with node's own `path.posix` on every input, which is the only
 * bar that matters.
 */
import { describe, expect, it } from "vitest";
import { posix } from "path";
import * as shim from "../src/browser/shims/path";

const PATHS = [
  "",
  ".",
  "..",
  "/",
  "/mod",
  "/mod/",
  "/mod/events/tutorial.txt",
  "mod/events/tutorial.txt",
  "/mod/common/scripted_effects/00_my.txt",
  "/mod/events//double//slash.txt",
  "/mod/./events/../events/x.txt",
  "/mod/../outside.txt",
  "events/tutorial.txt",
  "./events/tutorial.txt",
  "../sibling/x.txt",
  "/a/b/c/d",
  "/a/b",
  "file.txt",
  "file",
  ".hidden",
  "archive.tar.gz",
  "/trailing/dot.",
  "...",
  "a..b",
  "/mod/.ck3modding/schema.json",
  "/a/b/../..",
  "/..",
];

describe("browser path shim", () => {
  it("matches path.posix.normalize", () => {
    for (const p of PATHS) expect(shim.normalize(p), p).toBe(posix.normalize(p));
  });

  it("matches path.posix.isAbsolute", () => {
    for (const p of PATHS) expect(shim.isAbsolute(p), p).toBe(posix.isAbsolute(p));
  });

  it("matches path.posix.basename, dirname and extname", () => {
    for (const p of PATHS) {
      expect(shim.basename(p), `basename ${p}`).toBe(posix.basename(p));
      expect(shim.dirname(p), `dirname ${p}`).toBe(posix.dirname(p));
      expect(shim.extname(p), `extname ${p}`).toBe(posix.extname(p));
    }
    expect(shim.basename("/mod/events/x.txt", ".txt")).toBe("x");
  });

  it("matches path.posix.join", () => {
    for (const a of PATHS) {
      for (const b of PATHS) {
        expect(shim.join(a, b), `join(${a}, ${b})`).toBe(posix.join(a, b));
      }
    }
  });

  /**
   * `resolve` is the one place the shim cannot copy node exactly: there is no
   * working directory in a browser, so it anchors relative input at "/". Every
   * absolute case, which is all `classifyFile` ever sees, must still match.
   */
  it("matches path.posix.resolve for absolute input", () => {
    const absolute = PATHS.filter((p) => posix.isAbsolute(p));
    for (const a of absolute) {
      expect(shim.resolve(a), a).toBe(posix.resolve(a));
      for (const b of PATHS) {
        expect(shim.resolve(a, b), `resolve(${a}, ${b})`).toBe(posix.resolve(a, b));
      }
    }
  });

  it("anchors relative resolve at the root instead of a working directory", () => {
    expect(shim.resolve("events", "x.txt")).toBe("/events/x.txt");
  });

  it("matches path.posix.relative for absolute pairs", () => {
    const absolute = PATHS.filter((p) => posix.isAbsolute(p));
    for (const a of absolute) {
      for (const b of absolute) {
        expect(shim.relative(a, b), `relative(${a}, ${b})`).toBe(posix.relative(a, b));
      }
    }
  });

  it("uses a forward slash separator", () => {
    expect(shim.sep).toBe(posix.sep);
  });
});
