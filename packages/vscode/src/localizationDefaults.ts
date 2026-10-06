import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { readModName } from "@px-lsp/protocol/modName";
import { parseLocalizationDefaults, type LocalizationDefaults } from "@px-lsp/protocol/localizationPolicy";
import { LOC_LANGUAGES } from "@px-lsp/protocol/translationCore";
import type { PxConfig } from "./config";
import { containsPath } from "./commandTargets";
import { prepareProjectConfigWrite } from "./projectConfigFile";
import { metaFor } from "./meta";
import { localizationRoots } from "./localizationProject";

function validateSetting(
  defaults: LocalizationDefaults,
  field: keyof LocalizationDefaults,
  value: string
): string | undefined {
  try {
    parseLocalizationDefaults({ ...defaults, [field]: value });
    if (
      (field === "newKeyFile" || field === "overrideFile") &&
      value &&
      !/_l_(?:\{language\}|[a-z_]+)\.yml$/.test(value)
    ) {
      return "Use a filename ending in _l_{language}.yml or _l_<language>.yml.";
    }
    if (field === "overrideFile" && value && !value.split("/").includes("replace")) {
      return "An override file needs a replace folder.";
    }
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
}

function assertDefaultsPath(cfg: PxConfig, file: string): void {
  let ancestor = file;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const physical = fs.realpathSync(ancestor);
  if (
    !cfg.modPath ||
    !containsPath(fs.realpathSync(cfg.modPath), physical) ||
    (cfg.gamePath && containsPath(fs.realpathSync(cfg.gamePath), physical))
  ) {
    throw new Error("Localization defaults must stay inside the selected mod");
  }
}

/** A draft stays in the picker until Save; existing dirty JSON is the source. */
export async function configureLocalizationDefaults(cfg: PxConfig): Promise<void> {
  if (!cfg.modPath) {
    void vscode.window.showInformationMessage(
      "Choose a workspace mod before configuring localization defaults."
    );
    return;
  }
  try {
    const prepared = await prepareProjectConfigWrite(cfg.modPath, metaFor(cfg.gameId), "localization.json");
    const file = prepared.target;
    assertDefaultsPath(cfg, file);
    const raw = prepared.text ? JSON.parse(prepared.text.replace(/^\uFEFF/, "")) : {};
    const defaults = parseLocalizationDefaults(raw);
    const name = readModName(cfg.modPath);
    const title = `Localization defaults: ${name}`;
    const root = localizationRoots(cfg)[0];
    type Field = keyof LocalizationDefaults | "save";
    while (true) {
      const selected = await vscode.window.showQuickPick<{
        label: string;
        description: string;
        field: Field;
      }>(
        [
          {
            label: "Language",
            description: defaults.language || `Auto (${cfg.locLanguage})`,
            field: "language",
          },
          {
            label: "New key file",
            description: defaults.newKeyFile || "Auto (related keys and mod layout)",
            field: "newKeyFile",
          },
          {
            label: "Override file",
            description: defaults.overrideFile || "Auto (mod replace folder)",
            field: "overrideFile",
          },
          {
            label: "Entry version",
            description: defaults.entryVersion ?? "preserve (follow nearby entries)",
            field: "entryVersion",
          },
          { label: "Save defaults", description: ".px-toolkit/localization.json", field: "save" },
        ],
        { title, placeHolder: "Choose a setting. Empty file paths restore automatic detection." }
      );
      if (!selected) return;
      const field = selected.field;
      if (field === "save") {
        assertDefaultsPath(cfg, file);
        const merged = { ...raw };
        for (const key of ["language", "newKeyFile", "overrideFile", "entryVersion"] as const) {
          if (defaults[key] === undefined) delete merged[key];
          else merged[key] = defaults[key];
        }
        parseLocalizationDefaults(merged);
        await prepared.write(`${JSON.stringify(merged, null, 2)}\n`);
        void vscode.window.showInformationMessage(`Saved localization defaults for ${name}.`);
        return;
      }
      let value: string | undefined;
      if (field === "language") {
        const selectedLanguage = await vscode.window.showQuickPick(
          [
            { label: "Auto", description: `Use the workspace language (${cfg.locLanguage})`, value: "" },
            ...LOC_LANGUAGES.map((language) => ({ label: language, description: "", value: language })),
            { label: "Other language", description: "Enter a language identifier", value: "other" },
          ],
          { title, placeHolder: `Language: ${defaults.language || "Auto"}` }
        );
        if (!selectedLanguage) continue;
        value = selectedLanguage.value;
        if (value === "other")
          value = await vscode.window.showInputBox({
            title,
            prompt: "Language identifier, for example english",
            value: defaults.language ?? "",
            validateInput: (input) => validateSetting(defaults, field, input),
          });
      } else if (field === "entryVersion") {
        const selectedVersion = await vscode.window.showQuickPick(
          [
            {
              label: "Preserve",
              description: "Follow nearby entries; use no number in a new file",
              value: "preserve",
            },
            { label: "None", description: 'Write new entries as key: "value"', value: "none" },
            { label: "Zero", description: 'Write new entries as key:0 "value"', value: "zero" },
          ],
          { title, placeHolder: "Existing entry versions are preserved." }
        );
        value = selectedVersion?.value;
      } else {
        const language = defaults.language || cfg.locLanguage;
        const example = `${root}/${field === "overrideFile" ? "replace/" : ""}${language}/my_script_l_${language}.yml`;
        value = await vscode.window.showInputBox({
          title,
          prompt: `Relative path in ${name}. Example: ${example}. Templates: {language}, {source}, {subject}. Leave empty for Auto.`,
          value: defaults[field] ?? "",
          validateInput: (input) => {
            const invalid = validateSetting(defaults, field, input);
            if (invalid) return invalid;
            if (input && !localizationRoots(cfg).some((folder) => input.startsWith(`${folder}/`)))
              return "Choose a path in one of the mod's localization folders.";
            return undefined;
          },
        });
      }
      if (value === undefined) continue;
      if (value === "") delete defaults[field];
      else Object.assign(defaults, parseLocalizationDefaults({ [field]: value }));
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not save localization defaults: ${String(error)}`);
  }
}
