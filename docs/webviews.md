# Webview panels: how they are built, and how to add one

Every visual tool in the extension is a webview panel: the Project dashboard,
the event graph, the event simulator, the GUI editor, the Flag Builder, the
Workshop panel, the Examples Wiki. They all follow one pattern, and the build
discovers them by folder name, so adding a panel means adding a folder, not
editing build scripts.

Read this next to a working example. **`packages/vscode/src/webviews/exampleWiki/`
is the reference implementation**: a search list, a detail pane, one server
request in each direction, about 600 lines in total. The GUI editor is the
deep end; its [README](../packages/vscode/src/webviews/guiEditor/README.md)
documents the host contract idea in full.

## The pattern

The Wiki hub's **Launch Options** page reads the installed game's documentation through `GameMeta.launchOptionsFile`. CK3 uses `_commandline_options.info` in its game data directory. Victoria 3 and EU5 show an unsupported-source message until a source is verified for their profiles. The reader preserves the file's headings, descriptions, warnings and option syntax. It does not bundle a copy or run any launch option.

The page uses the current workspace's resolved game path, or Steam detection for another game selected in the Wiki. Installation-root paths are resolved to their game data directory. Opening the page or revealing the panel reads the file again. A file watcher refreshes changed, created or deleted sources; settings and workspace changes replace the watched path. Updates preserve the selected Wiki game, page and search. Missing paths, missing files and read failures replace old content with an explanation. The page shows the source file and its modification time. The existing Wiki command and Project-panel entry open this page through its hub card or contents row.

Before mod detection, PX shows the native `px.welcome` tree with Start Here content contributed through `viewsWelcome`. Its Create a Mod, Find Existing Mod and tutorial commands stay available outside mod workspaces. The tree is empty by design; it does not start discovery or index the game. Once `px.isCk3Workspace` becomes true, the normal Project views replace it. `onboarding.ts` opens the native walkthrough and finds local mods on request. Create and Find Existing Mod share a destination picker in `modProjects/open.ts`: add to the current workspace or open a separate window. Cancelling does not change windows or remove a newly created mod. Workspace additions share duplicate-folder checks with the Project header action; `modProjects/discover.ts` reads known user/project folders and launcher links without a recursive disk scan. The walkthrough uses readiness contexts from `dataHealth.ts`, with editing readiness separate from optional validator readiness. Each step also offers `px.readTutorialStep`, which opens the same packaged Markdown in a native preview because narrow walkthrough layouts hide the media pane. Only known step names are accepted. Update its command links and packaged Markdown together when changing the flow.

`px.addModToWorkspace` first asks for Documents, configured projects, Steam Workshop or the base game. It uses the active game profile, scans known containers and follows launcher links. Workshop copies are included only for the explicit Workshop source. It adds one folder through `updateWorkspaceFolders`, rejects duplicate content roots (including project and junction aliases), and reports failed additions. The welcome finder (`px.openMod`) retains its separate-window behavior.

The illustrated VS Code setup guide lives in the GitHub wiki. It is not bundled with the extension and has no dedicated command or webview.

After `pnpm run package:test`, run `node scripts/test-editor-improvements.mjs "<Code executable>"` to check the packaged sidebar, view movement, direct DDS context actions, image conversion, BBCode preview and encoding fixes. The runner uses disposable user data and extensions under `.local/testing/`, with the PXTK Development profile. It saves screenshots and a result file beside the test workspace.

The sidebar uses four webview views in `dashboard/view.ts`. Project (`px.tools`) holds the game and focus summary, Workspace Mods, View, Create, Publish, Info and Settings in one scrolling body. Its internal groups collapse to their content height, and `getState`/`setState` preserve their expansion state. Utils, Test & Troubleshoot and Paths each retain a separate view ID and contextual title so users can move them. VS Code owns the outer views' position, visibility and size. The shared action catalogue applies the active game profile and `px.sidebar.hidden`; the bodies retain the existing SVG icons. Workspace Mods has New Mod (+) and Add Existing Mod (folder) buttons in its heading. Focus selection uses a child dot separate from the tooltip pseudo-element. All Tools uses a package icon in the title; Customize the Project panel rows is in the overflow menu and only lists View, Create, Publish and Info actions.

