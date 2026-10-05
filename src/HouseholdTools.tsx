import { useState } from "react";
import type { RecoveryRecord, Transaction } from "./types";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function kind(item: Transaction) { return item.type || (item.amount < 0 ? "expense" : "income"); }
export function PendingReview({ transactions, onEdit, onPosted }: { transactions: Transaction[]; onEdit: (item: Transaction) => void; onPosted: (item: Transaction) => void }) {
  const pending = [...transactions].filter((item) => item.status === "pending").sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const [limit, setLimit] = useState(10);
  return <section className="panel tools-panel"><h3>Pending review · {pending.length}</h3><p>All months included. These entries already affect your balances. Marking posted changes only their status; edit an entry if the final amount differs.</p>{pending.slice(0,limit).map((item)=><div className="review-row" key={item.id}><div><strong>{item.description}</strong><small>{item.date} · {item.enteredBy}{item.billId ? " · Linked bill" : " · Not linked to a bill"}</small></div><b>{money.format(item.amount)}</b><button onClick={()=>onEdit(item)}>Review / edit</button><button onClick={()=>onPosted(item)}>Mark posted</button></div>)}{!pending.length && <p>No pending entries to review.</p>}{limit < pending.length && <button onClick={()=>setLimit(limit+10)}>Show 10 more pending</button>}</section>;
}
export function MonthlySummary({ transactions, month }: { transactions: Transaction[]; month: string }) {
  const [year, number] = month.split("-").map(Number);
  const previousMonth = new Date(Date.UTC(year,number-2,1)).toISOString().slice(0,7);
  const periodLabel = (value: string) => new Intl.DateTimeFormat("en-US", { month:"long", year:"numeric" }).format(new Date(`${value}-01T12:00:00`));
  const current = transactions.filter((item)=>item.date.startsWith(month));
  const previous = transactions.filter((item)=>item.date.startsWith(previousMonth));
  const now = new Date();
  const isCurrent = month === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const total = (rows: Transaction[], type: string) => rows.filter((item)=>kind(item)===type).reduce((sum,item)=>sum+(type==="expense" ? -item.amount : item.amount),0);
  const income = total(current,"income"), spending = total(current,"expense");
  const byCategory = new Map<string,number>();
  for(const item of current.filter((item)=>kind(item)==="expense")) byCategory.set(item.category,(byCategory.get(item.category)||0)-item.amount);
  const savings = current.reduce((sum,item)=>kind(item)==="transfer" ? sum+(item.transferTo==="savings"?Math.abs(item.amount):0)-(item.account==="savings"?Math.abs(item.amount):0) : sum+(item.account==="savings"?item.amount:0),0);
  return <section className="panel tools-panel"><h3>Monthly summary · {periodLabel(month)}</h3><div className="summary-metrics"><div><span>Income</span><strong>{money.format(income)}</strong></div><div><span>Spending</span><strong>{money.format(spending)}</strong></div><div><span>Income minus spending</span><strong>{money.format(income-spending)}</strong></div><div><span>Savings account movement</span><strong>{money.format(savings)}</strong></div></div><p>{current.some((item)=>item.status==="pending")?"Includes pending transactions. ":""}Transfers are excluded from income/spending. Savings movement includes transfers and is not the savings balance.</p>{previous.length ? <p>Versus {periodLabel(previousMonth)}: income {money.format(income-total(previous,"income"))}; spending {money.format(spending-total(previous,"expense"))}. {isCurrent?"This month is still in progress; the previous month is a full month.":"Recorded data only; imported months may be incomplete."}</p>:<p>No previous-month transactions recorded for comparison.</p>}<div className="category-summary">{[...byCategory].sort((a,b)=>b[1]-a[1]).map(([category,value])=><div key={category}><span>{category}{previous.length > 0 && <small style={{display:"block"}}>Change vs prior month: {money.format(value-previous.filter((item)=>kind(item)==="expense" && item.category===category).reduce((sum,item)=>sum-item.amount,0))}</small>}</span><strong>{money.format(value)}</strong></div>)}</div></section>;
}
export function RecoveryPanel({ records, onRestore }: { records: RecoveryRecord[]; onRestore: (id: string) => void }) {
  const [selected,setSelected] = useState<RecoveryRecord|null>(null);
  const [limit,setLimit] = useState(10);
  const sorted = [...records].sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
  return <section className="panel tools-panel"><h3>Recovery & revision history</h3><p>Deleted entries and pre-edit versions are shared with your household. Restoring can change balances and bill planning. Only changes made after this update are captured.</p>{sorted.slice(0,limit).map((item)=><div className="review-row" key={item.id}><div><strong>{"description" in item.record ? item.record.description : item.record.name}</strong><small>{item.kind} · {item.action==="deleted"?"Deleted":"Previous version"} · {new Date(item.savedAt).toLocaleString()}</small></div><b>{money.format(item.record.amount)}</b><button onClick={()=>setSelected(item)}>{item.action==="deleted"?"Restore":"Restore version"}</button></div>)}{!records.length && <p>No deleted entries or revisions yet.</p>}{limit<records.length && <button onClick={()=>setLimit(limit+10)}>Show 10 more revisions</button>}{selected && <div className="recovery-confirm"><p>Restore this {selected.kind}? {selected.action==="edited"?"It replaces the current version, which will also be saved in revision history.":"It returns to your records; a related bill payment may need relinking if it was removed."}</p><button className="primary-button" onClick={()=>{onRestore(selected.id);setSelected(null);}}>Confirm restore</button><button onClick={()=>setSelected(null)}>Cancel</button></div>}</section>;
}
