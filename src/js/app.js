(() => {
"use strict";

/* ---------- constants ---------- */
const SECTIONS = ["Produce","Meat & Seafood","Dairy & Eggs","Bakery & Bread","Pantry","Canned Goods","Frozen","Spices & Baking","Snacks & Drinks","Household","Other"];
const DEFAULT_HH = "No other details given.";
const QUICK = ["Keep it cheap","Share ingredients","Use what we have","Under 30 minutes","Kid-friendly","Slow cooker","Freezer-friendly","Leftovers for lunch","One pan"];
const STARTERS = [
  "Need to keep it cheap next week. Dinner ideas that share a lot of the same cheaper ingredients.",
  "Quick weeknight dinners, 30 minutes or less, that kids will eat.",
  "Use up what we already have, plus a couple of slow cooker meals with leftovers for lunch."
];
const DAYS = [["sun","Sunday"],["mon","Monday"],["tue","Tuesday"],["wed","Wednesday"],["thu","Thursday"],["fri","Friday"],["sat","Saturday"]].map(([key, long]) => ({ key, long }));
const dayIndex = (k) => DAYS.findIndex(d => d.key === k);
const dayLong = (k) => { const d = DAYS[dayIndex(k)]; return d ? d.long : ""; };
const pad2 = (n) => String(n).padStart(2,"0");
const isoOf = (d) => d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseIso = (s) => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, m-1, d); };
const addDays = (iso, n) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const todayIso = () => isoOf(new Date());
const fmtDay = (iso, opts) => parseIso(iso).toLocaleDateString(undefined, opts || { weekday:"short", month:"short", day:"numeric" });
const fmtRange = (a, b) => fmtDay(a, { month:"short", day:"numeric" }) + " – " + fmtDay(b, { month:"short", day:"numeric" });
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3s-7.4-4.5-9.2-9C1.5 8 3.4 4.6 6.8 4.6c2 0 3.5 1.1 4.4 2.6l.8 1.3.8-1.3c.9-1.5 2.4-2.6 4.4-2.6 3.4 0 5.3 3.4 4 6.7-1.8 4.5-9.2 9-9.2 9z" fill="FILL" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const THUMB = '<svg viewBox="0 0 24 24" aria-hidden="true"><g ROT><path d="M7.5 10.5v9h-3v-9h3zm2 9h7.2a2 2 0 0 0 2-1.6l1.2-5.6a2 2 0 0 0-2-2.4h-4.4V6.2a2.2 2.2 0 0 0-2.2-2.2l-1.8 6.5z" fill="FILL" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></g></svg>';
const thumbSvg = (up, filled) => THUMB.replace("ROT", up ? "" : 'transform="rotate(180 12 12)"').replace("FILL", filled ? "currentColor" : "none");

/* ---------- state ---------- */
const S = { household:"", onhand:[], ideas:[], plan:new Map(), favs:new Map(), extras:new Map(), cart:new Map(), list:null,
  ratings:new Map(), regulars:new Map(), history:new Map(), planCfg:{ start:null, weeks:2, budget:null, exists:false }, prep:null, people:0, members:[] };
const people = () => (S.people > 0 ? S.people : defaultPeople());
const servesOf = (m) => (m && m.serves > 0 ? m.serves : people());
const servingsOf = (m) => (m && m.servings > 0 ? m.servings : people());
const factorOf = (m) => servingsOf(m) / servesOf(m);
const scaledIngs = (m) => (m.ingredients || []).map(i => Object.assign({}, i, { qty: scaledQty(i.qty, factorOf(m)) }));
const servesTag = (m) => m && m.serves > 0 ? h("span",{ class:"tag", text:"Serves " + m.serves }) : null;
const defaultPeople = () => members().length || 2;
const planBudget = () => (typeof S.planCfg.budget === "number" && S.planCfg.budget > 0) ? S.planCfg.budget : null;
const KIND_LABEL = { leftovers:"Leftovers", out:"Eating out", pick:"Pick night" };
const members = () => Array.isArray(S.members) ? S.members : [];
const memberName = (id) => { const p = members().find(x => x.id === id); return p ? p.name : "Someone"; };
const likedBy = (r) => (r && Array.isArray(r.liked) ? r.liked : []).filter(id => members().some(p => p.id === id));
const pickLabel = (m) => m && m.member ? memberName(m.member) + "'s pick" : "Pick night";
const swapState = { loading:false, items:[] };
let prepLoading = false;
const planStart = () => (S.planCfg.start && ISO_RE.test(S.planCfg.start)) ? S.planCfg.start : todayIso();
const planWeeks = () => S.planCfg.weeks === 1 ? 1 : 2;
const planEnd = () => addDays(planStart(), planWeeks() * 7 - 1);
const planDates = () => { const s = planStart(), out = []; for (let i = 0; i < planWeeks() * 7; i++) out.push(addDays(s, i)); return out; };
function mealDate(m){
  if (m && typeof m.date === "string" && ISO_RE.test(m.date)) return m.date;
  if (m && m.day && dayIndex(m.day) >= 0){ const s = planStart(); return addDays(s, (dayIndex(m.day) - parseIso(s).getDay() + 7) % 7); }
  return null;
}
function safeUrl(s){
  try { const u = new URL(String(s || "").trim()); return (u.protocol === "https:" || u.protocol === "http:") ? u.href.slice(0,500) : ""; } catch { return ""; }
}
function nameFromUrl(s){
  let u; try { u = new URL(s); } catch { return ""; }
  const segs = u.pathname.split("/").map(x => { try { return decodeURIComponent(x); } catch { return x; } }).map(x => x.replace(/\.(html?|php|aspx?)$/i,"")).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--){
    const t = segs[i].replace(/[-_+]+/g," ").replace(/\b\d+\b/g," ").replace(/\s+/g," ").trim();
    if (/[a-z]/i.test(t) && t.split(" ").length >= 2) return t.split(" ").map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ").slice(0,120);
  }
  return "";
}
function recipeLink(m){
  const fid = m.favId || favByName(m.name), f = fid ? S.favs.get(fid) : null;
  const u = safeUrl(m.url) || (f ? safeUrl(f.url) : "");
  return u ? h("div",null, h("a",{ class:"link", href:u, target:"_blank", rel:"noopener noreferrer" }, "Open recipe ↗")) : null;
}
function fitIdeas(items){ let arr = items.slice(0,60); while (arr.length > 1 && JSON.stringify(arr).length > 200000) arr = arr.slice(0,-1); return arr; }
let db = null, sample = null, samplePromise = null, canScan = false;
let localMode = false, readOnly = false, canWrite = true, aiOff = true;
let streaming = null, building = null, favEditing = null, regEditing = false, ohEditing = false, favLastGuess = "", favGuessing = null;
const favFilters = new Set();
const FAV_SECTIONS = ["Chicken & Turkey","Beef","Pork","Seafood","Meatless"];
const PROTEIN = [
  ["Seafood", /\b(shrimp|salmon|tilapia|cod|fish|tuna|crab|scallops?|mahi|catfish|halibut|lobster|clams?|mussels?)\b/],
  ["Chicken & Turkey", /\b(chicken|turkey)\b/],
  ["Beef", /\b(beef|steak|brisket|meatballs?|hamburgers?|burgers?|sirloin|chuck|short ribs?)\b/],
  ["Pork", /\b(pork|bacon|ham|sausages?|chorizo|prosciutto|pepperoni|carnitas|brats?|bratwurst)\b/]
];
function autoSection(f){
  const name = String(f.name || "").toLowerCase();
  for (const [sec, re] of PROTEIN) if (re.test(name)) return sec;
  const ings = (f.ingredients || []).filter(i => i && !i.staple).map(i => String(i.name || "").toLowerCase())
    .filter(n => !/\b(broth|stock|bouillon|fish sauce)\b/.test(n));
  for (const [sec, re] of PROTEIN) if (ings.some(n => re.test(n))) return sec;
  return ings.length ? "Meatless" : "Other";
}
const sectionOf = (f) => (f && typeof f.section === "string" && f.section.trim()) ? f.section.trim().slice(0,40) : autoSection(f || {});
function sectionOrder(names){
  const custom = names.filter(n => !FAV_SECTIONS.includes(n) && n !== "Other").sort((a,b) => a.localeCompare(b));
  return FAV_SECTIONS.filter(n => names.includes(n)).concat(custom, names.includes("Other") ? ["Other"] : []);
}
function fillSectionSelect(cur){
  const sel = $("fav-sec");
  const used = [...S.favs.values()].map(f => (typeof f.section === "string" ? f.section.trim() : "")).filter(n => n && !FAV_SECTIONS.includes(n));
  const names = [...new Set(FAV_SECTIONS.concat(used.sort((a,b) => a.localeCompare(b))))];
  sel.replaceChildren(h("option",{ value:"", text:"Automatic, by main ingredient" }), ...names.map(n => h("option",{ value:n, text:n })), h("option",{ value:"__new", text:"New section…" }));
  sel.value = cur && names.includes(cur) ? cur : "";
  $("fav-sec-new").hidden = true; $("fav-sec-new").value = "";
}
const favSuggest = new Map();
const openDetails = new Set();
const stepsLoading = new Set();
let currentTab = "ideas";

const $ = (id) => document.getElementById(id);

/* ---------- tiny DOM helper (always textContent for data) ---------- */
function h(tag, props, ...kids){
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)){
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v; // only our own constant SVG strings
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)){
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}
function empty(title, text, ...extra){ return h("div",{ class:"empty" }, h("h3",{ text:title }), h("p",{ text }), ...extra); }
const dots = () => h("span",{ class:"dots", "aria-hidden":"true" }, h("i"), h("i"), h("i"));

/* ---------- text helpers ---------- */
const newId = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const cap = (s) => { s = String(s||"").trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
function normKey(name){
  let s = String(name||"").toLowerCase().replace(/\(.*?\)/g," ").replace(/[^a-z0-9 ]+/g," ")
    .replace(/\b(fresh|large|medium|small)\b/g," ").replace(/\s+/g," ").trim();
  const parts = s.split(" "); let last = parts.pop() || "";
  if (/ies$/.test(last)) last = last.slice(0,-3) + "y";
  else if (/oes$/.test(last)) last = last.slice(0,-2);
  else if (/[^s]s$/.test(last)) last = last.slice(0,-1);
  parts.push(last);
  return parts.join(" ").trim();
}
const slug = (k) => (String(k).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,100)) || "item";
function hashStr(s){ let x = 5381; for (let i=0;i<s.length;i++) x = ((x<<5) + x + s.charCodeAt(i)) | 0; return (x>>>0).toString(36); }
function mergeNames(a, b){
  const seen = new Set(), out = [];
  for (const n of a.concat(b)){ const t = String(n||"").trim().slice(0,60); const k = normKey(t); if (!k || seen.has(k)) continue; seen.add(k); out.push(t); }
  return out.slice(0,80);
}

const FRAC = {"½":.5,"¼":.25,"¾":.75,"⅓":1/3,"⅔":2/3,"⅛":.125};
const UNITS = {lb:"lb",lbs:"lb",pound:"lb",pounds:"lb",oz:"oz",ounce:"oz",ounces:"oz",cup:"cup",cups:"cup",tbsp:"tbsp",tablespoon:"tbsp",tablespoons:"tbsp",tsp:"tsp",teaspoon:"tsp",teaspoons:"tsp",can:"can",cans:"can",clove:"clove",cloves:"clove",bunch:"bunch",bunches:"bunch",pkg:"pkg",package:"pkg",packages:"pkg",packet:"pkg",packets:"pkg",bag:"bag",bags:"bag",jar:"jar",jars:"jar",box:"box",boxes:"box",dozen:"dozen",head:"head",heads:"head",slice:"slice",slices:"slice"};
const NUM_RE = "(\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?|\\d+\\/\\d+|\\d*\\s*[½¼¾⅓⅔⅛])";
const UNIT_WORDS = Object.keys(UNITS).sort((a,b)=>b.length-a.length).join("|");
const QTY_RE = new RegExp("^" + NUM_RE + "\\s*([a-z]+)?\\.?$");
const LINE_RE = new RegExp("^(" + NUM_RE + "(?:\\s*(?:" + UNIT_WORDS + ")\\b\\.?)?)\\s+(.+)$", "i");
function parseNum(s){
  s = s.trim(); if (FRAC[s] != null) return FRAC[s];
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (m) return +m[1] + m[2]/m[3];
  m = s.match(/^(\d+)\/(\d+)$/); if (m) return m[1]/m[2];
  m = s.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/); if (m) return +m[1] + FRAC[m[2]];
  return /^\d+(\.\d+)?$/.test(s) ? +s : null;
}
function parseQty(q){
  const m = String(q||"").trim().toLowerCase().match(QTY_RE); if (!m) return null;
  const n = parseNum(m[1]); if (n == null) return null;
  if (m[2] && !UNITS[m[2]]) return null;
  return { n, u: m[2] ? UNITS[m[2]] : "" };
}
const PLURAL = {cup:"cups",can:"cans",clove:"cloves",bag:"bags",jar:"jars",box:"boxes",head:"heads",slice:"slices",pkg:"pkgs",bunch:"bunches",lb:"lb"};
function mergeQty(qs){
  qs = qs.map(q => String(q||"").trim()).filter(Boolean);
  if (!qs.length) return ""; if (qs.length === 1) return qs[0];
  const p = qs.map(parseQty);
  if (p.every(Boolean) && p.every(x => x.u === p[0].u)){
    const t = Math.round(p.reduce((a,x)=>a+x.n,0)*100)/100, u = p[0].u;
    return String(t) + (u ? " " + (t > 1 ? (PLURAL[u]||u) : u) : "");
  }
  return qs.join(" + ");
}
/* Scale a recipe amount ("1.5 lb", "2 cans", "12") by a factor, rounding to amounts people buy. */
const ROUND_UP_UNITS = new Set(["", "can", "pkg", "bag", "jar", "box", "head", "bunch", "dozen", "slice", "clove"]);
const fmtNum = (n) => String(Math.round(n * 100) / 100);
function scaledQty(q, f){
  q = String(q || "").trim();
  if (!q || !isFinite(f) || Math.abs(f - 1) < 0.01) return q;
  const p = parseQty(q);
  if (!p) return q + " (×" + fmtNum(f) + ")";
  let n = p.n * f;
  n = ROUND_UP_UNITS.has(p.u) ? Math.max(1, Math.ceil(n - 0.05)) : p.u === "oz" ? Math.max(1, Math.ceil(n)) : Math.max(0.25, Math.round(n * 4) / 4);
  return fmtNum(n) + (p.u ? " " + (n > 1 ? (PLURAL[p.u] || p.u) : p.u) : "");
}
const GUESS = [
  ["Pantry", /\bpeanut butter\b/],
  ["Frozen", /\bfrozen\b/],
  ["Canned Goods", /\b(canned|can of|black beans|pinto beans|kidney beans|refried beans|diced tomatoes|crushed tomatoes|tomato sauce|tomato paste|broth|stock|soup|enchilada sauce)\b/],
  ["Spices & Baking", /\b(salt|black pepper|cumin|paprika|chili powder|oregano|garlic powder|onion powder|cinnamon|flour|sugar|baking|seasoning|spice|thyme|cornstarch|vanilla)\b/],
  ["Meat & Seafood", /\b(beef|chicken|pork|turkey|sausage|bacon|ham|steak|shrimp|salmon|fish|tilapia|cod|meatballs|chorizo)\b/],
  ["Dairy & Eggs", /\b(milk|cheese|cheddar|mozzarella|parmesan|butter|eggs?|yogurt|sour cream|cream|half and half)\b/],
  ["Bakery & Bread", /\b(bread|buns?|tortillas?|rolls?|bagels?|pita|naan|english muffins?)\b/],
  ["Produce", /\b(onions?|garlic|tomato(es)?|potato(es)?|lettuce|spinach|bell peppers?|carrots?|celery|broccoli|cilantro|parsley|limes?|lemons?|avocados?|cucumbers?|zucchini|mushrooms?|bananas?|apples?|berries|strawberries|cabbage|kale|jalapenos?|green onions?|scallions?|ginger|squash|grapes|oranges?|herbs)\b/],
  ["Pantry", /\b(rice|pasta|spaghetti|penne|noodles?|oil|vinegar|soy sauce|sauce|ketchup|mustard|mayo|mayonnaise|oats|cereal|honey|salsa|taco shells?|breadcrumbs|crackers)\b/],
  ["Snacks & Drinks", /\b(chips|juice|soda|coffee|tea|snacks?|cookies|popcorn|water)\b/],
  ["Household", /\b(paper towels?|toilet paper|foil|plastic wrap|trash bags?|dish soap|detergent|napkins|zip bags)\b/]
];
function guessSection(name){ const s = String(name||"").toLowerCase(); for (const [sec, re] of GUESS) if (re.test(s)) return sec; return "Other"; }
const guessStaple = (name) => /\b(salt|black pepper|salt and pepper|olive oil|vegetable oil|canola oil|cooking oil|cooking spray|flour|sugar|garlic powder|onion powder|cumin|paprika|chili powder|oregano|cinnamon|italian seasoning)\b/.test(String(name||"").toLowerCase());

