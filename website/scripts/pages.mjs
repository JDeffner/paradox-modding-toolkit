const arrow = '<span aria-hidden="true">↗</span>';
export function homepage({ url, install, repo, sources }) {
  return `<main id="main" class="field-layout">
  <aside class="field-index"><details open><summary>On this page</summary><nav aria-label="Toolkit guide"><a href="#start" aria-current="location">The toolkit</a><a href="#script">Write your script</a><a href="#events">Follow the story</a><a href="#interfaces">See the interface</a><a href="#tools">Finish the details</a><a href="#handbook">Find your next step</a></nav><div class="index-meta"><span>Free & open source</span><a href="${url("releases/")}">${sources.stableVersion} beta ${arrow}</a><a href="${repo}">View source ${arrow}</a></div></details></aside>
  <div class="field-content">
  <section id="start" class="field-intro" aria-labelledby="hero-title"><p class="eyebrow">PARADOX MODDING TOOLKIT</p><h1 id="hero-title">Paradox modding,<br>from script to screen.</h1><p class="intro-copy">Write script, follow event chains and edit interfaces inside VS Code. A free, open-source toolkit for the work behind your mod.</p><div class="actions"><a class="button" href="${install}">Install for VS Code ${arrow}</a><a class="text-link" href="${url("docs/getting-started/")}">Get started ${arrow}</a></div><p class="fine-print">Windows, macOS & Linux · Also available as a <a href="${url("docs/outside-vs-code/")}">standalone language server</a></p>
  <figure class="source-result hero-pair" id="features"><div class="source-pane"><div class="pane-label">The source <span>.txt</span></div><pre aria-label="Source excerpt from the Cultivation mod"><code><span class="code-key">namespace</span> = cultivation_tribulation

<span class="code-name">cultivation_tribulation.3</span> = {
  <span class="code-key">type</span> = character_event
  <span class="code-key">title</span> = cultivation_tribulation.3.t
  <span class="code-key">desc</span> = cultivation_tribulation.3.desc
  <span class="code-key">theme</span> = dread

  <span class="code-comment"># Remaining event body omitted.</span>
}</code></pre><p>One event in a connected story.</p></div><div class="result-pane"><div class="pane-label">The connections <a href="${url("docs/event-graph/")}">Event Graph ${arrow}</a></div><a href="${url("assets/product/event-graph-chain.png")}" aria-label="Open the Event Graph screenshot at full size"><img src="${url("assets/product/event-graph-chain.png")}" alt="The Event Graph connects cultivation_tribulation.3 to the surrounding events and choices" fetchpriority="high"></a></div><figcaption>A source excerpt and the event chain it belongs to. Shown with the Cultivation mod.</figcaption></figure>
  <div class="game-support"><span>For Jomini games</span><a href="${url("docs/supported-games/")}#what-each-game-gets">Crusader Kings III</a><a href="${url("docs/supported-games/")}#victoria-3">Victoria 3</a><a href="${url("docs/supported-games/")}#europa-universalis-v">Europa Universalis V<small>Community-sourced support</small></a></div></section>
  <section id="script" class="field-chapter"><div class="chapter-heading"><h2>Write with the game<br> beside you.</h2><p>Completion, hover documentation and navigation draw on your installed game and its generated documentation. Follow a definition from your mod into vanilla without losing your place.</p></div><div class="reference-pair"><div class="field-notes"><h3>At the cursor</h3><dl><div><dt>Game-derived knowledge</dt><dd>Your own documentation takes priority over bundled snapshots.</dd></div><div><dt>Scope-aware suggestions</dt><dd>Completion ranks and explains options. Scope inference keeps possibilities visible.</dd></div><div><dt>Checks as you work</dt><dd>Structural diagnostics in the editor, with <a href="https://github.com/amtep/tiger">tiger</a> for deeper CK3 and Victoria 3 validation.</dd></div></dl><a class="text-link" href="${url("docs/editor-features/")}">Script editing guide ${arrow}</a></div><figure class="editor-shot"><a href="${url("assets/product/hover-scripted-effect.png")}" aria-label="Open hover documentation screenshot at full size"><img src="${url("assets/product/hover-scripted-effect.png")}" loading="lazy" alt="A scripted effect with hover documentation beside the code"></a><figcaption>Look up a scripted effect where you use it.</figcaption></figure></div></section>
  <section id="events" class="field-chapter"><div class="chapter-heading"><h2>Follow the story<br> across files.</h2><p>Read the chain around an event. Inspect its choices, switch between source keys and localized text, then move to the next connected event.</p></div><figure class="workflow-film"><video controls playsinline preload="metadata" width="1600" height="1000" poster="${url("assets/demos/event-graph.jpg")}" aria-label="Following an event chain" aria-describedby="home-demo-summary"><source src="${url("assets/demos/event-graph.mp4")}" type="video/mp4"><a href="${url("assets/demos/event-graph.mp4")}">Download the recording</a></video><figcaption id="home-demo-summary"><span>Following a chain in the Event Graph.<br><span class="muted">Silent recording · ${sources.previewVersion} preview · Cultivation mod</span></span><a href="${url("demos/")}">Watch all three workflows ${arrow}</a></figcaption></figure><a class="text-link chapter-link" href="${url("docs/event-graph/")}">Event Graph guide ${arrow}</a></section>
  <section id="interfaces" class="field-chapter"><div class="chapter-heading"><h2>See the interface<br> behind the file.</h2><p>Select a widget, inspect its properties and adjust the layout. The visual GUI editor works with CK3 and Victoria 3, with the source file always in reach.</p></div><figure class="source-result gui-pair"><div class="source-pane"><div class="pane-label">The source <span>.gui</span></div><pre aria-label="GUI source excerpt from the Cultivation mod"><code><span class="code-key">widget</span> = {
  <span class="code-key">name</span> = <span class="code-string">"cultivation_hud"</span>
  <span class="code-key">layer</span> = middle
  <span class="code-key">size</span> = { 100% 100% }

  <span class="code-comment"># Remaining widget body omitted.</span>
}</code></pre><p>One widget, its children and their layout.</p></div><div class="result-pane"><div class="pane-label">The interface <a href="${url("docs/gui-editor/")}">GUI Editor ${arrow}</a></div><a href="${url("assets/product/gui-editor-overview.png")}" aria-label="Open the GUI Editor screenshot at full size"><img src="${url("assets/product/gui-editor-overview.png")}" loading="lazy" alt="The Cultivation interface in the GUI editor with its widget tree and inspector"></a></div><figcaption>Actual source and editor view. Dynamic game text can appear as placeholders in the preview.</figcaption></figure><a class="text-link chapter-link" href="${url("docs/gui-editor/")}">GUI Editor guide ${arrow}</a></section>
  <section id="tools" class="field-chapter"><div class="chapter-heading"><h2>Finish the details.</h2><p>Keep textures, localization, new content and your Workshop listing close to the files you are editing.</p></div><div class="tool-directory">${[
    [
      "DDS & images",
      "Preview textures, inspect mip levels and convert image batches.",
      "dds-and-images",
      ".dds",
    ],
    [
      "Content creators",
      "Create CK3 traits, cultures, dynasties and coats of arms. Compose flags for Victoria 3 and EU5.",
      "content-creators",
      ".txt",
    ],
    [
      "Localization",
      "Find missing translations, work across languages and review changes.",
      "multi-mod-and-translation",
      ".yml",
    ],
    [
      "Steam Workshop",
      "Prepare descriptions, changenotes and preview images. Publish or update your mod.",
      "steam-workshop",
      "publish",
    ],
  ]
    .map(
      ([title, description, link, kind]) =>
        `<a class="tool-row" href="${url(`docs/${link}/`)}"><span class="file-kind">${kind}</span><div><h3>${title}</h3><p>${description}</p></div>${arrow}</a>`
    )
    .join("")}</div></section>
  <section id="handbook" class="field-chapter handbook-home"><div class="chapter-heading"><h2>Find your next step.</h2><p>Setup instructions, visual guides and the technical reference, adapted from the project wiki. Search all ${sources.importedPages.length} guides in the <a href="${url("docs/")}">handbook</a>.</p></div><div class="guide-list">${[
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
        `<a href="${url(`docs/${link}/`)}"><h3>${title} ${arrow}</h3><p>${description}</p></a>`
    )
    .join("")}</div></section>
  <section class="install-section"><img src="${url("assets/logo.svg")}" alt="" width="72" height="72"><div><h2>Ready for your next mod.</h2><p>Free and open source. Requires VS Code 1.91 or later and your own game installation for game data and testing.</p></div><a class="button" href="${install}">Install the toolkit ${arrow}</a></section>
  <div class="release-strip"><span class="tag">${sources.previewVersion} preview</span><p>DDS mip controls, Toolkit Settings and safer editing.</p><a href="${url("releases/")}">Release notes ${arrow}</a></div><div class="project-note"><p>Built by <strong>Joël Deffner</strong>, with open-source tools and knowledge from the Paradox modding community.</p><a href="${url("credits/")}">Credits and sources ${arrow}</a></div>
  </div></main>`;
}

