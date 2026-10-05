/** Node-only read boundary for the portable project settings model. */
import * as fs from "fs";
import * as path from "path";
import { resolveConfigPath, type ConfigDirNames } from "./configDir";
import { parseProjectSettings, type ProjectSettings } from "./projectSettings";

export const PROJECT_SETTINGS_FILE = "project.json";

export interface ProjectSettingsFile {
  path: string;
  settings?: ProjectSettings;
  /** Missing files have no error. Malformed, unsupported and unreadable files do. */
  error?: string;
  legacy: boolean;
}

export function readProjectSettings(
  root: string,
  names: ConfigDirNames,
  expectedGameId?: string
): ProjectSettingsFile {
  const current = path.resolve(root, names.configDirName, PROJECT_SETTINGS_FILE);
  let file = current;
  try {
    file = resolveConfigPath(root, names, PROJECT_SETTINGS_FILE);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      // A dangling symlink is an existing invalid artifact, not a missing declaration.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          fs.lstatSync(file);
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") {
            return { path: file, legacy: file !== current };
          }
          throw statError;
        }
      }
      throw error;
    }
    const raw: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    return {
      path: file,
      settings: parseProjectSettings(raw, expectedGameId),
      legacy: file !== current,
    };
  } catch (error) {
    return { path: file, legacy: file !== current, error: (error as Error).message };
  }
}
