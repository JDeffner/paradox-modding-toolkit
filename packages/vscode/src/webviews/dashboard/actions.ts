import type { GameMeta } from "@px-lsp/server/games/profile";
import { PX_CONFIG_DIR } from "@px-lsp/protocol/configDir";
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

/** The discoverable tool catalogue, gated by the active profile. */
export function actionGroups(meta: GameMeta, gameProblems: number): ActionGroup[] {
  const groups: ActionGroup[] = [
    {
      label: "Workspace Mods",
      items: [
        {
          label: "New Mod…",
          command: "px.createMod",
          icon: "package",
          tip: "Create a new mod folder with its descriptor.",
        },
      ],
    },
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
          tip: "Choose a .gui file to inspect its widget tree.",
        },
        {
          label: "GUI Editor",
          command: "px.openGuiEditor",
          icon: "layoutTemplate",
          tip: "Choose a .gui file to render and edit its windows.",
        },
      ],
    },
    {
      label: "Utils",
      items: [
        {
          label: "Convert Images...",
          command: "px.convertImages",
          icon: "image",
          tip: "Batch-convert images to PNG, JPEG, WebP or DDS.",
        },
        {
          label: "Convert Images to DDS...",
          command: "px.convertToDds",
          icon: "image",
          tip: "Convert images to DDS with a choice of compression.",
        },
        {
          label: "Convert DDS to Images...",
          command: "px.convertDdsToImage",
          icon: "image",
          tip: "Export DDS textures to PNG, JPEG or WebP.",
        },
        {
          label: "BBCode to Markdown...",
          command: "px.convertBBCodeToMarkdown",
          icon: "fileText",
          tip: "Write a Markdown copy of a BBCode file.",
        },
        {
          label: "Markdown to BBCode...",
          command: "px.convertMarkdownToBBCode",
          icon: "fileText",
          tip: "Write a BBCode copy of a Markdown file.",
        },
      ],
    },
    {
      label: "Publish",
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
    {
      label: "Create",
      items: [
        {
          label: "New Content…",
          command: "px.newContent",
          icon: "plus",
          tip: "Scaffold an event, decision or trait into the right folder.",
        },
        // Visual creators use the active game's own definitions.
        ...creatorItems(meta),
        // ONE row for the designer, in Create. It used to be listed twice (a
        // View row that opened the blank canvas and a Create row that asked
        // what the arms are for), which read as two tools; the creation flow
        // is the door, and it lands in the same panel. Both palette commands
        // stay for a keybinding or a deep link.
        ...(meta.flagBuilder
          ? ([
              {
                label: meta.coaDesigner ? "Coat of Arms Designer" : "Flag Builder",
                command: "px.createCoatOfArms",
                icon: meta.coaDesigner ? "shield" : "flag",
                tip: "Design arms for a dynasty, house or title and save them into the mod.",
              },
            ] satisfies ActionItem[])
          : []),
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
        // Validator tools follow the active profile.
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
                tip: `Write a tiger config into this mod's ${PX_CONFIG_DIR}/ folder.`,
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
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.command === "px.openGuiEditor") return meta.guiTextMetrics !== undefined;
      if (item.command === "px.newContent") return (meta.scaffolds?.length ?? 0) > 0;
      return true;
    }),
  }));
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
