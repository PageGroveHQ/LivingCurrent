const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const webpush = require("web-push");
const { localDate, reminderDue, hash, validSubscription } = require("./reminder");
async function main() {
  const required = ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_PROJECT_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
  if (required.some((key) => !process.env[key])) throw new Error("Reminder setup incomplete: configure the required GitHub Actions secrets.");
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (account.project_id !== process.env.FIREBASE_PROJECT_ID) throw new Error("Service account project does not match Living Current.");
  initializeApp({ credential: cert(account), projectId: account.project_id });
  const db = getFirestore();
  const id = process.env.HOUSEHOLD_ID || "living-current-home";
  if (!/^[\w-]{1,120}$/.test(id)) throw new Error("Invalid household ID.");
  const household = db.collection("households").doc(id);
  const snapshot = await household.get();
  if (!snapshot.exists) throw new Error("Living Current household was not found.");
  const today = localDate();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", hour:"2-digit", hourCycle:"h23" }).format(new Date()));
  const test = process.env.TEST_PUSH === "true";
  if (!test && process.env.MANUAL_RUN !== "true" && hour < 9) { console.log("Waiting for the Eastern morning window."); return; }
  const bills = test ? [{ id:"background-test", dueDate:today, reminderDays:1 }] : (snapshot.data().bills || []).filter((bill) => reminderDue(bill,today));
  let sent = 0; let failed = 0;
  for (const device of (await household.collection("pushDevices").get()).docs) {
    const stored = device.data();
    const subscription = { endpoint:stored.endpoint, keys:stored.keys };
    if (!validSubscription(subscription) || stored.publicKey !== process.env.VAPID_PUBLIC_KEY) continue;
    for (const bill of bills) {
      const delivery = household.collection("pushDeliveries").doc(hash(`${device.id}:${bill.id}:${bill.dueDate}:${bill.reminderDays ?? 3}`));
      const claimed = await db.runTransaction(async (tx) => {
        const previous = (await tx.get(delivery)).data();
        if (previous?.sentAt || previous?.leaseUntil?.toMillis() > Date.now()) return false;
        tx.set(delivery, { leaseUntil:Timestamp.fromMillis(Date.now()+300000) });
        return true;
      });
      if (!claimed) continue;
      if (!test) {
        const latest = (await household.get()).data()?.bills?.find((item) => item.id === bill.id);
        if (!latest || latest.dueDate !== bill.dueDate || latest.reminderDays !== bill.reminderDays || !reminderDue(latest,today)) { await delivery.delete(); continue; }
      }
      try {
        await webpush.sendNotification(subscription, JSON.stringify({ title:test ? "Living Current · Background test" : "Living Current · Bill reminder", body:test ? "Background notifications are connected, even when Living Current is closed." : "An unpaid household bill is coming due. Open Living Current to review it.", tag:test ? "living-current-test" : `bill-${hash(bill.id).slice(0,16)}` }), { TTL:3600, vapidDetails:{ subject:"https://pagegrovehq.github.io/LivingCurrent/", publicKey:process.env.VAPID_PUBLIC_KEY, privateKey:process.env.VAPID_PRIVATE_KEY } });
        await delivery.set({ sentAt:Timestamp.now(), dueDate:bill.dueDate }); sent++;
      } catch (error) {
        await delivery.delete();
        if ([404,410].includes(error.statusCode)) { await device.ref.delete(); break; }
        console.error(`Push failed (status ${Number(error.statusCode) || "unknown"}).`); failed++;
      }
    }
  }
  console.log(`Reminder run complete: ${sent} accepted by push services, ${failed} failed. Acceptance is not guaranteed device delivery.`);
  if (failed) process.exitCode = 1;
}
main().catch(() => { console.error("Reminder run failed. Check secrets, project permissions, and household setup; sensitive details omitted."); process.exitCode = 1; });
