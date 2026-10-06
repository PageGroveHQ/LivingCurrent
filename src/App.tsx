import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Archive,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  CloudCheck,
  Download,
  FileJson,
  FileSpreadsheet,
  Home,
  Landmark,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Plus,
  Pencil,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import { createDemoData } from "./demo-data";
import PushSettings from "./PushSettings";
import { PaydayCard, PaydaySettings } from "./Payday";
import { paydayPlan, shiftPeriod } from "./lib/payday";
import { recordBillPayment, reconcileBillPayments, prepareNextBillCycles } from "./lib/billing";
import { keepRecovery, recoverRecord } from "./lib/recovery";
import { MonthlySummary, PendingReview, RecoveryPanel } from "./HouseholdTools";
import {
  createDataStore,
  createHouseholdAccount,
  firebaseConfigured,
  householdId,
  observeHouseholdAuth,
  signInToHousehold,
  signOutOfHousehold,
  type DataStore,
} from "./lib/data-store";
import type { User } from "firebase/auth";
import { getDailyQuoteSet } from "./quotes";
import type { AccountName, Bill, HouseholdData, SyncState, Transaction, TransactionKind } from "./types";

type View = "overview" | "activity" | "archive" | "bills" | "import" | "sync" | "settings";
type AuthIdentity = Pick<User, "uid" | "email" | "isAnonymous">;
type DeviceRole = "primary" | "partner";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const categories = ["Groceries", "Dining", "Housing", "Utilities", "Cell Phone & Internet", "Transportation", "Insurance", "Health", "Household", "Education", "Entertainment & Subscriptions", "Debt Payments", "Cash", "Salary", "Additional Income", "Other", "Custom"];

