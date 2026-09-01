/**
 * Merge planning for `px.reduceEditorLoad`: adds only patterns no scope has
 * decided yet, and never drops or rewrites existing workspace entries.
 */
import { describe, expect, it } from "vitest";
import { planExcludes, SEARCH_EXCLUDES, WATCHER_EXCLUDES } from "../src/editorExcludes";

describe("planExcludes", () => {
  it("adds every pattern to an empty workspace value", () => {
    const plan = planExcludes({}, undefined, WATCHER_EXCLUDES);
    expect(plan.added).toEqual(WATCHER_EXCLUDES);
    for (const p of WATCHER_EXCLUDES) expect(plan.value?.[p]).toBe(true);
  });

  it("skips patterns already decided in ANY scope, true or false", () => {
    // "**/gfx/**": false is the user's explicit choice; it must survive as-is.
    const effective = { "**/gfx/**": false, "**/*.dds": true, "**/.git": true };
    const workspace = { "**/gfx/**": false };
    const plan = planExcludes(effective, workspace, WATCHER_EXCLUDES);
    expect(plan.added).not.toContain("**/gfx/**");
    expect(plan.added).not.toContain("**/*.dds");
    expect(plan.value?.["**/gfx/**"]).toBe(false);
  });

  it("keeps non-boolean workspace entries verbatim (search.exclude when-clauses)", () => {
    const when = { when: "$(basename).ts" };
    const plan = planExcludes({ "**/*.js": when }, { "**/*.js": when }, SEARCH_EXCLUDES);
    expect(plan.value?.["**/*.js"]).toBe(when);
  });

  it("returns a null value when everything is already excluded", () => {
    const effective = Object.fromEntries(SEARCH_EXCLUDES.map((p) => [p, true]));
    const plan = planExcludes(effective, effective, SEARCH_EXCLUDES);
    expect(plan.value).toBeNull();
    expect(plan.added).toEqual([]);
  });
});
