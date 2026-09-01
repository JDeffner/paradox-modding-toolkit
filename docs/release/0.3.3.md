# Paradox Modding Toolkit 0.3.3 (beta)

One fix, shipped fast because it blocks new installs.

### The tiger download works again

GitHub changed where it serves release downloads from: the old address was
`objects.githubusercontent.com`, the new one is
`release-assets.githubusercontent.com`. The toolkit checks every download
address against a safety list before it runs what it downloaded, and the new
address was not on that list. So the tiger download stopped with "refusing to
follow the redirect" and diagnostics never arrived.

Both addresses are on the list now (GitHub still uses both). If the download
failed for you, run **Paradox: Run Setup & Health Check** again after the
update.

Thanks to the user who sent the error screenshot.

### Full changelog

[CHANGELOG.md](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/packages/vscode/CHANGELOG.md).

Beta means young, not unusable. Tell me what breaks:
[issues](https://github.com/JDeffner/paradox-modding-toolkit/issues).
