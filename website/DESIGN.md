# An ivory field guide

Paradox Modding Toolkit is presented as a practical guide to making mods. Ivory reading surfaces surround real editor views. The homepage leads with script completion, gives the Coat of Arms Designer the largest visual feature, and then presents Steam Workshop publishing. The primary action installs the VS Code extension; documentation, recordings, game support, credits and standalone LSP information remain first-class routes.

## Chosen direction

Joël chose **B: Ivory field guide with paired code and results** from the visual reference sheet on 28 September 2026. This replaces the rejected serif-led identity. The selected direction determines the page structure and typography, not only the background color. The homepage, handbook and supporting pages use the same identity.

The September 29 refinement removes the homepage side index and repeated product eyebrow. Copy names what the toolkit does and where to get it. The unchanged logo uses the selected A wordmark: a balanced title-case stack, with ?Paradox? above a readable ?Modding Toolkit.? Archivo uses 750 weight at 22px for the first line and 600 at 18px for the second, with a 4px gap. Both lines scale down together on narrow screens. Link Joël's name to his own website. Internal links have no arrow; diagonal arrows identify external destinations. Article metadata shows the wiki page's update date and history instead of a blanket toolkit-version banner. Feature-specific preview labels remain where they affect the instructions.

Joël places completion ahead of the graph and GUI editor. The coat of arms editor is the strongest visual example; Steam Workshop upload deserves a dedicated section. Show those three in that order. Event Graph and GUI Editor belong together as smaller supporting features below them. Their recordings remain on the demos page.

The website lives in this repository on `main` and builds independently of extension releases. The homepage and release presentation describe the published 0.5.2 preview revision in `sources.json`. The shared handbook comes from the published wiki at build time; `gollum` triggers updates. Published 0.5.0 and preview additions are identified separately. The intended domain is `paradoxtoolkit.jdeffner.com`.

## Research and transposition

Official product pages and live browser captures were reviewed on 28 September 2026. These observations guide positioning and presentation; they are not a feature benchmark.