const todayISO = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const makeId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const daysUntil = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86_400_000);
const monthKey = (date = todayISO()) => date.slice(0, 7);
const monthLabel = (key: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${key}-01T12:00:00`));
const transactionKind = (item: Transaction): TransactionKind => item.type || (item.amount < 0 ? "expense" : "income");
const transactionAccount = (item: Transaction): AccountName => item.account || "checking";
const plannedBill = (bill: Bill) => !bill.paid && daysUntil(bill.dueDate) <= 31;
const sortTransactions = (items: Transaction[]) => [...items].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || "") || b.id.localeCompare(a.id));

function calculateAccountBalances(data: HouseholdData) {
  let checking = data.checkingStartingBalance;
  let savings = data.savingsStartingBalance;
  for (const transaction of data.transactions.filter((item) => monthKey(item.date) >= data.balanceStartMonth)) {
    const type = transactionKind(transaction);
    const account = transactionAccount(transaction);
    if (type === "transfer") {
      const amount = Math.abs(transaction.amount);
      const destination = transaction.transferTo || (account === "checking" ? "savings" : "checking");
      if (account === "checking") checking -= amount; else savings -= amount;
      if (destination === "checking") checking += amount; else savings += amount;
    } else if (account === "checking") checking += transaction.amount;
    else savings += transaction.amount;
  }
  return { checking, savings };
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function mergeImportedTransactions(current: Transaction[], incoming: Transaction[]) {
  const merged = [...current];
  for (const item of incoming) {
    if (merged.some((existing) => existing.id === item.id)) continue;
    if (merged.some((existing) => existing.date === item.date && Math.abs(existing.amount - item.amount) < .005 && transactionAccount(existing) === transactionAccount(item) && existing.description.toLowerCase().replace(/[^a-z0-9]/g, "") === item.description.toLowerCase().replace(/[^a-z0-9]/g, ""))) continue;
    const importedDate = new Date(`${item.date}T12:00:00`).getTime();
    const merchant = item.description.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).find((word) => word.length > 3) || item.description.toLowerCase();
    const pendingIndex = merged.findIndex((existing) => existing.status === "pending" && Math.abs(existing.amount - item.amount) < .005 && Math.abs(new Date(`${existing.date}T12:00:00`).getTime() - importedDate) <= 4 * 86_400_000 && existing.description.toLowerCase().includes(merchant));
    if (pendingIndex >= 0) merged[pendingIndex] = { ...item, id: merged[pendingIndex].id, enteredBy: merged[pendingIndex].enteredBy, createdAt: merged[pendingIndex].createdAt, notes: merged[pendingIndex].notes || item.notes, billId: merged[pendingIndex].billId || item.billId, paydayPeriod: merged[pendingIndex].paydayPeriod || item.paydayPeriod, affectsBalance: merged[pendingIndex].affectsBalance, status: item.status === "pending" ? "pending" : "posted" };
    else merged.push(item);
  }
  return merged.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function App() {
  const [data, setData] = useState<HouseholdData>(createDemoData);
  const [view, setView] = useState<View>(new URLSearchParams(location.search).get("view") === "bills" ? "bills" : "overview");
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [authUser, setAuthUser] = useState<AuthIdentity | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [sync, setSync] = useState<SyncState>("connecting");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [deviceUid, setDeviceUid] = useState("");
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [payingBill, setPayingBill] = useState<Bill | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [undoId, setUndoId] = useState("");
  const [deviceRole, setDeviceRole] = useState<DeviceRole>(() => localStorage.getItem("living-current-device-role") === "partner" ? "partner" : "primary");
  const store = useRef<DataStore | null>(null);
  const dataRef = useRef(data);

  useEffect(() => observeHouseholdAuth((user) => {
    setAuthUser(user ? { uid: user.uid, email: user.email, isAnonymous: user.isAnonymous } : null);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!authReady || (firebaseConfigured && (!authUser || authUser.isAnonymous))) return;
    let active = true;
    setStoreReady(false);
    setSync("connecting");
    createDataStore({
      onData: (next) => { if (active) { dataRef.current = next; setData(next); } },
      onSync: (state) => {
        if (!active) return;
        setSync(state);
        if (state === "synced") setLastSyncAt(new Date());
      },
      onIdentity: (uid) => active && setDeviceUid(uid),
    }).then(async (result) => {
      if (!active) { result.destroy(); return; }
      store.current = result;
      dataRef.current = result.initialData;
      setData(result.initialData);
      setStoreReady(true);
    });
    return () => {
      active = false;
      store.current?.destroy();
    };
  }, [authReady, authUser?.uid, authUser?.isAnonymous]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const updateData = (updater: (current: HouseholdData) => HouseholdData, message?: string) => {
    const before = dataRef.current;
    let changed = updater(before);
    if (changed.recovery === before.recovery) {
      for (const kind of ["transaction", "bill"] as const) {
        const oldRows = kind === "transaction" ? before.transactions : before.bills;
        const newRows = kind === "transaction" ? changed.transactions : changed.bills;
        for (const row of oldRows) {
          const replacement = newRows.find((item) => item.id === row.id);
          if (!replacement || JSON.stringify(replacement) !== JSON.stringify(row)) {
            changed = keepRecovery(changed, kind, replacement ? "edited" : "deleted", row);
            if (!replacement) setUndoId(changed.recovery![changed.recovery!.length - 1].id);
          }
        }
      }
    }
    const next = { ...reconcileBillPayments(changed), updatedAt: new Date().toISOString() };
    dataRef.current = next;
    setData(next);
    void store.current?.save(next);
    if (message) setToast(message);
  };

  const totals = useMemo(() => {
    const currentTransactions = data.transactions.filter((item) => monthKey(item.date) === monthKey() && transactionKind(item) !== "transfer");
    const income = currentTransactions.filter((item) => transactionKind(item) === "income").reduce((sum, item) => sum + Math.abs(item.amount), 0);
    const spending = Math.max(0, currentTransactions.filter((item) => transactionKind(item) === "expense").reduce((sum, item) => sum - item.amount, 0));
    const reserved = data.bills.filter(plannedBill).reduce((sum, bill) => sum + bill.amount, 0);
    const accounts = calculateAccountBalances(data);
    const current = accounts.checking + accounts.savings;
    const available = current - reserved - data.safetyBuffer;
    return { income, spending, reserved, current, available, ...accounts };
  }, [data]);

  const addTransaction = (transaction: Transaction) => {
    updateData((current) => { const bill = transaction.billId ? current.bills.find((item) => item.id === transaction.billId) : undefined; if (bill?.paid && bill.paymentTransactionId !== transaction.id) return current; const next = { ...current, transactions: sortTransactions([...current.transactions.filter((item) => item.id !== transaction.id), transaction]) }; return bill ? { ...next, bills: next.bills.map((item) => item.id === bill.id ? { ...item, paid: true, paymentTransactionId: transaction.id } : item) } : next; }, editingTransaction ? "Transaction updated" : "Transaction added");
    setTransactionOpen(false);
    setEditingTransaction(null);
  };

  const addBill = (bill: Bill) => {
    updateData((current) => ({ ...current, bills: [...current.bills.filter((item) => item.id !== bill.id), bill].sort((a, b) => a.dueDate.localeCompare(b.dueDate)) }), editingBill ? "Bill updated" : "Bill added");
    setBillOpen(false);
    setEditingBill(null);
  };

  useEffect(() => {
    if (!storeReady) return;
    const prepared = prepareNextBillCycles(dataRef.current);
    if (prepared.bills.length !== dataRef.current.bills.length) updateData(() => prepared, "Next recurring bill cycle prepared");
  }, [storeReady, data.bills]);

  const navigate = (next: View) => {
    setView(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const refreshCloud = async () => {
    await store.current?.refresh();
  };

  if (loading) return <LoadingScreen ready={authReady} onContinue={() => setLoading(false)} />;

  if (firebaseConfigured && (!authUser || authUser.isAnonymous)) return <AuthScreen hasAnonymousHousehold={Boolean(authUser?.isAnonymous)} onAuthenticated={(user) => setAuthUser({ uid: user.uid, email: user.email, isAnonymous: user.isAnonymous })} />;

  if (!storeReady) return <HouseholdConnecting />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="brand-lockup">
          <BrandMark />
          <div><strong>LIVING CURRENT</strong><span>A shared view of what’s ahead.</span></div>
          <button className="mobile-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X /></button>
        </div>
        <nav aria-label="Main navigation">
          <NavButton active={view === "overview"} icon={<Home />} label="Overview" onClick={() => navigate("overview")} />
          <NavButton active={view === "activity"} icon={<ReceiptText />} label="Transactions" onClick={() => navigate("activity")} />
          <NavButton active={view === "archive"} icon={<Archive />} label="Monthly archive" onClick={() => navigate("archive")} />
          <NavButton active={view === "bills"} icon={<CalendarDays />} label="Bills" onClick={() => navigate("bills")} />
          <NavButton active={view === "import"} icon={<Upload />} label="Import & export" onClick={() => navigate("import")} />
        </nav>
        <div className="sidebar-spacer" />
        <button className={`sync-card sync-${sync} ${view === "sync" ? "active" : ""}`} onClick={() => navigate("sync")}>
          {sync === "synced" ? <CloudCheck /> : <Cloud />}
          <div><strong>{syncLabel(sync)}</strong><span>{firebaseConfigured ? "Firebase household" : "This device only"}</span></div>
          <ChevronRight className="sync-card-arrow" />
        </button>
        <NavButton active={view === "settings"} icon={<Settings />} label="Settings" onClick={() => navigate("settings")} />
      </aside>

      {menuOpen && <button className="menu-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <main className="main-panel"><div className="save-status" role="status">{saveStatus(sync, lastSyncAt)}{undoId && data.recovery?.some((item) => item.id === undoId) && <button onClick={() => { updateData((current) => recoverRecord(current, undoId), "Deletion undone"); setUndoId(""); }}>Undo last deletion</button>}</div>
        <header className="topbar">
          <button className="menu-button" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu /></button>
          <div className="page-heading">
            <span>{longDate.format(new Date())}</span>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Notifications" onClick={() => setNotificationsOpen(true)}><Bell /></button>
            <button className="primary-button" onClick={() => setTransactionOpen(true)}><Plus /> <span>Add transaction</span></button>
          </div>
        </header>

        {view === "overview" && <Overview data={data} sync={sync} lastSyncAt={lastSyncAt} totals={totals} onNavigate={navigate} onAdd={() => setTransactionOpen(true)} onToggleBill={(id) => setPayingBill(data.bills.find((bill) => bill.id === id) || null)} />}
        {view === "activity" && <Activity data={data} onPosted={(item) => updateData((current) => ({ ...current, transactions: current.transactions.map((row) => row.id === item.id ? { ...row, status: "posted", updatedAt: new Date().toISOString() } : row) }), "Transaction marked posted")} onEdit={setEditingTransaction} onDelete={(id) => updateData((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== id) }), "Transaction removed")} />}
        {view === "archive" && <ArchiveView data={data} onEdit={setEditingTransaction} />}
        {view === "bills" && <Bills data={data} onAdd={() => setBillOpen(true)} onEdit={setEditingBill} onPay={setPayingBill} onDelete={(id) => updateData((current) => ({ ...current, bills: current.bills.filter((bill) => bill.id !== id) }), "Bill removed; payment history kept")} />}
        {view === "import" && <ImportExport data={data} enteredBy={deviceRole === "primary" ? data.displayName : data.partnerName} onImport={(transactions) => updateData((current) => ({ ...current, transactions: mergeImportedTransactions(current.transactions, transactions) }), `${transactions.length} transactions reviewed for import`)} />}
        {view === "sync" && <SyncView data={data} sync={sync} email={authUser?.email || ""} lastSyncAt={lastSyncAt} onRefresh={refreshCloud} />}
        {view === "settings" && <SettingsView onRestore={(id) => updateData((current) => recoverRecord(current, id), "Record restored")} data={data} sync={sync} email={authUser?.email || ""} uid={deviceUid} deviceRole={deviceRole} onBeforeUpdate={async () => { await store.current?.flush(); }} onDeviceRoleChange={(role) => { localStorage.setItem("living-current-device-role", role); setDeviceRole(role); setToast("This device identity was updated"); }} onSignOut={() => void signOutOfHousehold()} onSave={(values) => updateData((current) => ({ ...current, ...values }), "Settings saved")} />}
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        <NavButton active={view === "overview"} icon={<Home />} label="Home" onClick={() => navigate("overview")} />
        <NavButton active={view === "activity"} icon={<ReceiptText />} label="Transactions" onClick={() => navigate("activity")} />
        <button className="bottom-add" aria-label="Add transaction" onClick={() => setTransactionOpen(true)}><Plus /></button>
        <NavButton active={view === "bills"} icon={<CalendarDays />} label="Bills" onClick={() => navigate("bills")} />
        <NavButton active={view === "settings"} icon={<Settings />} label="Settings" onClick={() => navigate("settings")} />
      </nav>

      {(transactionOpen || editingTransaction) && <TransactionDialog key={editingTransaction?.id || "new"} existing={editingTransaction || undefined} data={data} bills={data.bills} name={deviceRole === "primary" ? data.displayName : data.partnerName} onClose={() => { setTransactionOpen(false); setEditingTransaction(null); }} onSave={addTransaction} />}
      {(billOpen || editingBill) && <BillDialog key={editingBill?.id || "new"} existing={editingBill || undefined} name={deviceRole === "primary" ? data.displayName : data.partnerName} onClose={() => { setBillOpen(false); setEditingBill(null); }} onSave={addBill} />}
      {payingBill && <BillPaymentDialog bill={payingBill} data={data} name={deviceRole === "primary" ? data.displayName : data.partnerName} onClose={() => setPayingBill(null)} onSave={(payment) => { updateData((current) => recordBillPayment(current, payingBill.id, payment), "Bill paid with one linked transaction"); setPayingBill(null); }} />}
      {notificationsOpen && <Modal title="Bill reminders" onClose={() => setNotificationsOpen(false)}><div className="entry-form"><PushSettings />{data.bills.filter((bill) => !bill.paid && (bill.reminderDays ?? 3) >= 0 && daysUntil(bill.dueDate) <= (bill.reminderDays ?? 3)).map((bill) => <BillRow key={bill.id} bill={bill} onToggle={() => { setNotificationsOpen(false); setPayingBill(bill); }} />)}{!data.bills.some((bill) => !bill.paid && (bill.reminderDays ?? 3) >= 0 && daysUntil(bill.dueDate) <= (bill.reminderDays ?? 3)) && <p>No bills need attention yet.</p>}</div></Modal>}
      {toast && <div className="toast" role="status"><Check /> {toast}</div>}
    </div>
  );
}

function AuthScreen({ hasAnonymousHousehold, onAuthenticated }: { hasAnonymousHousehold: boolean; onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<"signin" | "create">(hasAnonymousHousehold ? "create" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const credential = mode === "create" ? await createHouseholdAccount(email, password) : await signInToHousehold(email, password);
      onAuthenticated(credential.user);
    } catch (reason) {
      const code = typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "";
      setError(code.includes("email-already-in-use") ? "That household account already exists. Choose Sign in instead." : code.includes("invalid-credential") ? "The email or password is incorrect." : code.includes("weak-password") ? "Use a password with at least six characters." : "We couldn’t complete that sign-in. Please check the details and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-screen">
      <div className="auth-contours" aria-hidden="true"><i /><i /><i /></div>
      <section className="auth-card">
        <div className="auth-brand"><BrandMark /><div><strong>LIVING CURRENT</strong><span>Your private household current</span></div></div>
        <div className="auth-copy"><span>HOUSEHOLD ACCESS</span><h1>{mode === "create" ? "Create your shared sign-in." : "Welcome back."}</h1><p>{mode === "create" && hasAnonymousHousehold ? "Use the shared email you and your wife prefer. This converts the current device without losing its household." : "Use the same household email and password on both devices."}</p></div>
        <div className="auth-tabs" role="tablist"><button className={mode === "signin" ? "active" : ""} type="button" onClick={() => { setMode("signin"); setError(""); }}>Sign in</button><button className={mode === "create" ? "active" : ""} type="button" onClick={() => { setMode("create"); setError(""); }}>Create account</button></div>
        <form className="auth-form" onSubmit={submit}>
          <label><span>Email</span><div><Mail /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="household@example.com" required /></div></label>
          <label><span>Password</span><div><LockKeyhole /><input type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" required /></div></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "create" ? "Create household account" : "Sign in to Living Current"}<ChevronRight /></button>
        </form>
        <div className="auth-assurance"><ShieldCheck /><span><strong>No bank connection</strong>Only the financial entries you choose to save are stored.</span></div>
      </section>
    </main>
  );
}

function HouseholdConnecting() {
  return <main className="connection-screen"><BrandMark /><span>Opening your household…</span></main>;
}

function LoadingScreen({ ready, onContinue }: { ready: boolean; onContinue: () => void }) {
  const quotes = getDailyQuoteSet();
  return (
    <main className="loading-screen">
      <div className="loading-brand"><BrandMark /><strong>LIVING CURRENT</strong><span>A shared view of what’s ahead.</span></div>
      <div className="loading-coin" aria-hidden="true"><div className="flipping-coin">{Array.from({ length: 9 }, (_, index) => <img key={index} className="coin-edge" src={`${import.meta.env.BASE_URL}coin-face.png`} alt="" style={{ transform: `translateZ(${index - 4}px)` }} />)}<img className="coin-front" src={`${import.meta.env.BASE_URL}coin-face.png`} alt="" /><img className="coin-back" src={`${import.meta.env.BASE_URL}coin-face.png`} alt="" /></div><span className="coin-shadow" /></div>
      <div className="loading-quotes">
        <article><small>01 · SCRIPTURE</small><blockquote>“{quotes.scripture.text}”</blockquote><cite>{quotes.scripture.source}</cite></article>
        <article><small>02 · MOTIVATION</small><blockquote>“{quotes.motivation.text}”</blockquote><cite>{quotes.motivation.source}</cite></article>
        <article><small>03 · FINANCIAL WISDOM</small><blockquote>“{quotes.financial.text}”</blockquote><cite>{quotes.financial.source}</cite></article>
      </div>
      <div className="loading-footer">
        <div className="loading-status"><span /><p>{ready ? "Your household is ready" : "Bringing your household into view"}</p></div>
        <button className="loading-enter" type="button" disabled={!ready} onClick={onContinue}>{ready ? "Enter Living Current" : "Connecting…"}<ChevronRight /></button>
        <small>Today’s reflection · changes each calendar day</small>
      </div>
    </main>
  );
}

function Overview({ data, totals, onNavigate, onAdd, onToggleBill, sync, lastSyncAt }: { sync: SyncState; lastSyncAt: Date | null; data: HouseholdData; totals: { income: number; spending: number; reserved: number; current: number; available: number; checking: number; savings: number }; onNavigate: (view: View) => void; onAdd: () => void; onToggleBill: (id: string) => void }) {
  const currentTransactions = sortTransactions(data.transactions.filter((item) => monthKey(item.date) === monthKey()));
  const recent = currentTransactions.slice(0, 5);
  const upcoming = data.bills.filter(plannedBill).slice(0, 3);
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    currentTransactions.filter((item) => transactionKind(item) === "expense").forEach((item) => map.set(item.category, Math.max(0, (map.get(item.category) || 0) - item.amount)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [currentTransactions]);
  const totalCategorySpend = categoryTotals.reduce((sum, [, amount]) => sum + amount, 0) || 1;

  return (
    <div className="page-content overview-page">
      <section className="balance-hero">
        <div className="hero-current" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="balance-copy"><span>CURRENT BALANCE</span><strong>{currency.format(totals.current)}</strong><p>{currency.format(totals.checking)} checking + {currency.format(totals.savings)} savings</p><div className={`available-callout ${totals.available < 0 ? "negative" : ""}`}><span>Available after bill planning and safety buffer</span><b>{currency.format(totals.available)}</b></div></div>
        <div className="balance-actions"><button onClick={onAdd}><Plus /> Add transaction</button><span><CloudCheck />{saveStatus(sync, lastSyncAt)}</span></div>
        <div className="balance-breakdown">
          <Metric label="Bill planning" value={totals.reserved} />
          <Metric label="Income recorded" value={totals.income} tone="positive" />
          <Metric label="Spending recorded" value={-totals.spending} tone="negative" />
          <Metric label="Checking balance" value={totals.checking} />
          <Metric label="Savings balance" value={totals.savings} />
        </div>
      </section>

      <PaydayCard data={data} checking={totals.checking} today={todayISO()} onSettings={() => onNavigate("settings")} />
      <div className="dashboard-grid">
        <section className="panel flow-panel">
          <PanelHeader eyebrow={monthLabel(monthKey()).toUpperCase()} title="Household current" action="View transactions" onAction={() => onNavigate("activity")} />
          <div className="flow-summary"><div><ArrowUpRight /><span>Income</span><strong>{currency.format(totals.income)}</strong></div><div><ArrowDownLeft /><span>Outflow</span><strong>{currency.format(totals.spending)}</strong></div></div>
          <CashFlowChart transactions={currentTransactions} />
        </section>

        <section className="panel bills-panel">
          <PanelHeader eyebrow="NEXT 14 DAYS" title="Bills approaching" action="All bills" onAction={() => onNavigate("bills")} />
          <div className="bill-list">
            {upcoming.map((bill) => <BillRow key={bill.id} bill={bill} onToggle={onToggleBill} />)}
            {!upcoming.length && <EmptyState icon={<Check />} title="You’re current" copy="No unpaid bills are approaching." />}
          </div>
        </section>

        <section className="panel transactions-panel">
          <PanelHeader eyebrow="LATEST ENTRIES" title="Recent transactions" action="See all" onAction={() => onNavigate("activity")} />
          <div className="transaction-list">{recent.map((item) => <TransactionRow key={item.id} item={item} />)}</div>
        </section>

        <section className="panel category-panel">
          <PanelHeader eyebrow="OUTFLOW" title="Where it’s going" />
          <div className="category-visual">
            <div className="donut" style={{ "--p1": `${(categoryTotals[0]?.[1] || 0) / totalCategorySpend * 100}%`, "--p2": `${((categoryTotals[0]?.[1] || 0) + (categoryTotals[1]?.[1] || 0)) / totalCategorySpend * 100}%`, "--p3": `${((categoryTotals[0]?.[1] || 0) + (categoryTotals[1]?.[1] || 0) + (categoryTotals[2]?.[1] || 0)) / totalCategorySpend * 100}%` } as React.CSSProperties}><div><span>Spent</span><strong>{currency.format(totals.spending)}</strong></div></div>
            <div className="category-legend">{categoryTotals.map(([name, amount], index) => <div key={name}><i className={`legend-${index + 1}`} /><span>{name}</span><strong>{Math.round(amount / totalCategorySpend * 100)}%</strong></div>)}</div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Activity({ data, onDelete, onEdit, onPosted }: { data: HouseholdData; onDelete: (id: string) => void; onEdit: (item: Transaction) => void; onPosted: (item: Transaction) => void }) {
  const current = data.transactions.filter((item) => monthKey(item.date) === monthKey());
  return <div className="page-content"><section className="section-intro"><div><span>{monthLabel(monthKey()).toUpperCase()}</span><h2>This month’s transactions.</h2><p>{current.length} entries. All remain accessible; earlier months are in Monthly archive.</p></div></section><MonthlySummary transactions={data.transactions} month={monthKey()} /><PendingReview transactions={data.transactions} onEdit={onEdit} onPosted={onPosted} /><TransactionBrowser transactions={current} onEdit={onEdit} onDelete={onDelete} /></div>;
}

type ListSort = "date" | "category" | "person" | "credit" | "debit";
function ListControls({ query, setQuery, category, setCategory, person, setPerson, direction, setDirection, sort, setSort, categoryOptions, personOptions }: { query: string; setQuery: (value: string) => void; category: string; setCategory: (value: string) => void; person: string; setPerson: (value: string) => void; direction: string; setDirection: (value: string) => void; sort: ListSort; setSort: (value: ListSort) => void; categoryOptions: string[]; personOptions: string[] }) {
  return <div className="list-controls"><label className="search-field"><Search /><input aria-label="Search records" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search descriptions, people, categories…" /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categoryOptions.map((item) => <option key={item}>{item}</option>)}</select></label><label>Entered by<select value={person} onChange={(event) => setPerson(event.target.value)}><option value="">Everyone</option>{personOptions.map((item) => <option key={item}>{item}</option>)}</select></label><label>Balance effect<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="">All movements</option><option value="credit">Credit / increase</option><option value="debit">Debit / decrease</option><option value="transfer">Transfers</option></select></label><label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value as ListSort)}><option value="date">Date, then submission time</option><option value="category">Category A–Z</option><option value="person">Entered by A–Z</option><option value="credit">Credits first</option><option value="debit">Debits first</option></select></label></div>;
}

function TransactionBrowser({ transactions, onEdit, onDelete }: { transactions: Transaction[]; onEdit: (item: Transaction) => void; onDelete?: (id: string) => void }) {
  const [query, setQuery] = useState(""); const [category, setCategory] = useState(""); const [person, setPerson] = useState(""); const [direction, setDirection] = useState(""); const [sort, setSort] = useState<ListSort>("date"); const [limit, setLimit] = useState(10);
  useEffect(() => setLimit(10), [query, category, person, direction, sort]);
  const filtered = sortTransactions(transactions).filter((item) => [item.description, item.category, item.enteredBy, item.notes || "", item.date].join(" ").toLowerCase().includes(query.toLowerCase()) && (!category || item.category === category) && (!person || item.enteredBy === person) && (!direction || (direction === "transfer" ? transactionKind(item) === "transfer" : transactionKind(item) === "transfer" || (direction === "credit" ? item.amount > 0 : item.amount < 0))));
  filtered.sort((a, b) => (sort === "category" ? a.category.localeCompare(b.category) : sort === "person" ? a.enteredBy.localeCompare(b.enteredBy) : sort === "credit" ? b.amount - a.amount : sort === "debit" ? a.amount - b.amount : 0) || b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return <><ListControls query={query} setQuery={setQuery} category={category} setCategory={setCategory} person={person} setPerson={setPerson} direction={direction} setDirection={setDirection} sort={sort} setSort={setSort} categoryOptions={[...new Set(transactions.map((item) => item.category))].sort()} personOptions={[...new Set(transactions.map((item) => item.enteredBy))].sort()} /><section className="panel ledger-panel"><div className="ledger-head"><span>Description</span><span>Category</span><span>Entered by</span><span>Date</span><span>Amount</span><span /></div>{filtered.slice(0, limit).map((item) => <LedgerRow key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} />)}{!filtered.length && <EmptyState icon={<Search />} title="No matching entries" copy="Try another search or filter." />}<div className="list-pagination"><span>Showing {Math.min(limit, filtered.length)} of {filtered.length} matching entries</span>{limit < filtered.length && <button className="primary-button" onClick={() => setLimit((value) => value + 10)}>Show 10 more</button>}</div><p className="list-note">Transfers appear in both credit and debit filters because they increase one account and decrease the other.</p></section></>;
}

function ArchiveView({ data, onEdit }: { data: HouseholdData; onEdit: (item: Transaction) => void }) {
  const months = useMemo(() => [...new Set(data.transactions.map((item) => monthKey(item.date)).filter((key) => key < monthKey()))].sort().reverse(), [data.transactions]);
  const [selected, setSelected] = useState(months[0] || "");
  const selectedMonth = months.includes(selected) ? selected : months[0] || "";
  const transactions = sortTransactions(data.transactions.filter((item) => monthKey(item.date) === selectedMonth));
  const income = transactions.filter((item) => transactionKind(item) === "income").reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const spending = Math.max(0, transactions.filter((item) => transactionKind(item) === "expense").reduce((sum, item) => sum - item.amount, 0));
  const transfers = transactions.filter((item) => transactionKind(item) === "transfer").reduce((sum, item) => sum + Math.abs(item.amount), 0);
  return (
    <div className="page-content archive-page">
      <section className="section-intro"><div><span>MONTHLY ARCHIVE</span><h2>Review the current behind you.</h2><p>Closed months stay searchable without changing today’s account balances.</p></div></section>
      {!months.length ? <section className="panel"><EmptyState icon={<Archive />} title="No archived months yet" copy="Transactions move here automatically after their calendar month ends." /></section> : <>
        <div className="archive-months" role="tablist" aria-label="Archived months">{months.map((key) => <button key={key} className={key === selectedMonth ? "active" : ""} onClick={() => setSelected(key)}><span>{monthLabel(key)}</span><small>{data.transactions.filter((item) => monthKey(item.date) === key).length} entries</small></button>)}</div>
        <section className="archive-summary">
          <div><span>INCOME</span><strong className="amount-positive">{currency.format(income)}</strong></div>
          <div><span>SPENDING</span><strong className="amount-negative">{currency.format(-spending)}</strong></div>
          <div><span>TRANSFERS</span><strong>{currency.format(transfers)}</strong></div>
          <div><span>NET TRANSACTIONS</span><strong className={income - spending >= 0 ? "amount-positive" : "amount-negative"}>{currency.format(income - spending)}</strong></div>
        </section>
        <MonthlySummary transactions={data.transactions} month={selectedMonth} /><TransactionBrowser key={selectedMonth} transactions={transactions} onEdit={onEdit} />
      </>}
    </div>
  );
}

function billPaymentLabel(bill: Bill, transactions: Transaction[]) {
  const payment = transactions.find((item) => item.id === bill.paymentTransactionId);
  return payment ? `Paid ${shortDate.format(new Date(`${payment.date}T12:00:00`))}` : "Paid · date not linked";
}

function Bills({ data, onAdd, onPay, onEdit, onDelete }: { data: HouseholdData; onAdd: () => void; onPay: (bill: Bill) => void; onEdit: (bill: Bill) => void; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState(""); const [category, setCategory] = useState(""); const [person, setPerson] = useState(""); const [direction, setDirection] = useState(""); const [sort, setSort] = useState<ListSort>("date"); const [status, setStatus] = useState(""); const [deleting, setDeleting] = useState<Bill | null>(null);
  const unpaid = data.bills.filter(plannedBill).reduce((sum, bill) => sum + bill.amount, 0);
  const visible = data.bills.filter((bill) => [bill.name, bill.category, bill.enteredBy || "Household"].join(" ").toLowerCase().includes(query.toLowerCase()) && (!category || bill.category === category) && (!person || (bill.enteredBy || "Household") === person) && (!status || (status === "paid" ? bill.paid : !bill.paid)) && (!direction || direction === "debit"));
  visible.sort((a, b) => (sort === "category" ? a.category.localeCompare(b.category) : sort === "person" ? (a.enteredBy || "Household").localeCompare(b.enteredBy || "Household") : sort === "credit" ? a.amount - b.amount : sort === "debit" ? b.amount - a.amount : 0) || a.dueDate.localeCompare(b.dueDate));
  return <div className="page-content"><section className="section-intro"><div><span>BILL PLANNING</span><h2>Know what the current carries next.</h2><p>{currency.format(unpaid)} reserved for unpaid bills due within 31 days. Planning reduces available funds; recording payment reduces the chosen account once.</p></div><button className="primary-button" onClick={onAdd}><Plus /> Add bill</button></section><ListControls query={query} setQuery={setQuery} category={category} setCategory={setCategory} person={person} setPerson={setPerson} direction={direction} setDirection={setDirection} sort={sort} setSort={setSort} categoryOptions={[...new Set(data.bills.map((item) => item.category))].sort()} personOptions={[...new Set(data.bills.map((item) => item.enteredBy || "Household"))].sort()} /><label className="bill-status-filter">Payment status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All bills</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option></select></label><p className="list-note">Bills are planned debits. Credit and transfer filters apply to Transactions.</p><div className="bill-card-grid">{visible.map((bill) => <article className={`bill-card ${bill.paid ? "is-paid" : ""}`} key={bill.id}><div className="bill-card-top"><div className="bill-emblem"><ReceiptText /></div><span>{bill.recurrence} · {monthLabel(monthKey(bill.dueDate))}</span><div className="ledger-actions"><button aria-label={`Edit ${bill.name} due ${bill.dueDate}`} onClick={() => onEdit(bill)}><Pencil /></button><button aria-label={`Delete ${bill.name} due ${bill.dueDate}`} onClick={() => setDeleting(bill)}><Trash2 /></button></div></div><small>{bill.category} · {bill.enteredBy || "Household"}</small><h3>{bill.name}</h3><strong>{currency.format(bill.amount)}</strong><p className="list-note">{(bill.reminderDays ?? 3) < 0 ? "Reminders off" : `Reminder: ${bill.reminderDays ?? 3} days before due`}</p><div className="bill-card-foot"><div><span>{bill.paid ? billPaymentLabel(bill, data.transactions) : daysUntil(bill.dueDate) < 0 ? "Overdue" : `Due in ${daysUntil(bill.dueDate)} days`}</span><small>Due {shortDate.format(new Date(`${bill.dueDate}T12:00:00`))}</small></div>{!bill.paid && <button onClick={() => onPay(bill)}>Record payment</button>}{bill.paid && !bill.paymentTransactionId && <button onClick={() => onPay(bill)}>Link payment</button>}{bill.paid && <span>{bill.paymentTransactionId ? "Linked transaction" : "Previously marked paid"}</span>}</div></article>)}</div>{!visible.length && <EmptyState icon={<Search />} title="No matching bills" copy="Add a bill or change your filters." />}{deleting && <Modal title="Delete bill?" onClose={() => setDeleting(null)}><div className="entry-form"><p>Remove {deleting.name} from bill planning and reminders? Any payment transaction will remain in your account history. The deleted occurrence will be available in Settings → Recovery.</p><button className="primary-button" onClick={() => { onDelete(deleting.id); setDeleting(null); }}>Delete bill</button></div></Modal>}</div>;
}

function ImportExport({ data, enteredBy, onImport }: { data: HouseholdData; enteredBy: string; onImport: (transactions: Transaction[]) => void }) {
  const [pastedImport, setPastedImport] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const download = (kind: "json" | "csv") => {
    const content = kind === "json"
      ? JSON.stringify({ schemaVersion: 3, transactions: data.transactions }, null, 2)
      : ["date,description,category,amount,type,account,transferTo,enteredBy,status,notes,createdAt,paydayPeriod", ...data.transactions.map((item) => [item.date, csvEscape(item.description), csvEscape(item.category), item.amount, transactionKind(item), transactionAccount(item), item.transferTo || "", csvEscape(item.enteredBy), item.status || "posted", csvEscape(item.notes || ""), item.createdAt, item.paydayPeriod || ""].join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: kind === "json" ? "application/json" : "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `living-current-${todayISO()}.${kind}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => {
    const content = "date,description,category,amount,type,account,transferTo,enteredBy\n2026-10-01,Example grocery purchase,Groceries,-42.18,expense,checking,,Pat\n2026-10-01,Example paycheck,Salary,2400.00,income,checking,,Pat\n2026-10-01,Move rent funds,Transfer,500.00,transfer,checking,savings,Pat\n";
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "living-current-import-template.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const parsed = file.name.toLowerCase().endsWith(".json") ? parseJson(text, enteredBy) : parseCsv(text, enteredBy, file.name);
      if (!parsed.length) throw new Error("No valid transactions were found.");
      onImport(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This file could not be imported.");
    }
  };

  return (
    <div className="page-content import-page">
      <section className="section-intro"><div><span>PORTABLE BY DESIGN</span><h2>Your records stay useful anywhere.</h2><p>Bring in clean transaction files or keep an independent household backup.</p></div></section>
      <section className="panel paste-import"><details><summary>Paste CSV or JSON instead</summary><p>Paste your transaction file contents below. The same date, duplicate, and archive checks apply.</p><label htmlFor="paste-transactions">Transaction CSV or JSON</label><textarea id="paste-transactions" rows={8} value={pastedImport} onChange={(event) => setPastedImport(event.target.value)} /><button className="primary-button" disabled={!pastedImport.trim()} onClick={() => { setError(""); try { const text = pastedImport.trim(); const parsed = text.startsWith("{") || text.startsWith("[") ? parseJson(text, enteredBy) : parseCsv(text, enteredBy, "pasted.csv"); if (!parsed.length) throw new Error("No valid transactions were found."); onImport(parsed); setPastedImport(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import these entries."); } }}>Import pasted transactions</button></details></section>
      <div className="import-grid">
        <section className="panel upload-panel"><div className="upload-art"><Upload /></div><span>CSV OR JSON</span><h3>Import transactions</h3><p>Choose a Living Current file or a bank statement export. Past dates are filed into Monthly archive automatically, and imports do not alter your reconciled account balances.</p><button className="primary-button" onClick={() => inputRef.current?.click()}><Upload /> Choose file</button><input ref={inputRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />{error && <div className="form-error" role="alert">{error}</div>}</section>
        <section className="panel export-panel"><div className="export-heading"><Download /><div><span>BACKUP & TEMPLATE</span><h3>{data.transactions.length} transactions ready</h3></div></div><p>Export a full copy, or use the template with ChatGPT to prepare clean entries without sharing bank credentials.</p><button onClick={downloadTemplate}><FileSpreadsheet /> Download blank template</button><button onClick={() => download("csv")}><FileSpreadsheet /> Export household CSV</button><button onClick={() => download("json")}><FileJson /> Export household JSON</button><div className="privacy-note"><ShieldCheck /><span><strong>No bank credentials</strong>Your file contains only the descriptions, categories, dates, and amounts you chose to import.</span></div></section>
      </div>
    </div>
  );
}

function SettingsView({ data, sync, email, uid, deviceRole, onDeviceRoleChange, onSave, onSignOut, onBeforeUpdate, onRestore }: { onRestore: (id: string) => void; data: HouseholdData; sync: SyncState; email: string; uid: string; deviceRole: DeviceRole; onDeviceRoleChange: (role: DeviceRole) => void; onSave: (values: Partial<HouseholdData>) => void; onSignOut: () => void; onBeforeUpdate: () => Promise<void> }) {
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const updateApp = async () => { setUpdatingApp(true); setUpdateError(""); try { await onBeforeUpdate(); const url = new URL(window.location.href); url.searchParams.set("app-update", String(Date.now())); const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error("Could not download the latest app."); if ("serviceWorker" in navigator) { const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL); await registration?.update(); } if ("caches" in window) await Promise.all((await caches.keys()).filter((key) => key.startsWith("living-current-")).map((key) => caches.delete(key))); window.location.replace(url.toString()); } catch { setUpdatingApp(false); setUpdateError("Update paused. Your entries are kept on this device; reconnect so they can finish saving, then try again."); } };
  const [checkingBalance, setCheckingBalance] = useState(String(data.checkingStartingBalance));
  const [savingsBalance, setSavingsBalance] = useState(String(data.savingsStartingBalance));
  const [safetyBuffer, setSafetyBuffer] = useState(String(data.safetyBuffer));
  const [displayName, setDisplayName] = useState(data.displayName);
  const [partnerName, setPartnerName] = useState(data.partnerName);
  const [dirty, setDirty] = useState(false);
  const [dirtyFields, setDirtyFields] = useState<Set<keyof HouseholdData>>(new Set());
  useEffect(() => { if (!dirty) { setCheckingBalance(String(data.checkingStartingBalance)); setSavingsBalance(String(data.savingsStartingBalance)); setSafetyBuffer(String(data.safetyBuffer)); setDisplayName(data.displayName); setPartnerName(data.partnerName); } }, [data.checkingStartingBalance, data.savingsStartingBalance, data.safetyBuffer, data.displayName, data.partnerName, dirty]);
  return (
    <div className="page-content settings-page">
      <section className="section-intro"><div><span>HOUSEHOLD SETTINGS</span><h2>Shape the view you share.</h2><p>These values affect both enrolled devices.</p></div></section>
      <div className="settings-grid">
        <form className="panel settings-form household-details" onChange={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); const values = { checkingStartingBalance: Number(checkingBalance), savingsStartingBalance: Number(savingsBalance), safetyBuffer: Number(safetyBuffer), displayName, partnerName }; onSave(Object.fromEntries([...dirtyFields].map((key) => [key, values[key as keyof typeof values]]))); setDirtyFields(new Set()); setDirty(false); }}><h3>Household details</h3><p className="settings-note">Shared through Firebase with both devices. Changes save when you select the button below.</p><label>Your display name<input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setDirtyFields((current) => new Set([...current, "displayName"])); }} /></label><label>Partner display name<input value={partnerName} onChange={(event) => { setPartnerName(event.target.value); setDirtyFields((current) => new Set([...current, "partnerName"])); }} /></label><div className="form-row"><label>{monthLabel(data.balanceStartMonth)} opening checking<input inputMode="decimal" value={checkingBalance} onChange={(event) => { setCheckingBalance(event.target.value); setDirtyFields((current) => new Set([...current, "checkingStartingBalance"])); }} /></label><label>{monthLabel(data.balanceStartMonth)} opening savings<input inputMode="decimal" value={savingsBalance} onChange={(event) => { setSavingsBalance(event.target.value); setDirtyFields((current) => new Set([...current, "savingsStartingBalance"])); }} /></label></div><p className="settings-note">Current balances are calculated from these opening amounts plus every transaction recorded from {monthLabel(data.balanceStartMonth)} onward.</p><label>Safety buffer<input inputMode="decimal" value={safetyBuffer} onChange={(event) => { setSafetyBuffer(event.target.value); setDirtyFields((current) => new Set([...current, "safetyBuffer"])); }} /></label><button className="primary-button" type="submit" disabled={!dirty}>Save household changes</button></form>
        <div className="settings-side">
        <PaydaySettings data={data} today={todayISO()} onSave={onSave} />
        <section className="panel settings-form device-identity"><h3>This device</h3><p>Choose who normally enters transactions on this phone or computer. This preference stays on this device, so the shared account can tell you apart.</p><div className="identity-toggle"><button type="button" className={deviceRole === "primary" ? "active" : ""} onClick={() => onDeviceRoleChange("primary")}><span>{displayName || "Primary"}</span><small>Use on this device</small></button><button type="button" className={deviceRole === "partner" ? "active" : ""} onClick={() => onDeviceRoleChange("partner")}><span>{partnerName || "Partner"}</span><small>Use on this device</small></button></div></section>
        <section className="panel connection-panel"><div className="connection-icon"><CloudCheck /></div><span>SYNC STATUS</span><h3>{syncLabel(sync)}</h3><p>{firebaseConfigured ? "Both devices can use the same household email and password. Firebase keeps the shared record synchronized." : "Add the Firebase values from .env.example to enable real-time household cloud save."}</p><dl><div><dt>Household</dt><dd>{householdId}</dd></div><div><dt>Signed in as</dt><dd>{email || uid || "Local preview"}</dd></div><div><dt>Storage</dt><dd>{firebaseConfigured ? "Cloud Firestore" : "Local preview"}</dd></div></dl>{firebaseConfigured && <button className="signout-button" type="button" onClick={onSignOut}><LogOut /> Sign out on this device</button>}</section>
        <section className="panel settings-form"><h3>App updates</h3><p>Load the latest published Living Current version. Your saved household records stay in place.</p><button type="button" className="primary-button" disabled={updatingApp || sync === "connecting" || sync === "offline"} onClick={() => void updateApp()}><RefreshCw />{updatingApp ? "Updating…" : "Update app"}</button>{updateError && <p role="alert">{updateError}</p>}</section>
        </div>
      </div>
      <RecoveryPanel records={data.recovery || []} onRestore={onRestore} />
    </div>
  );
}

