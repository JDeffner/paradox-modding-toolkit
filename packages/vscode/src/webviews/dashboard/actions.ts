import type { GameMeta } from "@px-lsp/server/games/profile";

/** 16×16 stroke icons (currentColor), hand-kept so the webview stays asset-free. */
export const ICONS = {
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  arrowRight: '<path d="M2.5 8h10M9 4.5 12.5 8 9 11.5"/>',
  clone: '<rect x="2.5" y="2.5" width="8" height="8" rx="1"/><path d="M5.5 13.5h7a1 1 0 0 0 1-1v-7"/>',
  image:
    '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1"/><path d="M4 12l3-3 2 2 2.5-2.5L14 11"/>',
  book: '<path d="M8 4C6.4 3 4.4 3 2.5 3.5v9C4.4 12 6.4 12 8 13c1.6-1 3.6-1 5.5-.5v-9C11.6 3 9.6 3 8 4Zm0 0v9"/>',
  report: '<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/>',
  chevron: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4"/><circle cx="8" cy="4.9" r=".5" fill="currentColor"/>',
  play: '<path d="M5.5 3.8v8.4L12.5 8Z" fill="currentColor" stroke="none"/>',
  check: '<path d="M8 2 13 4v4.3c0 3-2 5.2-5 5.7-3-.5-5-2.7-5-5.7V4Z"/><path d="M5.8 8.1l1.6 1.6 3-3.2"/>',
  camera:
    '<path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.6l1-1.5h3.8l1 1.5h1.6A1.5 1.5 0 0 1 14 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z"/><circle cx="8" cy="8.4" r="2.4"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.4 3.4"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 2.3v2M8 11.7v2M2.3 8h2M11.7 8h2M4 4l1.4 1.4M10.6 10.6 12 12M12 4l-1.4 1.4M5.4 10.6 4 12"/>',
  download: '<path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 12.5h10"/>',
  dismiss: '<circle cx="8" cy="8" r="5.8"/><path d="M6 6l4 4M10 6l-4 4"/>',
  graph:
    '<circle cx="4" cy="4" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="5.5" cy="12.5" r="2"/><path d="M5.9 4.7 10.1 6.3M4.4 6 5.2 10.5"/>',
  tree: '<path d="M2.5 3.5h11M3.5 3.5v9M3.5 8h3M3.5 12.5h3M6.5 8h7M6.5 12.5h7"/>',
  layout: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M6.5 6v7.5"/>',
  docs: '<path d="M4 2h5l3 3v9H4Z"/><path d="M9 2v3h3"/><path d="M6 8.5h4M6 11h3"/>',
  flag: '<path d="M3.5 14V2.5"/><path d="M3.5 3h9l-2 3 2 3h-9"/>',
  flask:
    '<path d="M6.5 2v4.2L3.2 12a1.2 1.2 0 0 0 1 1.9h7.6a1.2 1.2 0 0 0 1-1.9L9.5 6.2V2"/><path d="M5.8 2h4.4M4.8 9.5h6.4"/>',
} as const;

export interface ActionItem {
  label: string;
  command: string;
  icon: keyof typeof ICONS;
  tip?: string;
}

export interface ActionGroup {
  label: string;
  items: ActionItem[];
}

/**
 * Every command launcher the panel offers, built per game (labels carry the
 * active game's name). The panel is the discoverable home for EVERY tool:
 * editor-title buttons, the status bar and the keyboard chords stay as the
 * fast path in context, and a row here is the place you find the tool when
 * you do not already know where its button hides. Rows you never use go away
 * via `px.sidebar.hidden` (the Customize command), so a longer list costs
 * nothing. Two rows are still conditional on facts, not taste: tiger's
 * occasional commands need a game with a tiger, and clearing the error.log
 * Problems only appears while there is something to clear. The error.log
 * watcher itself is a toggle above, not a launcher.
 */
