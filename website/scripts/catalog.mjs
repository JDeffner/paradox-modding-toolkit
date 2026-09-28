export const groups = [
  {
    title: "Start here",
    pages: ["Getting-Started", "VS-Code-Setup-Guide", "Supported-Games", "Feature-Overview"],
  },
  {
    title: "In the editor",
    pages: [
      "Editor-Features",
      "Examples-Wiki",
      "Sidebar-Views",
      "Configuration",
      "Multi-Mod-and-Translation",
    ],
  },
  {
    title: "Visual tools",
    pages: ["Content-Creators", "GUI-Editor", "Event-Graph", "Flag-Builder", "DDS-and-Images"],
  },
  {
    title: "Test & publish",
    pages: [
      "Running-the-Game",
      "Custom-Calendars",
      "Steam-Workshop",
      "Steam-BBCode",
      "Steam-Workshop-Error-Codes",
    ],
  },
  {
    title: "Developers & community",
    pages: [
      "Outside-VS-Code",
      "npm-Packages",
      "Embedding",
      "Protocol-Reference",
      "Upgrading",
      "Contributing",
      "Credits",
      "Home",
    ],
  },
];
export const titles = {
  Home: "About this handbook",
  "npm-Packages": "Packages & installation",
  "Multi-Mod-and-Translation": "Multiple mods & translation",
  "DDS-and-Images": "DDS & images",
  "Outside-VS-Code": "Other editors & LSP",
};
export const descriptions = {
  Home: "Where the guides come from, which versions they cover, and how to contribute.",
  "Getting-Started": "Install the extension, connect your game and make your first edit.",
  "VS-Code-Setup-Guide": "A visual guide to VS Code, from installation to your first Git checkpoint.",
  "Supported-Games": "Compare support for Crusader Kings III, Victoria 3 and Europa Universalis V.",
  "Feature-Overview": "A complete tour of script editing, visual tools, validation and publishing.",
  "Editor-Features": "Completion, hover, definitions, references and diagnostics where you write.",
  "GUI-Editor": "Inspect, arrange and edit game interfaces with a visual layout editor.",
  "Event-Graph": "Follow event chains and edit events with their connections in view.",
  "Content-Creators": "Create CK3 traits, cultures, traditions, dynasties and coats of arms.",
  "DDS-and-Images": "Inspect textures, convert images and match the format your game expects.",
  "Steam-Workshop": "Prepare a listing, write release notes and publish your mod from VS Code.",
  Configuration: "Settings, keyboard shortcuts, validation and project configuration.",
  "Examples-Wiki": "Search engine vocabulary and learn from actual vanilla examples.",
  Embedding: "Host the language server inside your own application.",
  "Protocol-Reference": "The typed contract for the toolkit's custom LSP requests.",
  Credits: "The people, tools, data and communities behind the toolkit.",
};
export const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
export const titleFor = (id) => titles[id] ?? id.replaceAll("-", " ");
export const descriptionFor = (id) =>
  descriptions[id] ?? `How to use ${titleFor(id).toLowerCase()} in Paradox Modding Toolkit.`;
export const routeFor = (id) => (id === "Credits" ? "credits/" : `docs/${slug(id)}/`);

export function groupsFor(ids) {
  const available = new Set(ids);
  const catalog = groups
    .map((group) => ({ ...group, pages: group.pages.filter((id) => available.has(id)) }))
    .filter((group) => group.pages.length);
  const listed = new Set(catalog.flatMap((group) => group.pages));
  const additional = ids.filter((id) => !listed.has(id));
  if (additional.length) catalog.push({ title: "More guides", pages: additional });
  return catalog;
}
