# Automatic setup

**Paradox: Run Setup & Health Check** does the tedious part for you:

- finds your game installation (CK3, Victoria 3 or EU5 — whichever this workspace mods) by reading Steam's library folders, on any drive
- writes `px.gamePath` into your settings
- locates the Paradox logs folder (redirected Documents folders included)
- offers to download the **ck3-tiger** validator (~15 MB, from github.com/amtep/tiger)

Re-run it anytime as a health check — it reports what's configured and what's missing, with instructions.

You can watch what the extension is doing in **Output → Paradox Toolkit**.
