const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('src/lib/payday.ts', 'utf8').replace(/^import.*$/m, '').replaceAll('export function', 'function');
const context = { exports: {} };
vm.runInNewContext(stripTypeScriptTypes(source) + '\nexports.plan=paydayPlan; exports.friday=lastFriday;', context);
const { plan, friday } = context.exports;
assert.equal(friday('2026-10'), '2026-10-30');
assert.equal(friday('2026-12'), '2026-12-25');
assert.equal(friday('2028-02'), '2028-02-25');
const data = { transactions: [], bills: [
  { id:'due', amount:100, dueDate:'2026-10-20', paid:false },
  { id:'overdue', amount:20, dueDate:'2026-09-30', paid:false },
  { id:'paid', amount:500, dueDate:'2026-10-15', paid:true },
  { id:'savings', amount:50, dueDate:'2026-10-15', paid:false, account:'savings' },
  { id:'later', amount:200, dueDate:'2026-11-01', paid:false }
], safetyBuffer:100 };
let result = plan(data, 1000, '2026-10-06');
assert.equal(result.days,24);
assert.equal(result.windowStart,'2026-10-26');
assert.equal(result.status,'20 days until payday week');
assert.equal(plan(data,1000,'2026-10-26').status,'Pay expected this week');
assert.equal(plan(data,1000,'2026-10-30').status,'Pay expected this week');
assert.equal(plan(data,1000,'2026-10-31').status,'Pay not yet recorded');
const exact = plan({...data,paydayOverride:{period:'2026-10',date:'2026-10-23'}},1000,'2026-10-23');
assert.equal(exact.windowStart,'2026-10-23');
assert.equal(exact.status,'Expected today');
assert.equal(exact.exactDate,true);
assert.equal(plan({...data,bills:[{amount:40,paid:false,dueDate:'2026-10-29'}]},1000,'2026-10-26').reserved,40,'Reserve bills through Friday, not Monday');
assert.equal(result.available,730);
assert.equal(result.daily,730/24);
assert.equal(plan({...data,safetyBuffer:0},4336.78,'2026-10-06').available,4166.78,'Combined checking and savings must cover bills from both accounts with no zero-buffer deduction');
assert.equal(plan(data,1000+500,'2026-10-06').available,plan(data,800+700,'2026-10-06').available,'Internal transfers must not change available combined funds');
const pay = { id:'pay', type:'income', amount:2000, date:'2026-10-28', paydayPeriod:'2026-10', createdAt:'2026-10-28T12:00:00Z' };
assert.equal(plan({...data,transactions:[pay]},1000,'2026-10-06').period,'2026-10','Future income must not mark pay received');
assert.equal(plan({...data,transactions:[pay]},3000,'2026-10-28').date,'2026-11-27','Early pay advances to next regular payday');
assert.equal(plan({...data,transactions:[{...pay,paydayPeriod:undefined}]},3000,'2026-10-28').period,'2026-10','Other income cannot reset payday');
assert.equal(plan({...data,transactions:[{...pay,type:'expense'}]},1000,'2026-10-28').period,'2026-10');
const delayed = {...data,paydayOverride:{period:'2026-10',date:'2026-11-02'}};
assert.equal(plan(delayed,1000,'2026-11-01').date,'2026-11-02');
assert.equal(plan({...delayed,transactions:[{...pay,date:'2026-11-02'}]},3000,'2026-11-02').date,'2026-11-27');
assert.equal(plan({...delayed,transactions:[]},1000,'2026-11-02').period,'2026-10','Deleting linked income reopens delayed payday');
assert.equal(plan({...data,paydayOverride:{period:'2026-10',date:'2026-10-23'}},1000,'2026-10-06').date,'2026-10-23');
assert.equal(plan(data,1000,'2026-10-31').days,-1,'Overdue pay must not be silently treated as received');
assert.equal(plan(data,0,'2026-10-06').daily,0);
console.log('Payday checks passed: last Fridays, early/late overrides, linked income, deletion, pending-aware balances and bill reservation.');
