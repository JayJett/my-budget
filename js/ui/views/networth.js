/* Net worth tab: real account balances, and whether goal money lines up with savings.

   Layout only. Every figure comes from compute() (model/calc.js) through fill(), exactly as before,
   and every edit goes through the same boxes (data-l="nw" …) and handlers, in the editing sheet
   (ui/budget-sheets.js). Balances are typed in by hand: nothing here talks to a bank, so the wording
   says "last reviewed", never "synced" or "live".

   Goal money: a goal's Saved amount is money that already sits in one of these accounts, so it's
   shown as a slice of that account's balance ("earmarked"), never added on top of it. */
import { app, readOnly } from "../ctx.js";
import { esc } from "../dom.js";
import { K, tipq, attrs } from "../inputs.js";
import { budgetUI } from "../budget-sheets.js";
import { drawSplit } from "../charts.js";
import { nwStatus as nwStatusOf } from "../../model/calc.js"; // the status wording is the model's own, unchanged
import { money, MONTHS } from "../../model/format.js";
import { n, blank, parseDate, daysBetween } from "../../model/util.js";
import { ART } from "../art.js";
import { itemIcon } from "../icons.js";
import { isObjectColour } from "../palette.js";

/** The account types (exactly the stored ones), their fixed colours and short help. Never the accent. */
export const NW_TYPES = [
  { key: "Operating", label: "Everyday", col: "var(--nw-op)", help: "Everyday bills come out of it." },
  { key: "Savings", label: "Savings", col: "var(--nw-sav)", help: "Where goal money lives." },
  { key: "Investment", label: "Investments", col: "var(--nw-inv)", help: "Shares and funds. Feeds the Invest tab." },
  { key: "Super", label: "Super", col: "var(--nw-sup)", help: "Retirement savings, like KiwiSaver." },
  { key: "Debt", label: "Debt", col: "var(--nw-debt)", help: "What you owe. Enter it as a positive number." },
];
/** How the list is grouped on screen. Only a visual heading: the type on each account is unchanged. */
const GROUPS = [
  { key: "cash", title: "Cash", types: ["Operating", "Savings"], add: "Savings", tot: "nw.grp.cash" },
  { key: "long", title: "Investments and super", types: ["Investment", "Super"], add: "Investment", tot: "nw.grp.long" },
  { key: "debt", title: "Debt", types: ["Debt"], add: "Debt", tot: "nw.grp.debt" },
];
const ICON = {
  Operating: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="12" height="8.5" rx="1.8"/><path d="M2 7h12M4.5 10h2.5"/></svg>',
  Savings: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5a5 4 0 0 1 5-4h1.5a4.5 4 0 0 1 3.4 1.6l1.1-.4v2.6l-1 .4a4.5 4 0 0 1-1.5 1.8V13H10v-1h-3v1H5.5v-1.6A4 4 0 0 1 3 9.5z"/><path d="M7 3.5h2.5"/></svg>',
  Investment: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12l3.5-4 3 2.5 4.5-6"/><path d="M10.5 4.5h3v3"/></svg>',
  Super: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14V8"/><path d="M8 8c0-2.8 1.8-4.5 4.8-4.5 0 3-1.8 4.5-4.8 4.5zM8 9.5C8 7.4 6.6 6 4 6c0 2.3 1.4 3.5 4 3.5z"/></svg>',
  Debt: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10" rx="1.8"/><path d="M5.5 6.5h5M5.5 9.5h3"/></svg>',
  Other: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5"/></svg>',
};
export const nwIcon = t => ICON[t] || ICON.Other;
export const nwType = t => NW_TYPES.find(x => x.key === t) || { key: t || "", label: t || "No type", col: "var(--faint)", help: "" };
const CHEV = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** Savings accounts with a name are the only ones goals are checked against (as before). */
const tracksGoals = a => a.type === "Savings" && !blank(a.name);

