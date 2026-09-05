#!/usr/bin/env bash
#
# check_compat.sh — Compare two CK3 mods for potential file conflicts.
#
# Identifies compatibility issues between mods by checking for:
#   - Files that exist at the same relative path in both mods
#   - Top-level scripting keys defined in both mods (common/ files)
#   - Duplicate localization keys
#   - replace_path directives that hard-override vanilla directories
#
# Usage:
#   check_compat.sh <mod_dir_1> <mod_dir_2>
#
# Exit codes:
#   0 — no conflicts found
#   1 — conflicts found
#   2 — usage/input error

set -euo pipefail

# ── Usage ────────────────────────────────────────────────────────────────────

usage() {
    cat <<'USAGE'
Usage: check_compat.sh <mod_dir_1> <mod_dir_2>

Compare two CK3 mods for potential file conflicts.

Arguments:
  mod_dir_1   Path to the first mod directory
  mod_dir_2   Path to the second mod directory

The script checks for:
  1. File-level conflicts   — same relative path exists in both mods
  2. Key-level conflicts    — same top-level scripting keys in common/ files
  3. Localization conflicts  — same loc keys defined in both mods
  4. replace_path warnings  — directories flagged for hard override

Exit code is 0 when no conflicts are found, 1 when conflicts exist.
USAGE
}

