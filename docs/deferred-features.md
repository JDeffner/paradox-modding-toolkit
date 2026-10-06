# Deferred features

Features and experiments that are not ready to expose. Each entry identifies the current implementation boundary and the work needed before release.

## Future creators

The [Artifact Creator](https://github.com/JDeffner/paradox-modding-toolkit/issues/79) and [Province Painter](https://github.com/JDeffner/paradox-modding-toolkit/issues/80) are excluded from the 0.5.5 preview. Artifact Creator has research and interactive design studies but no production implementation. Province Painter needs a researched scope before implementation.

## Compatch

Compatch is available in the 0.5.5 preview of the upcoming 0.6.0 update when `px.experimentalFeatures` is enabled. It remains experimental. A clean text merge does not establish gameplay compatibility; validate against the target installation and test the mod in game.

### Compatibility Patch

The experimental maintained-patch workbench supports ordered source mods, conditional saved decisions, a bounded CK3 semantic set, manual-work records, three-way output maintenance and journal recovery. It does not establish complete playset compatibility. Ordinary cross-file duplicates without verified precedence, first-in-wins replacement constraints, `replace_path` effects, additive histories, nested databases and GUI semantics still need explicit rules or manual work. Binary assets remain an inventory for external review. Source refresh rereads the selected inputs; persistent incremental indexing is not implemented. No Crozier-compatible validator is available.

Mod-to-mod gameplay acceptance is deferred beyond this preview and tracked in [issue #81](https://github.com/JDeffner/paradox-modding-toolkit/issues/81). It is not a release acceptance requirement for 0.5.5.

### Mod Compatibility

The experimental panel supports exact-build routes, all contributions on each chosen transition, entry dependencies, manual notes, detector questions, saved per-entry progress, frozen previews, guarded per-step apply and reverse-order journal recovery. It loads data-only JSON compatibility notes or explicitly trusted JavaScript contributions. The public SDK includes fixture and idempotence helpers. Route gaps and alternatives remain visible; the planner does not infer missing conversions or coverage. Recipes can use a manual resolution after inspection when automatic changes cannot complete the work. Saved progress is checked against completed inputs and route, catalog and artifact identities; future-only input or reference changes preserve prior completion. Manual reports do not establish target-game verification.

CK3 has faith/rite and portrait/clothing mask recipes from `1.19.0.6` to the explicit targets `1.20.0.2` and `1.20.0.3`. A custom Lantern Fellowship fixture passed playtesting on 1.20.0.3: faith creation, custom tenets, county conversion, holy-site tiers, localization precedence, decision restrictions, mask changes and save/reload. The fixture also required a separate clothes-gene merge and accessory-registration check, which these recipes do not automate. Supported conversions request human decisions and preserve source content. Unsupported references, conflicting history, missing dependencies and unsupported texture resources remain blockers. The source build comes from an archived-folder label. Target structure comes from installed documentation. Victoria 3 and EU5 have no built-ins.

No Crozier-compatible Tiger validator is available in the tested environment. Automated target-game validation, save-game conversion, automatic resolution of unsupported reference intent and dependency load-order composition remain unavailable. Synthetic sequence tests verify workflow mechanics only. An inspection, preview, manual report or completed route does not establish compatibility. Test a scratch mod in game. See the [author guide](../packages/server/migrations/README.md).

The migration SDK remains work in progress. An independent contribution by an outside author and its target-game acceptance are deferred to a future release and tracked in [issue #82](https://github.com/JDeffner/paradox-modding-toolkit/issues/82).

A complete game-version update can also change parameterized trigger/effect contracts and their callers, GUI types and datafunctions, localization expression contexts, dated ownership and tenet policies, and asset or shader references. Existing static-ID and portrait-mask recipes cover only their declared cases. These broader changes require target-document evidence, explicit unresolved call sites and consumer-specific recipes or advisories. Text composition cannot infer the author's intended behavior for them.

## GUI editor: Interact mode (hidden 2026-08-24)

What it is: a tool mode where clicks run the variable-system half of a
widget's `onclick` and wheels scroll scrollareas, previewing the UI as the
game plays it. Not fleshed out enough yet.

Hidden by:

- `packages/vscode/src/webviews/guiEditor/html.ts`: `#modeGroup` carries
  `hidden` (plus the `#modeGroup[hidden]` CSS rule).
- `packages/vscode/src/webviews/guiEditor/app/main.ts`: `setMode` returns
  early on `"interact"`, which also disarms the `I` shortcut.

Everything else (interact.ts, the click tip, scroll offsets, the mode's
status line) is still live code and still compiled.

## GUI editor: preview values from a save game (hidden 2026-08-24)

What it is: the toolbar's "No save" dropdown (`#saveSource`), which feeds real
values from a chosen save (`paradox/guiSaveValues`) into `[datafunction]`
previews. Works, but the flow is not fleshed out enough to expose.

Hidden by:

- `packages/vscode/src/webviews/guiEditor/html.ts`: `#saveSource` carries
  `hidden` (plus the `#saveSource[hidden]` CSS rule).

The host side (pickSave, `px.guiEditor.save` state, the merge under the mod's
preview table) still runs; a save chosen before the button was hidden keeps
feeding values.

## Localization parser workers (deferred 2026-09-17)

Worker parsing remains an external experiment. No worker implementation, setting or bundle is included in this release. Full-result transfer cost exceeded the parser cost in the benchmark, and live editor results varied by file. Rapid overlapping edits, stale-result handling, cancellation and worker failures still need tests. The release uses synchronous incremental localization parsing and cached coverage instead. See [Performance](PERFORMANCE.md#incremental-localization-parsing-2026-09-17) for measurements and the remaining full-file definition rebuild cost.
