/**
 * Whether a steamworks.js build can set per-language Workshop text. The
 * version floor (jobs.ts LANGUAGE_UPDATE_MIN_VERSION) turned out to be a lie
 * detector that cannot detect lies: 0.6.0 shipped per-language QUERY support
 * but no `UgcUpdate.language` (SetItemUpdateLanguage), and a version gate
 * would have waved it through - straight into translations overwriting the
 * default-language text. So the probe reads the package's own napi-generated
 * client.d.ts and looks for the field on UgcUpdate; the version floor stays
 * only as the fallback when there is no d.ts to consult.
 *
 * Bundled into both the extension host and the bridge child, so the gate
 * holds in both places. No vscode imports.
 */
import * as fs from "fs";
import * as path from "path";
import { LANGUAGE_UPDATE_MIN_VERSION, versionAtLeast } from "./jobs";

/** True when the build at `steamworksDir` carries UgcUpdate.language. */
export function supportsLanguageUpdate(steamworksDir: string): boolean {
  try {
    const dts = fs.readFileSync(path.join(steamworksDir, "client.d.ts"), "utf8");
    const start = dts.indexOf("interface UgcUpdate");
    if (start >= 0) {
      // The interface body runs until the next `export` at member indent;
      // doc comments inside may contain braces, so no brace matching.
      const rest = dts.slice(start);
      const end = rest.search(/\n\s*export /);
      const body = end > 0 ? rest.slice(0, end) : rest;
      return /^\s*language\??:\s*string/m.test(body);
    }
  } catch {
    /* no d.ts: fall through to the version floor */
  }
  return versionAtLeast(bundledSteamworksVersion(steamworksDir), LANGUAGE_UPDATE_MIN_VERSION);
}

/** The build's own version string, "0.0.0" when unreadable. */
export function bundledSteamworksVersion(steamworksDir: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(steamworksDir, "package.json"), "utf8")) as {
      version?: string;
    };
    return raw.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
