# descriptor-missing

**Severity:** Error · **Source:** `ck3-descriptor`

## What breaks
The mod folder contains CK3 content (`common/`, `events/`, …) but no
`descriptor.mod` in its root. Every mod needs one: the launcher reads it to
list and load the mod, Steam Workshop uploads are driven by it, and ck3-tiger
refuses to validate a folder without it (so the extension's tiger diagnostics
stay disabled too).

## Why
Mods created through the launcher ("Upload Mod → Create a Mod") get a
descriptor automatically; folders created by hand or cloned from a repo often
lack one. The diagnostic is anchored to the missing file's path in the mod
root.

## How to fix
Run **Paradox: Create descriptor.mod** (also offered in the error notification).
It writes a launcher-correct starter file with the mod name derived from the
folder and `supported_version` matching your installed game:

```
version="0.1.0"
tags={
	"Gameplay"
}
name="My Mod"
supported_version="1.19.*"
```

The check only fires when the folder actually looks like a CK3 mod, so opening
an unrelated workspace never raises it.
