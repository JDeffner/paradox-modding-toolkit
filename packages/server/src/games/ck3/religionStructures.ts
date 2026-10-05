/** Separate religion databases documented by CK3 1.20's shipped _*.info files. */
import type { KeySpec, StructureSpec } from "../../schema/types";

const TENET_SELECTION_PAIR: KeySpec[] = [
  { key: "requires_dlc_flag", doc: "DLC flag required for this tenet choice." },
  { key: "tenet", refKinds: ["tenet"], doc: "Tenet used when the DLC flag is present." },
  { key: "fallback_tenet", refKinds: ["tenet"], doc: "Optional tenet used without the DLC flag." },
];

// common/religion/faith_types/_faith_types.info, including its nested faith_details.
const FAITH: StructureSpec = {
  topLevel: [
    {
      key: "faith_details",
      values: "block",
      doc: "Parent religion and the faith's identity and presentation.",
    },
    {
      key: "origin",
      refKinds: ["faith"],
      doc: "Faith this faith derives from, used when processing historical religious heads.",
    },
    {
      key: "holy_sites",
      values: "block",
      refKinds: ["holy_site"],
      doc: "Ordinary holy sites apply local ruler and county modifiers.",
    },
    {
      key: "eminent_holy_sites",
      values: "block",
      refKinds: ["holy_site"],
      doc: "Eminent holy sites also apply global bonuses. Do not repeat sites from holy_sites.",
    },
    {
      key: "tenets",
      values: "block",
      refKinds: ["tenet"],
      doc: "Core tenets for a dynamically created main rite. A scripted main rite supplies its own tenets.",
    },
    {
      key: "doctrines",
      values: "block",
      refKinds: ["doctrine"],
      doc: "Faith-wide doctrines. Rite doctrines take precedence in the same doctrine group.",
    },
    { key: "tenet_selection_pair", values: "block", doc: "DLC-dependent tenet with an optional fallback." },
    { key: "reserved_male_names", values: "block", doc: "Male names reserved for followers of this faith." },
    {
      key: "reserved_female_names",
      values: "block",
      doc: "Female names reserved for followers of this faith.",
    },
    { key: "cultures", values: "block", refKinds: ["culture"], doc: "Cultures associated with this faith." },
    {
      key: "historical",
      values: "bool",
      doc: "Consider this faith dead rather than not yet founded when it has no characters or counties. Default: no.",
    },
    {
      key: "main_rite",
      refKinds: ["rite"],
      doc: "Scripted main rite. Dated changes belong in faith history.",
    },
    {
      key: "localization",
      values: "block",
      doc: "Faith-dependent localization mappings. Missing keys inherit from the religion.",
    },
    {
      key: "holy_order_names",
      values: "block",
      doc: "Military Order names and coats of arms, with the religion as fallback.",
    },
  ],
  blocks: {
    faith_details: [
      { key: "religion", refKinds: ["religion"], doc: "Required parent religion." },
      { key: "color", values: "block", doc: "Faith color." },
      { key: "icon", doc: "Override the faith icon." },
      { key: "reformed_icon", doc: "Icon for the reformed faith." },
      { key: "religious_head", refKinds: ["landed_title"], doc: "Title whose holder is the religious head." },
      {
        key: "head_of_rite",
        refKinds: ["landed_title"],
        doc: "Title providing a head-of-rite override; the head of faith takes priority.",
      },
      { key: "graphical_faith", doc: "Temple model, overriding religion and family defaults." },
      {
        key: "theocracy_government_type",
        refKinds: ["government"],
        doc: "Government type for theocratic rulers.",
      },
    ],
    tenet_selection_pair: TENET_SELECTION_PAIR,
  },
};

