---
name: paradox-toolkit
description: Research Paradox mod changes, prepare scripts, localization and images, and validate saved mod files with pxtk.
---

# Paradox Toolkit

Use the local `pxtk` commands or equivalent `pxtk_*` MCP tools to ground mod work in the selected game and mod. The toolkit works without VS Code. Use either the CLI or MCP available in the client; do not repeat an operation through both. Toolkit writers preview changes and apply them only in explicit write mode.

## Choose the workspace

Read the project's instructions and use its configured game, mod, dependencies, and validation target. Run `pxtk status --json` when the workspace is new or configuration has changed. If setup is missing, use `pxtk --help` and [configuration.md](references/configuration.md). Never guess a game identifier or silently validate against a different installation.

Status distinguishes loaded documentation from files merely present on disk. A generated dump is not proof that it matches the installed patch. If Tiger is unavailable, preserve that limitation in the result.

## Find evidence for a change

- Search with a narrow term: `pxtk search "<term>" --json`.
- Inspect a matching identifier: `pxtk inspect <name> --kind <kind> --json`.
- Use `pxtk impact <name> --kind <kind> --json` before changing a definition used elsewhere.
- Follow the returned file locations to read the surrounding code when an excerpt is insufficient. Unknown identifiers and ambiguous names require more evidence.
- Scope information is guidance. It does not establish that a construct is invalid.

Keep game identifiers, accepted fields, and example code tied to the returned sources. Use the project's scripting, GUI, or playtesting instructions for domain-specific work.

## Edit and check

Use pxtk create to list profile-supported scaffolds, loc get/set/check for localization, format for indentation and image inspect/convert for texture preparation. Use --help for arguments. Writers preview by default. Apply authorized changes with --write and the returned token in --expect; if the token is stale, review a fresh preview. Save relevant editor buffers first. Do not use localization/replace for new keys. Image outputs must be new files; JPEG transparency needs an explicit background, and DDS output has no generated mipmaps.

For playtests, create a fresh checkpoint with pxtk logs checkpoint --output .px-toolkit/before-test.json --write, then read pxtk logs --since .px-toolkit/before-test.json. Report rotation and unparsed entries. Reading logs does not establish that the intended gameplay behavior occurred.

Preserve unrelated work. Game and dependency folders are reference inputs. These commands cannot see unsaved editor text, so establish which saved files are intended for the check before relying on the result.

For a change to an existing mod, a baseline can separate old findings from newly introduced ones:

```sh
pxtk validate --write-baseline .px-toolkit/before-change.json --json
# Make the requested edits using the client's normal file tools.
pxtk validate --baseline .px-toolkit/before-change.json --json
```

A baseline file is created once and never overwritten. Do not recreate it after introducing errors to make them disappear. Baseline comparison rejects changed validation inputs. Check the listed reason and establish a fresh baseline before starting a new task or target-version migration.

Report new errors, relevant warnings, unavailable checks, and preserved pre-existing findings. A structural and Tiger pass is static evidence only. Claim runtime behavior only after the actual game behavior has been observed.

The CLI uses exit 0 for completed work without new errors, 1 for new errors/no match/ambiguity, and 2 for unavailable checks or execution failures. Read the JSON status and coverage, not only the process exit code. Do not treat truncated results as the complete set.
