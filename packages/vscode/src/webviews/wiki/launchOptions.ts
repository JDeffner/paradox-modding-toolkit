import * as fs from "fs";
import * as path from "path";
import type { GameMeta } from "@px-lsp/server/games/profile";
import type { WikiArticle } from "./messages";

export const LAUNCH_OPTIONS_ARTICLE = "launch-options";

/** Convert the installed info format without interpreting or selecting its options. */
function sourceMarkdown(source: string): string {
  const out: string[] = [];
  let code: string[] = [];
  const flushCode = (): void => {
    if (code.length) {
      out.push("```", ...code, "```", "");
      code = [];
    }
  };
  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.trim()) {
      flushCode();
      out.push("");
    } else if (line.startsWith("#")) {
      flushCode();
      if (/^#####\s/.test(line)) {
        out.push(`**${line.replace(/^#####\s*/, "").replace(/\s+#####\s*$/, "")}**`, "");
      } else if (/^###\s/.test(line)) {
        out.push(line, "");
      } else {
        out.push(line.replace(/^#\s?/, ""));
      }
    } else {
      // Keep consecutive syntaxes together under their shared description.
      if (!code.length) out.push("");
      code.push(line);
    }
  }
  flushCode();
  return out.join("\n");
}

/** Fresh, read-only reference. Failure replaces content rather than keeping stale options. */
export function readLaunchOptions(meta: GameMeta, gamePath: string | null): WikiArticle {
  const heading = "# Launch Options\n\n";
  const article: WikiArticle = {
    id: LAUNCH_OPTIONS_ARTICLE,
    title: "Launch Options",
    game: meta.id,
    section: "Game reference",
    markdown: "",
  };
  const filename = meta.launchOptionsFile;
  if (!filename) {
    article.markdown = `${heading}No installed launch-options reference has been verified for ${meta.name}.`;
    return article;
  }
  const sourceLabel = `Source: \`${filename}\` from the installed game.`;
  if (!gamePath) {
    article.markdown = `${heading}${sourceLabel}\n\nSet the ${meta.name} game data folder in toolkit settings to read this reference.`;
    return article;
  }
  try {
    const sourcePath = path.join(gamePath, filename);
    const source = fs.readFileSync(sourcePath, "utf8");
    const modified = fs.statSync(sourcePath).mtime.toISOString();
    article.markdown = `${heading}${sourceLabel}\n\nSource modified: ${modified}. Read from disk when this page opens.\n\n`;
    article.markdown += source.replace(/^\uFEFF/, "").trim()
      ? sourceMarkdown(source)
      : "The installed reference is empty. Check the game installation.";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    article.markdown = `${heading}${sourceLabel}\n\n${missing ? "The installed reference is missing. Check the game data folder and installation." : "The installed reference could not be read. Check the file and its read permissions."}\n\nRead error:\n\n\`\`\`\n${reason}\n\`\`\``;
  }
  return article;
}
