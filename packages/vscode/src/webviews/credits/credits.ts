/**
 * The upstream projects the toolkit builds on, curated by hand from
 * THIRD-PARTY-NOTICES.md, packages/server/data/ck3/wikidocs/ATTRIBUTION.md and
 * the README. Nothing is parsed at runtime: those files carry the full license
 * texts and the provenance details, this list carries the short version a mod
 * author wants to read, and the footer of the page links to the notices.
 *
 * When a notice is added or removed, this list changes with it.
 */

export interface CreditEntry {
  name: string;
  url: string;
  /** One plain sentence: what the toolkit uses this project for. */
  usedFor: string;
  license: string;
  /** The credit line the project asks for, or the people behind it. */
  author?: string;
  /** The author's own page, when the credit names one person we could confirm. */
  authorUrl?: string;
}

import type { IconName } from "../shared/icons";
import type { WikiCard } from "../wiki/messages";

export interface CreditSection {
  title: string;
  entries: CreditEntry[];
}

export const CREDIT_SECTIONS: CreditSection[] = [
  {
    title: "Tools and data",
    entries: [
      {
        name: "ck3-tiger and vic3-tiger",
        url: "https://github.com/amtep/tiger",
        usedFor:
          "The toolkit downloads and runs tiger for the deep validation of your mod, and turns its report into Problems in the editor.",
        license: "GPL-3.0",
        author: "amtep",
        authorUrl: "https://github.com/amtep",
      },
      {
        name: "CK3 Paradox Wiki, via ck3-modding-wiki",
        url: "https://github.com/jesec/ck3-modding-wiki",
        usedFor:
          "The bundled effect, trigger, scope and data type lists come from this Markdown mirror of the official CK3 modding wiki.",
        license: "CC BY-SA 3.0",
        author: "The CK3 wiki authors, mirrored by jesec",
      },
      {
        name: "cwtools-eu5-config",
        url: "https://github.com/kaiser-chris/cwtools-eu5-config",
        usedFor: "The Europa Universalis V schema table is generated from this project's type declarations.",
        license: "MIT",
        author: "Chris Kaiser",
        authorUrl: "https://github.com/kaiser-chris",
      },
      {
        name: "cwtools-vic3-config",
        url: "https://github.com/kaiser-chris/cwtools-vic3-config",
        usedFor:
          "The hand written Victoria 3 schema table was cross-checked against these rules for folder and kind names.",
        license: "MIT",
        author: "cwtools",
      },
      {
        name: "Node.js",
        url: "https://nodejs.org",
        usedFor:
          "The self-contained Windows server download carries the official node.exe, unmodified, so the server runs without a Node install.",
        license: "Node.js license, shipped as NODE-LICENSE beside the binary",
      },
    ],
  },
  {
    title: "Design and icons",
    entries: [
      {
        name: "pdx-flag-builder",
        url: "https://github.com/kaiser-chris/pdx-flag-builder",
        usedFor:
          "The Flag Builder reimplements this application's coat of arms model and recolor rule in TypeScript. Ported from PDX Flag Editor by Chris Kaiser.",
        license: "MIT",
        author: "Chris Kaiser",
        authorUrl: "https://github.com/kaiser-chris",
      },
      {
        name: "shadcn/ui",
        url: "https://github.com/shadcn-ui/ui",
        usedFor:
          "The look of the webviews, its palette, radii, control heights and focus ring, was read off the Nova style and written by hand in plain CSS.",
        license: "MIT",
        author: "shadcn",
        authorUrl: "https://github.com/shadcn",
      },
      {
        name: "Lucide",
        url: "https://github.com/lucide-icons/lucide",
        usedFor: "Every icon the webview panels draw is a Lucide glyph, inlined so the pages load no assets.",
        license: "ISC",
        author: "Lucide Icons and Contributors",
      },
      {
        name: "VS Code codicons",
        url: "https://github.com/microsoft/vscode-codicons",
        usedFor:
          "The Examples Wiki inlines the codicon artwork for the kinds it lists, because a webview cannot load the editor's icon font.",
        license: "CC BY 4.0",
        author: "Microsoft Corporation",
      },
    ],
  },
  {
    title: "Libraries",
    entries: [
      {
        name: "steamwand.js",
        url: "https://github.com/JDeffner/steamwand.js",
        usedFor: "The Workshop panel uploads and updates your mod through this Steam binding.",
        license: "MIT",
        author: "Joel Deffner",
        authorUrl: "https://github.com/JDeffner",
      },
      {
        name: "koffi",
        url: "https://koffi.dev/",
        usedFor:
          "steamwand.js calls the Steam library through koffi, so the toolkit needs no compiled native addon.",
        license: "MIT",
        author: "Niels Martignène",
        authorUrl: "https://github.com/Koromix",
      },
    ],
  },
];

/** The icon each credit group wears on its cards. */
const GROUP_ICONS: Record<string, IconName> = {
  "Tools and data": "wrench",
  "Design and icons": "palette",
  Libraries: "package",
};

/**
 * The same list as a wiki page (the Wiki hub renders it; the standalone
 * Credits panel is gone): one card per project, its group as the kind the
 * page filters by, the name as a link, the license beside it, what the
 * toolkit uses it for, and who it is by.
 */
export function creditsPage(): { markdown: string; cards: WikiCard[] } {
  const markdown =
    "# Credits\n\n" +
    "Every project the toolkit builds on. The full license texts and the provenance are in " +
    "[THIRD-PARTY-NOTICES.md](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/THIRD-PARTY-NOTICES.md).\n";
  const cards = CREDIT_SECTIONS.flatMap((section) =>
    section.entries.map((entry) => ({
      title: entry.name,
      url: entry.url,
      kind: section.title,
      icon: GROUP_ICONS[section.title] ?? "heart",
      // A person we could link is a link; a name alone sits beside the license.
      meta: entry.author && !entry.authorUrl ? `by ${entry.author}, ${entry.license}` : entry.license,
      text: entry.usedFor,
      ...(entry.authorUrl ? { links: [{ label: `by ${entry.author}`, url: entry.authorUrl }] } : {}),
    }))
  );
  return { markdown, cards };
}