function parseLine(line){
  const t = String(line||"").replace(/^[\s\-*•]+/,"").trim(); if (!t) return null;
  const m = t.match(LINE_RE);
  const qty = m ? m[1].trim() : "", name = m ? m[3].trim() : t;
  const sug = favSuggest.get(normKey(name));
  return { name, qty, section: sug ? sug.section : guessSection(name), staple: sug ? !!sug.staple : guessStaple(name), have:false };
}
function normIng(i){
  if (typeof i === "string") return parseLine(i);
  if (!i || typeof i !== "object") return null;
  const name = String(i.name||"").trim().slice(0,80); if (!name) return null;
  return { name, qty: String(i.qty||"").trim().slice(0,40), section: SECTIONS.includes(i.section) ? i.section : guessSection(name), staple: !!i.staple, have: !!i.have };
}
function normMeal(o, batch, batchAt){
  const cost = ["$","$$","$$$"].includes(o.cost) ? o.cost : "";
  const mins = Math.round(Number(o.minutes));
  return {
    id: newId(), name: String(o.name||"").trim().slice(0,120), blurb: String(o.blurb||"").trim().slice(0,300),
    cost, minutes: mins > 0 && mins < 1000 ? mins : null,
    serves: (Math.round(Number(o.serves)) > 0 && Math.round(Number(o.serves)) < 100) ? Math.round(Number(o.serves)) : people(),
    ingredients: (Array.isArray(o.ingredients) ? o.ingredients : []).slice(0,30).map(normIng).filter(Boolean),
    shared: (Array.isArray(o.shared) ? o.shared : []).slice(0,8).map(s => String(s).slice(0,40)),
    batch: String(batch||"").slice(0,200), batchAt: batchAt || Date.now()
  };
}
function tryParse(line){
  line = String(line||"").trim().replace(/,$/,"");
  if (!line.startsWith("{")) return null;
  try { return JSON.parse(line); } catch { return null; }
}
function extractObjects(text){
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i=0;i<text.length;i++){
    const c = text[i];
    if (inStr){ if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{"){ if (depth === 0) start = i; depth++; }
    else if (c === "}" && depth > 0){ depth--; if (depth === 0 && start >= 0){ try { const o = JSON.parse(text.slice(start, i+1)); if (o && Array.isArray(o.meals)) out.push(...o.meals); else out.push(o); } catch {} start = -1; } }
  }
  return out;
}

/* ---------- local services: on-device store + bring-your-own-key AI ---------- */
let storeInfo = null, aiCfg = null;
const use = async (name) => {
  if (name === "db"){ if (!storeInfo) storeInfo = await TPStore.open(); return storeInfo.store; }
  if (name === "sample") return TPAI.makeClient(aiCfg = TPAI.load());
  return null;
};
async function getSample(){
  if (!sample){ toast("Add an AI key in Settings to use this."); return null; }
  return sample;
}

/* ---------- UI bits ---------- */
let toastTimer = null;
function toast(msg){ const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800); }
function setNotice(msg){ $("notice-text").textContent = msg || ""; $("notice").hidden = !msg; }
function refreshNotice(){
  if (localMode) setNotice("This browser isn't letting Three Plates save, so changes will be lost when you close it. Private browsing can cause this.");
  else setNotice("");
}
function setStatus(id, msg, isErr){ const el = $(id); el.textContent = msg || ""; el.hidden = !msg; el.classList.toggle("err", !!isErr); }
function sampleMsg(code, e){
  const detail = e && e.message ? ": " + e.message : ".";
  switch (code){
    case "no_key": return "Add an AI key in Settings to use this.";
    case "auth": return "Your AI provider rejected the key. Check it in Settings.";
    case "rate_limited": return "Your AI provider's limit was reached. Wait a bit, or switch providers in Settings.";
    case "bad_model": return "Your AI provider doesn't recognize that model. Pick another in Settings.";
    case "bad_request": return "The AI provider couldn't handle that request" + detail;
    case "network": return "Couldn't reach your AI provider. Check your connection, or try another provider in Settings.";
    case "invalid_json": return "The answer came back in a shape the app couldn't read. Try again, or pick a stronger model in Settings.";
    case "empty_completion": return "The AI didn't send anything back. Try again.";
    case "image_rejected": return "That photo couldn't be used. Try a JPG or PNG.";
    case "images_unavailable": return "This model can't read photos. Pick one that can in Settings, or type what you have.";
    case "cancelled": return "Stopped.";
    default: return "The AI request didn't work" + (e && e.message ? ": " + e.message : ". Try again in a moment.");
  }
}
function aiError(e){ return sampleMsg(e && e.code, e); }
function applyAiState(){
  const off = !sample;
  aiOff = off;
  canScan = !off && !!(aiCfg && aiCfg.vision);
  $("ask-go").disabled = off || !!streaming;
  $("fav-suggest").hidden = off;
  $("imp-toggle").hidden = off; if (off) $("imp").hidden = true;
  $("nw-carry-row").hidden = off; $("nw-carry").checked = !off;
  $("oh-scan").hidden = !canScan; $("imp-photo").hidden = !canScan;
  $("ai-off").hidden = !off;
  if (!off) setStatus("ask-status", "");
  renderAll();
}

/* ---------- writes ---------- */
async function write(op, okMsg){
  if (readOnly){ toast("This plan is view-only for you."); renderAll(); return false; }
  if (!db){ toast("Still connecting. Try again in a second."); renderAll(); return false; }
  try { await op(); askPersist(); if (okMsg) toast(okMsg); return true; }
  catch (e){
    const c = e && e.code;
    if (c === "invalid_argument" && canWrite !== true && !localMode){ readOnly = true; refreshNotice(); toast("This plan is view-only for you."); }
    else if (c === "quota_exceeded") toast("Storage is full. Remove some favorites or clear old ideas.");
    else if (c === "unavailable") toast("Couldn't save. Check your connection and try again.");
    else toast("Couldn't save that change.");
    console.warn(e); renderAll(); return false;
  }
}
const col = (name) => db.collection(name);
function planBody(m, source, favId){
  return { name:m.name, blurb:m.blurb||"", cost:m.cost||"", minutes:m.minutes||null, ingredients:m.ingredients||[], shared:m.shared||[], serves: m.serves > 0 ? m.serves : null, servings: null,
    steps:Array.isArray(m.steps) ? m.steps : [], tip:m.tip||"", url:safeUrl(m.url), source, favId:favId||null, day:null, date:null, addedAt:Date.now() };
}
function favByName(name){ const k = normKey(name); for (const [id, f] of S.favs) if (normKey(f.name) === k) return id; return null; }
const ratingKey = (name) => "r-" + slug(normKey(name));
const ratingOf = (name) => S.ratings.get(ratingKey(name)) || null;

const act = {
  togglePlan(planId, body, on){ return write(() => on ? col("plan").doc(planId).set(body) : col("plan").doc(planId).delete()); },
  removePlan(id){ return write(() => col("plan").doc(id).delete()); },
  async pinPlanCfg(){
    if (S.planCfg.exists) return true;
    const body = { start: planStart(), weeks: planWeeks(), budget: planBudget(), at: Date.now() };
    S.planCfg = Object.assign({}, body, { exists:true });
    return write(() => db.doc("settings/plan").set(body));
  },
  async setDate(id, date){
    const m = S.plan.get(id); if (m) S.plan.set(id, Object.assign({}, m, { date, day:null }));
    renderAll();
    await act.pinPlanCfg();
    return write(() => col("plan").doc(id).update({ date, day:null }),
      date ? (date === todayIso() ? "Set for tonight" : "Set for " + fmtDay(date, { weekday:"long", month:"short", day:"numeric" })) : null);
  },
  setPlanCfg(patch){
    const body = Object.assign({ start: planStart(), weeks: planWeeks(), budget: planBudget(), at: Date.now() }, patch);
    S.planCfg = Object.assign({}, body, { exists:true });
    syncCountDefault(); renderAll();
    return write(() => db.doc("settings/plan").set(body));
  },
  async fillNights(){
    const from = todayIso() > planStart() ? todayIso() : planStart();
    const taken = new Set([...S.plan.values()].map(mealDate).filter(Boolean));
    const free = planDates().filter(d => d >= from && !taken.has(d));
    const open = [...S.plan.entries()].filter(([, m]) => !mealDate(m)).sort((a,b) => (a[1].addedAt||0) - (b[1].addedAt||0));
    const pairs = open.slice(0, free.length).map(([id], i) => [id, free[i]]);
    if (!pairs.length){ toast("No open nights left in this plan"); return; }
    for (const [id, date] of pairs) S.plan.set(id, Object.assign({}, S.plan.get(id), { date, day:null }));
    renderAll();
    await act.pinPlanCfg();
    const ok = await write(async () => { for (const [id, date] of pairs) await col("plan").doc(id).update({ date, day:null }); });
    if (ok) toast("Put " + pairs.length + (pairs.length === 1 ? " dinner" : " dinners") + " on open nights");
  },
  async addSpecial(kind, member){
    if (!KIND_LABEL[kind]) return;
    const from = todayIso() > planStart() ? todayIso() : planStart();
    const taken = new Set([...S.plan.values()].map(mealDate).filter(Boolean));
    const date = planDates().find(d => d >= from && !taken.has(d)) || null;
    const id = newId();
    const body = { kind, member: kind === "pick" ? (member || null) : null, name: kind === "pick" && member ? memberName(member) + "'s pick" : KIND_LABEL[kind],
      ingredients:[], source:"special", date, day:null, addedAt:Date.now() };
    S.plan.set(id, body); renderAll();
    await act.pinPlanCfg();
    return write(() => col("plan").doc(id).set(body), body.name + (date ? " set for " + fmtDay(date, { weekday:"long", month:"short", day:"numeric" }) : " added. Pick a night for it."));
  },
  async choosePick(placeholderId, favId){
    const f = S.favs.get(favId), ph = S.plan.get(placeholderId);
    if (!f || !ph) return;
    const planId = "fav-" + favId;
    if (S.plan.has(planId)){ toast("That one is already in the plan. Choose another."); return; }
    const body = Object.assign(planBody(f, "favorite", favId), { date: ph.date || null, pick: ph.member || true });
    S.plan.delete(placeholderId); S.plan.set(planId, body); renderAll();
    return write(async () => { await col("plan").doc(planId).set(body); await col("plan").doc(placeholderId).delete(); }, pickLabel(ph) + ": " + f.name);
  },
  dismissRate(id){
    const m = S.plan.get(id); if (m) S.plan.set(id, Object.assign({}, m, { rateSkipped:true }));
    renderAll();
    return write(() => col("plan").doc(id).update({ rateSkipped:true }));
  },
  saveHousehold(notes){ return write(() => db.doc("settings/household").set({ notes, people: S.people > 0 ? S.people : null, at:Date.now() }), "Saved"); },
  setPeople(n){
    n = Math.max(1, Math.min(20, Math.round(n)));
    if (n === people() && S.people > 0) return;
    S.people = n; renderAll();
    return write(() => db.doc("settings/household").set({ notes:S.household, people:n, at:Date.now() }));
  },
  setServings(id, n){
    const v = n === people() ? null : n;
    const m = S.plan.get(id); if (m) S.plan.set(id, Object.assign({}, m, { servings: v }));
    renderAll();
    return write(() => col("plan").doc(id).update({ servings: v }));
  },
  setOnhand(items){
    S.onhand = items; renderOnhand(); renderShop(); renderCounts();
    return write(() => db.doc("settings/onhand").set({ items, at:Date.now() }));
  },
  saveFavFrom(m){
    if (favByName(m.name)){ toast("Already in favorites"); return; }
    const id = newId();
    return write(() => col("favorites").doc(id).set({ name:m.name, serves:m.serves || people(), blurb:m.blurb||"", cost:m.cost||"", minutes:m.minutes||null, ingredients:m.ingredients||[],
      steps:Array.isArray(m.steps) ? m.steps : [], tip:m.tip||"", notes:"", addedAt:Date.now() }), "Saved to favorites");
  },
  async saveFav(id, body){
    const ok = await write(() => col("favorites").doc(id).set(body), favEditing ? "Favorite updated" : "Added to favorites");
    if (ok && S.plan.has("fav-" + id)){
      const p = S.plan.get("fav-" + id);
      await write(() => col("plan").doc("fav-" + id).set(Object.assign(planBody(body, "favorite", id), { addedAt: p.addedAt || Date.now(), day: p.day || null, date: p.date || null, rateSkipped: !!p.rateSkipped, servings: p.servings || null })));
    }
    return ok;
  },
  deleteFav(id){ return write(() => col("favorites").doc(id).delete(), "Removed from favorites"); },
  async saveSteps(target, steps, tip){
    const { planId, favId } = target;
    if (planId && S.plan.has(planId)){ S.plan.set(planId, Object.assign({}, S.plan.get(planId), { steps, tip })); await write(() => col("plan").doc(planId).update({ steps, tip })); }
    if (favId && S.favs.has(favId)){ S.favs.set(favId, Object.assign({}, S.favs.get(favId), { steps, tip })); await write(() => col("favorites").doc(favId).update({ steps, tip })); }
    renderAll();
  },
  async rate(m, patch){
    const key = ratingKey(m.name), cur = S.ratings.get(key) || {};
    let liked = likedBy(cur), added = false;
    if (patch.like){
      if (liked.includes(patch.like)) liked = liked.filter(x => x !== patch.like);
      else { liked = liked.concat(patch.like); added = true; }
    }
    const body = { name:m.name, up: "up" in patch ? patch.up : (cur.up ?? null), liked, at:Date.now() };
    const clear = body.up == null && !liked.length;
    if (clear) S.ratings.delete(key); else S.ratings.set(key, body);
    renderAll();
    const ok = await write(() => clear ? col("ratings").doc(key).delete() : col("ratings").doc(key).set(body));
    if (!ok) return;
    if (patch.up === true){ if (!favByName(m.name)) await act.saveFavFrom(m); else toast("Glad it was a hit"); }
    else if (patch.up === false) toast("Got it. New ideas will steer away from this one.");
    else if (added) toast("Noted. Ideas will lean toward meals " + memberName(patch.like) + " likes.");
  },
  addExtras(names){
    const have = new Set([...S.extras.values()].map(e => normKey(e.name)));
    const fresh = names.filter(n => { const k = normKey(n); if (!k || have.has(k)) return false; have.add(k); return true; });
    if (!fresh.length) return;
    return write(async () => { for (const n of fresh) await col("extras").doc(newId()).set({ name:n.slice(0,80), addedAt:Date.now() }); });
  },
  removeExtra(id){ return write(() => col("extras").doc(id).delete()); },
  addRegulars(names){
    const have = new Set([...S.regulars.values()].map(r => normKey(r.name)));
    const fresh = names.filter(n => { const k = normKey(n); if (!k || have.has(k)) return false; have.add(k); return true; });
    if (!fresh.length) return;
    return write(async () => { for (const n of fresh) await col("regulars").doc(newId()).set({ name:n.slice(0,80), addedAt:Date.now() }); });
  },
  removeRegular(id){ return write(() => col("regulars").doc(id).delete()); },
  setCart(key, state){ return write(() => state ? col("cart").doc(key).set({ state, at:Date.now() }) : col("cart").doc(key).delete()); },
  saveIdeas(items){ S.ideas = items; return write(() => db.doc("ideas/current").set({ items, at:Date.now() })); },
  clearIdeas(){ S.ideas = []; renderIdeas(); return write(() => db.doc("ideas/current").set({ items:[], at:Date.now() }), "Ideas cleared"); },
  async repeatWeek(hst){
    const meals = Array.isArray(hst.meals) ? hst.meals : [];
    let added = 0;
    const ok = await write(async () => {
      for (const m of meals){
        const fav = m.favId ? S.favs.get(m.favId) : null;
        const id = fav ? "fav-" + m.favId : (m.id && !S.plan.has(m.id) ? m.id : newId());
        if (S.plan.has(id)) continue;
        const src = fav ? Object.assign({}, m, fav) : m;
        await col("plan").doc(id).set(planBody(src, fav ? "favorite" : (m.source || "idea"), fav ? m.favId : null));
        added++;
      }
    });
    if (Array.isArray(hst.extras) && hst.extras.length) await act.addExtras(hst.extras);
    if (ok) toast(added ? "Added " + added + (added === 1 ? " dinner" : " dinners") + " to the plan" : "Those dinners are already in the plan");
  },
  newWeek(msg){
    return write(async () => {
      if (S.plan.size || S.extras.size){
        const entries = [...S.plan.entries()].filter(([, m]) => !m.kind).sort((a,b) => String(mealDate(a[1]) || "9").localeCompare(String(mealDate(b[1]) || "9")) || ((a[1].addedAt||0) - (b[1].addedAt||0)));
        const label = fmtRange(planStart(), planEnd());
        await col("history").doc(newId()).set({ label, start:planStart(), weeks:planWeeks(), at:Date.now(),
          meals: entries.map(([id, m]) => ({ id, name:m.name, blurb:m.blurb||"", cost:m.cost||"", minutes:m.minutes||null, ingredients:m.ingredients||[],
            steps:Array.isArray(m.steps) ? m.steps : [], tip:m.tip||"", source:m.source||"idea", favId:m.favId||null, date:mealDate(m), serves:m.serves||null, servings:m.servings||null })),
          extras: [...S.extras.values()].map(e => e.name) });
        const old = [...S.history.entries()].sort((a,b) => (b[1].at||0) - (a[1].at||0)).slice(19);
        for (const [id] of old) await col("history").doc(id).delete();
      }
      for (const id of [...S.plan.keys()]) await col("plan").doc(id).delete();
      for (const id of [...S.extras.keys()]) await col("extras").doc(id).delete();
      for (const id of [...S.cart.keys()]) await col("cart").doc(id).delete();
      await db.doc("ideas/current").set({ items:[], at:Date.now() });
      await db.doc("shop/list").delete();
      await db.doc("prep/current").delete();
      await db.doc("settings/plan").set({ start: todayIso(), weeks: planWeeks(), budget: planBudget(), at: Date.now() });
    }, msg || "Plan saved to Past plans. Ready for a new one.");
  }
};

