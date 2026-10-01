import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
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
import type { Bill, HouseholdData, SyncState, Transaction } from "./types";

type View = "overview" | "activity" | "bills" | "import" | "settings";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const categories = ["Groceries", "Dining", "Housing", "Utilities", "Cell Phone & Internet", "Transportation", "Insurance", "Health", "Household", "Salary", "Additional Income", "Other", "Custom"];

const todayISO = () => new Date().toISOString().slice(0, 10);
const makeId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const daysUntil = (date: string) => Math.ceil((new Date(`${date}T12:00:00`).getTime() - new Date(`${todayISO()}T12:00:00`).getTime()) / 86_400_000);

function App() {
  const [data, setData] = useState<HouseholdData>(createDemoData);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [sync, setSync] = useState<SyncState>("connecting");
  const [deviceUid, setDeviceUid] = useState("");
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const store = useRef<DataStore | null>(null);

  useEffect(() => observeHouseholdAuth((user) => {
    setAuthUser(user);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!authReady || (firebaseConfigured && (!authUser || authUser.isAnonymous))) return;
    let active = true;
    setStoreReady(false);
    setSync("connecting");
    createDataStore({
      onData: (next) => active && setData(next),
      onSync: (state) => active && setSync(state),
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
  }, [authReady, authUser?.uid]);

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
    const income = data.transactions.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
    const spending = Math.abs(data.transactions.filter((item) => item.amount < 0).reduce((sum, item) => sum + item.amount, 0));
    const reserved = data.bills.filter((bill) => !bill.paid).reduce((sum, bill) => sum + bill.amount, 0);
    const current = data.startingBalance + income - spending;
    const available = current - reserved - data.safetyBuffer;
    return { income, spending, reserved, current, available };
  }, [data]);

  const addTransaction = (transaction: Transaction) => {
    updateData((current) => ({ ...current, transactions: [transaction, ...current.transactions] }), "Transaction added");
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

  if (loading) return <LoadingScreen ready={authReady} onContinue={() => setLoading(false)} />;

  if (firebaseConfigured && (!authUser || authUser.isAnonymous)) return <AuthScreen hasAnonymousHousehold={Boolean(authUser?.isAnonymous)} />;

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
          <NavButton active={view === "bills"} icon={<CalendarDays />} label="Bills" onClick={() => navigate("bills")} />
          <NavButton active={view === "import"} icon={<Upload />} label="Import & export" onClick={() => navigate("import")} />
        </nav>
        <div className="sidebar-spacer" />
        <div className={`sync-card sync-${sync}`}>
          {sync === "synced" ? <CloudCheck /> : <Cloud />}
          <div><strong>{syncLabel(sync)}</strong><span>{firebaseConfigured ? "Firebase household" : "This device only"}</span></div>
        </div>
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
        {view === "bills" && <Bills data={data} onAdd={() => setBillOpen(true)} onToggle={(id) => updateData((current) => ({ ...current, bills: current.bills.map((bill) => bill.id === id ? { ...bill, paid: !bill.paid } : bill) }), "Bill updated")} />}
        {view === "import" && <ImportExport data={data} onImport={(transactions) => updateData((current) => ({ ...current, transactions: [...transactions, ...current.transactions] }), `${transactions.length} transactions imported`)} />}
        {view === "settings" && <SettingsView data={data} sync={sync} email={authUser?.email || ""} uid={deviceUid} onSignOut={() => void signOutOfHousehold()} onSave={(values) => updateData((current) => ({ ...current, ...values }), "Settings saved")} />}
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        <NavButton active={view === "overview"} icon={<Home />} label="Home" onClick={() => navigate("overview")} />
        <NavButton active={view === "activity"} icon={<ReceiptText />} label="Activity" onClick={() => navigate("activity")} />
        <button className="bottom-add" aria-label="Add transaction" onClick={() => setTransactionOpen(true)}><Plus /></button>
        <NavButton active={view === "bills"} icon={<CalendarDays />} label="Bills" onClick={() => navigate("bills")} />
        <NavButton active={view === "settings"} icon={<Settings />} label="Settings" onClick={() => navigate("settings")} />
      </nav>

      {transactionOpen && <TransactionDialog name={data.displayName} onClose={() => setTransactionOpen(false)} onSave={addTransaction} />}
      {billOpen && <BillDialog onClose={() => setBillOpen(false)} onSave={addBill} />}
      {toast && <div className="toast" role="status"><Check /> {toast}</div>}
    </div>
  );
}

