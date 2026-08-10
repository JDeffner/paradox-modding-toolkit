// Concrete Syntax Tree node types and utilities for Paradox script.
//
// All offsets are UTF-16 code-unit offsets into the source string (i.e. the
// same units JavaScript string indexing / `String.prototype.slice` use, and
// the same units the VS Code LSP uses for `character` positions on a line).

export interface Range {
  start: number;
  end: number;
}

export type Operator = "=" | "?=" | "==" | "!=" | "<" | "<=" | ">" | ">=";

export interface RootNode {
  kind: "root";
  statements: Statement[];
  range: Range;
}

export interface AssignmentNode {
  kind: "assignment";
  key: ScalarNode;
  op: Operator | null; // null for GUI-style `key { ... }` with no operator
  value: ValueNode | null; // null when the value is missing (error recorded)
  range: Range;
}

// A bare list element, e.g. the `brave` / `ambitious` in `traits = { brave ambitious }`
// or an anonymous block in `{ 1 2 } { 3 4 }`.
export interface ValueStatementNode {
  kind: "value";
  value: ValueNode;
  range: Range;
}

export type Statement = AssignmentNode | ValueStatementNode;

export interface ScalarNode {
  kind: "scalar";
  text: string; // the raw text of the scalar; for quoted scalars, WITHOUT surrounding quotes
  quoted: boolean;
  range: Range; // for quoted scalars, INCLUDES the surrounding quotes
}

export interface BlockNode {
  kind: "block";
  statements: Statement[];
  range: Range;
  openBrace: number; // offset of `{`
  closeBrace: number | null; // offset of `}`, or null if missing (error recorded)
}

// e.g. `color = rgb { 255 0 0 }` — a scalar tag immediately followed by a block.
export interface TaggedBlockNode {
  kind: "tagged-block";
  tag: ScalarNode;
  block: BlockNode;
  range: Range;
}

export type ValueNode = ScalarNode | BlockNode | TaggedBlockNode;

export interface CommentNode {
  text: string; // includes the leading `#`
  range: Range;
  line: number; // 0-based line number
}

export type ParseErrorCode =
  | "unclosed-brace" // report at the OPENING brace of the unclosed block
  | "stray-close" // `}` with no open block
  | "unterminated-string" // recover at end of line
  | "missing-value"; // `key =` with nothing parseable after

export interface ParseError {
  code: ParseErrorCode;
  message: string;
  range: Range;
}

export interface ParseResult {
  root: RootNode;
  errors: ParseError[];
  comments: CommentNode[];
}

// -------------------------------------------------------------------------
// LineIndex — maps between offsets and (line, character) positions.
// -------------------------------------------------------------------------

export class LineIndex {
  // lineStarts[i] is the offset of the first character of line i (0-based).
  private readonly lineStarts: number[];
  private readonly length: number;

  constructor(text: string) {
    this.length = text.length;
    const starts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 10 /* \n */) {
        starts.push(i + 1);
      } else if (c === 13 /* \r */) {
        // Treat \r\n as a single break; a lone \r also breaks a line.
        if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
          starts.push(i + 2);
          i++;
        } else {
          starts.push(i + 1);
        }
      }
    }
    this.lineStarts = starts;
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  lineStart(line: number): number {
    if (line < 0) return 0;
    if (line >= this.lineStarts.length) return this.length;
    return this.lineStarts[line];
  }

  positionAt(offset: number): { line: number; character: number } {
    let o = offset;
    if (o < 0) o = 0;
    if (o > this.length) o = this.length;
    // Binary search for the greatest lineStart <= o.
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= o) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo, character: o - this.lineStarts[lo] };
  }

  offsetAt(pos: { line: number; character: number }): number {
    let line = pos.line;
    if (line < 0) line = 0;
    if (line >= this.lineStarts.length) {
      return this.length;
    }
    const start = this.lineStarts[line];
    // Clamp character to the end of this line (start of next line, or EOF).
    const nextStart = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.length;
    let ch = pos.character;
    if (ch < 0) ch = 0;
    let offset = start + ch;
    if (offset > nextStart) offset = nextStart;
    if (offset > this.length) offset = this.length;
    return offset;
  }
}

// -------------------------------------------------------------------------
// Walk helpers
// -------------------------------------------------------------------------

function statementChildBlock(stmt: Statement): BlockNode | null {
  if (stmt.kind === "assignment") {
    const v = stmt.value;
    if (v && v.kind === "block") return v;
    if (v && v.kind === "tagged-block") return v.block;
    return null;
  }
  // value statement
  const v = stmt.value;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}

/**
 * Depth-first walk over every statement in the tree. The callback receives the
 * statement plus the chain of ancestor assignment/block nodes (outermost first).
 */
export function walkStatements(
  root: RootNode | BlockNode,
  cb: (stmt: Statement, ancestors: readonly (AssignmentNode | BlockNode)[]) => void
): void {
  const ancestors: (AssignmentNode | BlockNode)[] = [];

  const visitBlock = (block: BlockNode): void => {
    for (const stmt of block.statements) {
      cb(stmt, ancestors);
      const child = statementChildBlock(stmt);
      if (child) {
        if (stmt.kind === "assignment") {
          ancestors.push(stmt);
        }
        ancestors.push(child);
        visitBlock(child);
        ancestors.pop();
        if (stmt.kind === "assignment") {
          ancestors.pop();
        }
      }
    }
  };

  if (root.kind === "root") {
    for (const stmt of root.statements) {
      cb(stmt, ancestors);
      const child = statementChildBlock(stmt);
      if (child) {
        if (stmt.kind === "assignment") {
          ancestors.push(stmt);
        }
        ancestors.push(child);
        visitBlock(child);
        ancestors.pop();
        if (stmt.kind === "assignment") {
          ancestors.pop();
        }
      }
    }
  } else {
    visitBlock(root);
  }
}

function offsetInRange(offset: number, range: Range): boolean {
  return offset >= range.start && offset <= range.end;
}

/**
 * Returns the innermost-last chain of statements whose ranges contain `offset`.
 * For a cursor sitting between statements inside a block, the path ends at the
 * enclosing statement chain (i.e. the assignment/value-statement that owns the
 * block the cursor is inside). Returns null if offset is outside all statements.
 */
export function nodeAtOffset(root: RootNode, offset: number): { path: Statement[] } | null {
  const path: Statement[] = [];

  const searchStatements = (statements: Statement[]): boolean => {
    for (const stmt of statements) {
      if (!offsetInRange(offset, stmt.range)) continue;
      path.push(stmt);
      const child = statementChildBlock(stmt);
      if (child && offsetInRange(offset, child.range)) {
        searchStatements(child.statements);
      }
      return true;
    }
    return false;
  };

  searchStatements(root.statements);
  return path.length > 0 ? { path } : null;
}
