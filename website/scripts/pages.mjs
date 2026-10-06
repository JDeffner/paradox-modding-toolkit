const arrow = '<span aria-hidden="true">↗</span>';
export function homepage({ url, install, sources }) {
  return `<main id="main" class="field-layout">
  <div class="field-content">
  <section id="start" class="field-intro" aria-labelledby="hero-title"><h1 id="hero-title">Completion for your<br> Paradox scripts.</h1><p class="intro-copy">Suggestions and documentation from your game, in VS Code. Design coats of arms and publish to Steam Workshop from the same workspace.</p><div class="actions"><a class="button" href="${install}">Install for VS Code ${arrow}</a><a class="text-link" href="${url("docs/getting-started/")}">Get started</a></div><p class="fine-print">Free & open source · Windows, macOS & Linux · <a href="${url("docs/outside-vs-code/")}">Other editors & LSP</a></p>
  <figure class="completion-feature editor-shot" id="features"><div class="pane-label">Scope-aware completion <a href="${url("docs/editor-features/")}#at-the-cursor">Editor features</a></div><a class="completion-crop" data-enlarge href="${url("assets/product/completion.png")}" aria-label="Enlarge the script completion screenshot"><img src="${url("assets/product/completion.png")}" alt="Script completion suggests add_stress and shows its character scope and documentation" fetchpriority="high"></a><figcaption>Suggestions for a character effect, with its documentation beside the list.</figcaption></figure>
  <dl class="completion-notes"><div><dt>Your game and your mod</dt><dd>Complete effects, triggers, definitions and localization keys from the files you work with.</dd></div><div><dt>Context at the cursor</dt><dd>Suggestions for the current scope rank first. Hover for documentation; jump to definitions when you need the source.</dd></div></dl>
  <div class="game-support"><span>For Jomini games</span><a href="${url("docs/supported-games/")}#what-each-game-gets">Crusader Kings III</a><a href="${url("docs/supported-games/")}#victoria-3">Victoria 3</a><a href="${url("docs/supported-games/")}#europa-universalis-v">Europa Universalis V<small>Community-sourced support</small></a></div></section>
  <section id="coat-of-arms" class="field-chapter"><div class="chapter-heading"><h2>Design a coat of arms.</h2><p>Choose CK3 patterns, colors and emblems. Move, scale and layer them on the canvas, then preview your design in the game's house and dynasty frames.</p></div><figure class="editor-shot coa-feature"><a data-enlarge href="${url("assets/wiki/coa-designer.png")}" aria-label="Enlarge the Coat of Arms Designer screenshot"><img src="${url("assets/wiki/coa-designer.png")}" loading="lazy" alt="The CK3 Coat of Arms Designer with a gold fleur-de-lis on a red shield, placement controls and the emblem library"></a><figcaption>A CK3 design in a house frame, with emblem placement and the game's artwork in reach.</figcaption></figure><div class="feature-followup"><p>Start from an existing design or a blank canvas. Save to your mod, keep designs in your library, or copy the script.</p><a class="text-link" href="${url("docs/content-creators/")}#coat-of-arms-designer">Coat of Arms Designer guide</a></div><p class="fine-print">For Victoria 3 and EU5, use the <a href="${url("docs/flag-builder/")}">Flag Builder</a>.</p></section>
  <section id="workshop" class="field-chapter"><div class="chapter-heading"><h2>Publish to<br> Steam Workshop.</h2><p>Upload your mod from VS Code. Edit the listing, preview images, translations and changenote in one panel, then choose which parts to send.</p></div><figure class="editor-shot workshop-feature"><a data-enlarge href="${url("assets/wiki/workshop-panel.png")}" aria-label="Enlarge the Steam Workshop publishing screenshot"><img src="${url("assets/wiki/workshop-panel.png")}" loading="lazy" alt="The Steam Workshop panel for Custom Name Lists, with listing details and a checklist of the parts selected for upload"></a><figcaption>The publishing panel for Custom Name Lists. Each part of the update can be enabled separately.</figcaption></figure><div class="feature-followup"><p>Works with CK3, Victoria 3 and EU5 through your running Steam client.</p><a class="text-link" href="${url("docs/steam-workshop/")}">Steam Workshop guide</a></div></section>
  <section id="tools" class="field-chapter"><div class="chapter-heading"><h2>More tools for your mod.</h2><p>Inspect event chains and interfaces, work with textures, and keep localization alongside your scripts.</p></div><div class="supporting-tools"><section id="events"><h3>Event Graph</h3><figure class="editor-shot"><a data-enlarge href="${url("assets/product/event-graph-chain.png")}" aria-label="Enlarge the Event Graph screenshot"><img src="${url("assets/product/event-graph-chain.png")}" loading="lazy" alt="Connected events and choices in the Event Graph"></a></figure><p>Follow the events around a choice and jump to the source.</p><a class="text-link" href="${url("docs/event-graph/")}">Event Graph guide</a></section><section id="interfaces"><h3>GUI Editor</h3><figure class="editor-shot"><a data-enlarge href="${url("assets/product/gui-editor-overview.png")}" aria-label="Enlarge the GUI Editor screenshot"><img src="${url("assets/product/gui-editor-overview.png")}" loading="lazy" alt="The Cultivation interface in the GUI editor with its widget tree and inspector"></a></figure><p>Inspect widgets and edit layouts for CK3 and Victoria 3.</p><a class="text-link" href="${url("docs/gui-editor/")}">GUI Editor guide</a></section></div><a class="text-link recordings-link" href="${url("demos/")}">Watch toolkit recordings</a><div class="tool-directory">${[
    [
      "DDS & images",
      "Preview textures, inspect mip levels and convert image batches.",
      "dds-and-images",
      ".dds",
    ],
    [
      "Content creators",
      "Create CK3 traits, cultures, traditions and dynasties.",
      "content-creators",
      ".txt",
    ],
    [
      "Localization",
      "Find missing translations, work across languages and review changes.",
      "multi-mod-and-translation",
      ".yml",
    ],
  ]
    .map(
      ([title, description, link, kind]) =>
        `<a class="tool-row" href="${url(`docs/${link}/`)}"><span class="file-kind">${kind}</span><div><h3>${title}</h3><p>${description}</p></div></a>`
    )
    .join("")}</div></section>
  <section id="handbook" class="field-chapter handbook-home"><div class="chapter-heading"><h2>Set up your workspace.</h2><p>Installation, game setup and the language server. Search all ${sources.importedPages.length} guides in the <a href="${url("docs/")}">handbook</a>.</p></div><div class="guide-list">${[
    ["Getting started", "Install the toolkit, connect your game and make a first edit.", "getting-started"],
    ["VS Code setup", "Set up the editor and your first mod workspace.", "vs-code-setup-guide"],
    ["Supported games", "See which tools are available for CK3, Victoria 3 and EU5.", "supported-games"],
    [
      "Other editors & LSP",
      "Connect a client or build on the standalone language server.",
      "outside-vs-code",
    ],
  ]
    .map(
      ([title, description, link]) =>
        `<a href="${url(`docs/${link}/`)}"><h3>${title}</h3><p>${description}</p></a>`
    )
    .join("")}</div></section>
  <section class="install-section"><img src="${url("assets/logo.svg")}" alt="" width="72" height="72"><div><h2>Install for VS Code.</h2><p>Free and open source. Requires VS Code 1.91 or later and your own game installation for game data and testing.</p></div><a class="button" href="${install}">Install the toolkit ${arrow}</a></section>
  <div class="release-strip"><span class="tag">${sources.previewVersion} preview</span><p>DDS mip controls, Toolkit Settings and safer editing.</p><a href="${url("releases/")}">Release notes</a></div><div class="project-note"><p>Built by <a href="https://jdeffner.com/">Joël Deffner ${arrow}</a>, with contributions from the Paradox modding community.</p><a href="${url("credits/")}">Credits and sources</a></div>
  </div></main>`;
}

