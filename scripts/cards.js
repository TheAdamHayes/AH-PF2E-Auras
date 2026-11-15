// cards.js — builds the HTML for the module's chat cards.
// Pure: takes plain data, returns strings. No Foundry calls, so it runs in Node.
//
// The save request uses PF2e's own inline syntax (@Check, @Damage, @UUID). Foundry and PF2e turn
// these into buttons and draggable links when the message is shown, just like a spell card:
// click the save to roll it, click the damage to roll it and use the damage card's buttons,
// drag a condition or effect link onto a token.

import {
  DEGREE_LABELS, DEGREE_ORDER, IMMUNITY, SAVE_LABELS, VALUED_CONDITIONS, conditionLabel,
  damageFormulaFor, describeOutcome, escapeHTML, isBasicSave,
} from "./core.js";

const esc = escapeHTML;

/** Text inside @Thing[...]{...} must not contain the characters that close those blocks. */
export function inlineSafe(text) {
  return String(text ?? "").replace(/[|[\]{}@]/g, " ").replace(/\s+/g, " ").trim();
}

/** @UUID link, or plain bold text when there's no uuid. */
export function uuidLink(uuid, label) {
  const safe = esc(inlineSafe(label));
  const id = String(uuid ?? "").trim();
  return id && /^[\w.-]+$/.test(id) ? `@UUID[${id}]{${safe}}` : `<strong>${safe}</strong>`;
}

const REASONS = {
  enter: "moved into",
  turnStart: "started their turn in",
  manual: "is in",
};

const shortImmunity = (choice) => IMMUNITY[choice].label.replace(/^Immune to this aura /, "");

/** GM-only alert: "X moved into Y's aura". */
export function buildAlertHTML(f, labels = {}) {
  const reason = REASONS[f.reason] ?? REASONS.manual;
  const head = `<header class="apz-head"><i class="fa-solid fa-bullseye"></i> Aura check <span class="apz-tag">GM only</span></header>`;
  const line = `<p class="apz-line"><strong>${esc(f.targetName)}</strong> ${reason} `
    + `<strong>${esc(f.emitterName)}</strong>'s ${uuidLink(f.itemUuid, f.label)} aura`
    + (f.radius ? ` (${esc(f.radius)} ft)` : "") + `.</p>`;

  let body = "";
  let buttons = "";
  if (f.status === "sent") {
    body = `<p class="apz-done"><i class="fa-solid fa-check"></i> Save request posted.</p>`;
  } else if (f.status === "muted") {
    body = `<p class="apz-done apz-muted"><i class="fa-solid fa-bell-slash"></i> You won't be told about this aura again. Turn it back on in Module Settings → Set up auras.</p>`;
  } else if (f.status === "dismissed") {
    body = `<p class="apz-done apz-muted"><i class="fa-solid fa-xmark"></i> Dismissed.</p>`;
  } else if (!f.configured) {
    body = `<p class="apz-hint">This aura hasn't been set up yet, so I don't know which save it needs.</p>`;
    buttons = `<button type="button" data-apz-action="setup"><i class="fa-solid fa-gear"></i> Set up this aura</button>`
      + `<button type="button" data-apz-action="dismiss"><i class="fa-solid fa-xmark"></i> Not needed</button>`
      + `<button type="button" data-apz-action="mute" title="Stop telling me about this aura"><i class="fa-solid fa-bell-slash"></i> Never for this aura</button>`;
  } else {
    const c = f.config;
    const dcText = f.dc ? `DC ${esc(f.dc)} ` : "";
    body = `<p class="apz-hint">Suggested: ${dcText}${esc(SAVE_LABELS[c.save])} save.</p>`
      + `<ul class="apz-mini">${DEGREE_ORDER.map((k) =>
        `<li><span>${esc(DEGREE_LABELS[k])}:</span> ${esc(describeOutcome(c.outcomes[k], c, labels))}</li>`).join("")}</ul>`;
    buttons = `<button type="button" data-apz-action="send" class="apz-primary"><i class="fa-solid fa-comment-dots"></i> Post save request</button>`
      + `<button type="button" data-apz-action="setup" title="Change how this aura works"><i class="fa-solid fa-gear"></i> Edit</button>`
      + `<button type="button" data-apz-action="dismiss"><i class="fa-solid fa-xmark"></i> Not needed</button>`
      + `<button type="button" data-apz-action="mute" title="Stop telling me about this aura"><i class="fa-solid fa-bell-slash"></i> Never</button>`;
  }
  const btnRow = buttons ? `<div class="apz-buttons">${buttons}</div>` : "";
  return `<div class="apz-card apz-alert" data-apz-kind="alert">${head}${line}${body}${btnRow}</div>`;
}