function row(a, ui, i, L) {
  const t = nwType(a.type), em = (app.C && app.C.earmark[a.id]) || 0, showBar = tracksGoals(a) && em > 0 && !ui.reorder;
  const over = em > n(a.balance);
  return `<li class="ex">
    <button class="ex-row" type="button" data-edit-nw="${esc(a.id)}"${ui.reorder ? " disabled" : ""} aria-label="${esc(a.name || "Unnamed account")}: edit">
      <span class="ex-ic" style="--cat:${isObjectColour(a.colour) ? `var(--o-${a.colour})` : t.col}" aria-hidden="true">${itemIcon(a.icon) || nwIcon(a.type)}</span>
      <span class="ex-main"><span class="ex-name">${esc(a.name || "Unnamed account")}</span>
        <span class="ex-sub">${ui.reorder ? esc(t.label) : K(`nw.${a.id}.sub`)}${ui.reorder ? "" : ` ${K(`nw.${a.id}.flag`, "chip")}`}</span>
        ${showBar ? `<span class="ex-prog nw-em${over ? " over" : ""}" aria-hidden="true"><span data-k="nw.${esc(a.id)}.bar"></span></span>` : ""}</span>
      <span class="ex-amt${a.type === "Debt" ? " owed" : ""}">${K(`nw.${a.id}.v`)}<small>${K(`nw.${a.id}.ow`)}</small></span>${ui.reorder ? "" : CHEV}</button>
    ${ui.reorder ? `<span class="mv-row"><button class="mv-btn" type="button" data-move="up" data-l="nw" data-i="${esc(a.id)}" aria-label="Move ${esc(a.name || "this")} up"${i === 0 ? " disabled" : ""}>↑</button><button class="mv-btn" type="button" data-move="down" data-l="nw" data-i="${esc(a.id)}" aria-label="Move ${esc(a.name || "this")} down"${i === L.length - 1 ? " disabled" : ""}>↓</button></span>` : ""}
  </li>`;
}

