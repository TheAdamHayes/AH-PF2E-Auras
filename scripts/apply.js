// apply.js — works out an aura's DC, and keeps the module's own "don't ask again" notes.
// Nothing here changes a character sheet: no damage, conditions or effects are applied.

import { MODULE_ID, immunityActive, immunityKey, levelDC, makeImmunity } from "./core.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function bestSpellDC(actor) {
  const direct = num(actor?.system?.attributes?.spellDC?.value);
  if (direct) return direct;
  const entries = actor?.itemTypes?.spellcastingEntry ?? [];
  const dcs = entries.map((e) => num(e.statistic?.dc?.value ?? e.system?.spelldc?.dc)).filter(Boolean);
  return dcs.length ? Math.max(...dcs) : null;
}

function classDC(actor) {
  return num(actor?.classDC?.dc?.value) ?? num(actor?.system?.attributes?.classDC?.value);
}

/** The DC this aura uses, taken from the aura owner. Falls back to the level-based DC. */
export function resolveDC(config, emitterActor) {
  const level = emitterActor?.level ?? 0;
  switch (config.dcMode) {
    case "fixed": return config.dcFixed;
    case "level": return levelDC(level);
    case "class": return classDC(emitterActor) ?? levelDC(level);
    case "spell": return bestSpellDC(emitterActor) ?? levelDC(level);
    default: {
      const found = [classDC(emitterActor), bestSpellDC(emitterActor),
        num(emitterActor?.system?.attributes?.classOrSpellDC?.value)].filter(Boolean);
      return found.length ? Math.max(...found) : levelDC(level);
    }
  }
}

// ---------- "don't ask again" notes ----------
// Stored in the module's own flag on the target actor. Only this module reads it.

export function isImmune(targetActor, emitterTokenId, slug) {
  const all = targetActor?.getFlag?.(MODULE_ID, "immunities") ?? {};
  const record = all[immunityKey(emitterTokenId, slug)];
  const combats = game.combats?.contents?.map((c) => c.id) ?? [];
  return immunityActive(record, game.time.worldTime, combats);
}

export async function markImmune(targetActor, emitterTokenId, slug, choice) {
  const record = makeImmunity(choice, game.time.worldTime, game.combat?.id);
  if (!record || !targetActor) return false;
  // Tidy out expired notes while we're here
  const all = targetActor.getFlag(MODULE_ID, "immunities") ?? {};
  const combats = game.combats?.contents?.map((c) => c.id) ?? [];
  const update = {};
  for (const [key, rec] of Object.entries(all)) {
    if (!immunityActive(rec, game.time.worldTime, combats)) update[`flags.${MODULE_ID}.immunities.-=${key}`] = null;
  }
  update[`flags.${MODULE_ID}.immunities.${immunityKey(emitterTokenId, slug)}`] = record;
  await targetActor.update(update, { [MODULE_ID]: true });
  return true;
}
