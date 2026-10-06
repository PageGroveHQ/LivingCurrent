import { useEffect, useState } from "react";
import type { HouseholdData } from "./types";
import { lastFriday, paydayPlan } from "./lib/payday";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function PaydayCard({ data, checking, today, onSettings }: { data: HouseholdData; checking: number; today: string; onSettings: () => void }) {
  const plan = paydayPlan(data, checking, today);
  return <section className="panel payday-card"><div><span className="payday-eyebrow">UNTIL NEXT PAYDAY</span><h3>{label(plan.date)} <small>{plan.days < 0 ? `${-plan.days} days overdue` : plan.days === 0 ? "Expected today" : `${plan.days} days away`}</small></h3><p>{plan.latest ? `Last pay received ${label(plan.latest.date)} · ${money.format(plan.latest.amount)}` : "Last Friday of every month · record income when it arrives"}</p><button className="secondary-button" onClick={onSettings}>Adjust payday</button></div><div className="payday-funds"><span>Available until payday</span><strong className={plan.available < 0 ? "amount-negative" : ""}>{money.format(plan.available)}</strong>{plan.daily !== null && <p>{money.format(plan.daily)} per day · spending guide, not a guarantee</p>}<details className="reminder-disclosure"><summary>How this is calculated</summary><p>{money.format(checking)} checking − {money.format(plan.reserved)} unpaid checking bills due on or before payday (including overdue bills) − {money.format(data.safetyBuffer)} safety buffer. Savings and expected income are excluded. Pending transactions already count in checking; paid bills are not deducted again.</p></details></div></section>;
}

export function PaydaySettings({ data, today, onSave }: { data: HouseholdData; today: string; onSave: (values: Partial<HouseholdData>) => void }) {
  const next = paydayPlan(data, 0, today);
  const [period, setPeriod] = useState(data.paydayOverride?.period || next.period);
  const [date, setDate] = useState(data.paydayOverride?.date || lastFriday(next.period));
  useEffect(() => { setPeriod(data.paydayOverride?.period || next.period); setDate(data.paydayOverride?.date || lastFriday(next.period)); }, [data.paydayOverride, next.period]);
  return <form className="panel settings-form" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); onSave({ paydayOverride: { period: String(fields.get("period")), date: String(fields.get("date")) } }); }}><h3>Payday schedule</h3><p>Regular payday: the last Friday of each month. A date override applies only to the selected income month; future months keep the regular rule.</p><label>Income month<input name="period" type="month" value={period} required onChange={event => { setPeriod(event.target.value); setDate(lastFriday(event.target.value)); }} /></label><label>Expected payday<input name="date" type="date" value={date} required onChange={event => setDate(event.target.value)} /></label><button className="primary-button" type="submit">Save one-time override</button>{data.paydayOverride && <button type="button" className="secondary-button" onClick={() => onSave({ paydayOverride: null })}>Reset to schedule</button>}<p className="settings-note">No money is added automatically. When pay arrives, add an income transaction and select its scheduled income month. Editing or deleting that transaction updates payday status too.</p></form>;
}