These four webviews start in PX. The five native tree views in `views.ts` start in Explorer: Mod Overview and Localization Coverage are collapsed, while Problems by Type, Overrides & Conflicts and Dependencies are hidden until opened. The dependencies command reveals its view after loading the selected definition. Existing view IDs remain stable so VS Code retains custom placements.

Workspace Mods has no three-mod limit. Its heading shows the total count, while the list keeps a bounded height and scrolls independently. The list is keyboard-focusable, uses the theme's scrollbar colors, and preserves its scroll position when pinning or indexing changes refresh the rows. All discovered workspace mods remain available below the visible rows.

VS Code controls the outer pane heights and saves manual resizing. Extension tree views cannot request a height based on their row count. The [`initialSize` contribution](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts) applies only when the same extension owns both the view and its container, so it cannot set heights in Explorer. Users can drag the horizontal dividers to keep expanded sections compact.

Project's Settings group contains scope inlay hints (`px.scopeInlayHints`), suggestion verbosity (`px.completion.mode`) and hover detail (`px.hover.detail`). The choice rows show the current values and open native Quick Picks with descriptions. Changes update an existing workspace override, or user settings when there is no workspace override. The host reports save failures and refreshes the displayed values. All settings opens the Toolkit Settings tab. Scope hints stay off by default and show inferred scope types without changing source text. The first-mod tutorial action (`px.startFirstMod`) turns them on before opening New Mod; the normal creation action keeps the current preference. Suggestion verbosity controls what accepting a keyword inserts: its name, minimal fields or full documented examples. The group starts collapsed and remembers its expansion state.

### Compatibility Patch

`compatch/patches.ts` owns the experimental maintained-patch panel, with `webviews/patches/` providing the themed client. `px.openCompatibilityPatch(uri?)` opens it from the Project actions or command palette; a local output URI is optional. Source folder selection supports multiple mods, stable IDs and explicit order. The paged review queue separates changed decisions, saved intent and identical overlaps. Read-only source snapshots, complete contributions, supported field choices and manual results lead to **Build patch**, file diffs and **Apply patch**. Manual work stays visible. The client preserves field, note and manual-text drafts across status updates. Cancellation is available during source capture and build, while apply and recovery complete through their journal.

Portable decisions and pure generated baselines live in `.px-toolkit/compatibility.json`; local paths use private machine bindings. The host shares the migration editor adapter and frozen-file transaction writer. It reads current buffers, checks inputs again before writes, uses the common localization policy, preserves independent manual output edits and rejects stale plans. Incomplete recovery blocks further changes. The source analysis runs behind `GameMeta.compatchComposition`; unsupported games do not advertise the action. There is no LSP or browser-service entry point.

### Mod Compatibility

`compatch/migrations.ts` owns the experimental Mod Compatibility panel; `webviews/compatch/html.ts` renders escaped state with nonce-protected script and styles. The webview never executes author artifacts. `px.openMigrations` opens it. **Load files…** (`px.loadMigrationRecipe`) accepts several local contributions; **Load folder…** (`px.loadMigrationFolder`) discovers nested candidates and opens a file checklist. Both commands accept an optional URI and Explorer URI selection. Discovery never executes code. A batch uses one trust decision for its JavaScript files and updates the library only after every selected contribution loads and IDs pass validation. **Create an entry…** generates a JSON note or a self-contained folder recipe with synthetic instructions. Entry points require `px.experimentalFeatures`.

