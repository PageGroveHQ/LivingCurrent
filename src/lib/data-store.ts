import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { doc, getDoc, getFirestore, onSnapshot, setDoc, updateDoc, type Unsubscribe } from "firebase/firestore";
import { createDemoData } from "../demo-data";
import type { HouseholdData, SyncState } from "../types";

const STORAGE_KEY = "living-current-household-v1";

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

const readLocal = (): HouseholdData => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as HouseholdData : createDemoData();
  } catch {
    return createDemoData();
  }
};

const writeLocal = (data: HouseholdData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

type StoreOptions = {
  onData: (data: HouseholdData) => void;
  onSync: (state: SyncState) => void;
  onIdentity: (uid: string) => void;
};

export type DataStore = {
  initialData: HouseholdData;
  save: (data: HouseholdData) => Promise<void>;
  destroy: () => void;
};

export async function createDataStore({ onData, onSync, onIdentity }: StoreOptions): Promise<DataStore> {
  const initialData = readLocal();
  let unsubscribe: Unsubscribe | undefined;
  let cloudDocumentExists = false;
  let uid = "";

  if (!firebaseConfigured) {
    onSync("local");
    return {
      initialData,
      save: async (data) => writeLocal(data),
      destroy: () => undefined,
    };
  }

  onSync("connecting");
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
    onIdentity(uid);
    const reference = doc(getFirestore(app), "households", householdId);
    const firstSnapshot = await getDoc(reference);
    cloudDocumentExists = firstSnapshot.exists();

    if (!cloudDocumentExists) {
      await setDoc(reference, { ...initialData, memberUids: [uid] });
      cloudDocumentExists = true;
    } else {
      const remote = firstSnapshot.data() as HouseholdData;
      writeLocal(remote);
      onData(remote);
    }

    unsubscribe = onSnapshot(reference, (snapshot) => {
      if (!snapshot.exists()) return;
      const remote = snapshot.data() as HouseholdData;
      writeLocal(remote);
      onData(remote);
      onSync("synced");
    }, () => onSync("needs-setup"));

    return {
      initialData: firstSnapshot.exists() ? firstSnapshot.data() as HouseholdData : initialData,
      save: async (data) => {
        writeLocal(data);
        if (!cloudDocumentExists) return;
        try {
          await updateDoc(reference, { ...data });
          onSync("synced");
        } catch {
          onSync("needs-setup");
        }
      },
      destroy: () => unsubscribe?.(),
    };
  } catch {
    onSync(uid ? "needs-setup" : "offline");
    return {
      initialData,
      save: async (data) => writeLocal(data),
      destroy: () => unsubscribe?.(),
    };
  }
}