/* ---------- prompts ---------- */
const hhText = () => "Cooking for " + people() + (people() === 1 ? " person" : " people") + ". " + (S.household.trim() || DEFAULT_HH);
function tasteLines(){
  const likedNote = (r) => { const ids = likedBy(r); return ids.length ? " (" + ids.map(memberName).join(" and ") + " liked it)" : ""; };
  const loved = [...S.favs.values()].slice(0,40).map(f => f.name + likedNote(ratingOf(f.name)));
  for (const r of S.ratings.values()) if (likedBy(r).length && !favByName(r.name)) loved.push(r.name + likedNote(r));
  const disliked = [...S.ratings.values()].filter(r => r.up === false).map(r => r.name).slice(0,30);
  return { loved: loved.join("; ") || "(none yet)", disliked: disliked.join("; ") || "(none)" };
}
function ideasPrompt(req, n){
  const planned = [...S.plan.values()].filter(m => !m.kind).map(m => "- " + m.name + ": " + (m.ingredients||[]).filter(i => !i.staple).map(i => i.name).join(", ")).join("\n") || "(none yet)";
  const t = tasteLines();
  const seen = S.ideas.map(i => i.name).concat(streaming ? streaming.items.map(i => i.name) : []).slice(0,60).join("; ") || "(none)";
  const onhand = S.onhand.join(", ") || "(nothing listed)";
  return `You are helping a family plan dinners for the next ${planWeeks() === 2 ? "two weeks" : "week"}. They order all their groceries from Walmart for delivery, so every ingredient must be something Walmart sells.${planWeeks() === 2 ? " They shop once for the whole two weeks, so favor ingredients that keep (frozen, canned, pantry staples, and hardy produce like onions, potatoes, carrots and cabbage), and keep delicate fresh ingredients to a few meals they can cook early in the plan." : ""}

Household: ${hhText()}${planBudget() ? "\nGrocery budget for this whole order: about $" + planBudget() + "." : ""}

What they asked for: ${req}

Already in their kitchen (prefer meals that use these up when it fits the request): ${onhand}

Dinners already planned (when it fits the request, reuse their ingredients so less is bought overall):
${planned}

Meals the family loves: ${t.loved}
Meals they didn't like (avoid these and anything very similar): ${t.disliked}
Ideas already suggested (do not repeat these): ${seen}

Suggest ${n} dinner ideas that match the request. Write ONLY JSON Lines: exactly one JSON object per line, ${n} lines, no other text and no code fences. Each line looks like this:
{"name":"Meal name","blurb":"One sentence on why it fits their request.","cost":"$","minutes":35,"serves":${people()},"ingredients":[{"name":"boneless chicken thighs","qty":"2 lb","section":"Meat & Seafood","staple":false,"have":false}],"shared":["bell peppers","tortillas"]}

Rules:
- cost is "$" (cheap), "$$" or "$$$" for the whole meal for this household.
- minutes is the total time to make it.
- ingredients lists everything needed, with amounts for ${people()} servings. serves is ${people()}. Use plain grocery names a person would search for on Walmart, no brands.
- section is exactly one of: ${SECTIONS.join(", ")}.
- staple is true only for things most kitchens already have: salt, pepper, cooking oil, common dried spices, flour, sugar.
- have is true only when the ingredient is on the "already in their kitchen" list.
- shared lists the non-staple ingredients this meal has in common with your other suggestions or with the planned dinners.`;
}
function listPrompt(){
  const meals = [...S.plan.values()].filter(m => !m.kind).map(m => "- " + (mealDate(m) ? fmtDay(mealDate(m)) + ": " : "") + m.name + " (for " + servingsOf(m) + "): " + scaledIngs(m).map(i => (i.qty ? i.qty + " " : "") + i.name + (i.staple ? " (pantry)" : "")).join("; ")).join("\n");
  const extras = [...S.extras.values()].map(e => e.name).join("; ") || "(none)";
  return `Turn this dinner plan into one Walmart grocery delivery order that covers ${planWeeks() === 2 ? "two weeks" : "one week"}.${planWeeks() === 2 ? " Where a fresh ingredient is only needed late in the plan and a frozen or canned version works just as well, suggest that form instead." : ""}

Household: ${hhText()}

Dinners, how many each one is for, and their ingredients (amounts already scaled to that number):
${meals || "(none)"}

Other items they need: ${extras}

Already in their kitchen: ${S.onhand.join(", ") || "(nothing listed)"}
${planBudget() ? "\nTheir budget for this order is about $" + planBudget() + ", so choose value sizes and store brands where it makes sense.\n" : ""}
Combine the same ingredient across dinners into one line. Convert recipe amounts into what you would actually buy at Walmart, in common package sizes (for example "2 lb pack", "16 oz bag", "1 dozen", "1 bunch", "3 lb bag"). Keep the other items, adding a sensible size when one is obvious. Mark pantry:true for salt, pepper, oil, dried spices, flour, sugar and similar things most kitchens already stock. Mark have:true for anything on the "already in their kitchen" list, but only when what they have is clearly enough.

Reply with only a JSON array, one object per item to buy, like:
[{"item":"Shredded cheddar cheese","buy":"8 oz bag","price":2.5,"section":"Dairy & Eggs","meals":["Tacos","Quesadillas"],"pantry":false,"have":false,"search":"shredded cheddar cheese 8 oz"}]
price is your best estimate of the usual Walmart price in US dollars for that amount, as a number. It is only a rough guide.
section is exactly one of: ${SECTIONS.join(", ")}.
meals lists the dinner names that use it, or ["Extra"] for the other items.
search is a short Walmart search phrase for the item, no brand.`;
}

/* ---------- ask the AI for ideas ---------- */
async function askIdeas(text){
  if (streaming) return;
  const req = String(text != null ? text : $("ask-input").value).trim();
  if (!req){ setStatus("ask-status","Type what you're after, or tap one of the suggestions."); $("ask-input").focus(); return; }
  if (text != null) $("ask-input").value = req;
  if (!(await getSample())) return;
  const n = +$("ask-count").value || 6;
  const ctl = new AbortController();
  streaming = { prompt:req, items:[], ctl, n, at:Date.now() };
  const prompt = ideasPrompt(req, n);
  setAsking(true); setStatus("ask-status",""); renderIdeas();
  let pending = "";
  const addLine = (line) => { const o = tryParse(line); if (o && o.name && streaming && !streaming.items.some(i => normKey(i.name) === normKey(o.name))){ streaming.items.push(normMeal(o, req, streaming.at)); renderIdeas(); } };
  let finalItems = [];
  try {
    const res = await sample(prompt, { signal:ctl.signal, cache:false, onText:({ delta }) => { const lines = (pending + delta).split("\n"); pending = lines.pop(); lines.forEach(addLine); } });
    const items = streaming.items, seen = new Set(items.map(i => normKey(i.name)));
    for (const o of extractObjects(res.text)){ if (o && o.name && !seen.has(normKey(o.name))){ items.push(normMeal(o, req, streaming.at)); seen.add(normKey(o.name)); } }
    if (!items.length) throw { code:"invalid_json" };
    finalItems = items;
    if (res.truncated) setStatus("ask-status","The AI ran out of room partway. Here's what came through.");
  } catch (e){
    finalItems = streaming ? streaming.items : [];
    if (e && e.code !== "cancelled") setStatus("ask-status", aiError(e), true);
  } finally {
    if (finalItems.length) await act.saveIdeas(fitIdeas(finalItems.concat(S.ideas)));
    streaming = null; setAsking(false); renderIdeas();
  }
}
function setAsking(on){ $("ask-go").disabled = on || aiOff; $("ask-go").textContent = on ? "Thinking…" : "Get ideas"; $("ask-stop").hidden = !on; }

/* ---------- cooking steps ---------- */
async function fetchSteps(key, m, target){
  if (stepsLoading.has(key)) return;
  if (!(await getSample())) return;
  stepsLoading.add(key); renderAll();
  try {
    const ings = scaledIngs(m).map(i => (i.qty ? i.qty + " " : "") + i.name).join("; ");
    const r = await sample.json(`Write simple home-cooking steps for "${m.name}", making ${servingsOf(m)} servings. Household: ${hhText()}
Ingredients: ${ings || "(use a typical recipe)"}
Reply with only JSON like {"steps":["Preheat the oven to 425°F.","Slice the peppers and onion."],"tip":"One short optional tip, or an empty string."}
Use 4 to 10 short steps a busy parent can follow, including times and temperatures.`, { modelTier:"quick" });
    const steps = (r && Array.isArray(r.steps) ? r.steps : []).map(s => String(s).trim().slice(0,400)).filter(Boolean).slice(0,14);
    if (!steps.length) throw { code:"invalid_json" };
    const tip = r && r.tip ? String(r.tip).trim().slice(0,300) : "";
    openDetails.add(key);
    stepsLoading.delete(key);
    await act.saveSteps(target, steps, tip);
  } catch (e){ toast(aiError(e)); }
  finally { stepsLoading.delete(key); renderAll(); }
}

/* ---------- photo scan of the kitchen ---------- */
async function scanPhotos(fileList){
  let files = [...(fileList || [])];
  $("oh-file").value = "";
  if (!files.length) return;
  if (!(await getSample())) return;
  const lim = await sample.limits().catch(() => null);
  if (!lim || !lim.images){ setStatus("oh-status", sampleMsg("images_unavailable"), true); return; }
  files = files.slice(0, lim.images.maxCount || 1);
  setStatus("oh-status","Looking at your " + (files.length > 1 ? "photos" : "photo") + "… this can take up to a minute.");
  try {
    const arr = await sample.json(`These photos show a family's fridge, freezer or pantry. List the food items you can clearly see that could go into a dinner. Use short plain grocery names, like "eggs", "shredded cheddar", "frozen peas", "rice". Skip anything you can't identify and skip near-empty condiment bottles.
Reply with only a JSON array of strings.`, { images: files });
    const names = (Array.isArray(arr) ? arr : []).map(x => typeof x === "string" ? x : (x && x.name) || "").map(s => String(s).trim().toLowerCase().slice(0,60)).filter(Boolean);
    if (!names.length){ setStatus("oh-status","The AI couldn't spot any food in that photo. Try a closer, brighter shot.", true); return; }
    const before = S.onhand.length;
    await act.setOnhand(mergeNames(S.onhand, names));
    const added = S.onhand.length - before;
    setStatus("oh-status", "Found " + names.length + " items" + (added < names.length ? " (" + added + " new)" : "") + ". Tap Edit to remove anything that's wrong.");
  } catch (e){ setStatus("oh-status", aiError(e), true); }
}

/* ---------- combine shopping list with the AI ---------- */
async function buildList(){
  if (building || aiOff) return;
  if (!S.plan.size && !S.extras.size) return;
  if (!(await getSample())) return;
  const ctl = new AbortController(), sig = planSig();
  building = { ctl, count:0 }; renderShop();
  try {
    const arr = await sample.json(listPrompt(), { signal:ctl.signal, onText:({ text }) => {
      const c = (text.match(/"item"\s*:/g) || []).length;
      if (building && c !== building.count){ building.count = c; const el = $("build-count"); if (el) el.textContent = c ? c + " items so far" : ""; }
    }});
    const raw = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.items) ? arr.items : []);
    const used = new Set();
    const items = raw.filter(o => o && o.item).slice(0,150).map(o => {
      const base = slug(normKey(o.item)); let k = base, i = 2; while (used.has(k)) k = base + "-" + (i++); used.add(k);
      const price = Number(o.price);
      return { key:k, item:cap(String(o.item).slice(0,100)), buy:String(o.buy||"").slice(0,40),
        price: isFinite(price) && price > 0 && price < 500 ? Math.round(price*100)/100 : null,
        section: SECTIONS.includes(o.section) ? o.section : guessSection(o.item),
        meals: (Array.isArray(o.meals) ? o.meals : []).map(m => String(m).slice(0,80)).slice(0,8),
        pantry: !!o.pantry, have: !!o.have, search: String(o.search || o.item).slice(0,100) };
    });
    if (!items.length) throw { code:"invalid_json" };
    S.list = { items, sig, at:Date.now() };
    await write(() => db.doc("shop/list").set({ items, sig, at:Date.now() }), "Shopping list ready");
  } catch (e){
    if (e && e.code !== "cancelled") toast(aiError(e));
  } finally { building = null; renderShop(); renderCounts(); renderWeek(); }
}

/* ---------- shopping list derivation ---------- */
function planSig(){
  const meals = [...S.plan.entries()].filter(([, m]) => !m.kind).sort((a,b) => a[0] < b[0] ? -1 : 1).map(([id, m]) => id + ":" + factorOf(m).toFixed(3) + ":" + (m.ingredients||[]).map(i => i.qty + " " + i.name).join(","));
  const ex = [...S.extras.values()].map(e => normKey(e.name)).sort();
  return hashStr(JSON.stringify([meals, ex]));
}
const onhandKeys = () => new Set(S.onhand.map(normKey));
function quickList(oh){
  const groups = new Map();
  for (const m of S.plan.values()) for (const i of (m.ingredients||[])){
    const k = normKey(i.name); if (!k) continue;
    const has = !!i.have || oh.has(k);
    let g = groups.get(k);
    if (!g){ g = { key:slug(k), item:cap(i.name), qtys:[], section:SECTIONS.includes(i.section) ? i.section : guessSection(i.name), meals:[], pantry:!!i.staple, onHand:has, search:i.name }; groups.set(k, g); }
    g.qtys.push(scaledQty(i.qty, factorOf(m))); if (!g.meals.includes(m.name)) g.meals.push(m.name);
    if (!i.staple) g.pantry = false; if (!has) g.onHand = false;
  }
  for (const e of S.extras.values()){
    const k = normKey(e.name); if (!k) continue;
    const g = groups.get(k);
    if (g){ if (!g.meals.includes("Extra")) g.meals.push("Extra"); g.pantry = false; g.onHand = false; }
    else groups.set(k, { key:slug(k), item:cap(e.name), qtys:[], section:guessSection(e.name), meals:["Extra"], pantry:false, onHand:false, search:e.name });
  }
  return [...groups.values()].map(g => ({ key:g.key, item:g.item, buy:mergeQty(g.qtys), price:null, section:g.section, meals:g.meals, pantry:g.pantry, onHand:g.onHand, search:g.search }));
}
function shopState(){
  const sig = planSig(), oh = onhandKeys();
  const hasList = S.list && Array.isArray(S.list.items) && S.list.items.length;
  if (hasList && S.list.sig === sig) return { mode:"smart", items:S.list.items.map(it => Object.assign({}, it, { onHand: !!it.have || oh.has(normKey(it.item)) })) };
  return { mode: hasList ? "stale" : "quick", items: quickList(oh) };
}
function stateOf(it){ const st = S.cart.get(it.key); if (st === "need") return ""; return st || (it.onHand ? "have" : ""); }
const wmUrl = (it) => "https://www.walmart.com/search?q=" + encodeURIComponent(it.search || it.item);
function tonightMeal(){ const t = todayIso(); for (const [id, m] of S.plan) if (mealDate(m) === t) return [id, m]; return null; }
function lastNightMeal(){
  const t = todayIso(), floor = addDays(t, -7); let best = null;
  for (const [id, m] of S.plan){
    const d = mealDate(m); if (!d || d >= t || d < floor || m.rateSkipped || m.kind) continue;
    const r = ratingOf(m.name); if (r && r.up != null) continue;
    if (!best || d > best[2]) best = [id, m, d];
  }
  return best;
}

/* ---------- rendering ---------- */
function keepFocus(fn){
  const a = document.activeElement, fk = a && a.dataset ? a.dataset.fk : null;
  fn();
  if (fk){ const el = document.querySelector('[data-fk="' + CSS.escape(fk) + '"]'); if (el && el !== document.activeElement) el.focus({ preventScroll:true }); }
}
function renderAll(){ keepFocus(() => { renderHousehold(); renderOnhand(); renderTonight(); renderLastNight(); renderIdeas(); renderFavs(); renderWeek(); renderShop(); renderCounts(); }); }

function renderCounts(){
  $("c-favs").textContent = S.favs.size || "";
  const dinners = [...S.plan.values()].filter(m => !m.kind).length;
  $("c-week").textContent = dinners || "";
  let left = "";
  if (S.plan.size || S.extras.size){ const { items } = shopState(); const n = items.filter(i => !stateOf(i)).length; left = n || ""; }
  $("c-shop").textContent = left;
  const n = dinners, t = tonightMeal();
  $("sub").textContent = t ? "Tonight: " + t[1].name
    : n ? n + (n === 1 ? " dinner" : " dinners") + " planned" + (left ? " · " + left + " to buy" : "") : "Plan dinners, then shop them";
}

