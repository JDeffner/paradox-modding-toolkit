// Recursive-descent, error-tolerant parser for Paradox script.
//
// Always produces a usable CST plus a list of structural errors. Never throws.

import {
  AssignmentNode,
  BlockNode,
  CommentNode,
  Operator,
  ParseError,
  ParseResult,
  RootNode,
  ScalarNode,
  Statement,
  TaggedBlockNode,
  ValueNode,
  ValueStatementNode,
} from "./cst.js";
import { Token, tokenize } from "./lexer.js";
// Display prose only (game name in the unclosed-brace hint) — the parser
// itself stays game-agnostic.
import { activeProfile } from "../games/active";

const OPERATORS: ReadonlySet<string> = new Set(["=", "?=", "==", "!=", "<", "<=", ">", ">="]);

class Parser {
  private readonly text: string;
  private readonly tokens: Token[];
  private pos = 0;
  private readonly errors: ParseError[] = [];
  private readonly comments: CommentNode[] = [];

  constructor(text: string) {
    this.text = text;
    this.tokens = tokenize(text);
  }

  parse(): ParseResult {
    const statements: Statement[] = [];
    while (!this.atEof()) {
      const tok = this.peek();
      if (tok.kind === "rbrace") {
        // Stray close at root level.
        this.errors.push({
          code: "stray-close",
          message: "Unexpected '}' with no matching open brace.",
          range: { start: tok.start, end: tok.end },
        });
        this.advance();
        continue;
      }
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      } else if (!this.atEof()) {
        // Defensive: nothing consumed — skip a token to guarantee progress.
        this.advance();
      }
    }