function SyncView({ data, sync, email, lastSyncAt, onRefresh }: { data: HouseholdData; sync: SyncState; email: string; lastSyncAt: Date | null; onRefresh: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false);
  const runRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const formatMoment = (value: Date | string | null) => {
    if (!value) return "Waiting for first confirmation";
    const date = typeof value === "string" ? new Date(value) : value;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
  };
  return (
    <div className="page-content sync-page">
      <section className="section-intro"><div><span>CLOUD SAVE</span><h2>Your household, in step.</h2><p>Living Current listens for Firestore changes and keeps this device aligned automatically.</p></div><button className="primary-button sync-now" disabled={refreshing || sync === "connecting"} onClick={() => void runRefresh()}><RefreshCw className={refreshing || sync === "connecting" ? "is-spinning" : ""} />{refreshing ? "Syncing…" : "Sync now"}</button></section>
      <section className={`sync-hero sync-hero-${sync}`}>
        <div className="sync-pulse" aria-hidden="true"><CloudCheck /></div>
        <div><span>LIVE CONNECTION</span><h3>{syncLabel(sync)}</h3><p>{sync === "synced" ? "The latest household record has been confirmed by Cloud Firestore." : sync === "connecting" ? "Checking Cloud Firestore for the newest household record." : "Living Current will keep trying while preserving the latest local copy."}</p></div>
        <div className="sync-freshness"><small>LAST CONFIRMED SYNC</small><strong>{formatMoment(lastSyncAt)}</strong><span>Real-time listener active</span></div>
      </section>
      <div className="sync-grid">
        <section className="panel sync-detail-card"><span>HOUSEHOLD RECORD</span><h3>Latest saved change</h3><strong>{formatMoment(data.updatedAt)}</strong><p>This timestamp comes from the shared household document and updates whenever either device saves a change.</p></section>
        <section className="panel sync-detail-card"><span>ACCOUNT</span><h3>Shared access</h3><strong>{email || "Local preview"}</strong><p>Both devices should use this same Firebase email login to reach the household.</p></section>
        <section className="panel sync-detail-card"><span>DESTINATION</span><h3>Cloud Firestore</h3><strong>{householdId}</strong><p>Data is stored in the isolated Living Current Firebase project, separate from your other apps.</p></section>
      </div>
      <section className="panel sync-explainer"><div><RefreshCw /><div><strong>Automatic by default</strong><span>Changes from either signed-in device arrive through a real-time Firestore listener. “Sync now” performs an additional direct freshness check.</span></div></div><div><ShieldCheck /><div><strong>Financial entries only</strong><span>No bank login, account number, or connected financial institution is used.</span></div></div></section>
    </div>
  );
}

