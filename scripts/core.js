// core.js — constants, settings helpers and pure helpers.
// Imports nothing from other module files, so anything can import it.

export const MODULE_ID = "ah-pf2e-auras";

/** Degree of success index (as PF2e uses it) → key */
export const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
export const DEGREE_LABELS = {
  criticalSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical Failure",
};
/** Order used on cards and in the editor (best first) */
export const DEGREE_ORDER = ["criticalSuccess", "success", "failure", "criticalFailure"];

export const SAVE_LABELS = { fortitude: "Fortitude", reflex: "Reflex", will: "Will" };

export const DC_MODES = {
  classOrSpell: "The aura owner's class or spell DC (whichever is higher)",
  class: "The aura owner's class DC",
  spell: "The aura owner's spell DC",
  level: "Standard DC for the aura owner's level",
  fixed: "A fixed number",
};

export const DAMAGE_MULTIPLIERS = { none: 0, half: 0.5, full: 1, double: 2 };
export const DAMAGE_LABELS = { none: "No damage", half: "Half damage", full: "Full damage", double: "Double damage" };

export const TRIGGERS = {
  both: "When they move into it or start their turn in it",
  enter: "Only when they move into it",
  turnStart: "Only when they start their turn in it",
};

/** Immunity choices → seconds of world time (null = until the encounter ends) */
export const IMMUNITY = {
  none: { label: "No immunity", seconds: 0 },
  "1min": { label: "Immune to this aura for 1 minute", seconds: 60 },
  "10min": { label: "Immune to this aura for 10 minutes", seconds: 600 },
  "1hour": { label: "Immune to this aura for 1 hour", seconds: 3600 },
  "1day": { label: "Immune to this aura for 24 hours", seconds: 86400 },
  encounter: { label: "Immune to this aura until the encounter ends", seconds: null },
};

/** Fallback list; at runtime CONFIG.PF2E.conditionTypes supplies the labels. */
export const VALUED_CONDITIONS = new Set([
  "clumsy", "doomed", "drained", "dying", "enfeebled", "frightened", "sickened",
  "slowed", "stunned", "stupefied", "wounded",
]);
export const COMMON_CONDITIONS = [
  "blinded", "clumsy", "confused", "controlled", "dazzled", "deafened", "doomed", "drained",
  "enfeebled", "fascinated", "fatigued", "fleeing", "frightened", "grabbed", "immobilized",
  "off-guard", "paralyzed", "petrified", "prone", "restrained", "sickened", "slowed",
  "stunned", "stupefied", "unconscious",
];

/** PF2e "DCs by level" table (Core Rulebook / GM Core) */
const LEVEL_DCS = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
export function levelDC(level) {
  const l = Math.trunc(Number(level));
  if (!Number.isFinite(l) || l < 0) return 13;
  return LEVEL_DCS[Math.min(l, LEVEL_DCS.length - 1)];
}

// ---------- text helpers ----------