function renderHousehold(){
  $("pp-count").textContent = people() + (people() === 1 ? " person" : " people");
  $("pp-minus").disabled = people() <= 1;
  const t = $("hh-text");
  if (S.household.trim()){ t.textContent = S.household.trim(); t.classList.remove("unset"); }
  else { t.textContent = "No notes yet. Add ages, dislikes, busy nights or a budget so ideas fit better."; t.classList.add("unset"); }
}
function renderOnhand(){
  const t = $("oh-text"), items = S.onhand;
  if (items.length){ t.textContent = items.slice(0,8).join(", ") + (items.length > 8 ? ", +" + (items.length - 8) + " more" : ""); t.classList.remove("unset"); }
  else { t.textContent = (canScan ? "Snap the fridge or pantry, or type what you have." : "Type what you have.") + " New ideas will use it up first, and it drops off the shopping list."; t.classList.add("unset"); }
  t.hidden = ohEditing;
  $("oh-form").hidden = !ohEditing; $("oh-edit").hidden = ohEditing;
  const chips = $("oh-chips"); chips.replaceChildren();
  if (ohEditing){
    if (!items.length) chips.append(h("span",{ class:"muted", style:"font-size:.9rem", text:"Nothing listed yet." }));
    for (const name of items) chips.append(h("span",{ class:"xchip" }, h("span",{ text:name }),
      h("button",{ type:"button", "aria-label":"Remove " + name, "data-fk":"oh-" + slug(normKey(name)), text:"×", onclick:() => act.setOnhand(S.onhand.filter(n => n !== name)) })));
  }
}

function stepsBlock(key, m, target){
  const steps = Array.isArray(m.steps) ? m.steps : [];
  if (steps.length){
    return h("details",{ class:"steps", open: openDetails.has(key), ontoggle:(e) => { e.currentTarget.open ? openDetails.add(key) : openDetails.delete(key); } },
      h("summary",{ "data-fk":"st-" + key }, "How to make it (" + steps.length + " steps)"),
      h("ol",null, steps.map(s => h("li",{ text:s }))),
      m.tip ? h("p",{ class:"tip", text:"Tip: " + m.tip }) : null);
  }
  if (aiOff) return null;
  if (stepsLoading.has(key)) return h("div",{ class:"thinking sm" }, dots(), h("span",{ text:"Writing the steps…" }));
  return h("div",null, h("button",{ type:"button", class:"link", "data-fk":"gs-" + key, onclick:() => fetchSteps(key, m, target) }, "Get cooking steps"));
}
function renderTonight(){
  const box = $("tonight"); box.replaceChildren();
  const t = tonightMeal();
  box.hidden = !t || currentTab === "shop" || currentTab === "settings";
  if (!t) return;
  const [id, m] = t;
  box.append(
    h("span",{ class:"label", text:"Tonight · " + fmtDay(todayIso(), { weekday:"long" }) + (m.kind ? "" : " · for " + servingsOf(m)) }),
    h("p",{ class:"tonight-name", text: m.kind === "pick" ? pickLabel(m) : m.name }),
    h("div", null, m.kind ? h("p",{ class:"tip", text: m.kind === "pick" ? (m.member ? memberName(m.member) : "Someone") + " hasn't chosen yet. Pick on the Plan tab." : m.kind === "out" ? "No cooking tonight." : "Finish up what's in the fridge." }) : recipeLink(m)),
    h("div", null, m.kind ? null : stepsBlock("t-" + id, m, { planId:id, favId: m.favId || favByName(m.name) })));
}
function renderLastNight(){
  const box = $("lastnight"); box.replaceChildren();
  const ln = lastNightMeal();
  box.hidden = !ln || currentTab === "shop" || currentTab === "settings";
  if (!ln) return;
  const [id, m, d] = ln, r = ratingOf(m.name) || {};
  const when = d === addDays(todayIso(), -1) ? "last night's" : fmtDay(d, { weekday:"long" }) + "'s";
  box.append(
    h("span",{ class:"label", text:"After dinner" }),
    h("p",{ class:"rate-q", text:"How was " + when + " " + m.name + "?" }),
    h("div",{ class:"rate-btns" },
      h("button",{ type:"button", class:"btn small primary", "data-fk":"ln-up", onclick:() => act.rate(m, { up:true }) }, "We loved it"),
      h("button",{ type:"button", class:"btn small", "data-fk":"ln-down", onclick:() => act.rate(m, { up:false }) }, "Not again"),
      memberPills(m, "ln"),
      h("button",{ type:"button", class:"link", "data-fk":"ln-skip", onclick:() => act.dismissRate(id) }, "Skip")),
    h("p",{ class:"hint", text: favByName(m.name) ? "It's already in Favorites." : "We loved it saves it to Favorites." }));
}

function ingDetails(key, ings){
  return h("details", { class:"ings", open: openDetails.has(key), ontoggle:(e) => { e.currentTarget.open ? openDetails.add(key) : openDetails.delete(key); } },
    h("summary", { "data-fk":"det-" + key }, "Ingredients (" + ings.length + ")"),
    h("ul", null, ings.map(i => h("li", null, h("span",{ class:"q", text:i.qty || "—" }), h("span",{ text:i.name }),
      i.have ? h("span",{ class:"pantry-mark have", text:"on hand" }) : i.staple ? h("span",{ class:"pantry-mark", text:"pantry" }) : null))));
}
function metaTags(m, extra){
  const ings = m.ingredients || [], r = ratingOf(m.name);
  const toBuy = ings.filter(i => !i.staple && !i.have).length, have = ings.filter(i => i.have).length;
  return h("div",{ class:"meta" },
    extra || null,
    m.cost ? h("span",{ class:"tag cost", title:"Cost", text:m.cost }) : null,
    m.minutes ? h("span",{ class:"tag", text:m.minutes + " min" }) : null,
    ings.length ? h("span",{ class:"tag", text:toBuy + " to buy" }) : null,
    have ? h("span",{ class:"tag have", text:have + " on hand" }) : null,
    likedBy(r).map(id => h("span",{ class:"tag kid", text:memberName(id) + " liked it" })),
    r && r.up === false ? h("span",{ class:"tag meh", text:"Didn't love it" }) : null);
}
function heartBtn(m, fk){
  const saved = !!favByName(m.name);
  return h("button",{ type:"button", class:"icon-btn" + (saved ? " on" : ""), "data-fk":fk, "aria-label": saved ? "Saved to favorites" : "Save " + m.name + " to favorites", title: saved ? "In favorites" : "Save to favorites", "aria-pressed": saved ? "true" : "false",
    html: HEART.replace("FILL", saved ? "currentColor" : "none"), onclick:() => { if (!saved) act.saveFavFrom(m); else toast("Already in favorites"); } });
}

function ideaCard(m){
  const on = S.plan.has(m.id), cb = "pick-" + m.id;
  return h("li",{ class:"meal" + (on ? " on" : "") },
    h("input",{ type:"checkbox", id:cb, "data-fk":cb, checked:on, "aria-label":"Add " + m.name + " to the plan", onchange:(e) => act.togglePlan(m.id, planBody(m, "idea"), e.target.checked) }),
    h("div",{ style:"min-width:0" },
      h("h3",null, h("label",{ for:cb, text:m.name })),
      m.blurb ? h("p",{ class:"blurb", text:m.blurb }) : null,
      metaTags(m, servesTag(m)),
      (m.shared||[]).length ? h("div",{ class:"shares" }, "Shares", (m.shared||[]).map(s => h("span",{ class:"tag share", text:s }))) : null,
      (m.ingredients||[]).length ? ingDetails("i-" + m.id, m.ingredients) : null),
    h("div",{ class:"side" }, heartBtn(m, "fav-" + m.id)));
}
function thinkingRow(){
  const n = streaming ? streaming.items.length : 0;
  return h("div",{ class:"thinking" }, dots(), h("span",{ text: n ? "Writing ideas… " + n + " of " + (streaming.n || n) : "Thinking up ideas… a big batch can take a minute or two." }));
}
function renderIdeas(){
  const box = $("ideas-list"); box.replaceChildren();
  if (streaming){
    box.append(h("div",{ class:"batch" },
      h("p",{ class:"batch-head" }, h("q",{ text:streaming.prompt })),
      streaming.items.length ? h("ul",{ class:"meals" }, streaming.items.map(ideaCard)) : null,
      thinkingRow()));
  }
  const groups = []; let cur = null;
  for (const it of S.ideas){ const k = it.batchAt || 0; if (!cur || cur.k !== k){ cur = { k, prompt:it.batch || "", items:[] }; groups.push(cur); } cur.items.push(it); }
  if (!streaming && !groups.length){
    box.append(empty("Ask for dinner ideas",
      "Get dinner ideas sized for your household, with ingredients you can buy at Walmart. Check the ones you want and they go on your plan.",
      h("div",{ class:"chips" }, STARTERS.map(s => h("button",{ type:"button", class:"chip-btn", text:s, onclick:() => { $("ask-input").value = s; $("ask-input").focus(); } })))));
    return;
  }
  for (const g of groups){
    box.append(h("div",{ class:"batch" },
      h("p",{ class:"batch-head" }, g.prompt ? h("q",{ text:g.prompt }) : null, h("span",{ text:"· " + g.items.length + (g.items.length === 1 ? " idea" : " ideas") })),
      h("ul",{ class:"meals" }, g.items.map(ideaCard))));
  }
  if (groups.length && !streaming){
    const last = groups[0].prompt;
    box.append(h("div",{ class:"ideas-foot" },
      h("span",{ class:"muted", style:"font-size:.9rem", text:"Want more? Ask again above." }),
      h("div",{ class:"row" },
        last && !aiOff ? h("button",{ type:"button", class:"btn small", "data-fk":"more", onclick:() => askIdeas(last) }, "More like these") : null,
        h("button",{ type:"button", class:"btn small ghost", "data-fk":"clear-ideas", onclick:() => act.clearIdeas() }, "Clear ideas"))));
  }
}

function planCounts(){
  const c = new Map(), bump = (n) => { const k = normKey(n); if (k) c.set(k, (c.get(k) || 0) + 1); };
  for (const hst of S.history.values()) for (const m of (Array.isArray(hst.meals) ? hst.meals : [])) bump(m.name);
  for (const m of S.plan.values()) if (!m.kind) bump(m.name);
  return c;
}
function favCard(id, f, times){
  const planId = "fav-" + id, on = S.plan.has(planId), cb = "pick-" + planId;
  const delBtn = h("button",{ type:"button", class:"link danger", "data-fk":"del-" + id, text:"Delete" });
  delBtn.addEventListener("click", () => {
    if (delBtn.dataset.armed){ act.deleteFav(id); return; }
    delBtn.dataset.armed = "1"; delBtn.textContent = "Tap again to delete";
    setTimeout(() => { if (delBtn.isConnected){ delete delBtn.dataset.armed; delBtn.textContent = "Delete"; } }, 3000);
  });
  return h("li",{ class:"meal" + (on ? " on" : "") },
    h("input",{ type:"checkbox", id:cb, "data-fk":cb, checked:on, "aria-label":"Add " + f.name + " to the plan", onchange:(e) => act.togglePlan(planId, planBody(f, "favorite", id), e.target.checked) }),
    h("div",{ style:"min-width:0" },
      h("h3",null, h("label",{ for:cb, text:f.name })),
      f.blurb ? h("p",{ class:"blurb", text:f.blurb }) : null,
      f.notes ? h("p",{ class:"notes", text:f.notes }) : null,
      metaTags(f, [servesTag(f), times ? h("span",{ class:"tag", title:"Times it's been on a plan", text:"Planned " + times + "×" }) : null]),
      (f.ingredients||[]).length ? ingDetails("f-" + id, f.ingredients) : null,
      stepsBlock("fs-" + id, f, { favId:id, planId: S.plan.has(planId) ? planId : null }),
      h("div",{ class:"card-actions" },
        safeUrl(f.url) ? h("a",{ class:"link", href:safeUrl(f.url), target:"_blank", rel:"noopener noreferrer" }, "Open recipe ↗") : null,
        h("button",{ type:"button", class:"link", "data-fk":"edit-" + id, text:"Edit", onclick:() => openFavForm(id) }),
        delBtn)),
    h("span"));
}
function renderFavs(){
  const box = $("favs-list"); box.replaceChildren();
  const q = $("fav-filter").value.trim().toLowerCase();
  $("fav-filter").hidden = S.favs.size < 6;
  const favs = [...S.favs.entries()].sort((a,b) => String(a[1].name).localeCompare(String(b[1].name)));
  const fbox = $("fav-filters"); fbox.replaceChildren();
  const avail = favFilterDefs().map(x => Object.assign({}, x, { n: favs.filter(([, f]) => x.test(f)).length })).filter(x => x.n > 0 || favFilters.has(x.key));
  fbox.hidden = !avail.length || favs.length < 4;
  for (const x of avail){
    const on = favFilters.has(x.key);
    fbox.append(h("button",{ type:"button", class:"reg" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", "data-fk":"ff-" + x.key,
      text:(on ? "✓ " : "") + x.label + " · " + x.n, onclick:() => { on ? favFilters.delete(x.key) : favFilters.add(x.key); keepFocus(renderFavs); } }));
  }
  if (!favs.length){ box.append(empty("No favorites yet","Tap the heart on any idea to keep it here, or add a family recipe with Add a meal. Thumbs up on a dinner you made saves it here too.")); return; }
  let shown = q ? favs.filter(([, f]) => (f.name + " " + sectionOf(f) + " " + (f.ingredients||[]).map(i => i.name).join(" ")).toLowerCase().includes(q)) : favs;
  for (const x of favFilterDefs()) if (favFilters.has(x.key)) shown = shown.filter(([, f]) => x.test(f));
  if (!shown.length){ box.append(h("p",{ class:"muted", text:"No favorites match. Try clearing a filter or the search." })); return; }
  const groups = new Map();
  for (const e of shown){ const s = sectionOf(e[1]); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(e); }
  const counts = planCounts(), timesOf = (f) => counts.get(normKey(f.name)) || 0;
  const base = sectionOrder([...groups.keys()]);
  const order = base.slice().sort((a,b) => ((a === "Other") - (b === "Other")) || (groups.get(b).length - groups.get(a).length) || (base.indexOf(a) - base.indexOf(b)));
  for (const s of order){
    const items = groups.get(s).slice().sort((a,b) => (timesOf(b[1]) - timesOf(a[1])) || String(a[1].name).localeCompare(String(b[1].name)));
    box.append(h("section",{ class:"fav-sec" + (items.length > 6 ? " big" : ""), "aria-label":s },
      h("div",{ class:"group-h" }, h("span",{ text:s }), h("span",{ text:String(items.length) })),
      h("ul",{ class:"meals" }, items.map(([id, f]) => favCard(id, f, timesOf(f))))));
  }
}
const favFilterDefs = () => members().map(p => ({ key:"m-" + p.id, label:p.name + " liked it", test:(f) => likedBy(ratingOf(f.name)).includes(p.id) })).concat([
  { key:"quick", label:"30 min or less", test:(f) => f.minutes > 0 && f.minutes <= 30 },
  { key:"cheap", label:"Cheap", test:(f) => f.cost === "$" }
]);
function memberPills(m, fk){
  const liked = likedBy(ratingOf(m.name));
  return members().map(p => {
    const on = liked.includes(p.id);
    return h("button",{ type:"button", class:"pill" + (on ? " on" : ""), "data-fk":fk + "-" + p.id, "aria-pressed": on ? "true" : "false",
      text:(on ? "✓ " : "") + p.name + " liked it", onclick:() => act.rate(m, { like:p.id }) });
  });
}

