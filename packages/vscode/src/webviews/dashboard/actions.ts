import type { GameMeta } from "@px-lsp/server/games/profile";
import { PATHS, type IconName } from "../shared/icons";

/**
 * The command each creator kind opens. The profile names the creators a game
 * has; the command that draws them is the client's, so the mapping lives here.
 * A kind with no row here has no panel yet and is left out rather than shown as
 * a button that does nothing.
 */
const CREATOR_COMMANDS: Record<string, string> = {
  trait: "px.createTrait",
  dynasty_legacy: "px.createDynastyLegacy",
  culture: "px.createCulture",
  culture_tradition: "px.createTradition",
  // Not a definition kind: a view over history/characters.
  dynasty_tree: "px.openDynastyTree",
};

/** The creator rows of the Create group, in the profile's own order. */
function creatorItems(meta: GameMeta): ActionItem[] {
  const items: ActionItem[] = [];
  for (const creator of meta.creators ?? []) {
    const command = CREATOR_COMMANDS[creator.kind];
    if (!command || !(creator.icon in PATHS)) continue;
    items.push({
      label: creator.label,
      command,
      icon: creator.icon as IconName,
      ...(creator.tip ? { tip: creator.tip } : {}),
    });
  }
  return items;
}

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
          tip: "Graph of what fires what in the focused mod.",
        },
        {
          label: "Simulate Event",
          command: "px.simulateEvent",
          icon: "flaskConical",
          tip: "Walk through what the event at the cursor does.",
        },
        {
          label: "GUI Widget Tree",
          command: "px.showGuiTree",
          icon: "listTree",
          tip: "The widget tree of the .gui file you are editing.",
        },
        {
          label: "GUI Editor",
          command: "px.openGuiEditor",
          icon: "layoutTemplate",
          tip: "Render and edit the .gui window you are editing.",
        },
        // One row, two panels: px.openFlagBuilder opens the game's own Coat of
        // Arms designer where the profile says the game ships one, and the raw
        // Flag Builder everywhere else. The label follows.
        ...(meta.flagBuilder
          ? [
              meta.coaDesigner
                ? {
                    label: "Coat of Arms Designer",
                    command: "px.openFlagBuilder",
                    icon: "shield" as const,
                    tip: "Design arms the way the game's own designer does.",
                  }
                : {
                    label: "Flag Builder",
                    command: "px.openFlagBuilder",
                    icon: "flag" as const,
                    tip: "Compose a coat of arms and write it into the mod.",
                  },
            ]
          : []),
        {
          label: "Convert Image to DDS",
          command: "px.convertToDds",
          icon: "image",
          tip: "Convert PNG, JPEG or WebP files to DDS.",
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
          tip: "Create a new mod folder with its descriptor.",
        },
        {
          label: "New Content…",
          command: "px.newContent",
          icon: "plus",
          tip: "Scaffold an event, decision or trait into the right folder.",
        },
        // The visual creators follow the two scaffolds: same group, richer tool.
        ...creatorItems(meta),
        // Same glyph as the View group's Flag Builder row: one tool, one
        // icon. This row is the creation door, that one the blank canvas.
        ...(meta.flagBuilder
          ? ([
              {
                label: "New Coat of Arms…",
                command: "px.createCoatOfArms",
                icon: meta.coaDesigner ? "shield" : "flag",
                tip: "Design arms for a dynasty, house or title and save them into the mod.",
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
          tip: "The mod's Workshop listing, and where uploads happen.",
        },
        {
          label: "Open Workshop Page",
          command: "px.openWorkshopPage",
          icon: "externalLink",
          tip: "Open the mod's Workshop page in the browser.",
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
          tip: "Open the toolkit's Discord invite in your browser.",
        },
        {
          label: "Wiki",
          command: "px.openWiki",
          icon: "library",
          tip: "The hub: format docs, image guidelines, diagnostics, mod report and the Examples Wiki.",
        },
        {
          label: "Credits",
          command: "px.openCredits",
          icon: "heart",
          tip: "Every project the toolkit builds on, with links.",
        },
        {
          label: "Examples Wiki",
          command: "px.showExamplesWiki",
          icon: "bookOpen",
          tip: "Search every trigger, effect and datafunction the game has.",
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
                tip: "Remove the Problems that came from the game's error.log.",
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
                tip: "Snapshot today's tiger problems as the baseline.",
              },
              {
                label: "Find Unused Definitions",
                command: "px.tigerUnused",
                icon: "search",
                tip: "Report definitions nothing in the mod references.",
              },
              {
                label: `Generate ${meta.tiger.confName}`,
                command: "px.tigerGenerateConf",
                icon: "settings",
                tip: "Write a tiger config for this mod.",
              },
              {
                label: `Update ${meta.tiger.binaryName}`,
                command: "px.downloadTiger",
                icon: "download",
                tip: "Download the latest tiger release.",
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