| Source | Observation | Application to the toolkit |
|---|---|---|
| [CWTools](https://cwtools.github.io/) and its [VS Code documentation](https://github.com/cwtools/cwtools-vscode) | Completion, scopes, hover, validation, references and an event flowchart are established features in this category | Explain specific workflows and their game support. Do not imply that language intelligence or event graphs are unique inventions |
| [Paradox Chronicle](https://windea.icu/Paradox-Language-Support/en/) | IntelliJ tooling has extensive language support, CWT configuration, image tools and tiger integration | Name the VS Code environment early. Separate setup, task guides and protocol detail |
| [tiger](https://github.com/amtep/tiger) | Deep validation is an integrated upstream capability | Name and credit tiger where validation is explained |
| [Irony Mod Manager](https://bcssov.github.io/IronyModManager/) | Management, load order and conflict handling are adjacent jobs | State that the toolkit is for creating and editing mods |
| [PDX Tools](https://pdx.tools/) | Examples show useful output before a visitor provides data | Show actual editor views and recordings before installation |

The six visual references were Blockbench, VS Code, Inky, PDX Tools, Zed and Crusader Kings III. The owner's choice gives Inky's teaching structure priority over the darker product-canvas alternative.

| Reference element | Why it works | What it becomes here |
|---|---|---|
| [Inky](https://www.inklestudios.com/ink/): source and story together | The relationship explains narrative software directly | Script beside its completion and documentation; coat of arms controls beside the rendered design |
| Inky: a clear beginner path alongside a fuller manual | Readers can start at their own level | Getting Started, VS Code Setup, searchable handbook and separate developer references |
| [Blockbench](https://blockbench.net/): readable software views | The product supplies evidence | Flat editor captures with image overlays and named tasks |
| [PDX Tools](https://pdx.tools/): inspect an example early | A visitor can understand the work before setup | Actual completion, coat of arms editing and a Workshop listing before installation |
| The existing PX / TK mark | An established identity, with charcoal, ivory and gold | The same SVG mark, with ivory expanded into the reading surface and charcoal retained for code |
| [King chess piece](https://www.metmuseum.org/art/collection/search/472935), Cologne, Germany, 1350–1400 | A small detail identifies a useful ivory object | A restrained material association through the palette, without literal medieval decoration |

The museum artifact is a design analogy, not a claimed historical source of the logo. Research captures and the museum image are local reference material only. They are not published website assets. VS Code supplied a useful clear install route; Zed's current italic headline and CK3's campaign artwork are deliberately excluded.

## Identity and type

The logo remains unchanged. Its filled, heavy letterforms are an existing owner decision recorded in `scripts/brandFace.ts`. Archivo continues that weight only in the compact wordmark. The page itself uses **Source Sans 3**, a humanist family designed by Paul D. Hunt for interface use, with an open reading texture and a clear range of weights. [Adobe's source and license](https://github.com/adobe-fonts/source-sans) accompany the shipped font. IBM Plex Mono distinguishes code, file extensions and compact technical labels.

| Token | Value | Source and purpose |
|---|---|---|
| Ivory | `#F2EDE3` | Exact PX lettering, expanded into the reading surface |
| Charcoal | `#17161A` | Exact logo ground, used for text, source panes and primary actions |
| Gold | `#C8952F` | Exact TK lettering, retained in the mark |
| Gold ink | `#79551D` | Darker logo-gold step for readable links on ivory |
| Surface | `#FAF7F0` | Lighter step of the logo ivory for reading panels |
| Division | `#D5CEC0` | Darker ivory step for content boundaries |
| Secondary text | `#666168` | Neutral ink step for supporting information |
| Headings | Source Sans 3, 600 | Humanist reading type from the selected field-guide direction |
| Body | Source Sans 3, 400 | Comfortable documentation reading at 18px and 1.6 line height |
| Wordmark | Archivo, 750 / 600 | The selected title-case stack balances the short name and longer second line |
| Code | IBM Plex Mono, 400 | Script syntax and file names |
| Geometry | 4px controls, 5px paired panels | Conventional editor controls and flat source/result views |

Show inputs beside their result within actual editor captures. The completion image is the wiki's `images/completion.png` at revision `b35e83e`, copied to `public/assets/product/completion.png` so its CSS framing has a stable source. The homepage frames the script, suggestions and documentation; the overlay opens the complete unmodified capture. The Coat of Arms Designer and Steam Workshop images come from the imported wiki. No synthetic editor controls or fabricated game results are presented as product screenshots.

## Navigation and motion

The homepage uses a single reading column with no side index. The header leaves when scrolling down and returns when scrolling up, with a small direction threshold to avoid flicker. It stays available during menu interaction and returns on keyboard focus. The handbook retains its conventional sidebar, table of contents, search and thin horizontal reading-progress indicator. Reduced motion disables smooth scrolling and header transitions. Video has controls, metadata preloading and no autoplay.

Product and handbook screenshots open over the current page. A native dialog contains a fit-to-window view, an actual-size toggle and a visible close button. Escape and backdrop clicks close it; focus and the reading position return to the triggering image. The page behind the overlay cannot scroll.

The same reading system applies to the handbook, credits, releases, recordings and brand page. Fonts are self-hosted. Search loads the generated local index only when used. The website uses no analytics or third-party font requests.

## Refusals and audit

No parchment texture, ornamental crest, medieval display face, borrowed game logo, invented metric, testimonial, gradient, grain, decorative grid, marquee, colored row edge, floating pill navigation or forced scroll. Selected rows use a background tint. Paired source and result views give the page its structure instead of repeated feature cards.

The audit removes redundant chapter eyebrows, decorative brace diagrams and animation applied to the screenshots. The ivory background is a deliberate owner choice taken from the existing logo, not a generic paper effect. Publication remains separate from this local design review.
