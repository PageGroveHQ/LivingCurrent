import { getApps, initializeApp } from "firebase/app";
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  linkWithCredential,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDocFromServer as getDoc, getFirestore, onSnapshot, runTransaction, setDoc, updateDoc, type Unsubscribe } from "firebase/firestore";
import { createDemoData } from "../demo-data";
import type { HouseholdData, SyncState } from "../types";

const STORAGE_KEY = "living-current-household-v1";
const PENDING_KEY = "living-current-pending-save";
const cloudValues = (data: HouseholdData) => JSON.parse(JSON.stringify(data));
// Apply only this device's changes to the latest cloud record, preserving other devices' entries.
export function mergeHouseholdChanges(base: HouseholdData, next: HouseholdData, remote: HouseholdData): HouseholdData {
  const result = { ...remote };
  for (const key of Object.keys(next) as (keyof HouseholdData)[]) {
    if (key === "transactions" || key === "bills") continue;
    if (JSON.stringify(base[key]) !== JSON.stringify(next[key])) Object.assign(result, { [key]: next[key] });
  }
  const mergeRows = <T extends { id: string }>(before: T[], after: T[], cloud: T[]) => {
    const beforeMap = new Map(before.map((item) => [item.id, item]));
    const afterMap = new Map(after.map((item) => [item.id, item]));
    const rows = new Map(cloud.map((item) => [item.id, item]));
    for (const id of beforeMap.keys()) if (!afterMap.has(id)) rows.delete(id);
    for (const [id, item] of afterMap) if (JSON.stringify(item) !== JSON.stringify(beforeMap.get(id))) rows.set(id, item);
    return [...rows.values()];
  };
  result.transactions = mergeRows(base.transactions, next.transactions, remote.transactions);
  result.bills = mergeRows(base.bills, next.bills, remote.bills);
  return result;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "living-current-home";
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

const firebaseApp = () => getApps()[0] ?? initializeApp(firebaseConfig);

export function observeHouseholdAuth(onChange: (user: User | null) => void) {
  if (!firebaseConfigured) {
    onChange(null);
    return () => undefined;
  }
  return onAuthStateChanged(getAuth(firebaseApp()), onChange);
}

export async function signInToHousehold(email: string, password: string) {
  return signInWithEmailAndPassword(getAuth(firebaseApp()), email.trim(), password);
}

export async function createHouseholdAccount(email: string, password: string) {
  const auth = getAuth(firebaseApp());
  if (auth.currentUser?.isAnonymous) {
    return linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email.trim(), password));
  }
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

export async function signOutOfHousehold() {
  return signOut(getAuth(firebaseApp()));
}

const readLocal = (): HouseholdData => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as HouseholdData : createDemoData();
  } catch {
    return createDemoData();
  }
};