function rateRow(m, id, compact){
  const r = ratingOf(m.name) || {};
  return h("div",{ class:"rate" },
    compact ? null : h("span",{ class:"muted", text:"How was it?" }),
    h("button",{ type:"button", class:"icon-btn sm" + (r.up === true ? " on" : ""), "data-fk":"up-" + id, "aria-pressed": r.up === true ? "true" : "false", "aria-label":"We liked it", title:"We liked it",
      html:thumbSvg(true, r.up === true), onclick:() => act.rate(m, { up: r.up === true ? null : true }) }),
    h("button",{ type:"button", class:"icon-btn sm" + (r.up === false ? " on" : ""), "data-fk":"down-" + id, "aria-pressed": r.up === false ? "true" : "false", "aria-label":"We didn't like it", title:"We didn't like it",
      html:thumbSvg(false, r.up === false), onclick:() => act.rate(m, { up: r.up === false ? null : false }) }),
    memberPills(m, "kid-" + id));
}
function daySelect(id, m, takenBy){
  const d = mealDate(m);
  const dates = planDates(); if (d && !dates.includes(d)) dates.push(d);
  dates.sort();
  const sel = h("select",{ class:"day", id:"day-" + id, "data-fk":"day-" + id, "aria-label":"Night for " + m.name, onchange:(e) => act.setDate(id, e.target.value || null) },
    h("option",{ value:"", text:"Pick a night" }),
    dates.map(x => {
      const o = takenBy.get(x), other = o && o !== id ? S.plan.get(o) : null;
      const nm = other ? String(other.name) : "";
      return h("option",{ value:x, text: fmtDay(x) + (other ? " · " + (nm.length > 22 ? nm.slice(0,21) + "…" : nm) : "") });
    }));
  sel.value = d || "";
  return sel;
}
function specialRow(id, m, takenBy){
  const d = mealDate(m);
  const body = [
    d ? h("p",{ class:"day-eyebrow", text:(d === todayIso() ? "Tonight · " : "") + fmtDay(d, { weekday:"long", month:"short", day:"numeric" }) }) : null,
    h("h3",{ text: m.kind === "pick" ? pickLabel(m) : m.name })
  ];
  if (m.kind === "pick"){
    const who = m.member ? memberName(m.member) : "They";
    const kidFavs = m.member ? [...S.favs.entries()].filter(([, f]) => likedBy(ratingOf(f.name)).includes(m.member)) : [];
    const pool = (kidFavs.length ? kidFavs : [...S.favs.entries()]).filter(([fid]) => !S.plan.has("fav-" + fid))
      .sort((a,b) => String(a[1].name).localeCompare(String(b[1].name)));
    body.push(h("p",{ class:"blurb", text: kidFavs.length ? "Let " + who + " choose from meals " + who + " liked:"
      : S.favs.size ? "Let " + who + " choose a favorite. Tap “" + who + " liked it” on meals to narrow this list." : "Add some favorites first, then " + who + " can choose one." }));
    if (pool.length) body.push(h("div",{ class:"chips", style:"margin-top:8px" },
      pool.slice(0,24).map(([fid, f]) => h("button",{ type:"button", class:"reg", "data-fk":"pk-" + id + "-" + fid, text:f.name, onclick:() => act.choosePick(id, fid) }))));
  } else {
    body.push(h("p",{ class:"blurb", text: m.kind === "out" ? "No cooking and nothing to buy." : "Finish up what's in the fridge. Nothing to buy." }));
  }
  body.push(h("div",{ class:"controls" }, daySelect(id, m, takenBy)));
  return h("li",{ class:"meal no-pick special" },
    h("div",{ style:"min-width:0" }, body),
    h("div",{ class:"side" }, h("button",{ type:"button", class:"icon-btn", "data-fk":"rm-" + id, "aria-label":"Remove " + m.name, title:"Remove", html:CLOSE, onclick:() => act.removePlan(id) })));
}
function servingsStepper(id, m){
  const n = servingsOf(m), custom = m.servings > 0 && m.servings !== people();
  const set = (v) => act.setServings(id, Math.max(1, Math.min(50, v)));
  return h("span",{ class:"stepper" + (custom ? " custom" : ""), role:"group", "aria-label":"Servings for " + m.name, title: custom ? "Different from your household size" : "Your household size" },
    h("button",{ type:"button", "data-fk":"sv-m-" + id, "aria-label":"Fewer servings", disabled: n <= 1, onclick:() => set(n - 1) }, "−"),
    h("span",{ class:"stepper-n", text: n + (n === 1 ? " serving" : " servings") }),
    h("button",{ type:"button", "data-fk":"sv-p-" + id, "aria-label":"More servings", onclick:() => set(n + 1) }, "+"));
}
function weekRow(id, m, takenBy){
  if (m.kind) return specialRow(id, m, takenBy);
  const src = m.pick ? (typeof m.pick === "string" ? memberName(m.pick) + "'s pick" : "Pick night") : m.source === "favorite" ? "Favorite" : "From ideas";
  const d = mealDate(m), t = todayIso(), isTonight = d === t, isPast = !!d && d < t;
  const sel = daySelect(id, m, takenBy);
  const r = ratingOf(m.name), unrated = !(r && r.up != null);
  return h("li",{ class:"meal no-pick" + (isTonight ? " on" : "") + (isPast ? " past" : "") },
    h("div",{ style:"min-width:0" },
      d ? h("p",{ class:"day-eyebrow", text:(isTonight ? "Tonight · " : "") + fmtDay(d, { weekday:"long", month:"short", day:"numeric" }) + (isPast && unrated ? " · How was it?" : "") }) : null,
      h("h3",{ text:m.name }),
      m.blurb ? h("p",{ class:"blurb", text:m.blurb }) : null,
      metaTags(m, h("span",{ class:"tag src", text:src })),
      (m.ingredients||[]).length ? ingDetails("w-" + id, scaledIngs(m)) : null,
      stepsBlock("ws-" + id, m, { planId:id, favId: m.favId || favByName(m.name) }),
      recipeLink(m),
      h("div",{ class:"controls" }, sel, servingsStepper(id, m), rateRow(m, id))),
    h("div",{ class:"side" },
      h("button",{ type:"button", class:"icon-btn", "data-fk":"rm-" + id, "aria-label":"Remove " + m.name + " from the plan", title:"Remove", html:CLOSE, onclick:() => act.removePlan(id) }),
      m.source !== "favorite" ? heartBtn(m, "wfav-" + id) : null));
}
function renderRegulars(){
  const box = $("reg-list"); box.replaceChildren();
  const regs = [...S.regulars.entries()].sort((a,b) => String(a[1].name).localeCompare(String(b[1].name)));
  const exByKey = new Map([...S.extras.entries()].map(([id, e]) => [normKey(e.name), id]));
  $("reg-form").hidden = !regEditing;
  $("reg-edit").textContent = regEditing ? "Done" : (regs.length ? "Edit" : "Add regulars");
  $("reg-all").hidden = !regs.length || regEditing;
  $("reg-all").disabled = regs.every(([, r]) => exByKey.has(normKey(r.name)));
  if (!regs.length && !regEditing){ box.append(h("p",{ class:"muted", style:"font-size:.9rem", text:"Save things you buy every order, like milk, eggs and bread, then add them with one tap." })); return; }
  for (const [id, r] of regs){
    if (regEditing){
      box.append(h("span",{ class:"xchip" }, h("span",{ text:r.name }), h("button",{ type:"button", "aria-label":"Remove " + r.name + " from regulars", "data-fk":"rx-" + id, text:"×", onclick:() => act.removeRegular(id) })));
    } else {
      const exId = exByKey.get(normKey(r.name));
      box.append(h("button",{ type:"button", class:"reg" + (exId ? " on" : ""), "aria-pressed": exId ? "true" : "false", "data-fk":"rg-" + id,
        "aria-label": (exId ? "Remove " : "Add ") + r.name + (exId ? " from" : " to") + " this order",
        text:(exId ? "✓ " : "+ ") + r.name, onclick:() => exId ? act.removeExtra(exId) : act.addExtras([r.name]) }));
    }
  }
}
function renderHistory(){
  const card = $("hist-card"), box = $("hist-list"); box.replaceChildren();
  const hs = [...S.history.entries()].sort((a,b) => (b[1].at||0) - (a[1].at||0));
  card.hidden = !hs.length;
  for (const [id, hst] of hs){
    const meals = Array.isArray(hst.meals) ? hst.meals : [], ex = Array.isArray(hst.extras) ? hst.extras : [];
    const toRate = meals.filter(m => { const r = ratingOf(m.name); return !(r && r.up != null); }).length;
    box.append(h("details",{ class:"hist", open: openDetails.has("h-" + id), ontoggle:(e) => { e.currentTarget.open ? openDetails.add("h-" + id) : openDetails.delete("h-" + id); } },
      h("summary",{ "data-fk":"hs-" + id, text:(hst.label || "Past plan") + " · " + meals.length + (meals.length === 1 ? " dinner" : " dinners") + (toRate ? " · " + toRate + " to rate" : "") }),
      h("ul",{ class:"hmeals" }, meals.map((m, i) => histMeal(m, id + "-" + i))),
      ex.length ? h("p",{ class:"muted", style:"font-size:.88rem;margin-bottom:8px", text:"Also: " + ex.join(", ") }) : null,
      h("button",{ type:"button", class:"btn small", "data-fk":"hr-" + id, onclick:() => act.repeatWeek(hst) }, "Add these to the plan")));
  }
}
function histMeal(m, key){
  const when = m.date && ISO_RE.test(m.date) ? fmtDay(m.date) : (m.day ? dayLong(m.day) : "");
  return h("li",{ class:"hmeal" },
    h("span",{ class:"hmeal-name" }, m.name, when ? h("small",{ text:when }) : null),
    h("span",{ class:"hmeal-act" }, rateRow(m, "h" + key, true), heartBtn(m, "hf-" + key)));
}
function renderPlanCfg(){
  const w = planWeeks(), dates = planDates();
  $("len-1").setAttribute("aria-pressed", w === 1 ? "true" : "false");
  $("len-2").setAttribute("aria-pressed", w === 2 ? "true" : "false");
  const inp = $("plan-start"); if (document.activeElement !== inp) inp.value = planStart();
  const bi = $("plan-budget"); if (document.activeElement !== bi) bi.value = planBudget() || "";
  const taken = new Set([...S.plan.values()].map(mealDate).filter(Boolean));
  const filled = dates.filter(d => taken.has(d)).length;
  $("plan-range").textContent = fmtRange(dates[0], dates[dates.length-1]) + " · " + filled + " of " + dates.length + " nights filled";
  const from = todayIso() > planStart() ? todayIso() : planStart();
  const anyOpen = [...S.plan.values()].some(m => !mealDate(m));
  const anyFree = dates.some(d => d >= from && !taken.has(d));
  $("fill-nights").hidden = !(anyOpen && anyFree);
  $("pick-btns").replaceChildren(...(members().length
    ? members().map(p => h("button",{ type:"button", class:"btn small", "data-fk":"pk-add-" + p.id, onclick:() => act.addSpecial("pick", p.id) }, p.name + "'s pick"))
    : [h("button",{ type:"button", class:"link", "data-fk":"pk-setup", onclick:() => setTab("settings") }, "Add people for pick nights")]));
}
function syncCountDefault(){
  let saved = null; try { saved = localStorage.getItem("three-plates-count"); } catch {}
  const sel = $("ask-count");
  sel.value = saved && [...sel.options].some(o => o.value === saved) ? saved : String(planWeeks() * 7);
}
function renderWeek(){
  const box = $("week-list"); box.replaceChildren();
  renderPlanCfg();
  const meals = [...S.plan.entries()].sort((a,b) => (a[1].addedAt||0) - (b[1].addedAt||0));
  const nd = meals.filter(([, m]) => !m.kind).length;
  $("week-title").textContent = nd ? nd + (nd === 1 ? " planned dinner" : " planned dinners") : "Planned dinners";
  if (!meals.length) box.append(empty("No dinners picked yet","Check meals in Ideas or Favorites and they'll show up here. Then pick a night for each one, or tap Fill open nights."));
  else {
    const takenBy = new Map();
    for (const [id, m] of meals){ const d = mealDate(m); if (d && !takenBy.has(d)) takenBy.set(d, id); }
    const start = planStart(), weeks = planWeeks(), groups = [];
    const open = meals.filter(([, m]) => !mealDate(m));
    if (open.length) groups.push({ title:"Not on a night yet", items:open });
    const dated = meals.filter(([, m]) => mealDate(m)).sort((a,b) => mealDate(a[1]).localeCompare(mealDate(b[1])) || ((a[1].addedAt||0) - (b[1].addedAt||0)));
    const byWeek = new Map();
    for (const e of dated){
      const off = Math.round((parseIso(mealDate(e[1])) - parseIso(start)) / 864e5);
      const w = off < 0 ? -1 : Math.min(Math.floor(off / 7), weeks);
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w).push(e);
    }
    for (const w of [...byWeek.keys()].sort((a,b) => a - b)){
      const title = w < 0 ? "Before this plan" : w >= weeks ? "After this plan"
        : (weeks > 1 ? "Week " + (w + 1) + " · " : "") + fmtRange(addDays(start, w * 7), addDays(start, w * 7 + 6));
      groups.push({ title, items:byWeek.get(w) });
    }
    for (const g of groups){
      box.append(h("div",{ class:"group-h" }, h("span",{ text:g.title }), h("span",{ text:String(g.items.length) })),
        h("ul",{ class:"meals" }, g.items.map(([id, m]) => weekRow(id, m, takenBy))));
    }
  }
  const ex = $("extras-list"); ex.replaceChildren();
  for (const [id, e] of [...S.extras.entries()].sort((a,b) => (a[1].addedAt||0) - (b[1].addedAt||0))){
    ex.append(h("span",{ class:"xchip" }, h("span",{ text:e.name }), h("button",{ type:"button", "aria-label":"Remove " + e.name, "data-fk":"x-" + id, onclick:() => act.removeExtra(id), text:"×" })));
  }
  const go = $("go-shop");
  go.disabled = !meals.length && !S.extras.size;
  go.textContent = (S.list && S.list.sig === planSig()) ? "Go to shopping list" : "Build shopping list";
  renderRegulars(); renderHistory(); renderPrep();
}
function renderPrep(){
  const card = $("prep-card"); card.replaceChildren();
  const dinners = [...S.plan.values()].filter(m => !m.kind);
  card.hidden = !dinners.length && !S.prep;
  if (card.hidden) return;
  const p = S.prep;
  card.append(h("div",{ class:"cfg-row" }, h("h2",{ class:"small", text:"Prep plan" }),
    p && !prepLoading && !aiOff ? h("button",{ type:"button", class:"link", "data-fk":"prep-redo", onclick:makePrep }, "Redo") : null));
  if (prepLoading){ card.append(h("div",{ class:"thinking sm" }, dots(), h("span",{ text:"Planning your prep day… this can take a minute." }))); return; }
  if (!p){
    card.append(h("p",{ class:"muted", style:"font-size:.92rem", text:"Get a batch-prep checklist for the whole plan: what to chop, cook and marinate ahead, which dinner each task is for, and what to freeze." }));
    if (!aiOff) card.append(h("div",null, h("button",{ type:"button", class:"btn small primary", "data-fk":"prep-go", onclick:makePrep }, "Make a prep plan")));
    return;
  }
  if (p.sig !== planSig()) card.append(h("p",{ class:"banner warn", text:"Your dinners changed since this prep plan was made. Tap Redo to update it." }));
  const done = new Set(Array.isArray(p.done) ? p.done : []);
  (Array.isArray(p.sessions) ? p.sessions : []).forEach((s, si) => {
    card.append(h("div",{ class:"prep-sess" },
      h("p",null, h("strong",{ text:s.title || "Prep" }), s.minutes ? h("span",{ class:"muted", text:" · about " + s.minutes + " min" }) : null),
      h("ul",{ class:"prep-list" }, (Array.isArray(s.tasks) ? s.tasks : []).map((t, ti) => {
        const k = si + "-" + ti, cid = "prep-" + k;
        return h("li",{ class:"prep-item" + (done.has(k) ? " done" : "") },
          h("input",{ type:"checkbox", id:cid, "data-fk":cid, checked:done.has(k), onchange:(e) => togglePrep(k, e.target.checked) }),
          h("label",{ for:cid }, h("span",{ text:t.text }), (t.meals || []).length ? h("small",{ text:"For " + t.meals.join(", ") }) : null));
      }))));
  });
  if ((p.storage || []).length) card.append(h("div",null, h("p",{ class:"label", text:"Storing it" }), h("ul",{ class:"prep-notes" }, p.storage.map(x => h("li",{ text:x })))));
}
function togglePrep(k, on){
  if (!S.prep) return;
  const done = new Set(Array.isArray(S.prep.done) ? S.prep.done : []);
  on ? done.add(k) : done.delete(k);
  S.prep = Object.assign({}, S.prep, { done:[...done] });
  keepFocus(renderPrep);
  return write(() => db.doc("prep/current").update({ done:[...done] }));
}
async function makePrep(){
  if (prepLoading) return;
  const dinners = [...S.plan.values()].filter(m => !m.kind);
  if (!dinners.length) return;
  if (!(await getSample())) return;
  prepLoading = true; renderPrep();
  const lines = dinners.map(m => ({ d: mealDate(m), m })).sort((a,b) => String(a.d || "9").localeCompare(String(b.d || "9")))
    .map(({ d, m }) => "- " + (d ? fmtDay(d) : "No night yet") + ": " + m.name + " (for " + servingsOf(m) + ") — " + scaledIngs(m).filter(i => !i.staple).map(i => (i.qty ? i.qty + " " : "") + i.name).join(", ")
      + ((m.steps || []).length ? " | Steps: " + m.steps.join(" ") : "")).join("\n");
  try {
    const r = await sample.json(`Make a batch-prep plan for a family's dinners. They shop once and want to prep ahead so weeknights are easy.
Household: ${hhText()}
The plan starts ${fmtDay(planStart(), { weekday:"long", month:"short", day:"numeric" })} and covers ${planWeeks() === 2 ? "two weeks" : "one week"}.
Dinners:
${lines}

Plan one main prep session at the start (about 60 to 120 minutes)${planWeeks() === 2 ? " and a short second session at the start of week 2" : ""}. Group the work by task (chop, cook grains, make sauces, marinate, portion, freeze) and say which dinners each task is for. Only prep ahead what keeps safely: cooked food and cut produce for 3 to 4 days in the fridge; freeze anything for later dinners and say when to move it to the fridge to thaw.
Reply with only JSON like {"sessions":[{"title":"Sunday, Oct 19","minutes":90,"tasks":[{"text":"Dice 3 onions; set aside 1 cup for the tacos","meals":["Tacos","Chili"]}]}],"storage":["Move the frozen chili beef to the fridge Wednesday night."]}`);
    const sessions = (r && Array.isArray(r.sessions) ? r.sessions : []).slice(0,3).map(s => {
      const mins = Math.round(Number(s && s.minutes));
      return { title:String((s && s.title) || "Prep").slice(0,60), minutes: mins > 0 && mins < 600 ? mins : null,
        tasks:(s && Array.isArray(s.tasks) ? s.tasks : []).slice(0,20).map(t => ({ text:String((t && t.text) || (typeof t === "string" ? t : "")).slice(0,300),
          meals:(t && Array.isArray(t.meals) ? t.meals : []).map(x => String(x).slice(0,60)).slice(0,6) })).filter(t => t.text) };
    }).filter(s => s.tasks.length);
    if (!sessions.length) throw { code:"invalid_json" };
    const storage = (r && Array.isArray(r.storage) ? r.storage : []).map(x => String(x).slice(0,300)).filter(Boolean).slice(0,10);
    const body = { sessions, storage, done:[], sig:planSig(), at:Date.now() };
    S.prep = body;
    await write(() => db.doc("prep/current").set(body), "Prep plan ready");
  } catch (e){ toast(aiError(e)); }
  finally { prepLoading = false; renderPrep(); }
}
async function carryOver(){
  if (!(await getSample())) return -1;
  const { items } = shopState();
  const inCart = items.filter(i => stateOf(i) === "cart");
  const bought = (inCart.length ? inCart : items.filter(i => stateOf(i) !== "have")).map(i => i.item + (i.buy ? " (" + i.buy + ")" : ""));
  const used = [...S.plan.values()].filter(m => !m.kind).map(m => "- " + m.name + ": " + scaledIngs(m).map(i => (i.qty ? i.qty + " " : "") + i.name).join("; ")).join("\n");
  try {
    const arr = await sample.json(`A family is finishing a ${planWeeks() === 2 ? "two-week" : "one-week"} meal plan. Estimate what food is probably still in their kitchen now.
Already in the kitchen before this plan: ${S.onhand.join(", ") || "(nothing listed)"}
Bought for this plan: ${bought.join("; ") || "(unknown)"}
Recipes they cooked, with amounts used:
${used}

List what is likely left over and still good: shelf-stable items, frozen items, condiments and sauces, and long-keeping produce like onions and potatoes. Leave out fresh items that would have spoiled by now and anything fully used. Add a rough amount in parentheses when it helps, like "rice (about 2 lb)".
Reply with only a JSON array of short strings.`, { modelTier:"quick" });
    const names = (Array.isArray(arr) ? arr : []).map(x => String(x).trim().slice(0,60)).filter(Boolean).slice(0,60);
    if (!names.length) return 0;
    await act.setOnhand(names);
    return names.length;
  } catch (e){ console.warn(e); return -1; }
}

