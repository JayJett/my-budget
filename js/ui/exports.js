/* Getting data out (CSV, JSON backup) and back in (import). */
import { app, changed } from "./ctx.js";
import { $, offerFile, confirmDel, toast } from "./dom.js";
import { compute, goalStatus } from "../model/calc.js";
import { migrate } from "../model/migrate.js";
import { WORDS } from "../model/periods.js";
import { MONTHS, possessive } from "../model/format.js";
import { n, blank, ymd } from "../model/util.js";

const fileStem = () => (app.state.people.map(p => p.name).filter(Boolean).join("_") || "My") + "_Budget";

export function exportCSV() {
  const S = app.state, C = compute(S, app.today), v = C.v, w = WORDS[C.view], out = [];
  const q = x => { const s = x === null || x === undefined ? "" : String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const row = a => out.push(a.map(q).join(","));
  const r2 = x => Math.round(x * 100) / 100, pc = x => blank(x) ? "" : r2(x * 100);
  const P = C.people, PER = w.per.toUpperCase();
  row([`Budget (${S.people.map(p => p.name).join(" + ")})`, "Exported", new Date().toLocaleString("en-NZ"), "Amounts", w.per]); row([]);
  row(["PEOPLE"]); row(["Name", "Pay", "Paid", "Per year", w.per]); P.forEach(p => row([p.name, n(p.pay), p.freq, r2(p.annual), r2(v(p.annual))])); row([]);
  row(["ALLOCATION PLAN " + PER]); row(["Account", "Type", ...P.flatMap(p => [`${p.name} %`, `${p.name} $`]), "Total $"]);
  C.rows.forEach(r => row([r.name, r.type, ...P.flatMap(p => [pc(r.split[p.id]), r2(v(r.by[p.id]))]), r2(v(r.t))]));
  row(["Totals", "", ...P.flatMap(p => [r2(C.tot.pct[p.id] * 100), r2(v(C.tot.amt[p.id]))]), r2(v(C.tot.t))]); row([]);
  row(["NET WORTH", "Reviewed", S.nw.reviewed]); row(["Account", "Type", "Balance", "Earmarked"]);
  S.nw.accounts.forEach(a => row([a.name, a.type, n(a.balance), a.type === "Savings" ? r2(C.earmark[a.id]) : ""])); row(["Net worth", "", r2(C.nw.net)]); row([]);
  row(["SPENDING"]); row(["Category", "Type", "Amount", "Period", w.per, "Due month", "Set aside", "Notes"]);
  C.sp.forEach(s => row([s.name, s.type, n(s.amount), s.period, s.annual === null ? "" : r2(v(s.annual)), s.due ? MONTHS[s.due - 1] : "", blank(s.aside) ? "" : s.aside, s.notes])); row(["Committed", "", "", "", r2(v(C.committed))]); row([]);
  row(["GOALS"]); row(["Group", "Goal", "Target", "Saved", "Account", ...P.map(p => `${p.name} %`), "% of fund", w.per, "Deadline", "Status"]);
  const st = (g, a, ef) => goalStatus(g, a, ef, app.today, C.view).t;
  const ef = S.goals.ef;
  row(["Emergency fund", ef.name, ef.target, ef.saved, ef.account, ...P.map(() => ""), "", r2(v(C.pool.emergency)), ef.deadline, st(ef, C.pool.emergency, true)]);
  S.goals.joint.forEach((g, i) => row(["Joint", g.name, g.target, g.saved, g.account, ...P.map(p => pc(g.split[p.id])), "", C.gj.eff[i] === null ? "" : r2(v(C.gj.eff[i])), g.deadline, st(g, C.gj.eff[i], false)]));
  P.forEach(p => (S.goals.personal[p.id] || []).forEach((g, i) => { const A = C.gp[p.id]; row([possessive(p.name), g.name, g.target, g.saved, g.account, ...P.map(() => ""), pc(g.pct), A.eff[i] === null ? "" : r2(v(A.eff[i])), g.deadline, st(g, A.eff[i], false)]); }));
  row([]);
  row(["INVESTMENTS", "Return %", r2(C.inv.rate * 100), "Growth %", r2(C.inv.g * 100), "Fees %", r2(C.inv.fee * 100)]); row(["Year", "Contributed", "Balance", "Growth"]);
  C.inv.years.slice(1).forEach(d => row([d.y, Math.round(d.contrib), Math.round(d.bal), Math.round(d.growth)]));
  offerFile(`${fileStem()}_${ymd(app.today)}.csv`, "﻿" + out.join("\r\n"), "CSV");
}

export function exportJSON() {
  offerFile(`${fileStem()}_v4_backup_${ymd(app.today)}.json`, JSON.stringify(app.state, null, 1), "Backup");
}

export function initImport() {
  $("#importFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    let next;
    try {
      const txt = await f.text();
      const m = txt.match(/<script id="budget-data"[^>]*>([\s\S]*?)<\/script>/);
      const json = JSON.parse(m ? m[1] : txt);
      if (!json || (!json.accounts && !json.people)) throw new Error("no budget");
      delete json.ui; delete json.tab; delete json.savedAt;
      next = migrate(json);
      if (!next) throw new Error("empty");
    } catch (err) { toast("That file doesn’t contain budget data. Pick a saved budget .json or .html file."); return; }
    if (app.hasData && !(await confirmDel("Replace the current budget?", "Every number here will be swapped for the ones in this file, for everyone in the household. A backup of the current budget is kept.", "Replace"))) return;
    app.state = next;
    if (app.store) app.store.replaceNext("Imported a file");
    changed({ full: true }); toast("Imported and saved.");
  });
}
