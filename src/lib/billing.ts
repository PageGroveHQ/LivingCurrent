import type { Bill, HouseholdData, Transaction } from "../types";

export function recordBillPayment(data: HouseholdData, billId: string, payment: Transaction): HouseholdData {
  const bill = data.bills.find((item) => item.id === billId);
  if (!bill || (bill.paid && bill.paymentTransactionId)) return data;
  if (payment.amount >= 0 || payment.type === "transfer" || payment.type === "income") throw new Error("Choose an expense transaction for this bill.");
  if (payment.billId && payment.billId !== billId) throw new Error("This transaction already pays another bill.");
  const linked = { ...payment, billId, type: "expense" as const };
  return { ...data, transactions: [...data.transactions.filter((item) => item.id !== linked.id), linked], bills: data.bills.map((item) => item.id === billId ? { ...item, paid: true, paymentTransactionId: linked.id } : item) };
}

export function reconcileBillPayments(data: HouseholdData): HouseholdData {
  const reconciled = { ...data, bills: data.bills.map((bill) => {
    if (!bill.paymentTransactionId) return bill;
    const payment = data.transactions.find((item) => item.id === bill.paymentTransactionId && item.billId === bill.id && item.amount < 0 && item.type !== "income" && item.type !== "transfer");
    return payment ? { ...bill, paid: true } : { ...bill, paid: false, paymentTransactionId: undefined };
  }) };
  return prepareNextBillCycles(reconciled);
}

export function nextBillDate(bill: Bill): string {
  const [year, month, day] = bill.dueDate.split("-").map(Number);
  const anchorDay = Number((bill.recurrenceAnchorDate || bill.dueDate).slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (bill.recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else {
    const nextMonth = bill.recurrence === "yearly" ? month - 1 : month;
    const nextYear = bill.recurrence === "yearly" ? year + 1 : year;
    const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
    date.setUTCFullYear(nextYear, nextMonth, Math.min(anchorDay, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

export function prepareNextBillCycles(data: HouseholdData): HouseholdData {
  const bills = [...data.bills];
  for (const bill of data.bills) {
    if (!bill.paid || !bill.recurrence || bill.recurrence === "once") continue;
    const seriesId = bill.seriesId || bill.id;
    const dueDate = nextBillDate(bill);
    const id = `cycle-${seriesId}-${dueDate}`;
    const deleted = (data.recovery || []).some((item) => item.action === "deleted" && item.kind === "bill" && item.record.id === id);
    if (deleted || bills.some((item) => item.id === id || ((item.seriesId || item.id) === seriesId && item.dueDate >= dueDate))) continue;
    // Do not prepare another future occurrence while this series already has an unpaid one.
    if (bills.some((item) => (item.seriesId || item.id) === seriesId && !item.paid)) continue;
    bills.push({ ...bill, id, seriesId, recurrenceAnchorDate: bill.recurrenceAnchorDate || bill.dueDate, dueDate, paid: false, paymentTransactionId: undefined });
  }
  return { ...data, bills };
}
