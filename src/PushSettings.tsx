import { useEffect, useState } from "react";
import { disablePush, enablePush, pushEnabled, testPush } from "./lib/push";
import NotificationHealth from "./NotificationHealth";

export default function PushSettings() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void pushEnabled().then(setEnabled).catch(() => setEnabled(false)); }, []);
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); setEnabled(await pushEnabled()); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Push setup failed. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="push-settings"><h3>Background bill notifications</h3><p>Daily checks around 9:17 AM Eastern (GitHub scheduling may delay delivery). Choose 1, 3, 7 days before or Off on each bill. Notifications can arrive while the app is closed. Enable separately on each device.</p><p>On iPhone: add Living Current to the Home Screen and open it from that icon. Lock-screen messages are generic to keep financial details private.</p><p>{enabled ? "This device is registered. For an end-to-end background test, run the bill-reminders workflow in GitHub with Test selected." : "This device is not registered for push."}</p><button className="primary-button" disabled={busy} onClick={() => void run(enabled ? disablePush : enablePush, enabled ? "Push disabled on this device." : "Device registered. Background delivery starts after GitHub secrets and Firebase rules are configured.")}>{busy ? "Please wait…" : enabled ? "Disable on this device" : "Enable on this device"}</button>{enabled && <button className="secondary-button" disabled={busy} onClick={() => void run(testPush, "Local display test sent. This does not verify GitHub delivery.")}>Test local notification</button>}{message && <p role="status">{message}</p>}<NotificationHealth /></section>;
}
