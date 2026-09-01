// Copy the tracked per-diagnostic explanations (docs/diagnostics/*.md) into the
// vscode package's dist/ so the Wiki panel can read them at runtime and the
// .vsix carries them: docs/ lives at the repo root and never ships, dist/ does.
// The repo files stay the single source; nothing here is hand-maintained.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "packages", "vscode", "dist", "diagnostics");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(root, "docs", "diagnostics"), target, { recursive: true });
