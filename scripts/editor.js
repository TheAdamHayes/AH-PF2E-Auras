// editor.js — the "Aura save" editor and the list of set-up auras.

import {
  COMMON_CONDITIONS, DAMAGE_LABELS, DC_MODES, DEGREE_LABELS, DEGREE_ORDER, IMMUNITY, MODULE_ID,
  SAVE_LABELS, TRIGGERS, VALUED_CONDITIONS, applyBasicSave, conditionLabelsFromConfig, defaultConfig,
  deleteAuraConfig, describeConfig, describeOutcome, escapeHTML, getAuraConfig, getAuraConfigs,
  humanize, isBasicSave, looksLikeFormula, normalizeConfig, saveAuraConfig,
} from "./core.js";

const esc = escapeHTML;
const { ApplicationV2, DialogV2 } = foundry.applications.api;

function options(map, selected) {
  return Object.entries(map).map(([value, label]) =>
    `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
}

function conditionChoices() {
  const labels = conditionLabelsFromConfig();
  const slugs = Object.keys(labels).length ? Object.keys(labels) : COMMON_CONDITIONS;
  const skip = new Set(["persistent-damage", "dying", "wounded", "dead", "encumbered", "friendly", "helpful", "hostile", "indifferent", "unfriendly", "observed", "hidden", "undetected", "unnoticed", "concealed", "cover", "quickened", "malevolence"]);
  const out = {};
  for (const s of slugs.filter((s) => !skip.has(s)).sort()) out[s] = labels[s] ?? humanize(s);
  return out;
}

function damageTypeChoices() {
  const types = CONFIG.PF2E?.damageTypes ?? {};
  const out = { "": "— untyped / written in the dice —" };
  for (const [slug, label] of Object.entries(types)) out[slug] = game.i18n.localize(label);
  return out;
}

function parseUuid(text) {
  const t = String(text ?? "").trim();
  const m = t.match(/@UUID\[([^\]]+)\]/);
  return m ? m[1] : t;
}

function getDragData(event) {
  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  try { return TE.getDragEventData(event); } catch { return null; }
}

// =====================================================================
// Aura editor
// =====================================================================

export class AuraEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: [`${MODULE_ID}-dialog`, "apz-editor"],
    window: { title: "Aura save", icon: "fa-solid fa-bullseye", resizable: true },
    position: { width: 760, height: 720 },
  };

  /** Open (or focus) the editor for one aura. */
  static open(slug, { label, onSaved } = {}) {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can set up auras.");
    const existing = [...foundry.applications.instances.values()]
      .find((a) => a instanceof AuraEditor && a.slug === slug);
    if (existing) {
      existing.bringToFront?.();
      return existing;
    }
    return new AuraEditor(slug, { label, onSaved }).render({ force: true });
  }

  constructor(slug, { label, onSaved } = {}) {
    super({ id: `${MODULE_ID}-editor-${String(slug).replace(/[^a-z0-9-]/gi, "_")}` });
    this.slug = slug;
    const saved = getAuraConfig(slug);
    this.isNew = !saved;
    this.draft = saved ?? defaultConfig(slug, label);
    this.savedJSON = saved ? JSON.stringify(saved) : null;
    this.onSaved = onSaved;
    this._scroll = 0;
  }

  get title() {
    return `Aura save: ${this.draft?.label || this.slug}`;
  }

  get dirty() {
    return JSON.stringify(normalizeConfig(this.draft)) !== this.savedJSON;
  }

  get formulaOK() {
    return looksLikeFormula(this.draft.damageFormula);
  }

  async _renderHTML() {
    const d = this.draft;
    const conds = conditionChoices();
    const outcomeCards = DEGREE_ORDER.map((key) => this.#outcomeCard(key, d.outcomes[key], conds)).join("");
    return `
<form class="apz-form" autocomplete="off">
  <div class="apz-body">
    <section class="apz-section">
      <h3>The aura</h3>
      <div class="apz-grid2">
        <label>Name shown on cards<input type="text" data-field="label" value="${esc(d.label)}"></label>
        <label>Aura id <span class="apz-muted">(from PF2e)</span><input type="text" value="${esc(d.slug)}" disabled></label>
      </div>
      <label class="apz-check"><input type="checkbox" data-field="enabled"${d.enabled ? " checked" : ""}> Tell me when someone is in this aura</label>
      <label>When to tell me<select data-field="trigger">${options(TRIGGERS, d.trigger)}</select></label>
    </section>

    <section class="apz-section">
      <h3>The save</h3>
      <div class="apz-grid2">
        <label>Save<select data-field="save">${options(SAVE_LABELS, d.save)}</select></label>
        <label>DC<select data-field="dcMode" data-rerender>${options(DC_MODES, d.dcMode)}</select></label>
      </div>
      ${d.dcMode === "fixed" ? `<label class="apz-narrow">DC number<input type="number" min="1" max="60" step="1" data-field="dcFixed" value="${esc(d.dcFixed)}"></label>` : ""}
    </section>

    <section class="apz-section">
      <h3>Damage <span class="apz-muted">(leave blank if the aura doesn't deal damage)</span></h3>
      <div class="apz-grid2">
        <label>Damage dice<input type="text" data-field="damageFormula" placeholder="e.g. 2d6 or 3d8+4" value="${esc(d.damageFormula)}"></label>
        <label>Damage type<select data-field="damageType">${options(damageTypeChoices(), d.damageType)}</select></label>
      </div>
      <p class="apz-warn" data-formula-warning${this.formulaOK ? " hidden" : ""}>That doesn't look like dice. Use something like <code>2d6</code> or <code>3d8+4</code>.</p>
      <div class="apz-row">
        <button type="button" data-action-local="basic"><i class="fa-solid fa-scale-balanced"></i> Use basic save damage</button>
        <span class="apz-muted" data-basic-note></span>
      </div>
    </section>

    <section class="apz-section">
      <h3>What each result does</h3>
      <p class="apz-small apz-muted">Nothing is applied for you. The save request shows these as PF2e links: click the damage to roll it and use the damage card's buttons, and drag conditions or effects onto the token.</p>
      <div class="apz-outcomes-grid">${outcomeCards}</div>
    </section>
  </div>

  <footer class="apz-footer">
    <p class="apz-readback" data-readback>${esc(describeConfig(d, conditionLabelsFromConfig()))}</p>
    <p class="apz-status" data-status></p>
    <div class="apz-row apz-end">
      <button type="button" data-action-local="cancel"><i class="fa-solid fa-xmark"></i> Close</button>
      <button type="button" data-action-local="save" class="apz-primary"><i class="fa-solid fa-floppy-disk"></i> Save</button>
    </div>
  </footer>
</form>`;
  }

  #outcomeCard(key, o, conds) {
    const condRows = o.conditions.map((c, i) => `
      <div class="apz-cond">
        <select data-cond-slug data-degree="${key}" data-index="${i}">${options(conds, c.slug)}</select>
        ${VALUED_CONDITIONS.has(c.slug)
          ? `<input type="number" min="1" max="10" step="1" data-cond-value data-degree="${key}" data-index="${i}" value="${esc(c.value)}" title="Value">`
          : `<span class="apz-spacer"></span>`}
        <button type="button" class="apz-icon" data-action-local="remove-cond" data-degree="${key}" data-index="${i}" title="Remove"><i class="fa-solid fa-trash"></i></button>
      </div>`).join("");
    const effectRows = o.effects.map((e, i) => `
      <div class="apz-effect">
        <a class="content-link" data-link data-uuid="${esc(e.uuid)}"><i class="fa-solid fa-person-rays"></i>${esc(e.name)}</a>
        <button type="button" class="apz-icon" data-action-local="remove-effect" data-degree="${key}" data-index="${i}" title="Remove"><i class="fa-solid fa-trash"></i></button>
      </div>`).join("");
    return `
    <div class="apz-ocard apz-${key}">
      <h4>${esc(DEGREE_LABELS[key])}</h4>
      <label>Damage<select data-field="outcomes.${key}.damage">${options(DAMAGE_LABELS, o.damage)}</select></label>
      <div class="apz-sub">Conditions</div>
      ${condRows || `<p class="apz-muted apz-small">None.</p>`}
      <button type="button" data-action-local="add-cond" data-degree="${key}"><i class="fa-solid fa-plus"></i> Add a condition</button>
      <div class="apz-sub">Effects</div>
      ${effectRows}
      <div class="apz-drop" data-drop="${key}">Drop an effect here from a compendium or the sidebar</div>
      <label>Immunity reminder<select data-field="outcomes.${key}.immunity">${options(Object.fromEntries(Object.entries(IMMUNITY).map(([k, v]) => [k, v.label])), o.immunity)}</select></label>
      <label>Reminder on the card <span class="apz-muted">(optional)</span><input type="text" data-field="outcomes.${key}.note" value="${esc(o.note)}" placeholder="e.g. Pushed 5 feet away"></label>
      <p class="apz-small apz-muted" data-summary="${key}">${esc(describeOutcome(o, this.draft, conditionLabelsFromConfig()))}</p>
    </div>`;
  }

  _replaceHTML(result, content) {
    const body = content.querySelector(".apz-body");
    if (body) this._scroll = body.scrollTop;
    content.innerHTML = result;
    const newBody = content.querySelector(".apz-body");
    if (newBody) newBody.scrollTop = this._scroll;
    content.scrollTop = 0;
    if (this.element) this.element.scrollTop = 0;
    this.#bind(content);
    this.#updateStatus();
  }

  #rerender() {
    const body = this.element?.querySelector(".apz-body");
    if (body) this._scroll = body.scrollTop;
    this.render();
  }

  #bind(root) {
    root.querySelectorAll("[data-field]").forEach((el) => {
      const handler = () => {
        const path = el.dataset.field;
        let value = el.type === "checkbox" ? el.checked : el.value;
        if (el.type === "number") value = Number(value);
        foundry.utils.setProperty(this.draft, path, value);
        if (el.hasAttribute("data-rerender")) this.#rerender();
        else this.#updateStatus();
      };
      el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", handler);
    });

    root.querySelectorAll("[data-cond-slug]").forEach((el) => el.addEventListener("change", () => {
      const c = this.draft.outcomes[el.dataset.degree].conditions[Number(el.dataset.index)];
      c.slug = el.value;
      c.value = c.value || 1;
      this.#rerender(); // value box appears/disappears
    }));
    root.querySelectorAll("[data-cond-value]").forEach((el) => el.addEventListener("input", () => {
      const c = this.draft.outcomes[el.dataset.degree].conditions[Number(el.dataset.index)];
      c.value = Math.max(1, Math.min(10, Math.trunc(Number(el.value)) || 1));
      this.#updateStatus();
    }));

    root.querySelectorAll("[data-action-local]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.#onAction(el.dataset.actionLocal, el.dataset);
    }));

    root.querySelectorAll("[data-drop]").forEach((zone) => {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("apz-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("apz-over"));
      zone.addEventListener("drop", (ev) => { ev.preventDefault(); zone.classList.remove("apz-over"); this.#onDrop(ev, zone.dataset.drop); });
    });

    root.querySelector("form")?.addEventListener("submit", (ev) => ev.preventDefault());
    if (!this._keysBound) {
      this._keysBound = true;
      this.element.addEventListener("keydown", (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
          ev.preventDefault();
          ev.stopPropagation();
          this.#save();
        }
      });
    }
  }

  async #onDrop(event, degree) {
    const data = getDragData(event);
    const uuid = data?.uuid ?? (data?.type === "Item" && data?.id ? `Item.${data.id}` : null) ?? parseUuid(event.dataTransfer?.getData("text/plain"));
    if (!uuid) return ui.notifications.warn("Drop an effect item here.");
    const item = await fromUuid(uuid);
    if (!item || item.documentName !== "Item") return ui.notifications.warn("That isn't an item.");
    if (!["effect", "affliction", "condition"].includes(item.type)) {
      return ui.notifications.warn(`"${item.name}" is a ${item.type}, not an effect. Drop an effect item.`);
    }
    if (item.type === "condition") {
      // Conditions belong in the conditions list
      this.draft.outcomes[degree].conditions.push({ slug: item.slug, value: item.value ?? 1 });
    } else {
      this.draft.outcomes[degree].effects.push({ uuid: item.uuid, name: item.name });
    }
    this.#rerender();
  }

  #onAction(action, data) {
    const d = this.draft;
    switch (action) {
      case "basic":
        this.draft = applyBasicSave(d);
        return this.#rerender();
      case "add-cond":
        d.outcomes[data.degree].conditions.push({ slug: "frightened", value: 1 });
        return this.#rerender();
      case "remove-cond":
        d.outcomes[data.degree].conditions.splice(Number(data.index), 1);
        return this.#rerender();
      case "remove-effect":
        d.outcomes[data.degree].effects.splice(Number(data.index), 1);
        return this.#rerender();
      case "save":
        return this.#save();
      case "cancel":
        return this.close();
    }
  }

  #updateStatus() {
    const root = this.element;
    if (!root) return;
    const labels = conditionLabelsFromConfig();
    const d = normalizeConfig(this.draft);
    const readback = root.querySelector("[data-readback]");
    if (readback) readback.textContent = describeConfig(d, labels);
    for (const key of DEGREE_ORDER) {
      const el = root.querySelector(`[data-summary="${key}"]`);
      if (el) el.textContent = describeOutcome(d.outcomes[key], d, labels);
    }
    const basic = isBasicSave(d);
    const basicBtn = root.querySelector('[data-action-local="basic"]');
    if (basicBtn) basicBtn.disabled = basic;
    const basicNote = root.querySelector("[data-basic-note]");
    if (basicNote) basicNote.textContent = basic ? "Basic save: none / half / full / double."
      : "Sets critical success none, success half, failure full, critical failure double.";
    const warn = root.querySelector("[data-formula-warning]");
    if (warn) warn.hidden = this.formulaOK;
    const status = root.querySelector("[data-status]");
    const save = root.querySelector('[data-action-local="save"]');
    const canSave = (this.dirty || this.isNew) && this.formulaOK;
    if (status) {
      status.textContent = !this.formulaOK ? "Fix the damage dice before saving."
        : this.isNew && !this.savedJSON ? "New aura — not saved yet."
        : this.dirty ? "Unsaved changes to this aura." : "All changes saved.";
      status.classList.toggle("apz-unsaved", this.dirty || this.isNew);
    }
    if (save) save.disabled = !canSave;
  }

  async #save() {
    if (!this.formulaOK) return ui.notifications.warn("Fix the damage dice first.");
    const c = normalizeConfig(this.draft);
    if (!(await saveAuraConfig(c))) return;
    this.draft = c;
    this.savedJSON = JSON.stringify(c);
    this.isNew = false;
    ui.notifications.info(`Saved "${c.label}".`);
    Hooks.callAll(`${MODULE_ID}.auraSaved`, c);
    try { await this.onSaved?.(c); } catch (err) { console.error(`${MODULE_ID} | onSaved`, err); }
    for (const app of foundry.applications.instances.values()) if (app instanceof AuraList) app.render();
    this.#updateStatus();
  }

  async close(options = {}) {
    const unsaved = this.savedJSON !== null ? this.dirty : this.#touched();
    if (!options.force && unsaved) {
      const ok = await DialogV2.confirm({
        window: { title: "Unsaved changes" },
        classes: [`${MODULE_ID}-dialog`],
        content: `<p>You haven't saved your changes to <strong>${esc(this.draft.label)}</strong>. Close anyway and lose them?</p>`,
        yes: { label: "Close without saving", icon: "fa-solid fa-trash" },
        no: { label: "Keep editing", default: true },
        rejectClose: false,
      });
      if (!ok) return this;
    }
    return super.close({ ...options, force: true });
  }

  #touched() {
    return JSON.stringify(normalizeConfig(this.draft)) !== JSON.stringify(defaultConfig(this.slug, this.draft.label));
  }
}

