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

export const TAB_HASH = { budget: "budget", networth: "net-worth", spending: "joint-spending", goals: "goals", invest: "investments", progress: "progress" };
export const tabFromHash = () => { const h = location.hash.replace(/^#/, ""); return Object.keys(TAB_HASH).find(k => TAB_HASH[k] === h) || null; };

export const app = {
  state: blankBudget(),          // the budget (version 4, in-memory shape)
  ui: loadPrefs(),               // this device's theme and spacing
  tab: tabFromHash() || "budget",
  today: startOfDay(new Date()),
  C: null,                       // the latest calculations (see model/calc.js)
  loaded: false, hasData: false, canWrite: true,
  sb: null, session: null, household: null, households: [], role: null, members: [], meId: null,
  setup: null,
  snapshots: null,               // this household's snapshots for the Progress tab (ui/views/progress.js)
  compareId: null,               // the snapshot being compared with today                   // the setup guide, while it's showing (ui/onboarding.js)
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
