import { useEffect, useState } from "react";
import { collection, doc, getFirestore, onSnapshot } from "firebase/firestore";
import { firebaseApp, firebaseConfigured, householdId } from "./lib/data-store";

type Health = { checkedAt?: string; finishedAt?: string; accepted?: number; failed?: number; activeDevices?: number; mode?: string; lastSuccessAt?: string };
export default function NotificationHealth() {
  const [health,setHealth] = useState<Health|null>(null);
  const [devices,setDevices] = useState<{id:string;updatedAt?:string;deviceLabel?:string}[]>([]);
  const [error,setError] = useState("");
  useEffect(()=>{
    if (!firebaseConfigured) return;
    const db=getFirestore(firebaseApp());
    const fail=()=>setError("Notification health could not load. Publish the latest Firebase rules and check your connection.");
    const unsubscribeHealth=onSnapshot(doc(db,"households",householdId,"pushHealth","status"),snapshot=>{setHealth(snapshot.exists()?snapshot.data() as Health:null);setError("");},fail);
    const unsubscribeDevices=onSnapshot(collection(db,"households",householdId,"pushDevices"),snapshot=>setDevices(snapshot.docs.map(item=>({id:item.id,updatedAt:item.data().updatedAt,deviceLabel:item.data().deviceLabel}))),fail);
    return ()=>{unsubscribeHealth();unsubscribeDevices();};
  },[]);
  const format=(value?:string)=>value?new Date(value).toLocaleString():"Not reported yet";
  const stale=health?.checkedAt && Date.now()-Date.parse(health.checkedAt)>36*3600000;
  return <section className="notification-health"><h3>Notification health</h3>{!firebaseConfigured?<p>Available after cloud sign-in.</p>:<><p>{devices.length} registered device{devices.length===1?"":"s"}. Device registration is not proof of delivery.</p><dl><div><dt>Latest check</dt><dd>{format(health?.checkedAt)}</dd></div><div><dt>Last successful run</dt><dd>{format(health?.lastSuccessAt)}</dd></div><div><dt>Latest run</dt><dd>{health?.finishedAt ? `${health.mode || "Reminders"}: ${health.accepted || 0} accepted by push services; ${health.failed || 0} failed` : health?.checkedAt ? "Started; completion not reported" : "No run reported. Check GitHub setup."}</dd></div></dl>{stale&&<p role="alert">No reminder check reported in over 36 hours. Review the GitHub Actions workflow.</p>}{(health?.failed||0)>0&&<p role="alert">A notification failed. Check the workflow, then disable/re-enable affected devices if needed.</p>}<p>Accepted does not mean displayed: device connectivity, notification permissions and Focus settings can affect delivery.</p>{devices.map((device,index)=><p key={device.id}>{device.deviceLabel || `Device ${index+1}`} · registered/updated {format(device.updatedAt)}</p>)}{error&&<p role="alert">{error}</p>}</>}</section>;
}
