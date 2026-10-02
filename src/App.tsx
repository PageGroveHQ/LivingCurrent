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
const daysUntil = (date: string) => Math.ceil((new Date(`${date}T12:00:00`).getTime() - new Date(`${todayISO()}T12:00:00`).getTime()) / 86_400_000);
const monthKey = (date = todayISO()) => date.slice(0, 7);
const monthLabel = (key: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${key}-01T12:00:00`));
const transactionKind = (item: Transaction): TransactionKind => item.type || (item.amount < 0 ? "expense" : "income");
const transactionAccount = (item: Transaction): AccountName => item.account || "checking";
const plannedBill = (bill: Bill) => !bill.paid && daysUntil(bill.dueDate) <= 31;

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
    const importedDate = new Date(`${item.date}T12:00:00`).getTime();
    const merchant = item.description.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).find((word) => word.length > 3) || item.description.toLowerCase();
    const pendingIndex = merged.findIndex((existing) => existing.status === "pending" && Math.abs(existing.amount - item.amount) < .005 && Math.abs(new Date(`${existing.date}T12:00:00`).getTime() - importedDate) <= 4 * 86_400_000 && existing.description.toLowerCase().includes(merchant));
    if (pendingIndex >= 0) merged[pendingIndex] = { ...item, id: merged[pendingIndex].id, enteredBy: merged[pendingIndex].enteredBy, affectsBalance: merged[pendingIndex].affectsBalance, status: "posted" };
    else merged.push(item);
  }
  return merged.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function App() {
  const [data, setData] = useState<HouseholdData>(createDemoData);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [authUser, setAuthUser] = useState<AuthIdentity | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [sync, setSync] = useState<SyncState>("connecting");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [deviceUid, setDeviceUid] = useState("");
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [deviceRole, setDeviceRole] = useState<DeviceRole>(() => localStorage.getItem("living-current-device-role") === "partner" ? "partner" : "primary");
  const store = useRef<DataStore | null>(null);

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
      onData: (next) => active && setData(next),
      onSync: (state) => {
        if (!active) return;
        setSync(state);
        if (state === "synced") setLastSyncAt(new Date());
      },
      onIdentity: (uid) => active && setDeviceUid(uid),
    }).then(async (result) => {
      if (!active) return;
      store.current = result;
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
    setData((current) => {
      const next = { ...updater(current), updatedAt: new Date().toISOString() };
      void store.current?.save(next);
      return next;
    });
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
    updateData((current) => ({ ...current, transactions: [transaction, ...current.transactions] }), transactionKind(transaction) === "transfer" ? "Transfer recorded" : "Transaction added");
    setTransactionOpen(false);
  };

  const addBill = (bill: Bill) => {
    updateData((current) => ({ ...current, bills: [...current.bills, bill].sort((a, b) => a.dueDate.localeCompare(b.dueDate)) }), "Bill added");
    setBillOpen(false);
  };

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
          <NavButton active={view === "activity"} icon={<ReceiptText />} label="Activity" onClick={() => navigate("activity")} />
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

      <main className="main-panel">
        <header className="topbar">
          <button className="menu-button" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu /></button>
          <div className="page-heading">
            <span>{longDate.format(new Date())}</span>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Notifications"><Bell /></button>
            <button className="primary-button" onClick={() => setTransactionOpen(true)}><Plus /> <span>Add transaction</span></button>
          </div>
        </header>

        {view === "overview" && <Overview data={data} totals={totals} onNavigate={navigate} onAdd={() => setTransactionOpen(true)} onToggleBill={(id) => updateData((current) => ({ ...current, bills: current.bills.map((bill) => bill.id === id ? { ...bill, paid: !bill.paid } : bill) }), "Bill updated")} />}
        {view === "activity" && <Activity data={data} onDelete={(id) => updateData((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== id) }), "Transaction removed")} />}
        {view === "archive" && <ArchiveView data={data} />}
        {view === "bills" && <Bills data={data} onAdd={() => setBillOpen(true)} onToggle={(id) => updateData((current) => ({ ...current, bills: current.bills.map((bill) => bill.id === id ? { ...bill, paid: !bill.paid } : bill) }), "Bill updated")} />}
        {view === "import" && <ImportExport data={data} enteredBy={deviceRole === "primary" ? data.displayName : data.partnerName} onImport={(transactions) => updateData((current) => ({ ...current, transactions: mergeImportedTransactions(current.transactions, transactions) }), `${transactions.length} transactions reviewed for import`)} />}
        {view === "sync" && <SyncView data={data} sync={sync} email={authUser?.email || ""} lastSyncAt={lastSyncAt} onRefresh={refreshCloud} />}
        {view === "settings" && <SettingsView data={data} sync={sync} email={authUser?.email || ""} uid={deviceUid} deviceRole={deviceRole} onDeviceRoleChange={(role) => { localStorage.setItem("living-current-device-role", role); setDeviceRole(role); setToast("This device identity was updated"); }} onSignOut={() => void signOutOfHousehold()} onSave={(values) => updateData((current) => ({ ...current, ...values }), "Settings saved")} />}
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        <NavButton active={view === "overview"} icon={<Home />} label="Home" onClick={() => navigate("overview")} />
        <NavButton active={view === "activity"} icon={<ReceiptText />} label="Activity" onClick={() => navigate("activity")} />
        <button className="bottom-add" aria-label="Add transaction" onClick={() => setTransactionOpen(true)}><Plus /></button>
        <NavButton active={view === "bills"} icon={<CalendarDays />} label="Bills" onClick={() => navigate("bills")} />
        <NavButton active={view === "settings"} icon={<Settings />} label="Settings" onClick={() => navigate("settings")} />
      </nav>

      {transactionOpen && <TransactionDialog name={deviceRole === "primary" ? data.displayName : data.partnerName} onClose={() => setTransactionOpen(false)} onSave={addTransaction} />}
      {billOpen && <BillDialog onClose={() => setBillOpen(false)} onSave={addBill} />}
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
      <div className="loading-coin" aria-hidden="true"><BrandMark /></div>
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

function Overview({ data, totals, onNavigate, onAdd, onToggleBill }: { data: HouseholdData; totals: { income: number; spending: number; reserved: number; current: number; available: number; checking: number; savings: number }; onNavigate: (view: View) => void; onAdd: () => void; onToggleBill: (id: string) => void }) {
  const currentTransactions = data.transactions.filter((item) => monthKey(item.date) === monthKey());
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
        <div className="balance-actions"><button onClick={onAdd}><Plus /> Record movement</button><span><CloudCheck /> Updated moments ago</span></div>
        <div className="balance-breakdown">
          <Metric label="Bill planning" value={totals.reserved} />
          <Metric label="Income recorded" value={totals.income} tone="positive" />
          <Metric label="Spending recorded" value={-totals.spending} tone="negative" />
          <Metric label="Checking balance" value={totals.checking} />
          <Metric label="Savings balance" value={totals.savings} />
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel flow-panel">
          <PanelHeader eyebrow={monthLabel(monthKey()).toUpperCase()} title="Household current" action="View activity" onAction={() => onNavigate("activity")} />
          <div className="flow-summary"><div><ArrowUpRight /><span>Income</span><strong>{currency.format(totals.income)}</strong></div><div><ArrowDownLeft /><span>Outflow</span><strong>{currency.format(totals.spending)}</strong></div></div>
          <div className="flow-chart" aria-label="Decorative view of recent cash flow">
            {[38, 64, 46, 78, 57, 84, 62, 92, 69, 76, 54, 88].map((height, index) => <i key={index} style={{ height: `${height}%` }} className={index === 9 ? "active" : ""} />)}
            <span className="flow-line" />
          </div>
          <div className="chart-axis"><span>Week 1</span><span>Week 2</span><span>Week 3</span><span>Now</span></div>
        </section>

        <section className="panel bills-panel">
          <PanelHeader eyebrow="NEXT 14 DAYS" title="Bills approaching" action="All bills" onAction={() => onNavigate("bills")} />
          <div className="bill-list">
            {upcoming.map((bill) => <BillRow key={bill.id} bill={bill} onToggle={onToggleBill} />)}
            {!upcoming.length && <EmptyState icon={<Check />} title="You’re current" copy="No unpaid bills are approaching." />}
          </div>
        </section>

        <section className="panel transactions-panel">
          <PanelHeader eyebrow="LATEST ENTRIES" title="Recent activity" action="See all" onAction={() => onNavigate("activity")} />
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

function Activity({ data, onDelete }: { data: HouseholdData; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const current = data.transactions.filter((item) => monthKey(item.date) === monthKey());
  const visible = current.filter((item) => `${item.description} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page-content">
      <section className="section-intro"><div><span>{monthLabel(monthKey()).toUpperCase()}</span><h2>This month’s activity.</h2><p>{current.length} entries shared across your household. Earlier months are in Monthly archive.</p></div><label className="search-field"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity" /></label></section>
      <section className="panel ledger-panel">
        <div className="ledger-head"><span>Description</span><span>Category</span><span>Entered by</span><span>Date</span><span>Amount</span><span /></div>
        {visible.map((item) => <LedgerRow key={item.id} item={item} onDelete={onDelete} />)}
        {!visible.length && <EmptyState icon={<Search />} title="No entries found" copy="Try a different search." />}
      </section>
    </div>
  );
}

