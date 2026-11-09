/* Words that change with who the budget is for: "Joint spending" only makes sense when it's shared
   (two or more people, or a budget set up "with someone": see model/schema.js isShared). */
import { isShared } from "../../model/schema.js";
export const spendLabel = s => isShared(s) ? "Joint spending" : "Spending";
export const jointGoalsLabel = s => isShared(s) ? "Joint goals" : "Goals";
/** Every screen, with its name (tours, reminders and attention markers use these). Phase 9A: Spending is
    shown as Expenses; Net worth, Investments and Progress live under Wealth as Accounts, Investments, History. */
export const TABS = s => [["home", "Home"], ["budget", "Budget"], ["spending", "Expenses"], ["goals", "Goals"], ["networth", "Accounts"], ["invest", "Investments"], ["progress", "History"]];
/** The five places in the bottom bar. "wealth" opens whichever Wealth section you were last in. */
export const NAV = [["home", "Home"], ["budget", "Budget"], ["spending", "Expenses"], ["goals", "Goals"], ["wealth", "Wealth"]];
export const WEALTH_TABS = [["networth", "Accounts"], ["invest", "Investments"], ["progress", "History"]];
/** Shorter names (kept for older callers). */
export const SHORT = { home: "Home", budget: "Budget", networth: "Accounts", spending: "Expenses", goals: "Goals", invest: "Investments", progress: "History", wealth: "Wealth" };