if [[ $# -eq 0 ]] || [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
    usage
    exit 0
fi

if [[ $# -ne 2 ]]; then
    echo "Error: expected 2 arguments, got $#." >&2
    usage >&2
    exit 2
fi

MOD1="$1"
MOD2="$2"

# ── Validate paths ──────────────────────────────────────────────────────────

for dir in "$MOD1" "$MOD2"; do
    if [[ ! -d "$dir" ]]; then
        echo "Error: '$dir' is not a valid directory." >&2
        exit 2
    fi
done

MOD1_NAME="$(basename "$MOD1")"
MOD2_NAME="$(basename "$MOD2")"

# ── Temp files ──────────────────────────────────────────────────────────────

TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

FILES1="$TMPDIR_WORK/files1.txt"
FILES2="$TMPDIR_WORK/files2.txt"
COMMON_FILES="$TMPDIR_WORK/common_files.txt"

# ── Gather relative file lists ─────────────────────────────────────────────

# List all files relative to mod root, normalised with forward slashes, sorted.
list_files() {
    local base="$1"
    (cd "$base" && find . -type f | sed 's|^\./||' | sort)
}

list_files "$MOD1" > "$FILES1"
list_files "$MOD2" > "$FILES2"

# ── 1. File-level conflicts ────────────────────────────────────────────────

comm -12 "$FILES1" "$FILES2" > "$COMMON_FILES"
FILE_CONFLICT_COUNT=$(wc -l < "$COMMON_FILES" | tr -d ' ')

# ── 2. Key-level conflicts (common/ files) ──────────────────────────────────
#
# For each shared file under common/, extract top-level keys — lines that
# match `key_name = {` at column 0 (no leading whitespace).  Report keys
# that appear in both mods' versions of the same file.

KEYS1="$TMPDIR_WORK/keys1.txt"
KEYS2="$TMPDIR_WORK/keys2.txt"
KEY_CONFLICTS="$TMPDIR_WORK/key_conflicts.txt"
> "$KEY_CONFLICTS"

KEY_CONFLICT_COUNT=0

extract_top_keys() {
    # Matches lines like:  some_key = {  or  some_key={
    # Ignores lines starting with whitespace, comments, or @-variables.
    grep -E '^[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*=' "$1" 2>/dev/null \
        | sed 's/[[:space:]]*=.*//' \
        | sort -u || true
}

while IFS= read -r relpath; do
    case "$relpath" in
        common/*) ;;
        *) continue ;;
    esac

    extract_top_keys "$MOD1/$relpath" > "$KEYS1"
    extract_top_keys "$MOD2/$relpath" > "$KEYS2"

    shared_keys="$(comm -12 "$KEYS1" "$KEYS2")" || true
    if [[ -n "$shared_keys" ]]; then
        while IFS= read -r key; do
            echo "$relpath: $key" >> "$KEY_CONFLICTS"
            KEY_CONFLICT_COUNT=$((KEY_CONFLICT_COUNT + 1))
        done <<< "$shared_keys"
    fi
done < "$COMMON_FILES"

# ── 3. Localization conflicts ───────────────────────────────────────────────
#
# For shared localization files, extract loc keys (lines matching
# `  key_name:0 "..."` or `  key_name: "..."`).

LOC1="$TMPDIR_WORK/loc1.txt"
LOC2="$TMPDIR_WORK/loc2.txt"
LOC_CONFLICTS="$TMPDIR_WORK/loc_conflicts.txt"
> "$LOC_CONFLICTS"

LOC_CONFLICT_COUNT=0

extract_loc_keys() {
    # Loc keys are indented, followed by :<digit> or just : then a space/quote.
    grep -E '^[[:space:]]+[a-zA-Z_][a-zA-Z0-9_.]*:' "$1" 2>/dev/null \
        | sed 's/^[[:space:]]*//' \
        | sed 's/:.*//' \
        | sort -u || true
}

while IFS= read -r relpath; do
    case "$relpath" in
        localization/*|localisation/*) ;;
        *) continue ;;
    esac

    extract_loc_keys "$MOD1/$relpath" > "$LOC1"
    extract_loc_keys "$MOD2/$relpath" > "$LOC2"

    shared_loc="$(comm -12 "$LOC1" "$LOC2")" || true
    if [[ -n "$shared_loc" ]]; then
        while IFS= read -r key; do
            echo "$relpath: $key" >> "$LOC_CONFLICTS"
            LOC_CONFLICT_COUNT=$((LOC_CONFLICT_COUNT + 1))
        done <<< "$shared_loc"
    fi
done < "$COMMON_FILES"

# Also check for loc key clashes across *different* files (both mods' full
# localization trees), not just same-name files.  Collect all loc keys from
# each mod independently.

ALL_LOC1="$TMPDIR_WORK/all_loc1.txt"
ALL_LOC2="$TMPDIR_WORK/all_loc2.txt"
> "$ALL_LOC1"
> "$ALL_LOC2"

while IFS= read -r relpath; do
    case "$relpath" in
        localization/*|localisation/*) ;;
        *) continue ;;
    esac
    extract_loc_keys "$MOD1/$relpath" >> "$ALL_LOC1"
done < "$FILES1"

while IFS= read -r relpath; do
    case "$relpath" in
        localization/*|localisation/*) ;;
        *) continue ;;
    esac
    extract_loc_keys "$MOD2/$relpath" >> "$ALL_LOC2"
done < "$FILES2"

sort -u "$ALL_LOC1" -o "$ALL_LOC1"
sort -u "$ALL_LOC2" -o "$ALL_LOC2"

CROSS_LOC="$TMPDIR_WORK/cross_loc.txt"
comm -12 "$ALL_LOC1" "$ALL_LOC2" > "$CROSS_LOC"

# Remove keys already counted from same-file conflicts.
EXISTING_LOC_KEYS="$TMPDIR_WORK/existing_loc_keys.txt"
sed 's/^.*: //' "$LOC_CONFLICTS" | sort -u > "$EXISTING_LOC_KEYS" 2>/dev/null || true

CROSS_LOC_NEW="$TMPDIR_WORK/cross_loc_new.txt"
comm -23 "$CROSS_LOC" "$EXISTING_LOC_KEYS" > "$CROSS_LOC_NEW"
CROSS_LOC_COUNT=$(wc -l < "$CROSS_LOC_NEW" | tr -d ' ')

# Add cross-file loc conflicts to total.
LOC_CONFLICT_COUNT=$((LOC_CONFLICT_COUNT + CROSS_LOC_COUNT))

# ── 4. replace_path warnings ───────────────────────────────────────────────

REPLACE_PATHS="$TMPDIR_WORK/replace_paths.txt"
> "$REPLACE_PATHS"

REPLACE_PATH_COUNT=0

check_replace_path() {
    local mod_dir="$1"
    local mod_name="$2"
    local descriptor=""

    # Look for descriptor.mod or a *.mod file at the mod root.
    for f in "$mod_dir/descriptor.mod" "$mod_dir"/*.mod; do
        if [[ -f "$f" ]]; then
            descriptor="$f"
            break
        fi
    done

    if [[ -z "$descriptor" ]]; then
        return
    fi

    grep -E '^[[:space:]]*replace_path[[:space:]]*=' "$descriptor" 2>/dev/null \
        | sed 's/.*=[[:space:]]*//' \
        | sed 's/^"//' | sed 's/"$//' \
        | while IFS= read -r rpath; do
            echo "[$mod_name] replace_path = \"$rpath\"" >> "$REPLACE_PATHS"
            # We count inside the subshell, so count after the loop instead.
        done || true
}

check_replace_path "$MOD1" "$MOD1_NAME"
check_replace_path "$MOD2" "$MOD2_NAME"
REPLACE_PATH_COUNT=$(wc -l < "$REPLACE_PATHS" | tr -d ' ')

# ── Report ──────────────────────────────────────────────────────────────────

TOTAL=$((FILE_CONFLICT_COUNT + KEY_CONFLICT_COUNT + LOC_CONFLICT_COUNT + REPLACE_PATH_COUNT))

echo "============================================================"
echo " CK3 Mod Compatibility Report"
echo "============================================================"
echo ""
echo "  Mod A: $MOD1_NAME  ($MOD1)"
echo "  Mod B: $MOD2_NAME  ($MOD2)"
echo ""

# Section 1
echo "------------------------------------------------------------"
echo " 1. File-Level Conflicts  ($FILE_CONFLICT_COUNT)"
echo "------------------------------------------------------------"
if [[ "$FILE_CONFLICT_COUNT" -gt 0 ]]; then
    echo ""
    echo "The following files exist in both mods (same relative path):"
    echo ""
    while IFS= read -r f; do
        echo "  - $f"
    done < "$COMMON_FILES"
else
    echo ""
    echo "  No file-level conflicts."
fi
echo ""

# Section 2
echo "------------------------------------------------------------"
echo " 2. Key-Level Conflicts  ($KEY_CONFLICT_COUNT)"
echo "------------------------------------------------------------"
if [[ "$KEY_CONFLICT_COUNT" -gt 0 ]]; then
    echo ""
    echo "Both mods define the same top-level keys in these common/ files:"
    echo ""
    while IFS= read -r line; do
        echo "  - $line"
    done < "$KEY_CONFLICTS"
else
    echo ""
    echo "  No key-level conflicts in common/ files."
fi
echo ""

# Section 3
echo "------------------------------------------------------------"
echo " 3. Localization Conflicts  ($LOC_CONFLICT_COUNT)"
echo "------------------------------------------------------------"
if [[ "$LOC_CONFLICT_COUNT" -gt 0 ]]; then
    echo ""
    if [[ -s "$LOC_CONFLICTS" ]]; then
        echo "Same-file duplicate loc keys:"
        echo ""
        while IFS= read -r line; do
            echo "  - $line"
        done < "$LOC_CONFLICTS"
    fi
    if [[ "$CROSS_LOC_COUNT" -gt 0 ]]; then
        echo ""
        echo "Cross-file duplicate loc keys (defined in different files):"
        echo ""
        while IFS= read -r key; do
            echo "  - $key"
        done < "$CROSS_LOC_NEW"
    fi
else
    echo ""
    echo "  No localization conflicts."
fi
echo ""

# Section 4
echo "------------------------------------------------------------"
echo " 4. replace_path Warnings  ($REPLACE_PATH_COUNT)"
echo "------------------------------------------------------------"
if [[ "$REPLACE_PATH_COUNT" -gt 0 ]]; then
    echo ""
    echo "These mods use replace_path — this is a hard override that"
    echo "will completely replace a vanilla directory and break other"
    echo "mods that modify files in that path:"
    echo ""
    while IFS= read -r line; do
        echo "  ! $line"
    done < "$REPLACE_PATHS"
else
    echo ""
    echo "  No replace_path directives found."
fi
echo ""

# Summary
echo "============================================================"
echo " Summary"
echo "============================================================"
echo ""
echo "  File conflicts:          $FILE_CONFLICT_COUNT"
echo "  Key conflicts:           $KEY_CONFLICT_COUNT"
echo "  Localization conflicts:  $LOC_CONFLICT_COUNT"
echo "  replace_path warnings:   $REPLACE_PATH_COUNT"
echo "  ─────────────────────────────"
echo "  Total issues:            $TOTAL"
echo ""

if [[ "$TOTAL" -gt 0 ]]; then
    echo "Result: CONFLICTS FOUND — review the report above."
    exit 1
else
    echo "Result: No conflicts detected. These mods appear compatible."
    exit 0
fi