export function releasesPage({ url, repo, sources }) {
  return `<main id="main" class="reading-page"><div class="page-heading"><span class="section-label">RELEASES</span><h1>Release notes.</h1><p>What is available today, and what is being prepared next.</p></div><article class="release-entry"><div class="release-title"><h2>${sources.previewVersion}</h2><span class="tag">Preview branch</span></div><p class="large-copy">DDS mip controls, Toolkit Settings and editing fixes.</p><p>This website includes information from the published <code>chore/prerelease-0.5.2</code> branch. These additions are marked as preview until the release is published.</p><ul class="release-list"><li><strong>DDS mipmaps and reference matching.</strong> Generate a full chain or a custom number of mip levels. Match a reference texture’s format and mip count, inspect stored levels, and export the displayed level.</li><li><strong>A dedicated Toolkit Settings tab.</strong> Search, filter and reset settings, choose the save scope, and keep drafts when switching views.</li><li><strong>Safer dynasty edits.</strong> Preserve character history comments, formatting, trait groups and detailed death blocks, with checks against stale source.</li><li><strong>CK3 faith and law definitions.</strong> Completion, hover, navigation and typed references include nested faiths and individual laws.</li><li><strong>Independent legacy Workshop listings.</strong> Create a separate listing for a game version and keep its information distinct from the main item.</li><li><strong>Preserve work in progress.</strong> Flag saves, New Content and translation merges respect unsaved editor text and reject stale inputs.</li></ul><div class="actions"><a class="text-link" href="${repo}/blob/${sources.contentRevision}/packages/vscode/CHANGELOG.md">Read the source changelog ${arrow}</a><a href="${url("docs/dds-and-images/")}">DDS guide &#8599;</a></div></article><article class="release-entry"><div class="release-title"><h2>${sources.stableVersion}</h2><span class="tag tag-stable">Published beta</span></div><p class="large-copy">A guided start and a steadier editing workflow.</p><p>Create or find your mod from Start Here. Add it to the current workspace or open another window. Use the clearer Project controls, batch image conversion and navigation that follows unsaved changes.</p><a class="text-link" href="${repo}/releases/tag/v${sources.stableVersion}">Read ${sources.stableVersion} release notes ${arrow}</a></article><div class="notice"><h2>What about Compatch?</h2><p>Compatch is separate development work planned for 0.6.0. It is not presented as part of the published 0.5.0 release or the 0.5.2 preview covered here.</p></div><a class="text-link" href="${repo}/releases">All GitHub releases ${arrow}</a></main>`;
}

