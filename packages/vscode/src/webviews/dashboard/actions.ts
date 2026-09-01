import type { GameMeta } from "@px-lsp/server/games/profile";
import type { IconName } from "../shared/icons";

export interface ActionItem {
  label: string;
  command: string;
  /** A Lucide icon from shared/icons.ts. */
  icon: IconName;
  tip?: string;
  /** A count shown as a badge after the label. */
  count?: number;
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
      label: "View",
      items: [
        {
          label: "Event Graph",
          command: "px.showEventGraph",
          icon: "waypoints",
          tip: "Interactive graph of what fires what: events, on_actions and decisions of the focused mod.",
        },
        {
          label: "Mod Report",
          command: "px.modReport",
          icon: "fileText",
          tip: "Summary of the focused mod: content counts, localization coverage, problems.",
        },
        {
          label: "Simulate Event",
          command: "px.simulateEvent",
          icon: "flaskConical",
          tip: "Static walkthrough of what happens when the event at the cursor fires, with step-into links along the chain.",
        },
        {
          label: "GUI Widget Tree",
          command: "px.showGuiTree",
          icon: "listTree",
          tip: "The widget tree of the .gui file you are editing, with the templates and types each widget comes from.",
        },
        {
          label: "GUI Editor",
          command: "px.openGuiEditor",
          icon: "layoutTemplate",
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
          label: "Convert Image to DDS",
          command: "px.convertToDds",
          icon: "image",
          tip: "Convert PNG, JPEG or WebP files to the DDS format the game reads. Also in the Explorer right-click menu.",
        },
      ],
    },
    {
      label: "Share",
      items: [
        {
          label: "Steam Workshop Panel",
          command: "px.openWorkshopManager",
          icon: "cloudUpload",
          tip: "The mod's Workshop item in one place: description, visibility, translations, statistics - and the only place uploads happen.",
        },
        {
          label: "Open Workshop Page",
          command: "px.openWorkshopPage",
          icon: "externalLink",
          tip: "Open the mod's Steam Workshop page in the browser (description, visibility, comments).",
        },
      ],
    },
    {
      label: "Create",
      items: [
        {
          label: "New Mod…",
          command: "px.createMod",
          icon: "package",
          tip:
            "Create a new mod with its descriptor. Recommended: a mod projects folder, where git and " +
            "Workshop files live next to the mod instead of inside the upload; the launcher finds the mod via a link.",
        },
        {
          label: "New Content…",
          command: "px.newContent",
          icon: "plus",
          tip: "Scaffold an event, decision, trait, … into the right folder, with localization keys.",
        },
      ],
    },
    {
      label: "Info",
      items: [
        {
          label: "Join the Discord",
          command: "px.openDiscord",
          icon: "messageSquare",
          tip: "Open the invite to the toolkit's Discord in your browser: release notes, bug reports, and help with the games this extension covers.",
        },
        {
          label: "Wiki",
          command: "px.openWiki",
          icon: "library",
          tip: "The toolkit's reference pages in one searchable place: the image sizes and formats the game expects, and what every diagnostic means.",
        },
        {
          label: "Examples Wiki",
          command: "px.showExamplesWiki",
          icon: "bookOpen",
          tip: "Search every trigger, effect, event target, modifier and datafunction the toolkit knows, with what it does and where the game itself uses it.",
        },
      ],
    },
    // Translation launchers live on the Localization Coverage view's title
    // bar, next to the numbers they act on - not as another panel group.
    {
      label: "Test & Troubleshoot",
      // Launching lives in ONE place: the editor-title Run button on script
      // and gui files (debug default, Map Editor, Launch with Options) plus
      // the Run and Debug panel's paradox-game presets - not as rows here.
      items: [
        // The watcher's Problems outlive the watch on purpose (you fix them
        // with the game closed), so this is how they go away once dealt with.
        ...(gameProblems > 0
          ? ([
              {
                label: "Clear Game Problems",
                count: gameProblems,
                command: "px.clearGameProblems",
                icon: "circleX",
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
                icon: "settings",
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
