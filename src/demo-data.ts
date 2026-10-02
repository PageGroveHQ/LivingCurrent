import type { HouseholdData } from "./types";

export const createDemoData = (): HouseholdData => ({
  schemaVersion: 3,
  balanceStartMonth: "2026-10",
  checkingStartingBalance: 1555.44,
  savingsStartingBalance: 3053.72,
  safetyBuffer: 1000,
  displayName: "Pat",
  partnerName: "Partner",
  updatedAt: new Date().toISOString(),
  transactions: [],
  bills: [],
});
