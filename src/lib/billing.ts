import type { HouseholdData, Transaction } from "../types";

export function recordBillPayment(data: HouseholdData, billId: string, payment: Transaction): HouseholdData {
  const bill = data.bills.find((item) => item.id === billId);
  if (!bill || (bill.paid && bill.paymentTransactionId)) return data;
  if (payment.amount >= 0 || payment.type === "transfer" || payment.type === "income") throw new Error("Choose an expense transaction for this bill.");
  if (payment.billId && payment.billId !== billId) throw new Error("This transaction already pays another bill.");
  const linked = { ...payment, billId, type: "expense" as const };
  return { ...data, transactions: [...data.transactions.filter((item) => item.id !== linked.id), linked], bills: data.bills.map((item) => item.id === billId ? { ...item, paid: true, paymentTransactionId: linked.id } : item) };
}

export function reconcileBillPayments(data: HouseholdData): HouseholdData {
  return { ...data, bills: data.bills.map((bill) => {
    if (!bill.paymentTransactionId) return bill;
    const payment = data.transactions.find((item) => item.id === bill.paymentTransactionId && item.billId === bill.id && item.amount < 0 && item.type !== "income" && item.type !== "transfer");
    return payment ? { ...bill, paid: true } : { ...bill, paid: false, paymentTransactionId: undefined };
  }) };
}
