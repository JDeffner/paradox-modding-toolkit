/**
 * The Dynasty Legacy Creator page: markup and the few page-specific styles on
 * top of the shared px-ui stylesheet. The app fills the sections at runtime;
 * nothing here talks to the host.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface LegacyCreatorHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function legacyCreatorHtml({ scriptSrc, nonce, csp }: LegacyCreatorHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Dynasty Legacy Creator</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #name { width: 240px; font-family: var(--px-font-mono); }
  #body { flex: 1 1 auto; overflow-y: auto; padding: 10px 12px 40px; }
  #body > section { max-width: 900px; margin-bottom: 18px; }
  #body > section > .px-panel-title { padding: 0 0 6px; }
  .note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #problem { margin: 8px 0; }
  /* The perks are a track: one card per step, read left to right like the
     game's own legacy window, and scrolled rather than wrapped. */
  #perks {
    display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 8px; align-items: flex-start;
  }
  .perk {
    flex: 0 0 300px; display: flex; flex-direction: column; gap: 6px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
    padding: 8px; background: var(--px-muted);
  }
  .perk > header { display: flex; align-items: center; gap: 4px; }
  .perk > header > .step {
    flex: 0 0 auto; width: 20px; height: 20px; display: flex; align-items: center;
    justify-content: center; border-radius: 999px; background: var(--px-muted-strong);
    font-size: var(--px-text-xs); color: var(--px-muted-fg);
  }
  .perk > header > input { flex: 1 1 auto; min-width: 0; font-family: var(--px-font-mono); }
  .perk .px-field { grid-template-columns: 1fr; gap: 2px; }
  .perk .px-label { padding-top: 0; }
  #script {
    margin: 0; padding: 8px 10px; overflow: auto; max-height: 420px; background: var(--px-muted);
    border-radius: var(--px-radius-md); font-family: var(--px-font-mono); font-size: var(--px-text-sm);
    white-space: pre;
  }
  details > summary { cursor: pointer; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" data-size="sm" spellcheck="false" autocomplete="off"
      placeholder="track key" data-tip="The track's key: lowercase letters, digits and _, starting with a letter. Everything else follows it." data-tip-wrap />
    <span id="source" class="px-badge" data-variant="outline" hidden></span>
    <div class="px-toggle-group" id="mode" hidden>
      <button class="px-toggle" data-size="sm" data-mode="duplicate" aria-pressed="true" data-tip="Write a copy under a new key. Your track and the game's both exist." data-tip-wrap>Duplicate</button>
      <button class="px-toggle" data-size="sm" data-mode="override" data-tip="Write the game's own key into your mod. There are no partial overrides: your copy replaces the whole track and stops receiving patch changes." data-tip-wrap>Override</button>
    </div>
    <button id="open" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Open a track this mod already has">${icon("folderOpen")}Open</button>
    <span class="px-grow"></span>
    <span id="target" class="px-muted px-xs"></span>
    <button id="save" class="px-btn" data-variant="default" data-size="sm">${icon("save")}Save</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this view works" data-tip-side="left">${icon("circleHelp")}</button>
  </div>
  <div id="body">
    <div id="problem" class="px-badge" data-variant="destructive" hidden></div>
    <section id="trackSection">
      <div class="px-panel-title">Track</div>
      <div id="trackFields"></div>
      <details id="trackOther" hidden>
        <summary class="note">Other keys the game documents for a legacy</summary>
        <div id="trackOtherFields"></div>
      </details>
    </section>
    <section>
      <div class="px-panel-title">Perks <span id="perkNote" class="note"></span>
        <button id="lookup" class="px-btn" data-variant="ghost" data-size="xs" data-tip="Read what a modifier does, and where the game itself uses it" data-tip-wrap>${icon("bookOpen")}Look up a modifier</button>
      </div>
      <div id="perks"></div>
      <button id="addPerk" class="px-btn" data-variant="outline" data-size="sm">${icon("plus")}Add perk</button>
    </section>
    <section>
      <details id="scriptFold">
        <summary class="px-panel-title">Script</summary>
        <pre id="script"></pre>
      </details>
    </section>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