export function releasesPage({ url, repo, sources }) {
  return `<main id="main" class="reading-page"><div class="page-heading"><span class="section-label">RELEASES</span><h1>Release notes.</h1><p>What is available today, and what is being prepared next.</p></div><article class="release-entry"><div class="release-title"><h2>${sources.previewVersion}</h2><span class="tag">Preview branch</span></div><p class="large-copy">DDS mip controls, Toolkit Settings and editing fixes.</p><p>This website includes information from the published <code>chore/prerelease-0.5.2</code> branch. These additions are marked as preview until the release is published.</p><ul class="release-list"><li><strong>DDS mipmaps and reference matching.</strong> Generate a full chain or a custom number of mip levels. Match a reference texture’s format and mip count, inspect stored levels, and export the displayed level.</li><li><strong>A dedicated Toolkit Settings tab.</strong> Search, filter and reset settings, choose the save scope, and keep drafts when switching views.</li><li><strong>Safer dynasty edits.</strong> Preserve character history comments, formatting, trait groups and detailed death blocks, with checks against stale source.</li><li><strong>CK3 faith and law definitions.</strong> Completion, hover, navigation and typed references include nested faiths and individual laws.</li><li><strong>Independent legacy Workshop listings.</strong> Create a separate listing for a game version and keep its information distinct from the main item.</li><li><strong>Preserve work in progress.</strong> Flag saves, New Content and translation merges respect unsaved editor text and reject stale inputs.</li></ul><div class="actions"><a class="text-link" href="${repo}/blob/${sources.contentRevision}/packages/vscode/CHANGELOG.md">Read the source changelog ${arrow}</a><a href="${url("docs/dds-and-images/")}">DDS guide</a></div></article><article class="release-entry"><div class="release-title"><h2>${sources.stableVersion}</h2><span class="tag tag-stable">Published beta</span></div><p class="large-copy">A guided start and a steadier editing workflow.</p><p>Create or find your mod from Start Here. Add it to the current workspace or open another window. Use the clearer Project controls, batch image conversion and navigation that follows unsaved changes.</p><a class="text-link" href="${repo}/releases/tag/v${sources.stableVersion}">Read ${sources.stableVersion} release notes ${arrow}</a></article><div class="notice"><h2>What about Compatch?</h2><p>Compatch is separate development work planned for 0.6.0. It is not presented as part of the published 0.5.0 release or the 0.5.2 preview covered here.</p></div><a class="text-link" href="${repo}/releases">All GitHub releases ${arrow}</a></main>`;
}

