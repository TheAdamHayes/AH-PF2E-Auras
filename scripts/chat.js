// chat.js — creates and updates the module's chat cards and handles their buttons.
// The save request itself is plain PF2e inline syntax, so rolling, damage and dragging
// conditions/effects onto tokens all work through PF2e's own chat features.

import { buildAlertHTML, buildPromptHTML } from "./cards.js";
import {
  IMMUNITY, MODULE_ID, conditionLabelsFromConfig, defaultConfig, getAuraConfig, getSetting,
  saveAuraConfig,
} from "./core.js";
import { markImmune, resolveDC } from "./apply.js";
import { AuraEditor } from "./editor.js";

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

export function cardData(message) {
  return message?.flags?.[MODULE_ID]?.card ?? null;
}

function tokensFor(f) {
  const scene = game.scenes.get(f.sceneId);
  return {
    scene,
    emitterToken: scene?.tokens.get(f.emitterTokenId) ?? null,
    targetToken: scene?.tokens.get(f.targetTokenId) ?? null,
  };
}

/** Compendium uuids for conditions, so the card can show draggable condition links. */
function conditionUuids() {
  const out = {};
  const map = game.pf2e?.ConditionManager?.conditions;
  if (!map) return out;
  for (const [key, condition] of map.entries()) {
    if (!key.startsWith("Compendium.") && condition?.uuid) out[key] = condition.uuid;
  }
  return out;
}

function build(f) {
  const labels = conditionLabelsFromConfig();
  return f.kind === "alert"
    ? buildAlertHTML(f, labels)
    : buildPromptHTML(f, { labels, conditionUuids: conditionUuids() });
}

async function rewrite(message, f) {
  await message.update({ content: build(f), [`flags.${MODULE_ID}.card`]: f }, { [MODULE_ID]: true });
}

