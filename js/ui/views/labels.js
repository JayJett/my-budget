/* Words that change with who the budget is for: "Joint spending" only makes sense when it's shared
   (two or more people, or a budget set up "with someone": see model/schema.js isShared). */
import { isShared } from "../../model/schema.js";
export const spendLabel = s => isShared(s) ? "Joint spending" : "Spending";
export const jointGoalsLabel = s => isShared(s) ? "Joint goals" : "Goals";
export const TABS = s => [["budget", "Budget"], ["networth", "Net worth"], ["spending", spendLabel(s)], ["goals", "Goals"], ["invest", "Investments"], ["progress", "Progress"]];
/** Shorter names for the bottom tab bar on phones. */
export const SHORT = { budget: "Budget", networth: "Net worth", spending: "Spending", goals: "Goals", invest: "Invest", progress: "Progress" };
