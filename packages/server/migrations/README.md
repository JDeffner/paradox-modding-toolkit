# Write a compatibility note or migration recipe

Contributions describe one change between two exact game builds. A compatibility note explains manual work; a recipe can also propose edits. The Mod Compatibility panel groups all contributions for each version transition and runs a selected route one step at a time. A connected route does not establish that its contributions cover every game change.

One recipe can inspect and change many mod files. You can also load several contribution files as a library. These are separate choices: `inputs` controls which mod and reference files a recipe can read; **Load files…** and **Load folder…** add recipes and notes to the toolkit.

## Start in the editor

1. Enable `px.experimentalFeatures` and run **Paradox: Mod Compatibility**.
2. Choose **Create an entry…**. Choose **Compatibility note** for manual guidance without code, or **Migration recipe** for a working JavaScript folder example.
3. Save the file and read its opening instructions. Use a scratch mod for the example. Its `1.0` to `2.0` builds are illustrative and do not describe a real game update.
4. Use **Load files…** to select your contribution. Select the same game builds and choose **Find route**. For a recipe, choose **Use migration**, answer its question, then **Review changes**. Check each diff before **Apply migration**.

The generated `.cjs` recipe works without a build command or additional packages. To turn it into your own contribution, give it a unique `id`, exact source and target builds, researched evidence and declared `inputs`. Adapt `inspect` to report affected content and unanswered decisions. Adapt `prepare` to return the proposed edits. Test affected, unaffected and unsupported files before sharing it.

The source examples are [a JSON compatibility note](../examples/migrations/example-advisory.json), [a folder recipe](../examples/migrations/folderExample.ts) and [a single-file recipe](../examples/migrations/authorExample.ts). They demonstrate the author contract and make no claim about a real game transition.

## Load a library

**Load files…** accepts several `.json`, `.cjs` or `.js` files at once. **Load folder…** finds those files in the selected folders and their subfolders, then shows a checklist. Leave only contribution files selected. Deselect package metadata, helper scripts and test files. Folder discovery does not execute code. Linked subfolders, `.git`, `node_modules` and `.px-toolkit` are excluded; an oversized scan stops with an error instead of silently dropping files. Overlapping selections load each file once. You can also select files or folders in Explorer and use **PX: Load Compatibility Files** or **PX: Load Compatibility Folder**.

The toolkit requests one trust decision for the selected JavaScript files. JSON notes do not run code. All selected contributions must load successfully and have unique IDs before the library changes. An invalid file leaves the previous library in place and identifies the failed file. Dependencies may refer to contributions in other selected files. Loading a folder takes a snapshot of the selected files; it does not watch that folder for new contributions.

## Choose the contribution type

A data-only `.json` artifact contains `{ "manifest": { ... } }` or an array of these entries. The host validates and displays its text without evaluating author code. Use `kind: "advisory"`, `detection: "none"`, no functions, and empty `inputs` when the note needs no files. Write concrete manual instructions in `guidance`, identify the evidence, and state what remains unchecked in `limitations`. Do not write empty inspection or preparation functions to present a static note.

An advisory with a detector uses `kind: "advisory"`, `detection: "script"`, and `inspect(context, answers)`. It may identify affected files and ask for decisions. It has no `prepare` function. Recording decisions does not perform the manual conversion.

A recipe uses `kind: "recipe"`, `detection: "script"`, `inspect`, and `prepare`. It must produce edits supported by its source and target evidence. Use `requirement: "required"` for work that must be resolved before dependent steps; use `informational` for a note that can be marked read. Manual resolution records the user's report. It is not target-game verification.

## Manifest and version routes

Every manifest declares:

