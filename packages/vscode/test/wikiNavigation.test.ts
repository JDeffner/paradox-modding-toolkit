import { describe, expect, it } from "vitest";
import {
  initialWikiState,
  parseWikiState,
  positionKey,
  rememberPosition,
  travel,
  visit,
} from "../src/webviews/wiki/navigation";

describe("Wiki navigation state boundary", () => {
  it("returns an independent copy of valid stored state", () => {
    const stored = initialWikiState("ck3");
    stored.positions[positionKey(stored.current)] = { scroll: 80, cardKind: "Maps" };
    const parsed = parseWikiState(stored)!;
    parsed.current.query = "changed";
    parsed.positions[positionKey(parsed.current)].scroll = 120;
    expect(stored.current.query).toBe("");
    expect(stored.positions[positionKey(stored.current)].scroll).toBe(80);
  });

  it("rejects malformed storage, unsupported versions and invalid positions", () => {
    const valid = initialWikiState("ck3");
    for (const invalid of [
      null,
      [],
      { ...valid, version: 2 },
      { ...valid, current: { ...valid.current, page: 7 } },
      { ...valid, back: [{ game: "ck3", page: null }] },
      { ...valid, positions: { x: { scroll: -1, cardKind: null } } },
      { ...valid, positions: { x: { scroll: Infinity, cardKind: null } } },
      { ...valid, positions: { x: { scroll: 0, cardKind: 7 } } },
    ])
      expect(parseWikiState(invalid)).toBeUndefined();
  });

  it("caps history, retains recent visits and clears forward history on a new destination", () => {
    const state = initialWikiState("ck3");
    for (let index = 0; index < 55; index++) visit(state, { game: "ck3", page: `page-${index}`, query: "" });
    expect(state.back).toHaveLength(50);
    expect(state.back[0].page).toBe("page-4");
    expect(parseWikiState(state)).toBeDefined();
    expect(parseWikiState({ ...state, back: [...state.back, state.current] })).toBeUndefined();
    expect(travel(state, "back")).toBe(true);
    expect(state.current.page).toBe("page-53");
    visit(state, { game: "vic3", page: "new", query: "term" });
    expect(travel(state, "forward")).toBe(false);
  });

  it("caps positions and retains a recently updated page when older positions expire", () => {
    const state = initialWikiState("ck3");
    for (let index = 0; index < 200; index++) {
      state.current.page = `page-${index}`;
      rememberPosition(state, index, null);
    }
    state.current.page = "page-0";
    rememberPosition(state, 500, "Maps");
    state.current.page = "page-200";
    rememberPosition(state, 200, null);
    expect(Object.keys(state.positions)).toHaveLength(200);
    expect(state.positions[positionKey({ ...state.current, page: "page-1" })]).toBeUndefined();
    expect(state.positions[positionKey({ ...state.current, page: "page-0" })]).toEqual({
      scroll: 500,
      cardKind: "Maps",
    });
    expect(parseWikiState(state)).toBeDefined();
    expect(
      parseWikiState({ ...state, positions: { ...state.positions, extra: { scroll: 0, cardKind: null } } })
    ).toBeUndefined();
  });
});
