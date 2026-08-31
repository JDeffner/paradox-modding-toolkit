## Paradox Modding Toolkit 0.3.0 (beta)

The CK3 Modding Toolkit is now the **Paradox Modding Toolkit**, and it speaks
three games. This is the first release under the new name, the new extension ID
and the new monorepo layout, and it is the largest release so far.

> **Moving from the old extension:** this ships as a new listing,
> `JDeffner.px-toolkit`. Install it and uninstall the old
> `JDeffner.ck3-modding-toolkit`, which is now deprecated. Your settings move
> with a rename: every `ck3.*` setting is now `px.*` (`ck3.gamePath` becomes
> `px.gamePath`), commands are prefixed **Paradox** instead of **CK3**, and the
> inline suppression comment is `# px:ignore` instead of `# ck3m:ignore`.
> Nothing about your mod files changes.

### Full changelog

Every change in this release, with the reasoning behind it, is in
[CHANGELOG.md](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/packages/vscode/CHANGELOG.md).
The same text is the Changelog tab on the
[Marketplace listing](https://marketplace.visualstudio.com/items/JDeffner.px-toolkit/changelog).

The short version: Victoria 3 is first-class, Europa Universalis V ships as a
community-sourced profile, and CK3 users need to change nothing. New since
0.1.x: a Project panel, an event simulator, a visual GUI editor, a redesigned
event graph, bundled `script_docs` snapshots per game, full-depth outlines, and
a standalone language server you can run from neovim, Zed, Helix or your own
application.

Beta means young, not unusable. It is what I mod with daily. Tell me what
breaks: [issues](https://github.com/JDeffner/paradox-modding-toolkit/issues).
