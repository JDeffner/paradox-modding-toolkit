<div align="center">

<img src="https://raw.githubusercontent.com/JDeffner/paradox-modding-toolkit/legacy-listing/media/banner.png" alt="CK3 Modding Toolkit">

# CK3 Modding Toolkit — moved to the Paradox Modding Toolkit

</div>

> ## ⚠️ This listing is deprecated
>
> **This extension is deprecated and no longer developed.** It continues as the
> **[Paradox Modding Toolkit](https://marketplace.visualstudio.com/items?itemName=JDeffner.px-toolkit)**
> (`JDeffner.px-toolkit`), which is the same tool, further along, and speaks
> Crusader Kings III, Victoria 3 and Europa Universalis V.
>
> **[→ Install the Paradox Modding Toolkit](https://marketplace.visualstudio.com/items?itemName=JDeffner.px-toolkit)**,
> then uninstall this one. Nothing about your mod files changes.

## Why it moved

The toolkit was never CK3-specific under the hood: a Paradox-script parser, a
scope engine and a schema table. Victoria 3 and Europa Universalis V slot into
the same machinery, so carrying `ck3` in the extension id, the settings and every
command name had become a lie. The rename to `JDeffner.px-toolkit` is the honest
version, and because a Marketplace listing cannot change its id, it had to ship
as a new listing. This one stays up only to point you at it.

Everything CK3 users had is still there, and there is a lot more of it: a Project
panel, an event simulator, a visual GUI editor, a redesigned event graph, bundled
`script_docs` snapshots per game, full-depth outlines, and a standalone language
server you can run from neovim, Zed, Helix or your own application.

## How to move over

1. Install
   **[Paradox Modding Toolkit](https://marketplace.visualstudio.com/items?itemName=JDeffner.px-toolkit)**
   (`JDeffner.px-toolkit`).
2. Uninstall **CK3 Modding Toolkit** (`JDeffner.ck3-modding-toolkit`). Running
   both at once means two language servers indexing the same mod — it works, but
   it is wasteful and the diagnostics double up.
3. Rename your settings. Everything else follows automatically.

| Old (this extension) | New (`px-toolkit`) |
|---|---|
| `ck3.gamePath` and every other `ck3.*` setting | the same key under `px.*` (`px.gamePath`) |
| Commands prefixed **CK3:** | the same commands prefixed **Paradox:** |
| `# ck3m:ignore` suppression comment | `# px:ignore` |
| File association `paradox` / CK3 script | unchanged, plus `paradox-vic3` and `paradox-eu5` |

Your mod folders, your `.mod` files and your tiger setup are untouched. The
[0.3.0 release notes](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/docs/release-notes-0.3.0.md)
have the full migration detail.

## Where everything lives now

- **Extension**: [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=JDeffner.px-toolkit)
- **Source**: [JDeffner/paradox-modding-toolkit](https://github.com/JDeffner/paradox-modding-toolkit)
- **Docs**: [wiki](https://github.com/JDeffner/paradox-modding-toolkit/wiki)
- **Issues and feedback**: [issue tracker](https://github.com/JDeffner/paradox-modding-toolkit/issues)
  — bug reports against this old extension will be closed with a pointer to the
  new one, so please file them there.

This repository's `legacy-listing` branch is the frozen source of the final
0.1.x build, kept for history and for the GPL obligation. It receives no fixes.

## License

GPL-3.0-or-later. In short: use, modify and redistribute freely, but any
distributed fork or derivative must publish its source under the GPL too. See
[LICENSE](https://github.com/JDeffner/paradox-modding-toolkit/blob/legacy-listing/LICENSE). Bundled third-party data keeps its own terms (`wikidocs/` is
CC BY-SA, see [wikidocs/ATTRIBUTION.md](https://github.com/JDeffner/paradox-modding-toolkit/blob/legacy-listing/wikidocs/ATTRIBUTION.md)).
