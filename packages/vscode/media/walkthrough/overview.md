# The Paradox sidebar

Click the Paradox icon in the Activity Bar. The **Project** view at the top shows what the extension sees and what it is doing:

- **Workspace Mods** — every detected mod, with a switch to include or exclude it from indexing, and a dot to pin the views below to one mod
- **Toggles** — the tiger baseline filter, the error.log watcher, vanilla diagnostics and scope inlay hints
- **Tools** — launchers for content scaffolds, translation, images, reports, and the game itself
- **Create** lists the visual creators the active game has: Trait, Dynasty Legacy, Culture, Tradition, Dynasty Tree and the Coat of Arms Designer. Each one is a form over the game's own keys, and it writes the definition and its localization into your mod.

Below it, collapsed until you need them:

- **Mod Overview** — content inventory by kind, with counts
- **Problems by Type** — diagnostics grouped by code instead of by file
- **Localization Coverage** — per language: missing, orphaned, untranslated
- **Overrides & Conflicts** — what shadows vanilla (and who wins)
- **Dependencies** — impact view for the definition at the cursor

**Show Mod Report** (the checklist button above the Mod Overview list) collects all of it into one page.

**Compatch Workspace** opens from Project or the command palette. Choose source A, source B, an optional common base, and a separate result mod folder. CK3 events match by ID across files; localization matches by language and key across ordinary and replace folders. Other content uses relative file paths. Victoria 3 and EU5 currently offer file comparisons only.

Select a Compatch row to compare read-only sources. Its action button opens full source files, compares a source with an editable result, and records reviews. For existing filenames, choose **Choose existing result file**. Event creation copies the full source file at its original relative path. Localization creation checks the installed game's keys, routes vanilla overrides to `localization/replace`, and puts new keys in ordinary localization. An existing result is opened without overwriting it; copy the changes you want in the diff editor. Add the result mod to your workspace for the usual language features, and configure its parent mods and playset before testing it.

Localization uses the workspace language by default. **Choose Compatch Localization Language** switches languages and rescans; saved reviews for other languages stay available when you switch back. Lists show 200 entries per page. Use **Filter Compatch Entries** to find an ID, key, path or status. **Show Compatch Scan Notes** lists source paths, parse issues, skipped links, files over 8 MiB and files that are not UTF-8 text. One review session is saved per VS Code workspace.

**Mark reviewed** and **Skip for now** save source snapshots. Use **Refresh Compatch Sources** after saving source edits or updating a mod. Changed sources reopen the review; **Compare last reviewed** shows what changed. Your result files stay intact. These are text comparisons, not proof of gameplay compatibility or load-order resolution. A missing entry is not an instruction to delete it. Single-event override generation and GUI template matching are not included yet.