// =====================================================================
// List of set-up auras (Module Settings → Aura saves)
// =====================================================================

export class AuraList extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-list`,
    classes: [`${MODULE_ID}-dialog`, "apz-list"],
    window: { title: "Aura saves", icon: "fa-solid fa-bullseye", resizable: true },
    position: { width: 640, height: 560 },
  };

  /** Aura slugs on the viewed scene that aren't set up yet */
  #sceneAuras(configs) {
    const out = new Map();
    for (const t of canvas?.scene?.tokens?.contents ?? []) {
      for (const aura of t.auras?.values?.() ?? []) {
        if (!configs[aura.slug] && !out.has(aura.slug)) out.set(aura.slug, `${humanize(aura.slug)} (${t.name})`);
      }
    }
    return out;
  }

  async _renderHTML() {
    const configs = getAuraConfigs();
    const labels = conditionLabelsFromConfig();
    const rows = Object.values(configs).sort((a, b) => a.label.localeCompare(b.label)).map((c) => `
      <li class="apz-item${c.enabled ? "" : " apz-off"}">
        <div class="apz-item-main">
          <strong>${esc(c.label)}</strong> <span class="apz-muted">${esc(c.slug)}</span>
          <p class="apz-small">${esc(describeConfig(c, labels))}</p>
        </div>
        <div class="apz-item-buttons">
          <label class="apz-check" title="Tell me about this aura"><input type="checkbox" data-toggle="${esc(c.slug)}"${c.enabled ? " checked" : ""}> On</label>
          <button type="button" data-edit="${esc(c.slug)}"><i class="fa-solid fa-pen"></i> Edit</button>
          <button type="button" class="apz-icon" data-delete="${esc(c.slug)}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </li>`).join("");
    const scene = this.#sceneAuras(configs);
    const sceneOptions = [...scene].map(([slug, label]) => `<option value="${esc(slug)}">${esc(label)}</option>`).join("");
    return `
<div class="apz-form">
  <div class="apz-body">
    ${rows ? `<ul class="apz-items">${rows}</ul>` : `<p class="apz-muted">No auras set up yet. When an aura check card appears in chat, click "Set up this aura", or add one below.</p>`}
  </div>
  <footer class="apz-footer">
    <div class="apz-row">
      ${scene.size ? `<select data-scene-pick>${sceneOptions}</select><button type="button" data-add-scene><i class="fa-solid fa-plus"></i> Set up</button>`
        : `<span class="apz-muted">No un-set-up auras on this scene.</span>`}
    </div>
    <div class="apz-row">
      <input type="text" data-new-slug placeholder="Or type an aura id, e.g. frightful-presence">
      <button type="button" data-add-slug><i class="fa-solid fa-plus"></i> Add</button>
    </div>
  </footer>
</div>`;
  }

  _replaceHTML(result, content) {
    const body = content.querySelector(".apz-body");
    const scroll = body?.scrollTop ?? 0;
    content.innerHTML = result;
    const nb = content.querySelector(".apz-body");
    if (nb) nb.scrollTop = scroll;
    content.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => AuraEditor.open(b.dataset.edit)));
    content.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("change", async () => {
      const c = getAuraConfig(b.dataset.toggle);
      if (!c) return;
      c.enabled = b.checked;
      await saveAuraConfig(c);
      this.render();
    }));
    content.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", async () => {
      const c = getAuraConfig(b.dataset.delete);
      const ok = await DialogV2.confirm({
        window: { title: "Delete aura setup" },
        classes: [`${MODULE_ID}-dialog`],
        content: `<p>Delete the setup for <strong>${esc(c?.label ?? b.dataset.delete)}</strong>? You'll be asked to set it up again next time it comes up.</p>`,
        yes: { label: "Delete", icon: "fa-solid fa-trash" },
        no: { label: "Keep it", default: true },
        rejectClose: false,
      });
      if (!ok) return;
      await deleteAuraConfig(b.dataset.delete);
      this.render();
    }));
    content.querySelector("[data-add-scene]")?.addEventListener("click", () => {
      const slug = content.querySelector("[data-scene-pick]")?.value;
      if (slug) AuraEditor.open(slug, { onSaved: () => this.render() });
    });
    content.querySelector("[data-add-slug]")?.addEventListener("click", () => {
      const raw = content.querySelector("[data-new-slug]")?.value ?? "";
      const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!slug) return ui.notifications.warn("Type an aura id first.");
      AuraEditor.open(slug, { onSaved: () => this.render() });
    });
  }
}
