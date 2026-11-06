/* The ORIGINAL version 3 calculations, copied unchanged from the old single-file index.html
   (functions allocGoals, pay27, sinkInfo and compute). Used only by the tests, to prove the
   new maths gives the same answers for a version 3 budget viewed per fortnight.
   Do not "fix" this file: it is a reference, not app code. */
export function legacyCompute(state, TODAY) {
const n = v => (typeof v==="number" && isFinite(v)) ? v : 0;
const blank = v => v===null || v===undefined || v==="";
const parseDate = s => { if(!s) return null; const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (d,k) => { const x=new Date(d); x.setDate(x.getDate()+k); return x; };
const m0 = v => "$"+Math.round(v);
const issues = () => null;
function allocGoals(goals, base){
  const eff = base.map(v=>v===null?null:v), from = goals.map(()=>[]), to = goals.map(()=>null);
  let spare = 0;
  const finished = goals.map(g=>!blank(g.name) && !blank(g.target) && Math.max(n(g.target)-n(g.saved),0)===0);
  const open = i => !blank(goals[i].name) && !finished[i];
  goals.forEach((g,i)=>{
    if(!finished[i] || !base[i]) return;
    let j = -1;
    for(let k=i+1;k<goals.length;k++) if(open(k)){ j=k; break; }
    if(j<0) for(let k=i-1;k>=0;k--) if(open(k)){ j=k; break; }
    if(j>=0){ eff[j] = n(eff[j]) + base[i]; from[j].push({name:g.name, v:base[i]}); to[i] = goals[j].name; }
    else { spare += base[i]; to[i] = ""; }
    eff[i] = 0;
  });
  return { eff, from, to, spare, finished };
}

/* ---------- 27-pay years ---------- */
function pay27(dateStr){
  const d = parseDate(dateStr); if(!d) return null;
  const y0 = TODAY.getFullYear(), out = [];
  for(let Y=y0; Y<=y0+20; Y++){
    const k = Math.ceil(Math.round((new Date(Y,0,1)-d)/864e5)/14);
    let p = addDays(d,k*14), c = 0;
    while(p.getFullYear()===Y){ c++; p = addDays(p,14); }
    if(c>=27) out.push(Y);
  }
  return out;
}

/* ---------- sinking funds with a due month ---------- */
function sinkInfo(s, fn){
  if(s.type!=="Sinking" || s.period!=="Year" || blank(s.due) || blank(s.name)) return null;
  const A = n(s.amount); if(A<=0) return null;
  let next = new Date(TODAY.getFullYear(), s.due-1, 1);
  if(next <= TODAY) next = new Date(TODAY.getFullYear()+1, s.due-1, 1);
  const last = new Date(next.getFullYear()-1, s.due-1, 1);
  const frac = (TODAY-last)/(next-last), expected = A*frac;
  const fnsAway = Math.max(1, Math.ceil((next-TODAY)/864e5/14));
  const info = { next, fnsAway, expected, A };
  if(blank(s.aside)){ info.st = {t:`Should have ${m0(expected)} by now`, c:"info"}; return info; }
  const diff = n(s.aside) - expected, tol = Math.max(2, A*0.02);
  if(n(s.aside) >= A) info.st = {t:"Ready to pay", c:"ok"};
  else if(Math.abs(diff) <= tol) info.st = {t:"On track", c:"ok"};
  else if(diff > 0) info.st = {t:`Ahead by ${m0(diff)}`, c:"ok"};
  else { info.behind = -diff; info.need = (A - n(s.aside))/fnsAway; info.st = {t:`Behind by ${m0(-diff)}`, c:"bad"}; }
  return info;
}

/* ---------- the model ---------- */
function compute(){
  const S=state, C={};
  const inc = { j:n(S.income.j), m:n(S.income.m) }; inc.c = inc.j+inc.m; C.inc=inc;
  const rows = S.accounts.map(a=>{ const je=n(a.j)*inc.j, me=n(a.m)*inc.m; return {...a, je, me, t:je+me}; });
  C.rows=rows;
  const row = id => rows.find(r=>r.id===id) || {je:0,me:0,t:0};
  C.tot = { jp:rows.reduce((s,r)=>s+n(r.j),0), mp:rows.reduce((s,r)=>s+n(r.m),0),
            je:rows.reduce((s,r)=>s+r.je,0), me:rows.reduce((s,r)=>s+r.me,0), t:rows.reduce((s,r)=>s+r.t,0) };
  C.maxT = Math.max(1, ...rows.map(r=>r.t));
  const byType = t => rows.filter(r=>r.type===t).reduce((s,r)=>s+r.t,0);
  C.joint=byType("Joint"); C.personal=byType("Personal"); C.investment=byType("Investment");
  C.cash = rows.filter(r=>/saving|buffer|goal|emergency/i.test(r.name)).reduce((s,r)=>s+r.t,0);
  C.pool = { js:row("js").t, ef:row("ef").t, jg:row("jg"), ji:row("ji").t, jpg:row("jpg").t, mpg:row("mpg").t };

  // fair split
  const shared = rows.filter(r=>r.type==="Joint"||r.type==="Investment");
  C.fair = { sj:shared.reduce((s,r)=>s+r.je,0), sm:shared.reduce((s,r)=>s+r.me,0),
    pj:rows.filter(r=>r.type==="Personal").reduce((s,r)=>s+r.je,0), pm:rows.filter(r=>r.type==="Personal").reduce((s,r)=>s+r.me,0),
    fj:rows.filter(r=>r.type==="Personal"&&/spend/i.test(r.name)).reduce((s,r)=>s+r.je,0), fm:rows.filter(r=>r.type==="Personal"&&/spend/i.test(r.name)).reduce((s,r)=>s+r.me,0) };

  // net worth
  const nw = S.nw.accounts, sumNW = t => nw.filter(a=>a.type===t).reduce((s,a)=>s+n(a.balance),0);
  C.nw = { op:sumNW("Operating"), sav:sumNW("Savings"), inv:sumNW("Investment"), sup:sumNW("Super"), debt:sumNW("Debt") };
  C.nw.assets = C.nw.op+C.nw.sav+C.nw.inv+C.nw.sup; C.nw.net = C.nw.assets-C.nw.debt; C.nw.cash=C.nw.op+C.nw.sav;
  const allGoals = [S.goals.ef, ...S.goals.joint, ...S.goals.jarden, ...S.goals.madi];
  C.earmark = {};
  nw.forEach(a=>{ C.earmark[a.id] = allGoals.filter(g=>g.account===a.name && !blank(a.name)).reduce((s,g)=>s+n(g.saved),0); });
  const counts = {}; nw.forEach(a=>{ const k=(a.name||"").trim().toLowerCase(); if(k) counts[k]=(counts[k]||0)+1; });
  C.dup = new Set(Object.keys(counts).filter(k=>counts[k]>1));
  C.savingsNames = nw.filter(a=>a.type==="Savings" && !blank(a.name)).map(a=>a.name);
  const rev = parseDate(S.nw.reviewed);
  C.reviewDue = !rev || (TODAY-rev)/864e5 > 30;

  // joint spending
  C.sp = S.spend.map(s=>{ const a=n(s.amount); const fn = blank(s.name) ? null : s.period==="Month" ? a*12/26 : s.period==="Year" ? a/26 : a; return {...s, fn}; });
  C.sp.forEach(s=>{ s.sink = sinkInfo(s, s.fn); });
  C.committed = C.sp.reduce((s,r)=>s+n(r.fn),0);
  C.spBuffer = C.pool.js - C.committed;
  C.spType = t => C.sp.filter(r=>r.type===t).reduce((s,r)=>s+n(r.fn),0);
  C.mCommitted = C.committed*26/12;

  // goals
  const jg = C.pool.jg;
  C.gj = allocGoals(S.goals.joint, S.goals.joint.map(g=> blank(g.name) ? null : n(g.j)*jg.je + n(g.m)*jg.me));
  C.gja = allocGoals(S.goals.jarden, S.goals.jarden.map(g=> blank(g.name) ? null : n(g.pct)*C.pool.jpg));
  C.gm = allocGoals(S.goals.madi, S.goals.madi.map(g=> blank(g.name) ? null : n(g.pct)*C.pool.mpg));

  // investments: fortnightly compounding, optional yearly contribution growth and fees
  const start = C.nw.inv, rate=n(S.invest.rate), fee=n(S.invest.fee), g=n(S.invest.growth), fn=C.pool.ji;
  const r=(rate-fee)/26, r0=rate/26;
  let bal=start, bal0=start, contrib=start;
  C.inv = { start, fn, rate, fee, g, years:[{y:0, contrib:start, bal:start, growth:0, mult:start?1:null, noFee:start}] };
  for(let y=1;y<=30;y++){
    const cy = fn*Math.pow(1+g, y-1);
    for(let k=0;k<26;k++){ bal = bal*(1+r)+cy; bal0 = bal0*(1+r0)+cy; contrib += cy; }
    C.inv.years.push({ y, contrib, bal, growth:bal-contrib, mult: contrib===0 ? null : bal/contrib, noFee:bal0 });
  }
  C.p27 = { j:pay27(S.paydays.j), m:pay27(S.paydays.m) };
  C.issues = issues(C);
  return C;
}
return compute();
}
