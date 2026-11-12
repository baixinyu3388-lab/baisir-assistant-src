/* 白sir 的个人助手 · v3.0 (2026-11-12)
 * 纯静态、无构建、无后端。数据只在本机 localStorage（key: baiAssistant_v2，与 v2.2 完全兼容）。
 */
(function(){
"use strict";

/* ================= 常量 ================= */
var VERSION = "3.0.0";
var KEY = "baiAssistant_v2";          // 不要改：v2.2 的数据就在这里
var V1KEY = "skinReset_v1";           // 更早的《护肤打卡》页
var UNLOCK_KEY = "baiUnlocked";       // sessionStorage：当前标签页已解锁
var SHARECODE = "XQYKQCQM2D";         // WorkBuddy 网关参数（自有服务器上无害）
var WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=28.155&longitude=112.935&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day&hourly=uv_index,precipitation_probability,temperature_2m,apparent_temperature,weather_code&daily=uv_index_max,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=Asia%2FShanghai&forecast_days=2";
var WX_TIMEOUT = 9000;                // 单次请求超时（国内网络到 Open-Meteo 偶尔慢）
var WX_STALE_MIN = 30;                // 缓存超过 30 分钟，回到前台时自动刷新
var DOW_NAMES = ["周一","周二","周三","周四","周五","周六","周日"];
var FIXED_SLOTS = {am:1,vc:1,out:1,noon:1,sport:1,pm:1,chore:1,sleep:1};
var TODO_TYPES = [
  {id:"notice",label:"班长通知",lead:1440,extra:120,alarms:["-P1D","-PT2H"]},
  {id:"ddl",   label:"作业 / DDL",lead:1440,extra:0,alarms:["-P1D"]},
  {id:"meet",  label:"会议 / 集合",lead:30, extra:0,alarms:["-PT30M"]},
  {id:"pay",   label:"缴费 / 生活",lead:120,extra:0,alarms:["-PT2H"]},
  {id:"skin",  label:"护肤",      lead:5,  extra:0,alarms:["-PT5M"]}
];
var VIEWS = ["today","timetable","todos","skin","settings"];
var SUBS = {todos:["list","notice","remind"], skin:["plan","checkin","kit"]};

var state = null, S = null, appReady = false, fired = {}, notifTimer = null;
var TODAY, TODAY_KEY;
var ui = {view:"today", sub:{todos:"list", skin:"plan"}, expanded:{}, ttScope:"week", ttEdit:null, ttDay:0, wxLoading:false, wxFailed:false};
var todoQuery = {scope:"all", riskSort:false, text:""};

function setToday(){ TODAY = new Date(); TODAY.setHours(0,0,0,0); TODAY_KEY = fmt(TODAY); }

/* ================= 工具 ================= */
function pad(n){ n = String(n); return n.length < 2 ? "0" + n : n; }
function fmt(d){ return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
function parse(s){ var p = String(s).split("-"); return new Date(+p[0], +p[1]-1, +p[2]); }
function addDays(d,n){ var x = new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
function md(d){ return (d.getMonth()+1) + "/" + d.getDate(); }
function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function dowIdx(d){ return (d.getDay()+6)%7; }
function hhmm(m){ m = Math.max(0, Math.round(m)); return pad(Math.floor(m/60)) + ":" + pad(m%60); }
function toMin(s){ var p = String(s||"08:00").split(":"); return (+p[0])*60 + (+p[1]||0); }
function num(v,dft){ return (typeof v === "number" && isFinite(v)) ? v : dft; }
function isObj(v){ return v && typeof v === "object" && Object.prototype.toString.call(v) === "[object Object]"; }
function fill(dst,def){
  for(var k in def){ if(!Object.prototype.hasOwnProperty.call(def,k)) continue;
    if(dst[k] === undefined || dst[k] === null) dst[k] = def[k];
    else if(isObj(def[k]) && isObj(dst[k])) fill(dst[k], def[k]);
  }
  return dst;
}
function localISO(v){ if(!v) return ""; var s = String(v); return (s.length===16 ? s+":00" : s) + "+08:00"; }
function dateCN(s){ var p = String(s||"").slice(0,10).split("-"); return (+p[1]) + "月" + (+p[2]) + "日"; }
function timeCN(s){ return String(s||"").slice(11,16); }
function dtShort(ms){ var d = new Date(ms); return (d.getMonth()+1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function uid(){ return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function $(id){ return document.getElementById(id); }
function qsa(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function nowMin(){ var d = new Date(); return d.getHours()*60 + d.getMinutes(); }
/* 24 小时制时间输入规范化："8"→08:00，"800"→08:00，"20：30"→20:30，"8点半"→08:30；非法返回 null */
function normTime(v){
  var s = String(v||"").trim().replace(/：/g,":").replace(/点半/,":30").replace(/[点时]/,":").replace(/分$/,"");
  var m = s.match(/^(\d{1,2}):(\d{1,2})$/) || s.match(/^(\d{1,2})(\d{2})$/) || s.match(/^(\d{1,2}):?$/);
  if(!m) return null;
  var h = +m[1], mi = m[2] === undefined ? 0 : +m[2];
  if(h > 23 || mi > 59) return null;
  return pad(h) + ":" + pad(mi);
}
function toast(msg){
  var t = $("toast"); if(!t) return;
  t.textContent = msg; t.className = "toast on";
  clearTimeout(t._timer); t._timer = setTimeout(function(){ t.className = "toast"; }, 2400);
}
function setPressed(btns, fn){ btns.forEach(function(b){ var on = !!fn(b); b.setAttribute("aria-pressed", on ? "true" : "false"); b.classList.toggle("on", on); }); }
setToday();

/* ================= 默认数据 / 存储 / 迁移（与 v2.2 一致） ================= */
// 中南大学 2026-2027 学年第一学期真实课表（第 9-20 周截图转录，周一=0）
// weeks:{from,to,odd,list} 可选；缺失=每周。odd:null 每周 / true 单周 / false 双周。
function sampleTimetable(){
  return [
    [
      {name:"新生课", start:"10:00", end:"11:40", place:"潇湘校区-D座121", tag:"", weeks:{from:9,to:12,odd:null}},
      {name:"习近平新时代中国特色社会主义思想概论", start:"14:00", end:"15:40", place:"潇湘校区-C座502", tag:"", weeks:{from:9,to:20,odd:null}},
      {name:"军事理论", start:"16:00", end:"17:40", place:"潇湘校区-D座104", tag:"", weeks:{from:9,to:20,odd:null}}
    ],
    [
      {name:"高等数学A（一）", start:"08:00", end:"09:40", place:"潇湘校区-B座212", tag:"", weeks:{from:10,to:20,odd:false}}
    ],
    [
      {name:"高等数学A（一）", start:"08:00", end:"09:40", place:"潇湘校区-B座212", tag:"", weeks:{from:9,to:20,odd:null}},
      {name:"普通化学C", start:"10:00", end:"11:40", place:"潇湘校区-C座209", tag:"", weeks:{from:9,to:13,odd:null}}
    ],
    [
      {name:"习近平新时代中国特色社会主义思想概论", start:"08:00", end:"09:40", place:"潇湘校区-C座502", tag:"", weeks:{from:10,to:20,odd:false}},
      {name:"体育（一）", start:"10:00", end:"11:40", place:"潇湘校区", tag:"体育", weeks:{from:9,to:20,odd:null}},
      {name:"新生课", start:"14:00", end:"15:40", place:"潇湘校区-B座404", tag:"", weeks:{from:9,to:12,odd:null}},
      {name:"高等数学A（一）", start:"16:00", end:"17:40", place:"潇湘校区-B座212", tag:"", weeks:{from:9,to:20,odd:null}}
    ],
    [
      {name:"大学计算机基础", start:"08:00", end:"09:40", place:"潇湘校区-C座407", tag:"", weeks:{from:9,to:17,odd:null}},
      {name:"普通化学C", start:"10:00", end:"11:40", place:"潇湘校区-C座206", tag:"", weeks:{from:9,to:13,odd:null}},
      {name:"大学英语（一）", start:"14:00", end:"15:40", place:"潇湘校区-外语网络楼229", tag:"", weeks:{from:9,to:20,odd:null}},
      {name:"大学生心理健康教育（一）", start:"16:00", end:"17:40", place:"潇湘校区-B座412", tag:"", weeks:{from:11,to:17,odd:true}}
    ],
    [],
    []
  ];
}
function defaults(){
  return {
    meta:{schema:2,migratedFrom:null,pinEnabled:false,pinHash:"",tz:"Asia/Shanghai"},
    skin:{startDate:fmt(new Date()),days:{},checks:{},bought:{},maskOn:false,vcOn:false,uviOverride:null},
    timetable:sampleTimetable(),
    timetableIsSample:false,
    todos:[],
    weatherCache:{data:null,fetchedAt:null},
    settings:{notifEnabled:false,lastIcsExport:null,semesterStart:"2026-09-07",totalWeeks:20,dailyReviewIcs:true}
  };
}
function readV1(){ try { return JSON.parse(localStorage.getItem(V1KEY) || "null"); } catch(e){ return null; } }
function applyV1(s,v1){
  if(!v1) return false;
  if(v1.startDate) s.skin.startDate = v1.startDate;
  if(v1.days) s.skin.days = v1.days;
  if(v1.checks) s.skin.checks = v1.checks;
  if(v1.bought) s.skin.bought = v1.bought;
  s.skin.maskOn = !!v1.maskOn;
  s.skin.vcOn = !!v1.vcOn;
  if(v1.uvi === "low" || v1.uvi === "high") s.skin.uviOverride = v1.uvi;
  return true;
}
function load(){
  var s = defaults();
  try { var raw = JSON.parse(localStorage.getItem(KEY) || "null"); if(isObj(raw)) s = fill(raw, defaults()); } catch(e){}
  if(!Array.isArray(s.timetable) || s.timetable.length !== 7) s.timetable = sampleTimetable();
  for(var i=0;i<7;i++) if(!Array.isArray(s.timetable[i])) s.timetable[i] = [];
  if(!Array.isArray(s.todos)) s.todos = [];
  if(!s.meta.migratedFrom){
    var v1 = readV1();
    if(v1 && applyV1(s,v1)) s.meta.migratedFrom = "skinReset_v1";
  }
  return s;
}
function save(){
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch(e){ toast("保存失败：浏览器存储不可用（无痕模式？）"); }
}
function refreshRefs(){ S = state.skin; }

/* ================= 天气 ================= */
function wxCode(c){
  if(c===0) return "晴"; if(c===1||c===2) return "多云"; if(c===3) return "阴";
  if(c===45||c===48) return "雾"; if(c>=51&&c<=57) return "毛毛雨";
  if(c>=61&&c<=67) return "雨"; if(c>=71&&c<=77) return "雪";
  if(c>=80&&c<=82) return "阵雨"; if(c>=95) return "雷雨";
  return "多云";
}
function hourlyIdx(j,hour){
  if(!j || !j.hourly || !Array.isArray(j.hourly.time)) return -1;
  var t = j.hourly.time, target = fmt(new Date()) + "T" + pad(hour) + ":00", i;
  i = t.indexOf(target); if(i >= 0) return i;
  for(i=0;i<t.length;i++){ if(String(t[i]).slice(0,10) === fmt(new Date())) return i; }
  return t.length ? 0 : -1;
}
function dval(d,k){ return (d && Array.isArray(d[k]) && typeof d[k][0] === "number") ? d[k][0] : null; }
function wxView(j,hour){
  var o = {ok:false,temp:null,apparent:null,rh:null,wind:null,code:3,cloud:null,
           precip:0,pop:0,uvi:0,uviMax:null,tmax:null,tmin:null,hour:hour};
  if(!j) return o;
  var cur = j.current || {}, h = j.hourly || {}, dl = j.daily || {}, idx = hourlyIdx(j,hour);
  function hv(k,dft){ return (idx>=0 && Array.isArray(h[k]) && typeof h[k][idx] === "number") ? h[k][idx] : dft; }
  o.temp = num(cur.temperature_2m, null);
  o.apparent = hv("apparent_temperature", num(cur.apparent_temperature, null));
  o.rh = num(cur.relative_humidity_2m, null);
  o.wind = num(cur.wind_speed_10m, null);
  o.code = num(cur.weather_code, 3);
  o.cloud = num(cur.cloud_cover, null);
  o.precip = num(cur.precipitation, 0);
  o.pop = hv("precipitation_probability", num(dval(dl,"precipitation_probability_max"),0));
  o.uvi = hv("uv_index", num(dval(dl,"uv_index_max"),0));
  o.uviMax = dval(dl,"uv_index_max");
  o.tmax = dval(dl,"temperature_2m_max"); o.tmin = dval(dl,"temperature_2m_min");
  o.sport = false; o.ok = true; o.hour = hour;
  return o;
}
function effectiveUVI(w){
  var ov = S.uviOverride;
  if(ov === "low") return 2;
  if(ov === "high") return 5;
  return num(w.uvi, 0);
}
function dressAdvice(w){
  if(!w.ok || w.apparent === null) return "天气数据还没拿到，先看窗外；下雨就带雨衣，头盔照戴。";
  var t = w.apparent, s;
  if(t >= 28) s = "短袖、透气，防晒是重点";
  else if(t >= 22) s = "短袖或薄长袖";
  else if(t >= 16) s = "长袖 + 薄外套，早晚温差大带一件";
  else if(t >= 10) s = "卫衣 / 夹克 + 长裤";
  else if(t >= 5) s = "厚外套 / 薄羽绒";
  else s = "羽绒 + 围巾";
  s += "（体感 " + Math.round(t) + "℃）";
  if(w.pop >= 50 || w.precip > 0) s += "；有雨，穿雨衣别打伞骑车，头盔戴好、慢骑";
  if(num(w.wind,0) >= 20) s += "；风大，加件防风外层";
  if(w.tmax !== null && w.tmin !== null && (w.tmax - w.tmin) >= 8) s += "；今天温差大，洋葱式穿脱";
  if(num(w.rh,0) >= 90) s += "；湿度高有点闷，到教室把汗按干";
  return s + "。";
}
function sunAdvice(uvi, sport){
  var s;
  if(uvi < 3) s = "UVI " + uvi.toFixed(1) + " < 3：脸可以不涂，靠头盔硬防晒就够；长时间靠窗坐仍建议涂（UVA 穿玻璃）";
  else if(uvi < 6) s = "UVI " + uvi.toFixed(1) + "：涂 SPF30+ PA+++ 日常防晒（脸约一元硬币量），户外每 2 小时补涂";
  else if(uvi < 8) s = "UVI " + uvi.toFixed(1) + "：上 SPF50+，加帽子，尽量避开 10–16 点";
  else s = "UVI " + uvi.toFixed(1) + "：珀莱雅盾护 SPF50+ 或别在户外久待";
  if(sport) s += "。今天有体育课 / 户外，盾护强防水当晚必须卸妆；没买卸妆膏就普通防晒补涂 + 帽子";
  s += "。只看 UVI，不看晴雨。";
  return s;
}
/* 首页一眼版：短句；点开看完整原文（完整版与 v2.2 一字不差） */
function dressShort(w){
  if(!w.ok || w.apparent === null) return "先看窗外，头盔照戴";
  var t = w.apparent, s;
  if(t >= 28) s = "短袖、透气"; else if(t >= 22) s = "短袖或薄长袖"; else if(t >= 16) s = "长袖 + 薄外套";
  else if(t >= 10) s = "卫衣 / 夹克 + 长裤"; else if(t >= 5) s = "厚外套 / 薄羽绒"; else s = "羽绒 + 围巾";
  if(w.pop >= 50 || w.precip > 0) s += " · 有雨穿雨衣";
  return s;
}
function sunShort(uvi, sport){
  var s;
  if(uvi < 3) s = "UVI < 3 · 脸可不涂"; else if(uvi < 6) s = "SPF30+ 日常防晒"; else if(uvi < 8) s = "SPF50+ + 帽子"; else s = "盾护 SPF50+ / 少待户外";
  if(sport) s += " · 体育课补涂";
  return s;
}
function renderWeather(){
  if(!appReady) return;
  var cache = state.weatherCache || {};
  var w = wxView(cache.data, outHour());
  var has = !!(cache.data && w.ok);
  $("wxTemp").textContent = has && w.temp !== null ? (Math.round(w.temp) + "°") : "--";
  $("wxDesc").textContent = has ? wxCode(w.code) : (ui.wxLoading ? "获取中…" : "天气暂不可用");
  var range = [];
  if(has && w.tmax!==null && w.tmin!==null) range.push(Math.round(w.tmax) + "° / " + Math.round(w.tmin) + "°");
  if(has && w.rh!==null) range.push("湿度 " + w.rh + "%");
  if(has && w.wind!==null) range.push("风 " + Math.round(w.wind) + " km/h");
  $("wxRange").textContent = range.length ? range.join(" · ") : "接口连不上时显示上次缓存";
  var uvEff = Math.round(effectiveUVI(w)*10)/10;
  var cells = [
    ["体感", has && w.apparent!==null ? Math.round(w.apparent)+"°" : "--"],
    ["降水", has ? Math.round(w.pop)+"%" : "--"],
    ["出门 UVI", (has || S.uviOverride) ? String(uvEff) + (S.uviOverride ? "*" : "") : "--"],
    ["UVI 峰值", has && w.uviMax!==null ? String(Math.round(w.uviMax*10)/10) : "--"]
  ];
  $("wxStats").innerHTML = cells.map(function(c){ return "<div><dt>"+esc(c[0])+"</dt><dd>"+esc(c[1])+"</dd></div>"; }).join("");
  $("advCloth").textContent = dressAdvice(w);
  $("advSun").textContent = sunAdvice(effectiveUVI(w), hasSport());
  $("advClothS").textContent = dressShort(w);
  $("advSunS").textContent = sunShort(effectiveUVI(w), hasSport());
  var ft = cache.fetchedAt ? new Date(cache.fetchedAt) : null, stamp;
  if(!ft || isNaN(ft.getTime())) stamp = "暂无缓存";
  else {
    var sameDay = fmt(ft) === TODAY_KEY;
    stamp = "更新于 " + (sameDay ? "" : md(ft) + " ") + pad(ft.getHours()) + ":" + pad(ft.getMinutes());
    if(!sameDay) stamp += "（不是今天的数据）";
  }
  var pre = ui.wxLoading ? "刷新中 · " : (ui.wxFailed ? (has ? "网络不通，显示上次结果 · " : "网络不通 · ") : "");
  $("wxStamp").textContent = pre + stamp + (S.uviOverride ? " · *UVI 手动" : "");
  $("wxCard").classList.toggle("is-stale", !!ui.wxFailed);
  $("wxRetry").classList.toggle("spin", !!ui.wxLoading);
}
/* 超时 + 一次重试；失败时保留 localStorage 里的上次结果。天气不进 Service Worker 缓存。 */
function fetchOnce(){
  return new Promise(function(resolve, reject){
    var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null, settled = false;
    var timer = setTimeout(function(){ if(settled) return; settled = true; if(ctl) ctl.abort(); reject(new Error("timeout")); }, WX_TIMEOUT);
    var opts = {cache:"no-store"}; if(ctl) opts.signal = ctl.signal;
    fetch(WEATHER_URL, opts).then(function(r){
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function(j){
      if(settled) return; settled = true; clearTimeout(timer);
      if(!j || !j.current) { reject(new Error("bad data")); return; }
      resolve(j);
    }).catch(function(e){ if(settled) return; settled = true; clearTimeout(timer); reject(e); });
  });
}
function fetchWeather(){
  if(ui.wxLoading) return;
  ui.wxLoading = true; renderWeather();
  fetchOnce().catch(function(){
    return new Promise(function(r){ setTimeout(r, 1200); }).then(fetchOnce);
  }).then(function(j){
    state.weatherCache = {data:j, fetchedAt:new Date().toISOString()};
    save(); ui.wxLoading = false; ui.wxFailed = false;
    renderWeather(); renderTimeline();
  }).catch(function(){
    ui.wxLoading = false; ui.wxFailed = true; renderWeather();
  });
}
function weatherIsStale(){
  var f = state.weatherCache && state.weatherCache.fetchedAt;
  if(!f) return true;
  return (Date.now() - new Date(f).getTime()) > WX_STALE_MIN*60000;
}

/* ================= 教学周 / 周次过滤（同 v2.2） ================= */
function currentTeachingWeek(){
  var total = num(state.settings.totalWeeks, 20);
  var ss = state.settings.semesterStart;
  if(!ss || !/^\d{4}-\d{2}-\d{2}$/.test(ss)) return {valid:false,n:null,parity:null,reason:"config",total:total};
  var anchor = parse(ss);
  if(isNaN(anchor.getTime())) return {valid:false,n:null,parity:null,reason:"config",total:total};
  anchor.setHours(0,0,0,0);
  var monday = addDays(anchor, -((anchor.getDay()+6)%7));
  var diff = Math.floor((TODAY - monday) / 86400000);
  var n = Math.floor(diff/7) + 1;
  var parity = (n % 2 === 1) ? "odd" : "even";
  if(diff < 0) return {valid:false,n:n,parity:parity,reason:"before",total:total};
  if(n > total) return {valid:false,n:n,parity:parity,reason:"after",total:total};
  return {valid:true,n:n,parity:parity,reason:"",total:total};
}
function courseInWeek(c, w, total){
  var wk = c && c.weeks;
  if(!isObj(wk) || !Object.keys(wk).length) return true;
  if(!w || typeof w.n !== "number") return true;
  var n = w.n;
  if(total && n > total) return false;
  if(Array.isArray(wk.list) && wk.list.length){
    for(var i=0;i<wk.list.length;i++) if(+wk.list[i] === n) return true;
    return false;
  }
  var from = (typeof wk.from === "number") ? wk.from : 1;
  var to = (typeof wk.to === "number") ? wk.to : (total || Infinity);
  if(n < from || n > to) return false;
  if(wk.odd === true && n % 2 !== 1) return false;
  if(wk.odd === false && n % 2 !== 0) return false;
  return true;
}
function weeksLabel(wk, total){
  if(!isObj(wk) || !Object.keys(wk).length) return "每周";
  if(Array.isArray(wk.list) && wk.list.length) return wk.list.join(",") + " 周";
  var range = num(wk.from,1) + "-" + num(wk.to,total) + " 周";
  if(wk.odd === true) return "单周 " + range;
  if(wk.odd === false) return "双周 " + range;
  return range;
}
/* 编辑时回填到输入框：保证 parseWeeksToken 能原样解析回来 */
function weeksInput(wk){
  if(!isObj(wk) || !Object.keys(wk).length) return "";
  if(Array.isArray(wk.list) && wk.list.length) return wk.list.join(",");
  var has = (typeof wk.from === "number" || typeof wk.to === "number");
  var r = has ? (num(wk.from,1) + "-" + num(wk.to,num(state.settings.totalWeeks,20))) : "";
  if(wk.odd === true) return ("单周 " + r).trim();
  if(wk.odd === false) return ("双周 " + r).trim();
  return r ? r + "周" : "";
}
function isWeekWord(w){
  if(/^(单周|双周|每周|单|双|每)$/.test(w)) return true;
  if(/周/.test(w) && /^[\d\-~,周单双每\s]+$/.test(w)) return true;
  if(/^[\d,\-~]+$/.test(w)) return true;
  return false;
}
function expandList(s){
  var out=[], segs=String(s).split(/[,，]/);
  for(var i=0;i<segs.length;i++){
    var seg=segs[i].trim(), m=seg.match(/^(\d{1,2})\s*[-~]\s*(\d{1,2})$/);
    if(m){ var a=+m[1],b=+m[2]; for(var k=Math.min(a,b);k<=Math.max(a,b);k++) if(out.indexOf(k)<0) out.push(k); }
    else if(/^\d{1,2}$/.test(seg)){ var v=+seg; if(out.indexOf(v)<0) out.push(v); }
  }
  return out.sort(function(x,y){return x-y;});
}
function parseWeeksToken(s){
  s = String(s||"").trim();
  if(!s) return null;
  if(/^每周$/.test(s)) return {};
  if(/^[\d,\s\-~]+$/.test(s)){
    var list = expandList(s);
    if(list.length) return {list:list};
  }
  var m = s.match(/(\d{1,2})\s*[-~]\s*(\d{1,2})/);
  var odd = /单/.test(s) ? true : (/双/.test(s) ? false : null);
  if(!m && odd===null) return null;
  var wk = {};
  if(m){ wk.from=+m[1]; wk.to=+m[2]; }
  if(odd!==null) wk.odd=odd;
  return wk;
}
function extractWeekTail(rest){
  var parts = rest.split(/\s+/), tail = [];
  while(parts.length && tail.length < 3 && isWeekWord(parts[parts.length-1])) tail.unshift(parts.pop());
  var token = tail.join(" ");
  if(token && !parseWeeksToken(token)) return {rest: parts.concat(tail).join(" "), token:""};
  return {rest: parts.join(" "), token:token};
}

/* ================= 课表 → 今日钟点（同 v2.2） ================= */
function getDayCourses(di, opt){
  var arr = Array.isArray(state.timetable[di]) ? state.timetable[di] : [];
  if(opt && opt.all) return arr;
  var w = currentTeachingWeek();
  if(w.n === null) return arr;
  if(w.reason === "before" || w.reason === "after") return [];
  var out = [];
  for(var i=0;i<arr.length;i++) if(courseInWeek(arr[i], w, w.total)) out.push(arr[i]);
  return out;
}
function deriveSchedule(di){
  var cs = getDayCourses(di).slice().sort(function(a,b){ return toMin(a.start) - toMin(b.start); });
  var T = cs.length ? toMin(cs[0].start) : null;
  var weekend = di >= 5, wake, out, hasEarly = false;
  if(T === null || T > 600){ wake = weekend ? 540 : 510; out = weekend ? 590 : 560; }
  else if(T <= 510){ wake = T - 45; out = T - 20; hasEarly = true; }
  else { wake = T - 50; out = T - 20; }
  return {wake:wake, out:out, hasEarly:hasEarly, courses:cs, noCourse:cs.length===0};
}
function outHour(){ return Math.floor(deriveSchedule(dowIdx(TODAY)).out / 60); }
function hasSport(){
  var cs = getDayCourses(dowIdx(TODAY));
  for(var i=0;i<cs.length;i++){ if(cs[i].tag === "体育" || /体育|户外|操场|田径/.test(cs[i].name || "")) return true; }
  return false;
}
function parseTimetableText(text){
  var map = {"周一":0,"周二":1,"周三":2,"周四":3,"周五":4,"周六":5,"周日":6,"周天":6,"星期一":0,"星期二":1,"星期三":2,"星期四":3,"星期五":4,"星期六":5,"星期日":6,"星期天":6};
  var out = [[],[],[],[],[],[],[]], cur = -1, count = 0;
  var lines = String(text||"").split(/\r?\n/);
  for(var i=0;i<lines.length;i++){
    var line = lines[i].trim(); if(!line) continue;
    var dm = line.match(/周[一二三四五六日天]|星期[一二三四五六日天]/);
    if(dm && map[dm[0]] !== undefined) cur = map[dm[0]];
    var tm = line.match(/(\d{1,2})[:：](\d{2})\s*[-~—至到]\s*(\d{1,2})[:：](\d{2})/);
    if(!tm || cur < 0) continue;
    var rest = line.replace(dm ? dm[0] : "", "").replace(tm[0], "").trim();
    var wt = extractWeekTail(rest);
    var wk = parseWeeksToken(wt.token);
    rest = wt.rest;
    var parts = rest.split(/\s+/), name = parts.shift() || "课程", place = parts.join(" ");
    var tag = /体育|户外|操场|田径/.test(name + place) ? "体育" : "";
    var c = {name:name, start:pad(+tm[1])+":"+tm[2], end:pad(+tm[3])+":"+tm[4], place:place, tag:tag};
    if(wk) c.weeks = wk;
    out[cur].push(c);
    count++;
  }
  for(var d=0;d<7;d++) out[d].sort(function(a,b){ return toMin(a.start)-toMin(b.start); });
  return {table:out, count:count};
}

/* ================= 护肤计划 / 今日时间轴（内容同 v2.2） ================= */
function weekNo(){
  var diff = Math.floor((TODAY - parse(S.startDate)) / 86400000);
  return {n:Math.floor(diff/7)+1, day:diff+1, started:diff>=0};
}
function plan(){
  var w = weekNo(), n = Math.max(1, Math.min(w.n, 8)), di = dowIdx(TODAY);
  var maskDay = S.maskOn && n >= 3 && di === 5, bpoDay;
  if(maskDay) bpoDay = false;
  else if(n <= 2) bpoDay = (di===0||di===2||di===4||di===6);
  else bpoDay = true;
  return {week:n, di:di, started:w.started, day:w.day, maskDay:maskDay, bpoDay:bpoDay,
          over:w.n>8, vc:S.vcOn, uvi:S.uviOverride};
}
function buildTimeline(){
  var p = plan(), sc = deriveSchedule(p.di), w = wxView(state.weatherCache.data, outHour());
  var uv = effectiveUVI(w), sport = hasSport();
  var sun = sunAdvice(uv, sport), cloth = dressAdvice(w);
  var rows = [];
  rows.push({key:"am", min:sc.wake+5, time:hhmm(sc.wake+5), sub:"起床 +5 分", tag:"早 · 90 秒", cls:"",
    title:"清水 + 保湿 + 看 UVI",
    desc:"清水冲脸 10 秒，毛巾<b>按压</b>吸干不来回擦 → 保湿乳薄涂 → " + esc(sun)});
  if(p.vc) rows.push({key:"vc", min:sc.wake+8, time:hhmm(sc.wake+8), sub:"解冻后", tag:"VC · 每周 2 次", cls:"",
    title:"20% VC 3–4 滴（仅早上）",
    desc:"清水后、保湿前，等 1–2 分钟。<b>不是每天用</b>，自己挑 2 天；晚上照常 BPO，永不同一步。颜色变橙棕立刻停用。"});
  rows.push({key:"out", min:sc.out, time:hhmm(sc.out), sub:"出门", tag:"通勤", cls:"gray",
    title:"戴头盔 + 到了擦干汗",
    desc:esc(cloth) + " 骑电动车<b>头盔必戴</b>（交警查）、别载成年人、走非机动车道。到教室把额头 / 下巴的汗按干。"});
  var seen = {};
  for(var i=0;i<sc.courses.length;i++){
    var c = sc.courses[i], base = "cls@" + c.start;
    seen[base] = (seen[base] || 0) + 1;
    rows.push({key:(seen[base] === 1 ? base : base + "#" + seen[base]), min:toMin(c.start), end:toMin(c.end), time:c.start, sub:"上课", tag:(c.tag?c.tag:"课程"), cls:(c.tag?"warn":"course"),
      title:esc(c.name), place:(c.place ? esc(c.place) + " · " : "") + esc(c.start) + "–" + esc(c.end),
      desc:"到教室先擦干汗再坐定" + (c.tag ? "；<b>户外课</b>按出门条目的防晒建议补涂" : "") + "。"});
  }
  rows.push({key:"noon", min:750, time:"12:30", sub:"午间", tag:"可不洗", cls:"gray",
    title:"油了就清水冲一下",
    desc:"中午<b>不用洗面奶</b>。下午有体育课 / 长时间户外且 UVI ≥ 3，才补涂一次防晒。"});
  if(sport) rows.push({key:"sport", min:null, time:"体育课", sub:"按需", tag:"户外", cls:"warn",
    title:"珀莱雅盾护 SPF50+ 只给户外",
    desc:"强防水、含乙醇，<b>用了当晚必须先卸妆</b>；你没买卸妆膏，更省事的做法是普通防晒补涂 + 帽子。<span class='hi'>别天天用</span>。"});
  var nt, nd, ng;
  if(p.maskDay){ nt="洁面 → 白云山泥膜 → 保湿"; nd="只 T 区 / 闭口处，避开脓头破口，按说明停留后洗掉 → <b>只保湿</b>。<span class='hi'>今晚不涂 BPO</span>。"; ng="周六 · 泥膜日"; }
  else if(p.bpoDay){ nt="洁面 → BPO 点涂 → 保湿"; nd="科颜氏男士洁面 + 冷水，指腹轻带 30 秒 → <b>完全擦干</b> → 2.5% 过氧苯甲酰<b>只点涂</b>红肿 / 脓头 → 保湿乳。会漂白枕巾衣领，别挤。"; ng="今晚 · 药膏日"; }
  else { nt="洁面 → 保湿（休息一晚）"; nd="隔天用药的第 1–2 周，休息日什么都不加。<span class='hi'>别补酸、别磨砂、别补涂加量</span>。"; ng="今晚 · 休息日"; }
  rows.push({key:"pm", min:1290, time:"21:30", sub:"主战场", tag:ng, cls:"night", title:nt, desc:nd});
  rows.push({key:"chore", min:1320, time:"22:00", sub:"顺手", tag:"每周 2 次", cls:"gray",
    title:"枕巾 / 头盔内衬 + 21:00 看明天待办",
    desc:"枕巾每周换 1–2 次，头盔内衬勤洗。三支 UNO 放洗澡用（后背 / 胸口 / 脖子）；<b>蓝管 SCRUB 不上脸</b>。"});
  rows.push({key:"sleep", min:1410, time:"23:30", sub:"收工", tag:"别熬夜", cls:"gray",
    title:"睡够，比多涂一层有用",
    desc:"8 周见效有一半靠作息和防晒。表皮代谢周期约 28 天，<b>一周两三次爆改不存在</b>。"});
  return rows;
}

/* ================= 渲染：今日 ================= */
function greeting(){
  var h = new Date().getHours();
  if(h < 5) return "夜深了，白sir";
  if(h < 11) return "早上好，白sir";
  if(h < 14) return "中午好，白sir";
  if(h < 18) return "下午好，白sir";
  return "晚上好，白sir";
}
function renderHeader(){
  var p = plan(), sc = deriveSchedule(p.di), tw = currentTeachingWeek();
  $("todayDate").textContent = (TODAY.getMonth()+1) + "月" + TODAY.getDate() + "日 · " + DOW_NAMES[p.di];
  $("hToday").textContent = greeting();
  $("todayLine").innerHTML = sc.noCourse
    ? "今天没课 · 起床 <b>" + hhmm(sc.wake) + "</b> · 出门 <b>" + hhmm(sc.out) + "</b>"
    : (sc.hasEarly ? "<span class='early'>有早八</span> " : "") + "起床 <b>" + hhmm(sc.wake) + "</b> · 出门 <b>" + hhmm(sc.out) + "</b> · " + sc.courses.length + " 节课";
  var chips = [];
  chips.push({cls:"", t: tw.valid ? ("教学周 第 " + tw.n + " 周 · " + (tw.parity === "odd" ? "单周" : "双周"))
    : (tw.reason === "after" ? "学期已结束" : (tw.reason === "before" ? "学期还没开始" : "周次未设置"))});
  chips.push({cls:"", t: p.started ? (p.over ? "护肤 8 周已走完，来复盘" : "护肤 第 " + p.week + " 周 · 第 " + p.day + " 天")
    : "护肤计划 " + Math.abs(p.day-1) + " 天后开始"});
  chips.push({cls:"hot", t: !p.started ? "计划尚未开始" : (p.maskDay ? "今晚 泥膜日" : (p.bpoDay ? "今晚 药膏日" : "今晚 休息日"))});
  $("todayChips").innerHTML = chips.map(function(c){ return '<span class="chip '+c.cls+'">'+esc(c.t)+'</span>'; }).join("");
}
function renderTonight(){
  var p = plan(), t = $("tonightTitle"), d = $("tonightDesc"), g = $("tonightTag");
  if(!p.started){ t.textContent = "计划还没开始"; g.textContent = "未开始";
    d.textContent = "先把两件必买的备齐（2.5% 过氧苯甲酰 + 不防水日常防晒）；想今天就开打，到「设置 → 护肤计划」把开始日改成今天。"; return; }
  if(p.maskDay){ t.textContent = "洁面 → 白云山泥膜 → 保湿"; g.textContent = "泥膜日";
    d.textContent = "只涂 T 区 / 闭口处，避开脓头和破口；今晚不涂 BPO，和药膏至少隔 24 小时。一周就这一次。"; }
  else if(p.bpoDay){ t.textContent = "洁面 → BPO 点涂 → 保湿"; g.textContent = "药膏日";
    d.textContent = "科颜氏洁面 + 冷水轻带 30 秒，完全擦干后，2.5% 过氧苯甲酰只点涂红肿 / 脓头，不全脸，待吸收再保湿。"; }
  else { t.textContent = "洁面 → 保湿（休息一晚）"; g.textContent = "休息日";
    d.textContent = "第 1–2 周隔天用药，休息日什么都不加。别因为「今天没涂药」就补个酸或磨砂，休息本身就是治疗。"; }
}
function nextRowKey(rows){
  var nm = nowMin();
  for(var i=0;i<rows.length;i++){
    var r = rows[i];
    if(r.min === null || S.checks[TODAY_KEY + "|" + r.key]) continue;
    var end = typeof r.end === "number" ? r.end : r.min + 30;
    if(end >= nm) return r.key;
  }
  return null;
}
var TICK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function renderTimeline(){
  if(!appReady) return;
  var rows = buildTimeline(), nk = nextRowKey(rows), html = "";
  for(var i=0;i<rows.length;i++){
    var r = rows[i], k = TODAY_KEY + "|" + r.key, on = !!S.checks[k], open = !!ui.expanded[r.key];
    var id = "tld-" + i, plain = String(r.title).replace(/<[^>]+>/g,"");
    html += '<li class="tl-row '+r.cls+(on?' done':'')+(r.key===nk?' next':'')+'">'+
      '<div class="tl-time"><b>'+esc(r.time)+'</b><small>'+esc(r.sub)+'</small></div>'+
      '<div class="tl-card">'+
        '<button type="button" class="tl-main" data-act="tl-expand" data-key="'+esc(r.key)+'" aria-expanded="'+open+'" aria-controls="'+id+'">'+
          '<span class="tl-tags">'+(r.key===nk?'<span class="tag tag-next">下一步</span>':'')+'<span class="tag">'+esc(r.tag)+'</span></span>'+
          '<span class="tl-title">'+r.title+'</span>'+
          (r.place ? '<span class="tl-place">'+r.place+'</span>' : '')+
        '</button>'+
        '<button type="button" class="tick'+(on?' on':'')+'" data-act="check" data-key="'+esc(r.key)+'" aria-pressed="'+on+'" aria-label="'+(on?'取消完成：':'标记完成：')+esc(plain)+'">'+TICK_SVG+'</button>'+
        '<div class="tl-desc" id="'+id+'"'+(open?'':' hidden')+'>'+r.desc+'</div>'+
      '</div></li>';
  }
  $("timeline").innerHTML = html;
  renderRing(rows);
}
function renderRing(rows){
  rows = rows || buildTimeline();
  var done = 0, total = 0;
  for(var i=0;i<rows.length;i++){
    if(!FIXED_SLOTS[rows[i].key]) continue;
    total++;
    if(S.checks[TODAY_KEY + "|" + rows[i].key]) done++;
  }
  var pct = total ? Math.round(done/total*100) : 0, C = 163.36;
  $("ringPct").textContent = pct + "%";
  $("ringArc").setAttribute("stroke-dashoffset", String(C*(1-pct/100)));
  $("ring").setAttribute("aria-label", "今日完成 " + done + " / " + total + " 项");
}
function renderSoon(){
  var now = Date.now(), lim = now + 48*3600000;
  var list = state.todos.filter(function(t){ var d = new Date(t.due).getTime(); return !t.done && isFinite(d) && d <= lim; })
    .sort(function(a,b){ return new Date(a.due) - new Date(b.due); }).slice(0,4);
  var dot = $("todoDot");
  if(dot) dot.hidden = !state.todos.some(function(t){ return !t.done && riskOf(t, now).level === "red"; });
  if(!list.length){ $("soonList").innerHTML = '<li class="empty">48 小时内没有待办。每天 21:00 记得看一眼明天。</li>'; return; }
  $("soonList").innerHTML = list.map(function(t){
    var rk = riskOf(t, now), over = new Date(t.due).getTime() < now;
    return '<li><span class="rdot '+rk.level+'" aria-hidden="true"></span><a href="#/todos/list"><b>'+esc(t.title)+'</b>'+
      '<small>'+esc(typeById(t.type).label)+' · '+(over?'已过期 · ':'')+esc(dateCN(t.due))+' '+esc(timeCN(t.due))+'</small></a></li>';
  }).join("");
}

/* ================= 渲染：护肤 ================= */
function renderWeek(){
  var p = plan(), html = "";
  for(var i=0;i<7;i++){
    var main, pill, pcls, extra;
    var mask = S.maskOn && p.week >= 3 && i === 5;
    var bpo = mask ? false : (p.week <= 2 ? (i===0||i===2||i===4||i===6) : true);
    if(mask){ main="白云山双酸泥膜"; pill="解冻后"; pcls="warn"; extra="只 T 区 / 闭口，避开脓头；当晚不涂 BPO，之后只保湿"; }
    else if(bpo){ main="2.5% BPO 点涂"; pill="药膏日"; pcls=""; extra="洁面 → 完全擦干 → 点涂红肿 / 脓头 → 保湿"; }
    else { main="洁面 + 保湿，休息"; pill="休息日"; pcls="rest"; extra="什么都不加，别补酸、别磨砂"; }
    if(i===5 && !mask) extra += "；洗澡时用 UNO BLACK 洗后背 / 胸口";
    if(i===6) extra += "；周日晚上花 1 分钟填打卡和复盘";
    html += '<li class="wp-row'+(i===p.di?' today':'')+'"><div class="wp-day"><b>'+DOW_NAMES[i]+'</b>'+(i===p.di?'<small>今天</small>':'')+'</div>'+
      '<div class="wp-main"><div class="wp-title"><span class="tag '+pcls+'">'+pill+'</span><b>'+main+'</b></div><p>'+extra+'</p></div></li>';
  }
  $("weekBody").innerHTML = html;
  $("skinSub").textContent = (p.started ? (p.over ? "8 周已走完，来复盘。" : "第 " + p.week + " 周 · " + (p.week <= 2 ? "隔天用药" : "每晚用药") + "。") : "计划还没开始。") + "医学结论一字未改，先压红肿痘，再谈提亮变白。";
  $("maskToggle").checked = !!S.maskOn;
  $("vcToggle").checked = !!S.vcOn;
}
var BUY = [
  {id:"bpo",tag:"必买",must:true,name:"2.5% 过氧苯甲酰凝胶",
   desc:"认成分不认牌子；常见班赛多为 5%，新手别直接上。药店买，首次先问药师。",price:"20–50 元"},
  {id:"sun",tag:"必买",must:true,name:"轻薄非致痘、不防水日常防晒",
   desc:"SPF30+ PA+++ 起，标非致痘；普通洁面就能洗净，顺带省掉至本卸妆膏 113.9 元。",price:"50–100 元"},
  {id:"lotion",tag:"可选",must:false,name:"清爽保湿乳 / 凝胶",
   desc:"含神经酰胺或泛醇、无香精。科颜氏那罐霜太闷再换，不闷就不用买。",price:"60–120 元"}
];
function renderBuy(){
  $("buyGrid").innerHTML = BUY.map(function(b){
    var on = !!S.bought[b.id];
    return '<article class="card buy-card'+(b.must?' must':'')+(on?' got':'')+'">'+
      '<span class="tag '+(b.must?'solid':'rest')+'">'+b.tag+'</span><h3>'+b.name+'</h3><p>'+b.desc+'</p>'+
      '<p class="price">'+b.price+' <small>参考价</small></p>'+
      '<button type="button" class="btn btn-block'+(on?' btn-done':'')+'" data-act="buy" data-id="'+b.id+'" aria-pressed="'+on+'">'+(on?'已买到 ✓':'标记已买')+'</button></article>';
  }).join("");
}
var STOCK = [
  ["ok","照常用","科颜氏男士洁面啫喱","氨基酸复配、无皂基，每天早晚主力，不用重买"],
  ["ok","照常用","科颜氏男士活力保湿霜","晚间薄涂；油皮也要保湿，太闷再换清爽款"],
  ["mid","降频","珀莱雅盾护 SPF50+","只给体育课 / 长时间户外。强防水必须卸妆，天天用容易闷痘"],
  ["ok","薄涂","完美芦荟胶","晒后、剃须后局部薄涂舒缓。不祛痘、不厚涂、别和药膏同涂"],
  ["mid","洗身体","UNO BLACK ×2","皂基 + 炭 + 薄荷醇，主要洗澡；上脸最多每周 1 次只 T 区"],
  ["no","别上脸","UNO SCRUB ×1（蓝管）","双重物理磨砂，有痘的脸磨了容易破、留黑痘印。洗澡消耗掉"],
  ["no","暂停","白云山双酸泥膜","见「本周计划」Q1：最早第 3 周、条件够了、周六晚、每周 1 次"],
  ["no","暂停","Timeless 20% VC","先看颜色，橙棕就扔；没变色也等 BPO 耐受后再早上用"],
  ["hold","先别买","烟酰胺精华","排最后，8 周复盘痘稳了再加（2%–5% 起步）"],
  ["mid","只身体","美康粉黛防晒 / 艾草纯露","粉黛涂脖子手臂不上脸；纯露别湿敷"],
  ["hold","不用买","至本卸妆膏 / kc / kvcc 胶原膜","换成不防水日常防晒就省掉卸妆；械字号敷料不是日常面霜"],
  ["hold","不用","宝宝油 / 生理盐水湿敷棉","搓出来的「油脂粒」是搓泥，不是脏东西；整套抖音流程已删"]
];
function renderStock(){
  $("stockGrid").innerHTML = STOCK.map(function(s){
    return '<div class="stock-item"><i class="dot '+s[0]+'" aria-hidden="true"></i><div><span class="lab lab-'+s[0]+'">'+s[1]+'</span><b>'+s[2]+'</b><p>'+s[3]+'</p></div></div>';
  }).join("");
}
function renderGrid(){
  var start = parse(S.startDate), html = '<div class="g-row g-head"><span></span>';
  for(var h=0;h<7;h++) html += "<span>"+DOW_NAMES[dowIdx(addDays(start,h))].replace("周","")+"</span>";
  html += "</div>";
  var total = 0;
  for(var w=0;w<8;w++){
    html += '<div class="g-row"><span class="g-wk">W'+(w+1)+'</span>';
    for(var d=0;d<7;d++){
      var day = addDays(start, w*7+d), key = fmt(day);
      var on = !!S.days[key]; if(on) total++;
      var isToday = key === TODAY_KEY, future = day > TODAY;
      html += '<button type="button" class="cell'+(on?' on':'')+(isToday?' today':'')+(future?' future':'')+'" data-act="day" data-day="'+key+'" aria-pressed="'+on+'" aria-label="'+md(day)+(on?' 已完成':' 未打卡')+(isToday?'（今天）':'')+'">'+
              '<span class="d">'+md(day)+'</span>'+TICK_SVG+'</button>';
    }
    html += "</div>";
  }
  $("grid8").innerHTML = html;
  $("totalDone").textContent = total;
  $("totalPct").textContent = Math.round(total/56*100) + "%";
}

/* ================= 渲染：课表 ================= */
function renderTimetable(){
  if(!appReady) return;
  var di = dowIdx(TODAY), tw = currentTeachingWeek(), html = "";
  $("ttTerm").textContent = tw.valid
    ? ("2026-2027 学年第一学期 · 第 " + tw.n + " 周（" + (tw.parity === "odd" ? "单周" : "双周") + "）· 共 " + tw.total + " 周")
    : (tw.reason === "after" ? "本学期课表已结束（第 " + tw.total + " 周之后），按「无课」处理"
      : (tw.reason === "before" ? "学期还没开始，课表暂按全部显示" : "周次未生效：到设置里检查「第 1 周周一」"));
  setPressed(qsa("#ttScope button"), function(b){ return b.getAttribute("data-v") === ui.ttScope; });
  for(var n=0;n<7;n++){
    var i = (di + n) % 7;   // 今天排第一个，往后数一周
    var all = getDayCourses(i, {all:true});
    var activeCount = getDayCourses(i).length;
    var items = "";
    for(var j=0;j<all.length;j++){
      var c = all[j], off = !courseInWeek(c, tw, tw.total);
      if(ui.ttScope === "week" && off) continue;
      items += '<li><button type="button" class="tt-lesson'+(off?' off':'')+'" data-act="tt-edit" data-di="'+i+'" data-idx="'+j+'" aria-label="修改 '+esc(c.name)+'">'+
        '<span class="tt-tm"><b>'+esc(c.start)+'</b><small>'+esc(c.end)+'</small></span>'+
        '<span class="tt-nm"><b>'+esc(c.name)+'</b><small>'+(c.place?esc(c.place)+' · ':'')+esc(weeksLabel(c.weeks, tw.total))+(off?' · 本周不上':'')+'</small></span>'+
        (c.tag?'<span class="tag warn">'+esc(c.tag)+'</span>':'')+
        '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button></li>';
    }
    var sc = deriveSchedule(i);
    html += '<article class="card tt-day'+(i===di?' today':'')+'">'+
      '<header class="tt-head"><h2>'+DOW_NAMES[i]+(i===di?' <span class="tag tag-next">今天</span>':'')+(n===1?' <span class="tag rest">明天</span>':'')+'</h2>'+
      '<span class="muted">'+(activeCount ? (sc.hasEarly ? '早八 · ' : '') + '起床 ' + hhmm(sc.wake) : '本周没课')+'</span></header>'+
      (items ? '<ul class="tt-lessons">'+items+'</ul>' : '<p class="empty">'+(all.length ? '本周没有要上的课。' : '没课，晚间护肤仍固定 21:30。')+'</p>')+
      '<button type="button" class="tt-add" data-act="tt-new" data-di="'+i+'">+ 在'+DOW_NAMES[i]+'加一节</button>'+
      '</article>';
  }
  $("ttList").innerHTML = html;
}
function renderDayPicker(){
  var h = "";
  for(var i=0;i<7;i++) h += '<button type="button" role="radio" data-act="tt-day" data-v="'+i+'" aria-checked="'+(i===ui.ttDay)+'" class="'+(i===ui.ttDay?'on':'')+'">'+DOW_NAMES[i].replace("周","")+'</button>';
  $("ttDays").innerHTML = h;
}
function updateWeeksHint(){
  var v = $("ttWeeks").value.trim(), hint = $("ttWeeksHint");
  if(!v){ hint.textContent = "每周都上。"; hint.classList.remove("bad"); return; }
  var wk = parseWeeksToken(v);
  if(!wk){ hint.textContent = "看不懂这个周次，例：9-20周 / 单周 11-17 / 双周 10-20 / 1,3,5-8"; hint.classList.add("bad"); return; }
  hint.textContent = "识别为：" + weeksLabel(wk, num(state.settings.totalWeeks,20)); hint.classList.remove("bad");
}
var lastFocus = null;
function openSheet(id, focusEl){
  lastFocus = document.activeElement;
  var el = $(id); el.hidden = false;
  document.documentElement.classList.add("sheet-open");
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    el.classList.add("in");
    if(focusEl && window.matchMedia && window.matchMedia("(hover:hover)").matches) focusEl.focus();
  }); });
}
function closeSheet(id){
  var el = $(id); if(!el || el.hidden) return;
  el.classList.remove("in");
  document.documentElement.classList.remove("sheet-open");
  setTimeout(function(){ el.hidden = true; }, 220);
  if(lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch(e){}
}
function openCourseSheet(di, idx){
  var editing = (typeof idx === "number"), c = editing ? state.timetable[di][idx] : null;
  ui.ttEdit = editing ? {di:di, idx:idx} : null;
  ui.ttDay = di;
  $("ttSheetTitle").textContent = editing ? "修改课程" : "添加课程";
  $("ttSaveBtn").textContent = editing ? "保存" : "添加";
  $("ttDelBtn").hidden = !editing;
  $("ttName").value = c ? c.name : "";
  $("ttStart").value = c ? c.start : "08:00";
  $("ttEnd").value = c ? c.end : "09:40";
  $("ttPlace").value = c ? (c.place || "") : "";
  $("ttTag").value = c ? (c.tag || "") : "";
  $("ttWeeks").value = c ? weeksInput(c.weeks) : "";
  renderDayPicker(); updateWeeksHint();
  openSheet("ttSheet", $("ttName"));
}
function saveCourse(){
  var name = $("ttName").value.trim();
  if(!name){ toast("写个课程名"); $("ttName").focus(); return; }
  var st = normTime($("ttStart").value), en = normTime($("ttEnd").value);
  if(!st || !en){ toast("时间用 24 小时制，例如 08:00"); return; }
  if(toMin(en) <= toMin(st)){ toast("结束要晚于开始"); return; }
  var wraw = $("ttWeeks").value.trim(), wk = parseWeeksToken(wraw);
  if(wraw && !wk){ toast("周次格式看不懂"); return; }
  var course = {name:name, start:st, end:en, place:$("ttPlace").value.trim(), tag:$("ttTag").value};
  if(wk) course.weeks = wk;
  var di = ui.ttDay, editing = !!ui.ttEdit;
  if(editing){ state.timetable[ui.ttEdit.di].splice(ui.ttEdit.idx, 1); }
  state.timetable[di].push(course);
  state.timetable[di].sort(function(a,b){ return toMin(a.start)-toMin(b.start); });
  state.timetableIsSample = false; ui.ttEdit = null;
  save(); closeSheet("ttSheet"); renderAll();
  toast((editing ? "已保存" : "已加到 " + DOW_NAMES[di]) + "，今日钟点已重算");
}
function deleteCourse(){
  if(!ui.ttEdit) return;
  var c = state.timetable[ui.ttEdit.di][ui.ttEdit.idx];
  if(!window.confirm("删除「" + (c ? c.name : "这节课") + "」？")) return;
  state.timetable[ui.ttEdit.di].splice(ui.ttEdit.idx, 1);
  state.timetableIsSample = false; ui.ttEdit = null;
  save(); closeSheet("ttSheet"); renderAll(); toast("已删除");
}

/* ================= 班长通知口吻转换（逐句，零删句；同 v2.2） ================= */
var TONE_RULES = [
  [/请各班班长/g,"请各位同学"],
  [/各班班长/g,"各位同学"],
  [/各位班长/g,"各位同学"],
  [/班长收齐后/g,"请各位同学"],
  [/由班长统一/g,"请各位同学自行"],
  [/以班级为单位/g,"各自"],
  [/请(?:务必)?通知(?:到)?(?:本班)?(?:每位|全班|各位)同学/g,"请相互转告"],
  [/请(?:务必)?通知到/g,"请相互转告"],
  [/请各班/g,"请各位同学"],
  [/收齐/g,"提交"],
  [/汇总/g,"填写"],
  [/上报/g,"提交"]
];
function convertTone(piece){
  var out = piece, changed = 0;
  for(var i=0;i<TONE_RULES.length;i++){
    var re = TONE_RULES[i][0]; re.lastIndex = 0;
    if(re.test(out)){ changed++; re.lastIndex = 0; out = out.replace(re, TONE_RULES[i][1]); }
  }
  return {text:out, changed:changed, residual:/班长/.test(out)};
}
function noticeMeta(text){
  var m = {}, now = new Date(), y = now.getFullYear(), mo = 0, d = 0, hh = "20", mm = "00";
  var m1 = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  var m2 = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m1){ mo = +m1[1]; d = +m1[2]; }
  else if(m2){ y = +m2[1]; mo = +m2[2]; d = +m2[3]; }
  var tm = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if(tm){ hh = pad(+tm[1]); mm = tm[2]; }
  else { var t2 = text.match(/(\d{1,2})\s*点/); if(t2) hh = pad(+t2[1]); }
  m.due = "";
  if(mo && d){
    var dt = new Date(y, mo-1, d);
    if(+dt < +new Date(now.getFullYear(),now.getMonth(),now.getDate())) dt = new Date(y+1, mo-1, d);
    m.due = fmt(dt) + "T" + hh + ":" + mm;
  }
  m.when = m1 ? m1[0] + (tm ? " " + hh + ":" + mm : "") : (m2 ? m2[0] + " " + hh + ":" + mm : "未识别");
  var au = text.match(/全班|全体|每位同学|各位同学|本班|各班|班委|宿舍|各组|男生|女生/);
  m.audience = au ? (/全班|全体|每位同学|各位同学|本班|各班/.test(au[0]) ? "全班" : au[0]) : "全班";
  var pl = text.match(/(?:交到|交给|发至|发到|提交至|上传至|送至|填至)([^，。；,;！!\n]{2,30})/);
  m.place = pl ? pl[1].trim() : "";
  var mt = text.match(/[^，。；,;！!\n]{0,18}(?:纸质|电子版|签名|盖章|截图|复印件|附件|表格|命名|格式|字数)[^，。；,;！!\n]{0,18}/);
  m.material = mt ? mt[0].trim() : "";
  m.strict = /逾期不候|过期不候|不可补交|不得补交|无补交|务必|必须/.test(text);
  return m;
}
function parseMonitorNotice(raw){
  var text = String(raw || "").replace(/\r/g,"").trim();
  var pieces = text.split(/[。；;！!？?\n，,]+/).map(function(x){ return x.trim(); }).filter(function(x){ return x; });
  var lines = [], residual = [], changedCount = 0;
  for(var i=0;i<pieces.length;i++){
    var c = convertTone(pieces[i]);
    lines.push({raw:pieces[i], out:c.text, changed:c.changed, residual:c.residual});
    if(c.changed) changedCount++;
    if(c.residual) residual.push(c.text);
  }
  var meta = noticeMeta(text);
  var body = lines.map(function(l){ return l.out; }).join("；");
  var broadcast = "【班委通知】各位同学：\n" + body + (body ? "。" : "") +
                  "\n谢谢配合。——班长 白鑫宇";
  var missing = [];
  if(!meta.due) missing.push("没识别到截止时间，建待办会默认明天 20:00，请自己改");
  if(!meta.place) missing.push("没识别到交付地点 / 方式，留意原文里有没有");
  return {pieces:pieces, lines:lines, meta:meta, broadcast:broadcast,
          residual:residual, changedCount:changedCount, missing:missing, raw:text};
}
function runConvert(){
  var raw = $("cvtRaw").value;
  if(!raw.trim()){ toast("先把班长通知原文贴进去"); return; }
  var r = parseMonitorNotice(raw);
  if(!r.pieces.length){ toast("没解析出内容"); return; }
  $("cvtOut").value = r.broadcast;
  var f = '<p><b>逐句对照：</b>原文 ' + r.pieces.length + ' 句 → 生成 ' + r.lines.length + ' 句，没有删句；改动 ' + r.changedCount + ' 句。</p>' +
    '<dl>' +
    '<div><dt>截止</dt><dd>' + esc(r.meta.when) + '</dd></div>' +
    '<div><dt>对象</dt><dd>' + esc(r.meta.audience) + '</dd></div>' +
    '<div><dt>交付</dt><dd>' + esc(r.meta.place || "未识别") + '</dd></div>' +
    '<div><dt>材料</dt><dd>' + esc(r.meta.material || "未识别") + '</dd></div>' +
    '<div><dt>硬性截止</dt><dd>' + (r.meta.strict ? "是" : "否") + '</dd></div>' +
    '<div><dt>建待办用</dt><dd>' + esc(r.meta.due ? r.meta.due.replace("T"," ") : "明天 20:00（默认）") + '</dd></div>' +
    '</dl>';
  var box = $("cvtFields"); box.innerHTML = f; box.hidden = false;
  var left = $("cvtLeft"), notes = [];
  if(r.residual.length) notes.push("以下句子仍含「班长」，可能需要你手动改：\n· " + r.residual.join("\n· "));
  for(var mi=0;mi<r.missing.length;mi++) notes.push("· " + r.missing[mi]);
  if(notes.length){ left.hidden = false; left.textContent = notes.join("\n"); }
  else { left.hidden = true; left.textContent = ""; }
  $("cvtStat").textContent = "原文 " + r.pieces.length + " 句全部保留";
  toast("已生成，自己核一遍再发");
}
function convertToTodo(){
  var raw = $("cvtRaw").value.trim();
  if(!raw){ toast("先把班长通知原文贴进去"); return; }
  var r = parseMonitorNotice(raw);
  var out = $("cvtOut").value.trim() || r.broadcast;
  var first = (r.lines[0] ? r.lines[0].out : "班长通知").replace(/^请(?:各位同学|各班)[，,]?/, "").trim();
  var title = first.length > 30 ? first.slice(0,30) + "…" : (first || "班长通知");
  var due = r.meta.due ? localISO(r.meta.due) : localISO(fmt(addDays(new Date(),1)) + "T20:00");
  state.todos.push({id:uid(), title:title, type:"notice", due:due, leadMin:1440,
    audience:r.meta.audience, note:raw, broadcast:out, done:false, createdAt:new Date().toISOString()});
  save(); renderTodos(); renderSoon(); renderReminders();
  toast(r.meta.due ? "已建待办；记得导 .ics 进日历" : "已建待办（截止默认明天 20:00，记得改）");
  go("todos", "list");
}

/* ================= LS 风险矩阵（同 v2.2） ================= */
var RISK_MATRIX = [
  ["blue","blue","yellow","yellow"],
  ["blue","yellow","orange","orange"],
  ["yellow","orange","orange","red"],
  ["yellow","orange","red","red"]
];
var RISK_META = {
  red:{label:"重大风险",cls:"risk-red",ctrl:"立即处理：现在就发群公告，别等日历；双提醒已开，仍建议自己再盯一次"},
  orange:{label:"较大风险",cls:"risk-orange",ctrl:"提前 1 天首发 + 截止前 2 小时二次催，21:00 复盘时确认"},
  yellow:{label:"一般风险",cls:"risk-yellow",ctrl:"常规提前提醒即可，别占用过多注意力"},
  blue:{label:"低风险",cls:"risk-blue",ctrl:"跟踪即可，按正常节奏处理"}
};
function likelihood(t, now){
  if(t.done) return 1;
  var due = new Date(t.due).getTime();
  if(!isFinite(due)) return 2;
  var h = (due - now) / 3600000;
  if(h < 0 || h <= 2) return 4;
  if(h <= 24) return 3;
  if(h <= 72) return 2;
  return 1;
}
function severity(t){
  var ty = typeById(t.type), base = {notice:3,ddl:3,meet:2,pay:3,skin:1};
  var s = base[ty.id] || 2;
  var blob = [t.audience,t.note,t.title].join(" ");
  if(/全班|全体|学院|辅导员|年级|每位/.test(blob)) s += 1;
  if(/逾期不候|过期不候|不可补交|不得补交|无补交|务必|必须/.test(blob)) s += 1;
  return Math.max(1, Math.min(4, s));
}
function riskOf(t, now){
  var L = likelihood(t, now || Date.now()), Sv = severity(t);
  var level = RISK_MATRIX[L-1][Sv-1];
  return {L:L, S:Sv, R:L*Sv, level:level, meta:RISK_META[level]};
}
function predictConsequence(t, r){
  var ty = typeById(t.type);
  var base = {
    notice:"漏发或迟发，同学会错过窗口，学院 / 辅导员那边材料收不齐，多半要你补交并解释；@全体成员次数有限，补发不一定来得及。",
    ddl:"错过提交时间通常没有补交窗口，直接扣分或计 0，还会影响平时成绩。",
    meet:"迟到或缺席会留缺勤记录，集合类事项别人不会等你。",
    pay:"逾期会影响班级统一办理，可能要自己跑一趟补缴，钱数对不上还得重新核对。",
    skin:"漏一次没关系；长期不连贯才会拖慢 8 周见效，别因为补做而加量。"
  }[ty.id] || "漏做会影响后续安排。";
  var tag = r.level === "red" ? "预测后果（高）：" : (r.level === "blue" ? "预测后果（低）：" : "预测后果：");
  return tag + base;
}
var RISK_ORDER = {red:4,orange:3,yellow:2,blue:1};

/* ================= 待办 ================= */
function typeById(id){
  for(var i=0;i<TODO_TYPES.length;i++) if(TODO_TYPES[i].id === id) return TODO_TYPES[i];
  return TODO_TYPES[1];
}
function leadText(m){
  if(m >= 1440) return (m/1440) + " 天";
  if(m >= 60) return (m/60) + " 小时";
  return m + " 分钟";
}
function alertPoints(t){
  var ty = typeById(t.type), due = new Date(t.due).getTime(), pts = [];
  if(!isFinite(due)) return pts;
  pts.push({label:"提前 " + leadText(ty.lead) + "首发", at:due - ty.lead*60000});
  if(ty.extra) pts.push({label:"截止前 " + leadText(ty.extra) + "二次催", at:due - ty.extra*60000});
  return pts;
}
function noticeText(t, second){
  var d = dateCN(t.due), tm = timeCN(t.due);
  if(t.type === "notice"){
    if(!second && t.broadcast) return t.broadcast;
    return second
      ? "【提醒】" + t.title + " 将于 " + tm + " 截止，还未完成的同学请抓紧，谢谢～"
      : "【班委通知】" + t.title + "。请于 " + d + " " + tm + " 前完成，谢谢配合。——班长 白鑫宇";
  }
  return "【待办】" + t.title + "，截止 " + d + " " + tm + (t.audience ? "（" + t.audience + "）" : "") + "。";
}
function copyText(s, okMsg){
  okMsg = okMsg || "已复制，去群里粘贴";
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(s).then(function(){ toast(okMsg); },function(){ fallbackCopy(s, okMsg); });
  } else fallbackCopy(s, okMsg);
}
function fallbackCopy(s, okMsg){
  var ta = document.createElement("textarea");
  ta.value = s; ta.setAttribute("readonly",""); ta.style.position = "fixed"; ta.style.top = "0"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { ta.setSelectionRange(0, s.length); } catch(e){}
  try { document.execCommand("copy"); toast(okMsg); } catch(e){ toast("复制失败，长按文本手动复制"); }
  document.body.removeChild(ta);
}
function filteredTodos(){
  var now = new Date(), t0 = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  var t1 = addDays(t0,1), t2 = addDays(t0,2), t7 = addDays(t0,7);
  var kw = String(todoQuery.text || "").trim().toLowerCase();
  var out = state.todos.filter(function(t){
    var due = new Date(t.due).getTime();
    if(todoQuery.scope === "today" && !(due >= +t0 && due < +t1)) return false;
    if(todoQuery.scope === "tomorrow" && !(due >= +t1 && due < +t2)) return false;
    if(todoQuery.scope === "week" && !(due >= +t0 && due < +t7)) return false;
    if(todoQuery.scope === "open" && t.done) return false;
    if(todoQuery.scope === "done" && !t.done) return false;
    if(kw && ([t.title,t.audience,t.note].join(" ").toLowerCase().indexOf(kw) < 0)) return false;
    return true;
  });
  out.sort(function(a,b){
    if(todoQuery.riskSort){
      var ra = riskOf(a, +now), rb = riskOf(b, +now);
      if(RISK_ORDER[rb.level] !== RISK_ORDER[ra.level]) return RISK_ORDER[rb.level] - RISK_ORDER[ra.level];
      if(rb.R !== ra.R) return rb.R - ra.R;
    }
    return new Date(a.due) - new Date(b.due);
  });
  return out;
}
function renderTodos(){
  if(!appReady) return;
  var all = state.todos, list = filteredTodos(), now = Date.now();
  var open = 0, red = 0, orange = 0;
  for(var q=0;q<all.length;q++){
    var rk0 = riskOf(all[q], now);
    if(!all[q].done) open++;
    if(rk0.level === "red" && !all[q].done) red++;
    if(rk0.level === "orange" && !all[q].done) orange++;
  }
  $("tqStat").textContent = all.length
    ? ("未完成 " + open + " 条" + (red ? " · 红 " + red : "") + (orange ? " · 橙 " + orange : "") + " · 共 " + all.length + " 条 · 当前显示 " + list.length + " 条")
    : "班长通知做成定时待办 + 一键复制群公告，靠日历和通知把你叫起来去发。";
  setPressed(qsa("#todoQuery [data-tq]"), function(b){
    var k = b.getAttribute("data-tq"); return k === "risk" ? todoQuery.riskSort : k === todoQuery.scope;
  });
  if(!list.length){
    $("todoList").innerHTML = '<li class="empty">' +
      (all.length ? '这个筛选下没有待办，点「全部」看回来。' : '还没有待办。在「转发班长通知」贴原文一键生成，或者用表单加一条。') + '</li>';
    return;
  }
  var html = "";
  for(var i=0;i<list.length;i++){
    var t = list[i], ty = typeById(t.type), due = new Date(t.due).getTime();
    var over = isFinite(due) && due < now && !t.done;
    var rk = riskOf(t, now);
    var chips = alertPoints(t).map(function(p){
      return '<span class="chip sm'+(p.at < now?' past':'')+'">'+esc(p.label)+' · '+dtShort(p.at)+'</span>';
    }).join("");
    html += '<li class="card todo'+(t.done?' done':'')+'">'+
      '<button type="button" class="tick'+(t.done?' on':'')+'" data-act="td-toggle" data-id="'+esc(t.id)+'" aria-pressed="'+(!!t.done)+'" aria-label="'+(t.done?'标为未完成：':'标为完成：')+esc(t.title)+'">'+TICK_SVG+'</button>'+
      '<div class="todo-main">'+
        '<div class="todo-top"><h3 class="todo-t">'+esc(t.title)+'</h3><span class="risk '+rk.meta.cls+'">'+rk.meta.label+' · R='+rk.R+'</span></div>'+
        '<p class="todo-meta">'+esc(ty.label)+' · 截止 <b>'+esc(dateCN(t.due))+' '+esc(timeCN(t.due))+'</b>'+
          (t.audience?' · '+esc(t.audience):'')+(over?' · <span class="over">已过期</span>':'')+'</p>'+
        (chips ? '<div class="chips">'+chips+'</div>' : '')+
        '<details class="mini-details"><summary>管控措施与预测后果 · L='+rk.L+' × S='+rk.S+'</summary>'+
          '<p><b>管控措施：</b>'+esc(rk.meta.ctrl)+'</p><p>'+esc(predictConsequence(t,rk))+'</p></details>'+
        '<div class="todo-act">'+
          '<button type="button" class="btn btn-sm" data-act="td-copy" data-id="'+esc(t.id)+'">复制群公告</button>'+
          (t.type==="notice"?'<button type="button" class="btn btn-sm" data-act="td-copy2" data-id="'+esc(t.id)+'">复制催办</button>':'')+
          '<button type="button" class="btn btn-sm btn-danger-ghost" data-act="td-del" data-id="'+esc(t.id)+'">删除</button>'+
        '</div>'+
      '</div></li>';
  }
  $("todoList").innerHTML = html;
}
function todoById(id){ for(var i=0;i<state.todos.length;i++) if(state.todos[i].id === id) return state.todos[i]; return null; }
function fillTypeSelect(){
  $("tdType").innerHTML = TODO_TYPES.map(function(t){ return '<option value="'+t.id+'">'+t.label+'</option>'; }).join("");
  $("tdDate").value = fmt(addDays(new Date(), 1));
  updateLeadHint();
}
function updateLeadHint(){
  var ty = typeById($("tdType").value);
  $("tdLeadHint").textContent = "会提醒：提前 " + leadText(ty.lead) + (ty.extra ? "，截止前 " + leadText(ty.extra) + "再催一次" : "") + "。";
}
function addTodo(){
  var title = $("tdTitle").value.trim();
  if(!title){ toast("先写事项"); $("tdTitle").focus(); return; }
  var d = $("tdDate").value, tm = normTime($("tdTime").value);
  if(!d){ toast("选个截止日期"); return; }
  if(!tm){ toast("时间用 24 小时制，例如 20:00"); $("tdTime").focus(); return; }
  $("tdTime").value = tm;
  var ty = typeById($("tdType").value);
  state.todos.push({id:uid(), title:title, type:ty.id, due:localISO(d + "T" + tm), leadMin:ty.lead,
    audience:$("tdAudience").value.trim(), note:"", done:false, createdAt:new Date().toISOString()});
  $("tdTitle").value = ""; save(); renderTodos(); renderSoon(); renderReminders();
  toast("已加待办；导出 .ics 才会进系统日历");
}

/* ================= .ics 导出（同 v2.2） ================= */
var ICS_ENCODER = (typeof TextEncoder !== "undefined") ? new TextEncoder() : null;
function byteLen(ch){
  if(ICS_ENCODER) return ICS_ENCODER.encode(ch).length;
  return unescape(encodeURIComponent(ch)).length;
}
function foldLine(line){
  var out = "", len = 0, limit = 75;
  for(var i=0;i<line.length;i++){
    var ch = line.charAt(i), b = byteLen(ch);
    if(len + b > limit){ out += "\r\n "; len = 1; }
    out += ch; len += b;
  }
  return out;
}
function escICS(s){
  return String(s == null ? "" : s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
}
function icsStamp(){ return new Date().toISOString().replace(/[-:]/g,"").split(".")[0] + "Z"; }
function icsFromISO(s){ return String(s).slice(0,10).replace(/-/g,"") + "T" + String(s).slice(11,16).replace(/:/g,"") + "00"; }
function icsEndFromISO(s,mins){
  var date = String(s).slice(0,10), h = +String(s).slice(11,13), m = +String(s).slice(14,16);
  var total = h*60 + m + mins, off = Math.floor(total/1440), rest = total % 1440;
  var d = parse(date); d.setDate(d.getDate()+off);
  return fmt(d).replace(/-/g,"") + "T" + pad(Math.floor(rest/60)) + pad(rest%60) + "00";
}
var ICS_HEAD = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//BaiSir Assistant//ZH","CALSCALE:GREGORIAN","METHOD:PUBLISH",
  "BEGIN:VTIMEZONE","TZID:Asia/Shanghai","BEGIN:STANDARD","DTSTART:19700101T000000","TZOFFSETFROM:+0800","TZOFFSETTO:+0800",
  "TZNAME:CST","END:STANDARD","END:VTIMEZONE"];
function appendReviewEvent(L){
  var d = addDays(new Date(), 1), ds = fmt(d).replace(/-/g,"");
  L.push("BEGIN:VEVENT");
  L.push("UID:daily-review-2100@baisir.local");
  L.push("DTSTAMP:" + icsStamp());
  L.push("DTSTART;TZID=Asia/Shanghai:" + ds + "T210000");
  L.push("DTEND;TZID=Asia/Shanghai:" + ds + "T211500");
  L.push("RRULE:FREQ=DAILY");
  L.push("SUMMARY:" + escICS("查明天待办 + 翻班级群"));
  L.push("DESCRIPTION:" + escICS("看明天待办与风险等级；翻一遍班级群有没有新通知，需要转发的用「班长口吻 → 同学口吻」生成文案。"));
  L.push("BEGIN:VALARM");
  L.push("ACTION:DISPLAY");
  L.push("DESCRIPTION:" + escICS("查明天待办 + 翻班级群"));
  L.push("TRIGGER:-PT5M");
  L.push("END:VALARM");
  L.push("END:VEVENT");
}
function finishICS(L){ L.push("END:VCALENDAR"); return L.map(foldLine).join("\r\n") + "\r\n"; }
function buildReviewICS(){ var L = ICS_HEAD.slice(); appendReviewEvent(L); return finishICS(L); }
function buildICS(){
  var L = ICS_HEAD.slice();
  for(var i=0;i<state.todos.length;i++){
    var t = state.todos[i];
    if(!t.due || !isFinite(new Date(t.due).getTime())) continue;
    var ty = typeById(t.type);
    var desc = noticeText(t,false) + (t.type === "notice" ? " / " + noticeText(t,true) : "");
    L.push("BEGIN:VEVENT");
    L.push("UID:" + t.id + "@baisir.local");
    L.push("DTSTAMP:" + icsStamp());
    L.push("DTSTART;TZID=Asia/Shanghai:" + icsFromISO(t.due));
    L.push("DTEND;TZID=Asia/Shanghai:" + icsEndFromISO(t.due,15));
    L.push("SUMMARY:" + escICS("[" + ty.label + "] " + t.title));
    L.push("DESCRIPTION:" + escICS(desc));
    for(var j=0;j<ty.alarms.length;j++){
      L.push("BEGIN:VALARM");
      L.push("ACTION:DISPLAY");
      L.push("DESCRIPTION:" + escICS(j === 0 ? noticeText(t,false) : noticeText(t,true)));
      L.push("TRIGGER:" + ty.alarms[j]);
      L.push("END:VALARM");
    }
    L.push("END:VEVENT");
  }
  if(state.settings.dailyReviewIcs !== false) appendReviewEvent(L);
  return finishICS(L);
}
function download(name, text, type){
  var blob = new Blob([text], {type:type});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name; a.style.display = "none";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
}
function exportICS(){
  if(!state.todos.length){ toast("先加一条待办再导日历"); return; }
  download("baisir.ics", buildICS(), "text/calendar;charset=utf-8");
  state.settings.lastIcsExport = new Date().toISOString(); save();
  toast("已导出 baisir.ics，去「文件」里用日历打开");
}
function exportReviewICS(){
  download("baisir-daily-review.ics", buildReviewICS(), "text/calendar;charset=utf-8");
  toast("已导出每日 21:00 重复提醒，去「文件」里用日历打开");
}
function renderReminders(){
  if(!appReady) return;
  $("dailyReviewIcs").checked = (state.settings.dailyReviewIcs !== false);
  $("icsPre").value = buildICS();
  $("notifState").textContent = (state.settings.notifEnabled && notifOK())
    ? "通知已开启 · 关掉网页就不会弹"
    : (("Notification" in window) ? "通知未开启 · 重要提醒请导 .ics" : "这个浏览器不支持网页通知（iPhone 需先添加到主屏幕）· 请用 .ics");
}

/* ================= 浏览器通知（同 v2.2） ================= */
function notifOK(){ return ("Notification" in window) && Notification.permission === "granted"; }
function requestNotif(){
  if(!("Notification" in window)){ toast("这个浏览器不支持通知，请用 .ics 导日历"); return; }
  function onPerm(p){
    if(p === "granted"){
      state.settings.notifEnabled = true; save(); startNotif();
      toast("已开启；关掉网页就不会弹，重要提醒请导日历");
    } else toast("没给权限，重要提醒请导 .ics 到日历");
    renderReminders();
  }
  var r;
  try { r = Notification.requestPermission(onPerm); } catch(e){ onPerm(Notification.permission); return; }
  if(r && typeof r.then === "function") r.then(onPerm).catch(function(){});
}
function startNotif(){
  if(notifTimer) clearInterval(notifTimer);
  if(!state.settings.notifEnabled || !notifOK()) return;
  notifTimer = setInterval(checkNotifs, 60000);
  checkNotifs();
}
function pushNotif(title, body){
  try { new Notification(title, {body:body, tag:title}); } catch(e){}
}
function checkNotifs(){
  if(!notifOK()) return;
  var now = Date.now();
  for(var i=0;i<state.todos.length;i++){
    var t = state.todos[i]; if(t.done) continue;
    var pts = alertPoints(t);
    for(var j=0;j<pts.length;j++){
      var key = t.id + "|" + pts[j].at;
      if(!fired[key] && now >= pts[j].at && now - pts[j].at < 3600000){
        fired[key] = 1;
        pushNotif("待办提醒 · " + t.title, pts[j].label + " · " + noticeText(t, j > 0));
      }
    }
  }
  var d = new Date();
  if(d.getHours() === 21 && d.getMinutes() < 2){
    var rk = "review|" + fmt(d);
    if(!fired[rk]){ fired[rk] = 1; pushNotif("21:00 每日复盘", "检查明天有没有待办，没有就补上；顺便填今天的打卡格。"); }
  }
}

/* ================= PIN（哈希算法必须与 v2.2 一致） ================= */
function hashPin(p){
  var s = "baisir::" + String(p), h = 2166136261;
  for(var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h.toString(16);
}
function ssGet(k){ try { return sessionStorage.getItem(k); } catch(e){ return null; } }
function ssSet(k,v){ try { sessionStorage.setItem(k,v); } catch(e){} }
function ssDel(k){ try { sessionStorage.removeItem(k); } catch(e){} }
function isUnlocked(){ return !state.meta.pinEnabled || ssGet(UNLOCK_KEY) === "1"; }
function showLock(){
  $("lockView").hidden = false;
  $("appRoot").innerHTML = "";       // 未解锁时课表 / 待办不进 DOM
  appReady = false;
  if(notifTimer){ clearInterval(notifTimer); notifTimer = null; }
  setTimeout(function(){ var i = $("pinInput"); if(i) i.focus(); }, 60);
}
function unlockApp(){
  $("lockView").hidden = true;
  var root = $("appRoot");
  root.innerHTML = "";
  root.appendChild($("appTpl").content.cloneNode(true));
  appReady = true;
  refreshRefs();
  bindEvents(); fillTypeSelect(); route(); renderAll();
  fetchWeather(); startNotif();
}
function tryUnlock(){
  var v = $("pinInput").value.trim();
  if(state.meta.pinHash && hashPin(v) === state.meta.pinHash){
    ssSet(UNLOCK_KEY,"1"); $("pinInput").value = ""; $("lockMsg").textContent = ""; unlockApp();
  } else {
    $("lockMsg").textContent = "口令不对，再试一次";
    var c = $("lockForm"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
    $("pinInput").select();
  }
}
function lockNow(){
  if(!state.meta.pinEnabled){ toast("还没设置口令，先设一个再锁"); return; }
  ssDel(UNLOCK_KEY); showLock();
}

/* ================= 设置 / 数据 ================= */
function renderSettings(){
  if(!appReady) return;
  $("startDate").value = S.startDate;
  setPressed(qsa("#uviSeg button"), function(b){ return b.getAttribute("data-uvi") === (S.uviOverride || "auto"); });
  $("pinState").textContent = state.meta.pinEnabled ? "口令已开启 · 防误入，不是加密" : "口令未开启 · 链接别外传";
  $("semesterStart").value = state.settings.semesterStart || "";
  $("totalWeeks").value = num(state.settings.totalWeeks, 20);
  var tw = currentTeachingWeek();
  $("termWeekInfo").textContent = tw.valid
    ? ("当前第 " + tw.n + " 周（" + (tw.parity === "odd" ? "单周" : "双周") + "）· 共 " + tw.total + " 周")
    : (tw.reason === "after" ? "本学期已结束（第 " + tw.total + " 周后），课表按无课处理"
      : (tw.reason === "before" ? "学期还没开始" : "周次未生效：检查第 1 周周一"));
}
function readJSONFile(file, cb){
  var fr = new FileReader();
  fr.onload = function(){
    try { cb(JSON.parse(String(fr.result).replace(/^\ufeff/,""))); }
    catch(e){ toast("导入失败：" + e.message); }
  };
  fr.readAsText(file, "utf-8");
}
function importTimetableOnly(file){
  readJSONFile(file, function(obj){
    if(!isObj(obj) || !Array.isArray(obj.timetable) || obj.timetable.length !== 7)
      throw new Error("不是课表备份（需要 7 天 timetable）");
    if(obj.kind && obj.kind !== "baisir-timetable-only") throw new Error("备份类型不符");
    if(!window.confirm("只替换课表和学期设置，打卡 / 待办 / PIN / 天气缓存全部保留。确定？")) return;
    state.timetable = obj.timetable;
    state.timetableIsSample = false;
    if(isObj(obj.settings)){
      if(obj.settings.semesterStart) state.settings.semesterStart = obj.settings.semesterStart;
      if(typeof obj.settings.totalWeeks === "number") state.settings.totalWeeks = obj.settings.totalWeeks;
    }
    save(); renderAll(); toast("课表已替换，其他数据没动");
  });
}
function exportJSON(){
  download("baisir-backup.json", JSON.stringify(state, null, 2), "application/json;charset=utf-8");
  toast("已导出，换设备用「选择文件导入」还原");
}
function importJSON(file){
  readJSONFile(file, function(obj){
    if(!isObj(obj) || !isObj(obj.skin)) throw new Error("不是本助手的备份");
    if(!window.confirm("导入会整体覆盖这台设备现有数据，确定？")) return;
    state = fill(obj, defaults());
    if(!Array.isArray(state.timetable) || state.timetable.length !== 7) state.timetable = sampleTimetable();
    if(!Array.isArray(state.todos)) state.todos = [];
    refreshRefs(); save();
    if(state.meta.pinEnabled) ssSet(UNLOCK_KEY,"1");   // 当前标签页保持解锁，不被导入的口令锁在外面
    renderAll(); toast("导入完成，数据已还原");
  });
}

/* ================= 路由（hash，不碰 ?sharecode） ================= */
function go(view, sub){
  var h = "#/" + view + (sub ? "/" + sub : "");
  if(location.hash !== h) location.hash = h; else route();
}
var LEGACY = {checkin:["skin","checkin"], skin:["skin",null], todos:["todos",null], timetable:["timetable",null], settings:["settings",null], today:["today",null]};
function route(){
  if(!appReady) return;
  var parts = String(location.hash || "").replace(/^#\/?/,"").split("/");
  var v = parts[0];
  if(VIEWS.indexOf(v) < 0){
    if(LEGACY[v]){ if(LEGACY[v][1]) parts[1] = LEGACY[v][1]; v = LEGACY[v][0]; }
    else v = "today";
  }
  if(SUBS[v] && parts[1] && SUBS[v].indexOf(parts[1]) >= 0) ui.sub[v] = parts[1];
  var changed = ui.view !== v;
  ui.view = v;
  qsa(".view").forEach(function(el){ el.hidden = el.getAttribute("data-view") !== v; });
  qsa(".tab").forEach(function(a){
    var on = a.getAttribute("data-tab") === v;
    a.classList.toggle("on", on);
    if(on) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current");
  });
  Object.keys(SUBS).forEach(function(view){
    var cur = ui.sub[view];
    qsa('[data-view-sub="'+view+'"]').forEach(function(b){
      var on = b.getAttribute("data-v") === cur;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    qsa('.subview[data-sub^="'+view+':"]').forEach(function(el){ el.hidden = el.getAttribute("data-sub") !== view + ":" + cur; });
  });
  if(changed) window.scrollTo(0,0);
  document.title = ({today:"今日",timetable:"课表",todos:"待办",skin:"护肤",settings:"设置"})[v] + " · 白sir 的个人助手";
}

/* ================= 事件（模板克隆后绑定一次，统一委托） ================= */
function onAction(el){
  var act = el.getAttribute("data-act"), id = el.getAttribute("data-id"), t;
  switch(act){
    case "check":
      var k = TODAY_KEY + "|" + el.getAttribute("data-key");
      S.checks[k] = !S.checks[k]; save(); renderTimeline();
      if(S.checks[k] && navigator.vibrate) try { navigator.vibrate(8); } catch(_){}
      break;
    case "tl-expand":
      var key = el.getAttribute("data-key"); ui.expanded[key] = !ui.expanded[key];
      el.setAttribute("aria-expanded", String(!!ui.expanded[key]));
      var d = $(el.getAttribute("aria-controls")); if(d) d.hidden = !ui.expanded[key];
      break;
    case "wx-refresh": fetchWeather(); break;
    case "adv-toggle":
      var open = el.getAttribute("aria-expanded") !== "true";
      el.setAttribute("aria-expanded", String(open));
      el.querySelector(".adv-more").textContent = open ? "收起" : "展开完整建议";
      break;
    case "sub": go(el.getAttribute("data-view-sub"), el.getAttribute("data-v")); break;
    case "uvi":
      var v = el.getAttribute("data-uvi"); S.uviOverride = (v === "auto") ? null : v;
      save(); renderSettings(); renderWeather(); renderTimeline();
      toast(v === "auto" ? "紫外线回到自动（按天气）" : "已手动覆盖紫外线");
      break;
    case "buy": S.bought[id] = !S.bought[id]; save(); renderBuy(); break;
    case "day": var dk = el.getAttribute("data-day"); S.days[dk] = !S.days[dk]; save(); renderGrid(); break;
    /* 课表 */
    case "tt-scope": ui.ttScope = el.getAttribute("data-v"); renderTimetable(); break;
    case "tt-new": openCourseSheet(el.hasAttribute("data-di") ? +el.getAttribute("data-di") : dowIdx(TODAY)); break;
    case "tt-edit": openCourseSheet(+el.getAttribute("data-di"), +el.getAttribute("data-idx")); break;
    case "tt-close": closeSheet("ttSheet"); break;
    case "tt-del": deleteCourse(); break;
    case "tt-day": ui.ttDay = +el.getAttribute("data-v"); renderDayPicker(); break;
    case "tt-slot": $("ttStart").value = el.getAttribute("data-s"); $("ttEnd").value = el.getAttribute("data-e"); break;
    case "tt-wk":
      var cur = $("ttWeeks").value.replace(/^(单周|双周|每周)\s*/,"").replace(/周$/,"").trim(), pre = el.getAttribute("data-v");
      if(pre) $("ttWeeks").value = (pre + cur).trim();
      else $("ttWeeks").value = /^\d{1,2}\s*[-~]\s*\d{1,2}$/.test(cur) ? cur + "周" : "";
      updateWeeksHint(); break;
    case "tt-import":
      var r = parseTimetableText($("ttText").value);
      if(!r.count){ toast("没解析出课程，检查「周一 08:00-09:40 课程名 地点」格式"); return; }
      if(!window.confirm("解析出 " + r.count + " 节课，会覆盖现有课表。确定？")) return;
      state.timetable = r.table; state.timetableIsSample = false;
      save(); renderAll(); toast("导入 " + r.count + " 节课");
      break;
    case "tt-clear":
      if(!window.confirm("清空整周课表？")) return;
      state.timetable = [[],[],[],[],[],[],[]]; state.timetableIsSample = false;
      save(); renderAll(); toast("课表已清空");
      break;
    case "tt-only-import": $("ttOnlyFile").click(); break;
    /* 待办 */
    case "tq":
      var q = el.getAttribute("data-tq");
      if(q === "risk") todoQuery.riskSort = !todoQuery.riskSort; else todoQuery.scope = q;
      renderTodos(); break;
    case "td-toggle": t = todoById(id); if(t){ t.done = !t.done; save(); renderTodos(); renderSoon(); } break;
    case "td-copy": t = todoById(id); if(t) copyText(noticeText(t,false)); break;
    case "td-copy2": t = todoById(id); if(t) copyText(noticeText(t,true)); break;
    case "td-del":
      t = todoById(id); if(!t) return;
      if(!window.confirm("删除「" + t.title + "」？")) return;
      state.todos = state.todos.filter(function(x){ return x.id !== id; });
      save(); renderTodos(); renderSoon(); renderReminders(); break;
    case "cvt-go": runConvert(); break;
    case "cvt-copy":
      var out = $("cvtOut").value.trim();
      if(!out){ toast("先点「解析并生成」"); return; }
      copyText(out); break;
    case "cvt-todo": convertToTodo(); break;
    case "ics": exportICS(); break;
    case "ics-copy":
      if(!state.todos.length){ toast("先加一条待办再复制"); return; }
      copyText(buildICS(), "已复制 .ics 原文"); break;
    case "ics-review": exportReviewICS(); break;
    case "notif": requestNotif(); break;
    /* 设置 */
    case "pin-save":
      var p = $("pinSet").value.trim();
      if(!/^\d{4}$/.test(p)){ toast("要 4 位数字"); return; }
      state.meta.pinEnabled = true; state.meta.pinHash = hashPin(p);
      ssSet(UNLOCK_KEY,"1"); $("pinSet").value = "";
      save(); renderSettings(); toast("口令已设置，当前标签页保持解锁"); break;
    case "pin-off":
      if(!state.meta.pinEnabled){ toast("口令本来就没开"); return; }
      if(!window.confirm("关闭 4 位口令？链接打开就直接能看课表和待办了。")) return;
      state.meta.pinEnabled = false; state.meta.pinHash = ""; ssDel(UNLOCK_KEY);
      save(); renderSettings(); toast("口令已关闭"); break;
    case "lock-now": lockNow(); break;
    case "json-export": exportJSON(); break;
    case "json-import": $("jsonFile").click(); break;
    case "remigrate":
      var v1 = readV1();
      if(!v1){ toast("没找到旧《护肤打卡》页的数据"); return; }
      if(!window.confirm("会用旧页的打勾和开关覆盖本页记录，确定？")) return;
      applyV1(state, v1); state.meta.migratedFrom = "skinReset_v1";
      save(); renderAll(); toast("已重新导入旧页数据"); break;
  }
}
function bindEvents(){
  var root = $("appRoot");
  if(root._bound) return; root._bound = true;   // appRoot 节点常驻，重复解锁不重复绑定
  root.addEventListener("click", function(e){
    var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if(!el || !root.contains(el)) return;
    onAction(el);
  });
  // 24 小时制输入：失焦时规范化
  root.addEventListener("focusout", function(e){
    var tg = e.target;
    if(tg && tg.classList && tg.classList.contains("t24")){
      var n = normTime(tg.value);
      if(n){ tg.value = n; tg.removeAttribute("aria-invalid"); }
      else if(tg.value.trim()) tg.setAttribute("aria-invalid","true");
    }
  });
  root.addEventListener("submit", function(e){
    if(e.target.id === "todoForm"){ e.preventDefault(); addTodo(); }
    else if(e.target.id === "ttForm"){ e.preventDefault(); saveCourse(); }
  });
  root.addEventListener("input", function(e){
    var id = e.target.id;
    if(id === "ttWeeks") updateWeeksHint();
    else if(id === "tqText"){ todoQuery.text = e.target.value; renderTodos(); }
  });
  root.addEventListener("change", function(e){
    var el = e.target, id = el.id;
    switch(id){
      case "tdType": updateLeadHint(); break;
      case "maskToggle": S.maskOn = el.checked; save(); renderAll(); toast(el.checked ? "周六泥膜日已开启（第 3 周起生效）" : "泥膜日已关闭"); break;
      case "vcToggle": S.vcOn = el.checked; save(); renderAll(); toast(el.checked ? "早间流程已加入 VC" : "VC 已从早间流程移除"); break;
      case "dailyReviewIcs":
        state.settings.dailyReviewIcs = el.checked; save(); renderReminders();
        toast(el.checked ? "已写入 .ics，导出后生效" : "已从 .ics 移除"); break;
      case "startDate": if(el.value){ S.startDate = el.value; save(); renderAll(); toast("开始日已改为 " + el.value); } break;
      case "semesterStart": if(el.value){ state.settings.semesterStart = el.value; save(); renderAll(); } break;
      case "totalWeeks":
        var v = Math.max(1, Math.min(60, parseInt(el.value,10) || 20));
        state.settings.totalWeeks = v; el.value = v; save(); renderAll(); break;
      case "jsonFile": if(el.files && el.files[0]) importJSON(el.files[0]); el.value = ""; break;
      case "ttOnlyFile": if(el.files && el.files[0]) importTimetableOnly(el.files[0]); el.value = ""; break;
    }
  });
}

/* ================= 总渲染 / 启动 ================= */
function renderAll(){
  if(!appReady) return;
  renderHeader(); renderTonight(); renderTimeline(); renderSoon(); renderWeather();
  renderWeek(); renderBuy(); renderStock(); renderGrid();
  renderTimetable(); renderTodos(); renderReminders(); renderSettings();
}
function onResume(){
  if(!appReady || document.visibilityState === "hidden") return;
  var prev = TODAY_KEY; setToday();
  if(prev !== TODAY_KEY){ ui.expanded = {}; renderAll(); }   // 跨过零点：自动换成新的一天
  else { renderHeader(); renderTimeline(); renderSoon(); }
  if(weatherIsStale()) fetchWeather();
}
function boot(){
  state = load(); refreshRefs(); save();   // 落盘一次性迁移结果
  $("lockForm").addEventListener("submit", function(e){ e.preventDefault(); tryUnlock(); });
  $("pinInput").addEventListener("input", function(){ if(/^\d{4}$/.test(this.value)) tryUnlock(); });
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("pageshow", function(e){ if(e.persisted) onResume(); });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape") closeSheet("ttSheet"); });
  setInterval(onResume, 5*60000);
  if(isUnlocked()) unlockApp(); else showLock();
  if("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){
    navigator.serviceWorker.register("sw.js?sharecode=" + SHARECODE, {scope:"./"}).catch(function(){});
  }
}
window.__BAISIR__ = {version:VERSION, hashPin:hashPin, storageKey:KEY};
boot();
})();