function TransactionDialog({ name, existing, data, bills, onClose, onSave }: { name: string; existing?: Transaction; data: HouseholdData; bills: Bill[]; onClose: () => void; onSave: (transaction: Transaction) => void }) {
  const [kind, setKind] = useState<TransactionKind>(existing ? transactionKind(existing) : "expense");
  const [description, setDescription] = useState(existing?.description || "");
  const [category, setCategory] = useState(existing && !categories.includes(existing.category) ? "Custom" : existing?.category || "Groceries");
  const [customCategory, setCustomCategory] = useState(existing?.category || "");
  const [amount, setAmount] = useState(existing ? String(Math.abs(existing.amount)) : "");
  const [date, setDate] = useState(existing?.date || todayISO());
  const [account, setAccount] = useState<AccountName>(existing?.account || "checking");
  const [transferTo, setTransferTo] = useState<AccountName>(existing?.transferTo || "savings");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [status, setStatus] = useState<"pending" | "posted">(existing?.status || "pending");
  const [billId, setBillId] = useState(existing?.billId || "");
  const [paydayPeriod, setPaydayPeriod] = useState(existing?.paydayPeriod || "");
  const payPeriods = [...new Set([shiftPeriod(monthKey(), -1), monthKey(), shiftPeriod(monthKey(), 1), paydayPlan(data, 0, todayISO()).period, existing?.paydayPeriod].filter(Boolean) as string[])].sort();
  const chooseAccount = (next: AccountName) => { setAccount(next); if (transferTo === next) setTransferTo(next === "checking" ? "savings" : "checking"); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Math.abs(Number(amount));
    const finalCategory = kind === "transfer" ? "Transfer" : category === "Custom" ? customCategory.trim() : category;
    if (!description.trim() || !Number.isFinite(value) || !value || !finalCategory || (kind === "transfer" && account === transferTo)) return;
    if (kind === "income" && paydayPeriod && data.transactions.some(item => item.id !== existing?.id && item.paydayPeriod === paydayPeriod && item.amount > 0 && (item.type || "income") === "income")) { window.alert("This income month already has a linked pay transaction. Edit that transaction instead, or record this as other income."); return; }
    onSave({ ...existing, id: existing?.id || (kind === "expense" && billId ? `bill-payment-${billId}-${bills.find((bill) => bill.id === billId)?.dueDate}` : makeId()), billId: kind === "expense" ? billId || undefined : undefined, paydayPeriod: kind === "income" ? paydayPeriod || undefined : undefined, date, description: description.trim(), category: finalCategory, amount: kind === "expense" ? -value : value, type: kind, account, transferTo: kind === "transfer" ? transferTo : undefined, affectsBalance: true, status, notes: notes.trim(), enteredBy: existing?.enteredBy || name || "Household", createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
  };
  return <Modal title={existing ? "Edit transaction" : "Add transaction"} onClose={onClose}><form className="entry-form" onSubmit={submit}>
    <div className="type-toggle type-toggle-three"><button type="button" className={kind === "expense" ? "active" : ""} onClick={() => setKind("expense")}><ArrowUpRight /> Expense</button><button type="button" className={kind === "income" ? "active" : ""} onClick={() => setKind("income")}><ArrowDownLeft /> Income</button><button type="button" className={kind === "transfer" ? "active" : ""} onClick={() => setKind("transfer")}><ArrowRightLeft /> Transfer</button></div>
    {kind === "income" && <><label>Scheduled pay (optional)<select value={paydayPeriod} onChange={event => setPaydayPeriod(event.target.value)}><option value="">Other income · do not reset payday</option>{payPeriods.map(period => <option key={period} value={period}>{monthLabel(period)} scheduled pay</option>)}</select></label><p className="settings-note">Select the income month this payment fulfills, even if it arrives early or late. Its actual amount changes the account balance once; its transaction date marks payday received.</p></>}
    {kind === "expense" && <label>Bill payment (optional)<select value={billId} onChange={(event) => setBillId(event.target.value)}><option value="">Not linked to a bill</option>{bills.filter((bill) => !bill.paid || bill.paymentTransactionId === existing?.id).map((bill) => <option key={bill.id} value={bill.id}>{bill.name} · Due {bill.dueDate}</option>)}</select></label>}
    <label>Description<input autoFocus value={description} onChange={(event) => setDescription(event.target.value)} placeholder={kind === "transfer" ? "Move rent funds" : "Publix"} required /></label>
    {kind === "transfer" ? <div className="form-row"><label>From<select value={account} onChange={(event) => chooseAccount(event.target.value as AccountName)}><option value="checking">Checking</option><option value="savings">Savings</option></select></label><label>To<select value={transferTo} onChange={(event) => setTransferTo(event.target.value as AccountName)}><option value="checking" disabled={account === "checking"}>Checking</option><option value="savings" disabled={account === "savings"}>Savings</option></select></label></div> : <div className="form-row"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Account<select value={account} onChange={(event) => setAccount(event.target.value as AccountName)}><option value="checking">Checking</option><option value="savings">Savings</option></select></label></div>}
    {category === "Custom" && kind !== "transfer" && <label>Custom category name<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Pet care" required /></label>}
    <div className="form-row"><label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label></div>
    <p className="entry-attribution">This entry will be recorded by <strong>{name || "Household"}</strong>.</p>
    <label>Notes (optional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Receipt details, purpose, or a reminder" /></label>
    <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as "pending" | "posted")}><option value="pending">Pending</option><option value="posted">Posted / cleared</option></select></label><p className="settings-note">Mark posted after you confirm it has cleared at your bank. Both statuses count toward your balance.</p>
    <button className="primary-button submit-button" type="submit">{existing ? "Save transaction" : kind === "transfer" ? "Record transfer" : "Add to household"}</button>
  </form></Modal>;
}

function BillDialog({ existing, name: enteredBy, onClose, onSave }: { existing?: Bill; name: string; onClose: () => void; onSave: (bill: Bill) => void }) {
  const [name, setName] = useState(existing?.name || ""); const [category, setCategory] = useState(existing && !categories.includes(existing.category) ? "Custom" : existing?.category || "Utilities"); const [customCategory, setCustomCategory] = useState(existing?.category || ""); const [amount, setAmount] = useState(existing ? String(existing.amount) : ""); const [date, setDate] = useState(existing?.dueDate || todayISO()); const [recurrence, setRecurrence] = useState<Bill["recurrence"]>(existing?.recurrence || "monthly"); const [account, setAccount] = useState<AccountName>(existing?.account || "checking"); const [reminderDays, setReminderDays] = useState(existing?.reminderDays ?? 3);
  const submit = (event: FormEvent) => { event.preventDefault(); const finalCategory = category === "Custom" ? customCategory.trim() : category; if (!name.trim() || !Number(amount) || !Number.isFinite(Number(amount)) || !finalCategory) return; const nextCycle = existing && date !== existing.dueDate; onSave({ ...existing, id: existing?.id || makeId(), name: name.trim(), category: finalCategory, amount: Math.abs(Number(amount)), dueDate: date, recurrenceAnchorDate: nextCycle ? date : existing?.recurrenceAnchorDate || date, recurrence, account, reminderDays, enteredBy: existing?.enteredBy || enteredBy, paid: nextCycle ? false : existing?.paid || false, paymentTransactionId: nextCycle ? undefined : existing?.paymentTransactionId }); };
  return <Modal title={existing ? "Edit bill" : "Add an upcoming bill"} onClose={onClose}><form className="entry-form" onSubmit={submit}><label>Bill name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required /></label><div className="form-row"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.filter((item) => !item.toLowerCase().includes("income") && item !== "Salary").map((item) => <option key={item}>{item}</option>)}</select></label><label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label></div>{category === "Custom" && <label>Custom category name<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} required /></label>}<div className="form-row"><label>Due date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label>Repeats<select value={recurrence} onChange={(event) => setRecurrence(event.target.value as Bill["recurrence"])}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option><option value="once">One time</option></select></label></div><div className="form-row"><label>Payment account<select value={account} onChange={(event) => setAccount(event.target.value as AccountName)}><option value="checking">Checking</option><option value="savings">Savings</option></select></label><label>Reminder<select value={reminderDays} onChange={(event) => setReminderDays(Number(event.target.value))}><option value={-1}>Off</option><option value={1}>1 day before</option><option value={3}>3 days before</option><option value={7}>7 days before</option></select></label></div><p className="settings-note">Background reminders require device registration from the bell menu. After payment, the next recurring occurrence is prepared automatically. Edit the upcoming occurrence to change its schedule; choose One time to stop repeating after that payment.</p><button className="primary-button submit-button" type="submit">{existing ? "Save bill" : "Add to bill planning"}</button></form></Modal>;
}

