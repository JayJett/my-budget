/* Accent colours: every theme must be readable in light and dark mode (WCAG AA, 4.5:1 for text). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCENTS } from "../js/ui/accent-list.js";

const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const lum = hex => {
  const c = hex.replace("#", "").match(/../g).map(x => parseInt(x, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const vars = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
const tokens = sel => { const i = css.indexOf(sel + "{"); assert.ok(i >= 0, `missing ${sel}`); return vars(css.slice(i, css.indexOf("}", i))); };
const base = { light: tokens(":root"), dark: tokens(':root[data-theme="dark"]') };

for (const { key, label } of ACCENTS) {
  test(`${label}: readable in light and dark mode`, () => {
    const modes = { light: tokens(`:root[data-accent="${key}"]`), dark: tokens(`:root[data-theme="dark"][data-accent="${key}"]`) };
    for (const [mode, t] of Object.entries(modes)) {
      const b = base[mode];
      for (const [what, bg] of [["page background", b.bg], ["cards", b.surface], ["soft accent fills", t["accent-soft"]]])
        assert.ok(ratio(t.accent, bg) >= 4.5, `${label} ${mode}: accent text on ${what} is ${ratio(t.accent, bg).toFixed(2)}:1`);
      assert.ok(ratio(t["on-accent"], t.accent) >= 4.5, `${label} ${mode}: text on accent buttons is ${ratio(t["on-accent"], t.accent).toFixed(2)}:1`);
      assert.ok(ratio(t["on-accent"], t["accent-hover"]) >= 4.5, `${label} ${mode}: text on pressed buttons`);
    }
  });
}

test("ten accents (Phase 8: Emerald, Teal, Sky and Purple added), each with a name, and Mint is the default", () => {
  assert.deepEqual(ACCENTS.map(a => a.key), ["mint", "emerald", "teal", "ocean", "sky", "lavender", "purple", "rose", "coral", "amber"]);
  assert.equal(ACCENTS[0].key, "mint");
});

test("accents never touch member, status or chart colours", () => {
  const blocks = [...css.matchAll(/\[data-accent="\w+"\]\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(blocks.length >= 18);
  for (const b of blocks) {
    const k = Object.keys(vars(b)).sort();
    // either the accent itself, or (Phase 7C redesign) its light version for the dark hero cards
    assert.ok(JSON.stringify(k) === JSON.stringify(["accent", "accent-hover", "accent-soft", "on-accent"]) || JSON.stringify(k) === JSON.stringify(["acc-d", "on-acc-d"]), k.join(","));
  }
});

test("the dark hero cards and the dark setup screens are readable (Phase 7C redesign)", () => {
  const block = sel => { const i = css.indexOf(sel); assert.ok(i >= 0, `missing ${sel}`); return vars(css.slice(i, css.indexOf("}", css.indexOf("{", i)))); };
  for (const mode of ["light", "dark"]) {
    const hero = base[mode].hero, h = block(":is(.b-income, .nw-hero, .sp-sum, .gl-sum, .iv-hero, .pg-hero).card{");
    for (const k of ["ink", "muted", "ok", "warn", "bad", "c-blue", "c-gold", "c-coral", "c-rose", "c-slate", "c-teal", "c-purple", "c-green", "joint", "invest"])
      assert.ok(ratio(h[k], hero) >= 4.5, `${mode}: ${k} on the hero card is ${ratio(h[k], hero).toFixed(2)}:1`);
    assert.ok(ratio(h.muted, h["surface-2"]) >= 4.5, `${mode}: muted text on a hero tile`);
  }
  // each accent's light version on the hero card, and text on it
  const accD = [...css.matchAll(/--acc-d:(#[0-9A-Fa-f]{6}); --on-acc-d:(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]);
  assert.ok(accD.length >= 7);
  for (const hero of [base.light.hero, base.dark.hero]) for (const [a, on] of accD) {
    assert.ok(ratio(a, hero) >= 4.5, `accent ${a} on the hero card is ${ratio(a, hero).toFixed(2)}:1`);
    assert.ok(ratio(on, a) >= 4.5, `text on ${a} buttons`);
  }
  const im = block(".im{");
  for (const k of ["ink", "muted", "accent", "bad", "ok"]) assert.ok(ratio(im[k], im.bg) >= 4.5 && ratio(im[k], im["surface-2"]) >= 4.5, `setup screens: ${k}`);
  assert.ok(ratio(im["on-accent"], im.accent) >= 4.5);
  // Phase 8: a colour picked on setup step 1 shows on these screens too
  for (const [a, on] of accD) {
    assert.ok(ratio(a, im.bg) >= 4.5 && ratio(a, im["surface-2"]) >= 4.5, `accent ${a} on the setup screens`);
    assert.ok(ratio(on, a) >= 4.5);
  }
});

test("status and people's colours are readable too (phase 6 audit: warning chips and the gold person colour)", () => {
  for (const [mode, b] of Object.entries(base)) {
    assert.ok(ratio(b.warn, b["warn-soft"]) >= 4.5, `${mode}: warning text on its chip is ${ratio(b.warn, b["warn-soft"]).toFixed(2)}:1`);
    assert.ok(ratio(b.bad, b["bad-soft"]) >= 4.5, `${mode}: problem text on its chip is ${ratio(b.bad, b["bad-soft"]).toFixed(2)}:1`);
    assert.ok(ratio(b.ok, b["ok-soft"]) >= 4.5, `${mode}: good-news text on its chip is ${ratio(b.ok, b["ok-soft"]).toFixed(2)}:1`);
    for (const c of ["blue", "gold", "coral", "rose", "slate"]) {
      assert.ok(ratio(b[`c-${c}`], b.surface) >= 4.5, `${mode}: ${c} person colour on cards is ${ratio(b[`c-${c}`], b.surface).toFixed(2)}:1`);
      assert.ok(ratio(b[`c-${c}`], b[`c-${c}-tint`]) >= 4.5, `${mode}: ${c} on its tint is ${ratio(b[`c-${c}`], b[`c-${c}-tint`]).toFixed(2)}:1`);
    }
  }
});