| Field | Contract |
| --- | --- |
| `id`, `revision`, `sdkVersion` | Stable contribution ID, independent author revision, and SDK version `1` or `2`. Use version 2 for selective capture. Increase `revision` when content or behavior changes. |
| `gameId`, `fromVersion`, `toVersion` | One game and two exact build identifiers. `revision` is not a game version. Build identifiers have two to four numeric components, without leading zeros. Ranges and inferred forward or downgrade support are not accepted. |
| `kind`, `detection`, `requirement` | Advisory or recipe, no detector or script detector, required work or informational guidance. |
| `title`, `description`, `guidance` | The affected subject, change summary, and concrete instructions in plain text. |
| `evidence`, `limitations` | References that establish the change, with unchecked or unsupported cases stated explicitly. |
| `dependsOn` | Contribution IDs that must precede this entry. These can identify work on an earlier transition. |
| `inputs` | Root-relative file or directory prefixes exposed to the contribution. A prefix is not a glob. |

The planner groups every registered contribution for a `fromVersion` to `toVersion` edge. It orders prerequisites before consumers and reports missing dependencies and cycles. A multi-step route includes all entries on each chosen edge. `planMigrationRoutes` returns `{ versions, routes, issues }` and enumerates directed routes without revisiting a version. It does not select a shortest route. It reports incomplete enumeration if it reaches 128 accepted alternatives or 10,000 search steps. When distinct routes exist, the user selects one explicitly. A missing transition is a route gap, not permission to skip a build or claim compatibility. Each real-game contribution needs researched evidence; authors must list coverage limits even when the graph connects the requested builds.

## Trusted local code

Loading self-contained `.cjs` or `.js` code requires workspace trust and an explicit **Trust and load** decision. It runs JavaScript with the host's permissions. The context limits exposed inputs, but worker cancellation and termination do not sandbox author code. Use context reads and return proposals. Direct filesystem writes bypass preview and preservation checks. Changed code requires a new load and trust decision. JSON notes do not need executable-code trust.

JavaScript can export one contribution or an array. Bundle dependencies into the artifact before sharing it. The public package entries are:

| Import | Use |
| --- | --- |
| `@px-lsp/server/migrations` | `defineMigration`, `defineAdvisory`, entry types, context, snapshot, changes and prepared plans |
| `@px-lsp/server/migrations/testing` | `createMigrationSnapshot`, `runMigrationFixture` and `assertMigrationIdempotent` |
| `@px-lsp/server/migrations/engine` | Snapshot inspection, preparation and contribution validation |
| `@px-lsp/server/migrations/routes` | `planMigrationRoutes(catalog, gameId, fromVersion, toVersion)` |

The SDK has no filesystem or VS Code runtime dependency. The engine and testing exports are compiled JavaScript. Authors do not need to execute package TypeScript sources.

## Try and test the folder recipe

In a toolkit checkout, build the public exports and run the example's tests:

```powershell
pnpm --filter @px-lsp/server run compile:migrations
node --test packages/server/examples/migrations/authorExample.test.mjs
```

The editor's recipe template uses the scratch workspace's game. Create `migration-demo/first.txt` and `migration-demo/nested/second.txt` under that mod, each containing:

```text
# px migration author example: example_value
demo_old = previous_value
```

Inspection asks once for `example_value`, which accepts only letters, digits and underscores. Preparation renames `demo_old` to `demo_new` in both files and inserts that value while preserving other content, comments, BOM and line endings. A repeated inspection is `not-applicable`. The folder example ignores unmarked files and blocks unsupported marked fields or unreadable text with a finding. The single-file example also reports unmarked content because its exact input file is expected to contain the fixture.

Enable `px.experimentalFeatures`, open **Mod Compatibility** with `px.openMigrations`, and choose the scratch mod and illustrative `1.0` to `2.0` builds, then select **Find route**. Load the example, review its code, then select **Trust and load**. **Use migration** inspects it. Answer the question, choose **Review changes**, inspect the exact diff, then choose **Apply migration**. The host applies one reviewed step before inspecting the next, so later steps read earlier file changes.

For a static note, load the JSON example instead. Read its guidance and do the work manually. **Record manual resolution** saves a note about that work. An informational note uses **Mark read**. A detector advisory offers **Check mod**. After recipe inspection, **Record manual resolution** is also available when the result is unknown or automatic changes cannot complete the work. Record the changes and checks you performed yourself; this does not turn the recipe result into automatic verification. Required manual work and missing human decisions pause the route; they do not produce an empty edit plan that pretends to finish the migration.