function itemRow(it){
  const st = stateOf(it), id = "ck-" + it.key;
  const buyLine = [it.buy, typeof it.price === "number" ? "~$" + it.price.toFixed(2) : ""].filter(Boolean).join(" · ");
  return h("div",{ class:"item" + (st === "cart" ? " done" : "") },
    h("input",{ type:"checkbox", id, "data-fk":id, checked: st === "cart", "aria-label":"In cart: " + it.item, onchange:(e) => act.setCart(it.key, e.target.checked ? "cart" : (it.onHand ? "need" : null)) }),
    h("label",{ for:id, class:"item-main" },
      h("span",{ class:"item-name", text:it.item }),
      buyLine ? h("span",{ class:"item-buy", text:buyLine }) : null,
      (it.meals||[]).length ? h("span",{ class:"item-for", text:it.meals.join(" · ") }) : null,
      st === "have" && it.onHand ? h("span",{ class:"item-for", text:"On your kitchen list" }) : null),
    h("div",{ class:"item-act" },
      h("a",{ class:"wm", href:wmUrl(it), target:"_blank", rel:"noopener noreferrer", "aria-label":"Search Walmart for " + it.item }, "Walmart ↗"),
      h("button",{ type:"button", class:"link", style:"font-size:.8rem", "data-fk":"hv-" + it.key, text: st === "have" ? "Need it" : "Have it",
        onclick:() => act.setCart(it.key, st === "have" ? (it.onHand ? "need" : null) : "have") })));
}
function listText(items){
  const lines = ["Three Plates shopping list", ""];
  for (const sec of SECTIONS){
    const its = items.filter(i => i.section === sec && !i.pantry && stateOf(i) !== "have");
    if (!its.length) continue;
    lines.push(sec.toUpperCase()); its.forEach(i => lines.push("- " + i.item + (i.buy ? " (" + i.buy + ")" : ""))); lines.push("");
  }
  const pantry = items.filter(i => i.pantry && stateOf(i) !== "have");
  if (pantry.length){ lines.push("PANTRY CHECK (buy only if out)"); pantry.forEach(i => lines.push("- " + i.item + (i.buy ? " (" + i.buy + ")" : ""))); }
  return lines.join("\n").trim();
}
async function copyList(items, holder){
  const text = listText(items);
  try { await navigator.clipboard.writeText(text); toast("Shopping list copied"); }
  catch {
    holder.replaceChildren(h("p",{ class:"hint", text:"Copying isn't allowed here. Select the text below and copy it." }),
      h("textarea",{ class:"copy-fallback", readonly:true, "aria-label":"Shopping list text", text }));
    const ta = holder.querySelector("textarea"); ta.value = text; ta.focus(); ta.select();
  }
}
function renderShop(){
  const top = $("shop-top"), list = $("shop-list"); top.replaceChildren(); list.replaceChildren();
  if (![...S.plan.values()].some(m => !m.kind) && !S.extras.size){
    list.append(empty("Nothing to buy yet","Check meals in Ideas or Favorites, or add extra items on Plan. Your combined grocery list shows up here, grouped by aisle."));
    return;
  }
  const { mode, items } = shopState();
  const need = items.filter(i => stateOf(i) !== "have");
  const inCart = need.filter(i => stateOf(i) === "cart").length;
  const pct = need.length ? Math.round(inCart / need.length * 100) : 100;

  let est = null, budgetBox = null;
  const budget = planBudget();
  if (mode === "smart" && items.some(i => typeof i.price === "number")){
    const main = need.filter(i => !i.pantry).reduce((a,i) => a + (+i.price || 0), 0);
    const pan = need.filter(i => i.pantry).reduce((a,i) => a + (+i.price || 0), 0);
    est = h("p",{ class:"est" }, "About ", h("strong",{ text:"$" + Math.round(main) }), " for this order",
      budget ? (main > budget ? " (budget $" + budget + ")" : ", under your $" + budget + " budget") : "",
      pan >= 1 ? ". Pantry items add about $" + Math.round(pan) + " if you need them" : "", ".",
      h("span",{ class:"muted", text:" Rough estimate; Walmart prices vary." }));
    if (budget && main > budget){
      budgetBox = h("div",{ class:"banner warn" },
        h("p",{ text:"That's about $" + Math.round(main - budget) + " over your $" + budget + " budget." }),
        swapState.loading ? h("div",{ class:"thinking sm" }, dots(), h("span",{ text:"Looking for cheaper swaps…" }))
          : !aiOff ? h("div",null, h("button",{ type:"button", class:"btn small primary", "data-fk":"swaps", onclick:findSwaps }, "Find cheaper swaps")) : null);
    }
  }
  const swapList = swapState.items.length ? h("div",{ class:"banner" },
    h("p",{ class:"label", text:"Cheaper swaps" }), ...swapState.items.map(swapRow),
    h("div",null, h("button",{ type:"button", class:"link", onclick:() => { swapState.items = []; renderShop(); } }, "Hide swaps"))) : null;
  const openPicks = [...S.plan.values()].filter(m => m.kind === "pick").length;
  const pickNote = openPicks ? h("p",{ class:"banner warn", text: openPicks > 1
    ? "Some pick nights aren't chosen yet, so their ingredients aren't on this list. Choose on the Plan tab."
    : "A pick night isn't chosen yet, so its ingredients aren't on this list. Choose on the Plan tab." }) : null;

  let banner = null;
  if (building){
    banner = h("div",{ class:"banner" },
      h("div",{ class:"thinking", style:"padding:0" }, dots(),
        h("span",null, "Combining into store-sized items… ", h("span",{ id:"build-count", class:"muted", text: building.count ? building.count + " items so far" : "" }))),
      h("div",null, h("button",{ type:"button", class:"btn small ghost", onclick:() => building && building.ctl.abort() }, "Stop")));
  } else if (mode === "smart"){
    banner = h("p",{ class:"hint" }, "Combined into store-sized items. ",
      !aiOff ? h("button",{ type:"button", class:"link", "data-fk":"rebuild", onclick:buildList }, "Rebuild") : null);
  } else if (!aiOff){
    banner = h("div",{ class:"banner" + (mode === "stale" ? " warn" : "") },
      h("p",{ text: mode === "stale"
        ? "Your meals changed since this list was combined. This is a quick add-up of recipe amounts until you rebuild."
        : "This list adds up the recipe amounts. The AI can turn it into store-sized packages, catch duplicates and estimate the cost." }),
      h("div",null, h("button",{ type:"button", class:"btn small primary", "data-fk":"build", onclick:buildList }, mode === "stale" ? "Rebuild list" : "Combine with AI")));
  }
  const copyHolder = h("div");
  top.append(h("div",{ class:"card" },
    h("div",{ class:"sum-line" },
      h("span",{ class:"big", text: inCart + " of " + need.length }),
      h("span",{ class:"muted", text:"in your Walmart cart" })),
    h("div",{ class:"bar", role:"progressbar", "aria-valuemin":"0", "aria-valuemax":String(need.length), "aria-valuenow":String(inCart), "aria-label":"Items in cart" }, h("i",{ style:"width:" + pct + "%" })),
    est,
    budgetBox,
    swapList,
    pickNote,
    banner,
    h("p",{ class:"hint", text:"Tap Walmart on an item to search for it in the Walmart app or site, add it to your cart there, then check it off here." }),
    h("div",{ class:"row" }, h("button",{ type:"button", class:"btn small", "data-fk":"copy", onclick:() => copyList(items, copyHolder) }, "Copy list")),
    copyHolder));

  const receipt = h("div",{ class:"receipt" });
  const date = new Date().toLocaleDateString(undefined, { month:"short", day:"numeric" });
  receipt.append(h("div",{ class:"receipt-head" }, h("span",{ text:"Walmart order" }), h("span",{ text: need.length + " items · " + date })));
  for (const sec of SECTIONS){
    const its = need.filter(i => i.section === sec && !i.pantry);
    if (!its.length) continue;
    receipt.append(h("div",{ class:"sec-h" }, h("span",{ text:sec }), h("span",{ text:String(its.length) })), ...its.map(itemRow));
  }
  const pantry = need.filter(i => i.pantry);
  if (pantry.length){
    receipt.append(h("div",{ class:"sec-h" }, h("span",{ text:"Pantry check" }), h("span",{ text:String(pantry.length) })),
      h("p",{ class:"sec-note", text:"Usually on hand. Tap Have it for anything you don't need." }), ...pantry.map(itemRow));
  }
  const have = items.filter(i => stateOf(i) === "have");
  if (have.length){
    receipt.append(h("details",{ class:"have-list", open: openDetails.has("have"), ontoggle:(e) => { e.currentTarget.open ? openDetails.add("have") : openDetails.delete("have"); } },
      h("summary",{ text:"Already have (" + have.length + ")" }), ...have.map(itemRow)));
  }
  if (!need.length) receipt.append(h("p",{ class:"muted", style:"padding:16px 0", text:"Nothing left to buy. Everything is marked as on hand." }));
  list.append(receipt);
}

/* ---------- budget swaps ---------- */
async function findSwaps(){
  if (swapState.loading || !S.list) return;
  if (!(await getSample())) return;
  const { items } = shopState();
  const need = items.filter(i => stateOf(i) !== "have" && !i.pantry);
  const total = need.reduce((a,i) => a + (+i.price || 0), 0);
  swapState.loading = true; renderShop();
  try {
    const arr = await sample.json(`A family's Walmart grocery order is estimated at $${Math.round(total)}, but their budget is $${planBudget()}. Suggest up to 6 cheaper swaps that keep the same dinners working, for example a cheaper cut, a store brand, a bigger value size, or frozen instead of fresh.
Household: ${hhText()}
Items (item | amount | estimated price | used in):
${need.map(i => i.item + " | " + (i.buy || "") + " | " + (typeof i.price === "number" ? "$" + i.price.toFixed(2) : "?") + " | " + (i.meals || []).join(", ")).join("\n")}
Reply with only a JSON array like [{"item":"exact item name from the list","swap":"Bone-in chicken thighs","buy":"3 lb pack","price":5.5,"why":"About half the price per pound and works in both recipes."}]. Only suggest swaps that clearly save money.`);
    const byName = new Map(S.list.items.map(i => [normKey(i.item), i]));
    swapState.items = (Array.isArray(arr) ? arr : []).filter(s => s && s.item && s.swap && byName.has(normKey(s.item))).slice(0,6).map(s => {
      const orig = byName.get(normKey(s.item)), price = Number(s.price);
      return { key:orig.key, from:orig.item, fromPrice:orig.price, swap:cap(String(s.swap).slice(0,100)), buy:String(s.buy || "").slice(0,40),
        price: isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null, why:String(s.why || "").slice(0,200) };
    });
    if (!swapState.items.length) toast("The AI didn't find swaps that would clearly save money.");
  } catch (e){ toast(aiError(e)); }
  finally { swapState.loading = false; renderShop(); }
}
function swapRow(s){
  const save = (typeof s.fromPrice === "number" && typeof s.price === "number") ? s.fromPrice - s.price : null;
  return h("div",{ class:"swap" },
    h("div",{ style:"min-width:0" },
      h("p",null, h("span",{ class:"muted", text:s.from + " → " }), h("strong",{ text:s.swap }), s.buy ? " (" + s.buy + ")" : ""),
      h("p",{ class:"hint", text:(s.why || "") + (save > 0.5 ? " Saves about $" + save.toFixed(2) + "." : "") })),
    h("button",{ type:"button", class:"btn small", onclick:() => applySwap(s) }, "Use this"));
}
async function applySwap(s){
  if (!S.list) return;
  const items = S.list.items.map(i => i.key === s.key ? Object.assign({}, i, { item:s.swap, buy:s.buy || i.buy, price: s.price != null ? s.price : i.price, search:s.swap + (s.buy ? " " + s.buy : "") }) : i);
  swapState.items = swapState.items.filter(x => x !== s);
  S.list = Object.assign({}, S.list, { items });
  renderShop(); renderCounts();
  await write(() => db.doc("shop/list").set({ items, sig:S.list.sig, at:Date.now() }), "Swapped in " + s.swap);
}

