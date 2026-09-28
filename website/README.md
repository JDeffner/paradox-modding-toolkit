# Toolkit website

A static product site and searchable handbook for Paradox Modding Toolkit. The website lives in this repository on `main` and builds independently of the extension. It needs Node 22 or later, Git and pnpm. No server, account or API key is needed for the deployed site.

## Run locally

```sh
cd website
pnpm install --frozen-lockfile
pnpm sync:wiki
pnpm build
pnpm check
pnpm preview
```

Open `http://127.0.0.1:4321`. For browser checks, run `pnpm exec playwright install chromium`, then `pnpm test`. The tests cover navigation, the task index, search and its failure state, mobile overflow, all handbook images, video playback and seeking, and the missing-page route. `pnpm check` checks local links, fragments, image dimensions and page headings.

## Content

The GitHub wiki is the publication source for all shared handbook text and documentation images. Edit and publish there first. `pnpm sync:wiki` clones its latest committed revision into an ignored cache; `pnpm build` renders that cache. The deployed site is static and does not fetch the wiki in a reader's browser. Each build records its wiki revision and page inventory in `build.json`. `_Sidebar.md`, `_Footer.md` and the wiki maintenance `TODO.md` are excluded because this site supplies its own navigation and footer.

`docs/EMBEDDING.md` and `docs/PROTOCOL.md` remain canonical for those contracts. Publish their wiki mirrors from the intended release or explicitly requested revision first; the website reads the wiki mirrors along with the other guides. It never silently substitutes unreleased repository text. The initial website's preview additions for settings, DDS mipmaps, creators, nested CK3 references and legacy Workshop listings are published to the wiki so there is one shared copy.

For an existing wiki checkout, run `pnpm sync:wiki <wiki-checkout>` from `website/`. Only committed files are imported; commit a local wiki draft before testing it. A successful import replaces the previous cache, including removed pages and images. Failed imports exit with an error. There is no automatic fallback to old documentation in CI. Local `pnpm build` can use the last imported cache offline.

New pages enter the generated search index and the "More guides" navigation group automatically. Add them to `scripts/catalog.mjs` for a more specific group and description. Removed pages disappear from navigation; remaining broken links fail validation instead of replacing the last good deployment. Website-only credits live in `fragments/credits.md`. The homepage, release presentation, identity and recordings remain website source. Do not put shared documentation corrections in a website fragment or generated cache.

The site deliberately distinguishes published 0.5.0 from the 0.5.2 preview. When the release ships, update `sources.json`, the release page in `scripts/pages.mjs`, and the preview labels in affected guides together. Do not infer publication from a branch version number. Compatch remains separate, planned 0.6.0 work.

## GitHub Pages

The workflow `.github/workflows/website.yml` imports the published wiki, builds only `website/`, checks it, and uploads a Pages artifact. Pull requests build and test without deploying. Website changes pushed to `main`, wiki `gollum` events and manual dispatches on `main` deploy after the checks pass. This does not build or publish an extension release. GitHub requires the workflow on the default branch for `gollum` events.

After a wiki update, check the **Toolkit website** Actions run and the changed live page. If no `gollum` run appears after a bulk Git update, use `gh workflow run website.yml --ref main`. A failed import, link check or browser test blocks deployment. Fix the wiki and rerun; do not bypass the checks or commit the generated cache.

Before the first deployment:

1. In repository **Settings > Pages**, choose **GitHub Actions** as the source.
2. In **Settings > Environments > github-pages**, allow deployment from `main` if the environment restricts branches.
3. Merge a reviewed website PR into `main`. The default URL is `https://jdeffner.github.io/paradox-modding-toolkit/`.
4. When the custom domain is ready, set the Pages custom domain to `paradoxtoolkit.jdeffner.com`, set repository variables `WEBSITE_BASE=/` and `WEBSITE_ORIGIN=https://paradoxtoolkit.jdeffner.com`, then rerun the workflow.
5. Add the DNS CNAME `paradoxtoolkit` pointing to `jdeffner.github.io`, without the repository name. Enable HTTPS when GitHub finishes provisioning the certificate.

The workflow does not change DNS or the Pages custom-domain setting. An Actions deployment does not use a repository `CNAME` file; the custom domain is set in Pages settings. See [GitHub's custom-domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

All navigation, images, search results and canonical URLs use the selected base. The local preview server reads the base from the build, and browser tests use the same value. Local builds default to `/` and the intended custom-domain origin; CI defaults to the GitHub project URL until the repository variables are set.

## Design and media

`DESIGN.md` records the visual direction and sources. `/brand/` presents the public identity. The existing logo supplies charcoal, ivory and gold; Source Sans 3, Archivo and IBM Plex Mono are self-hosted with their SIL Open Font License files. The credits page preserves the toolkit's upstream acknowledgements and adds website dependencies.

The chosen identity is an ivory field guide, with humanist reading type, a persistent task index and paired source/result views. Source Sans 3 carries headings and prose; Archivo is reserved for the wordmark. `node scripts/social-card.mjs` regenerates the social preview from the same local font and logo. It requires the development dependencies and Playwright Chromium.

Three recordings cover the Event Graph, GUI editor and DDS mip inspection. The homepage features the Event Graph recording; `/demos/` offers all three for review and download. They were captured from the compiled 0.5.2 preview in an isolated VS Code 1.91 Extension Development Host. No source edits were saved.

Recordings live in `public/assets/demos/` with an accompanying capture manifest. They use playback controls and written equivalents. Screenshots retain the source wiki's filenames and provenance. No extracted game asset is distributed separately. Keep original capture sessions, temporary workspaces and alternate takes under the repository's ignored `.local/` folders.
