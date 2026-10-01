export type Transaction = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  enteredBy: string;
  createdAt: string;
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
  startingBalance: number;
  safetyBuffer: number;
  displayName: string;
  partnerName: string;
  transactions: Transaction[];
  bills: Bill[];
  updatedAt: string;
};

export type SyncState = "local" | "connecting" | "synced" | "needs-setup" | "offline";
