import * as path from "path";
import type { ConfigDirNames } from "@px-lsp/protocol/configDir";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import { readProjectSettings, type ProjectSettingsFile } from "@px-lsp/protocol/projectSettingsFile";

/** The closest editable root owns a file, never a sibling with the same prefix. */
export function owningProjectRoot(file: string, roots: readonly string[]): string | null {
  let owner: string | null = null;
  for (const root of roots) {
    if (owner && owner.length >= root.length) continue;
    const relative = path.relative(root, file);
    if (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    ) {
      owner = root;
    }
  }
  return owner;
}

/** One read per editable mod, invalidated by configuration changes and reindexing. */
export class ProjectPolicyCache {
  private readonly files = new Map<string, ProjectSettingsFile>();

  read(root: string, profile: ConfigDirNames & { id: string }): ProjectSettingsFile {
    const key = `${profile.id}:${path.resolve(root)}`;
    let file = this.files.get(key);
    if (!file) {
      file = readProjectSettings(root, profile, profile.id);
      this.files.set(key, file);
    }
    return file;
  }

  clear(): void {
    this.files.clear();
  }
}

/** Explicit project arrays replace client defaults, including an empty array. */
export function projectDiagnosticPolicy(
  file: ProjectSettingsFile | undefined,
  fallback: Pick<ParadoxSettings, "diagnosticsIgnore" | "diagnosticsIgnorePatterns">
): { ignore: string[]; ignorePatterns: string[] } {
  return {
    ignore: file?.settings?.validation?.ignore ?? fallback.diagnosticsIgnore,
    ignorePatterns: file?.settings?.validation?.ignorePatterns ?? fallback.diagnosticsIgnorePatterns,
  };
}
