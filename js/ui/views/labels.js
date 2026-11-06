/* Words that change with the number of people: "Joint spending" only makes sense for two or more. */
export const spendLabel = s => s.people.length > 1 ? "Joint spending" : "Spending";
export const jointGoalsLabel = s => s.people.length > 1 ? "Joint goals" : "Goals";
export const TABS = s => [["budget", "Budget"], ["networth", "Net worth"], ["spending", spendLabel(s)], ["goals", "Goals"], ["invest", "Investments"]];
