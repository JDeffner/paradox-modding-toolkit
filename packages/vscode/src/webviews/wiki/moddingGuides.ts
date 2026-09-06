/**
 * The game wiki's modding pages, one list per game, for the wiki hub's
 * Modding Guides page: where to read up on an area of modding before or
 * while working in it.
 *
 * Taken from each wiki's Modding navbox on 2026-09-06 (the `base` of each
 * list plus `/Modding` is the page the navbox sits on). The one-line text of
 * every card was written from the page's own lead paragraph, not from its
 * title. Redirect pages (Checksum, EU5's Event target and Mod files load
 * order) are left out, as is Vic3's Grester's Compendium, a user page.
 */

import type { IconName } from "../shared/icons";
import type { WikiCard } from "./messages";

type Category =
  | "Basics"
  | "Script reference"
  | "Scripting"
  | "Interface and localization"
  | "Map"
  | "Graphics"
  | "Audio"
  | "Guides";

export interface GuidePage {
  title: string;
  /** The wiki path, `/Sound_modding`. */
  path: string;
  category: Category;
  what: string;
}

export interface GameGuideList {
  /** The wiki's origin, `https://ck3.paradoxwikis.com`. */
  base: string;
  pages: GuidePage[];
}

/** The category order every game's page follows: the wiki's own groups, merged. */
const CATEGORIES: Category[] = [
  "Basics",
  "Script reference",
  "Scripting",
  "Interface and localization",
  "Map",
  "Graphics",
  "Audio",
  "Guides",
];

const CATEGORY_ICONS: Record<Category, IconName> = {
  Basics: "info",
  "Script reference": "bookOpen",
  Scripting: "variable",
  "Interface and localization": "layoutTemplate",
  Map: "map",
  Graphics: "image",
  Audio: "activity",
  Guides: "sparkles",
};