function AuthScreen({ hasAnonymousHousehold }: { hasAnonymousHousehold: boolean }) {
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
      if (mode === "create") await createHouseholdAccount(email, password);
      else await signInToHousehold(email, password);
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
      <div className="loading-contours" aria-hidden="true"><i /><i /><i /><i /><i /><span /></div>
      <div className="loading-brand"><BrandMark /><strong>LIVING CURRENT</strong><span>A shared view of what’s ahead.</span></div>
      <div className="loading-orb" aria-hidden="true"><b>LC</b><span /></div>
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

function Overview({ data, totals, onNavigate, onAdd, onToggleBill }: { data: HouseholdData; totals: { income: number; spending: number; reserved: number; current: number; available: number }; onNavigate: (view: View) => void; onAdd: () => void; onToggleBill: (id: string) => void }) {
  const recent = data.transactions.slice(0, 5);
  const upcoming = data.bills.filter((bill) => !bill.paid).slice(0, 3);
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    data.transactions.filter((item) => item.amount < 0).forEach((item) => map.set(item.category, (map.get(item.category) || 0) + Math.abs(item.amount)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [data.transactions]);
  const totalCategorySpend = categoryTotals.reduce((sum, [, amount]) => sum + amount, 0) || 1;

  return (
    <div className="page-content overview-page">
      <section className="balance-hero">
        <div className="hero-current" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="balance-copy"><span>AVAILABLE TO SPEND</span><strong className={totals.available < 0 ? "negative" : ""}>{currency.format(totals.available)}</strong><p>After upcoming bills and your {currency.format(data.safetyBuffer)} safety buffer.</p></div>
        <div className="balance-actions"><button onClick={onAdd}><Plus /> Record movement</button><span><CloudCheck /> Updated moments ago</span></div>
        <div className="balance-breakdown">
          <Metric label="Current balance" value={totals.current} />
          <Metric label="Income recorded" value={totals.income} tone="positive" />
          <Metric label="Spending recorded" value={-totals.spending} tone="negative" />
          <Metric label="Bills reserved" value={-totals.reserved} />
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel flow-panel">
          <PanelHeader eyebrow="THIS MONTH" title="Household current" action="View activity" onAction={() => onNavigate("activity")} />
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
  const visible = data.transactions.filter((item) => `${item.description} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page-content">
      <section className="section-intro"><div><span>SHARED LEDGER</span><h2>Every movement, in one current.</h2><p>{data.transactions.length} entries shared across your household.</p></div><label className="search-field"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity" /></label></section>
      <section className="panel ledger-panel">
        <div className="ledger-head"><span>Description</span><span>Category</span><span>Entered by</span><span>Date</span><span>Amount</span><span /></div>
        {visible.map((item) => <div className="ledger-row" key={item.id}><div className={`transaction-icon ${item.amount > 0 ? "income" : "expense"}`}>{item.amount > 0 ? <ArrowDownLeft /> : <ArrowUpRight />}</div><strong>{item.description}</strong><span>{item.category}</span><span>{item.enteredBy}</span><span>{shortDate.format(new Date(`${item.date}T12:00:00`))}</span><b className={item.amount > 0 ? "amount-positive" : "amount-negative"}>{item.amount > 0 ? "+" : ""}{currency.format(item.amount)}</b><button aria-label={`Delete ${item.description}`} onClick={() => onDelete(item.id)}><Trash2 /></button></div>)}
        {!visible.length && <EmptyState icon={<Search />} title="No entries found" copy="Try a different search." />}
      </section>
    </div>
  );
}

function Bills({ data, onAdd, onToggle }: { data: HouseholdData; onAdd: () => void; onToggle: (id: string) => void }) {
  const unpaid = data.bills.filter((bill) => !bill.paid).reduce((sum, bill) => sum + bill.amount, 0);
  return (
    <div className="page-content">
      <section className="section-intro"><div><span>UPCOMING COMMITMENTS</span><h2>Know what the current carries next.</h2><p>{currency.format(unpaid)} reserved across {data.bills.filter((bill) => !bill.paid).length} unpaid bills.</p></div><button className="primary-button" onClick={onAdd}><Plus /> Add bill</button></section>
      <div className="bill-card-grid">{data.bills.map((bill) => <article className={`bill-card ${bill.paid ? "is-paid" : ""}`} key={bill.id}><div className="bill-card-top"><div className="bill-emblem"><ReceiptText /></div><span>{bill.recurrence}</span></div><small>{bill.category}</small><h3>{bill.name}</h3><strong>{currency.format(bill.amount)}</strong><div className="bill-card-foot"><div><span>{bill.paid ? "Paid" : daysUntil(bill.dueDate) < 0 ? "Overdue" : `Due in ${daysUntil(bill.dueDate)} days`}</span><small>{shortDate.format(new Date(`${bill.dueDate}T12:00:00`))}</small></div><button onClick={() => onToggle(bill.id)}>{bill.paid ? "Mark unpaid" : "Mark paid"}</button></div></article>)}</div>
    </div>
  );
}

function ImportExport({ data, onImport }: { data: HouseholdData; onImport: (transactions: Transaction[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const download = (kind: "json" | "csv") => {
    const content = kind === "json"
      ? JSON.stringify({ schemaVersion: 1, transactions: data.transactions }, null, 2)
      : ["date,description,category,amount,enteredBy", ...data.transactions.map((item) => [item.date, csvEscape(item.description), csvEscape(item.category), item.amount, csvEscape(item.enteredBy)].join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: kind === "json" ? "application/json" : "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `living-current-${todayISO()}.${kind}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const parsed = file.name.toLowerCase().endsWith(".json") ? parseJson(text, data.displayName) : parseCsv(text, data.displayName);
      if (!parsed.length) throw new Error("No valid transactions were found.");
      onImport(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This file could not be imported.");
    }
  };

  return (
    <div className="page-content import-page">
      <section className="section-intro"><div><span>PORTABLE BY DESIGN</span><h2>Your records stay useful anywhere.</h2><p>Bring in clean transaction files or keep an independent household backup.</p></div></section>
      <div className="import-grid">
        <section className="panel upload-panel"><div className="upload-art"><Upload /></div><span>CSV OR JSON</span><h3>Import transactions</h3><p>Choose a bank export you’ve simplified or a Living Current backup. Nothing is committed until the file passes validation.</p><button className="primary-button" onClick={() => inputRef.current?.click()}><Upload /> Choose file</button><input ref={inputRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />{error && <div className="form-error" role="alert">{error}</div>}</section>
        <section className="panel export-panel"><div className="export-heading"><Download /><div><span>CURRENT BACKUP</span><h3>{data.transactions.length} transactions ready</h3></div></div><p>Export a full copy before major imports or use the template with ChatGPT to prepare new records.</p><button onClick={() => download("csv")}><FileSpreadsheet /> Download CSV</button><button onClick={() => download("json")}><FileJson /> Download JSON</button><div className="privacy-note"><ShieldCheck /><span><strong>No bank credentials</strong>Your file contains only the descriptions, categories, dates, and amounts you entered.</span></div></section>
      </div>
    </div>
  );
}

function SettingsView({ data, sync, email, uid, onSave, onSignOut }: { data: HouseholdData; sync: SyncState; email: string; uid: string; onSave: (values: Partial<HouseholdData>) => void; onSignOut: () => void }) {
  const [startingBalance, setStartingBalance] = useState(String(data.startingBalance));
  const [safetyBuffer, setSafetyBuffer] = useState(String(data.safetyBuffer));
  const [displayName, setDisplayName] = useState(data.displayName);
  const [partnerName, setPartnerName] = useState(data.partnerName);
  return (
    <div className="page-content settings-page">
      <section className="section-intro"><div><span>HOUSEHOLD SETTINGS</span><h2>Shape the view you share.</h2><p>These values affect both enrolled devices.</p></div></section>
      <div className="settings-grid">
        <form className="panel settings-form" onSubmit={(event) => { event.preventDefault(); onSave({ startingBalance: Number(startingBalance), safetyBuffer: Number(safetyBuffer), displayName, partnerName }); }}><h3>Household details</h3><label>Your display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Partner display name<input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} /></label><label>Starting balance<input inputMode="decimal" value={startingBalance} onChange={(event) => setStartingBalance(event.target.value)} /></label><label>Safety buffer<input inputMode="decimal" value={safetyBuffer} onChange={(event) => setSafetyBuffer(event.target.value)} /></label><button className="primary-button" type="submit">Save changes</button></form>
        <section className="panel connection-panel"><div className="connection-icon"><CloudCheck /></div><span>SYNC STATUS</span><h3>{syncLabel(sync)}</h3><p>{firebaseConfigured ? "Both devices can use the same household email and password. Firebase keeps the shared record synchronized." : "Add the Firebase values from .env.example to enable real-time household cloud save."}</p><dl><div><dt>Household</dt><dd>{householdId}</dd></div><div><dt>Signed in as</dt><dd>{email || uid || "Local preview"}</dd></div><div><dt>Storage</dt><dd>{firebaseConfigured ? "Cloud Firestore" : "Local preview"}</dd></div></dl>{firebaseConfigured && <button className="signout-button" type="button" onClick={onSignOut}><LogOut /> Sign out on this device</button>}</section>
      </div>
    </div>
  );
}

function TransactionDialog({ name, onClose, onSave }: { name: string; onClose: () => void; onSave: (transaction: Transaction) => void }) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Groceries");
  const [customCategory, setCustomCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const submit = (event: FormEvent) => { event.preventDefault(); const value = Math.abs(Number(amount)); const finalCategory = category === "Custom" ? customCategory.trim() : category; if (!description.trim() || !value || !finalCategory) return; onSave({ id: makeId(), date, description: description.trim(), category: finalCategory, amount: kind === "expense" ? -value : value, enteredBy: name || "Household", createdAt: new Date().toISOString() }); };
  return <Modal title="Record a movement" onClose={onClose}><form className="entry-form" onSubmit={submit}><div className="type-toggle"><button type="button" className={kind === "expense" ? "active" : ""} onClick={() => setKind("expense")}><ArrowUpRight /> Expense</button><button type="button" className={kind === "income" ? "active" : ""} onClick={() => setKind("income")}><ArrowDownLeft /> Income</button></div><label>Description<input autoFocus value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Publix" required /></label><div className="form-row"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label></div>{category === "Custom" && <label>Custom category name<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Pet care" required /></label>}<label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><button className="primary-button submit-button" type="submit">Add to household</button></form></Modal>;
}

function BillDialog({ onClose, onSave }: { onClose: () => void; onSave: (bill: Bill) => void }) {
  const [name, setName] = useState(""); const [category, setCategory] = useState("Utilities"); const [customCategory, setCustomCategory] = useState(""); const [amount, setAmount] = useState(""); const [date, setDate] = useState(todayISO()); const [recurrence, setRecurrence] = useState<Bill["recurrence"]>("monthly");
  const submit = (event: FormEvent) => { event.preventDefault(); const finalCategory = category === "Custom" ? customCategory.trim() : category; if (!name.trim() || !Number(amount) || !finalCategory) return; onSave({ id: makeId(), name: name.trim(), category: finalCategory, amount: Math.abs(Number(amount)), dueDate: date, recurrence, paid: false }); };
  return <Modal title="Add an upcoming bill" onClose={onClose}><form className="entry-form" onSubmit={submit}><label>Bill name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Electric" required /></label><div className="form-row"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.filter((item) => !item.toLowerCase().includes("income") && item !== "Salary").map((item) => <option key={item}>{item}</option>)}</select></label><label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label></div>{category === "Custom" && <label>Custom category name<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Pet care" required /></label>}<div className="form-row"><label>Due date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label>Repeats<select value={recurrence} onChange={(event) => setRecurrence(event.target.value as Bill["recurrence"])}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option><option value="once">One time</option></select></label></div><button className="primary-button submit-button" type="submit">Reserve this bill</button></form></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><span>HOUSEHOLD ENTRY</span><h2 id="modal-title">{title}</h2></div><button aria-label="Close" onClick={onClose}><X /></button></header>{children}</section></div>; }
function BrandMark() { return <div className="brand-mark" aria-hidden="true"><i /><i /></div>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>; }
function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) { return <div><span>{label}</span><strong className={tone ? `amount-${tone}` : ""}>{value > 0 && tone === "positive" ? "+" : ""}{currency.format(value)}</strong></div>; }
function PanelHeader({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><div><span>{eyebrow}</span><h3>{title}</h3></div>{action && <button onClick={onAction}>{action}<ChevronRight /></button>}</header>; }
function TransactionRow({ item }: { item: Transaction }) { return <div className="transaction-row"><div className={`transaction-icon ${item.amount > 0 ? "income" : "expense"}`}>{item.amount > 0 ? <ArrowDownLeft /> : <ArrowUpRight />}</div><div><strong>{item.description}</strong><span>{item.category} · {item.enteredBy}</span></div><time>{shortDate.format(new Date(`${item.date}T12:00:00`))}</time><b className={item.amount > 0 ? "amount-positive" : "amount-negative"}>{item.amount > 0 ? "+" : ""}{currency.format(item.amount)}</b></div>; }
function BillRow({ bill, onToggle }: { bill: Bill; onToggle: (id: string) => void }) { const days = daysUntil(bill.dueDate); return <div className="bill-row"><button className="bill-check" aria-label={`Mark ${bill.name} paid`} onClick={() => onToggle(bill.id)}><Check /></button><div><strong>{bill.name}</strong><span>{bill.category} · {days < 0 ? `${Math.abs(days)} days overdue` : `Due in ${days} days`}</span></div><b>{currency.format(bill.amount)}</b></div>; }
function EmptyState({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) { return <div className="empty-state">{icon}<strong>{title}</strong><span>{copy}</span></div>; }
function viewTitle(view: View) { return ({ overview: "Good morning", activity: "Household activity", bills: "Upcoming bills", import: "Import & export", settings: "Settings" } as const)[view]; }
function syncLabel(sync: SyncState) { return ({ local: "Local preview", connecting: "Connecting", synced: "Cloud save active", "needs-setup": "Enrollment needed", offline: "Working offline" } as const)[sync]; }
function csvEscape(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function parseJson(text: string, enteredBy: string): Transaction[] { const parsed = JSON.parse(text); const rows = Array.isArray(parsed) ? parsed : parsed.transactions; if (!Array.isArray(rows)) throw new Error("JSON must contain a transactions array."); return rows.map((row) => normalizeImport(row, enteredBy)).filter(Boolean) as Transaction[]; }
function parseCsv(text: string, enteredBy: string): Transaction[] { const lines = text.trim().split(/\r?\n/); if (lines.length < 2) return []; const headers = splitCsv(lines[0]).map((value) => value.trim().toLowerCase()); return lines.slice(1).map((line) => { const values = splitCsv(line); const row = Object.fromEntries(headers.map((header, index) => [header, values[index]])); return normalizeImport(row, enteredBy); }).filter(Boolean) as Transaction[]; }
function splitCsv(line: string) { const values: string[] = []; let current = ""; let quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { values.push(current.trim()); current = ""; } else current += char; } values.push(current.trim()); return values; }
function normalizeImport(row: Record<string, unknown>, enteredBy: string): Transaction | null { const amount = Number(row.amount); const description = String(row.description || row.merchant || "").trim(); const date = String(row.date || todayISO()).slice(0, 10); if (!description || !Number.isFinite(amount) || amount === 0) return null; return { id: makeId(), date, description, category: String(row.category || "Other"), amount, enteredBy: String(row.enteredBy || row.enteredby || enteredBy), createdAt: new Date().toISOString() }; }

export default App;
