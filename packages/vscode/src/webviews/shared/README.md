# px-ui: the webviews' shared design system

Every webview of the toolkit (Project dashboard, event graph, event
simulator, GUI tree, GUI editor, Flag Builder) is built from this folder, so
they read as one product. The look is shadcn/ui's **Nova** style (preset
`b0`: neutral palette, 10px radius) ported to plain CSS and driven by the
user's VS Code theme. No framework, no Tailwind.

## Files

| File | What |
|---|---|
| `ui.css` | Tokens and every component class. Inline it into the page (`import uiCss from "../shared/ui.css"`, esbuild `--loader:.css=text`). |
| `icons.ts` | Lucide icons: `icon("plus")` (string) / `iconEl("plus")` (node). |
| `overlay.ts` | `popover`, `menu` (the `<select>` replacement), `confirmDialog`, `toast`. |
| `sidePanel.ts` | Resizable, collapsible side panel; owner persists width/collapsed. |
| `sortable.ts` | Pointer-drag reordering of `.px-item` rows (ghost + FLIP slide). |
| `scrub.ts` | Press-and-drag on number inputs (pointer lock, Shift x10, Alt x0.1). |
| `colorPicker.ts` | SV square + hue bar + hex, in a popover. |

## Tokens

`--px-bg` / `--px-fg` are the editor colors. Every other surface is a
`color-mix` of those two by Nova's neutral ratios (`--px-muted`,
`--px-border`, `--px-input`, `--px-ring`, `--px-muted-fg`, `--px-popover`),
set per `body.vscode-dark` / `body.vscode-light`. `--px-primary` is the
theme's accent (VS Code button colors). Never hardcode a color; never read a
`--vscode-*` variable outside `ui.css`.

Sizes: controls are 32px (`--px-h`), 28px (`data-size="sm"`), 24px (`xs`).
Radius 10 / 8 / 6. Text 13 / 12 / 11. Motion 120ms (`--px-ease`).

## Components (class + data attributes, as shadcn names them)

- `px-btn` with `data-variant` = `default` (the ONE accent button per page,
  its main action) | `outline` | `secondary` | `ghost` (toolbars, row tools)
  | `destructive` | `link`, and `data-size` = `sm` | `xs` | `icon` |
  `icon-sm` | `icon-xs`. Icon-only buttons MUST carry `data-tip`.
- `px-input` (+ `type=number` gets `scrubbable()`), `px-input-group` for a
  leading icon, `px-labeled` for an in-field prefix (h / s / v).
- `px-dropdown` trigger (an outline button: value left, chevron right) that
  opens `menu()`. Never a native `<select>`: its option list cannot be
  styled and breaks in dark themes.
- `px-toggle-group` + `px-toggle[aria-pressed]`, `px-switch`, `px-slider`,
  `px-tabs` (+ `data-variant="line"`) + `px-tab[aria-selected]`.
- `px-badge` (`data-variant` secondary | outline | destructive), `px-kbd`.
- `px-panel-title` (11px uppercase section header, tools right),
  `px-list` + `px-item` (kind | label | `px-item-tools` shown on hover;
  `aria-selected="true"`), `px-separator`.
- `px-sidepanel` (see sidePanel.ts), `px-popover`, `px-menu`, `px-dialog`,
  `px-toast`, `px-swatch`, tooltips via `data-tip` (+ `data-tip-side`,
  `data-tip-wrap`).

## UX rules (the part that makes it feel like an editor, not a form)

1. **Toolbar grammar.** Left: the document's identity (name) and file
   actions as icon buttons (new, open, paste, copy). Then undo/redo. Right:
   the target (where it saves) and the single accent Save, then export, a
   separator, then view toggles. Every icon button has a tooltip; text only
   on the accent button.
2. **Side panels resize and hide.** Anything inspector-like is a
   `px-sidepanel` with a toggle in the toolbar and its state remembered via
   the host's `workspaceState`. Horizontal room is scarce.
3. **Status goes to the edges, not the toolbar.** Counts and load info live
   behind an ⓘ at the bottom-left of the canvas; view controls (lock, zoom)
   next to it. No paragraph of text in a toolbar.
4. **Dropdowns are menus.** `menu()` with a filter box past 8 items,
   keyboard navigation, swatches or a second description line when the
   label alone is ambiguous. Clicking the trigger again closes it.
5. **Numbers scrub.** Any numeric field drags horizontally; a click types.
   Undo steps are committed values, not keystrokes.
6. **Lists reorder by drag** (`sortable()`): a clone follows the pointer,
   the row ghosts in place, neighbours slide. No arrow buttons, no
   edge-highlight drop markers.
7. **Sections fold.** Repeating blocks (instances, layers of a group) get a
   caret in their header.
8. **Destructive or lossy steps confirm** with `confirmDialog`, never with
   `window.confirm` (unavailable in webviews) and never silently.
9. **Hover is quiet.** A muted background lift, 120ms; no borders appearing,
   no color changes on text, no scale. Focus is the 3px soft ring.
10. **Nothing decorative.** No gradients, no glows, no emoji, no badges that
    say nothing. Labels are nouns; tooltips are sentences.
11. **Theme first.** Works in Dark Modern, Light Modern, high contrast and a
    colored theme (Solarized). Check both light and dark before calling a
    page done.
12. **Self-contained.** No remote assets (CSP). Icons come from `icons.ts`;
    add a Lucide path there rather than drawing one.

## Adding a component

Add the class to `ui.css` under the matching section with a short comment
naming the shadcn component it mirrors, use shadcn's proportions and states
(hover, focus-visible, disabled, aria-*), and show it in the gallery before
using it in a page.
