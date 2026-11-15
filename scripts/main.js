// main.js — entry point: settings, hooks, API.

import { MODULE_ID, getAuraConfig, getAuraConfigs } from "./core.js";
import { onRenderChatMessage, postAlert, refreshAlertsFor } from "./chat.js";
import { auraPairs, checkTokens, onStartTurn, onTokenMoved, queueScan, resetState, scan } from "./detect.js";
import { AuraEditor, AuraList } from "./editor.js";

// Registered at init so cards already in the chat log when the world loads get their buttons
Hooks.on("renderChatMessageHTML", (message, html) => onRenderChatMessage(message, html));

Hooks.once("init", () => {
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });

  game.settings.registerMenu(MODULE_ID, "auraList", {
    name: "Aura saves",
    label: "Set up auras",
    hint: "Choose the save, DC and what happens on each result for each aura.",
    icon: "fa-solid fa-bullseye",
    type: AuraList,
    restricted: true,
  });

  world("enabled", {
    name: "Watch auras",
    hint: "Tell the GM (privately) when a token moves into an aura or starts its turn in one.",
    type: Boolean, default: true,
    onChange: () => queueScan(),
  });
  world("targets", {
    name: "Whose saves to check",
    type: String, default: "pcs",
    choices: { pcs: "Player characters only", all: "Every creature (PCs and NPCs)" },
  });
  world("whoseAuras", {
    name: "Which auras count",
    type: String, default: "enemies",
    choices: { enemies: "Only auras from the target's enemies", all: "Every aura, including allies'" },
  });
  world("unconfigured", {
    name: "Auras that aren't set up yet",
    hint: "Auras you haven't set up don't know their save. Choose whether to still be told about them.",
    type: String, default: "alert",
    choices: { alert: "Tell me, with a button to set them up", ignore: "Ignore them" },
  });
  world("promptVisibility", {
    name: "Who sees the save request",
    type: String, default: "public",
    choices: { public: "Everyone", owners: "Only the GM and that character's player" },
  });
  world("showDC", {
    name: "Show the DC to players",
    hint: "Used on the save button of new save requests.",
    type: Boolean, default: true,
  });
  world("showDetails", {
    name: "Show players what each result does",
    hint: "If off, players only see the save; the GM still sees everything.",
    type: Boolean, default: true,
  });
  game.settings.register(MODULE_ID, "auras", { scope: "world", config: false, type: Object, default: {} });

  game.keybindings.register(MODULE_ID, "checkSelected", {
    name: "Check selected tokens for auras",
    hint: "Post an aura check card for every aura the selected tokens are standing in.",
    editable: [],
    restricted: true,
    onDown: () => { checkTokens(canvas.tokens.controlled); return true; },
  });
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    if (game.user.isGM) ui.notifications.error("AH PF2E Auras needs the Pathfinder Second Edition system.");
    return;
  }

  game.modules.get(MODULE_ID).api = {
    /** Open the editor for an aura slug. */
    openAuraEditor: (slug, opts) => AuraEditor.open(slug, opts),
    /** Open the list of set-up auras. */
    openAuraList: () => new AuraList().render({ force: true }),
    /** Post aura check cards for the given (or selected) tokens. */
    checkTokens: (tokens = canvas.tokens.controlled) => checkTokens(tokens),
    /** Re-check the scene now. */
    scan: () => scan(),
    /** Every (aura, target) pair on the viewed scene, for macros. */
    auraPairs: () => auraPairs(canvas.scene),
    getAuraConfig,
    getAuraConfigs,
    postAlert,
  };

  Hooks.on("updateToken", (doc, change, options) => {
    if (options?.[MODULE_ID]) return;
    onTokenMoved(doc, change);
  });
  Hooks.on("createToken", () => queueScan());
  Hooks.on("deleteToken", () => queueScan());
  // Stances, effects and feats can add or remove auras
  for (const hook of ["createItem", "deleteItem", "updateItem"]) {
    Hooks.on(hook, (item) => {
      if (item.parent instanceof Actor) queueScan();
    });
  }
  Hooks.on("canvasReady", () => { resetState(); scan({ silent: true }); });
  Hooks.on("pf2e.startTurn", (combatant) => onStartTurn(combatant));
  Hooks.on(`${MODULE_ID}.auraSaved`, (config) => refreshAlertsFor(config.slug));

  // Remember who is already inside auras, without posting anything
  scan({ silent: true });
});
