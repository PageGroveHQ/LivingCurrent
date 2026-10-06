import type { HouseholdData, Transaction } from "../types";

export function shiftPeriod(period: string, offset: number): string {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function lastFriday(period: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return "";
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 2) % 7);
  return date.toISOString().slice(0, 10);
}

export function isReceivedPay(item: Transaction, today: string): boolean {
  return Boolean(item.paydayPeriod && item.date <= today && item.amount > 0 && (item.type || "income") === "income");
}

export function paydayPlan(data: HouseholdData, checking: number, today: string) {
  const received = data.transactions.filter(item => isReceivedPay(item, today));
  // Retain an explicitly delayed payday across month boundaries until its income is recorded.
  let period = data.paydayOverride && data.paydayOverride.period < today.slice(0, 7)
    ? data.paydayOverride.period : today.slice(0, 7);
  while (received.some(item => item.paydayPeriod === period)) period = shiftPeriod(period, 1);
  const date = data.paydayOverride?.period === period ? data.paydayOverride.date : lastFriday(period);
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const reserved = data.bills.filter(bill => !bill.paid && (bill.account || "checking") === "checking" && bill.dueDate <= date).reduce((sum, bill) => sum + bill.amount, 0);
  const available = checking - reserved - data.safetyBuffer;
  const latest = [...received].sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  return { period, date, days, reserved, available, daily: days > 0 ? Math.max(0, available) / days : null, latest };
}