export const MODDING_GUIDES: Record<string, GameGuideList> = {
  ck3: {
    base: "https://ck3.paradoxwikis.com",
    pages: [
      {
        title: "Modding",
        path: "/Modding",
        category: "Basics",
        what: "Entry page on modifying the game's assets or behaviour, covering creating, uploading and installing mods and load order.",
      },
      {
        title: "Mod structure",
        path: "/Mod_structure",
        category: "Basics",
        what: "Explains where mods live, the paired .mod file and mod folder, and the descriptor syntax and keys.",
      },
      {
        title: "Mod compatibility",
        path: "/Mod_compatibility",
        category: "Basics",
        what: "Explains practices and techniques that let mods work together, including shared variables, shared scripted effects and compatibility patches.",
      },
      {
        title: "Mod troubleshooting",
        path: "/Mod_troubleshooting",
        category: "Basics",
        what: "Debugging a mod: the developer console, the debug tools, localization debugging and error spam.",
      },
      {
        title: "Console commands",
        path: "/Console_commands",
        category: "Basics",
        what: "Lists the console commands available in debug mode, with debug info, cheats, artifact spawning and converting commands.",
      },
      {
        title: "Scripting",
        path: "/Scripting",
        category: "Script reference",
        what: "Introduces the custom scripting language mods use to add and change game content, with syntax, testing and documentation notes.",
      },
      {
        title: "Scopes",
        path: "/Scopes",
        category: "Script reference",
        what: "Explains scopes, the way script selects entities such as characters or titles before checking triggers or running effects.",
      },
      {
        title: "Effects",
        path: "/Effects",
        category: "Script reference",
        what: "Covers effects, the script commands that change the game state, including effect blocks, syntax, scripted effects and control effects.",
      },
      {
        title: "Triggers",
        path: "/Triggers",
        category: "Script reference",
        what: "Covers triggers, the checks that return true or false in a scope, plus trigger blocks, syntax and logic blocks.",
      },
      {
        title: "Variables",
        path: "/Variables",
        category: "Script reference",
        what: "Explains how to set, modify, remove and read script variables, including global variables, local variables and lists.",
      },
      {
        title: "Modifier list",
        path: "/Modifier_list",
        category: "Script reference",
        what: "Lists the game's modifiers and separates the two meanings of modifier, long term bonuses and random-effect chance changes.",
      },
      {
        title: "AI modding",
        path: "/AI_modding",
        category: "Scripting",
        what: "Explains which AI behaviour is hardcoded and how defines, chances, triggers, AI personality values and script can influence it.",
      },
      {
        title: "Bookmarks modding",
        path: "/Bookmarks_modding",
        category: "Scripting",
        what: "Shows how to add bookmarks so new characters and scenarios appear on the Select Start Date screen.",
      },
      {
        title: "Characters modding",
        path: "/Characters_modding",
        category: "Scripting",
        what: "Covers changing character appearance, data and behaviour, from adding gold to scripting new characters and visual effects.",
      },
      {
        title: "Commands",
        path: "/Commands",
        category: "Scripting",
        what: "Lists the commands, also called effects, used in event immediate and option blocks and in scripted effects.",
      },
      {
        title: "Council modding",
        path: "/Council_modding",
        category: "Scripting",
        what: "Describes the council position and council task files and how a council position is structured.",
      },
      {
        title: "Culture modding",
        path: "/Culture_modding",
        category: "Scripting",
        what: "Explains how to add cultures, culture groups, innovations and eras using the game's modular culture files.",
      },
      {
        title: "Decisions modding",
        path: "/Decisions_modding",
        category: "Scripting",
        what: "Covers scripting decisions, the optional actions rulers may take, including location, structure, localization, custom widgets and testing.",
      },
      {
        title: "Dynasties modding",
        path: "/Dynasties_modding",
        category: "Scripting",
        what: "Shows how to create dynasties and houses, and how to change an existing dynasty's name, coat of arms and motto.",
      },
      {
        title: "Event modding",
        path: "/Event_modding",
        category: "Scripting",
        what: "Covers writing events, the story bits that happen during a campaign, with location, structure, portraits, themes and triggers.",
      },
      {
        title: "Governments modding",
        path: "/Governments_modding",
        category: "Scripting",
        what: "Documents the government type files in common/governments and the fields that define one, such as council and vassal contracts.",
      },
      {
        title: "History modding",
        path: "/History_modding",
        category: "Scripting",
        what: "Explains the history folder and how to edit the starting data for characters, cultures, provinces, titles and wars.",
      },
      {
        title: "Holdings modding",
        path: "/Holdings_modding",
        category: "Scripting",
        what: "Explains how to define holding types in common/holdings, with variables, buildings, modifiers and localization.",
      },
      {
        title: "Lifestyles modding",
        path: "/Lifestyles_modding",
        category: "Scripting",
        what: "Covers lifestyles, the trees characters progress in, and how to script their focuses, perks, graphics and localization.",
      },
      {
        title: "Regiments modding",
        path: "/Regiments_modding",
        category: "Scripting",
        what: "Explains the men-at-arms regiment files, their variables, their use in innovations and traditions, and their localization.",
      },
      {
        title: "Religions modding",
        path: "/Religions_modding",
        category: "Scripting",
        what: "Explains how to add religion families, religions and faiths, with holy sites, graphics and localization.",
      },
      {
        title: "Script values",
        path: "/Script_values",
        category: "Scripting",
        what: "Describes script values, the functions in common/script_values that calculate a number usable almost anywhere in script.",
      },
      {
        title: "Story cycles modding",
        path: "/Story_cycles_modding",
        category: "Scripting",
        what: "Explains story cycles, event managers that fire events periodically and store related values, and how to create one.",
      },
      {
        title: "Struggle modding",
        path: "/Struggle_modding",
        category: "Scripting",
        what: "Shows how to create or change a struggle, covering setup, cultures, faiths, regions, conditions and graphics.",
      },
      {
        title: "Title modding",
        path: "/Title_modding",
        category: "Scripting",
        what: "Covers the landed_titles files, including titular titles, coats of arms, capital buildings, history and the full attribute list.",
      },
      {
        title: "Trait modding",
        path: "/Trait_modding",
        category: "Scripting",
        what: "Explains creating character traits that change attributes, opinions and personality, with categories, validation and special trait flags.",
      },
      {
        title: "Interface",
        path: "/Interface",
        category: "Interface and localization",
        what: "Explains modding the user interface, covering GUI basics, inspecting GUI, scripted GUIs, new windows and the checksum effect.",
      },
      {
        title: "Data types",
        path: "/Data_types",
        category: "Interface and localization",
        what: "Documents the bracketed data types used in GUI and localization, listing global promotes, global functions and object types.",
      },
      {
        title: "Localization",
        path: "/Localization",
        category: "Interface and localization",
        what: "Covers the text shown to players, including formatting, reusing entries, data types, special characters, linking and number formatting.",
      },
      {
        title: "Customizable localization",
        path: "/Customizable_localization",
        category: "Interface and localization",
        what: "Explains customizable localization, used when one text slot must show different wording depending on conditions.",
      },
      {
        title: "Flavorization",
        path: "/Flavorization",
        category: "Interface and localization",
        what: "Explains flavorization, how the game picks and prioritizes the title shown for a character, with grammar and examples.",
      },
      {
        title: "Map modding",
        path: "/Map_modding",
        category: "Map",
        what: "Covers editing the game map, including the heightmap, rivers, provinces, new titles and province terrain.",
      },
      {
        title: "Terrain modding",
        path: "/Terrain_modding",
        category: "Map",
        what: "Explains creating or changing terrain types, with scripting, graphics, localization and the modifiers terrains use.",
      },
      {
        title: "3D models",
        path: "/3D_models",
        category: "Graphics",
        what: "For modders with 3D experience: models for portraits, units, holdings and map objects, plus textures and formats.",
      },
      {
        title: "Exporters",
        path: "/Exporters",
        category: "Graphics",
        what: "Describes the Paradox exporter tools for Photoshop textures and Maya meshes and animations, with setup and installation steps.",
      },
      {
        title: "Coat of arms modding",
        path: "/Coat_of_arms_modding",
        category: "Graphics",
        what: "Covers scripting coats of arms for titles, dynasties and houses, with keywords, inheritance, dynamic coats and emblem modding.",
      },
      {
        title: "Graphical assets",
        path: "/Graphical_assets",
        category: "Graphics",
        what: "Documents the portrait palette assets for hair, skin and eyes, with their required size and DDS format.",
      },
      {
        title: "Fonts",
        path: "/Fonts",
        category: "Graphics",
        what: "Finding, converting and installing custom fonts, including TrueType to OpenType conversion.",
      },
      {
        title: "Music modding",
        path: "/Music_modding",
        category: "Audio",
        what: "Explains adding custom music tracks, listing them in the music player, and scripting when and where they play.",
      },
      {
        title: "Sound modding",
        path: "/Sound_modding",
        category: "Audio",
        what: "Explains importing sounds with FMOD Studio and playing them in game, with random, overlapping and 3D sound.",
      },
    ],
  },
  vic3: {
    base: "https://vic3.paradoxwikis.com",
    pages: [
      {
        title: "Scripted test",
        path: "/Scripted_test",
        category: "Basics",
        what: "Scripted tests are utility files that check how often a defined game state is reached, without affecting gameplay.",
      },
      {
        title: "Modding",
        path: "/Modding",
        category: "Basics",
        what: "The main modding overview: getting started, the mod folder, tools, best practices, file priority, debugging, and common problems.",
      },
      {
        title: "Mod",
        path: "/Mod",
        category: "Basics",
        what: "A mod is any alteration of the game, from small tweaks to total conversions, with installation steps and mod lists.",
      },
      {
        title: "Mod structure",
        path: "/Mod_structure",
        category: "Basics",
        what: "The structure of a mod folder: its location, its metadata, the folder layout, and a folder template.",
      },
      {
        title: "Mod compatibility",
        path: "/Mod_compatibility",
        category: "Basics",
        what: "Compatibility mechanics that let several mods work together without relying on base game files, including inject and replace.",
      },
      {
        title: "Troubleshooting",
        path: "/Troubleshooting",
        category: "Basics",
        what: "Finding and fixing bugs with the error log, the debug log, and methods for identifying crash sources.",
      },
      {
        title: "Console commands",
        path: "/Console_commands",
        category: "Basics",
        what: "The game's debug mode and the list of console commands available in non-ironman games.",
      },
      {
        title: "Defines",
        path: "/Defines",
        category: "Script reference",
        what: "Engine variables that regulate basic game behaviour and settings not opened to scripting, such as approval thresholds and camera field of view.",
      },
      {
        title: "Effect",
        path: "/Effect",
        category: "Script reference",
        what: "Effects change the current game state, such as creating or killing a character or changing the ownership of a state.",
      },
      {
        title: "Scope",
        path: "/Scope",
        category: "Script reference",
        what: "Scopes are code objects such as countries and states that give effects and triggers the context they run in.",
      },
      {
        title: "Trigger",
        path: "/Trigger",
        category: "Script reference",
        what: "Triggers act as conditions that read the current game state, such as a character's ideology or a state's ownership.",
      },
      {
        title: "Macro",
        path: "/Macro",
        category: "Script reference",
        what: "Macros are reusable blocks of script, mainly scripted effects and scripted triggers, including how to pass parameters.",
      },
      {
        title: "Modifier types",
        path: "/Modifier_types",
        category: "Script reference",
        what: "Modifier types are the game script pieces that change game statistics or allow and block certain actions.",
      },
      {
        title: "On actions",
        path: "/On_actions",
        category: "Script reference",
        what: "On actions are effects called by specific circumstances, such as regular pulses, wars starting, or a character dying.",
      },
      {
        title: "Script value",
        path: "/Script_value",
        category: "Script reference",
        what: "Script values are mathematical calculations that build dynamic numbers from game values for effects, triggers, variables, and AI.",
      },
      {
        title: "Variable",
        path: "/Variable",
        category: "Script reference",
        what: "Variables are scripted event targets that hold values or scopes, including temporary lists, variable lists, and variable maps.",
      },
      {
        title: "Decision modding",
        path: "/Decision_modding",
        category: "Scripting",
        what: "Decisions are scripted effects that can be taken in certain circumstances, defined in common/decisions.",
      },
      {
        title: "Event modding",
        path: "/Event_modding",
        category: "Scripting",
        what: "How to write events, covering file location, file structure, event structure, hidden events, and event templates.",
      },
      {
        title: "History modding",
        path: "/History_modding",
        category: "Scripting",
        what: "History effects in common/history initialise the starting state of a new game: countries, politics, pops, literacy, and technologies.",
      },
      {
        title: "Journal modding",
        path: "/Journal_modding",
        category: "Scripting",
        what: "Journal entries represent ongoing situations or goals for the player, defined in common/journal_entries.",
      },
      {
        title: "Modifier modding",
        path: "/Modifier_modding",
        category: "Scripting",
        what: "Modifiers are containers of values that affect gameplay, defined as static modifiers or inside scripted types like laws.",
      },
      {
        title: "Scripted gui",
        path: "/Scripted_gui",
        category: "Scripting",
        what: "Scripted GUIs run effects when a button is clicked and set the validity or visibility of UI elements.",
      },
      {
        title: "Building modding",
        path: "/Building_modding",
        category: "Scripting",
        what: "How to add buildings and the production methods that drive them, plus building groups, map models, and localization.",
      },
      {
        title: "Character modding",
        path: "/Character_modding",
        category: "Scripting",
        what: "Character templates in common/character_templates, the create_character effect, character history and traits.",
      },
      {
        title: "Country modding",
        path: "/Country_modding",
        category: "Scripting",
        what: "Countries are defined by a few base characteristics, plus localization, map colour, flags, and country history files.",
      },
      {
        title: "Culture modding",
        path: "/Culture_modding",
        category: "Scripting",
        what: "Culture represents the abstracted ethnicity and traditions of pops and countries, with definitions and discrimination traits.",
      },
      {
        title: "Decree modding",
        path: "/Decree_modding",
        category: "Scripting",
        what: "Decrees add modifiers to specific states, with the decree definition explained.",
      },
      {
        title: "Diplomacy modding",
        path: "/Diplomacy_modding",
        category: "Scripting",
        what: "Diplomatic actions, diplomatic plays and secret goals, defined in common/diplomatic_actions. A short page so far.",
      },
      {
        title: "Goods modding",
        path: "/Goods_modding",
        category: "Scripting",
        what: "How to add goods, including text icons, localization, goods categories, building use, pop consumption, and discoverability.",
      },
      {
        title: "Institution modding",
        path: "/Institution_modding",
        category: "Scripting",
        what: "Institutions apply modifiers to incorporated states, covering their definition, levels, cost, modifiers, and how they are enabled.",
      },
      {
        title: "Interest group modding",
        path: "/Interest_group_modding",
        category: "Scripting",
        what: "Interest groups represent common socio-political interests, each with ideologies, three traits, and other characteristics.",
      },
      {
        title: "Law modding",
        path: "/Law_modding",
        category: "Scripting",
        what: "Laws make major changes to a country, covering law groups, law definitions, and their other effects.",
      },
      {
        title: "Pop modding",
        path: "/Pop_modding",
        category: "Scripting",
        what: "Pops are defined by their profession: profession definitions and profession modifiers.",
      },
      {
        title: "Power bloc modding",
        path: "/Power_bloc_modding",
        category: "Scripting",
        what: "Power blocs represent international organizations and empires, covering central identities, principle groups, principles, and related script values.",
      },
      {
        title: "Religion modding",
        path: "/Religion_modding",
        category: "Scripting",
        what: "Religion represents the abstracted faith of pops and countries, with religion definitions and discrimination traits.",
      },
      {
        title: "Technology modding",
        path: "/Technology_modding",
        category: "Scripting",
        what: "Technologies represent material, social, and political inventions that unlock mechanics or give modifiers, with eras and a walkthrough.",
      },
      {
        title: "Treaty modding",
        path: "/Treaty_modding",
        category: "Scripting",
        what: "Treaties are diplomatic agreements made of articles, covering treaty defines, article definitions, and the script documentation.",
      },
      {
        title: "War goal modding",
        path: "/War_goal_modding",
        category: "Scripting",
        what: "War goals are the diplomatic demands one country makes on another, defined in common/war_goal_types.",
      },
      {
        title: "AI modding",
        path: "/AI_modding",
        category: "Scripting",
        what: "AI modding changes AI behaviour through AI defines, AI strategies, and AI values.",
      },
      {
        title: "Interface modding",
        path: "/Interface_modding",
        category: "Interface and localization",
        what: "How to build custom interface panels and windows from GUI templates and types, and add them to the game.",
      },
      {
        title: "GUI script",
        path: "/GUI_script",
        category: "Interface and localization",
        what: "GUI script is the scripting style used in the game's GUI and localization, with its data types, functions, and promotes.",
      },
      {
        title: "Localization",
        path: "/Localization",
        category: "Interface and localization",
        what: "Localization files are UTF-8-BOM yml named _l_language, covering formatting, data functions, concepts, custom tooltips, and saved scopes.",
      },
      {
        title: "Script localization",
        path: "/Script_localization",
        category: "Interface and localization",
        what: "Script localization makes effects and triggers show different text depending on context, with custom descriptions and localization strings.",
      },
      {
        title: "Map modding",
        path: "/Map_modding",
        category: "Map",
        what: "How to mod the game map through files or the map editor: land, seas, rivers, provinces, and states.",
      },
      {
        title: "Geographic region modding",
        path: "/Geographic_region_modding",
        category: "Map",
        what: "Geographic regions are static script lists of state or strategic regions that make iteration simpler and faster.",
      },
      {
        title: "State modding",
        path: "/State_modding",
        category: "Map",
        what: "State regions are the map parts holding pops and buildings, with their characteristics, history, and strategic regions.",
      },
      {
        title: "Model modding",
        path: "/Model_modding",
        category: "Graphics",
        what: "A guide to editing existing 3D models or adding new ones to the game, with the tools needed.",
      },
      {
        title: "Event images",
        path: "/Event_images",
        category: "Graphics",
        what: "Event images are short bk2 videos used through media aliases in gfx/media_alias that pair a video with audio.",
      },
      {
        title: "Graphical asset modding",
        path: "/Graphical_asset_modding",
        category: "Graphics",
        what: "The game stores textures mainly as DirectDraw Surface dds files, covering both 2-D and 3-D assets.",
      },
      {
        title: "Flag modding",
        path: "/Flag_modding",
        category: "Graphics",
        what: "Country flags are picked by triggers from scripted coats of arms built from graphical elements, templates, and colours.",
      },
      {
        title: "Sound modding",
        path: "/Sound_modding",
        category: "Audio",
        what: "Sound modding uses FMOD Studio 2.02.03, covering project setup, importing sounds, and playing them in game.",
      },
      {
        title: "Mod translation",
        path: "/Mod_translation",
        category: "Guides",
        what: "How to translate mods with the ParaTranz platform, with existing projects and a setup guide.",
      },
      {
        title: "New country modding",
        path: "/New_country_modding",
        category: "Guides",
        what: "A guide to adding a new country that exists at the 1836 start: history, localization, pops, characters, flag.",
      },
      {
        title: "Save-game editing",
        path: "/Save-game_editing",
        category: "Guides",
        what: "Save files are zipped v3 archives holding a meta and a gamestate file, with their format and structure explained.",
      },
      {
        title: "State modding guide",
        path: "/State_modding_guide",
        category: "Guides",
        what: "A guide to creating a new state region without editing the province map, and to overwriting existing states.",
      },
    ],
  },
  eu5: {
    base: "https://eu5.paradoxwikis.com",
    pages: [
      {
        title: "Modding",
        path: "/Modding",
        category: "Basics",
        what: "The entry point for altering the game: getting started, tools and utilities, common problems and terminology.",
      },
      {
        title: "Mod",
        path: "/Mod",
        category: "Basics",
        what: "What a mod is and how to install one, from small tweaks to total conversions, plus mod lists.",
      },
      {
        title: "Mod structure",
        path: "/Mod_structure",
        category: "Basics",
        what: "The mod folder location, the metadata file and the folder structure every mod needs.",
      },
      {
        title: "Mod compatibility",
        path: "/Mod_compatibility",
        category: "Basics",
        what: "Compatibility mechanics that let several mods work together without relying directly on base game files.",
      },
      {
        title: "Console commands",
        path: "/Console_commands",
        category: "Basics",
        what: "The debug mode console, how to open it, and the list of commands you can type there.",
      },
      {
        title: "Defines",
        path: "/Defines",
        category: "Script reference",
        what: "Engine variables that regulate basic game behaviour and settings not opened to scripting, plus the full list of defines.",
      },
      {
        title: "Effect",
        path: "/Effect",
        category: "Script reference",
        what: "Effects change the current game state, such as creating or killing a character or changing who owns a state.",
      },
      {
        title: "Scope",
        path: "/Scope",
        category: "Script reference",
        what: "Scopes are the game objects that effects and triggers run on, with iterators, event targets and scope types.",
      },
      {
        title: "Scope link",
        path: "/Scope_link",
        category: "Script reference",
        what: "Scope links, often called event targets, are the object, scope and value references used in game script.",
      },
      {
        title: "Trigger",
        path: "/Trigger",
        category: "Script reference",
        what: "Triggers read the game state and decide whether an event can occur or an action is available.",
      },
      {
        title: "Color",
        path: "/Color",
        category: "Script reference",
        what: "Script features for writing colors in game script, covering color modes, named colors and scripted math with colors.",
      },
      {
        title: "Macro",
        path: "/Macro",
        category: "Script reference",
        what: "Reusable blocks of script, mainly scripted effects and scripted triggers, including inline forms and arguments.",
      },
      {
        title: "Mean time to happen",
        path: "/Mean_time_to_happen",
        category: "Script reference",
        what: "The calculation syntax used for event frequencies and weights, with its scripted modifier blocks.",
      },
      {
        title: "Modifier types",
        path: "/Modifier_types",
        category: "Script reference",
        what: "Game script that modifies statistics or blocks actions, how to define new types, and the full list.",
      },
      {
        title: "On actions",
        path: "/On_actions",
        category: "Script reference",
        what: "Effects called by circumstances such as regular pulses, wars starting or a character dying, and how to mod them.",
      },
      {
        title: "Script value",
        path: "/Script_value",
        category: "Script reference",
        what: "Mathematical calculations that build dynamic numeric or boolean values from game values during play.",
      },
      {
        title: "Variable",
        path: "/Variable",
        category: "Script reference",
        what: "Special scope links that hold values or scopes, set by effects and checked by triggers, including lists and maps.",
      },
      {
        title: "GUI script",
        path: "/GUI_script",
        category: "Script reference",
        what: "The scripting style used in the game's GUI and localization files, with its data types, functions and promotes.",
      },
      {
        title: "Localization",
        path: "/Localization",
        category: "Script reference",
        what: "Writing localization yml files in UTF-8-BOM, with formatting, data functions, concepts, variables and custom tooltips.",
      },
      {
        title: "Action modding",
        path: "/Action_modding",
        category: "Scripting",
        what: "Creating new interactions between countries and other objects, built on the shared interaction target system.",
      },
      {
        title: "Disaster modding",
        path: "/Disaster_modding",
        category: "Scripting",
        what: "Disasters are internal situations that befall a country; this covers starting, running and ending them.",
      },
      {
        title: "Event modding",
        path: "/Event_modding",
        category: "Scripting",
        what: "Events present a nation with a choice or a notification; covers file location, structure, options and firing.",
      },
      {
        title: "Mission modding",
        path: "/Mission_modding",
        category: "Scripting",
        what: "Missions are task trees that guide countries through objectives with rewards, with their structure and attributes.",
      },
      {
        title: "Modifier modding",
        path: "/Modifier_modding",
        category: "Scripting",
        what: "Applying modifier types to countries and other entities with static modifiers, auto modifiers and new types.",
      },
      {
        title: "Scripted gui",
        path: "/Scripted_gui",
        category: "Scripting",
        what: "Custom GUI elements that run script effects, letting modders add interactive buttons to the interface.",
      },
      {
        title: "Setup modding",
        path: "/Setup_modding",
        category: "Scripting",
        what: "Building the savefile the game opens to start play, using managers and functions close to save-game editing.",
      },
      {
        title: "Situation modding",
        path: "/Situation_modding",
        category: "Scripting",
        what: "Situations represent complex political, economic and societal phenomena shown to a subset of countries.",
      },
      {
        title: "Advance modding",
        path: "/Advance_modding",
        category: "Scripting",
        what: "Creating new advances, the game's representation of technological progress, with syntax and localization.",
      },
      {
        title: "Art modding",
        path: "/Art_modding",
        category: "Scripting",
        what: "Creating new work of art types and artist types, and adding them to the game setup.",
      },
      {
        title: "Building modding",
        path: "/Building_modding",
        category: "Scripting",
        what: "Adding buildings and road types, plus production methods and the employment system behind the economy.",
      },
      {
        title: "Character modding",
        path: "/Character_modding",
        category: "Scripting",
        what: "Character interactions: actions performed on or by rulers, heirs and nobles, with structure and attributes.",
      },
      {
        title: "Concept modding",
        path: "/Concept_modding",
        category: "Scripting",
        what: "Creating new game concepts for use in the game, with the syntax and the localization they need.",
      },
      {
        title: "Country modding",
        path: "/Country_modding",
        category: "Scripting",
        what: "Countries are the base playable element and need both a country definition and a country setup.",
      },
      {
        title: "Culture modding",
        path: "/Culture_modding",
        category: "Scripting",
        what: "Culture definitions, culture groups, and languages and dialects, with many customisation options.",
      },
      {
        title: "Disease modding",
        path: "/Disease_modding",
        category: "Scripting",
        what: "New disease types and their spread rate and consequences, driven largely by dynamically calculated script values.",
      },
      {
        title: "Estate modding",
        path: "/Estate_modding",
        category: "Scripting",
        what: "Estates are a country's major power groups: Crown, Nobles, Clergy, Burghers, Peasants and others.",
      },
      {
        title: "Goods modding",
        path: "/Goods_modding",
        category: "Scripting",
        what: "New good types, raw materials added at game start, and the good demands of pops.",
      },
      {
        title: "Institution modding",
        path: "/Institution_modding",
        category: "Scripting",
        what: "Institutions are major societal developments that spread across the world over time, with their spread mechanics.",
      },
      {
        title: "International organization modding",
        path: "/International_organization_modding",
        category: "Scripting",
        what: "Organizations such as the Holy Roman Empire, coalitions, crusades and defensive leagues.",
      },
      {
        title: "Law modding",
        path: "/Law_modding",
        category: "Scripting",
        what: "Laws are policies countries adopt that give modifiers and affect gameplay, grouped into law categories.",
      },
      {
        title: "War modding",
        path: "/War_modding",
        category: "Scripting",
        what: "New casus belli and their wargoal definitions, plus scripted peace treaties to go with them.",
      },
      {
        title: "Pop modding",
        path: "/Pop_modding",
        category: "Scripting",
        what: "Population types representing social classes and occupations, with estate assignments and promotion chains.",
      },
      {
        title: "Religion modding",
        path: "/Religion_modding",
        category: "Scripting",
        what: "New religions and religious mechanics, with schools, aspects, figures, focuses and holy sites.",
      },
      {
        title: "Subject type modding",
        path: "/Subject_type_modding",
        category: "Scripting",
        what: "Subject types define how overlords and subjects interact, including war participation and diplomatic acceptance.",
      },
      {
        title: "Trait modding",
        path: "/Trait_modding",
        category: "Scripting",
        what: "Character traits that define the personality and abilities of rulers, generals, admirals and other characters.",
      },
      {
        title: "Unit modding",
        path: "/Unit_modding",
        category: "Scripting",
        what: "Creating new units and defining their abilities, categories, recruitment methods and levies.",
      },
      {
        title: "Map modding",
        path: "/Map_modding",
        category: "Map",
        what: "Editing land, seas, rivers and locations with the official map editor or by editing the game files.",
      },
      {
        title: "Terrain modding",
        path: "/Terrain_modding",
        category: "Map",
        what: "Changing the starting topography, vegetation and climate of a location and what each of them does.",
      },
      {
        title: "Flag modding",
        path: "/Flag_modding",
        category: "Graphics",
        what: "Country flags are picked by triggers from scripted coats of arms built out of graphical elements.",
      },
      {
        title: "Interface modding guide",
        path: "/Interface_modding_guide",
        category: "Guides",
        what: "A walkthrough of the moddable interface files, from the basics to a custom window and tooltip widgets.",
      },
      {
        title: "Save-game editing",
        path: "/Save-game_editing",
        category: "Guides",
        what: "The two forms of non-ironman save files and how to read and edit them, debug and packed.",
      },
      {
        title: "Settlement position modding guide",
        path: "/Settlement_position_modding_guide",
        category: "Guides",
        what: "Relocating the settlement position inside a location and updating the map objects afterwards.",
      },
    ],
  },
};

