# Chapter 2: Your first mod

Time to make something real: a decision that lets any ruler commission a chronicle of their deeds, paying gold for prestige. Small, but it exercises the full loop you will use for everything: write script, write localization, validate, test in-game.

## The plan

A **decision** is a button in the Decisions tab. It needs:

1. A script file in `common/decisions/`
2. Localization for its name, description and confirm button
3. (Optionally) an illustration, an AI opinion of it, a cooldown

We will write it by hand so you understand every line. For future content, the **Paradox: New Content** command scaffolds a decision, event, interaction or on_action hook with all the boilerplate and matching localization in one step.

## Step 1: the decision script

Create `common/decisions/chron_decisions.txt` in your mod folder:

```
# Commission a Chronicle
# Any adult landed ruler can pay 50 gold for 150 prestige, once every 10 years.
chron_commission_chronicle_decision = {
	picture = {
		reference = "gfx/interface/illustrations/decisions/decision_misc.dds"
	}
	decision_group_type = major

	desc = chron_commission_chronicle_decision_desc

	is_shown = {
		is_ruler = yes
		is_landed = yes
	}
	is_valid_showing_failures_only = {
		is_available_adult = yes
	}

	cost = {
		gold = 50
	}
	cooldown = { years = 10 }

	effect = {
		add_prestige = 150
	}

	ai_check_interval = 60
	ai_potential = {
		short_term_gold >= 60
	}
	ai_will_do = {
		base = 20
		modifier = {
			add = 40
			has_trait = ambitious
		}
	}
}
```

Walk through the anatomy:

- **The key** (`chron_commission_chronicle_decision`) must be unique game-wide. The `chron_` prefix is your mod tag; the `_decision` suffix is the vanilla naming convention. Both matter: prefixes prevent collisions with other mods, and conventions help tools (and other modders) understand your code.
- **`is_shown`** decides whether the decision appears in the list at all. **`is_valid_showing_failures_only`** lists failed conditions to the player as requirements ("You must not be a child"). There is also a plain `is_valid`, shown under Requirements in the detail view. Keep `is_shown` for things the player cannot change right now and the `is_valid` variants for things they can work toward.
- **`cost`** is deducted automatically. Its sibling `minimum_cost` blocks the decision when unaffordable without deducting anything (for decisions that charge inside their effect).
- **`effect`** is what actually happens. Conditions never go here; effects never go in the `is_` blocks. This trigger/effect split is the deepest grammar rule in the language ([Chapter 3](03-script-language.md)).
- **AI blocks**: `ai_check_interval` is how often (in months) the AI evaluates the decision, and per the schema doc it must be set (or `ai_goal = yes` used) or the decision is broken for AI. `ai_potential` is a cheap pre-filter; `ai_will_do` returns a percent chance of taking it. An interval of `0` means the AI never checks, which is a legitimate choice for player-only content.
- **`picture`** points at a vanilla illustration; you can supply several `picture` blocks with `trigger`s and the first matching one is used. We borrow `decision_misc.dds` from vanilla. Chapter 8 covers making your own.

As you type this, notice what the extension does: inside `is_shown` it suggests only triggers, inside `effect` only effects. Hover `add_prestige` for its documentation. This context awareness is your first line of defense against the trigger/effect mixup.

## Step 2: the localization

Decisions derive their loc keys from the decision id automatically:

| Key | Used for |
|---|---|
| `<id>` | The decision's name in the list |
| `<id>_desc` | The description text |
| `<id>_tooltip` | The tooltip when selecting it from the list |
| `<id>_confirm` | The confirm button label |

Create `localization/english/chron_l_english.yml`. Three rules, all mandatory:

1. Filename ends in `_l_english.yml`
2. First line is `l_english:`
3. Encoding is **UTF-8 with BOM**

```yaml
l_english:
 chron_commission_chronicle_decision: "Commission a Chronicle"
 chron_commission_chronicle_decision_desc: "A learned scribe could record the deeds of [ROOT.Char.GetTitledFirstName] for posterity. Such flattery is not cheap."
 chron_commission_chronicle_decision_tooltip: "Pay a scribe to immortalize your reign."
 chron_commission_chronicle_decision_confirm: "Let it be written"
```

Note the format: **one leading space** before each key, then `key:` (an optional number after the colon, like `key:0`, is a legacy versioning marker you will see everywhere in vanilla), then the text in quotes. `[ROOT.Char.GetTitledFirstName]` is a data function that inserts the character's name at runtime; Chapter 6 goes deep on these.

The extension helps here more than anywhere: it shows the localized text inline next to script keys, flags keys that have no localization, and the lightbulb on a script key offers "Add localization" so you never have to leave the script file. **Paradox Localization: Edit Key at Cursor** and **Paradox Localization: Open Side by Side** round out the workflow.

If you save the yml without a BOM, the extension raises a `missing-bom` diagnostic. Heed it. This single byte is the most common reason localization "does not work".

## Step 3: validate before you launch

If you set up ck3-tiger (Chapter 1 walkthrough, or **Paradox Tiger: Download or Update Binary**), the extension runs it on every save and shows problems as squiggles in the editor and in the Problems panel. A clean tiger run before launching the game saves you a restart cycle per bug. Chapter 9 covers tiger in depth.

## Step 4: test in-game

1. Launch with `-debug_mode` (or use **Paradox: Launch CK3 (debug mode)**).
2. Load or start any game as a landed adult ruler.
3. Open the Decisions tab. "Commission a Chronicle" should be listed under major decisions.
4. Take it. Watch your gold drop by 50 and prestige rise by 150.

Useful console commands for this loop (open the console with the backtick key):

```
effect add_gold = 1000                                  # fund your tests
effect remove_decision_cooldown = chron_commission_chronicle_decision
```

The console runs any effect or trigger on your current character, which makes it a scratchpad for the whole script language. `trigger is_ruler = yes` prints whether the condition holds.

## When it does not show up

Work through this list in order; it is the Chapter 1 material biting:

1. **Folder path**: is the file at `common/decisions/` exactly? (Not `common/decision/`, not `decisions/`.)
2. **Playset**: is the mod actually enabled in the launcher playset you launched?
3. **Braces**: an unbalanced brace aborts parsing for the rest of the file. Check `error.log` in your logs folder for a parse error, and let the editor's brace matching help.
4. **`is_shown` too strict**: test as a character who definitely passes (`is_ruler`, `is_landed`).
5. **Loc shows as raw key** (`chron_commission_chronicle_decision` in-game): the yml is not loading. Check the filename suffix, the first line and the BOM.

`error.log` lives in `Documents\Paradox Interactive\Crusader Kings III\logs\`. The extension's **Paradox: Toggle error.log Watcher** command tails it live into the Output panel while you test.

## What you just learned

The loop you ran (script → localization → tiger → in-game test → error.log) is the whole craft. Everything after this chapter adds vocabulary and patterns, but the loop never changes.

## Try it

1. Add a second cost to the decision: `piety = 10` inside the `cost` block. Confirm the decision now shows both costs.
2. Add a `modifier` to `ai_will_do` that makes `greedy` AI characters less likely to pay for flattery (negative `add`).
3. Deliberately rename the loc file to `chron_english.yml`, launch, and observe the raw keys in-game. Rename it back. Now you have seen the failure mode once in a controlled setting, you will recognize it forever.

Next: [Chapter 3: The script language](03-script-language.md) · [Back to index](index.md)
