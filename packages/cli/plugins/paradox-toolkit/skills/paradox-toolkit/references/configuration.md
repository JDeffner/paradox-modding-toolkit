# Configure pxtk

Install the prepared `@px-lsp/cli` package first. Confirm `pxtk --version` works. If it is not on PATH, invoke `node <package>/dist/pxtk.cjs` with the same arguments.

Store local settings in the mod's `.px-toolkit/pxtk.json`, or pass `--config <file>`. Keep machine-specific paths out of version control.

```json
{
  "game": "ck3",
  "gamePath": null,
  "logsPath": null,
  "tigerPath": null,
  "parents": [],
  "language": "english"
}
```

This example deliberately has no installed sources. Set the paths to the user's actual game data, generated script documentation, and validator. Omitting gamePath enables Steam discovery; explicit null disables it. Relative paths in the standard config resolve from the mod/project folder. Dependency order is base first.

Flags override environment variables, which override the config. `PX_GAME_ID` selects the profile. Per-game variables follow the existing toolkit convention: `PX_CK3_GAME_PATH`, `PX_CK3_LOGS_PATH`, `PX_CK3_MOD_PATH`, and `PX_CK3_TIGER_PATH`, with the selected game's uppercase identifier in place of CK3.

For MCP, start `pxtk mcp --config <file>` from the mod folder, or set those environment variables in the client's local server configuration. MCP exposes status, search, inspect, impact, validate, init, create, loc, logs, format and image. Preparation writers preview by default; set write to true to apply, and pass expect with the preview token to reject stale inputs. Baseline creation remains a CLI operation. Both interfaces share the same result contract and operate on saved files.

Existing Tiger configuration in the toolkit config directory takes precedence over the mod-root Tiger configuration. An explicit tigerConfig takes precedence over both. That file controls Tiger's own dependency loading and suppressions; inspect it if its settings differ from the CLI's declared parents.

Portable project.json supplies the selected mod's authoring and diagnostic rules. Localization.json supplies author defaults, including language when not selected through CLI settings. Schema, playset, project and localization artifacts each read their legacy fallback independently. The CLI does not read VS Code's private machinePaths registry. Keep execution paths in CLI flags, environment variables or ignored pxtk.json.

Create and loc set use the shared localization policy. Existing entries stay in their owned file; new keys use configured destinations, meaningful siblings, source files and established layouts. New vanilla overrides require a replace folder. Generated files require their source workflow. Changed defaults invalidate previews and validation baselines.
