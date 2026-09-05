# Agent skills for Paradox modding

Two skills teach a coding agent how to mod a Paradox game without inventing
script names. They follow the open [Agent Skills](https://agentskills.io)
format, so the same folder installs into Claude Code, Cursor, Codex, Copilot,
Windsurf, Cline, Zed, OpenCode and about seventy other agents.

| Skill | Game | What it carries |
|---|---|---|
| `ck3-modding` | Crusader Kings III | Ground truth from the installed game (`_*.info` schema docs, `script_docs` dumps), ck3-tiger validation, 25 per-system recipes, idiom notes from Princes of Darkness and A Game of Thrones |
| `vic3-modding` | Victoria 3 | The 91 in-game schema docs, `script_docs` lookups, vic3-tiger, economy, politics, journal entries, GUI |

Each skill ships a small Python 3 script (`scripts/ck3_docs.py`,
`scripts/vic3_docs.py`) that finds the game and its logs on the machine,
checks whether an effect or trigger exists in the installed build, and points
at the schema doc for a folder. No packages beyond the standard library.

## Install

**Any agent, one command.** The [skills CLI](https://skills.sh) picks the right
folder for whichever agents it finds on the machine:

```bash
npx skills add JDeffner/paradox-modding-toolkit
```

It lists both skills and asks which to install. To skip the prompts:

```bash
npx skills add JDeffner/paradox-modding-toolkit --skill ck3-modding -a claude-code -a cursor -g -y
```

`-g` installs for the user instead of the current project. `-a '*'` targets
every detected agent. Later, `npx skills update` pulls new versions.

**Claude Code, as a plugin.** The repo is also a Claude Code plugin
marketplace, so the skills can be managed from `/plugin`:

```
/plugin marketplace add JDeffner/paradox-modding-toolkit
/plugin install paradox-modding-skills@paradox-modding-toolkit
```

The plugin holds both skills. `/plugin marketplace update` refreshes it.

**Claude.ai and the Claude desktop app.** Zip one skill folder (the folder
that holds `SKILL.md`) and upload it under Settings, Capabilities, Skills.

**By hand.** Copy a skill folder into wherever your agent reads skills, for
example `~/.claude/skills/` for Claude Code or `.cursor/skills/` in a project
for Cursor. Keep the folder name; the skill's `name` must match it.

## First run

Ask the agent to check its bearings:

```bash
python scripts/ck3_docs.py paths
```

It prints where the game, the logs, the mod folder, the Workshop content and
ck3-tiger were found, the installed patch, the DLC list, and how old the
`script_docs` dumps are. NOT FOUND on the logs line means the game has not
been launched on this machine yet. NOT FOUND on the dumps means you need to
launch once with `-debug_mode` and run `script_docs` in the console, which
the skill will ask you to do when it needs them.

Paths can be forced with `--game`, `--logs` and `--tiger`, or the `CK3_GAME`,
`CK3_LOGS` and `CK3_TIGER` environment variables. The Victoria 3 script takes
`--game` and `--docs`, or `VIC3_GAME` and `VIC3_DOCS`.

## Sharing

Send someone the install line above. Nothing in the skills is tied to a
machine: every path is resolved at run time, and the text only ever names
placeholders like `<game>` and `<logs>`.

## Editing

The skills in this folder are the only copy. Edit them here, then reinstall
(`npx skills update`, or `/plugin marketplace update` followed by a reinstall)
to see the change in your agent. `SKILL.md` stays under 500 lines; anything
longer moves to `references/`. The `_*.info` docs, the `script_docs` dumps
and the vanilla files stay the source of truth for game facts, so a change
that adds a trigger or effect name from memory does not belong here.
