# Diagnostic codes

Every structural diagnostic the extension raises carries a stable code. These
target the **silent-failure class** — mistakes that make CK3 quietly ignore your
content with no error output. Each page explains the in-game consequence, why it
happens, and how to fix it.

| Code | Severity | Source | What breaks in game |
|---|---|---|---|
| [unclosed-brace](./unclosed-brace.md) | Error | `ck3-script` | Rest of the file after the `{` is ignored |
| [stray-close](./stray-close.md) | Error | `ck3-script` | Engine misreads the rest of the file |
| [unterminated-string](./unterminated-string.md) | Warning | `ck3-script` | Following tokens absorbed into the string |
| [missing-value](./missing-value.md) | Warning | `ck3-script` | Assignment has no value; setting is lost |
| [missing-bom](./missing-bom.md) | Error | `ck3-script` | Whole loc file ignored (no UTF-8 BOM) |
| [loc-header-mismatch](./loc-header-mismatch.md) | Error | `ck3-script` | Loc entries not loaded (header ≠ filename language) |
| [loc-no-header](./loc-no-header.md) | Error | `ck3-script` | No `l_<lang>:` header → no entries load |
| [loc-bad-entry](./loc-bad-entry.md) | Warning | `ck3-script` | Malformed line skipped; key shows raw |
| [loc-tab-indent](./loc-tab-indent.md) | Error | `ck3-script` | Tab-indented entries rejected |
| [loc-content-before-header](./loc-content-before-header.md) | Warning | `ck3-script` | Entries above the header are dropped |
| [loc-bad-filename](./loc-bad-filename.md) | Error | `ck3-script` | File without `_l_<lang>.yml` marker ignored |
| [wrong-on-action-folder](./wrong-on-action-folder.md) | Error | `ck3-script` | `common/on_actions/` (plural) ignored |
| [wrong-localization-folder](./wrong-localization-folder.md) | Error | `ck3-script` | `localisation/` (British) ignored |
| [unknown-event](./unknown-event.md) | Warning | `ck3-script` | `trigger_event` to a non-existent mod event does nothing |
| [missing-required-loc](./missing-required-loc.md) | Warning | `ck3-script` | Definition shows raw loc keys in game |
| [descriptor-missing](./descriptor-missing.md) | Error | `px-descriptor` | Mod folder has no `descriptor.mod`; launcher/Workshop/tiger can't use it |
| [descriptor-missing-field](./descriptor-missing-field.md) | Error/Warning | `px-descriptor` | Launcher can't list the mod (`name`/`version`) or check compatibility (`supported_version`) |
| [descriptor-unknown-key](./descriptor-unknown-key.md) | Warning | `px-descriptor` | Key silently ignored by the launcher |
| [descriptor-duplicate-key](./descriptor-duplicate-key.md) | Warning | `px-descriptor` | Only the last of the duplicate values counts |
| [descriptor-path-ignored](./descriptor-path-ignored.md) | Warning | `px-descriptor` | `path=` inside descriptor.mod is dead weight and leaks machine paths |
