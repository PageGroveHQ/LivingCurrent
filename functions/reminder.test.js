const { test } = require("node:test");
const assert = require("node:assert/strict");
const { localDate, reminderDue, validSubscription } = require("./reminder");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
test("reminder selection, catch-up, paid and overdue exclusions", () => {
  for (const days of [1,3,7]) {
    const bill = { dueDate: "2026-10-08", reminderDays: days, paid: false };
    assert.equal(reminderDue(bill, `2026-10-${String(8-days).padStart(2,"0")}`), true);
    assert.equal(reminderDue(bill, "2026-10-08"), true);
    assert.equal(reminderDue(bill, "2026-10-09"), false);
    assert.equal(reminderDue({...bill,paid:true}, "2026-10-08"), false);
    assert.equal(reminderDue({...bill,reminderDays:-1}, "2026-10-08"), false);
  }
  assert.equal(reminderDue({dueDate:"2026-10-08",reminderDays:3},"2026-10-04"),false);
});
test("actual sender deduplicates, skips paid/off bills, and deletes expired devices without changing finances", async () => {
  const today = localDate();
  const bills = [{ id:"due",dueDate:today,reminderDays:3,paid:false },{id:"paid",dueDate:today,reminderDays:3,paid:true},{id:"off",dueDate:today,reminderDays:-1,paid:false}];
  const deliveries = new Map(); let sends=0; let removed=false; let fail=false;
  const subscription = {endpoint:"https://web.push.apple.com/test",keys:{p256dh:"a".repeat(87),auth:"a".repeat(22)}, publicKey:"public"};
  const ref = (id) => ({ id, get:async()=>({data:()=>deliveries.get(id)}), set:async(value)=>deliveries.set(id,value), delete:async()=>deliveries.delete(id) });
  const health = new Map();
  const household = { get:async()=>({exists:true,data:()=>({bills})}), collection:(name)=>name==="pushDevices"?{get:async()=>({size:removed?0:1,docs:removed?[]:[{id:"device",data:()=>subscription,ref:{delete:async()=>{removed=true;}}}]})}:name==="pushHealth"?{doc:(id)=>({set:async(value)=>health.set(id,{...(health.get(id)||{}),...value})})}:{doc:ref} };
  const database = {collection:(name)=>{assert.equal(name,"households");return {doc:(id)=>{assert.equal(id,"living-current-home");return household;}};},runTransaction:async(fn)=>fn({get:(reference)=>reference.get(),set:(reference,value)=>reference.set(value)})};
  const source = fs.readFileSync(path.join(__dirname,"send.js"),"utf8").replace(/main\(\)\.catch[\s\S]*$/, "module.exports = main;");
  const context = {module:{exports:{}},process:{env:{FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:"isolated"}),FIREBASE_PROJECT_ID:"isolated",VAPID_PUBLIC_KEY:"public",VAPID_PRIVATE_KEY:"private",MANUAL_RUN:"true"}},console:{log:()=>{},error:()=>{}},require:(name)=>{
    if(name==="firebase-admin/app")return {initializeApp:()=>{},cert:(value)=>value};
    if(name==="firebase-admin/firestore")return {getFirestore:()=>database,Timestamp:{now:()=>({toMillis:()=>Date.now()}),fromMillis:(value)=>({toMillis:()=>value})}};
    if(name==="web-push")return {sendNotification:async()=>{sends++;if(fail)throw {statusCode:410};}};
    return require(name);
  }};
  vm.runInNewContext(source,context);
  await context.module.exports(); await context.module.exports();
  assert.equal(sends,1); assert.equal(deliveries.size,1); assert.equal(bills[0].paid,false);
  assert.equal(health.get("status").activeDevices,1);
  assert.ok(health.get("status").lastSuccessAt);
  deliveries.clear(); fail=true; await context.module.exports(); assert.equal(removed,true); assert.equal(deliveries.size,0);
});
test("Eastern date, DST-independent calendar days, endpoint validation", () => {
  assert.equal(localDate(new Date("2026-10-02T02:00:00Z")), "2026-10-01");
  assert.equal(reminderDue({ dueDate:"2026-11-02", reminderDays:1 },"2026-11-01"),true);
  const keys = { p256dh:"a".repeat(87), auth:"a".repeat(22) };
  assert.equal(validSubscription({endpoint:"https://web.push.apple.com/test",keys}),true);
  for (const endpoint of ["http://fcm.googleapis.com/a","https://localhost/a","https://evil.com/a","https://web.push.apple.com.evil.com/a"]) assert.equal(validSubscription({endpoint,keys}),false);
});