Choose read-only game-data references for each concrete build when a step declares `source` or `target` inputs, including intermediate builds. Old-game data is optional for entries with no `source` inputs. The saved session retains the selected route, answers and per-entry completion notes. After reopening, use **Refresh note** for saved JSON notes; no executable-code trust is needed. Local executable artifacts must be reloaded and trusted again. Route progress is checked against the selected route, catalog and artifact identities plus the declared inputs of completed entries. Selecting a missing future reference or editing inputs used only by future entries preserves completed progress. Changed completed-entry inputs reopen the route for review. Restore applied steps in reverse order; journal recovery rejects later edits instead of overwriting them.

## Inspection and preparation

`mod` is writable. `source` and `target` are read-only. `context.list`, `readText` and `readBytes` expose declared inputs. `readText` returns `undefined` for a missing, undeclared or non-UTF-8 file. Use `context.list` to distinguish an absent file from listed content that cannot be read as text, and report unreadable content instead of treating it as unaffected. Text reads preserve the BOM. Text edits use UTF-16 offsets into the exact captured text, including its BOM.

Declare several files or folders in `inputs`, using forward slashes:

```typescript
inputs: [
  { root: "mod", path: "migration-demo" },
  { root: "mod", path: "another-example.txt" },
  { root: "target", path: "reference-data" },
]
```

`context.list("mod", "migration-demo")` returns sorted paths inside that folder, including nested files. It does not include `migration-demo-other`. A directory input is recursive; use `path: ""` only when the contribution needs an entire root. Inputs are paths, not glob patterns. Filter the returned paths inside the recipe, read each file, and return several changes in one group when they must be applied together.

SDK 2 can survey large asset folders without reading every file in full. Each input can specify literal `extensions`, `capture: "listing"` for names and sizes, or `capture: "prefix"` with `prefixBytes` for a fixed header. `capture: "bytes"` is the default. On reference inputs, `matchModFiles: true` selects only paths also present in declared mod inputs. `context.fileInfo(root, path)` returns the full file size, even when only its header was captured.

An optional `discover(context, answers)` returns exact `{ root, path }` requests from declared listing or prefix inputs. The host captures those full files and freezes the selection with the plan. Apply and recovery use that captured selection without rerunning author code. Current limits are 128 MiB each for captured input and proposed output, 32 MiB per full file, 10,000 full files and 100,000 listing entries. Oversized batches fail explicitly. Return `continuation: true` when a batch leaves work in the same recipe; applying it keeps that recipe open. Selecting only some change groups also prevents premature completion.

`inspect(context, answers)` returns applicability, findings, questions and coverage. Use `not-applicable` for no affected content and `unknown` for insufficient evidence. Coverage identifies cases not inspected; it is not a compatibility percentage. Questions have stable IDs and text, choice or boolean values. The host reconciles answers and blocks preparation if required values are missing or invalid. Validate domain-specific text rules and report errors. An answer does not establish correctness.

Use a question's optional `group` to collect related choices under a faith, file or other useful label. The editor provides searchable choice lists and a filter for longer forms. Keep question IDs stable across repeated inspection so saved answers still refer to the same decision.

`prepare(context, answers)` returns groups, unresolved findings and checks. Groups contain `text`, `create`, `replace` or `delete` changes against the mod. Text changes contain `{ start, end, text }`. Keep related edits together and use group `dependsOn` for edits that cannot stand alone. Group dependencies and manifest entry dependencies are separate contracts.

Required `before-apply` checks must pass before a plan is prepared. A check records work actually done; it does not instruct the engine to run a validator. Use `not-run` when a check has not run. Target Tiger or game validation needs a host integration or an explicit author workflow with observed results.

## Use the engine outside the editor