The panel selects a mod and exact source/target builds, uses **Find route** to show explicit route alternatives or gaps, and lists every compatibility note and recipe on each selected transition in prerequisite order. Notes display guidance, evidence and limitations even without detection. **Check mod** runs an advisory detector, **Record manual resolution** records required manual work, and **Mark read** acknowledges informational guidance. A manual note is a report from the user, not verification.

**Use migration** starts recipe inspection and questions. After inspection, a recipe also offers **Record manual resolution** when automatic edits cannot complete the work, including unknown applicability. This records the user's work and checks, not automatic verification. **Review changes** prepares a frozen diff; **Apply migration** applies it after freshness checks. Each later inspection captures the result of previous applied steps. Unanswered decisions and required manual work pause progress. Version-2 sessions retain the route, per-entry answers and completion notes, and explicitly chosen reference folders for exact builds. Intermediate edges can require intermediate references. Progress fingerprints cover route, catalog and artifact identities plus completed entries' declared inputs. Selecting missing future references or editing future-only inputs preserves completed progress; changes to completed inputs reopen the route.

The host reads current files and unsaved mod documents and runs trusted detectors or recipes in packaged `migrationWorker.js`. JSON notes are validated data and do not execute code. After reopening, saved notes offer **Refresh note**, while saved executable artifacts require reload and trust. Local JavaScript requires explicit trust and can export one entry or an array; worker cancellation and time limits do not sandbox it. Apply checks code, roots, inputs and documents. Mismatched UTF-8/BOM save encoding requires a new preview after correction. Cancel is available during capture and preparation. Once journaled Apply or Restore writes begin, the panel removes Cancel and finishes recovery and route bookkeeping even if the panel closes. Journal recovery restores applied steps in reverse order and preserves later edits. To remove a newly generated file that is open and unchanged, recovery asks the user to close it and retry Restore.

No new LSP methods are involved. CK3 has faith/rite and portrait/clothing mask recipes with grouped searchable choices and DDS metadata review; the other profiles have no built-ins. SDK 2 surveys headers and listings before capturing selected files, and continuation batches keep remaining work open. The [author guide](../packages/server/migrations/README.md) describes the SDK, fixtures and supported cases. No Crozier-compatible Tiger validator is available. Target-game validation and dependency load-order composition remain outside the workflow. Route completion does not establish whole-mod compatibility.

### Toolkit Settings

Settings uses the shared `menu()` component for mod context, per-row save destinations, sorting, filtering and enum settings. Native `<select>` controls are not used because their popup colors can differ from the webview theme.

`px.openSettings` opens the singleton `settings/` webview from the Project panel, command palette, setup flow and walkthrough. All settings is the default view. A stable catalogue uses compact rows with labels for save destination and active value source. Search, categories, the **Settings for** context selector, filters and sorting stay above the scrolling rows. Choosing another mod changes the values being explained, without changing the working focus mod or hiding parts of the catalogue. An optional setting key reveals that setting even when another filter was active. `px.openNativeSettings` retains access to the native settings editor. The panel reads types, defaults and help from the installed extension's configuration contributions. Storage follows the setting: shared mod rules use `project.json`, personal paths use User `px.machinePaths`, and editor preferences use native configuration.

Each row has its own valid save destinations, available under **Details**. The mod-projects folder applies to new-project creation and offers personal defaults and workspace bindings; it has no per-mod destination. Shared rules default to the selected mod; private paths and native preferences use their active binding when present. A broader destination can be edited explicitly, while the row continues to show the value active for the selected mod. Removing an override names its destination and shows the inherited result when available. Toggles and choices save immediately; text, lists, paths and calendar JSON use an explicit Save button. Browsing fills a draft. Drafts remain separate for each context, destination and setting, including when an earlier save reply arrives. **Save all drafts** applies editable drafts in the selected context. Changes to the same project file or private path registry are validated and saved together, so one saved draft does not invalidate another. Each destination reports its own success or failure; the batch does not promise rollback across separate stores. A question-mark button shows brief help on hover or keyboard focus and never expands the row. **Details** exposes the full explanation, destination choices and storage information without a second help accordion.

