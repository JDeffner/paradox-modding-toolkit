/**
 * Interact mode: what a click can do in a STATIC preview.
 *
 * The game runs an `onclick` as script; the preview cannot. What it can do is
 * read the variable-system calls out of it (`GetVariableSystem.Set('k','v')`,
 * `.Clear('k')`, `.Toggle('k')`, `.SetIfNotExists`), keep a table of those
 * variables, and evaluate every `visible` check that is written in terms of
 * them (`Exists`, `HasValue`, `Not`, `And`, `Or`). Those assignments go to the
 * server's `evaluate` visibility mode, and the layout answers with the widgets
 * the click showed or hid: a tab switches, a window opens, a toggle flips.
 * Everything else in the onclick is named as what the game would run.
 *
 * PURE: no DOM, no host, so the evaluator is tested headless.
 */

export type VarAction =
  | { kind: "set"; key: string; value: string | null }
  | { kind: "setIfNotExists"; key: string; value: string | null }
  | { kind: "clear"; key: string }
  | { kind: "toggle"; key: string }
  /** A call the preview cannot run; `text` is the call as written. */
  | { kind: "other"; text: string };

/** Variable table: a key that exists with no value maps to null. */
export type VarState = Map<string, string | null>;

// ---------------------------------------------------------------------------
// A tiny parser for datafunction chains: Ident[(args)](.Ident[(args)])*
// where an arg is a quoted string, a number, or a nested chain.

export interface Call {
  name: string;
  args: Arg[];
  /** The next link of the chain (`A.B(x)` -> A with next B). */
  next?: Call;
}
export type Arg =
  { kind: "str"; value: string } | { kind: "expr"; call: Call } | { kind: "raw"; value: string };

class Parser {
  i = 0;
  constructor(private readonly s: string) {}
  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  chain(): Call | null {
    this.ws();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    const call: Call = { name: m[0], args: [] };
    this.ws();
    if (this.s[this.i] === "(") {
      this.i++;
      for (;;) {
        this.ws();
        if (this.s[this.i] === ")") {
          this.i++;
          break;
        }
        const arg = this.arg();
        if (!arg) return null;
        call.args.push(arg);
        this.ws();
        if (this.s[this.i] === ",") this.i++;
        else if (this.s[this.i] !== ")") return null;
      }
    }
    this.ws();
    if (this.s[this.i] === ".") {
      this.i++;
      const next = this.chain();
      if (!next) return null;
      call.next = next;
    }
    return call;
  }
  private arg(): Arg | null {
    const c = this.s[this.i];
    if (c === "'" || c === '"') {
      const end = this.s.indexOf(c, this.i + 1);
      if (end < 0) return null;
      const value = this.s.slice(this.i + 1, end);
      this.i = end + 1;
      return { kind: "str", value };
    }
    if (/[A-Za-z_]/.test(c)) {
      const call = this.chain();
      return call ? { kind: "expr", call } : null;
    }
    const m = /^[^,)]+/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return { kind: "raw", value: m[0].trim() };
  }
}

/** Parse one `[...]` expression (brackets optional). Null when it is not a chain. */
export function parseChain(source: string): Call | null {
  const text = source.trim().replace(/^\[/, "").replace(/\]$/, "");
  const p = new Parser(text);
  const call = p.chain();
  if (!call) return null;
  while (p.i < text.length && /\s/.test(text[p.i])) p.i++;
  return p.i === text.length ? call : null;
}

/** Every bracketed expression in an onclick value, in order. */
function expressions(onclick: string): string[] {
  const out: string[] = [];
  const re = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(onclick))) out.push(m[1]);
  return out;
}

function strArg(call: Call, i: number): string | null {
  const a = call.args[i];
  return a && a.kind === "str" ? a.value : null;
}

/** The actions a click performs, variable calls decoded and the rest named. */
export function parseOnclick(onclick: string | undefined): VarAction[] {
  if (!onclick) return [];
  const actions: VarAction[] = [];
  for (const expr of expressions(onclick)) {
    const call = parseChain(expr);
    const op = call && call.name === "GetVariableSystem" ? call.next : null;
    const key = op ? strArg(op, 0) : null;
    if (op && key !== null && !op.next) {
      if (op.name === "Set") {
        actions.push({ kind: "set", key, value: strArg(op, 1) });
        continue;
      }
      if (op.name === "SetIfNotExists") {
        actions.push({ kind: "setIfNotExists", key, value: strArg(op, 1) });
        continue;
      }
      if (op.name === "Clear") {
        actions.push({ kind: "clear", key });
        continue;
      }
      if (op.name === "Toggle") {
        actions.push({ kind: "toggle", key });
        continue;
      }
    }
    actions.push({ kind: "other", text: expr.trim() });
  }
  return actions;
}

/** Apply the variable actions to a COPY of the state; returns the new state. */
export function applyActions(state: VarState, actions: readonly VarAction[]): VarState {
  const next = new Map(state);
  for (const a of actions) {
    if (a.kind === "set") next.set(a.key, a.value);
    else if (a.kind === "setIfNotExists") {
      if (!next.has(a.key)) next.set(a.key, a.value);
    } else if (a.kind === "clear") next.delete(a.key);
    else if (a.kind === "toggle") {
      if (next.has(a.key)) next.delete(a.key);
      else next.set(a.key, null);
    }
  }
  return next;
}

/**
 * Evaluate a `visible` check against the variable table. `undefined` when the
 * expression asks something a static preview cannot know (any call outside the
 * variable system and the three boolean combinators), so that check keeps its
 * default instead of being guessed.
 */
export function evaluateCheck(source: string, state: VarState): boolean | undefined {
  const call = parseChain(source);
  return call ? evalCall(call, state) : undefined;
}

function evalCall(call: Call, state: VarState): boolean | undefined {
  if (call.name === "GetVariableSystem" && call.next && !call.next.next) {
    const op = call.next;
    const key = strArg(op, 0);
    if (key === null) return undefined;
    if (op.name === "Exists") return state.has(key);
    if (op.name === "HasValue") {
      const v = strArg(op, 1);
      return v !== null && state.has(key) && state.get(key) === v;
    }
    return undefined;
  }
  if (call.next) return undefined;
  const sub = (i: number): boolean | undefined => {
    const a = call.args[i];
    return a && a.kind === "expr" ? evalCall(a.call, state) : undefined;
  };
  if (call.name === "Not") return call.args.length === 1 ? flip(sub(0)) : undefined;
  if (call.name === "And" || call.name === "Or") {
    const values = call.args.map((_, i) => sub(i));
    const short = call.name === "And" ? false : true;
    if (values.some((v) => v === short)) return short;
    return values.every((v) => v !== undefined) ? !short : undefined;
  }
  return undefined;
}

function flip(v: boolean | undefined): boolean | undefined {
  return v === undefined ? undefined : !v;
}

/**
 * The `evaluate` assignments for every check the evaluator can decide. A check
 * it cannot decide is left out, which the server reads as "shown".
 */
export function assignments(checkKeys: readonly string[], state: VarState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of checkKeys) {
    const v = evaluateCheck(key, state);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** One line per action, the way the click popover lists them. */
export function describeAction(a: VarAction): string {
  switch (a.kind) {
    case "set":
      return a.value === null ? `set ${a.key}` : `set ${a.key} = ${a.value}`;
    case "setIfNotExists":
      return a.value === null ? `set ${a.key} (if unset)` : `set ${a.key} = ${a.value} (if unset)`;
    case "clear":
      return `clear ${a.key}`;
    case "toggle":
      return `toggle ${a.key}`;
    case "other":
      return a.text;
  }
}
