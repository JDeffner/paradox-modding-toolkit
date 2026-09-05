/**
 * Styles for rendered BBCode (`bbcodeToHtml` output), shared by the Workshop
 * panel's description preview and the standalone .bbcode file preview. On top
 * of ui.css (the px-* variables).
 */
export const BBPREV_CSS = `
  /* The box takes the height of its text up to a cap the host sets, then
     scrolls; no drag grip, which Chromium drew as a broken corner over the
     rounded border. Both axes scroll, so a wide table or code block stays
     inside the box instead of widening the page. A host that wants the whole
     text (the standalone preview) resets max-height and overflow. */
  .bbprev {
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md); padding: 12px 14px;
    min-height: 44px; max-height: 320px; overflow: auto; overflow-wrap: anywhere;
    background: var(--px-muted); font-size: var(--px-text-sm); line-height: 1.55;
  }
  /* The preview plus the edit button pinned over its top left corner: the
     button sits outside the scroll box so it stays put while the text moves. */
  .bbprev-box { position: relative; min-width: 0; }
  .bbprev-box .bbprev { padding-left: 32px; }
  .bbprev-edit {
    position: absolute; top: 4px; left: 4px; z-index: 1;
    background: var(--px-muted); opacity: 0.65; transition: opacity var(--px-ease);
  }
  .bbprev-edit:hover, .bbprev-edit:focus-visible { opacity: 1; }
  .bbprev .bb-h1 { font-size: 19px; font-weight: 600; margin: 10px 0 6px; }
  .bbprev .bb-h2 { font-size: 16px; font-weight: 600; margin: 10px 0 4px; }
  .bbprev .bb-h3 { font-size: 13px; font-weight: 600; margin: 6px 0 2px; }
  .bbprev .bb-h1:first-child, .bbprev .bb-h2:first-child, .bbprev .bb-h3:first-child { margin-top: 0; }
  .bbprev .bb-u { text-decoration: underline; }
  .bbprev a.bb-url { color: var(--vscode-textLink-foreground, #4daafc); text-decoration: none; }
  .bbprev a.bb-url:hover { text-decoration: underline; }
  /* As the Workshop page draws them (checked against a live listing): [hr] is
     one thin bright line, and a heading is blue with no rule of its own. The
     line is drawn from the text color, not the border color, because on the
     muted box the border color is the box itself. */
  .bbprev .bb-hr { border: none; border-top: 1px solid color-mix(in oklch, var(--px-fg) 85%, transparent); margin: 14px 0; }
  .bbprev .bb-h1, .bbprev .bb-h2, .bbprev .bb-h3 { color: var(--vscode-textLink-foreground, #4daafc); }
  .bbprev .bb-list { margin: 4px 0; padding-left: 22px; }
  .bbprev .bb-quote { border-left: 3px solid var(--px-border); margin: 6px 0; padding: 4px 10px; color: var(--px-muted-fg); }
  .bbprev .bb-quote-author { font-size: var(--px-text-xs); font-weight: 600; margin-bottom: 2px; }
  .bbprev .bb-code {
    background: var(--px-bg); border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
    padding: 8px 10px; margin: 6px 0; font-family: var(--px-font-mono); font-size: var(--px-text-xs);
    overflow-x: auto; white-space: pre;
  }
  .bbprev .bb-img { max-width: 100%; border-radius: var(--px-radius-md); }
  .bbprev .bb-spoiler { background: var(--px-fg); color: var(--px-fg); border-radius: 2px; }
  .bbprev .bb-spoiler:hover { background: transparent; color: inherit; }
  .bbprev .bb-table { border-collapse: collapse; margin: 6px 0; }
  .bbprev .bb-table th, .bbprev .bb-table td { border: 1px solid var(--px-border); padding: 3px 8px; text-align: left; }
`;
