import type { SnippetCatalogueResult } from "@px-lsp/protocol/protocol";

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
  );

/** Only the code fence and table emitted by completionPreview; no arbitrary HTML or links. */
function previewHtml(markdown: string): string {
  const code = /^(`{3,})[^\n]*\n([\s\S]*?)\n\1/m.exec(markdown)?.[2] ?? "";
  const decode = (text: string) =>
    text
      .trim()
      .replace(/&#124;/g, "|")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\\([\\`*_[\]])/g, "$1");
  const rows = markdown
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .slice(2);
  const table = rows.length
    ? "<table><thead><tr><th>Field</th><th>Expected value / documentation</th></tr></thead><tbody>" +
      rows
        .map(
          (row) =>
            "<tr>" +
            row
              .slice(1, -1)
              .split("|")
              .map((cell) => `<td>${escape(decode(cell))}</td>`)
              .join("") +
            "</tr>"
        )
        .join("") +
      "</tbody></table>"
    : "";
  return `<pre>${escape(code)}</pre>${table}`;
}

export function snippetCatalogueHtml(result: SnippetCatalogueResult): string {
  const entries = result.entries.map((entry) => ({
    ...entry,
    variants: entry.variants.map((variant) => ({ ...variant, html: previewHtml(variant.preview) })),
  }));
  const data = JSON.stringify(entries).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Generated snippets | ${escape(result.gameName)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#191b1e;color:#eeefed;font:18px/1.65 'Segoe UI',system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:40px 28px}h1{font-size:32px;line-height:1.25;margin:0 0 12px}p{max-width:72ch}.muted{color:#abb0b7;font-size:14px}.controls{position:sticky;top:0;background:#191b1e;padding:16px 0;border-bottom:1px solid #383d43;z-index:1;display:flex;gap:10px;flex-wrap:wrap;align-items:center}input,select,button{font:inherit;font-size:15px;color:inherit;background:#22252a;border:1px solid #555c64;border-radius:6px;padding:8px 12px}input[type=search]{flex:1;min-width:220px}button{cursor:pointer}button:hover{background:#353a42}label{font-size:14px}input[type=checkbox]{margin-right:6px}input:focus-visible,button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #e0c999;outline-offset:3px}details{margin:9px 0;border:1px solid #383d43;border-radius:7px;background:#22252a}summary{padding:12px 16px;cursor:pointer;font-size:16px;overflow-wrap:anywhere}summary span{color:#abb0b7;font-size:13px;margin-left:14px}.content{padding:0 18px 18px}.content button{float:right;margin:0 0 8px 10px}pre{clear:both;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4;background:#191b1f;padding:16px;border-radius:5px;font:14px/1.65 Consolas,'Cascadia Code',monospace}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #383d43;overflow-wrap:anywhere}th:first-child{width:25%}[hidden]{display:none!important}footer{border-top:1px solid #383d43;margin-top:28px;padding-top:16px}
@media print{:root{color-scheme:light}body,details,pre,main{background:white;color:black}main{max-width:none;padding:0}.controls,button,footer,#message{display:none!important}details{break-inside:avoid;border-color:#bbb}summary{font-weight:600}pre{border:1px solid #ddd}th,td{border-color:#bbb}.muted,summary span{color:#444}}
</style></head><body><main><h1>Generated snippets</h1><p>${escape(result.gameName)} · ${entries.length.toLocaleString("en-US")} entries</p><p class="muted">Generated ${escape(result.generatedAt)} from the toolkit’s loaded documentation, bundled definition skeletons and indexed scripted calls. Fixed JSON snippets and GUI completions are separate. Re-run Export Generated Snippets after updating or reloading the game documentation.</p>
<div class="controls"><input id="search" type="search" aria-label="Search snippets" placeholder="Search names, code or value hints"><select id="category" aria-label="Category"><option>All categories</option><option>Engine</option><option>Definitions</option><option>Child blocks</option><option>Scripted calls</option></select><select id="mode" aria-label="Snippet variant"><option>Minimal</option><option>Examples</option><option>All fields</option><option>All variants</option></select><label><input id="stops" type="checkbox">Show Tab stops</label><button id="print">Print / Save PDF</button></div><p id="count" class="muted" aria-live="polite"></p><p id="message" class="muted" aria-live="polite"></p><section id="entries" aria-label="Snippets"></section><footer class="muted">Minimal keeps documented fields with blank values. Examples retains example values. All fields includes optional fields where that variant exists. All variants shows and prints every available form. Entries without the selected variant show their available template. Printing includes every matching entry in the selected variant; clear the search and select All categories to print the full catalogue. Copy uses plain insertion text, or snippet syntax when Show Tab stops is checked. Type hints are documentation only.</footer></main>
<script type="application/json" id="data">${data}</script><script>${SCRIPT}</script></body></html>`;
}

const SCRIPT = String.raw`
const entries=JSON.parse(document.getElementById('data').textContent);
const search=document.getElementById('search'),category=document.getElementById('category'),mode=document.getElementById('mode'),stops=document.getElementById('stops'),list=document.getElementById('entries');
const nodes=entries.map((entry)=>{const node=document.createElement('details'),title=document.createElement('summary'),tag=document.createElement('span'),body=document.createElement('div');title.textContent=entry.label;tag.textContent=entry.category;title.append(tag);body.className='content';node.append(title,body);node.addEventListener('toggle',()=>{if(node.open)fill(node,entry)});list.append(node);return node});
const searchable=entries.map(e=>(e.label+' '+e.detail+' '+e.variants.map(v=>v.snippet+' '+v.preview).join(' ')).toLowerCase());
function selected(entry){return entry.variants.find(v=>v.label===mode.value)||entry.variants.find(v=>v.label==='Examples')||entry.variants[0]}
function fill(node,entry){const body=node.querySelector('.content');body.replaceChildren();for(const variant of mode.value==='All variants'?entry.variants:[selected(entry)]){const section=document.createElement('section');section.innerHTML=variant.html;const meta=document.createElement('p');meta.className='muted';meta.textContent=entry.detail+' / '+variant.label;const copy=document.createElement('button');copy.textContent='Copy '+variant.label;copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(stops.checked?variant.snippet:variant.plain);document.getElementById('message').textContent='Copied '+entry.label}catch{document.getElementById('message').textContent='Copy could not access the clipboard. Select and copy the code below.'}});section.prepend(copy,meta);if(stops.checked)section.querySelector('pre').textContent=variant.snippet;body.append(section);}}
function filter(){const query=search.value.trim().toLowerCase();let count=0;nodes.forEach((node,i)=>{node.hidden=!(searchable[i].includes(query)&&(category.value==='All categories'||entries[i].category===category.value));if(!node.hidden)count++});document.getElementById('count').textContent=count+' of '+entries.length+' entries'+(count===0?' · No matches':'');}
function update(){nodes.forEach((node,i)=>{if(node.open)fill(node,entries[i])})}
search.addEventListener('input',filter);category.addEventListener('change',filter);mode.addEventListener('change',update);stops.addEventListener('change',update);document.getElementById('print').addEventListener('click',()=>window.print());
let openBeforePrint=[];window.addEventListener('beforeprint',()=>{openBeforePrint=nodes.map(node=>node.open);nodes.forEach((node,i)=>{if(!node.hidden){fill(node,entries[i]);node.open=true}})});window.addEventListener('afterprint',()=>{nodes.forEach((node,i)=>{node.open=openBeforePrint[i]})});filter();
`;