/* ---------- favorites form ---------- */
function openFavForm(id){
  favEditing = id || null; favSuggest.clear(); favLastGuess = "";
  const f = id ? S.favs.get(id) : null;
  $("fav-name").value = f ? f.name : "";
  $("fav-ings").value = f ? (f.ingredients||[]).map(i => ((i.qty ? i.qty + " " : "") + i.name)).join("\n") : "";
  $("fav-notes").value = f ? (f.notes || "") : "";
  $("fav-url").value = f ? (f.url || "") : "";
  $("fav-serves").value = f && f.serves > 0 ? f.serves : people();
  $("imp").hidden = true; $("imp-text").value = ""; favImported = null;
  fillSectionSelect(f ? (f.section || "") : "");
  if (f) for (const i of (f.ingredients||[])) favSuggest.set(normKey(i.name), i);
  $("fav-save").textContent = f ? "Save changes" : "Save meal";
  setStatus("fav-status","");
  $("fav-form").hidden = false; $("fav-new").hidden = true;
  if (currentTab !== "favs") setTab("favs");
  $("fav-form").scrollIntoView({ block:"start", behavior:"smooth" });
  $("fav-name").focus({ preventScroll:true });
}
function closeFavForm(){ $("fav-form").hidden = true; $("fav-new").hidden = false; favEditing = null; }
let favImported = null;
async function importRecipe(fileList){
  const text = $("imp-text").value.trim().slice(0, 20000);
  const files = fileList ? [...fileList] : [];
  $("imp-file").value = "";
  if (!text && !files.length){ setStatus("fav-status","Paste the recipe text first, or add a screenshot.", true); $("imp-text").focus(); return; }
  if (!(await getSample())) return;
  const opts = {};
  if (files.length){
    const lim = await sample.limits().catch(() => null);
    if (!lim || !lim.images){ setStatus("fav-status", sampleMsg("images_unavailable"), true); return; }
    opts.images = files.slice(0, lim.images.maxCount || 1);
  }
  const go = $("imp-go"); go.disabled = true;
  setStatus("fav-status","Reading the recipe… this can take up to a minute.");
  try {
    const intro = files.length ? "The attached image" + (files.length > 1 ? "s show" : " shows") + " a recipe." : "Here is a recipe a family copied from a website or cookbook.";
    const r = await sample.json(`${intro} Pull out the recipe's name, how many servings it makes, every ingredient with its amount as written, and the cooking steps. Ignore ads, comments and unrelated page text.
${text ? "\nRecipe text:\n" + text + "\n" : ""}
Reply with only JSON like {"name":"Chicken Enchiladas","servings":6,"minutes":45,"ingredients":[{"name":"boneless chicken breasts","qty":"1.5 lb","section":"Meat & Seafood","staple":false}],"steps":["Preheat the oven to 375°F."]}
Use plain grocery names, no brands. section is exactly one of: ${SECTIONS.join(", ")}. staple is true only for salt, pepper, oil, dried spices, flour and sugar. minutes is the total time if the recipe gives it, otherwise null. Use at most 14 short steps.`, opts);
    const ings = (r && Array.isArray(r.ingredients) ? r.ingredients : []).map(normIng).filter(Boolean).slice(0,40);
    if (!ings.length){ setStatus("fav-status","Couldn't find an ingredient list in that. Make sure the ingredients are included, then try again.", true); return; }
    ings.forEach(i => favSuggest.set(normKey(i.name), i));
    if (!$("fav-name").value.trim() && r.name) $("fav-name").value = String(r.name).trim().slice(0,120);
    favLastGuess = $("fav-name").value.trim().toLowerCase();
    $("fav-ings").value = ings.map(i => (i.qty ? i.qty + " " : "") + i.name).join("\n");
    const steps = (Array.isArray(r.steps) ? r.steps : []).map(s => String(s).trim().slice(0,400)).filter(Boolean).slice(0,14);
    const mins = Math.round(Number(r.minutes));
    favImported = { steps, minutes: mins > 0 && mins < 1000 ? mins : null };
    const sv = Math.round(Number(r.servings)); if (sv > 0 && sv < 100) $("fav-serves").value = sv;
    $("imp").hidden = true; $("imp-text").value = "";
    setStatus("fav-status","Pulled " + ings.length + " ingredients" + (steps.length ? " and " + steps.length + " cooking steps" : "") + " from the recipe. Check them, then save.");
  } catch (e){ setStatus("fav-status", aiError(e), true); }
  finally { go.disabled = false; }
}
async function suggestIngredients(auto, fromUrl){
  const name = $("fav-name").value.trim();
  if (!name){ setStatus("fav-status","Type the meal name first.", true); $("fav-name").focus(); return; }
  if (!(await getSample())) return;
  const btn = $("fav-suggest"); btn.disabled = true; setStatus("fav-status", auto ? "Guessing ingredients for " + name + "…" : "Asking the AI…");
  const notes = $("fav-notes").value.trim();
  try {
    const arr = await sample.json(`List the grocery ingredients needed to make "${name}" for this household: ${hhText()}${notes ? " Notes: " + notes : ""}
Reply with only a JSON array like [{"name":"ground beef","qty":"1 lb","section":"Meat & Seafood","staple":false}].
Use plain grocery names, no brands. section is exactly one of: ${SECTIONS.join(", ")}. staple is true only for salt, pepper, oil, dried spices, flour and sugar.`, { modelTier:"quick" });
    const ings = (Array.isArray(arr) ? arr : []).map(normIng).filter(Boolean).slice(0,30);
    if (!ings.length) throw { code:"invalid_json" };
    ings.forEach(i => favSuggest.set(normKey(i.name), i));
    if (auto && ($("fav-ings").value.trim() || $("fav-form").hidden || $("fav-name").value.trim() !== name)){ setStatus("fav-status",""); return; }
    $("fav-ings").value = ings.map(i => (i.qty ? i.qty + " " : "") + i.name).join("\n");
    $("fav-serves").value = people();
    setStatus("fav-status", fromUrl
      ? "The AI guessed these from the meal name, not the recipe page. For the recipe's exact list, tap Import from recipe."
      : "The AI guessed " + ings.length + " ingredients. Change anything that's off, or tap Suggest with AI to try again.");
  } catch (e){ setStatus("fav-status", aiError(e), true); }
  finally { btn.disabled = false; }
}

/* ---------- device: storage protection, install ---------- */
let persistAsked = false, installPrompt = null, pendingRestore = null;
function askPersist(){
  if (persistAsked || localMode) return;
  persistAsked = true;
  TPStore.requestPersistence().then(() => renderDeviceInfo());
}
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; renderDeviceInfo(); renderWelcome(); });
window.addEventListener("appinstalled", () => { installPrompt = null; renderDeviceInfo(); renderWelcome(); TPStore.requestPersistence(); });
async function installApp(){
  if (!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch { /* dismissed */ }
  installPrompt = null; renderDeviceInfo(); renderWelcome();
}
async function renderDeviceInfo(){
  const el = $("dev-storage"); if (!el) return;
  const persisted = await TPStore.isPersisted();
  el.textContent = localMode ? "Saving is turned off in this browser, so changes will be lost when you close it. Private browsing can cause this."
    : persisted ? "Your data is saved on this device and protected from automatic cleanup."
    : "Your data is saved on this device. Installing the app helps keep the browser from clearing it.";
  $("dev-install").hidden = !installPrompt;
  $("dev-ios").hidden = !isIos() || isStandalone();
}

/* ---------- welcome ---------- */
function renderWelcome(){
  const box = $("welcome");
  let seen = false; try { seen = localStorage.getItem("three-plates-welcomed") === "1"; } catch { /* ignore */ }
  box.hidden = seen; box.replaceChildren();
  if (seen) return;
  box.append(
    h("h2",{ text:"Welcome to Three Plates" }),
    h("ul",{ class:"welcome-list" },
      h("li",{ text:"Plan dinners for one or two weeks, then shop them as one Walmart order." }),
      h("li",{ text:"Your plan is saved on this device, with no account needed. Back it up in Settings, or sign in to sync it with your family." }),
      h("li",{ text: sample ? "Your AI provider is set up, so you can ask for ideas right away."
        : "AI is optional. Add a free key from Gemini, Groq or OpenRouter in Settings to get meal ideas, or use Claude or OpenAI." }),
      h("li",{ text: installPrompt ? "Install it to use it like an app, even offline."
        : isIos() && !isStandalone() ? "On iPhone, tap Share, then Add to Home Screen to use it like an app."
        : "Once it's loaded, it works offline." })),
    h("div",{ class:"row" },
      !sample ? h("button",{ type:"button", class:"btn small primary", onclick:() => setTab("settings") }, "Set up AI") : null,
      installPrompt ? h("button",{ type:"button", class:"btn small", onclick:installApp }, "Install") : null,
      h("button",{ type:"button", class:"btn small ghost", onclick:() => { try { localStorage.setItem("three-plates-welcomed","1"); } catch { /* ignore */ } renderWelcome(); } }, "Got it")));
}

/* ---------- backups ---------- */
const lastBackup = () => { try { return Number(localStorage.getItem("three-plates-last-backup")) || 0; } catch { return 0; } };
function renderBackupInfo(){
  const t = lastBackup();
  $("bk-last").textContent = t ? "Last backup: " + new Date(t).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" }) : "No backup yet.";
}
function downloadBackup(){
  const data = TPStore.exportData(db);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
  const a = h("a",{ href:URL.createObjectURL(blob), download:"three-plates-backup-" + todayIso() + ".json", hidden:true });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  try { localStorage.setItem("three-plates-last-backup", String(Date.now())); } catch { /* ignore */ }
  renderBackupInfo(); $("backup-note").hidden = true;
  toast("Backup downloaded");
}
async function chooseBackup(file){
  $("bk-file").value = "";
  if (!file) return;
  try {
    const entries = TPStore.readBackup(JSON.parse(await file.text()));
    const count = (pre) => [...entries.keys()].filter(p => p.startsWith(pre + "/")).length;
    pendingRestore = entries;
    $("bk-summary").textContent = "This backup has " + count("favorites") + " favorites, " + count("plan") + " planned nights and "
      + count("history") + " past plans. Restoring replaces everything in this browser with it.";
    $("bk-confirm").hidden = false; setStatus("bk-status","");
  } catch (e){
    pendingRestore = null; $("bk-confirm").hidden = true;
    setStatus("bk-status", e instanceof SyntaxError ? "That file couldn't be read. Pick the .json backup file from Three Plates." : (e && e.message) || "That file couldn't be read.", true);
  }
}
async function restoreBackup(){
  if (!pendingRestore) return;
  try {
    await TPStore.importData(db, pendingRestore);
    pendingRestore = null; $("bk-confirm").hidden = true;
    openDetails.clear(); swapState.items = [];
    setStatus("bk-status","Backup restored.");
    toast("Backup restored");
  } catch (e){ setStatus("bk-status", "Couldn't restore the backup: " + ((e && e.message) || "storage error"), true); }
}
function checkBackupNudge(){
  if (localMode) return;
  let first = 0, snooze = 0;
  try {
    first = Number(localStorage.getItem("three-plates-first-use")) || 0;
    if (!first){ first = Date.now(); localStorage.setItem("three-plates-first-use", String(first)); }
    snooze = Number(localStorage.getItem("three-plates-backup-snooze")) || 0;
  } catch { return; }
  const now = Date.now(), DAY = 864e5, last = lastBackup();
  const hasData = S.favs.size + S.plan.size + S.history.size > 0;
  const due = last ? now - last > 14 * DAY : now - first > 3 * DAY;
  $("backup-text").textContent = last ? "It's been a couple of weeks since your last backup." : "Your plan is only saved in this browser. Download a backup to keep it safe.";
  $("backup-note").hidden = !(hasData && due && now > snooze);
}

/* ---------- family sync (optional, signed-in households) ---------- */
let syncState = { available:null }, syncConfirm = null, linkDismissed = false;
const hasLocalData = () => S.favs.size + S.plan.size + S.history.size > 0;
function syncAgo(t){
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : new Date(t).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
}
function syncStatusText(s){
  const waiting = s.pending ? " " + s.pending + (s.pending === 1 ? " change" : " changes") + " waiting." : "";
  switch (s.status){
    case "syncing": return "· Syncing…";
    case "ok": return "· Synced " + syncAgo(s.lastSync);
    case "offline": return "· Offline. Changes sync when you're back." + waiting;
    case "paused": return "· Paused for today." + waiting;
    case "error": return "· Sync problem." + waiting;
    default: return "";
  }
}
function renderSync(){
  const s = syncState, card = $("sync-card");
  if (!card) return;
  card.hidden = !s.available || localMode;
  if (card.hidden) return;
  const hh = s.household, linked = !!hh && !s.needsLink;
  $("sy-out").hidden = !!s.signedIn;
  $("sy-out-note").textContent = s.status === "signed_out" ? "You're signed out, so this device has stopped syncing. Sign in again to pick up where you left off." : "";
  $("sy-in").hidden = !s.signedIn;
  if (!s.signedIn){ setStatus("sy-status", s.error || "", !!s.error); return; }
  const provider = s.user && ({ aad:"Microsoft", github:"GitHub" })[s.user.provider];
  $("sy-who").textContent = s.user ? "Signed in as " + s.user.name + (provider ? " with " + provider : "") + "." : "";
  if (!$("sy-name").value && s.user) $("sy-name").value = s.user.name;

  // A confirmation waiting on the user: one they asked for, or linking this device to their household.
  const c = syncConfirm || (hh && s.needsLink && !linkDismissed ? {
    text: "You're in " + hh.name + ". Use its plan on this device? It replaces what's here" + (hasLocalData() ? ", and a backup of this device downloads first." : "."),
    yes: "Use the household's plan" } : null);
  $("sy-confirm").hidden = !c;
  if (c){ $("sy-confirm-text").textContent = c.text; $("sy-yes").textContent = c.yes; }

  $("sy-none").hidden = !!hh || !!c;
  $("sy-hh-box").hidden = !linked;
  $("sy-unlink").hidden = !linked;
  $("sy-leave").hidden = !hh;
  if (linked){
    $("sy-hh-name").textContent = hh.name;
    $("sy-state").textContent = syncStatusText(s);
    const owner = hh.role === "owner";
    $("sy-members").replaceChildren(...hh.members.map(m => h("span",{ class:"xchip" },
      h("span",{ text: m.name + (m.you ? " (you)" : "") + (m.role === "owner" ? " · owner" : "") }),
      owner && !m.you ? h("button",{ type:"button", "aria-label":"Remove " + m.name, text:"×", onclick:() => askSync({
        text: "Remove " + m.name + " from " + hh.name + "? They keep what's on their device but stop syncing.", yes: "Remove",
        run: () => TPSync.removeMember(m.id) }) }) : null)));
  }
  setStatus("sy-status", s.error || "", !!s.error);
}
function askSync(c){ syncConfirm = c; $("sy-invite-box").hidden = true; renderSync(); }
async function syncAct(btn, fn, okMsg){
  if (btn) btn.disabled = true;
  setStatus("sy-status", "");
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e){ setStatus("sy-status", (e && e.message) || "That didn't work. Try again.", true); return false; }
  finally { if (btn) btn.disabled = false; }
}
async function linkDevice(){
  if (hasLocalData()) downloadBackup();
  await TPSync.link("replace");
}
function wireSync(){
  const ret = () => { const code = $("sy-code").value.trim(); return code ? "#join=" + encodeURIComponent(code) : "#settings"; };
  $("sy-ms").addEventListener("click", () => TPSync.signIn("aad", ret()));
  $("sy-gh").addEventListener("click", () => TPSync.signIn("github", ret()));
  $("sy-signout").addEventListener("click", () => TPSync.signOut());
  $("sy-create").addEventListener("click", () => syncAct($("sy-create"),
    () => TPSync.create($("sy-hh").value.trim(), $("sy-name").value.trim()), "Household created. Invite your family next."));
  $("sy-join").addEventListener("click", () => {
    const code = $("sy-code").value.trim().toUpperCase();
    if (!code){ setStatus("sy-status", "Enter the invite code first.", true); $("sy-code").focus(); return; }
    const run = async () => { await TPSync.join(code, $("sy-name").value.trim()); await linkDevice(); $("sy-code").value = ""; };
    if (!hasLocalData()){ syncAct($("sy-join"), run, "You're in. Your household's plan is syncing."); return; }
    askSync({ text: "Joining replaces the plan on this device with your household's plan. A backup of this device downloads first.",
      yes: "Join and replace", run, ok: "You're in. Your household's plan is syncing." });
  });
  $("sy-yes").addEventListener("click", async () => {
    const c = syncConfirm || (syncState.needsLink ? { run: linkDevice } : null);
    syncConfirm = null;
    if (c) await syncAct($("sy-yes"), c.run, c.ok);
    renderSync();
  });
  $("sy-no").addEventListener("click", () => {
    if (!syncConfirm && syncState.needsLink) linkDismissed = true;
    syncConfirm = null;
    renderSync();
  });
  $("sy-now").addEventListener("click", () => TPSync.syncNow());
  $("sy-invite").addEventListener("click", () => syncAct($("sy-invite"), async () => {
    const r = await TPSync.invite();
    $("sy-invite-code").textContent = r.code;
    $("sy-invite-box").hidden = false;
  }));
  $("sy-share").addEventListener("click", async () => {
    const code = $("sy-invite-code").textContent, url = location.origin + "/#join=" + code;
    const text = "Join our kitchen on Three Plates. Invite code: " + code;
    try {
      if (navigator.share) await navigator.share({ title:"Three Plates", text, url });
      else { await navigator.clipboard.writeText(text + "\n" + url); toast("Invite link copied"); }
    } catch { /* share sheet closed */ }
  });
  $("sy-unlink").addEventListener("click", () => askSync({
    text: "Stop syncing on this device? Your plan stays here, and you stay in the household on your other devices.", yes: "Stop syncing",
    run: async () => { TPSync.unlink(); linkDismissed = true; } }));
  $("sy-leave").addEventListener("click", () => askSync({
    text: "Leave " + ((syncState.household && syncState.household.name) || "the household") + "? Your plan stays on this device. If you're the last one in it, the household's synced data is deleted.",
    yes: "Leave household", run: () => TPSync.leave(), ok: "You left the household" }));
  $("sy-delete").addEventListener("click", () => askSync({
    text: "Delete your sync data? You leave your household, and if you're the last one in it, its synced data is deleted. Your plan stays on this device.",
    yes: "Delete and sign out", run: async () => { await TPSync.deleteAccount(); TPSync.signOut(); } }));
}

