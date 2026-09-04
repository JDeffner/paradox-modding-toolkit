/**
 * The third-party tools a modder of each game can reach for, as one wiki page
 * per game.
 *
 * Curated from each game wiki's own tools list on 2026-09-04 (the `source`
 * link of each entry). Tools the toolkit does the job of were left out, so the
 * page never sends a user to install something they already have: for CK3
 * ck3-tiger for VS Code, CK3_Validator, Copy on other languages and Lemmy's
 * ck3editor; for Vic3 Paradox Highlight, CWTools, Victoria 3 Tools for
 * Sublime, the two IntelliJ plugins, Tiger for VSCode, PDX Flag Builder and
 * PDX Workshop Manager; for EU5 Paradox Highlight, CWTools, Paradox Language
 * Support, EU5 Language for Notepad++ and PDX Workshop Manager. The tiger
 * binaries stay listed because the standalone build has a use the toolkit's
 * runner does not cover (scripts and CI).
 */

type Category =
  | "Validation"
  | "Localization"
  | "Map modding"
  | "History modding"
  | "Audio"
  | "Art and 3D models"
  | "General"
  | "Libraries";

export interface ModdingTool {
  name: string;
  category: Category;
  /** The first link carries the tool name; the rest are named by their label. */
  links: { label: string; url: string }[];
  what: string;
}

export interface GameToolList {
  source: { label: string; url: string };
  tools: ModdingTool[];
}

/** The category order every game's page follows. */
const CATEGORIES: Category[] = [
  "Validation",
  "Localization",
  "Map modding",
  "History modding",
  "Audio",
  "Art and 3D models",
  "General",
  "Libraries",
];

const MAYA_EXPORTER = {
  label: "Paradox forum",
  url: "https://forum.paradoxplaza.com/forum/threads/information-and-faq.924764/",
};

const PDX_DEEPL: ModdingTool = {
  name: "PDX DeepL",
  category: "Localization",
  links: [{ label: "GitHub", url: "https://github.com/kaiser-chris/pdx-deepl" }],
  what: "Machine-translates a mod's localization with DeepL, incrementally: a rerun translates only what is new or changed.",
};

const PDX_UNLIMITER: ModdingTool = {
  name: "Pdx-Unlimiter",
  category: "General",
  links: [{ label: "GitHub", url: "https://github.com/crschnick/pdx_unlimiter" }],
  what: "A savegame manager and editor. Also previews modded flags without starting the game.",
};

const UWP_DUMPER: ModdingTool = {
  name: "UWPDumper",
  category: "General",
  links: [{ label: "GitHub", url: "https://github.com/Wunkolo/UWPDumper" }],
  what: "Extracts the game files from a Microsoft Store install.",
};

const JOMINI_JS: ModdingTool = {
  name: "Jomini.js",
  category: "Libraries",
  links: [{ label: "GitHub", url: "https://github.com/nickbabcock/jomini" }],
  what: "A JavaScript parsing library for Paradox files, for people building their own tools.",
};