    const root: RootNode = {
      kind: "root",
      statements,
      range: { start: 0, end: this.text.length },
    };
    return { root, errors: this.errors, comments: this.comments };
  }

  // --- token stream helpers (skip comments transparently) ---

  private peek(): Token {
    this.skipComments();
    return this.tokens[this.pos];
  }

  private peekAhead(): Token {
    // Peek the token AFTER the current significant token, skipping comments.
    this.skipComments();
    let j = this.pos + 1;
    while (j < this.tokens.length && this.tokens[j].kind === "comment") j++;
    return this.tokens[j] ?? this.tokens[this.tokens.length - 1];
  }

  private advance(): Token {
    this.skipComments();
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private skipComments(): void {
    while (this.pos < this.tokens.length && this.tokens[this.pos].kind === "comment") {
      const c = this.tokens[this.pos];
      this.comments.push({
        text: this.text.slice(c.start, c.end),
        range: { start: c.start, end: c.end },
        line: this.lineAt(c.start),
      });
      this.pos++;
    }
  }

  // Lazily-built newline offset table for cheap 0-based line lookups.
  private newlineOffsets: number[] | null = null;

  private lineAt(offset: number): number {
    if (this.newlineOffsets === null) {
      const nl: number[] = [];
      for (let k = 0; k < this.text.length; k++) {
        if (this.text.charCodeAt(k) === 10 /* \n */) nl.push(k);
      }
      this.newlineOffsets = nl;
    }
    const nl = this.newlineOffsets;
    // Count newlines strictly before `offset` via binary search.
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private atEof(): boolean {
    this.skipComments();
    return this.tokens[this.pos].kind === "eof";
  }

  // --- grammar ---

  // statement := key (op value | block)? | value
  private parseStatement(): Statement | null {
    const tok = this.peek();

    if (tok.kind === "eof" || tok.kind === "rbrace") {
      return null;
    }

    // A block starting here is an anonymous list element (ValueStatementNode).
    if (tok.kind === "lbrace") {
      const block = this.parseBlock();
      const vs: ValueStatementNode = {
        kind: "value",
        value: block,
        range: { ...block.range },
      };
      return vs;
    }

    // Otherwise the statement starts with a scalar (word or string).
    if (tok.kind === "word" || tok.kind === "string") {
      const key = this.makeScalar(this.advance());
      const next = this.peek();

      // key op value
      if (next.kind === "op") {
        const opTok = this.advance();
        const op = opTok.value as Operator;
        const value = this.parseValueAfterOperator();
        if (value === null) {
          this.errors.push({
            code: "missing-value",
            message: `Missing value after '${op}'.`,
            range: { start: opTok.start, end: opTok.end },
          });
        }
        const end = value ? value.range.end : opTok.end;
        const assign: AssignmentNode = {
          kind: "assignment",
          key,
          op,
          value,
          range: { start: key.range.start, end },
        };
        return assign;
      }

      // key block (GUI style, no operator) — e.g. `template MyT { ... }`
      if (next.kind === "lbrace") {
        const block = this.parseBlock();
        const assign: AssignmentNode = {
          kind: "assignment",
          key,
          op: null,
          value: block,
          range: { start: key.range.start, end: block.range.end },
        };
        return assign;
      }

      // Bare scalar — list element.
      const vs: ValueStatementNode = {
        kind: "value",
        value: key,
        range: { ...key.range },
      };
      return vs;
    }

    // Unexpected token kind (shouldn't normally happen). Consume and skip.
    this.advance();
    return null;
  }

  // value := scalar | block | scalar-immediately-followed-by-`{` (TaggedBlock)
  // Used after an operator. Returns null if no value is parseable.
  private parseValueAfterOperator(): ValueNode | null {
    const tok = this.peek();

    if (tok.kind === "lbrace") {
      return this.parseBlock();
    }

    // `OPERATOR = <=` and friends: a comparison operator used as a VALUE.
    // Vanilla uses this in list/any triggers (RELATION/OPERATOR/COUNT blocks).
    // Accept the operator token as a bare scalar value.
    if (tok.kind === "op") {
      const opTok = this.advance();
      return {
        kind: "scalar",
        text: this.text.slice(opTok.start, opTok.end),
        quoted: false,
        range: { start: opTok.start, end: opTok.end },
      };
    }

    if (tok.kind === "word" || tok.kind === "string") {
      // Disambiguate `key =\n nextKey = ...`: if the scalar here is immediately
      // followed by an operator, it is the NEXT statement's key, not this
      // value. Treat the current value as missing so the next statement parses.
      // But `word op word` where the trailing op is a value (rare) is handled
      // by the caller re-entering; here we only bail when the following token
      // is an operator AND the current scalar is a plausible key.
      const after = this.peekAhead();
      if (after.kind === "op") {
        return null;
      }
      const scalar = this.makeScalar(this.advance());
      // Tagged block: scalar immediately followed by `{`.
      const next = this.peek();
      if (next.kind === "lbrace") {
        const block = this.parseBlock();
        const tb: TaggedBlockNode = {
          kind: "tagged-block",
          tag: scalar,
          block,
          range: { start: scalar.range.start, end: block.range.end },
        };
        return tb;
      }
      return scalar;
    }

    // op / rbrace / eof → no value.
    return null;
  }

  // block := `{` statement* `}`
  private parseBlock(): BlockNode {
    const open = this.advance(); // consume `{`
    const openBrace = open.start;
    const statements: Statement[] = [];
    let closeBrace: number | null = null;
    let end = open.end;

    while (true) {
      const tok = this.peek();
      if (tok.kind === "eof") {
        // Unclosed block: report at the opening brace, swallow the rest.
        this.errors.push({
          code: "unclosed-brace",
          message:
            "Unclosed '{': the rest of the file is swallowed by this block. " +
            `${activeProfile().shortName} silently ignores everything after an unbalanced brace.`,
          range: { start: openBrace, end: openBrace + 1 },
        });
        closeBrace = null;
        end = tok.start;
        break;
      }
      if (tok.kind === "rbrace") {
        closeBrace = tok.start;
        end = tok.end;
        this.advance();
        break;
      }
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      } else if (this.peek().kind !== "rbrace" && this.peek().kind !== "eof") {
        // Guarantee progress.
        this.advance();
      }
    }

    return {
      kind: "block",
      statements,
      range: { start: openBrace, end },
      openBrace,
      closeBrace,
    };
  }

  // --- helpers ---

  private makeScalar(tok: Token): ScalarNode {
    if (tok.kind === "string") {
      // Strip surrounding quotes for `text`; keep range covering the quotes.
      // For unterminated strings there's only an opening quote.
      let inner: string;
      if (tok.unterminated) {
        // Unterminated: report the diagnostic and take everything after `"`.
        this.errors.push({
          code: "unterminated-string",
          message: "Unterminated string; recovered at end of line.",
          range: { start: tok.start, end: tok.end },
        });
        inner = this.text.slice(tok.start + 1, tok.end);
      } else {
        inner = this.text.slice(tok.start + 1, tok.end - 1);
      }
      return {
        kind: "scalar",
        text: inner,
        quoted: true,
        range: { start: tok.start, end: tok.end },
      };
    }
    // word
    return {
      kind: "scalar",
      text: this.text.slice(tok.start, tok.end),
      quoted: false,
      range: { start: tok.start, end: tok.end },
    };
  }
}

export function parseScript(text: string): ParseResult {
  try {
    return new Parser(text).parse();
  } catch {
    // Absolute last-resort guard: should be unreachable, but the contract is
    // "never throw on any input".
    return {
      root: {
        kind: "root",
        statements: [],
        range: { start: 0, end: text.length },
      },
      errors: [],
      comments: [],
    };
  }
}

export { OPERATORS };
