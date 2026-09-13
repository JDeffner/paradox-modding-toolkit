# Explore the Paradox sidebar

Click the Paradox icon in the Activity Bar. The **Project** view shows your workspace mods, effective paths and the tools available for the active game.

- **Workspace Mods** controls which mods are indexed and which mod the views focus on.
- **Paths** shows the game, dump and mod folders actually in use, including detected paths that are not saved in settings.
- **Create** offers content scaffolds and the visual creators supported by your game.
- **Test & Troubleshoot** holds the available validation tools. Use the editor's Run button or **Run and Debug** to launch the game.

The other views cover content inventory, problems, localization coverage, overrides and dependencies. **Show Event Graph** opens event flow; **Show Mod Report** gathers the mod checks into one page.

For setup and the source of each loaded dump set, click **PX Toolkit** in the status bar.

**Compatch Workspace** opens from Project or the command palette. Choose **Update a mod for a new game version**, then select your original Git-tracked **Mod**, **New Game Version** and previous **Vanilla** folders. The picker offers known project, mod and game folders. The three folder rows let you search their scanned text files. All updates go into your original mod.

The work list excludes mod-only files, new-game-only files, and files unchanged between Vanilla and New Game Version. Select a file to compare the new game on the left with your editable mod on the right. Row actions show **Vanilla to New Game Version**, **Vanilla to Mod**, and a three-way merge preview. **Apply Clean Game Changes** saves non-overlapping changes to the mod. If changes conflict, it opens a proposal and leaves the mod untouched. Review edits in Source Control; nothing commits them automatically. Refresh after manual edits. A clean text merge still needs gameplay validation.

A mod can supply `.px-toolkit/compatch.json` with `{"version":1,"vanilla":"../Vanilla","newGame":"../New Game Version"}`. Paths resolve from the mod folder. Opening Compatch uses this preset when there is no saved session.

CK3 events also match by ID across files; localization matches by language and key. Victoria 3 and EU5 offer file comparisons only. **Compare two sources into a separate result** retains the manual mod-to-mod workflow described below.

Select a Compatch row to compare read-only sources. Its action button opens full source files, compares a source with an editable result, and records reviews. For existing filenames, choose **Choose existing result file**. Event creation copies the full source file at its original relative path. Localization creation checks the installed game's keys, routes vanilla overrides to `localization/replace`, and puts new keys in ordinary localization. An existing result is opened without overwriting it; copy the changes you want in the diff editor. Add the result mod to your workspace for the usual language features, and configure its parent mods and playset before testing it.

Localization uses the workspace language by default. **Choose Compatch Localization Language** switches languages and rescans; saved reviews for other languages stay available when you switch back. Lists show 200 entries per page. Use **Filter Compatch Entries** to find an ID, key, path or status. **Show Compatch Scan Notes** lists source paths, parse issues, skipped links, files over 8 MiB and files that are not UTF-8 text. One review session is saved per VS Code workspace.

**Mark reviewed** and **Skip for now** save source snapshots. Use **Refresh Compatch Sources** after saving source edits or updating a mod. Changed sources reopen the review; **Compare last reviewed** shows what changed. Your result files stay intact. These are text comparisons, not proof of gameplay compatibility or load-order resolution. A missing entry is not an instruction to delete it. Single-event override generation and GUI template matching are not included yet.