function BillPaymentDialog({ bill, data, name, onClose, onSave }: { bill: Bill; data: HouseholdData; name: string; onClose: () => void; onSave: (payment: Transaction) => void }) {
  const [mode, setMode] = useState(bill.paid ? "existing" : "new"); const [selected, setSelected] = useState(""); const [amount, setAmount] = useState(String(bill.amount)); const [date, setDate] = useState(todayISO()); const [account, setAccount] = useState<AccountName>(bill.account || "checking");
  const eligible = sortTransactions(data.transactions.filter((item) => item.amount < 0 && transactionKind(item) === "expense" && (!item.billId || item.billId === bill.id)));
  const submit = (event: FormEvent) => { event.preventDefault(); if (mode === "existing") { const payment = eligible.find((item) => item.id === selected); if (payment) onSave(payment); return; } const value = Math.abs(Number(amount)); if (!Number.isFinite(value) || !value) return; onSave({ id: `bill-payment-${bill.id}-${bill.dueDate}`, billId: bill.id, description: bill.name, category: bill.category, amount: -value, date, account, type: "expense", status: "pending", enteredBy: name, createdAt: new Date().toISOString() }); };
  return <Modal title={`Record payment: ${bill.name}`} onClose={onClose}><form className="entry-form" onSubmit={submit}><p>This records a payment you have made. It does not send money to the bill provider.</p><label>Payment entry<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="new">Create a new transaction</option><option value="existing">Link a transaction already entered</option></select></label>{mode === "new" ? <><div className="form-row"><label>Paid amount<input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} required /></label><label>Payment date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label></div><label>Paid from<select value={account} onChange={(event) => setAccount(event.target.value as AccountName)}><option value="checking">Checking</option><option value="savings">Savings</option></select></label><p className="settings-note">One pending expense will reduce this account and remove the bill from planning. Do not add the same payment again in Transactions.</p></> : <><label>Existing expense<select value={selected} onChange={(event) => setSelected(event.target.value)} required><option value="">Choose a transaction</option>{eligible.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.description} · {currency.format(item.amount)}</option>)}</select></label><p className="settings-note">The chosen transaction already affects your balance. Linking it adds no additional expense.</p></>}<button className="primary-button" type="submit" disabled={bill.paid && Boolean(bill.paymentTransactionId)}>{mode === "new" ? "Record payment and transaction" : "Link transaction and mark paid"}</button></form></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><span>HOUSEHOLD ENTRY</span><h2 id="modal-title">{title}</h2></div><button aria-label="Close" onClick={onClose}><X /></button></header>{children}</section></div>; }