const writeLocal = (data: HouseholdData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

const migrateHouseholdData = (value: Partial<HouseholdData> | undefined): HouseholdData => {
  const defaults = createDemoData();
  const transactions = Array.isArray(value?.transactions)
    ? value.transactions.filter((item) => !item.id?.startsWith("demo-"))
    : [];
  const bills = Array.isArray(value?.bills)
    ? value.bills.filter((item) => !["bill-1", "bill-2", "bill-3"].includes(item.id))
    : [];
  return {
    ...defaults,
    ...value,
    schemaVersion: 3,
    balanceStartMonth: value?.balanceStartMonth || "2026-10",
    checkingStartingBalance: Number.isFinite(value?.checkingStartingBalance) ? Number(value?.checkingStartingBalance) : 1555.44,
    savingsStartingBalance: Number.isFinite(value?.savingsStartingBalance) ? Number(value?.savingsStartingBalance) : 3053.72,
    transactions,
    bills,
  };
};

type StoreOptions = {
  onData: (data: HouseholdData) => void;
  onSync: (state: SyncState) => void;
  onIdentity: (uid: string) => void;
};

export type DataStore = {
  initialData: HouseholdData;
  save: (data: HouseholdData) => Promise<void>;
  refresh: () => Promise<void>;
  destroy: () => void;
};

export async function createDataStore({ onData, onSync, onIdentity }: StoreOptions): Promise<DataStore> {
  const initialData = migrateHouseholdData(readLocal());
  let unsubscribe: Unsubscribe | undefined;
  let cloudDocumentExists = false;
  let uid = "";
  let latestData = initialData;
  let saveQueue: Promise<void> = Promise.resolve();
  let pendingCount = 0;

  if (!firebaseConfigured) {
    onSync("local");
    return {
      initialData,
      save: async (data) => writeLocal(data),
      refresh: async () => onData(readLocal()),
      destroy: () => undefined,
    };
  }

  onSync("connecting");
  try {
    const app = firebaseApp();
    const user = getAuth(app).currentUser;
    if (!user || user.isAnonymous) throw new Error("Household sign-in required");
    uid = user.uid;
    onIdentity(uid);
    const reference = doc(getFirestore(app), "households", householdId);
    const outboxKey = `${PENDING_KEY}-${uid}`;
    const persistChanges = async (base: HouseholdData, next: HouseholdData) => {
      await runTransaction(getFirestore(app), async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("Household document missing");
        const remote = migrateHouseholdData(snapshot.data() as Partial<HouseholdData>);
        const merged = mergeHouseholdChanges(base, next, remote);
        transaction.update(reference, cloudValues(merged));
      });
    };
    const firstSnapshot = await getDoc(reference);
    cloudDocumentExists = firstSnapshot.exists();

    if (!cloudDocumentExists) {
      await setDoc(reference, { ...initialData, memberUids: [uid] });
      cloudDocumentExists = true;
    } else {
      const remoteRaw = firstSnapshot.data() as Partial<HouseholdData>;
      const remote = migrateHouseholdData(remoteRaw);
      const savedOutbox = localStorage.getItem(outboxKey);
      if (savedOutbox) {
        const pending = JSON.parse(savedOutbox) as { base: HouseholdData; next: HouseholdData };
        await persistChanges(pending.base, pending.next);
        Object.assign(remote, mergeHouseholdChanges(pending.base, pending.next, remote));
        localStorage.removeItem(outboxKey);
      }
      if (localStorage.getItem(PENDING_KEY) === "true") {
        const pending = migrateHouseholdData(readLocal());
        const emptyBase = { ...pending, transactions: [], bills: [] };
        await persistChanges(emptyBase, pending);
        Object.assign(remote, mergeHouseholdChanges(emptyBase, pending, remote));
        localStorage.removeItem(PENDING_KEY);
      }
      // A default/new device must never upload an empty household based on its timestamp.
      if (remoteRaw.schemaVersion !== 3) await updateDoc(reference, { ...remote });
      writeLocal(remote);
      onData(remote);
      latestData = remote;
    }

    unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, (snapshot) => {
      if (!snapshot.exists()) return;
      if (pendingCount || snapshot.metadata.hasPendingWrites || localStorage.getItem(outboxKey)) return;
      const remote = migrateHouseholdData(snapshot.data() as Partial<HouseholdData>);
      latestData = remote;
      writeLocal(remote);
      onData(remote);
      onSync(snapshot.metadata.fromCache ? "offline" : "synced");
    }, () => onSync("needs-setup"));

    return {
      initialData: latestData,
      save: async (data) => {
        const base = latestData;
        latestData = data;
        writeLocal(data);
        const oldOutbox = localStorage.getItem(outboxKey);
        const originalBase = oldOutbox ? (JSON.parse(oldOutbox) as { base: HouseholdData }).base : base;
        localStorage.setItem(outboxKey, JSON.stringify({ base: originalBase, next: data }));
        if (!cloudDocumentExists) return;
        pendingCount++;
        onSync("connecting");
        saveQueue = saveQueue.then(async () => {
          try {
            await persistChanges(originalBase, data);
            if (latestData.updatedAt === data.updatedAt) localStorage.removeItem(outboxKey);
          } catch { onSync("offline"); }
          finally { pendingCount--; }
        });
        await saveQueue;
        if (!pendingCount && !localStorage.getItem(outboxKey)) {
          try { const snapshot = await getDoc(reference);
            if (pendingCount || localStorage.getItem(outboxKey)) return;
            latestData = migrateHouseholdData(snapshot.data() as Partial<HouseholdData>);
            writeLocal(latestData); onData(latestData); onSync("synced");
          } catch { onSync("offline"); }
        }
      },
      refresh: async () => {
        onSync("connecting");
        try {
          await saveQueue;
          const savedOutbox = localStorage.getItem(outboxKey);
          if (savedOutbox) { const pending = JSON.parse(savedOutbox); await persistChanges(pending.base, pending.next); localStorage.removeItem(outboxKey); }
          const snapshot = await getDoc(reference);
          if (!snapshot.exists()) {
            onSync("needs-setup");
            return;
          }
          const remote = migrateHouseholdData(snapshot.data() as Partial<HouseholdData>);
          latestData = remote;
          writeLocal(remote);
          onData(remote);
          onSync("synced");
        } catch {
          onSync("offline");
        }
      },
      destroy: () => unsubscribe?.(),
    };
  } catch {
    onSync(uid ? "needs-setup" : "offline");
    return {
      initialData,
      save: async (data) => { const base = latestData; latestData = data; writeLocal(data); if (uid) { const key = `${PENDING_KEY}-${uid}`; const old = localStorage.getItem(key); localStorage.setItem(key, JSON.stringify({ base: old ? JSON.parse(old).base : base, next: data })); } },
      refresh: async () => onData(readLocal()),
      destroy: () => unsubscribe?.(),
    };
  }
}