export function actionGroups(meta: GameMeta, gameProblems: number): ActionGroup[] {
  return [
    {
      label: "Open",
      items: [
        {
          label: "Event Graph",
          command: "px.showEventGraph",
          icon: "graph",
          tip: "Interactive graph of what fires what: events, on_actions and decisions of the focused mod.",
        },
        {
          label: "GUI Widget Tree",
          command: "px.showGuiTree",
          icon: "tree",
          tip: "The widget tree of the .gui file you are editing, with the templates and types each widget comes from.",
        },
        {
          label: "GUI Editor",
          command: "px.openGuiEditor",
          icon: "layout",
          tip: "Pixel-accurate rendering of the .gui window you are editing, with click-to-select, drag, resize and property edits.",
        },
        ...(meta.flagBuilder
          ? [
              {
                label: "Flag Builder",
                command: "px.openFlagBuilder",
                icon: "flag" as const,
                tip: "Compose a coat of arms from the game's patterns and emblems, preview it, and write it into the mod.",
              },
            ]
          : []),
        {
          label: "Format Docs",
          command: "px.openInfoDocs",
          icon: "docs",
          tip: "The game's own _*.info format documentation for the file you are editing.",
        },
        {
          label: "Simulate Event",
          command: "px.simulateEvent",
          icon: "flask",
          tip: "Static walkthrough of what happens when the event at the cursor fires, with step-into links along the chain.",
        },
      ],
    },
    {
      label: "Create",
      items: [
        {
          label: "New Content…",
          command: "px.newContent",
          icon: "plus",
          tip: "Scaffold an event, decision, trait, … into the right folder, with localization keys.",
        },
      ],
    },
    {
      label: "Localization",
      items: [
        {
          label: "Translate Missing Keys",
          command: "px.translateNext",
          icon: "arrowRight",
          tip: "Walk the missing localization keys one by one, side by side with the source language.",
        },
        {
          label: "New Translation Mod",
          command: "px.createTranslationMod",
          icon: "clone",
          tip: "Create a standalone mod that translates another mod, including an AI translation prompt.",
        },
      ],
    },
    {
      label: "Images",
      items: [
        {
          label: "Convert Image to DDS",
          command: "px.convertToDds",
          icon: "image",
          tip: "Convert PNG, JPEG or WebP files to the DDS format the game reads. Also in the Explorer right-click menu.",
        },
        {
          label: "Image Guidelines",
          command: "px.imageGuidelines",
          icon: "book",
          tip: "Reference for the sizes and formats the game expects (icons, portraits, flags, …).",
        },
      ],
    },
    {
      label: "Inspect",
      items: [
        {
          label: "Mod Report",
          command: "px.modReport",
          icon: "report",
          tip: "Summary of the focused mod: content counts, localization coverage, problems.",
        },
      ],
    },
    {
      label: "Test & Troubleshoot",
      items: [
        {
          label: `Launch ${meta.shortName} (debug mode)`,
          command: "px.launchGame",
          icon: "play",
          tip: "Start the game via Steam with -debug_mode -develop, so scripts reload live.",
        },
        // The watcher's Problems outlive the watch on purpose (you fix them
        // with the game closed), so this is how they go away once dealt with.
        ...(gameProblems > 0
          ? ([
              {
                label: `Clear Game Problems (${gameProblems})`,
                command: "px.clearGameProblems",
                icon: "dismiss",
                tip: "Remove the Problems that came from the game's error.log. They stay after you stop the watcher, so you can work through them with the game closed.",
              },
            ] satisfies ActionItem[])
          : []),
        // Tiger quick actions — only for games a tiger exists for. Setup &
        // Health Check has no row: the PX Toolkit status bar item runs it.
        ...(meta.tiger
          ? ([
              {
                label: "Create Tiger Baseline",
                command: "px.tigerCreateBaseline",
                icon: "camera",
                tip: "Snapshot today's tiger problems. With the 'new problems only' toggle on, only problems newer than the snapshot show.",
              },
              {
                label: "Find Unused Definitions",
                command: "px.tigerUnused",
                icon: "search",
                tip: "One tiger run that also reports definitions nothing references.",
              },
              {
                label: `Generate ${meta.tiger.confName}`,
                command: "px.tigerGenerateConf",
                icon: "gear",
                tip: "Write a tiger config for this mod, with its dependency mods declared as load_mod entries.",
              },
              {
                label: `Update ${meta.tiger.binaryName}`,
                command: "px.downloadTiger",
                icon: "download",
                tip: "Download the latest tiger release into the extension's storage (also how you update after a game patch).",
              },
            ] satisfies ActionItem[])
          : []),
      ],
    },
  ];
}

/**
 * The groups the panel renders: `actionGroups` minus the rows the user hid
 * (`px.sidebar.hidden`, keyed by command id), with groups that lost every row
 * dropped. Ids that match nothing are ignored, so a stale hide-list entry
 * never removes a row it was not written for, and rows added by a later
 * version ship visible.
 */
export function visibleActionGroups(
  meta: GameMeta,
  gameProblems: number,
  hidden: readonly string[]
): ActionGroup[] {
  const skip = new Set(hidden);
  return actionGroups(meta, gameProblems)
    .map((g) => ({ ...g, items: g.items.filter((it) => !skip.has(it.command)) }))
    .filter((g) => g.items.length > 0);
}