/**
 * ONE page for every game, like the Modding Tools page: every card names its
 * game and the app shows the cards of the game its switch is on. The same
 * page title on two wikis is two cards, since the pages differ.
 */
export function moddingGuidesPage(gameNames: Record<string, string>): {
  markdown: string;
  cards: WikiCard[];
  outro: string;
} {
  const ids = Object.keys(MODDING_GUIDES);
  const sources = ids
    .map((id) => `[${gameNames[id] ?? id} wiki](${MODDING_GUIDES[id].base}/Modding)`)
    .join(", ");
  const markdown = [
    "# Modding Guides",
    "",
    "The game wiki's modding pages for the game the switch is on, grouped the way the wiki groups them. " +
      "Every card opens the page in your browser; the line under the title says what the page covers.",
    "",
  ].join("\n");
  const cards: WikiCard[] = CATEGORIES.flatMap((category) =>
    ids.flatMap((id) =>
      MODDING_GUIDES[id].pages
        .filter((p) => p.category === category)
        .map((p) => ({
          title: p.title,
          url: MODDING_GUIDES[id].base + p.path,
          kind: category,
          icon: CATEGORY_ICONS[category],
          text: p.what,
          games: [id],
        }))
    )
  );
  const outro = [
    "## Missing a page?",
    "",
    "A wiki page you keep going back to and do not find here: tell me on [Discord](https://discord.gg/DfEJ2H9hj4) or [open an issue](https://github.com/JDeffner/paradox-modding-toolkit/issues).",
    "",
    `Sources: ${sources}.`,
  ].join("\n");
  return { markdown, cards, outro };
}