export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function humanize(slug) {
  const s = String(slug ?? "").replace(/[-_]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function listJoin(parts) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// ---------- aura config shape ----------

export function blankOutcome() {
  return { damage: "none", conditions: [], effects: [], immunity: "none", note: "" };
}

export function defaultConfig(slug, label) {
  return {
    slug: String(slug ?? ""),
    label: label || humanize(slug),
    enabled: true,
    trigger: "both",
    save: "will",
    dcMode: "classOrSpell",
    dcFixed: 20,
    damageFormula: "",
    damageType: "",
    outcomes: {
      criticalSuccess: blankOutcome(),
      success: blankOutcome(),
      failure: blankOutcome(),
      criticalFailure: blankOutcome(),
    },
  };
}

const pick = (value, allowed, fallback) => (Object.hasOwn(allowed, value) ? value : fallback);

function normalizeOutcome(o) {
  const out = blankOutcome();
  if (!o || typeof o !== "object") return out;
  out.damage = pick(o.damage, DAMAGE_MULTIPLIERS, "none");
  out.immunity = pick(o.immunity, IMMUNITY, "none");
  out.note = typeof o.note === "string" ? o.note : "";
  out.conditions = (Array.isArray(o.conditions) ? o.conditions : [])
    .filter((c) => c && typeof c.slug === "string" && c.slug)
    .map((c) => {
      const value = Math.trunc(Number(c.value));
      return { slug: c.slug, value: Number.isFinite(value) && value > 0 ? Math.min(value, 10) : 1 };
    });
  out.effects = (Array.isArray(o.effects) ? o.effects : [])
    .filter((e) => e && typeof e.uuid === "string" && e.uuid)
    .map((e) => ({ uuid: e.uuid, name: typeof e.name === "string" && e.name ? e.name : e.uuid }));
  return out;
}

/** Turn anything (old/partial/hand-edited data) into a complete, valid config. */
export function normalizeConfig(raw, slug) {
  const base = defaultConfig(raw?.slug ?? slug, raw?.label);
  if (!raw || typeof raw !== "object") return base;
  base.enabled = raw.enabled !== false;
  base.trigger = pick(raw.trigger, TRIGGERS, "both");
  base.save = pick(raw.save, SAVE_LABELS, "will");
  base.dcMode = pick(raw.dcMode, DC_MODES, "classOrSpell");
  const fixed = Math.trunc(Number(raw.dcFixed));
  base.dcFixed = Number.isFinite(fixed) && fixed > 0 ? fixed : 20;
  base.damageFormula = typeof raw.damageFormula === "string" ? raw.damageFormula.trim() : "";
  base.damageType = typeof raw.damageType === "string" ? raw.damageType : "";
  for (const key of DEGREES) base.outcomes[key] = normalizeOutcome(raw.outcomes?.[key]);
  return base;
}

/** Fill in the standard "basic save" damage pattern. Returns a new config. */
export function applyBasicSave(config) {
  const c = normalizeConfig(config);
  c.outcomes.criticalSuccess.damage = "none";
  c.outcomes.success.damage = "half";
  c.outcomes.failure.damage = "full";
  c.outcomes.criticalFailure.damage = "double";
  return c;
}

export function isBasicSave(config) {
  const o = config.outcomes;
  return o.criticalSuccess.damage === "none" && o.success.damage === "half"
    && o.failure.damage === "full" && o.criticalFailure.damage === "double";
}

/** Build the damage formula PF2e should roll, e.g. "2d6" + "fire" → "2d6[fire]". */
export function damageFormulaFor(config) {
  const f = String(config.damageFormula ?? "").trim();
  if (!f) return "";
  if (f.includes("[") || !config.damageType) return f;
  return `(${f})[${config.damageType}]`;
}

/** Validate a damage formula without Foundry: dice, numbers, + - * / ( ), [type] tags and @actor data. */
export function looksLikeFormula(formula) {
  const f = String(formula ?? "").trim();
  if (!f) return true;
  let depth = 0;
  for (const ch of f) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth < 0) return false;
  }
  if (depth !== 0) return false;
  const bare = f
    .replace(/\[[a-z,\s-]+\]/gi, "")          // damage type tags like [fire] or [persistent,fire]
    .replace(/@[a-z][\w.]*/gi, "1")             // roll data like @actor.level
    .replace(/\b(?:floor|ceil|round|max|min)\(/gi, "(");
  return /\d/.test(bare) && /^[\d\sdD+\-*/().,]+$/.test(bare) && !/[+\-*/]\s*$/.test(bare);
}

export function conditionLabel(slug, labels = {}) {
  return labels[slug] ?? humanize(slug);
}

/** Plain-English summary of one outcome, e.g. "full damage (2d6 fire), frightened 2". */
export function describeOutcome(outcome, config, conditionLabels = {}) {
  const parts = [];
  const formula = String(config.damageFormula ?? "").trim();
  if (outcome.damage !== "none" && formula) {
    const typeText = config.damageType ? ` ${config.damageType}` : "";
    parts.push(`${DAMAGE_LABELS[outcome.damage].toLowerCase()} (${formula}${typeText})`);
  }
  for (const c of outcome.conditions) {
    const name = conditionLabel(c.slug, conditionLabels).toLowerCase();
    parts.push(VALUED_CONDITIONS.has(c.slug) ? `${name} ${c.value}` : name);
  }
  for (const e of outcome.effects) parts.push(`the effect "${e.name}"`);
  if (outcome.immunity !== "none") parts.push(IMMUNITY[outcome.immunity].label.toLowerCase());
  if (outcome.note) parts.push(`note: ${outcome.note}`);
  return parts.length ? listJoin(parts) : "no effect";
}

/** The whole config read back as sentences. */
export function describeConfig(config, conditionLabels = {}) {
  const c = normalizeConfig(config);
  if (!c.enabled) return `${c.label}: switched off. You won't be told about it.`;
  const when = {
    both: "moves into it or starts their turn in it",
    enter: "moves into it",
    turnStart: "starts their turn in it",
  }[c.trigger];
  const dc = c.dcMode === "fixed" ? `DC ${c.dcFixed}` : {
    classOrSpell: "the owner's class or spell DC",
    class: "the owner's class DC",
    spell: "the owner's spell DC",
    level: "the standard DC for the owner's level",
  }[c.dcMode];
  const lines = [`When someone ${when}, you're asked whether they should roll a ${SAVE_LABELS[c.save]} save against ${dc}.`];
  for (const key of DEGREE_ORDER) {
    lines.push(`${DEGREE_LABELS[key]}: ${describeOutcome(c.outcomes[key], c, conditionLabels)}.`);
  }
  return lines.join(" ");
}

/** Does the trigger setting allow this reason ("enter" | "turnStart")? */
export function triggerAllows(trigger, reason) {
  return trigger === "both" || trigger === reason;
}

// ---------- immunity ----------

export function immunityKey(emitterTokenId, slug) {
  return `${emitterTokenId}~${slug}`.replace(/\./g, "_");
}

/** Build the stored immunity record, or null for "none". */
export function makeImmunity(choice, worldTime, combatId) {
  const info = IMMUNITY[choice];
  if (!info || choice === "none") return null;
  // "Until the encounter ends" outside combat: there's no encounter to end, so use 10 minutes
  if (info.seconds === null) return combatId ? { until: null, combatId } : { until: worldTime + 600, combatId: null };
  return { until: worldTime + info.seconds, combatId: null };
}

/** Is a stored immunity record still active? */
export function immunityActive(record, worldTime, activeCombatIds = []) {
  if (!record || typeof record !== "object") return false;
  if (record.until === null || record.until === undefined) {
    return !!record.combatId && activeCombatIds.includes(record.combatId);
  }
  return Number(record.until) > worldTime;
}

// ---------- settings helpers ----------

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export async function setSetting(key, value) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can change the aura settings.");
    return false;
  }
  await game.settings.set(MODULE_ID, key, value);
  return true;
}

export function getAuraConfigs() {
  const raw = getSetting("auras") ?? {};
  const out = {};
  for (const [slug, cfg] of Object.entries(raw)) out[slug] = normalizeConfig(cfg, slug);
  return out;
}

export function getAuraConfig(slug) {
  const raw = (getSetting("auras") ?? {})[slug];
  return raw ? normalizeConfig(raw, slug) : null;
}

export async function saveAuraConfig(config) {
  const c = normalizeConfig(config);
  const all = foundry.utils.deepClone(getSetting("auras") ?? {});
  all[c.slug] = c;
  return setSetting("auras", all);
}

export async function deleteAuraConfig(slug) {
  const all = foundry.utils.deepClone(getSetting("auras") ?? {});
  delete all[slug];
  return setSetting("auras", all);
}

export function conditionLabelsFromConfig() {
  const types = globalThis.CONFIG?.PF2E?.conditionTypes ?? {};
  const out = {};
  for (const [slug, label] of Object.entries(types)) {
    out[slug] = globalThis.game?.i18n ? game.i18n.localize(label) : label;
  }
  return out;
}
