/**
 * Styles for rendered BBCode (`bbcodeToHtml` output), shared by the Workshop
 * panel's description preview and the standalone .bbcode file preview. On top
 * of ui.css (the px-* variables).
 */
export const BBPREV_CSS = `
  .bbprev {
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md); padding: 12px 14px;
    min-height: 170px; overflow-wrap: anywhere; background: var(--px-muted);
    font-size: var(--px-text-sm); line-height: 1.55;
  }
  .bbprev .bb-h1 { font-size: 17px; font-weight: 600; margin: 8px 0 4px; }
  .bbprev .bb-h2 { font-size: 15px; font-weight: 600; margin: 8px 0 4px; }
  .bbprev .bb-h3 { font-size: 13px; font-weight: 600; margin: 6px 0 2px; }
  .bbprev .bb-h1:first-child, .bbprev .bb-h2:first-child, .bbprev .bb-h3:first-child { margin-top: 0; }
  .bbprev .bb-u { text-decoration: underline; }
  .bbprev a.bb-url { color: var(--vscode-textLink-foreground, #4daafc); text-decoration: none; }
  .bbprev a.bb-url:hover { text-decoration: underline; }
  .bbprev .bb-hr { border: none; border-top: 1px solid var(--px-border); margin: 8px 0; }
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
