// detect.js — works out when a token is in an aura and tells the GM.
// Runs only on the active GM's client, and only for the scene the GM is viewing
// (PF2e can only measure auras for tokens drawn on the canvas).

import { MODULE_ID, getAuraConfig, getSetting, triggerAllows } from "./core.js";
import { isImmune } from "./apply.js";
import { postAlert } from "./chat.js";

/** Pairs currently overlapping: key → true */
const inside = new Set();
/** Pair+reason → stamp of the last alert, so we don't repeat in the same turn */
const lastAlert = new Map();

const pairKey = (aura, target) => `${aura.token.id}|${aura.slug}|${target.id}`;

function turnStamp() {
  const c = game.combat;
  if (c?.started) return `${c.id}:${c.round}:${c.turn}`;
  return null;
}

function recentlyAlerted(key) {
  const last = lastAlert.get(key);
  if (!last) return false;
  const stamp = turnStamp();
  if (stamp) return last.stamp === stamp;
  return Date.now() - last.time < 15000;
}

function remember(key) {
  lastAlert.set(key, { stamp: turnStamp(), time: Date.now() });
  if (lastAlert.size > 500) lastAlert.delete(lastAlert.keys().next().value);
}

function counts(emitter, target) {
  if (!target.actor || target === emitter) return false;
  if (getSetting("targets") === "pcs" && !target.actor.hasPlayerOwner) return false;
  if ((target.actor.hitPoints?.value ?? 1) <= 0) return false;
  if (getSetting("whoseAuras") === "enemies") {
    const ea = emitter.actor;
    if (!ea) return false;
    // Only enemies; fall back to "not an ally" for actors without an alliance
    if (typeof ea.isEnemyOf === "function" && ea.alliance !== null && target.actor.alliance !== null) {
      if (!ea.isEnemyOf(target.actor)) return false;
    } else if (ea.isAllyOf?.(target.actor)) return false;
  }
  return true;
}

function contains(aura, token) {
  try { return aura.containsToken(token); } catch { return false; }
}

/** Every (aura, target) pair on the scene. */
export function auraPairs(scene) {
  const tokens = scene?.tokens?.contents ?? [];
  const out = [];
  for (const emitter of tokens) {
    const auras = emitter.auras;
    if (!auras?.size) continue;
    for (const aura of auras.values()) {
      for (const target of tokens) {
        if (!counts(emitter, target)) continue;
        if (contains(aura, target)) out.push({ aura, target });
      }
    }
  }
  return out;
}

async function maybeAlert(aura, target, reason) {
  const config = getAuraConfig(aura.slug);
  if (config) {
    if (!config.enabled || !triggerAllows(config.trigger, reason)) return;
  } else if (getSetting("unconfigured") === "ignore") return;
  if (isImmune(target.actor, aura.token.id, aura.slug)) return;
  const key = `${pairKey(aura, target)}|${reason}`;
  if (recentlyAlerted(key)) return;
  remember(key);
  await postAlert({ aura, target, reason });
}

function canRun() {
  return game.user.isActiveGM && canvas?.ready && canvas.scene && getSetting("enabled");
}

/** Compare overlaps with last time; alert on new entries. */
export async function scan({ silent = false } = {}) {
  if (!canRun()) return;
  const now = new Set();
  const fresh = [];
  for (const { aura, target } of auraPairs(canvas.scene)) {
    const key = pairKey(aura, target);
    now.add(key);
    if (!inside.has(key)) fresh.push({ aura, target });
  }
  inside.clear();
  for (const k of now) inside.add(k);
  if (silent) return;
  for (const { aura, target } of fresh) await maybeAlert(aura, target, "enter");
}

let timer = null;
export function queueScan() {
  clearTimeout(timer);
  timer = setTimeout(() => scan().catch((err) => console.error(`${MODULE_ID} | scan failed`, err)), 300);
}

/** Token movement: wait for the move animation so PF2e measures the final position. */
export async function onTokenMoved(doc, change) {
  if (!canRun() || doc.parent !== canvas.scene) return;
  if (!("x" in change || "y" in change || "elevation" in change || "hidden" in change)) return;
  const anim = doc.object?.movementAnimationPromise;
  if (anim) { try { await anim; } catch { /* ignore */ } }
  queueScan();
  // Check again once any animation has surely finished; only new entries are reported
  setTimeout(queueScan, 1200);
}

/** PF2e's start-of-turn hook (runs on the GM who advances the turn). */
export async function onStartTurn(combatant) {
  if (!canRun()) return;
  const token = combatant?.token;
  if (!token || token.parent !== canvas.scene) return;
  for (const { aura, target } of auraPairs(canvas.scene)) {
    if (target.id === token.id) await maybeAlert(aura, target, "turnStart");
  }
}

/** Forget everything (scene change); the next scan is silent so it doesn't spam. */
export function resetState() {
  inside.clear();
}

/** Manual check: alert the GM about every aura the given tokens are in right now. */
export async function checkTokens(tokens) {
  if (!game.user.isGM) return;
  const ids = new Set(tokens.map((t) => (t.document ?? t).id));
  let n = 0;
  for (const { aura, target } of auraPairs(canvas.scene)) {
    if (!ids.has(target.id)) continue;
    await postAlert({ aura, target, reason: "manual" });
    n++;
  }
  if (!n) ui.notifications.info("Those tokens aren't in any aura that counts.");
}
