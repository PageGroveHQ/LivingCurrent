import type { Bill, HouseholdData, RecoveryRecord, Transaction } from "../types";

export function keepRecovery(data: HouseholdData, kind: RecoveryRecord["kind"], action: RecoveryRecord["action"], record: Transaction | Bill): HouseholdData {
  return { ...data, recovery: [...(data.recovery || []), { id: crypto.randomUUID(), kind, action, record: { ...record }, savedAt: new Date().toISOString() }] };
}
export function recoverRecord(data: HouseholdData, id: string): HouseholdData {
  const recovery = data.recovery?.find((item) => item.id === id);
  if (!recovery) return data;
  const rows = recovery.kind === "transaction" ? data.transactions : data.bills;
  if (recovery.action === "deleted" && rows.some((item) => item.id === recovery.record.id)) return data;
  const next = { ...data, recovery: data.recovery?.filter((item) => item.id !== id) };
  if (recovery.kind === "transaction") {
    const transaction = recovery.record as Transaction;
    const bill = data.bills.find((item) => item.id === transaction.billId);
    const canLink = bill && (!bill.paymentTransactionId || bill.paymentTransactionId === transaction.id) && transaction.amount < 0 && transaction.type !== "income" && transaction.type !== "transfer";
    next.transactions = [...data.transactions.filter((item) => item.id !== transaction.id), { ...transaction, billId: canLink ? transaction.billId : undefined }];
    if (canLink) next.bills = data.bills.map((item) => item.id === bill.id ? { ...item, paid: true, paymentTransactionId: transaction.id } : item);
  }
  else {
    const bill = recovery.record as Bill;
    const currentBill = data.bills.find((item) => item.id === bill.id);
    const paymentId = bill.paymentTransactionId || (currentBill?.dueDate === bill.dueDate ? currentBill.paymentTransactionId : undefined);
    const payment = data.transactions.find((item) => item.id === paymentId && item.billId === bill.id);
    next.bills = [...data.bills.filter((item) => item.id !== bill.id), { ...bill, paid: payment ? true : bill.paid, paymentTransactionId: payment?.id || bill.paymentTransactionId }];
  }
  // Keep the version being replaced as another recoverable revision.
  const current = rows.find((item) => item.id === recovery.record.id);
  return current ? keepRecovery(next, recovery.kind, "edited", current) : next;
}
