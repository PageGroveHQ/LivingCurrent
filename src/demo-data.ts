import type { HouseholdData } from "./types";

const isoDate = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

export const createDemoData = (): HouseholdData => ({
  startingBalance: 6840.22,
  safetyBuffer: 1000,
  displayName: "Pat",
  partnerName: "Partner",
  updatedAt: new Date().toISOString(),
  transactions: [
    { id: "demo-1", date: isoDate(-1), description: "Teleomedical", category: "Salary", amount: 4374.55, enteredBy: "Pat", createdAt: new Date().toISOString() },
    { id: "demo-2", date: isoDate(-1), description: "Publix", category: "Groceries", amount: -184.47, enteredBy: "Partner", createdAt: new Date().toISOString() },
    { id: "demo-3", date: isoDate(-3), description: "ATT", category: "Cell Phone & Internet", amount: -299.50, enteredBy: "Pat", createdAt: new Date().toISOString() },
    { id: "demo-4", date: isoDate(-4), description: "Shell", category: "Transportation", amount: -58.21, enteredBy: "Partner", createdAt: new Date().toISOString() },
    { id: "demo-5", date: isoDate(-6), description: "Target", category: "Household", amount: -93.16, enteredBy: "Pat", createdAt: new Date().toISOString() },
    { id: "demo-6", date: isoDate(-8), description: "Freelance deposit", category: "Additional Income", amount: 620, enteredBy: "Pat", createdAt: new Date().toISOString() },
  ],
  bills: [
    { id: "bill-1", name: "Mortgage", category: "Housing", amount: 1945, dueDate: isoDate(3), recurrence: "monthly", paid: false },
    { id: "bill-2", name: "Electric", category: "Utilities", amount: 168, dueDate: isoDate(7), recurrence: "monthly", paid: false },
    { id: "bill-3", name: "Car insurance", category: "Insurance", amount: 214, dueDate: isoDate(11), recurrence: "monthly", paid: false },
  ],
});
