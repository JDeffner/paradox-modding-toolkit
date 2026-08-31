# File-type icons

How the per-language file icons (editor tabs, explorer, Quick Open) are built and maintained. Written so an AI agent can regenerate or extend them without prior context.

## Overview

Each of the contributed languages in `package.json` has a file icon via the `icon: { light, dark }` field on its entry in `contributes.languages`:

| Language id | Meaning | Glyph | Accent (dark / light) |
|---|---|---|---|
| `paradox` | Paradox Script | "PX" in a filled box, bottom-right (the JS-icon convention) | box `#F2EDE3`, ink letters / box `#17161A`, cream letters |
| `paradox-ck3` | Paradox Script (Crusader Kings III) | crown | `#E3B341` / `#A87B0F` |
| `paradox-vic3` | Paradox Script (Victoria 3) | same PX box as `paradox` | as `paradox` |
| `paradox-eu5` | Paradox Script (Europa Universalis V) | same PX box as `paradox` | as `paradox` |
| `paradox-loc` | Paradox Localization | speech bubble with text lines | `#3FC9B8` / `#137F70` |
| `paradox-gui` | Paradox GUI | window frame with layout blocks | `#A78BFA` / `#6D4FC2` |
| `paradox-info` | Paradox Format Docs | circled "i" | `#58A6FF` / `#2361A8` |
| `paradox-mod` | Paradox Mod Descriptor | jigsaw puzzle piece | `#E8925A` / `#BC5A18` |
| `dds` | DDS Texture | picture frame with mountain and sun | `#DD6FA8` / `#A83A78` |

The `dds` language entry exists only to carry the file icon (`.dds` files open in the `px.ddsPreview` custom editor); its static `extensions` association means the icon shows in the explorer without opening files, unlike the dynamically-detected script languages.

## Why the script language has four ids

A VS Code language id carries exactly one static icon and one static alias, so a per-game icon and a per-game display name need a language id per game. The four ids are the SAME language: same `language-configuration.json`, same grammar (the per-game grammars are one-line wrappers that `include` `source.paradox`), same server handlers. Only the icon and the label differ. `src/langIds.ts` holds the list, and `test/manifestLangs.test.ts` fails if a manifest clause, grammar, snippets entry, icon or editor default is missing for one of them.

Only `paradox-ck3` contributes files of its own; `paradox-vic3` and `paradox-eu5` point their `icon` fields at `paradox-{dark,light}.svg`, so there is one PX box, not three copies of it.

The SVGs live in `media/fileicons/` as `<language-id>-dark.svg` and `<language-id>-light.svg` (14 files). They are generated, not hand-drawn: the single source of truth is `scripts/gen-icons.ts`.

## Regenerating

```
npx esbuild scripts/gen-icons.ts --bundle --platform=node --outfile=dist/gen-icons.cjs && node dist/gen-icons.cjs && rm dist/gen-icons.cjs
```

Overwrites all 14 files in `media/fileicons/`. Bundles `scripts/brandGeometry.ts` for the PX glyph; no npm dependencies.

## Editing or adding an icon

1. Edit the `icons` object in `scripts/gen-icons.ts`. Each entry has `dark` and `light` accent colors and a `body(color)` function returning SVG inner markup. Do not edit the SVGs in `media/fileicons/` directly; they get overwritten.
2. Rerun the script.
3. For a new language: add the entry to the script, rerun, then add the `icon` field to the language's entry in `contributes.languages` in `package.json` (paths relative to extension root, e.g. `./media/fileicons/<id>-dark.svg`).

## Design constraints

These icons render at 16x16 px in tabs. When designing a `body`:

- viewBox is `0 0 16 16`. Keep the glyph centered with roughly 1.5 px margin.
- One flat accent color per icon, no gradients, no shadows, no text. The one
  exception is `paradox`: its "PX" letters are brandGeometry strokes (not font
  text), and its theme color is the BOX fill with the letters in the opposite
  brand neutral — cream box/ink letters on dark UIs, inverted on light. The X's
  diagonals overshoot cap height and baseline by design, so `pxBody` clips them
  to the band and anchors on the CLIPPED ink bounds: the advance-width table
  would place the pair too far right, because a diagonal's butt cap pushes ink
  sideways past its advance.
- Prefer filled silhouettes; carve inner detail as negative space with `fill-rule="evenodd"` (see `paradox-loc` and `paradox-info`). Strokes, where used, are 1.5 wide (see `paradox-gui`).
- Keep detail coarse: features narrower than ~1.3 px disappear at 16 px.
- `dark` variant = brighter accent (shown on dark editor themes), `light` variant = darker accent. Both must pass a legibility check against `#1e1e1e` and `#ffffff`.

## Verifying at 16 px

Always eyeball the actual 16 px rasterization before shipping; SVGs that look fine large can turn to mush at tab size. Render each icon at 16 px on both `#1e1e1e` and `#ffffff` backgrounds and view it magnified 4-6x with nearest-neighbor scaling (`@resvg/resvg-js` works well for headless rasterization). Every glyph must remain identifiable and distinguishable from the other four. Then confirm in the extension development host (F5): open one file of each type with the default Seti file icon theme active.

## Explorer-wide icons for dynamically-detected languages

The script ids, `paradox-loc` and `paradox-gui` declare no static file associations (claiming `*.txt` globally would hijack every text file on the system; see the header comment in `packages/vscode/src/languageMode.ts`). The explorer resolves icons statically and never opens files, so dynamic `setTextDocumentLanguage` detection alone only produces icons on files after they are opened.

`ensureFileAssociations` in `packages/vscode/src/languageMode.ts` closes this gap: on activation, if the workspace looks like a mod (`looksLikeMod` in `config.ts`), it writes workspace-scoped `files.associations` (`*.txt`, `*.gui`, `*.mod`, `**/localization/**/*.yml`) into `.vscode/settings.json`. Workspace scope keeps other projects unaffected, and keys the user already has associated (at any scope) are never overwritten.

`*.txt` maps to the ACTIVE game's script id (`scriptLangFor(cfg.gameId)`), which makes it the one association that can go stale: 0.1.x and 0.3.0 both wrote `*.txt: "paradox"` for every game. `shouldRewriteAssociation` in `src/langIds.ts` rewrites the workspace-scope value once when it is one of our four script ids and names the wrong one; any other value is the user's own and stays. The write touches `.vscode/settings.json`, which may sit in the mod's own git repo (same write class as the gap filling above), and it fails silently on an unwritable workspace — the Explorer then shows the generic PX box while open editors still get the right id from the dynamic path.

## Known limitations

- Language icons only show when the active file icon theme allows them (default Seti theme does, via `showLanguageModeIcons`). Third-party themes like Material Icon Theme override them with their own generic `.txt`/`.yml` icons; that is expected and not fixable from this extension.
- `scripts/makeIcon.ts` is unrelated (it builds the marketplace/extension icon, not file-type icons).
