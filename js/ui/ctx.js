/* The app's shared "context": one object every screen reads from.
   Keeping it in one place avoids passing the same ten things around everywhere. */
import { blankBudget } from "../model/schema.js";
import { startOfDay } from "../model/util.js";

const PREFS_KEY = "jm-budget-prefs";
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { theme: ["auto", "light", "dark"].includes(p.theme) ? p.theme : "auto", density: p.density === "compact" ? "compact" : "comfortable" };
  } catch (_) { return { theme: "auto", density: "comfortable" }; }
}

/* Phase 9A: five places at the bottom (Home, Budget, Expenses, Goals, Wealth), with Wealth split into
   Accounts, Investments and History. Inside the app each screen keeps its old name (networth, invest,
   progress, spending), so tours, reminders and saved choices carry on working; only the web address
   and the labels changed. Old addresses still open the right screen (OLD_HASH). */
export const TAB_HASH = { home: "home", budget: "budget", spending: "expenses", goals: "goals", networth: "wealth/accounts", invest: "wealth/investments", progress: "wealth/history" };
export const OLD_HASH = { "net-worth": "networth", "investments": "invest", "progress": "progress", "joint-spending": "spending", "spending": "spending", "wealth": "networth" };
export const WEALTH = ["networth", "invest", "progress"];
export const tabFromHash = (hash = location.hash) => { const h = hash.replace(/^#/, ""); return Object.keys(TAB_HASH).find(k => TAB_HASH[k] === h) || OLD_HASH[h] || null; };

export const app = {
  state: blankBudget(),          // the budget (version 4, in-memory shape)
  ui: loadPrefs(),               // this device's theme and spacing
  tab: tabFromHash() || "home",   // Phase 9A: Home is where you land, unless a link says otherwise
  wealthTab: "networth",         // the Wealth section you were last in
  today: startOfDay(new Date()),
  C: null,                       // the latest calculations (see model/calc.js)
  loaded: false, hasData: false, canWrite: true,
  sb: null, session: null, household: null, households: [], role: null, members: [], meId: null,
  setup: null,                   // the setup guide, while it's showing (ui/onboarding.js)
  snapshots: null,               // this household's snapshots for the Progress tab (ui/views/progress.js)
  compareId: null,               // the snapshot being compared with today
  undoStack: [],
  reminders: null,               // your reminders in this household, newest first (ui/reminders.js)                 // history entries for your changes this session, for the Undo button (ui/history.js)
  store: null,                   // saving + live updates (sync/store.js)
  // filled in by render.js so other modules can ask for a redraw without importing it
  render: () => {}, refresh: () => {},
};

export function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(app.ui)); } catch (_) {} }
export const readOnly = () => !app.canWrite || !app.household;

/** Call after every edit: redraws numbers and queues a save. */
export function changed({ full = false } = {}) {
  app.hasData = true;
  if (full) app.render(); else app.refresh();
  if (app.store) app.store.schedule();
}