function ArchiveView({ data }: { data: HouseholdData }) {
  const months = useMemo(() => [...new Set(data.transactions.map((item) => monthKey(item.date)).filter((key) => key < monthKey()))].sort().reverse(), [data.transactions]);
  const [selected, setSelected] = useState(months[0] || "");
  const selectedMonth = months.includes(selected) ? selected : months[0] || "";
  const transactions = data.transactions.filter((item) => monthKey(item.date) === selectedMonth);
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
          <div><span>NET ACTIVITY</span><strong className={income - spending >= 0 ? "amount-positive" : "amount-negative"}>{currency.format(income - spending)}</strong></div>
        </section>
        <section className="panel ledger-panel archive-ledger"><div className="ledger-head"><span>Description</span><span>Category</span><span>Entered by</span><span>Date</span><span>Amount</span><span /></div>{transactions.map((item) => <LedgerRow key={item.id} item={item} />)}</section>
      </>}
    </div>
  );
}

function Bills({ data, onAdd, onToggle }: { data: HouseholdData; onAdd: () => void; onToggle: (id: string) => void }) {
  const unpaid = data.bills.filter(plannedBill).reduce((sum, bill) => sum + bill.amount, 0);
  return (
    <div className="page-content">
      <section className="section-intro"><div><span>BILL PLANNING</span><h2>Know what the current carries next.</h2><p>{currency.format(unpaid)} planned across {data.bills.filter(plannedBill).length} unpaid bills due within 31 days. This amount reduces Available Balance without moving money from either account.</p></div><button className="primary-button" onClick={onAdd}><Plus /> Add bill</button></section>
      <div className="bill-card-grid">{data.bills.map((bill) => <article className={`bill-card ${bill.paid ? "is-paid" : ""}`} key={bill.id}><div className="bill-card-top"><div className="bill-emblem"><ReceiptText /></div><span>{bill.recurrence}</span></div><small>{bill.category}</small><h3>{bill.name}</h3><strong>{currency.format(bill.amount)}</strong><div className="bill-card-foot"><div><span>{bill.paid ? "Paid" : daysUntil(bill.dueDate) < 0 ? "Overdue" : `Due in ${daysUntil(bill.dueDate)} days`}</span><small>{shortDate.format(new Date(`${bill.dueDate}T12:00:00`))}</small></div><button onClick={() => onToggle(bill.id)}>{bill.paid ? "Mark unpaid" : "Mark paid"}</button></div></article>)}</div>
    </div>
  );
}

