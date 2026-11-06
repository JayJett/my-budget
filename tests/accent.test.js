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

test("six accents, each with a name, and Mint is the default", () => {
  assert.deepEqual(ACCENTS.map(a => a.key), ["mint", "ocean", "lavender", "coral", "rose", "amber"]);
  assert.equal(ACCENTS[0].key, "mint");
});

test("accents never touch member, status or chart colours", () => {
  const blocks = [...css.matchAll(/\[data-accent="\w+"\]\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(blocks.length >= 18);
  for (const b of blocks) assert.deepEqual(Object.keys(vars(b)).sort(), ["accent", "accent-hover", "accent-soft", "on-accent"]);
});