/* ---------- settings ---------- */
function aiFormRead(){
  const provider = $("ai-provider").value, p = TPAI.PRESETS[provider] || TPAI.PRESETS.custom;
  return { provider, key:$("ai-key").value.trim(), model:$("ai-model").value.trim(),
    base: provider === "custom" ? $("ai-base").value.trim() : p.base, vision:$("ai-vision").checked };
}
function aiFormFill(cfg){
  const provider = cfg && TPAI.PRESETS[cfg.provider] ? cfg.provider : "gemini";
  const p = TPAI.PRESETS[provider], same = !!cfg && cfg.provider === provider;
  $("ai-provider").value = provider;
  $("ai-key").value = same ? cfg.key || "" : "";
  $("ai-model").value = same && cfg.model ? cfg.model : p.model;
  $("ai-base").value = same && cfg.base ? cfg.base : p.base;
  $("ai-vision").checked = same ? !!cfg.vision : p.vision;
  const p2 = TPAI.PRESETS[provider];
  $("ai-note").textContent = p2.note;
  const kl = $("ai-keylink"); kl.hidden = !p2.keyUrl; if (p2.keyUrl) kl.href = p2.keyUrl;
  $("ai-base-field").hidden = provider !== "custom";
  $("ai-models").replaceChildren();
}
function renderAiSummary(){
  const el = $("ai-current");
  el.textContent = aiCfg && sample ? "Using " + (TPAI.PRESETS[aiCfg.provider] || TPAI.PRESETS.custom).label + " · " + aiCfg.model : "No AI provider set up yet.";
}
function renderSettingsMembers(){
  const box = $("mem-list"); if (!box) return;
  box.replaceChildren();
  if (!members().length){ box.append(h("span",{ class:"muted", style:"font-size:.9rem", text:"No one added yet." })); return; }
  for (const p of members()) box.append(h("span",{ class:"xchip" }, h("span",{ text:p.name }),
    h("button",{ type:"button", "aria-label":"Remove " + p.name, "data-fk":"mx-" + p.id, text:"×", onclick:() => saveMembers(members().filter(x => x.id !== p.id)) })));
}
function renderSettings(){ renderAiSummary(); renderSettingsMembers(); renderBackupInfo(); renderDeviceInfo(); }
function saveMembers(list){
  S.members = list; renderAll(); renderSettingsMembers();
  return write(() => db.doc("settings/members").set({ list, at:Date.now() }));
}
function wireSettings(){
  const sel = $("ai-provider");
  sel.replaceChildren(...Object.entries(TPAI.PRESETS).map(([k, p]) => h("option",{ value:k, text:p.label })));
  aiFormFill(TPAI.load());
  sel.addEventListener("change", () => {
    const cur = TPAI.load(), p = TPAI.PRESETS[sel.value];
    aiFormFill(cur && cur.provider === sel.value ? cur : { provider:sel.value, key:"", model:p.model, base:p.base, vision:p.vision });
    setStatus("ai-status","");
  });
  $("ai-show").addEventListener("click", () => {
    const k = $("ai-key"); k.type = k.type === "password" ? "text" : "password";
    $("ai-show").textContent = k.type === "password" ? "Show" : "Hide";
  });
  $("ai-save").addEventListener("click", () => {
    const cfg = aiFormRead();
    if (!TPAI.validBase(cfg.base)){ setStatus("ai-status","The API address must start with https:// (or http://localhost for a model on this computer).", true); return; }
    if (!cfg.key && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(cfg.base)){ setStatus("ai-status","Paste your API key first.", true); $("ai-key").focus(); return; }
    if (!cfg.model){ setStatus("ai-status","Enter a model name, or tap Load models.", true); return; }
    if (!TPAI.save(cfg)){ setStatus("ai-status","This browser won't let the app save the key.", true); return; }
    aiCfg = cfg; sample = TPAI.makeClient(cfg);
    applyAiState(); renderWelcome(); renderAiSummary();
    setStatus("ai-status","Saved. Tap Test to check that it works.");
  });
  $("ai-test").addEventListener("click", async () => {
    const b = $("ai-test"); b.disabled = true; setStatus("ai-status","Testing…");
    try { const r = await TPAI.test(aiFormRead()); setStatus("ai-status","It works. The model replied: “" + r + "”"); }
    catch (e){ setStatus("ai-status", aiError(e), true); }
    finally { b.disabled = false; }
  });
  $("ai-remove").addEventListener("click", () => {
    TPAI.clear(); aiCfg = null; sample = null;
    aiFormFill(null); applyAiState(); renderWelcome(); renderAiSummary();
    setStatus("ai-status","Key removed from this browser.");
  });
  $("ai-load").addEventListener("click", async () => {
    const cfg = aiFormRead();
    if (!cfg.key && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(cfg.base)){ setStatus("ai-status","Paste your API key first, then load models.", true); return; }
    setStatus("ai-status","Loading models…");
    try {
      const ids = await TPAI.listModels(cfg);
      $("ai-models").replaceChildren(...ids.map(id => h("option",{ value:id })));
      setStatus("ai-status", ids.length ? ids.length + " models found. Clear the Model box and start typing to pick one." : "No models found for this key.");
    } catch (e){ setStatus("ai-status", aiError(e), true); }
  });
  $("ai-off-go").addEventListener("click", () => { setTab("settings"); window.scrollTo({ top:0 }); });
  $("mem-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = $("mem-input").value.trim().slice(0,30);
    if (!n) return;
    if (members().some(p => p.name.toLowerCase() === n.toLowerCase())){ toast(n + " is already on the list"); return; }
    $("mem-input").value = "";
    saveMembers(members().concat([{ id:"p" + Date.now().toString(36) + Math.random().toString(36).slice(2,5), name:n }]));
  });
  $("bk-export").addEventListener("click", downloadBackup);
  $("bk-file").addEventListener("change", (e) => chooseBackup(e.target.files && e.target.files[0]));
  $("bk-yes").addEventListener("click", restoreBackup);
  $("bk-no").addEventListener("click", () => { pendingRestore = null; $("bk-confirm").hidden = true; });
  $("dev-install").addEventListener("click", installApp);
  $("bn-now").addEventListener("click", downloadBackup);
  $("bn-later").addEventListener("click", () => {
    try { localStorage.setItem("three-plates-backup-snooze", String(Date.now() + 7 * 864e5)); } catch { /* ignore */ }
    $("backup-note").hidden = true;
  });
}

/* ---------- tabs ---------- */
const TABS = ["ideas","favs","week","shop","settings"];
function setTab(t){
  if (!TABS.includes(t)) t = "ideas";
  currentTab = t;
  for (const b of document.querySelectorAll(".tab")){ const on = b.dataset.tab === t; b.setAttribute("aria-selected", on ? "true" : "false"); if (on) try { b.scrollIntoView({ block:"nearest", inline:"nearest" }); } catch {} }
  for (const p of TABS) $("p-" + p).hidden = p !== t;
  renderTonight(); renderLastNight();
  if (t === "settings") renderSettings();
  try { localStorage.setItem("three-plates-tab", t); } catch {}
}

/* ---------- wiring ---------- */
const splitNames = (s) => String(s||"").split(/[,\n]/).map(x => x.trim()).filter(Boolean);
function wire(){
  for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => { setTab(b.dataset.tab); window.scrollTo({ top:0 }); });
  $("quick-chips").append(...QUICK.map(q => h("button",{ type:"button", class:"chip-btn", text:q, onclick:() => {
    const ta = $("ask-input"), v = ta.value.trim();
    ta.value = v ? v.replace(/[.\s]*$/,"") + ". " + q + "." : q + ".";
    ta.focus();
  } })));
  $("ask-go").addEventListener("click", () => askIdeas());
  $("ask-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)){ e.preventDefault(); askIdeas(); } });
  $("ask-stop").addEventListener("click", () => streaming && streaming.ctl.abort());
  $("ask-count").addEventListener("change", () => { try { localStorage.setItem("three-plates-count", $("ask-count").value); } catch {} });
  for (const b of [$("len-1"), $("len-2")]) b.addEventListener("click", () => { const w = +b.dataset.weeks; if (w !== planWeeks()) act.setPlanCfg({ weeks:w }); });
  $("plan-start").addEventListener("change", (e) => { const v = e.target.value; if (ISO_RE.test(v) && v !== planStart()) act.setPlanCfg({ start:v }); });
  $("fill-nights").addEventListener("click", () => act.fillNights());
  for (const b of document.querySelectorAll("[data-special]")) b.addEventListener("click", () => act.addSpecial(b.dataset.special));
  $("plan-budget").addEventListener("change", (e) => { const v = Number(e.target.value); act.setPlanCfg({ budget: v > 0 ? Math.round(v) : null }); });

  $("pp-minus").addEventListener("click", () => act.setPeople(people() - 1));
  $("pp-plus").addEventListener("click", () => act.setPeople(people() + 1));
  $("hh-edit").addEventListener("click", () => { $("hh-input").value = S.household; $("hh-form").hidden = false; $("hh-text").hidden = true; $("hh-edit").hidden = true; $("hh-input").focus(); });
  const closeHh = () => { $("hh-form").hidden = true; $("hh-text").hidden = false; $("hh-edit").hidden = false; };
  $("hh-cancel").addEventListener("click", closeHh);
  $("hh-save").addEventListener("click", async () => { const v = $("hh-input").value.trim().slice(0,600); S.household = v; renderHousehold(); closeHh(); await act.saveHousehold(v); });

  $("oh-edit").addEventListener("click", () => { ohEditing = true; renderOnhand(); $("oh-input").focus(); });
  $("oh-done").addEventListener("click", () => { ohEditing = false; renderOnhand(); });
  $("oh-clear").addEventListener("click", () => act.setOnhand([]));
  $("oh-add").addEventListener("submit", (e) => { e.preventDefault(); const names = splitNames($("oh-input").value); if (!names.length) return; $("oh-input").value = ""; act.setOnhand(mergeNames(S.onhand, names)); });
  $("oh-file").addEventListener("change", (e) => scanPhotos(e.target.files));

  $("fav-new").addEventListener("click", () => openFavForm(null));
  $("fav-cancel").addEventListener("click", closeFavForm);
  $("fav-suggest").addEventListener("click", () => suggestIngredients(false));
  const autoGuess = (fromUrl) => {
    const name = $("fav-name").value.trim();
    if (name.length < 3 || $("fav-ings").value.trim() || aiOff || favGuessing || name.toLowerCase() === favLastGuess) return;
    favLastGuess = name.toLowerCase();
    favGuessing = suggestIngredients(true, !!fromUrl).finally(() => { favGuessing = null; });
  };
  $("fav-name").addEventListener("change", () => autoGuess(false));
  $("fav-url").addEventListener("change", () => {
    const raw = $("fav-url").value.trim(), u = safeUrl(raw);
    if (!u){ if (raw) setStatus("fav-status","That doesn't look like a web link. It should start with https://", true); return; }
    if (!$("fav-name").value.trim()){ const n = nameFromUrl(u); if (n) $("fav-name").value = n; }
    if (!$("fav-ings").value.trim()) autoGuess(true);
  });
  $("imp-toggle").addEventListener("click", () => { const p = $("imp"); p.hidden = !p.hidden; if (!p.hidden) $("imp-text").focus(); });
  $("imp-go").addEventListener("click", () => importRecipe(null));
  $("imp-file").addEventListener("change", (e) => importRecipe(e.target.files));
  $("fav-name").addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); $("fav-ings").focus(); autoGuess(); } });
  $("fav-filter").addEventListener("input", renderFavs);
  $("fav-sec").addEventListener("change", (e) => { const nw = e.target.value === "__new"; $("fav-sec-new").hidden = !nw; if (nw) $("fav-sec-new").focus(); });
  $("fav-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("fav-name").value.trim().slice(0,120);
    if (!name){ setStatus("fav-status","Give the meal a name.", true); $("fav-name").focus(); return; }
    if (favGuessing && !$("fav-ings").value.trim()) await favGuessing;
    const ingredients = $("fav-ings").value.split("\n").map(parseLine).filter(Boolean).slice(0,40);
    const id = favEditing || newId();
    const prev = favEditing ? S.favs.get(favEditing) || {} : {};
    if (!favEditing && favByName(name)){ setStatus("fav-status","A favorite with that name already exists.", true); return; }
    const imp = favImported && favImported.steps.length ? favImported : null;
    const sv = $("fav-sec").value;
    const section = sv === "__new" ? $("fav-sec-new").value.trim().slice(0,40) : sv;
    const body = { name, section, serves: Math.max(1, Math.min(50, Math.round(Number($("fav-serves").value)) || people())), blurb:prev.blurb || "", cost:prev.cost || "", minutes:(favImported && favImported.minutes) || prev.minutes || null, ingredients, notes:$("fav-notes").value.trim().slice(0,300),
      steps: imp ? imp.steps : (Array.isArray(prev.steps) ? prev.steps : []), tip: imp ? "" : (prev.tip || ""), url: safeUrl($("fav-url").value), addedAt:prev.addedAt || Date.now() };
    if (await act.saveFav(id, body)) closeFavForm();
  });

  $("extra-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const names = splitNames($("extra-input").value);
    if (!names.length) return;
    $("extra-input").value = ""; act.addExtras(names);
  });
  $("reg-edit").addEventListener("click", () => { regEditing = !regEditing; renderRegulars(); if (regEditing) $("reg-input").focus(); });
  $("reg-form").addEventListener("submit", (e) => { e.preventDefault(); const names = splitNames($("reg-input").value); if (!names.length) return; $("reg-input").value = ""; act.addRegulars(names); });
  $("reg-all").addEventListener("click", () => act.addExtras([...S.regulars.values()].map(r => r.name)));
  $("go-shop").addEventListener("click", () => {
    setTab("shop"); window.scrollTo({ top:0 });
    if (shopState().mode !== "smart" && !aiOff) buildList();
  });
  $("nw-ask").addEventListener("click", () => { $("nw-start").hidden = true; $("nw-confirm").hidden = false; });
  $("nw-no").addEventListener("click", () => { $("nw-start").hidden = false; $("nw-confirm").hidden = true; });
  $("nw-yes").addEventListener("click", async () => {
    const btn = $("nw-yes"); if (btn.disabled) return;
    btn.disabled = true;
    let carried = null;
    if ($("nw-carry").checked && !aiOff && [...S.plan.values()].some(m => !m.kind)){
      setStatus("nw-status","Estimating leftovers… this takes a few seconds.");
      carried = await carryOver();
      setStatus("nw-status","");
    }
    btn.disabled = false;
    $("nw-start").hidden = false; $("nw-confirm").hidden = true; openDetails.clear(); swapState.items = [];
    await act.newWeek(carried > 0 ? "New plan started. Added " + carried + " likely leftovers to the kitchen list."
      : carried === -1 ? "New plan started. Couldn't estimate leftovers this time." : null);
    setTab("ideas");
  });
}

function subscribe(){
  const onErr = (e) => { if (e && e.code === "revoked") setNotice("This plan is no longer available to you."); console.warn(e); };
  const mapOf = (q) => new Map(q.docs.map(d => [d.id, d.data() || {}]));
  db.doc("settings/household").onSnapshot((s) => { const d = (s.exists && s.data()) || {}; S.household = String(d.notes || ""); S.people = Number(d.people) > 0 ? Math.round(Number(d.people)) : 0; renderAll(); }, onErr);
  db.doc("settings/plan").onSnapshot((s) => {
    const d = s.exists ? s.data() : null;
    S.planCfg = d ? { start: ISO_RE.test(String(d.start || "")) ? d.start : null, weeks: d.weeks === 1 ? 1 : 2, budget: typeof d.budget === "number" && d.budget > 0 ? d.budget : null, exists:true }
      : { start:null, weeks:2, budget:null, exists:false };
    syncCountDefault(); renderAll();
  }, onErr);
  db.doc("settings/members").onSnapshot((s) => {
    const d = s.exists ? s.data() : null;
    S.members = d && Array.isArray(d.list) ? d.list.filter(x => x && x.id && x.name) : [];
    renderAll(); renderSettingsMembers();
  }, onErr);
  db.doc("prep/current").onSnapshot((s) => { S.prep = s.exists ? s.data() : null; keepFocus(renderPrep); }, onErr);
  db.doc("settings/onhand").onSnapshot((s) => { const d = s.exists ? s.data() : null; S.onhand = d && Array.isArray(d.items) ? d.items.map(String) : []; keepFocus(() => { renderOnhand(); renderShop(); renderCounts(); }); }, onErr);
  db.doc("ideas/current").onSnapshot((s) => { const d = s.exists ? s.data() : null; S.ideas = d && Array.isArray(d.items) ? d.items : []; keepFocus(renderIdeas); }, onErr);
  col("plan").onSnapshot((q) => { S.plan = mapOf(q); renderAll(); }, onErr);
  col("favorites").onSnapshot((q) => { S.favs = mapOf(q); renderAll(); }, onErr);
  col("ratings").onSnapshot((q) => { S.ratings = mapOf(q); renderAll(); }, onErr);
  col("extras").onSnapshot((q) => { S.extras = mapOf(q); keepFocus(() => { renderWeek(); renderShop(); renderCounts(); }); }, onErr);
  col("regulars").onSnapshot((q) => { S.regulars = mapOf(q); keepFocus(renderRegulars); }, onErr);
  col("history").onSnapshot((q) => { S.history = mapOf(q); keepFocus(() => { renderHistory(); renderFavs(); }); }, onErr);
  col("cart").onSnapshot((q) => { S.cart = new Map(q.docs.map(d => [d.id, (d.data()||{}).state])); keepFocus(() => { renderShop(); renderCounts(); }); }, onErr);
  db.doc("shop/list").onSnapshot((s) => { S.list = s.exists ? s.data() : null; keepFocus(() => { renderWeek(); renderShop(); renderCounts(); }); }, onErr);
}

async function start(){
  wire(); wireSettings(); wireSync();
  let saved = null; try { saved = localStorage.getItem("three-plates-tab"); } catch {}
  const hash = (location.hash || "").slice(1);
  const joinCode = /^join=([A-Za-z0-9]{4,16})$/.exec(decodeURIComponent(hash));
  if (joinCode){ $("sy-code").value = joinCode[1].toUpperCase(); history.replaceState(null, "", location.pathname); }
  setTab(joinCode ? "settings" : TABS.includes(hash) ? hash : ({ favorites:"favs", tonight:"week", plan:"week" })[hash] || saved || "ideas");
  syncCountDefault();
  sample = await use("sample");
  db = await use("db");
  localMode = !storeInfo.persistent;
  refreshNotice();
  applyAiState();
  subscribe();
  renderWelcome(); renderSettings();
  if (!localMode) TPSync.init(db, (st) => { syncState = st; renderSync(); });
  setTimeout(checkBackupNudge, 600);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("/sw.js").catch(e => console.warn("Service worker", e));
}
start();
})();