export function view() {
  const S = app.state, L = S.nw.accounts, ro = readOnly(), ui = budgetUI();
  const savings = L.filter(tracksGoals);

  const hero = `<section class="card nw-hero" aria-live="polite">
    <span class="eyebrow">Net worth ${tipq("Everything you own (cash, savings, investments, super) minus everything you owe. It isn’t all spending money: super and investments are long-term.")}</span>
    <div class="nw-head" id="nwHead"><span class="amt">${K("nw.net")}</span></div>
    <p class="nw-ad"><span><i class="dot" style="background:var(--ok)"></i>Assets <b>${K("nw.assets")}</b></span><span><i class="dot" style="background:var(--nw-debt)"></i>Owed <b>${K("nw.debt")}</b></span></p>
    <div class="split nw-bar" id="nwBar" role="img" aria-label=""></div>
    <div class="split-key" id="nwKey"></div>
    ${savings.length ? `<div class="nw-gm">
      <div class="b-row"><span class="eyebrow">Goal money in savings ${tipq("Goals on the Goals tab say which savings account their Saved money sits in. That money is part of the balance, not extra: it’s just spoken for.")}</span></div>
      <div class="sp-figs"><div><small>In savings</small><b>${K("nw.gm.sav")}</b></div><div><small>For goals</small><b>${K("nw.gm.em")}</b></div><div><small>Not earmarked</small><b>${K("nw.gm.free")}</b></div></div>
      <p class="nw-over" data-k="nw.gm.over" data-base="nw-over"></p></div>` : ""}
  </section>`;

  const review = `<section class="card nw-review">
    <div class="nw-rv-top"><span class="nw-rv-ic" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10.5" rx="2"/><path d="M2.5 6.5h11M5.5 1.8v2.4M10.5 1.8v2.4M6 10l1.4 1.4L10 8.8"/></svg></span>
      <div class="nw-rv-txt"><b>${K("nw.rev.when")}</b><small>Balances are typed in by you, not live from the bank.</small><span>${K("nw.rev", "chip")}</span></div></div>
    ${ro ? "" : `<div class="nw-rv-act"><button class="btn small primary" type="button" id="revToday">Reviewed today</button>
      <details class="more nw-rv-date"><summary>Pick a date</summary><input type="date" class="bs-in" id="rev" ${attrs("root", "", "nw.reviewed", "date")} value="${esc(S.nw.reviewed || "")}" aria-label="Last reviewed"></details></div>`}
  </section>`;

  let list;
  if (!L.length) list = `<section class="card sp-empty"><div class="empty-art" aria-hidden="true">${ART.wallet()}</div><h2>Start with an account</h2>
    <p class="dim">Add your bank accounts, savings, KiwiSaver and any debts to see where you stand.</p>${ro ? "" : `<button class="btn primary" type="button" data-nw-new="Savings">+ Add account</button>`}</section>`;
  else if (ui.reorder) list = `<section class="sp-list">
    <div class="b-row sec"><h2>Accounts</h2><button class="btn small ghost" type="button" data-reorder aria-pressed="true">Done</button></div>
    <p class="dim small-note">Move accounts up or down. The order is kept within each group.</p>
    <ul class="card ex-list reordering">${L.map((a, i) => row(a, ui, i, L)).join("")}</ul></section>`;
  else {
    const known = GROUPS.flatMap(g => g.types), other = L.filter(a => !known.includes(a.type));
    const groups = [...GROUPS, ...(other.length ? [{ key: "other", title: "Other", types: null }] : [])];
    list = `<section class="sp-list">
      <div class="b-row sec"><h2>Accounts ${tipq(NW_TYPES.map(t => `${t.key}: ${t.help}`).join(" "))}</h2>${ro ? "" : `<button class="btn small ghost" type="button" data-reorder aria-pressed="false">Reorder</button>`}</div>
      ${groups.map(g => {
        const items = g.types ? L.filter(a => g.types.includes(a.type)) : other; if (!items.length) return "";
        const col = g.types ? nwType(g.types[g.types.length - 1]).col : "var(--faint)";
        return `<div class="ex-group" style="--cat:${col}"><div class="ex-gh"><span class="ex-dot" aria-hidden="true"></span><h3>${esc(g.title)}</h3><small>${items.length}</small>
          <span class="ex-gt">${g.tot ? K(g.tot) : ""}</span>${ro || !g.add ? "" : `<button class="icon-add" type="button" data-nw-new="${g.add}" aria-label="Add ${g.key === "debt" ? "a debt" : `an account to ${esc(g.title.toLowerCase())}`}">+</button>`}</div>
          <ul class="card ex-list">${items.map(a => row(a, ui, L.indexOf(a), L)).join("")}</ul></div>`;
      }).join("")}
      ${ro ? "" : `<button class="add-row" type="button" data-nw-new="Savings">+ Add account</button>`}
    </section>`;
  }

  const help = `<details class="help"><summary>How it works</summary><ul>
    <li>Everyday (operating) accounts are where daily bills come out, so they aren’t checked against goals.</li>
    <li>Savings accounts hold goal money. “For goals” adds up the Saved amounts of goals tagged to the account on the Goals tab; “Not earmarked” is what’s left over. It’s the same money, not extra.</li>
    <li>Investment balances feed the starting balance on the Invest tab.</li>
    <li>Enter debts as positive numbers; they’re subtracted from your assets.</li>
    <li>Update balances roughly monthly and press “Reviewed today”.</li>
  </ul></details>`;
  return `<div class="nw-page"><div class="nw-side">${hero}${L.length ? review : ""}</div><div class="nw-main">${list}${help}</div></div>`;
}

function reviewedWhen(s, today) {
  const d = parseDate(s); if (!d) return "Not reviewed yet";
  const k = daysBetween(d, today), ago = k === 0 ? "today" : k === 1 ? "yesterday" : k > 1 ? `${k} days ago` : "";
  const sd = `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === today.getFullYear() ? "" : " " + d.getFullYear()}`;
  return `Last reviewed ${sd}${ago ? ` · ${ago}` : ""}`;
}