export const MODDING_TOOLS: Record<string, GameToolList> = {
  ck3: {
    source: { label: "Modding tools", url: "https://ck3.paradoxwikis.com/Modding_tools" },
    tools: [
      {
        name: "ck3-tiger",
        category: "Validation",
        links: [{ label: "GitHub", url: "https://github.com/amtep/ck3-tiger" }],
        what: "Checks a mod for mistakes the game does not report: missing localization, a faith trigger on a character, and hundreds more. The toolkit downloads and runs it for you; the standalone binary is for scripts and CI.",
      },
      {
        name: "ck3-tiger GitHub Action",
        category: "Validation",
        links: [{ label: "GitHub", url: "https://github.com/kaiser-chris/tiger-action-public" }],
        what: "A template repository and guide for running ck3-tiger on every push as a GitHub Actions workflow.",
      },
      {
        name: "ck3spell",
        category: "Validation",
        links: [{ label: "GitHub", url: "https://github.com/amtep/ck3spell" }],
        what: "A spelling checker for localization files. Also reads Imperator, Stellaris, HOI4 and EU4 files.",
      },
      {
        name: "CK3 Translator",
        category: "Localization",
        links: [{ label: "GitHub", url: "https://github.com/theNicelander/ck3_ml_translator" }],
        what: "A Python module that machine-translates a mod's localization files into other languages with Google Translate.",
      },
      {
        name: "Translate Helper",
        category: "Localization",
        links: [
          { label: "GitHub", url: "https://github.com/NicolasGrosjean/Translate_helper" },
          {
            label: "Steam guide",
            url: "https://steamcommunity.com/sharedfiles/filedetails/?id=2221665014",
          },
        ],
        what: "A Java tool that lists what is left to translate in a mod and helps you translate it.",
      },
      {
        name: "Azgaar to CK3 Converter",
        category: "Map modding",
        links: [{ label: "GitHub", url: "https://github.com/MnTronslien/AzgaarToCK3" }],
        what: "Turns a map made in Azgaar's Fantasy Map Generator into a playable mod with de jure and de facto hierarchy, cultures and faiths.",
      },
      {
        name: "watercolorGen",
        category: "Map modding",
        links: [
          {
            label: "GitHub",
            url: "https://github.com/sp-droid/myrepo/tree/main/Projects/Python/3imperatorrelated/10watercolorGen",
          },
        ],
        what: "Generates the watercolour sea-floor image for a custom map. Also for Imperator: Rome.",
      },
      {
        name: "flowmapGen",
        category: "Map modding",
        links: [
          {
            label: "GitHub",
            url: "https://github.com/sp-droid/myrepo/tree/main/Projects/Python/3imperatorrelated/9flowmapGen",
          },
        ],
        what: "Generates the river flow map from a heightmap. Also for Imperator: Rome.",
      },
      {
        name: "ck3_map_merge_tool",
        category: "Map modding",
        links: [{ label: "GitHub", url: "https://github.com/Iamgoofball/ck3_map_merge_tool" }],
        what: "Merges terrain and heightmap changes from several people working on the same map.",
      },
      {
        name: "Map Title Colouriser",
        category: "Map modding",
        links: [
          {
            label: "Paradox forum",
            url: "https://forum.paradoxplaza.com/forum/index.php?threads/1460776",
          },
        ],
        what: "Colours the titles of a de jure structure along a gradient, so bordering titles get similar shades, like vanilla.",
      },
      {
        name: "CK3 ColorPicker Gimp Plugin",
        category: "Map modding",
        links: [{ label: "GitHub", url: "https://github.com/IsaBeau-Dev/CK3-ColorPicker-Gimp-Plugin" }],
        what: "A GIMP plugin for picking and applying province colours on the provinces map.",
      },
      {
        name: "meckt",
        category: "Map modding",
        links: [{ label: "GitHub", url: "https://github.com/Xorrad/meckt/" }],
        what: "A map editor for total conversions: generates provinces from the provinces image, creates and edits titles on a map, manages title history.",
      },
      {
        name: "Clausewitz Scenario Editor",
        category: "History modding",
        links: [{ label: "GitHub", url: "https://github.com/mmyers/eug" }],
        what: "A history editor for CK2/3, EU3/4, Victoria 2 and HOI3. Assign de jure titles by selecting them on a map.",
      },
      {
        name: "GEDCOM to CK3 converter",
        category: "History modding",
        links: [
          {
            label: "Paradox forum",
            url: "https://forum.paradoxplaza.com/forum/index.php?threads/1481724",
          },
        ],
        what: "Turns GEDCOM genealogy files into character history and dynasty files, so you build a family in family tree software and load it into the game.",
      },
      {
        name: "Fmod Bank Tools",
        category: "Audio",
        links: [{ label: "External forum", url: "https://forum.bigant.com/thread-5237.html" }],
        what: "Extracts and rebuilds the .BANK files the game stores its audio in.",
      },
      {
        name: "Music Mod Creation Tool",
        category: "Audio",
        links: [{ label: "Website", url: "https://runite-drill.github.io/music-mod-creation-tool/" }],
        what: "Generates the files, script and folder structure a music mod needs. Works for other Paradox games too.",
      },
      {
        name: "Workshop Crawler",
        category: "General",
        links: [
          {
            label: "Paradox forum",
            url: "https://forum.paradoxplaza.com/forum/index.php?threads/1495112",
          },
        ],
        what: "Finds out whether your mod's files have been re-uploaded elsewhere on the Steam Workshop.",
      },
    ],
  },
  vic3: {
    source: {
      label: "Tools and utilities",
      url: "https://vic3.paradoxwikis.com/Modding#Tools_and_utilities",
    },
    tools: [
      {
        name: "tiger",
        category: "Validation",
        links: [{ label: "GitHub", url: "https://github.com/amtep/tiger" }],
        what: "Checks a mod for mistakes the game does not report. The toolkit downloads and runs vic3-tiger for you; the standalone binary is for scripts and CI.",
      },
      {
        name: "Tiger GitHub Action",
        category: "Validation",
        links: [{ label: "GitHub", url: "https://github.com/kaiser-chris/tiger-action-public" }],
        what: "A template repository and guide for running tiger on every push as a GitHub Actions workflow.",
      },
      PDX_DEEPL,
      {
        name: "Map data editor",
        category: "Map modding",
        links: [{ label: "GitHub", url: "https://github.com/Linnest2020/Vic3-mapdata-editor" }],
        what: "Edits common/history/states visually: which provinces belong to which country.",
      },
      {
        name: "Vicky-Mapgen",
        category: "Map modding",
        links: [{ label: "GitHub", url: "https://github.com/Chease23/Vicky-Mapgen" }],
        what: "Generates provinces from a heightmap.png and a boundaries.png.",
      },
      {
        name: "Music Mod Creation Tool",
        category: "Audio",
        links: [{ label: "GitHub", url: "https://github.com/runite-drill/music-mod-creation-tool" }],
        what: "Generates the files, script and folder structure a music mod needs. Supports Victoria 3.",
      },
      {
        name: "Clausewitz Maya Exporter",
        category: "Art and 3D models",
        links: [MAYA_EXPORTER],
        what: "Paradox's own Maya exporter for the 3D models Victoria 3 and the other Clausewitz games use.",
      },
      PDX_UNLIMITER,
      UWP_DUMPER,
      {
        name: "Victoria 3 Mod Template",
        category: "General",
        links: [{ label: "GitHub", url: "https://github.com/Victoria-3-Modding-Co-op/Mod-Template" }],
        what: "A GitHub repository template for a Victoria 3 mod.",
      },
      JOMINI_JS,
    ],
  },
  eu5: {
    source: {
      label: "Tools and utilities",
      url: "https://eu5.paradoxwikis.com/Modding#Tools_and_utilities",
    },
    tools: [
      PDX_DEEPL,
      {
        name: "EU5 Map Maker",
        category: "Map modding",
        links: [{ label: "Website", url: "https://eumapeditor.neurel.ch/" }],
        what: "A graphical map editor in the browser.",
      },
      {
        name: "Location Definition Tool",
        category: "Map modding",
        links: [{ label: "GitHub", url: "https://github.com/JammingEnd/Eu5_LocationDefinitionTool" }],
        what: "A downloadable graphical editor for location definitions.",
      },
      {
        name: "GIMP Heightmap Filter",
        category: "Map modding",
        links: [{ label: "GitHub", url: "https://github.com/krendil/display-filter-heightmap" }],
        what: "A GIMP display filter that colourises greyscale heightmaps while you edit them.",
      },
      {
        name: "EU5 Community Graphical Assets",
        category: "Art and 3D models",
        links: [
          {
            label: "GitHub",
            url: "https://github.com/Europa-Universalis-5-Modding-Co-op/graphical-assets",
          },
        ],
        what: "A shared repository of graphical assets for EU5 mods, open to contributions.",
      },
      {
        name: "Clausewitz Maya Exporter",
        category: "Art and 3D models",
        links: [MAYA_EXPORTER],
        what: "Paradox's own Maya exporter for the 3D models Europa Universalis V and the other Clausewitz games use.",
      },
      {
        name: "Arcanum",
        category: "General",
        links: [{ label: "GitHub", url: "https://github.com/The-Arcanum-Project/Arcanum" }],
        what: "A mod and map data editor for EU5, in active development.",
      },
      {
        name: "Community Mod Framework",
        category: "General",
        links: [
          {
            label: "GitHub",
            url: "https://github.com/Europa-Universalis-5-Modding-Co-op/community-mod-framework",
          },
        ],
        what: "A shared framework: mod menu, custom alerts, action bar, and development tools such as a visual editor and a mod translator.",
      },
      PDX_UNLIMITER,
      UWP_DUMPER,
      JOMINI_JS,
    ],
  },
};