function ImportExport({ data, enteredBy, onImport }: { data: HouseholdData; enteredBy: string; onImport: (transactions: Transaction[]) => void }) {
  const [pastedImport, setPastedImport] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const download = (kind: "json" | "csv") => {
    const content = kind === "json"
      ? JSON.stringify({ schemaVersion: 3, transactions: data.transactions }, null, 2)
      : ["date,description,category,amount,type,account,transferTo,enteredBy", ...data.transactions.map((item) => [item.date, csvEscape(item.description), csvEscape(item.category), item.amount, transactionKind(item), transactionAccount(item), item.transferTo || "", csvEscape(item.enteredBy)].join(","))].join("\n");
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

function SettingsView({ data, sync, email, uid, deviceRole, onDeviceRoleChange, onSave, onSignOut }: { data: HouseholdData; sync: SyncState; email: string; uid: string; deviceRole: DeviceRole; onDeviceRoleChange: (role: DeviceRole) => void; onSave: (values: Partial<HouseholdData>) => void; onSignOut: () => void }) {
  const [checkingBalance, setCheckingBalance] = useState(String(data.checkingStartingBalance));
  const [savingsBalance, setSavingsBalance] = useState(String(data.savingsStartingBalance));
  const [safetyBuffer, setSafetyBuffer] = useState(String(data.safetyBuffer));
  const [displayName, setDisplayName] = useState(data.displayName);
  const [partnerName, setPartnerName] = useState(data.partnerName);
  return (
    <div className="page-content settings-page">
      <section className="section-intro"><div><span>HOUSEHOLD SETTINGS</span><h2>Shape the view you share.</h2><p>These values affect both enrolled devices.</p></div></section>
      <div className="settings-grid">
        <form className="panel settings-form" onSubmit={(event) => { event.preventDefault(); onSave({ checkingStartingBalance: Number(checkingBalance), savingsStartingBalance: Number(savingsBalance), safetyBuffer: Number(safetyBuffer), displayName, partnerName }); }}><h3>Household details</h3><label>Your display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Partner display name<input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} /></label><div className="form-row"><label>{monthLabel(data.balanceStartMonth)} opening checking<input inputMode="decimal" value={checkingBalance} onChange={(event) => setCheckingBalance(event.target.value)} /></label><label>{monthLabel(data.balanceStartMonth)} opening savings<input inputMode="decimal" value={savingsBalance} onChange={(event) => setSavingsBalance(event.target.value)} /></label></div><p className="settings-note">Current balances are calculated from these opening amounts plus every transaction recorded from {monthLabel(data.balanceStartMonth)} onward.</p><label>Safety buffer<input inputMode="decimal" value={safetyBuffer} onChange={(event) => setSafetyBuffer(event.target.value)} /></label><button className="primary-button" type="submit">Save household changes</button></form>
        <section className="panel settings-form device-identity"><h3>This device</h3><p>Choose who normally enters transactions on this phone or computer. This preference stays on this device, so the shared account can tell you apart.</p><div className="identity-toggle"><button type="button" className={deviceRole === "primary" ? "active" : ""} onClick={() => onDeviceRoleChange("primary")}><span>{displayName || "Primary"}</span><small>Use on this device</small></button><button type="button" className={deviceRole === "partner" ? "active" : ""} onClick={() => onDeviceRoleChange("partner")}><span>{partnerName || "Partner"}</span><small>Use on this device</small></button></div></section>
        <section className="panel connection-panel"><div className="connection-icon"><CloudCheck /></div><span>SYNC STATUS</span><h3>{syncLabel(sync)}</h3><p>{firebaseConfigured ? "Both devices can use the same household email and password. Firebase keeps the shared record synchronized." : "Add the Firebase values from .env.example to enable real-time household cloud save."}</p><dl><div><dt>Household</dt><dd>{householdId}</dd></div><div><dt>Signed in as</dt><dd>{email || uid || "Local preview"}</dd></div><div><dt>Storage</dt><dd>{firebaseConfigured ? "Cloud Firestore" : "Local preview"}</dd></div></dl>{firebaseConfigured && <button className="signout-button" type="button" onClick={onSignOut}><LogOut /> Sign out on this device</button>}</section>
      </div>
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

function TransactionDialog({ name, onClose, onSave }: { name: string; onClose: () => void; onSave: (transaction: Transaction) => void }) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Groceries");
  const [customCategory, setCustomCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [account, setAccount] = useState<AccountName>("checking");
  const [transferTo, setTransferTo] = useState<AccountName>("savings");
  const chooseAccount = (next: AccountName) => { setAccount(next); if (transferTo === next) setTransferTo(next === "checking" ? "savings" : "checking"); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Math.abs(Number(amount));
    const finalCategory = kind === "transfer" ? "Transfer" : category === "Custom" ? customCategory.trim() : category;
    if (!description.trim() || !value || !finalCategory || (kind === "transfer" && account === transferTo)) return;
    onSave({ id: makeId(), date, description: description.trim(), category: finalCategory, amount: kind === "expense" ? -value : value, type: kind, account, transferTo: kind === "transfer" ? transferTo : undefined, affectsBalance: true, status: "pending", enteredBy: name || "Household", createdAt: new Date().toISOString() });
  };
  return <Modal title="Record a movement" onClose={onClose}><form className="entry-form" onSubmit={submit}>
    <div className="type-toggle type-toggle-three"><button type="button" className={kind === "expense" ? "active" : ""} onClick={() => setKind("expense")}><ArrowUpRight /> Expense</button><button type="button" className={kind === "income" ? "active" : ""} onClick={() => setKind("income")}><ArrowDownLeft /> Income</button><button type="button" className={kind === "transfer" ? "active" : ""} onClick={() => setKind("transfer")}><ArrowRightLeft /> Transfer</button></div>
    <label>Description<input autoFocus value={description} onChange={(event) => setDescription(event.target.value)} placeholder={kind === "transfer" ? "Move rent funds" : "Publix"} required /></label>
    {kind === "transfer" ? <div className="form-row"><label>From<select value={account} onChange={(event) => chooseAccount(event.target.value as AccountName)}><option value="checking">Checking</option><option value="savings">Savings</option></select></label><label>To<select value={transferTo} onChange={(event) => setTransferTo(event.target.value as AccountName)}><option value="checking" disabled={account === "checking"}>Checking</option><option value="savings" disabled={account === "savings"}>Savings</option></select></label></div> : <div className="form-row"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Account<select value={account} onChange={(event) => setAccount(event.target.value as AccountName)}><option value="checking">Checking</option><option value="savings">Savings</option></select></label></div>}
    {category === "Custom" && kind !== "transfer" && <label>Custom category name<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Pet care" required /></label>}
    <div className="form-row"><label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label></div>
    <p className="entry-attribution">This entry will be recorded by <strong>{name || "Household"}</strong>.</p>
    <button className="primary-button submit-button" type="submit">{kind === "transfer" ? "Record transfer" : "Add to household"}</button>
  </form></Modal>;
}

function BillDialog({ onClose, onSave }: { onClose: () => void; onSave: (bill: Bill) => void }) {
  const [name, setName] = useState(""); const [category, setCategory] = useState("Utilities"); const [customCategory, setCustomCategory] = useState(""); const [amount, setAmount] = useState(""); const [date, setDate] = useState(todayISO()); const [recurrence, setRecurrence] = useState<Bill["recurrence"]>("monthly");
  const submit = (event: FormEvent) => { event.preventDefault(); const finalCategory = category === "Custom" ? customCategory.trim() : category; if (!name.trim() || !Number(amount) || !finalCategory) return; onSave({ id: makeId(), name: name.trim(), category: finalCategory, amount: Math.abs(Number(amount)), dueDate: date, recurrence, paid: false }); };
  return <Modal title="Add an upcoming bill" onClose={onClose}><form className="entry-form" onSubmit={submit}><label>Bill name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Electric" required /></label><div className="form-row"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.filter((item) => !item.toLowerCase().includes("income") && item !== "Salary").map((item) => <option key={item}>{item}</option>)}</select></label><label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label></div>{category === "Custom" && <label>Custom category name<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Pet care" required /></label>}<div className="form-row"><label>Due date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label>Repeats<select value={recurrence} onChange={(event) => setRecurrence(event.target.value as Bill["recurrence"])}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option><option value="once">One time</option></select></label></div><button className="primary-button submit-button" type="submit">Reserve this bill</button></form></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><span>HOUSEHOLD ENTRY</span><h2 id="modal-title">{title}</h2></div><button aria-label="Close" onClick={onClose}><X /></button></header>{children}</section></div>; }
function BrandMark() { return <div className="brand-mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}coin.svg`} alt="" /></div>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>; }
function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) { const displayValue = Math.abs(value) < .005 ? 0 : value; return <div><span>{label}</span><strong className={tone ? `amount-${tone}` : ""}>{displayValue > 0 && tone === "positive" ? "+" : ""}{currency.format(displayValue)}</strong></div>; }
function PanelHeader({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><div><span>{eyebrow}</span><h3>{title}</h3></div>{action && <button onClick={onAction}>{action}<ChevronRight /></button>}</header>; }
function TransactionRow({ item }: { item: Transaction }) { const kind = transactionKind(item); const tone = kind === "transfer" ? "" : item.amount > 0 ? "amount-positive" : "amount-negative"; return <div className="transaction-row"><div className={`transaction-icon ${kind}`}>{kind === "transfer" ? <ArrowRightLeft /> : kind === "income" ? <ArrowDownLeft /> : <ArrowUpRight />}</div><div><strong>{item.description}{item.status === "pending" && <small className="pending-badge">Pending</small>}</strong><span>{kind === "transfer" ? `${accountLabel(transactionAccount(item))} to ${accountLabel(item.transferTo || "savings")}` : `${item.category} · ${accountLabel(transactionAccount(item))}`} · {item.enteredBy}</span></div><time>{shortDate.format(new Date(`${item.date}T12:00:00`))}</time><b className={tone}>{item.amount > 0 && kind !== "transfer" ? "+" : ""}{currency.format(item.amount)}</b></div>; }
function LedgerRow({ item, onDelete }: { item: Transaction; onDelete?: (id: string) => void }) { const kind = transactionKind(item); const tone = kind === "transfer" ? "" : item.amount > 0 ? "amount-positive" : "amount-negative"; return <div className="ledger-row"><div className={`transaction-icon ${kind}`}>{kind === "transfer" ? <ArrowRightLeft /> : kind === "income" ? <ArrowDownLeft /> : <ArrowUpRight />}</div><strong>{item.description}{item.status === "pending" && <small className="pending-badge">Pending</small>}</strong><span>{kind === "transfer" ? `${accountLabel(transactionAccount(item))} → ${accountLabel(item.transferTo || "savings")}` : item.category}</span><span>{item.enteredBy}</span><span>{shortDate.format(new Date(`${item.date}T12:00:00`))}</span><b className={tone}>{item.amount > 0 && kind !== "transfer" ? "+" : ""}{currency.format(item.amount)}</b>{onDelete ? <button aria-label={`Delete ${item.description}`} onClick={() => onDelete(item.id)}><Trash2 /></button> : <span className="ledger-spacer" />}</div>; }
function BillRow({ bill, onToggle }: { bill: Bill; onToggle: (id: string) => void }) { const days = daysUntil(bill.dueDate); return <div className="bill-row"><button className="bill-check" aria-label={`Mark ${bill.name} paid`} onClick={() => onToggle(bill.id)}><Check /></button><div><strong>{bill.name}</strong><span>{bill.category} · {days < 0 ? `${Math.abs(days)} days overdue` : `Due in ${days} days`}</span></div><b>{currency.format(bill.amount)}</b></div>; }
function EmptyState({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) { return <div className="empty-state">{icon}<strong>{title}</strong><span>{copy}</span></div>; }
function accountLabel(account: AccountName) { return account === "checking" ? "Checking" : "Savings"; }
function viewTitle(view: View) { return view === "overview" ? greeting() : ({ activity: "Household activity", archive: "Monthly archive", bills: "Upcoming bills", import: "Import & export", sync: "Cloud sync", settings: "Settings" } as const)[view]; }
function syncLabel(sync: SyncState) { return ({ local: "Local preview", connecting: "Connecting", synced: "Cloud save active", "needs-setup": "Enrollment needed", offline: "Working offline" } as const)[sync]; }
function csvEscape(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function parseJson(text: string, enteredBy: string): Transaction[] { const parsed = JSON.parse(text); const rows = Array.isArray(parsed) ? parsed : parsed.transactions; if (!Array.isArray(rows)) throw new Error("JSON must contain a transactions array."); return rows.map((row) => normalizeImport(row, enteredBy, "JSON import")).filter(Boolean) as Transaction[]; }
function parseCsv(text: string, enteredBy: string, source = "CSV import"): Transaction[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => { const cells = splitCsv(line).map((value) => value.trim().toLowerCase().replace(/\.$/, "")); return cells.includes("date") && cells.includes("description") && cells.includes("amount"); });
  if (headerIndex < 0) return [];
  const headers = splitCsv(lines[headerIndex]).map((value) => value.trim().toLowerCase().replace(/\.$/, ""));
  return lines.slice(headerIndex + 1).map((line) => { const values = splitCsv(line); const row = Object.fromEntries(headers.map((header, index) => [header, values[index]])); return normalizeImport(row, enteredBy, source); }).filter(Boolean) as Transaction[];
}
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
  return { id: `import-${simpleHash(fingerprint)}`, date, description: cleanBankDescription(description), category: String(row.category || categorize(description, type)), amount: normalizedAmount, type, account, transferTo, affectsBalance: false, status: String(row.status || "posted").toLowerCase() === "pending" ? "pending" : "posted", enteredBy: String(row.enteredBy || row.enteredby || enteredBy), createdAt: new Date().toISOString(), importSource: source };
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
