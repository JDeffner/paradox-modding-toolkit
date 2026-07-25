/**
 * Best-effort parsing of the game's logs/error.log lines. Pure (no vscode),
 * so it stays unit-testable; the tailing/diagnostics wiring lives in the
 * client.
 */

/** `... in file: events/x.txt line: 12` / `file: "gui/y.gui" near line: 3` */
const FILE_LINE =
  /file:\s*"?([^"\r\n]+?\.(?:txt|yml|gui|info|mod|gfx|asset))"?(?:\s+(?:near\s+)?line:?\s*(\d+))?/i;
const SEVERITY = /^\[\d{2}:\d{2}:\d{2}\]\[([EW])\]/;

export interface ParsedGameError {
  message: string;
  relFile: string;
  /** 0-based, or null for file-level entries. */
  line: number | null;
  severity: "error" | "warning";
}

/** Parse one error.log line; null when it names no file. */
export function parseErrorLogLine(raw: string): ParsedGameError | null {
  const line = raw.replace(/\r$/, "");
  if (line.trim() === "") return null;
  const m = FILE_LINE.exec(line);
  if (!m) return null;
  const sev = SEVERITY.exec(line);
  const message = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\[[EW]\]\[[^\]]*\]:\s*/, "").trim();
  return {
    message,
    relFile: m[1].replace(/\\/g, "/"),
    line: m[2] !== undefined ? Math.max(0, parseInt(m[2], 10) - 1) : null,
    severity: sev?.[1] === "W" ? "warning" : "error",
  };
}
