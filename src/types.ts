export type AccountName = "checking" | "savings";
export type TransactionKind = "expense" | "income" | "transfer";

export type Transaction = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  enteredBy: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  type?: TransactionKind;
  account?: AccountName;
  transferTo?: AccountName;
  affectsBalance?: boolean;
  importSource?: string;
  status?: "pending" | "posted";
};

export type Bill = {
  id: string;
  name: string;
  category: string;
  amount: number;
  dueDate: string;
  recurrence: "monthly" | "weekly" | "yearly" | "once";
  paid: boolean;
};

export type HouseholdData = {
  schemaVersion?: number;
  balanceStartMonth: string;
  checkingStartingBalance: number;
  savingsStartingBalance: number;
  checkingBalance?: number;
  savingsBalance?: number;
  startingBalance?: number;
  safetyBuffer: number;
  displayName: string;
  partnerName: string;
  transactions: Transaction[];
  bills: Bill[];
  updatedAt: string;
};

export type SyncState = "local" | "connecting" | "synced" | "needs-setup" | "offline";
