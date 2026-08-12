/**
 * Best-effort parsing of the game's logs/error.log lines. Pure (no vscode),
 * so it stays unit-testable; the tailing/diagnostics wiring lives in the
 * client.
 */

/** `... in file: events/x.txt line: 12` / `file: "gui/y.gui" near line: 3` */
const FILE_LINE =
  /file:\s*"?([^"\r\n]+?\.(?:txt|yml|gui|info|mod|gfx|asset))"?(?:\s+(?:near\s+)?line:?\s*(\d+))?/i;
/**
 * Newer Jomini titles write the location with no `file:` keyword:
 * `gui/x.gui:110 - Widget cannot have a position in a layout`. The ` - `
 * separator is required; without it any "foo.txt:3" quoted inside a message
 * would be read as a location.
 */
const FILE_LINE_BARE = /([\w./\\-]+\.(?:txt|yml|gui)):(\d+)\s+-\s+/;
/**
 * Timestamp, with an OPTIONAL severity tag: older logs write
 * `[18:33:24][E][x.cpp:1]:`, newer ones `[01:30:39][x.cpp:186]:` and leave the
 * severity to the message text. Untagged entries count as errors.
 */
const TIMESTAMP = /^\[\d{2}:\d{2}:\d{2}\](?:\[([EW])\])?/;
/** The `[time][sev][source.cpp:N]: ` preamble, stripped from messages. */
const PREAMBLE = /^\[\d{2}:\d{2}:\d{2}\](?:\[[EW]\])?\[[^\]]*\]:\s*/;

export interface ParsedGameError {
  message: string;
  relFile: string;
  /** 0-based, or null for file-level entries. */
  line: number | null;
  severity: "error" | "warning";
}

interface FileMatch {
  relFile: string;
  line: number | null;
  /** Text of the location match, so callers can drop it from the message. */
  matched: string;
}

/** The file/line a log line names, in either shape; null when it names none. */
function matchFile(line: string): FileMatch | null {
  const m = FILE_LINE.exec(line);
  if (m) {
    return {
      relFile: m[1].replace(/\\/g, "/"),
      line: m[2] !== undefined ? Math.max(0, parseInt(m[2], 10) - 1) : null,
      matched: "",
    };
  }
  const bare = FILE_LINE_BARE.exec(line);
  if (!bare) return null;
  return {
    relFile: bare[1].replace(/\\/g, "/"),
    line: Math.max(0, parseInt(bare[2], 10) - 1),
    matched: bare[0],
  };
}

/** Parse one error.log line; null when it names no file. */
export function parseErrorLogLine(raw: string): ParsedGameError | null {
  const line = raw.replace(/\r$/, "");
  if (line.trim() === "") return null;
  const m = matchFile(line);
  if (!m) return null;
  const sev = TIMESTAMP.exec(line);
  let message = line.replace(PREAMBLE, "").trim();
  // The bare shape puts the location in front of the text; the diagnostic
  // already carries file and line, so it is redundant there.
  if (m.matched !== "" && message.startsWith(m.matched))
    message = message.slice(m.matched.length).trim() || message;
  return {
    message,
    relFile: m.relFile,
    line: m.line,
    severity: sev?.[1] === "W" ? "warning" : "error",
  };
}

/**
 * Stateful line parser: same as `parseErrorLogLine`, but additionally stitches
 * multi-line `Script system error!` blocks together, where the actual error
 * text and the file location sit on separate indented continuation lines:
 *
 *     [18:14:55][E][jomini_script_system.cpp:303]: Script system error!
 *       Error: is_cultivator trigger [ Scoped object ... is not valid ]
 *       Script location: file: common/script_values/x.txt line: 25 (name)
 *
 * Line-by-line, the location line would become the diagnostic message and the
 * error text would be dropped. Feed EVERY line through `push` in order (state
 * carries across reads); call `reset` when the log is cleared or replaced.
 */
export class ErrorLogParser {
  private pendingSeverity: "error" | "warning" | null = null;
  private pendingError: string | null = null;

  push(raw: string): ParsedGameError | null {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") {
      this.reset();
      return null;
    }
    const sev = TIMESTAMP.exec(line);
    if (sev) {
      // Timestamped entry: single-line entries parse as before; a header that
      // names no file (e.g. "Script system error!") opens a block.
      this.reset();
      const single = parseErrorLogLine(line);
      if (single) return single;
      this.pendingSeverity = sev[1] === "W" ? "warning" : "error"; // untagged = error
      return null;
    }
    // Untimestamped continuation line of an open block.
    if (this.pendingSeverity === null) return null;
    const err = /^\s*Error:\s*(.+)$/.exec(line);
    if (err) {
      this.pendingError = err[1].trim();
      return null;
    }
    const m = matchFile(line);
    if (!m) return null;
    const parsed: ParsedGameError = {
      message: this.pendingError ?? line.trim(),
      relFile: m.relFile,
      line: m.line,
      severity: this.pendingSeverity,
    };
    this.reset();
    return parsed;
  }

  reset(): void {
    this.pendingSeverity = null;
    this.pendingError = null;
  }
}