/** Find the item that grants an aura, for a clickable link on the card. */
export function findAuraItem(actor, slug) {
  if (!actor) return null;
  const sluggify = game.pf2e?.system?.sluggify ?? ((s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return actor.items.find((i) => (i.system?.rules ?? []).some((r) =>
    r.key === "Aura" && (r.slug ?? i.slug ?? sluggify(i.name)) === slug))
    ?? actor.items.find((i) => i.slug === slug) ?? null;
}

// ---------- alert (GM only) ----------

export async function postAlert({ aura, target, reason }) {
  const emitter = aura.token;
  const config = getAuraConfig(aura.slug);
  const item = findAuraItem(emitter.actor, aura.slug);
  const f = {
    kind: "alert",
    status: "open",
    reason,
    sceneId: emitter.parent.id,
    emitterTokenId: emitter.id,
    targetTokenId: target.id,
    emitterName: emitter.name,
    targetName: target.name,
    slug: aura.slug,
    radius: aura.radius,
    label: config?.label ?? item?.name ?? aura.slug,
    itemUuid: item?.uuid ?? null,
    configured: !!config,
    config: config ?? null,
    dc: config ? resolveDC(config, emitter.actor) : null,
  };
  return ChatMessage.create({
    content: build(f),
    whisper: gmIds(),
    speaker: ChatMessage.getSpeaker({ alias: "AH PF2E Auras" }),
    flags: { [MODULE_ID]: { card: f } },
  });
}

/** After an aura is set up from an alert, refresh that alert so it can be posted. */
export async function refreshAlert(message) {
  const f = foundry.utils.deepClone(cardData(message));
  if (!f || f.kind !== "alert" || !game.messages.has(message.id)) return;
  const config = getAuraConfig(f.slug);
  const { emitterToken } = tokensFor(f);
  f.configured = !!config;
  f.config = config;
  f.label = config?.label ?? f.label;
  f.dc = config ? resolveDC(config, emitterToken?.actor) : null;
  await rewrite(message, f);
}

/** An aura was saved: update the open alerts for it (newest 100 messages). */
export async function refreshAlertsFor(slug) {
  if (!game.user.isGM) return;
  const recent = game.messages.contents.slice(-100);
  for (const m of recent) {
    const f = cardData(m);
    if (f?.kind === "alert" && f.slug === slug && f.status === "open") await refreshAlert(m);
  }
}

async function postPrompt(message) {
  const alert = foundry.utils.deepClone(cardData(message));
  const config = getAuraConfig(alert.slug);
  if (!config) return ui.notifications.warn("Set up this aura first.");
  const { emitterToken, targetToken } = tokensFor(alert);
  if (!targetToken) return ui.notifications.warn("That token isn't on its scene any more.");

  const f = {
    kind: "prompt",
    sceneId: alert.sceneId,
    emitterTokenId: alert.emitterTokenId,
    targetTokenId: alert.targetTokenId,
    emitterName: emitterToken?.name ?? alert.emitterName,
    targetName: targetToken.name,
    slug: alert.slug,
    label: config.label,
    itemUuid: alert.itemUuid,
    config,
    dc: resolveDC(config, emitterToken?.actor),
    showDC: getSetting("showDC"),
    showDetails: getSetting("showDetails"),
    immunityMarked: null,
  };
  const ownersOnly = getSetting("promptVisibility") === "owners";
  const owners = game.users.filter((u) => !u.isGM && targetToken.actor?.testUserPermission(u, "OWNER")).map((u) => u.id);
  const data = {
    content: build(f),
    // Speaking as the aura's owner lets PF2e link damage and effects back to it
    speaker: emitterToken ? ChatMessage.getSpeaker({ token: emitterToken }) : ChatMessage.getSpeaker({ alias: alert.emitterName }),
    flags: { [MODULE_ID]: { card: f } },
  };
  if (ownersOnly) data.whisper = [...new Set([...gmIds(), ...owners])];
  await ChatMessage.create(data);
  alert.status = "sent";
  await rewrite(message, alert);
}

async function onImmune(message, choice) {
  const f = foundry.utils.deepClone(cardData(message));
  if (!f || f.kind !== "prompt" || !IMMUNITY[choice] || choice === "none") return;
  const { targetToken } = tokensFor(f);
  if (!targetToken?.actor) return ui.notifications.warn("That token isn't on its scene any more.");
  if (!(await markImmune(targetToken.actor, f.emitterTokenId, f.slug, choice))) return;
  f.immunityMarked = choice;
  await rewrite(message, f);
}

// ---------- rendering & buttons ----------

export function onRenderChatMessage(message, html) {
  const f = cardData(message);
  if (!f) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  if (!game.user.isGM) {
    root.querySelectorAll("[data-gm-only]").forEach((el) => el.remove());
    root.querySelectorAll("[data-apz-action]").forEach((el) => el.remove());
    return;
  }

  root.querySelectorAll("[data-apz-action]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        await handleAction(message, btn.dataset.apzAction, btn.dataset);
      } catch (err) {
        console.error(`${MODULE_ID} | ${btn.dataset.apzAction} failed`, err);
        ui.notifications.error("AH PF2E Auras: that button failed. See the console (F12).");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

export async function handleAction(message, action, data = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can use that button.");
  const f = cardData(message);
  if (!f) return;
  // Ignore clicks on cards that have already been dealt with (e.g. a stale second window)
  if (f.kind === "alert" && f.status !== "open" && action !== "setup") return;
  switch (action) {
    case "send": return postPrompt(message);
    case "dismiss": return rewrite(message, { ...foundry.utils.deepClone(f), status: "dismissed" });
    case "mute": {
      const config = getAuraConfig(f.slug) ?? defaultConfig(f.slug, f.label);
      config.enabled = false;
      if (!(await saveAuraConfig(config))) return;
      return rewrite(message, { ...foundry.utils.deepClone(f), status: "muted" });
    }
    case "setup": {
      return AuraEditor.open(f.slug, { label: f.label });
    }
    case "immune": return onImmune(message, data.immunity);
  }
}