function BrandMark() { return <div className="brand-mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}coin.svg`} alt="" /></div>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>; }
function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) { const displayValue = Math.abs(value) < .005 ? 0 : value; return <div><span>{label}</span><strong className={tone ? `amount-${tone}` : ""}>{displayValue > 0 && tone === "positive" ? "+" : ""}{currency.format(displayValue)}</strong></div>; }
function PanelHeader({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><div><span>{eyebrow}</span><h3>{title}</h3></div>{action && <button onClick={onAction}>{action}<ChevronRight /></button>}</header>; }
function TransactionRow({ item }: { item: Transaction }) { const kind = transactionKind(item); const tone = kind === "transfer" ? "" : item.amount > 0 ? "amount-positive" : "amount-negative"; return <div className="transaction-row"><div className={`transaction-icon ${kind}`}>{kind === "transfer" ? <ArrowRightLeft /> : kind === "income" ? <ArrowDownLeft /> : <ArrowUpRight />}</div><div><strong>{item.description}{item.status === "pending" && <small className="pending-badge">Pending</small>}</strong><span>{kind === "transfer" ? `${accountLabel(transactionAccount(item))} to ${accountLabel(item.transferTo || "savings")}` : `${item.category} · ${accountLabel(transactionAccount(item))}`} · {item.enteredBy}</span></div><time>{shortDate.format(new Date(`${item.date}T12:00:00`))}</time><b className={tone}>{item.amount > 0 && kind !== "transfer" ? "+" : ""}{currency.format(item.amount)}</b></div>; }
function LedgerRow({ item, onDelete, onEdit }: { item: Transaction; onDelete?: (id: string) => void; onEdit?: (item: Transaction) => void }) { const kind = transactionKind(item); const tone = kind === "transfer" ? "" : item.amount > 0 ? "amount-positive" : "amount-negative"; return <div className="ledger-row"><div className={`transaction-icon ${kind}`}>{kind === "transfer" ? <ArrowRightLeft /> : kind === "income" ? <ArrowDownLeft /> : <ArrowUpRight />}</div><strong>{item.description}{item.status === "pending" && <small className="pending-badge">Pending</small>}{item.notes && <small className="transaction-note">{item.notes}</small>}</strong><span>{kind === "transfer" ? `${accountLabel(transactionAccount(item))} → ${accountLabel(item.transferTo || "savings")}` : item.category}</span><span>{item.enteredBy}</span><span>{shortDate.format(new Date(`${item.date}T12:00:00`))}</span><b className={tone}>{item.amount > 0 && kind !== "transfer" ? "+" : ""}{currency.format(item.amount)}</b><div className="ledger-actions">{onEdit && <button aria-label={`Edit ${item.description}`} onClick={() => onEdit(item)}><Pencil /></button>}{onDelete && <button aria-label={`Delete ${item.description}`} onClick={() => onDelete(item.id)}><Trash2 /></button>}</div></div>; }

function CashFlowChart({ transactions }: { transactions: Transaction[] }) {
  const weeks = Array.from({ length: 5 }, (_, index) => {
    const entries = transactions.filter((item) => Math.floor((Number(item.date.slice(8)) - 1) / 7) === index);
    return { income: entries.filter((item) => transactionKind(item) === "income").reduce((sum, item) => sum + Math.abs(item.amount), 0), spending: Math.max(0, entries.filter((item) => transactionKind(item) === "expense").reduce((sum, item) => sum - item.amount, 0)) };
  });
  const maximum = Math.max(1, ...weeks.flatMap((week) => [week.income, week.spending]));
  return <><div className="cash-chart" role="img" aria-label={weeks.map((week, index) => `Week ${index + 1}: income ${currency.format(week.income)}, spending ${currency.format(week.spending)}`).join(". ")}>{weeks.map((week, index) => <div className="cash-week" key={index}><div className="cash-bars"><i className="cash-income" style={{ height: `${week.income / maximum * 100}%` }} title={`Income: ${currency.format(week.income)}`} /><i className="cash-spending" style={{ height: `${week.spending / maximum * 100}%` }} title={`Spending: ${currency.format(week.spending)}`} /></div><small>Week {index + 1}</small><span>{currency.format(week.income - week.spending)}</span></div>)}</div><p className="chart-key"><i /> Income <i /> Spending · Weekly net below each group. Transfers excluded.</p></>;
}
function BillRow({ bill, onToggle }: { bill: Bill; onToggle: (id: string) => void }) { const days = daysUntil(bill.dueDate); return <div className="bill-row"><button className="bill-check" aria-label={`Record payment for ${bill.name}`} onClick={() => onToggle(bill.id)}><Check /></button><div><strong>{bill.name}</strong><span>{bill.category} · {days < 0 ? `${Math.abs(days)} days overdue` : `Due in ${days} days`}</span></div><b>{currency.format(bill.amount)}</b></div>; }
function EmptyState({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) { return <div className="empty-state">{icon}<strong>{title}</strong><span>{copy}</span></div>; }
function accountLabel(account: AccountName) { return account === "checking" ? "Checking" : "Savings"; }
function saveStatus(sync: SyncState, lastSyncAt: Date | null) {
  if (sync === "local") return "Saved on this device only";
  if (sync === "synced" && lastSyncAt) return `Saved to cloud at ${lastSyncAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  if (sync === "offline") return "Saved on this device · waiting for cloud sync";
  if (sync === "needs-setup") return "Cloud save needs attention · check Sync";
  return "Saving to cloud…";
}
function viewTitle(view: View) { return view === "overview" ? greeting() : ({ activity: "Household transactions", archive: "Monthly archive", bills: "Upcoming bills", import: "Import & export", sync: "Cloud sync", settings: "Settings" } as const)[view]; }
function syncLabel(sync: SyncState) { return ({ local: "Local preview", connecting: "Connecting", synced: "Cloud save active", "needs-setup": "Enrollment needed", offline: "Working offline" } as const)[sync]; }
function csvEscape(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function parseJson(text: string, enteredBy: string): Transaction[] { const parsed = JSON.parse(text); const rows = Array.isArray(parsed) ? parsed : parsed.transactions; if (!Array.isArray(rows)) throw new Error("JSON must contain a transactions array."); return rows.map((row) => normalizeImport(row, enteredBy, "JSON import")).filter(Boolean) as Transaction[]; }
function parseCsv(text: string, enteredBy: string, source = "CSV import"): Transaction[] {
  const lines = csvRecords(text).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => { const cells = splitCsv(line).map((value) => value.trim().toLowerCase().replace(/\.$/, "")); return cells.includes("date") && cells.includes("description") && cells.includes("amount"); });
  if (headerIndex < 0) return [];
  const headers = splitCsv(lines[headerIndex]).map((value) => value.trim().toLowerCase().replace(/\.$/, ""));
  return lines.slice(headerIndex + 1).map((line) => { const values = splitCsv(line); const row = Object.fromEntries(headers.map((header, index) => [header, values[index]])); return normalizeImport(row, enteredBy, source); }).filter(Boolean) as Transaction[];
}
function csvRecords(text: string) { const rows: string[] = []; let current = ""; let quoted = false; for (let i = 0; i < text.length; i++) { const char = text[i]; if (char === '"') { if (quoted && text[i + 1] === '"') { current += '""'; i++; continue; } quoted = !quoted; } if (char === "\n" && !quoted) { rows.push(current.replace(/\r$/, "")); current = ""; } else current += char; } if (current) rows.push(current); return rows; }
function splitCsv(line: string) { const values: string[] = []; let current = ""; let quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { values.push(current.trim()); current = ""; } else current += char; } values.push(current.trim()); return values; }
function normalizeImport(row: Record<string, unknown>, enteredBy: string, source: string): Transaction | null {
  const amount = Number(String(row.amount ?? "").replace(/[$,]/g, ""));
  const description = String(row.description || row.merchant || "").trim();
  const date = normalizeDate(String(row.date || todayISO()));
  if (!description || !date || !Number.isFinite(amount) || amount === 0 || /^beginning balance/i.test(description)) return null;
  const suppliedType = String(row.type || "").toLowerCase();
  const internalTransfer = /keep the change transfer to acct|online banking transfer (?:from|to) sav/i.test(description);
  const type: TransactionKind = suppliedType === "transfer" || internalTransfer ? "transfer" : suppliedType === "income" || suppliedType === "expense" ? suppliedType : /refund/i.test(description) ? "expense" : amount < 0 ? "expense" : "income";
  const account: AccountName = /online banking transfer from sav/i.test(description) ? "savings" : String(row.account || "checking").toLowerCase() === "savings" ? "savings" : "checking";
  const suppliedTransfer = String(row.transferTo || row.transferto || "").toLowerCase();
  const transferTo: AccountName | undefined = type === "transfer" ? /online banking transfer from sav/i.test(description) || suppliedTransfer === "checking" ? "checking" : "savings" : undefined;
  const normalizedAmount = type === "transfer" ? Math.abs(amount) : amount;
  const fingerprint = `${date}|${description.toLowerCase()}|${normalizedAmount.toFixed(2)}|${type}|${account}`;
  return { id: String(row.id || `import-${simpleHash(fingerprint)}`), date, description: cleanBankDescription(description), category: String(row.category || categorize(description, type)), amount: normalizedAmount, type, account, transferTo, affectsBalance: false, status: String(row.status || "posted").toLowerCase() === "pending" ? "pending" : "posted", notes: String(row.notes || ""), billId: row.billId || row.billid ? String(row.billId || row.billid) : undefined, paydayPeriod: type === "income" && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(row.paydayPeriod || row.paydayperiod || "")) ? String(row.paydayPeriod || row.paydayperiod) : undefined, enteredBy: String(row.enteredBy || row.enteredby || enteredBy), createdAt: String(row.createdAt || row.createdat || new Date().toISOString()), importSource: source };
}
function normalizeDate(value: string) { const cleaned = value.trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned; const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : ""; }
function simpleHash(value: string) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function cleanBankDescription(value: string) { if (/keep the change transfer to acct/i.test(value)) return "Keep the Change transfer to savings"; if (/online banking transfer from sav/i.test(value)) return "Transfer from savings to checking"; if (/online banking transfer to sav/i.test(value)) return "Transfer from checking to savings"; return value.replace(/\s+/g, " ").replace(/;?\s*Conf#.*$/i, "").replace(/\s+(MOBILE )?PURCHASE.*$/i, "").replace(/\s+DES:.*$/i, "").trim(); }
function categorize(description: string, type: TransactionKind) {
  const value = description.toUpperCase();
  if (type === "transfer") return "Transfer";
  if (type === "income") return /TELO|PAYROLL|SALARY|DIRECT DEP|ACH CREDIT/.test(value) ? "Salary" : "Additional Income";
  if (/PUBLIX|ALDI|WINN.DIXIE|WHOLE FOODS|TRADER JOE|INSTACART/.test(value)) return "Groceries";
  if (/TACO|PIZZA|SLICE|WENDY|MCDONALD|BURGER|RESTAURANT|CAFE|COFFEE|STARBUCKS|DOORDASH|UBER EATS|GRUBHUB|TOO GOOD TO GO|SIP 305|7-ELEVEN/.test(value)) return "Dining";
  if (/FPL|ELECTRIC|WATER|UTILITY/.test(value)) return "Utilities";
  if (/AT&T|ATT |T-MOBILE|VERIZON|COMCAST|XFINITY/.test(value)) return "Cell Phone & Internet";
  if (/SHELL|EXXON|CHEVRON|MOBIL|SUNPASS|PARKING|UBER|LYFT|AUTO|TIRE/.test(value)) return "Transportation";
  if (/FORD MOTOR|PAYBYPHONE|PARK ONE/.test(value)) return "Transportation";
  if (/RENT|MORTGAGE|PROPERTY/.test(value)) return "Housing";
  if (/WALGREENS|CVS|PHARM|VITAMIN|HEALTH|MEDICAL|DENTAL/.test(value)) return "Health";
  if (/TARGET|WALMART|HOME DEPOT|LOWE.S|AMAZON/.test(value)) return "Household";
  if (/FACTS TUITION|TRUE NORTH|NBS\*/.test(value)) return "Education";
  if (/SPOTIFY|ADOBE|APPLE\.COM|EPIC GAMES|FORTNITE|DUOLINGO|SMUGMUG|TWILIO/.test(value)) return "Entertainment & Subscriptions";
  if (/AFFIRM|SYNCHRONY|AMERICAN EXPRESS|STORECRD|FORDCREDIT/.test(value)) return "Debt Payments";
  if (/ATM|WITHDRWL/.test(value)) return "Cash";
  if (/INSURANCE|GEICO|PROGRESSIVE|STATE FARM/.test(value)) return "Insurance";
  return "Other";
}

export default App;
