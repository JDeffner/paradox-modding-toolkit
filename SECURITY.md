# Security Policy

## Supported versions

Only the latest release of each package gets security fixes.

| Package | Where |
|---|---|
| `JDeffner.px-toolkit` (VS Code extension) | VS Code Marketplace, GitHub Releases |
| `@px-lsp/server`, `@px-lsp/protocol` | npm |

Update to the current version before you report a problem that an older
version shows.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Use GitHub private vulnerability reporting:
https://github.com/JDeffner/paradox-modding-toolkit/security/advisories/new

Include:

- The package and version.
- Steps to reproduce, or a proof of concept.
- What an attacker gains (file read, code execution, data sent off the
  machine).

You get a first reply within 7 days. A confirmed problem gets a fix in the
next release and a GitHub Security Advisory with credit to you, unless you
ask to stay anonymous.

## Scope

In scope:

- The extension host code (`packages/vscode`), the LSP server
  (`packages/server`) and the protocol package (`packages/protocol`).
- Webview panels (GUI editor, event graph, Examples Wiki, DDS viewer,
  Workshop panel).
- The tiger download and run path.
- The Steam Workshop upload bridge.
- Files the toolkit writes into a mod (localization, scaffolds, descriptor).

Out of scope:

- Bugs in ck3-tiger, vic3-tiger, steamworks.js or the Paradox games.
- Problems that need a malicious VS Code extension or a compromised machine.
- Mod content that crashes the game. The games fail silently by design;
  that is a modding bug, not a security bug.

## What the toolkit does with your machine

The toolkit reads game files, mod folders and log dumps that you configure.
It does not send data off the machine except:

- Downloading tiger binaries from their GitHub releases when you ask.
- Uploading a mod to Steam Workshop when you ask, through the local Steam
  client.

If you find behavior outside this list, report it.