The host validates setting keys, values, context-specific destinations and action commands. Native preference and User registry writes use `WorkspaceConfiguration.update`; shared writes preserve unknown project fields and use the current editor document. Each request carries its context, destination and storage snapshot; a changed value rejects the save and retains the draft. Failed writes show an error instead of success. Configuration, workspace and project-file changes refresh the page without replacing drafts. Game availability comes from the active profile; Tiger, character history and coat-of-arms settings remain visible with an explanation where unsupported. Path status reports file or directory presence, not game or validator execution. Actions that operate on the current workspace say so. **Upgrade Toolkit Settings** (`px.migrateToolkitStorage`) uses the same operation as trusted startup, with details in [Shared rules and personal paths](EMBEDDING.md#shared-rules-and-personal-paths).

After packaging, run `node scripts/test-settings-vscode.mjs "<Code executable>"` to exercise the settings tab in an isolated PXTK Development host. `node scripts/test-storage-vscode.mjs "<Code executable>"` also covers storage upgrades, shared and private destinations, the stable catalogue across mods, and question-mark tooltip behavior. Both keep generated projects and rendered evidence under `.local/testing/`.

Utils exposes `px.convertImages`, `px.convertToDds`, `px.convertDdsToImage` and the existing BBCode converters. Explorer conversion commands accept the clicked resource and multi-selection. Folder conversion can include subfolders; an output folder retains their relative paths. Commands without a resource open a multi-file picker directly. Each batch selects one format; it asks for a collision policy in a non-modal notification only when an existing output is encountered. The chosen skip or overwrite policy applies to the rest of that batch. Dismissing the notification stops the batch and keeps any outputs already completed. JPEG uses an explicit white or black background. PNG and WebP preserve transparency. Existing outputs are never overwritten without an explicit choice. Inputs and duplicate output targets are protected even with overwrite enabled. Progress is cancellable between files and while waiting for Chromium. Errors name the failed files.

`imageCodec.ts` uses the existing DDS decoder and DDS/PNG encoders. Chromium supplies other image codecs through a temporary webview with a ready handshake. DDS export converts the surface shown by the DDS preview, not every mipmap or cubemap face. Animated source formats produce a single image. `imageBatch.ts` handles enumeration and publication separately, so collisions, failures and cancellation can be tested with real files outside the editor.

The DDS viewer selects stored mip levels through the shared `px-dropdown` and `menu()` control. It shows the level and dimensions, filters long chains, supports keyboard selection, and disables the picker for base-only files. A failed decode restores the displayed level in the picker; PNG export stays disabled while a new level loads.

The viewer also reports declared mipmaps independently of pixel decoding. A valid header shows whether additional levels exist and the total count including the base. Unsupported formats and images above the decode budget retain that metadata. Invalid or truncated headers show an unknown state.

### Legacy Workshop listings

The Workshop view selects the main item or a saved legacy item. **Create legacy version** copies the main listing into `<workshopDir>/legacy_version/<version>/`, including the title, descriptions, translations, thumbnail, gallery and dependencies. It does not copy the main Workshop ID. For a published main item, creation queries Steam and downloads information absent from the local listing. Local text and explicitly empty dependency or gallery files take priority. A failed read or a changed source stops creation before reserving the directory. A version such as `1.19` defaults to `1.19.*` and uses directory `1.19`, since Windows does not allow `*` in directory names. Exact patch versions are also accepted. Existing version directories are never merged or replaced; creating a replacement requires deleting the local directory first and does not delete its Steam item.

Each legacy `item.json` stores its own `publishedfileid`, listing fields and `legacy` record with `supportedVersion`, the mod `version` and content state. States advance from `new` through `creating`, `ready`, `submitted` and `published`. The ID is saved before content submission. Creation offers **Current project files** or **Files from a ZIP archive**. Current-project mode stages the project files at upload time, including unsaved text from open source files. ZIP mode extracts a local archive now into `<workshopDir>/legacy_version/<version>/content/`, records its filename in `legacy.archive`, and takes the mod version from the archived descriptor. The original ZIP can then be moved or deleted. Uploads use only the saved content, without overlaying live project edits or falling back to live files. Both modes change only the staged descriptor to the legacy game version and new ID. The source descriptor and main listing remain unchanged. Once submission begins, the host rejects further content uploads even if the webview requests them. Later uploads can change Workshop information only. Updating legacy mod files requires a separate project.

A ZIP must contain exactly one descriptor for the selected game (`descriptor.mod` or `.metadata/metadata.json`). The descriptor can be at the archive root or inside an enclosing folder, including a project's `mod/` folder; only that mod subtree becomes the content source. Import checks file sizes and CRCs and rejects ambiguous roots, links, encrypted entries, unsafe paths and path collisions. Extraction streams one file at a time and accepts at most 200,000 entries and 20 GB of expanded data. Invalid imports leave no legacy listing. A failed listing copy retains its reserved directory for inspection. Saved ZIP content is checked before remote item creation; missing files cause an error, never a live-project upload. The usual `.pxignore` rules apply from the archived mod root. The ZIP must already work with the selected game version: descriptor changes do not convert mod code or establish game compatibility.

The toolbar places Open on Steam beside the mod selector. Create legacy version opens an inline form that explains local creation and asks for a game version and content source. The toolbar remains usable; switching listings closes the form without creating anything. Once a legacy listing exists, a shared themed menu beside Upload selects the live item or a legacy item and offers creation of another version. A question-mark tooltip explains this workflow. Legacy mode uses the current theme's accent for its background, explicit version labels on upload controls and confirmations, and read-only version fields. ZIP listings show the saved content directory and archive name so the first-upload confirmation identifies the source.

An interrupted create or publish can have an unknown remote result. The saved state prevents another automatic create or content upload. Refresh the item on Steam before recovery; `submitted` keeps content locked even when the final result is unknown. A confirmed failure before any remote action, such as a stopped Steam client, restores the previous state so the user can retry manually. An upload lock also prevents two editor windows from submitting the same legacy item. After an editor crash, inspect the remote item before removing a remaining `.upload-lock`. Local listing edits stay available. Messages name their selected project and listing, and the host rejects messages from an older selection. Listing downloads compare their source files before writing, so edits saved while Steam is responding are not overwritten.

The bridge keeps failed DLC dependency reads distinct from successful empty lists. Import and reconciliation stop when the query fails. Upload waits have separate silence and progress limits: five minutes without bridge output, five minutes without upload progress, and fifteen minutes without preparation or commit progress. Only increasing processed bytes or an advancing phase or submission counts as progress. **Stop waiting** closes the local bridge wait and clears busy state; it cannot establish whether Steam applied the update. Timeouts and cancellation do not replay uploads.

`ddsConvert.ts` shares DDS format and mip choices between image conversion and creator picture imports. Manual conversion offers base-only, full-chain, or a custom total level count including the base image. The encoder checks that the count fits each image before output is published. Reference matching copies the reference count without a separate mip prompt.

A panel is a folder `packages/vscode/src/webviews/<name>/` with four parts:

| File | Runs where | What it is |
|---|---|---|
| `messages.ts` | both | The typed contract: an `AppToHost` union and a `HostToApp` union. Every byte that crosses the webview boundary is one of these messages. |
| `panel.ts` | extension host | The VS Code host: creates the panel, answers app messages, talks to the language server, opens files. The only file that imports `vscode`. |
| `html.ts` | extension host | The page: markup and page-specific CSS on top of the shared stylesheet, plus the CSP and the script tag. No logic. |
| `app/main.ts` | webview (browser) | The app: everything the user sees and clicks. It gets the DOM and nothing else. |

The split is the point. The app never imports `vscode`, never touches the
file system, and never talks to the server directly. It asks the host through
`messages.ts`, and the host does the two things a browser page cannot: fetch
over the wire and act on the workspace. This keeps the app testable in plain
jsdom and keeps every capability decision in one reviewable file.

Analysis stays out of both halves. Anything the panel knows about game script
comes from the language server over a `paradox/*` request, typed in
`packages/protocol` and documented in `docs/PROTOCOL.md`. The host is a
courier, not a brain.

### Character history editing

The Dynasty Tree opens character forms from the current editor document, including unsaved changes. Its host keeps the source block and checks it again before applying a save. A changed character requires reopening the form; unrelated edits elsewhere in the file are retained. Failed writes retain the draft and do not add an undo entry. Source blocks are located with the comment-aware scanner, so braces in comments or strings do not truncate them.

Character edits replace individual values and statements. Unchanged forms keep the character block byte-identical, including comments, blank lines, trait groups, quotation marks and detailed dated events. The death-reason field suggests indexed game and mod definitions and also accepts a typed identifier. Changing the reason preserves other death fields. Clearing a reason that has other details or internal comments is refused with an explanation; edit that block in source when removing those details. Moving a birth or death changes only that event, leaving other statements at their original date.

New characters use blank lines between identity, affiliation, family, skills, traits and dated history. The mod's `project.json` authoring rules `quoteNames`, `quoteCultures` and `quoteReligions` independently control new values and default to true, with legacy native settings as fallback. Existing values retain their quote style. Each form also offers explicit Quoted and Unquoted choices for these three fields. Values with spaces remain quoted. Names may be localization keys; the writer does not infer localization from spelling or quotation marks. Victoria 3 and EU5 retain the profile-based unsupported Dynasty Tree response.

### Creators are the same pattern, shared three ways

The definition creators (`traitCreator`, `legacyCreator`, `cultureCreator`) are
ordinary panels, but they share three modules instead of writing the same code
three times. `packages/vscode/src/creators/save.ts` is the host half: pick the
mod, pick the file, refuse a name that would replace a whole game file, apply
the server's edits as one `WorkspaceEdit`, and write the loc through the normal
loc writer. `src/webviews/shared/fields.ts` is the app half: the form controls
a creator draws its fields from, so creators differ in the form they lay out,
never in how a field behaves. `src/webviews/shared/scriptBlock.ts` reads a
`name = { ... }` block into statements and writes it back, keeping every
statement a form does not model verbatim; each app adds only its per-kind value
shapes on top. (`dynastyTree` sits in the same Create group and saves through
the same host flow, but it writes history entries, not a definition block, so
its block text comes from its own `blocks.ts`.)

None of the shared modules knows anything per kind. That comes over the wire, from
`paradox/definitionForm` and `paradox/definitionEdit`: the server assembles the
key list, the docs and the option lists out of the schema and the game's own
files. So a new creator is a new panel folder plus a `GameMeta.creators` row on
the profile that has the data for it, not a new field table.

## The build finds your panel

`scripts/compile-webviews.mjs` bundles every `src/webviews/<name>/app/main.ts`
to `dist/webview/<name>.js` (esbuild, IIFE, es2020). It runs as
`compile:webview` inside `pnpm run compile`, and with `--typecheck` inside
`pnpm run typecheck`. There is no list to edit.

Two files make discovery work for a new panel:

- `app/main.ts` is the entry point. Its presence is what marks the folder as
  a panel with its own bundle.
- `app/tsconfig.json` gives the app browser types (`lib: DOM`, `types: []`).
  Copy `exampleWiki/app/tsconfig.json`; the root tsconfig excludes `app/`
  folders on purpose, because extension-host types and DOM types must never
  mix.

`guiEditorPackaging.test.ts` replays the same discovery rule and fails if a
panel's bundle stops shipping in the .vsix or its `panel.ts` loads a path the
build does not produce. You do not extend it; it finds your panel too.

## Checklist for a new panel

1. **Create the folder** with the four parts above. Start from a copy of
   `exampleWiki/` and cut it down.
2. **Wire the command.** Register `px.show<YourPanel>` in
   `packages/vscode/src/extension.ts`, add it to `contributes.commands` in
   `packages/vscode/package.json` (category `Paradox`), and to the
   `commandPalette` menu with the same `when` clause its neighbours use.
3. **Add a Project panel row** in `src/webviews/dashboard/actions.ts`. The
   dashboard is the discoverable home for every tool; a command only in the
   palette does not exist for most users.
4. **Give the tab an icon.** Add the name to `TabIconName` in
   `src/webviews/tabIcons.ts` and to `scripts/gen-tab-icons.ts`, using the
   same Lucide glyph as the dashboard row, then regenerate.
5. **Feed it from the server.** New data means a new `paradox/*` request:
   type it in `packages/protocol`, implement it in `packages/server`, add it
   to `docs/PROTOCOL.md` (and its wiki mirror), and extend `lspSmoke.test.ts`.
   Never compute game facts in the extension host.
6. **Use the design system.** `src/webviews/shared/README.md` is the rulebook:
   inline `ui.css` (`import uiCss from "../shared/ui.css"`), px-ui classes,
   Lucide icons from `shared/icons.ts`, `menu()` instead of `<select>`,
   `confirmAction()` for anything destructive. Check the page in a dark theme
   and a light theme before calling it done.
7. **Test the logic, not the pixels.** Keep decisions in pure modules the app
   imports, and test those directly with vitest. For app-level behavior,
   build the real bundle and boot it in jsdom against a stub host:
   `eventGraphQuery.test.ts` is the small version of that pattern,
   `guiEditorHarness.ts` the full one.
8. **Write the changelog bullet** under Unreleased in
   `packages/vscode/CHANGELOG.md`, in the same PR.

## Things that will bite you

- **The CSP is strict.** `default-src 'none'`, then allow only what the page
  needs (see `exampleWiki/panel.ts`). No remote assets of any kind; images
  are `data:` URIs or `webview.cspSource` files, icons come from
  `shared/icons.ts`.
- **`window.confirm` and `window.alert` do not exist** in VS Code webviews.
  They fail silently. Use the shared `confirmAction()` and `toast()`.
- **A hidden tab suspends `requestAnimationFrame`.** Anything that animates
  or polls on rAF stops when the user switches tabs and must cope with the
  gap when it wakes.
- **`retainContextWhenHidden` is a choice, not a default.** Without it the
  webview is torn down when hidden and your app reboots on every tab switch;
  with it you pay memory. Either way, the host must be able to rebuild the
  app's state, because the panel can always be closed and reopened.
- **Per-game behavior is data, not `if (gameId === ...)`.** A panel that only
  works for some games gates on `GameProfile` facts, the same as everything
  else; `node scripts/check-game-boundary.mjs` enforces it on the server
  side.
- **Number the messages you wait for.** A request/response pair keyed by an
  `id` must answer every id exactly once, or a gesture stays armed forever.
  The GUI editor README explains why this rule is load-bearing.

## Workshop gallery copies

The Workshop uploader asks before reducing gallery images that exceed Steam's 1 MB limit. Accepted PNG and JPEG conversions run in the existing webview with Chromium's codecs, using request IDs and a 30-second timeout. Transparent images stay PNG; opaque images can become JPEG. All images must convert successfully before listing files change. The uploader then moves the full-size originals into a new batch under `<workshopDir>/preview-originals/` and puts the smaller images in `<workshopDir>/previews/`. This uses the selected listing directory in project, in-mod, custom and legacy layouts. File collisions receive a numeric suffix; gallery order, order-file comments, videos and other files are preserved. Subsequent uploads reuse the smaller images. Earlier `.px-toolkit/workshop-upload-previews/` archives remain untouched.

The uploader rejects unsaved gallery edits and disk changes detected during conversion. A local write failure stops upload and attempts to restore the previous gallery, reporting any recovery failures and the archive path. Cancelling, closing the panel, conversion failure, or failure to read the existing Steam gallery stops the upload before submission. The entire Workshop listing directory remains excluded from mod-content uploads. The primary thumbnail has its own size checks; oversized GIFs still need manual resizing to preserve animation.

Workshop tag choices come from `GameMeta.workshopTagGroups`, harvested from each game's public Steam Workshop configuration by `scripts/build-workshop-tags.ts --game <id>`. This includes CK3's Compatible Version tags as well as category tags. The selected strings are saved unchanged alongside existing tags, and custom tags remain available. Bundled lists need regeneration when Steam changes them; the editor does not make a network request to populate the picker.

## The dev loops

Three loops, from fastest to most complete. Pick by what you are iterating
on.

**Browser, for UI iteration.** `pnpm run preview:webviews` starts a dev
server (default port 5317) with two pages, both auto-reloading on save and
carrying a Dark/Light toggle that stands in for the VS Code theme:

- `/gallery` renders every px-ui component from the live `ui.css`, wired
  through the real shared modules (menu, dialog, toast, scrub, sortable,
  color picker). Edit anything under `shared/` and the page reloads. This is
  the gallery shared/README.md asks you to extend before shipping a new
  component.
- `/gui` boots the real GUI editor bundle over a stub host, with a real
  layout of one file: `pnpm run preview:webviews -- path/to/file.gui`
  (game and mod paths come from `dev-paths.json` or `--game`/`--mod`).
  Nothing is written; edit gestures answer with an honest refusal.

Use the browser's developer tools to inspect the page. In VS Code, **Developer: Open Webview Developer Tools** provides the equivalent tools. This browser loop uses a stub host; use the next loop to test real host behavior.

**Live Webview, for app work in VS Code.** Install [Live Webview from the Marketplace](https://marketplace.visualstudio.com/items?itemName=JDeffner.live-webview) with `code --profile "PXTK Development" --install-extension JDeffner.live-webview`. The companion must be enabled in the Extension Development Host that runs the toolkit. The current build also needs its helper: build the Live Webview checkout with `pnpm build`, then set `liveWebviewPath` in this repo's ignored `dev-paths.json` to that checkout root, or set `PX_LIVE_WEBVIEW_PATH` before starting VS Code. Marketplace installation supplies the companion, not the helper. Normal builds need neither.

Select **Run Extension + Live Webview** in Run and Debug, then press F5. The launch task builds the toolkit with the helper enabled and starts `pnpm run watch:webviews:live`. Open a mod folder in the development host, then open the panel you want to test. Each successful app build writes its own signal under `packages/vscode/.webview-dev/`; the companion reloads the registered instances of that app. Failed builds leave the current panel running. Use the **Live Webview** Explorer view to pause, resume, or reload an instance, and **Live Webview: Open Logs** to inspect callbacks. Stop the debug session and terminate the **live webviews** task when finished.

The command-line equivalent is `pnpm run compile:webview-dev`, followed by `pnpm run watch:webviews:live` and an Extension Development Host that loads `packages/vscode`. Changes to host code, HTML generators, or CSS imported by those generators require another `compile:webview-dev` and a host restart. Host-inline panels have the same limit. Reload restores only state the app already saves or requests from its host; unsaved DOM state can be lost.

The existing loop remains available: run `pnpm run watch:webviews` and use **Run Extension**. An installed test VSIX can load and watch these bundles through `px.dev.webviewSource`, set to the checkout's `packages/vscode/dist/webview` folder. The companion takes over reload scheduling only in the explicit Live Webview development build. Normal compilation and packaging remove the helper, and the VSIX excludes build signals.

**The real artifact.** `pnpm run package:test` builds a .vsix and installs it into the **PXTK Development** profile. Run **Developer: Reload Window** in that profile and check the panel before calling it done; this loop runs the packaged build.