```typescript
import { inspectMigration, prepareMigration } from "@px-lsp/server/migrations/engine";
import { createMigrationSnapshot } from "@px-lsp/server/migrations/testing";
import recipe from "./authorExample";

const snapshot = createMigrationSnapshot({
  gameId: "ck3",
  mod: {
    "migration-demo.txt": "# px migration author example: example_value\ndemo_old = previous_value\n",
  },
});
const result = await inspectMigration(recipe, snapshot, {});
const plan = await prepareMigration(recipe, snapshot, { example_value: "chosen_value" }, "reviewed-code-hash");
```

Inspection also returns reconciled answers, `invalidAnswers` and `missingAnswers`. Preparation returns exact before/after bytes, snapshot and code hashes, answers, selected groups and a plan hash. Its optional fifth argument selects groups and includes their prerequisites. The code hash above is an illustrative fixture label; a real host hashes the loaded artifact bytes.

An embedder owns capture, route progress, preview, apply and recovery. Apply frozen bytes without rerunning author code. Verify the plan hash, loaded artifact, captured roots, file bytes and current documents before writing. Reject stale previews. Applying saves touched open documents, including reviewed unsaved content. Their save encoding must match the expected UTF-8 or UTF-8-with-BOM output. Preserve unrelated content, keep references read-only, and report write failures.

`captureMigration` accepts an optional `AbortSignal` in its options. `assertMigrationFresh` accepts an optional final signal argument. Pass the host's cancellation signal so reference-file scans can stop before the recipe runs. Cancellation does not restore changes that were already applied; use the recovery journal for that.

## Test before sharing

`runMigrationFixture({ recipe, snapshot, answers })` prepares and applies in memory without changing the input snapshot. `assertMigrationIdempotent` also checks a second run, which must be inapplicable or produce no changed files.

Test supported output, unrelated content, missing and invalid answers, unsupported inputs, already converted files, read-only references, repeated runs and group dependencies. Test each sequence through its real host: the next inspection must see the previous apply, manual prerequisites must pause it, changed files and unsaved documents must invalidate a preview, failures must remain failures, and restoration must preserve later edits. A synthetic sequence verifies those mechanics only.

A real contribution needs independently recorded source and target builds, relevant game files or generated documentation, and validation against the target consumer. Keep synthetic fixtures separate from game evidence. Parser success does not prove the game can use the output. Share the contribution, evidence, fixtures, observed validator or game results, and unsupported cases in a pull request for domain review.

## Current library and limits

The CK3 faith-and-rite recipes target the exact `1.19.0.6` to `1.20.0.2` and `1.20.0.3` transitions and convert supported nested definitions into religion, faith and rite files. They ask which communities stay independent, which become rites, their parents, holy-site roles and ambiguous reference intent. They handle supported inheritance, tenets, static references, character/province history and needed icon copies. Dynamic or unsupported reference forms, conflicting history and missing dependencies block automatic application. Review each finding; this is not a save-game converter. Source evidence includes the archived game data labelled `1.19.0.6`; target structure is checked against installed documentation. The Lantern faith and mask fixture passed bounded gameplay checks on `1.20.0.3`, including faith creation, custom tenets, county conversion, holy-site tiers, localization precedence, mask changes and save/reload. Its clothes-gene merge and accessory-registration checks were separate manual work. This does not establish arbitrary mod or save compatibility.

The portrait/clothing mask recipe follows `pattern_mask` and `colormask` consumers. It uses an exact target mip count only when path, dimensions, format, resource type and consumer classes match. Custom masks require an explicit policy or a reason to keep their levels. Counts include the base image. Truncation preserves retained pixels; generating missing levels supports only the implemented channel-preserving formats and rejects unsupported cases. Header surveys and selected batches keep large mods within capture limits. The metadata review shows before/after dimensions, formats and levels.

Victoria 3 and EU5 have no built-ins. No Crozier-compatible Tiger validator was available in the tested environment. Automated target-game validation and dependency load-order composition remain outside this workflow. Routes connect declared contributions only. A successful route, inspection, manual report or preview does not establish whole-mod compatibility. The SDK remains work in progress pending an [independent author and target-game trial](https://github.com/JDeffner/paradox-modding-toolkit/issues/82).
