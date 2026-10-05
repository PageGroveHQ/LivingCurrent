const crypto = require("node:crypto");
function localDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function reminderDue(bill, today) {
  const days = bill.reminderDays ?? 3;
  if (bill.paid || ![1, 3, 7].includes(days) || !/^\d{4}-\d{2}-\d{2}$/.test(bill.dueDate || "")) return false;
  const delta = (Date.parse(`${bill.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  // Catch up if a bill/device was added after the selected day, but never remind after due date.
  return delta >= 0 && delta <= days;
}
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function validSubscription(subscription) {
  try {
    const url = new URL(subscription.endpoint);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname) &&
      subscription.endpoint.length < 2048 && /^[\w-]{80,100}$/.test(subscription.keys?.p256dh || "") && /^[\w-]{20,30}$/.test(subscription.keys?.auth || "");
  } catch { return false; }
}
module.exports = { localDate, reminderDue, hash, validSubscription };
