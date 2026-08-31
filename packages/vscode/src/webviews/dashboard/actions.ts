import type { GameMeta } from "@px-lsp/server/games/profile";
import type { IconName } from "../shared/icons";
import { hasFormatDocs } from "../../meta";

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
      label: "Open",
      items: [
        {
          label: "Event Graph",
          command: "px.showEventGraph",
          icon: "waypoints",
          tip: "Interactive graph of what fires what: events, on_actions and decisions of the focused mod.",
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
        // Only CK3 ships _*.info docs; elsewhere the same row opens the vanilla
        // files of the folder plus a search on the game's modding wiki.
        hasFormatDocs(meta.id)
          ? {
              label: "Format Docs",
              command: "px.openInfoDocs",
              icon: "bookOpen" as const,
              tip: "The game's own _*.info format documentation for the file you are editing.",
            }
          : {
              label: "Vanilla Examples & Wiki",
              command: "px.openInfoDocs",
              icon: "bookOpen" as const,
              tip: "The vanilla files of the folder you are editing, and a search on the game's modding wiki.",
            },
        {
          label: "Simulate Event",
          command: "px.simulateEvent",
          icon: "flaskConical",
          tip: "Static walkthrough of what happens when the event at the cursor fires, with step-into links along the chain.",
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
        {
          label: "Move Mod…",
          command: "px.moveMod",
          icon: "arrowRight",
          tip:
            "Move a mod between the game's mod folder and your mod projects folder, in either direction. " +
            "The launcher link is updated so the mod keeps loading.",
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
          icon: "copy",
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
          icon: "bookOpen",
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
          icon: "fileText",
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