export function identityPage({ url }) {
  return `<main id="main" class="reading-page brand-page"><div class="page-heading"><span class="section-label">VISUAL IDENTITY</span><h1>A field guide<br>for making mods.</h1><p>Ivory reading surfaces, clear type and dark editor views. Source and result, kept together.</p></div><div class="identity-lockup"><img src="${url("assets/logo.svg")}" alt="PX TK logo" width="128" height="128"><div>PARADOX<span>MODDING TOOLKIT</span></div></div><section><h2>The mark stays familiar.</h2><p>The existing PX / TK mark remains unchanged. Its weight gives the identity a firm anchor beside the more open reading type. Keep the original proportions and clear space equal to at least one quarter of the mark’s width.</p><a class="text-link" href="${url("assets/logo.svg")}" download="paradox-modding-toolkit.svg">Download the SVG logo ${arrow}</a></section><section><h2>Ivory, charcoal and gold.</h2><div class="swatches"><div><span style="background:#f2ede3"></span><strong>Ivory</strong><code>#F2EDE3</code></div><div><span style="background:#17161a"></span><strong>Charcoal</strong><code>#17161A</code></div><div><span style="background:#c8952f"></span><strong>Gold</strong><code>#C8952F</code></div><div><span style="background:#79551d"></span><strong>Gold ink</strong><code>#79551D</code></div></div><p>The first three colors come directly from the logo. Ivory gives instructions room to breathe. Charcoal holds code and editor views. Gold is a small point of emphasis; its darker ink variant keeps links legible on the light page.</p></section><section><h2>Type made for reading.</h2><div class="type-sample display"><span>Source Sans 3 · Headings</span>From script<br>to screen.</div><div class="type-sample body"><span>Source Sans 3 · Interface & reading</span>Connect your game.<br>Open a script. Make an edit.</div><div class="type-sample mono"><span>IBM Plex Mono · Code</span>namespace = your_world</div><p>Source Sans 3 gives headings and documentation an open, humanist structure. Archivo carries the compact wordmark beside the logo. IBM Plex Mono marks code and file names. All fonts are self-hosted under the SIL Open Font License.</p></section><section><h2>A practical field guide.</h2><p>Organize the page by a modder’s tasks. Keep the current task visible in the index. Pair a real source excerpt with the structure or interface it describes, and give each example a route into the handbook.</p><p>The connection to the game world is quiet: ivory, dark ink and small gold details. Use actual product views. Avoid parchment textures, ornamental crests and decorative game lettering.</p></section><section><h2>Independent and open source.</h2><p>Use Paradox Modding Toolkit on first mention. PX Toolkit is the short form used in the editor. This is a community project by Joël Deffner, not an official Paradox Interactive product.</p><a href="${url("credits/")}">Sources, licenses and credits ${arrow}</a></section></main>`;
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
        `<section class="recording"><div><h2>${title}</h2><p>${summary}</p><a class="text-link" href="${url(`docs/${doc}/`)}">Read the workflow ${arrow}</a></div><figure><video controls playsinline preload="metadata" width="1600" height="1000" poster="${url(`assets/demos/${id}.jpg`)}" aria-label="${title}" aria-describedby="summary-${id}"><source src="${url(`assets/demos/${id}.mp4`)}" type="video/mp4"><p><a href="${url(`assets/demos/${id}.mp4`)}">Download the recording</a></p></video><figcaption id="summary-${id}">Silent screen recording. ${summary} <a href="${url(`assets/demos/${id}.mp4`)}" download>Download MP4 &#8599;</a></figcaption></figure></section>`
    )
    .join("")}</div></main>`;
}
