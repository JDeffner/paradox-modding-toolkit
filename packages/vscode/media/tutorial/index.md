# CK3 Modding Tutorial

Welcome. This tutorial takes you from "never modded a Paradox game" to building complete, patch-safe, performant Crusader Kings III mods. It is written for the Paradox Toolkit extension, so along the way you will also learn the tooling that makes the work faster: completion, hover docs, the event graph, ck3-tiger diagnostics, localization tools and more.

Every code snippet in these pages was checked against the actual game files (CK3 1.19) or against Paradox's own `.info` schema documents that ship inside the game folder. When you finish, you will know not just the syntax but the habits that separate mods that work from mods that silently do nothing.

## How to read this

The chapters build on each other through a small running example, a "chronicle" mod: a decision, an event chain, a trait, a custom HUD element. You can follow along hands-on or just read; each chapter is self-contained enough to use as a reference later.

If you have modded CK3 before, skim Chapters 1 and 2 anyway. They cover the override rules and the silent-failure problem, which are where most experienced modders still lose hours.

## Chapters

| # | Chapter | What you will learn |
|---|---------|--------------------|
| 1 | [Setup and how CK3 loads mods](01-setup.md) | Folder layout, `.mod` files, encoding rules, override order (LIOS vs FIOS), why failures are silent |
| 2 | [Your first mod](02-first-mod.md) | A working decision with localization, tested in-game with the debug console |
| 3 | [The script language](03-script-language.md) | Blocks, scopes, triggers vs effects, variables, lists, script values, scripted effects and `$PARAM$` macros |
| 4 | [Events and on_actions](04-events.md) | Event anatomy, portraits and themes, event chains, hooking into the game with on_actions (safely) |
| 5 | [Decisions and character interactions](05-decisions-interactions.md) | The full decision schema, interactions, `ai_accept` craft, AI targeting |
| 6 | [Content databases and localization](06-content.md) | Traits, cultures, faiths, and the localization workflow in depth |
| 7 | [Custom GUI](07-gui.md) | PdxGui, scripted_widgets injection, data binding, the test-window loop |
| 8 | [Graphics and icons](08-graphics.md) | DDS formats, exact icon sizes, coats of arms, the image converter |
| 9 | [Validation and debugging](09-debugging.md) | ck3-tiger, `error.log`, `script_docs`, console commands, the silent-failure checklist |
| 10 | [Performance and design patterns](10-performance-patterns.md) | Bounded lists, AI gating, story cycles, and battle-tested patterns from major mods |

## The three sources of truth

Keep these bookmarked; the tutorial refers to them constantly:

1. **The game files.** Your CK3 install's `game/` folder is the ultimate reference. Roughly 150 `_*.info` files inside `common/` subfolders (for example `common/decisions/_decisions.info`, `common/on_action/_on_actions.info`, `events/_events.info`) are Paradox's own schema documentation, more current than any wiki. With a file open, run **Paradox: Open Format Docs (.info) for This File** to jump straight to the matching one.
2. **`script_docs` dumps.** The in-game console command `script_docs` writes the complete, version-exact list of every effect, trigger, scope and event target to your logs folder. The extension reads these for completion and hover (see [Chapter 9](09-debugging.md)).
3. **Vanilla examples.** Never write script from scratch. Find a vanilla file that does something similar, copy it, modify it. The game's `events/tutorial_events.txt` and `common/scripted_triggers/00_bastard_triggers.txt` are annotated goldmines.

## Before you start

Run **Paradox: Run Setup & Health Check** from the Command Palette (`Ctrl+Shift+P`). It finds your CK3 install through Steam, checks the logs folder and offers to download the ck3-tiger validator. Then open your mod folder (the one containing `common/`, `events/`, `localization/`) as your VS Code workspace so the extension can index it.

Ready? Start with [Chapter 1: Setup and how CK3 loads mods](01-setup.md).