// common/religion/rite_types/_rite_types.info. name/desc have a Rite root.
const RITE: StructureSpec = {
  topLevel: [
    { key: "name", values: "loc", scope: "rite", doc: "Dynamic name. Defaults to the rite key." },
    {
      key: "desc",
      values: "loc",
      scope: "rite",
      doc: "Dynamic description. Defaults to the rite key plus _desc.",
    },
    { key: "icon", doc: "Icon from DYNAMIC_RITE_ICON_PATH." },
    { key: "color", values: "block", doc: "Rite map color." },
    { key: "founder", refKinds: ["landed_title"], doc: "Title whose first holder is the rite's founder." },
    {
      key: "faith",
      refKinds: ["faith"],
      doc: "Parent faith. Without one, this rite needs explicit creation or a dated history assignment.",
    },
    { key: "cultures", values: "block", refKinds: ["culture"], doc: "Cultures associated with this rite." },
    { key: "convert", values: "bool", doc: "Whether characters can convert to this rite. Default: yes." },
    {
      key: "create",
      values: "bool",
      doc: "Create this rite at game start. With no, history must create it before rite:key can refer to it. Default: yes.",
    },
    {
      key: "tenets",
      values: "block",
      refKinds: ["tenet"],
      doc: "Core tenets. A scripted main rite supplies the faith's effective core tenets.",
    },
    {
      key: "doctrines",
      values: "block",
      refKinds: ["doctrine"],
      doc: "Rite-specific doctrines, overriding parent-faith and religion choices in the same groups.",
    },
    { key: "tenet_selection_pair", values: "block", doc: "DLC-dependent tenet with an optional fallback." },
  ],
  blocks: { tenet_selection_pair: TENET_SELECTION_PAIR },
};

// common/religion/tenet_types/_tenet_types.info: piety_cost has a Rite root;
// name/desc/icon/is_shown/can_pick use Faith; personal selection uses Character.
const TENET: StructureSpec = {
  topLevel: [
    {
      key: "icon",
      values: "block",
      scope: "faith",
      doc: "Optional triggered icon override from TENET_TYPE_ICON_PATH.",
    },
    {
      key: "name",
      values: "loc",
      scope: "faith",
      doc: "Dynamic name. Defaults to the tenet key plus _name.",
    },
    {
      key: "desc",
      values: "loc",
      scope: "faith",
      doc: "Dynamic description. Defaults to the tenet key plus _desc.",
    },
    { key: "visible", values: "bool", doc: "Show this tenet in GUI views. Default: yes." },
    { key: "requires_dlc_flag", doc: "DLC feature required for this tenet in code-driven lists." },
    { key: "parameters", values: "block", doc: "Parameter flags checked with has_doctrine_parameter." },
    {
      key: "piety_cost",
      values: "block",
      scope: "rite",
      doc: "Scripted tenet cost, evaluated in Rite scope.",
    },
    {
      key: "is_shown",
      values: "block",
      scope: "faith",
      doc: "Visibility trigger for tenet selection, evaluated in Faith scope.",
    },
    {
      key: "can_pick",
      values: "block",
      scope: "faith",
      doc: "Selection trigger in Faith scope. Check other selections with flag:<tenet> and selected_tenets.",
    },
    {
      key: "can_pick_as_personal_tenet",
      values: "block",
      scope: "character",
      doc: "Personal tenet selection trigger in Character scope.",
    },
    { key: "divergence_multiplier", doc: "Multiplier for positive divergence. Default: 1." },
    { key: "character_modifier", values: "block", doc: "Modifiers for characters of the faith." },
    {
      key: "traits",
      values: "block",
      doc: "Additional virtues and sins. Tenet choices take precedence over religion choices.",
    },
    {
      key: "special_parameters",
      values: "block",
      doc: "Value overrides using the doctrine special-parameter structure.",
    },
    {
      key: "personal_tenet_modifier",
      values: "block",
      doc: "Modifiers for playable characters with this personal tenet.",
    },
    {
      key: "personal_tenet_parameters",
      values: "block",
      doc: "Personal tenet flags checked with has_personal_tenet_flag.",
    },
  ],
};

export const RELIGION_STRUCTURES: Record<string, StructureSpec> = { faith: FAITH, rite: RITE, tenet: TENET };
