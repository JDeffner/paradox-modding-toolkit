/**
 * The script-id decisions that no other test can catch: they run at activation
 * on a real workspace, and getting one wrong shows up as a wrong file icon or
 * as a user's own `files.associations` entry being overwritten.
 */
import { describe, expect, it } from "vitest";
import { isScriptLang, scriptLangFor, shouldRewriteAssociation } from "../src/langIds";

describe("scriptLangFor", () => {
  it("maps each game to its own id", () => {
    expect(scriptLangFor("ck3")).toBe("paradox-ck3");
    expect(scriptLangFor("vic3")).toBe("paradox-vic3");
    expect(scriptLangFor("eu5")).toBe("paradox-eu5");
  });

  it("falls back to the generic id for anything else", () => {
    expect(scriptLangFor("hoi4")).toBe("paradox");
    expect(scriptLangFor("")).toBe("paradox");
    // Guards the string-built id: "paradox-loc" is a language of ours, but it
    // is not a script id, so a gameId of "loc" must not resolve to it.
    expect(scriptLangFor("loc")).toBe("paradox");
  });

  it("knows the script ids apart from the other Paradox languages", () => {
    expect(isScriptLang("paradox-vic3")).toBe(true);
    expect(isScriptLang("paradox-gui")).toBe(false);
    expect(isScriptLang("plaintext")).toBe(false);
  });
});

describe("shouldRewriteAssociation", () => {
  it("rewrites the id 0.1.x and 0.3.0 persisted for every game", () => {
    expect(shouldRewriteAssociation("paradox", "paradox-ck3")).toBe(true);
    expect(shouldRewriteAssociation("paradox", "paradox-vic3")).toBe(true);
  });

  it("rewrites a workspace left on another game's id", () => {
    expect(shouldRewriteAssociation("paradox-ck3", "paradox-vic3")).toBe(true);
  });

  it("leaves the user's own mapping alone", () => {
    expect(shouldRewriteAssociation("plaintext", "paradox-ck3")).toBe(false);
    expect(shouldRewriteAssociation("ini", "paradox-ck3")).toBe(false);
  });

  it("does nothing when there is no value or it is already right", () => {
    expect(shouldRewriteAssociation(undefined, "paradox-ck3")).toBe(false);
    expect(shouldRewriteAssociation("paradox-ck3", "paradox-ck3")).toBe(false);
  });
});
