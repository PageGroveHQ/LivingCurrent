import { getAuth } from "firebase/auth";
import { deleteDoc, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import { firebaseApp, firebaseConfigured, householdId } from "./data-store";

const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined;
async function deviceId(endpoint: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function cloud() {
  if (!firebaseConfigured || !getAuth(firebaseApp()).currentUser) throw new Error("Sign in to the cloud household first. Push is unavailable in local preview.");
  return getFirestore(firebaseApp());
}
async function worker() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("Push is unsupported here. On iPhone, add Living Current to your Home Screen and open it from that icon.");
  await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  return navigator.serviceWorker.ready;
}
export async function pushEnabled() {
  if (!firebaseConfigured || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  return (await getDoc(doc(cloud(), "households", householdId, "pushDevices", await deviceId(subscription.endpoint)))).exists();
}
export async function enablePush() {
  const database = cloud();
  if (!publicKey) throw new Error("Push setup is not finished: add the public push key to GitHub and publish the Firebase rules first.");
  if (!("Notification" in window)) throw new Error("On iPhone, open the Home Screen app to enable notifications.");
  if (await Notification.requestPermission() !== "granted") throw new Error("Notifications were not allowed. Check your device's site notification settings.");
  const registration = await worker();
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const raw = subscription.toJSON();
  await setDoc(doc(database, "households", householdId, "pushDevices", await deviceId(subscription.endpoint)), { endpoint: subscription.endpoint, keys: raw.keys, registeredBy: getAuth(firebaseApp()).currentUser!.uid, publicKey, updatedAt: new Date().toISOString() });
}
export async function disablePush() {
  const registration = await worker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await deleteDoc(doc(cloud(), "households", householdId, "pushDevices", await deviceId(subscription.endpoint)));
  await subscription.unsubscribe();
}
export async function testPush() {
  const registration = await worker();
  await registration.showNotification("Living Current · Device test", { body: "Local notifications work. Verify background delivery with the GitHub workflow test.", icon: `${import.meta.env.BASE_URL}coin-icon.png`, tag: "living-current-local-test" });
}