/** One result's text in PF2e style, with an inline damage roll and draggable links. */
export function outcomeInline(outcome, config, { conditionUuids = {}, labels = {}, name = "" } = {}) {
  const sentences = [];
  const formula = damageFormulaFor(config);
  if (outcome.damage !== "none" && formula) {
    const shown = [config.damageFormula, config.damageType].filter(Boolean).join(" ");
    const nameParam = inlineSafe(name) ? `|name:${inlineSafe(name)}` : "";
    const link = `@Damage[${formula}${nameParam}]{${esc(inlineSafe(shown))}}`;
    sentences.push({
      half: `Takes half of ${link} damage.`,
      full: `Takes ${link} damage.`,
      double: `Takes double ${link} damage.`,
    }[outcome.damage]);
  }
  if (outcome.conditions.length) {
    const links = outcome.conditions.map((c) => {
      const label = conditionLabel(c.slug, labels);
      const text = VALUED_CONDITIONS.has(c.slug) ? `${label} ${c.value}` : label;
      return uuidLink(conditionUuids[c.slug], text);
    });
    const list = links.length > 1 ? `${links.slice(0, -1).join(", ")} and ${links.at(-1)}` : links[0];
    sentences.push(`Becomes ${list}.`);
  }
  for (const e of outcome.effects) sentences.push(uuidLink(e.uuid, e.name));
  if (outcome.immunity !== "none") sentences.push(`${esc(IMMUNITY[outcome.immunity].label)}.`);
  if (outcome.note) sentences.push(esc(outcome.note));
  return sentences.length ? sentences.join(" ") : "No effect.";
}

/** Distinct immunity choices used by any result, best result first. */
export function immunityChoices(config) {
  const out = [];
  for (const key of DEGREE_ORDER) {
    const choice = config.outcomes[key].immunity;
    if (choice !== "none" && !out.includes(choice)) out.push(choice);
  }
  return out;
}

/** The @Check syntax for this request. */
export function checkSyntax(f) {
  const c = f.config;
  const basic = !!String(c.damageFormula ?? "").trim() && isBasicSave(c);
  const name = inlineSafe(f.label);
  return `@Check[${c.save}|dc:${Math.trunc(Number(f.dc)) || 10}${basic ? "|basic" : ""}|traits:aura`
    + `|showDC:${f.showDC ? "all" : "gm"}${name ? `|name:${name}` : ""}]`;
}

/**
 * The save request everyone sees. Elements marked data-gm-only are removed for players.
 * @param {object} f  card flag data
 * @param {object} ctx  { conditionUuids, labels }
 */
export function buildPromptHTML(f, ctx = {}) {
  const c = f.config;
  const head = `<header class="apz-head"><i class="fa-solid fa-shield-halved"></i> ${esc(SAVE_LABELS[c.save])} save</header>`;
  const line = `<p class="apz-line"><strong>${esc(f.targetName)}</strong> is in <strong>${esc(f.emitterName)}</strong>'s `
    + `${uuidLink(f.itemUuid, f.label)} aura.</p>`;
  const checkLine = `<p class="apz-check">${checkSyntax(f)}</p>`;

  const rows = DEGREE_ORDER.map((k) =>
    `<p class="apz-degree apz-${k}"><strong>${esc(DEGREE_LABELS[k])}</strong> ${outcomeInline(c.outcomes[k], c, { ...ctx, name: f.label })}</p>`).join("");
  const outcomes = `<div class="apz-outcomes"${f.showDetails ? "" : " data-gm-only"}><hr>${rows}</div>`;

  // GM bookkeeping only: stop the module re-asking while the target is immune. Nothing changes on the sheet.
  let gm = "";
  const choices = immunityChoices(c);
  if (f.immunityMarked && IMMUNITY[f.immunityMarked]) {
    gm = `<p class="apz-done apz-small" data-gm-only><i class="fa-solid fa-check"></i> I won't ask about this aura for `
      + `${esc(f.targetName)} again ${esc(shortImmunity(f.immunityMarked))}.</p>`;
  } else if (choices.length) {
    gm = `<div class="apz-gm" data-gm-only><p class="apz-small apz-muted">GM: if they're now immune, stop asking about this aura for them:</p><div class="apz-buttons">`
      + choices.map((ch) => `<button type="button" data-apz-action="immune" data-immunity="${esc(ch)}">`
        + `<i class="fa-solid fa-shield"></i> ${esc(shortImmunity(ch))}</button>`).join("")
      + `</div></div>`;
  }

  return `<div class="apz-card apz-prompt" data-apz-kind="prompt">${head}${line}${checkLine}${outcomes}${gm}</div>`;
}