/** The tool cell: the name links to the first entry, the rest by their label. */
function toolCell(tool: ModdingTool): string {
  return tool.links.map((link, i) => `[${i === 0 ? tool.name : link.label}](${link.url})`).join(" · ");
}

/** The page for one game, or undefined for a game with no curated list. */
export function moddingToolsMarkdown(gameId: string, gameName: string): string | undefined {
  const list = MODDING_TOOLS[gameId];
  if (!list) return undefined;
  const out = [
    "# Modding Tools",
    "",
    `Tools other modders built for ${gameName}, picked from the ${list.source.label} list. Tools the toolkit does the job of are left out.`,
    "",
    `Source: [${list.source.label}](${list.source.url}).`,
  ];
  for (const category of CATEGORIES) {
    const tools = list.tools.filter((t) => t.category === category);
    if (tools.length === 0) continue;
    out.push("", `## ${category}`, "", "| Tool | What it does |", "|---|---|");
    for (const tool of tools) out.push(`| ${toolCell(tool)} | ${tool.what} |`);
  }
  out.push(
    "",
    "## Add a tool",
    "",
    "Built something that does what the toolkit does not? Tell me on [Discord](https://discord.gg/ESstwqycug) or [open an issue](https://github.com/JDeffner/paradox-modding-toolkit/issues). I add the tools that fill a gap."
  );
  return out.join("\n");
}
