import { describe, expect, it } from "vitest";
import {
  applyActions,
  assignments,
  evaluateCheck,
  parseOnclick,
  type VarState,
} from "../src/webviews/guiEditor/app/interact";

describe("interact: onclick actions", () => {
  it("decodes the variable-system calls and names the rest", () => {
    const actions = parseOnclick(
      `[GetVariableSystem.Set('tab', 'forge')]\n[GetVariableSystem.Clear('panel_open')] [GetVariableSystem.Toggle('x')] [GetPlayer.MakeScope.ExecuteEffect('open_forge')]`
    );
    expect(actions).toEqual([
      { kind: "set", key: "tab", value: "forge" },
      { kind: "clear", key: "panel_open" },
      { kind: "toggle", key: "x" },
      { kind: "other", text: "GetPlayer.MakeScope.ExecuteEffect('open_forge')" },
    ]);
  });

  it("applies set / clear / toggle / setIfNotExists to a copy", () => {
    const s0: VarState = new Map([["a", null]]);
    const s1 = applyActions(s0, [
      { kind: "set", key: "tab", value: "forge" },
      { kind: "toggle", key: "a" },
      { kind: "setIfNotExists", key: "tab", value: "other" },
    ]);
    expect(s0.size).toBe(1);
    expect([...s1]).toEqual([["tab", "forge"]]);
  });
});

describe("interact: visible checks", () => {
  const state: VarState = new Map([
    ["forge_open", null],
    ["tab", "overview"],
  ]);
  it("evaluates Exists, HasValue and the combinators", () => {
    expect(evaluateCheck("[GetVariableSystem.Exists('forge_open')]", state)).toBe(true);
    expect(evaluateCheck("[Not(GetVariableSystem.Exists('forge_open'))]", state)).toBe(false);
    expect(evaluateCheck("[GetVariableSystem.HasValue('tab', 'overview')]", state)).toBe(true);
    expect(evaluateCheck("[GetVariableSystem.HasValue( 'tab', 'forge' )]", state)).toBe(false);
    expect(
      evaluateCheck(
        "[And(GetVariableSystem.Exists('forge_open'), GetVariableSystem.HasValue('tab','overview'))]",
        state
      )
    ).toBe(true);
  });

  it("leaves what the game alone can answer undecided, unless a combinator short-circuits", () => {
    expect(evaluateCheck("[GetPlayer.IsAI]", state)).toBeUndefined();
    expect(evaluateCheck("[And(GetPlayer.IsAI, GetVariableSystem.Exists('nope'))]", state)).toBe(false);
    expect(evaluateCheck("[Or(GetPlayer.IsAI, GetVariableSystem.Exists('forge_open'))]", state)).toBe(true);
    expect(evaluateCheck("[Or(GetPlayer.IsAI, GetVariableSystem.Exists('nope'))]", state)).toBeUndefined();
  });

  it("assigns only the decidable checks", () => {
    expect(
      assignments(
        ["[GetVariableSystem.Exists('forge_open')]", "[GetPlayer.IsAI]", "[GetVariableSystem.Exists('z')]"],
        state
      )
    ).toEqual({ "[GetVariableSystem.Exists('forge_open')]": true, "[GetVariableSystem.Exists('z')]": false });
  });
});