export function identityPage({ url }) {
  return `<main id="main" class="reading-page brand-page"><div class="page-heading"><span class="section-label">VISUAL IDENTITY</span><h1>A field guide<br>for making mods.</h1><p>Ivory reading surfaces, clear type and dark editor views. Source and result, kept together.</p></div><div class="identity-lockup"><img src="${url("assets/logo.svg")}" alt="PX TK logo" width="128" height="128"><div>Paradox<span>Modding Toolkit</span></div></div><section><h2>The mark stays familiar.</h2><p>The existing PX / TK mark remains unchanged. Its weight gives the identity a firm anchor beside the more open reading type. Keep the original proportions and clear space equal to at least one quarter of the mark’s width.</p><a class="text-link" href="${url("assets/logo.svg")}" download="paradox-modding-toolkit.svg">Download the SVG logo</a></section><section><h2>Ivory, charcoal and gold.</h2><div class="swatches"><div><span style="background:#f2ede3"></span><strong>Ivory</strong><code>#F2EDE3</code></div><div><span style="background:#17161a"></span><strong>Charcoal</strong><code>#17161A</code></div><div><span style="background:#c8952f"></span><strong>Gold</strong><code>#C8952F</code></div><div><span style="background:#79551d"></span><strong>Gold ink</strong><code>#79551D</code></div></div><p>The first three colors come directly from the logo. Ivory gives instructions room to breathe. Charcoal holds code and editor views. Gold is a small point of emphasis; its darker ink variant keeps links legible on the light page.</p></section><section><h2>Type made for reading.</h2><div class="type-sample display"><span>Source Sans 3 · Headings</span>From script<br>to screen.</div><div class="type-sample body"><span>Source Sans 3 · Interface & reading</span>Connect your game.<br>Open a script. Make an edit.</div><div class="type-sample mono"><span>IBM Plex Mono · Code</span>namespace = your_world</div><p>Source Sans 3 gives headings and documentation an open, humanist structure. Archivo carries the compact wordmark beside the logo. IBM Plex Mono marks code and file names. All fonts are self-hosted under the SIL Open Font License.</p></section><section><h2>A practical field guide.</h2><p>Organize the page by a modder’s tasks. Pair a real source excerpt with the structure or interface it describes, and give each example a route into the handbook.</p><p>The connection to the game world is quiet: ivory, dark ink and small gold details. Use actual product views. Avoid parchment textures, ornamental crests and decorative game lettering.</p></section><section><h2>Independent and open source.</h2><p>Use Paradox Modding Toolkit on first mention. PX Toolkit is the short form used in the editor. This is a community project by Joël Deffner, not an official Paradox Interactive product.</p><a href="${url("credits/")}">Sources, licenses and credits</a></section></main>`;
}

export function demosPage({ url, sources }) {
  return `<main id="main" class="demo-page"><div class="page-heading"><span class="section-label">PRODUCT RECORDINGS</span><h1>The toolkit<br>in use.</h1><p>Real editor recordings, with playback controls and a written guide beside each one.</p><p class="fine-print">Captured from the ${sources.previewVersion} preview in an isolated VS Code window, using a scratch copy of Cultivation: The Path to Immortality. All clips are silent. <a href="${url("assets/demos/capture.json")}">Recording details</a>.</p></div><div class="recordings">${[
    [
      "event-graph",
      "Following an event chain",
      "Open a connected event, follow its outgoing choices and inspect the next event in the chain.",
      "event-graph",
    ],
    [
      "gui-editor",
      "Inside the GUI editor",
      "Explore a mod interface, select a widget and inspect its layout and properties.",
      "gui-editor",
    ],
    [
      "dds-viewer",
      "Inspecting DDS textures",
      "Look closely at a texture, inspect its format and compare stored mip levels.",
      "dds-and-images",
    ],
  ]
    .map(
      ([id, title, summary, doc]) =>
        `<section class="recording"><div><h2>${title}</h2><p>${summary}</p><a class="text-link" href="${url(`docs/${doc}/`)}">Read the workflow</a></div><figure><video controls playsinline preload="metadata" width="1600" height="1000" poster="${url(`assets/demos/${id}.jpg`)}" aria-label="${title}" aria-describedby="summary-${id}"><source src="${url(`assets/demos/${id}.mp4`)}" type="video/mp4"><p><a href="${url(`assets/demos/${id}.mp4`)}">Download the recording</a></p></video><figcaption id="summary-${id}">Silent screen recording. ${summary} <a href="${url(`assets/demos/${id}.mp4`)}" download>Download MP4</a></figcaption></figure></section>`
    )
    .join("")}</div></main>`;
}