export function fill(D, C) {
  D["nw.net"] = money(C.nw.net); D["nw.net.sub"] = `Assets ${money(C.nw.assets, true)} minus liabilities ${money(C.nw.debt, true)}`;
  D["nw.cash"] = money(C.nw.cash); D["nw.inv"] = money(C.nw.inv); D["nw.supdebt"] = `${money(C.nw.sup, true)} / ${money(C.nw.debt, true)}`;
  D["nw.rev"] = C.reviewDue ? { t: "Review due", c: "warn" } : { t: "Recently reviewed", c: "ok" };
  const S = app.state;
  S.nw.accounts.forEach(a => {
    const em = C.earmark[a.id], named = !blank(a.name), noEm = ["Operating", "Super", "Debt", "Investment"].includes(a.type);
    D[`nw.${a.id}.em`] = !named || noEm ? "" : money(em);
    D[`nw.${a.id}.buf`] = !named ? "" : a.type === "Savings" ? money(n(a.balance) - em) : a.type === "Debt" ? "" : money(n(a.balance));
    D[`nw.${a.id}.st`] = nwStatusOf(a, em, C);
  });

  // new: the hero, group totals, goal money, and each account's row
  D["nw.assets"] = money(C.nw.assets); D["nw.debt"] = money(C.nw.debt);
  D["nw.grp.cash"] = money(C.nw.cash); D["nw.grp.long"] = money(C.nw.inv + C.nw.sup); D["nw.grp.debt"] = money(C.nw.debt);
  D["nw.rev.when"] = reviewedWhen(S.nw.reviewed, C.today);
  const sav = S.nw.accounts.filter(tracksGoals);
  const emT = sav.reduce((s, a) => s + C.earmark[a.id], 0);
  const free = sav.reduce((s, a) => s + Math.max(n(a.balance) - C.earmark[a.id], 0), 0);
  const overL = sav.filter(a => C.earmark[a.id] > n(a.balance) && n(a.balance) > 0);
  D["nw.gm.sav"] = money(C.nw.sav); D["nw.gm.em"] = money(emT); D["nw.gm.free"] = money(free);
  D["nw.gm.over"] = { t: overL.map(a => `${a.name} has ${money(C.earmark[a.id] - n(a.balance), true)} more promised to goals than is in it.`).join(" "), c: overL.length ? "on" : "" };
  S.nw.accounts.forEach(a => {
    const em = C.earmark[a.id], st = D[`nw.${a.id}.st`], t = nwType(a.type);
    D[`nw.${a.id}.v`] = blank(a.balance) ? "—" : money(n(a.balance));
    D[`nw.${a.id}.ow`] = a.type === "Debt" && !blank(a.balance) ? "owed" : "";
    D[`nw.${a.id}.sub`] = blank(a.name) ? "Add a name to count it in goals"
      : blank(a.balance) ? `${t.label} · add a balance`
      : a.type === "Savings" ? (em > 0 ? `Savings · ${money(em, true)} for goals` : "Savings · no goals linked")
      : a.type === "Investment" ? "Investments · feeds the Invest tab"
      : a.type === "Super" ? "Super · long-term"
      : a.type === "Operating" ? "Everyday · bills come out of here"
      : t.label;
    // Only the statuses that ask for attention (or confirm savings line up) show as a chip on the row
    D[`nw.${a.id}.flag`] = st && ["ok", "warn", "bad"].includes(st.c) && a.type !== "Debt" ? st : { t: "", c: "" };
    if (tracksGoals(a)) D[`nw.${a.id}.bar`] = { w: n(a.balance) > 0 ? Math.min(1, em / n(a.balance)) : em > 0 ? 1 : 0 };
  });
}

export function draw(C) {
  const el = document.querySelector("#nwBar"); if (!el) return;
  const parts = NW_TYPES.filter(t => t.key !== "Debt").map(t => ({ name: t.label, v: { Operating: C.nw.op, Savings: C.nw.sav, Investment: C.nw.inv, Super: C.nw.sup }[t.key], col: t.col }));
  const shown = parts.filter(p => p.v > 0);
  drawSplit(el, parts, C.nw.assets);
  el.hidden = !shown.length;
  el.setAttribute("aria-label", shown.length ? `What you own: ${shown.map(p => `${p.name} ${money(p.v)}`).join(", ")}` : "");
  document.querySelector("#nwKey").innerHTML = shown.map(p => `<span><i style="background:${p.col}"></i>${p.name} ${money(p.v)}</span>`).join("");
  const head = document.querySelector("#nwHead"); if (head) head.classList.toggle("neg", C.nw.net < -0.004);
}
