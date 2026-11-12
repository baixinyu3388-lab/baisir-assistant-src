/* 白sir 的个人助手 · v3.2 (2026-11-12)
 * 纯静态、无构建、无后端。数据只在本机 localStorage（key: baiAssistant_v2，与 v2.2 完全兼容）。
 */
(function(){
"use strict";

/* ================= 常量 ================= */
var VERSION = "3.2.1";
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
    noticeLog:[],
    classRoster:[],          // 本班名单（姓名字符串）；空名单且未标记种子时会预填安全2601
    classRosterInfo:{},      // {姓名:{gender,dorm,room}}，只作提示，不影响勾选键
    classRosterSeed:"",      // 已应用的预填版本，清空名单后不再自动写回
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
  if(!Array.isArray(s.noticeLog)) s.noticeLog = [];
  s.classRoster = cleanRoster(s.classRoster);
  if(!isObj(s.classRosterInfo)) s.classRosterInfo = {};
  applyRosterSeed(s);
  s.classRoster = cleanRoster(s.classRoster);
  if(!s.meta.migratedFrom){
    var v1 = readV1();
    if(v1 && applyV1(s,v1)) s.meta.migratedFrom = "skinReset_v1";
  }
  return s;
}
function cleanRoster(r){
  if(!Array.isArray(r)) return [];
  var out = [], seen = {};
  r.forEach(function(n){ n = String(n == null ? "" : n).trim(); if(n && !seen[n]){ seen[n] = 1; out.push(n); } });
  return out;
}
/* 安全2601 宿舍安排表（用户 2026-11-12 提供）。只在名单为空且尚未标记种子时预填；已有名单不覆盖，只给对得上的人补性别/宿舍。 */
var ROSTER_SEED_ID = "anquan2601-2026";
var ROSTER_SEED = [
  {name:"普布扎西", gender:"男", dorm:"升华12栋", room:"630"},
  {name:"刘天宇", gender:"男", dorm:"升华12栋", room:"631"},
  {name:"张显子", gender:"男", dorm:"升华12栋", room:""},
  {name:"何林骏", gender:"男", dorm:"升华12栋", room:""},
  {name:"甘淦文", gender:"男", dorm:"升华12栋", room:""},
  {name:"谭明亮", gender:"男", dorm:"升华12栋", room:"632"},
  {name:"周佳旭", gender:"男", dorm:"升华12栋", room:""},
  {name:"葛清圆", gender:"男", dorm:"升华12栋", room:""},
  {name:"阿布拉·库万尼亚孜", gender:"男", dorm:"升华12栋", room:""},
  {name:"文海辰", gender:"男", dorm:"升华12栋", room:"633"},
  {name:"刘涵", gender:"男", dorm:"升华12栋", room:""},
  {name:"何亚男", gender:"男", dorm:"升华12栋", room:""},
  {name:"伊力哈木·木沙", gender:"男", dorm:"升华12栋", room:""},
  {name:"杜宸皓", gender:"男", dorm:"升华12栋", room:"634"},
  {name:"周靖恒", gender:"男", dorm:"升华12栋", room:""},
  {name:"陈楚柠", gender:"男", dorm:"升华12栋", room:""},
  {name:"白鑫宇", gender:"男", dorm:"升华12栋", room:""},
  {name:"王锦晨", gender:"男", dorm:"升华12栋", room:"635"},
  {name:"欧佳仪", gender:"女", dorm:"升华32栋", room:"721"},
  {name:"孙梓涵", gender:"女", dorm:"升华32栋", room:""},
  {name:"冯琰琰", gender:"女", dorm:"升华32栋", room:"722"},
  {name:"张新晨", gender:"女", dorm:"升华32栋", room:""},
  {name:"杨懿欢", gender:"女", dorm:"升华32栋", room:""},
  {name:"庞博艺", gender:"女", dorm:"升华32栋", room:""},
  {name:"师佳妮", gender:"女", dorm:"升华32栋", room:"723"},
  {name:"徐若萱", gender:"女", dorm:"升华32栋", room:""}
];
function rosterInfo(n){ return (state && isObj(state.classRosterInfo) && state.classRosterInfo[n]) || {}; }
function rosterInfoLine(n){
  var i = rosterInfo(n), parts = [];
  if(i.dorm) parts.push(i.dorm + (i.room ? " " + i.room : ""));
  else if(i.room) parts.push(i.room);
  return parts.join(" ");
}
function applyRosterSeed(s){
  if(!s || s.classRosterSeed === ROSTER_SEED_ID) return;
  if(!isObj(s.classRosterInfo)) s.classRosterInfo = {};
  var has = (s.classRoster || []).length;
  if(!has){
    s.classRoster = ROSTER_SEED.map(function(p){ return p.name; });
  }
  ROSTER_SEED.forEach(function(p){
    if(has && s.classRoster.indexOf(p.name) < 0) return;
    if(s.classRosterInfo[p.name]) return;
    s.classRosterInfo[p.name] = {gender:p.gender, dorm:p.dorm, room:p.room || ""};
  });
  s.classRosterSeed = ROSTER_SEED_ID;
}
function audienceGender(audience){
  var a = String(audience || "");
  if(!a || /全班|全体/.test(a)) return "";
  if(/女生|女同学/.test(a) && !/男生|男同学/.test(a)) return "女";
  if(/男生|男同学/.test(a) && !/女生|女同学/.test(a)) return "男";
  return "";
}
function rosterByGender(roster, gender){
  if(!gender) return (roster || []).slice();
  return (roster || []).filter(function(n){
    var g = rosterInfo(n).gender;
    return !g || g === gender;   // 没标性别的人仍显示，避免漏催
  });
}
function rosterHasGender(roster){
  return (roster || []).some(function(n){ return !!rosterInfo(n).gender; });
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
  renderNoticeEntry();
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
  var others = qsa(".sheet").some(function(x){ return x !== el && !x.hidden; });
  if(!others) document.documentElement.classList.remove("sheet-open");
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

/* ================= 转发通知：解析（纯函数，不碰 DOM；node 可单独测） ================= */
/* NT-PARSER-START */
var NT_DOW = {"一":0,"二":1,"三":2,"四":3,"五":4,"六":5,"日":6,"天":6,"1":0,"2":1,"3":2,"4":3,"5":4,"6":5,"7":6};
var NT_DOW_NAME = ["周一","周二","周三","周四","周五","周六","周日"];
var NT_PERIOD_DEF = {"早上":"09:00","上午":"09:00","中午":"12:00","下午":"17:00","傍晚":"18:00","晚上":"20:00","夜里":"22:00","凌晨":"06:00"};
var NT_PERIOD_RE = /^\s*(早上|上午|中午|下午|傍晚|晚上|夜里|凌晨)/;
function ntPad(n){ n = String(n); return n.length < 2 ? "0" + n : n; }
function ntYmd(d){ return d.getFullYear() + "-" + ntPad(d.getMonth()+1) + "-" + ntPad(d.getDate()); }
function ntDay0(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function ntAddDays(d,n){ var x = new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
function ntValidMD(mo,d){ return mo >= 1 && mo <= 12 && d >= 1 && d <= 31; }
function ntScan(re, text, fn){ var m; re.lastIndex = 0; while((m = re.exec(text))){ fn(m); if(m[0] === "") re.lastIndex++; } }
/* 找出所有「哪天」与「几点」，再挑最像截止的那一个 */
function ntFindDue(text, now){
  var today = ntDay0(now), dates = [], times = [], notes = [];
  function absDate(y, mo, d, m, guessYear){
    var dt = new Date(y, mo-1, d), pushed = false;
    if(guessYear && +dt < +today){ dt = new Date(y+1, mo-1, d); pushed = true; }
    dates.push({i:m.index, e:m.index + m[0].length, d:dt, src:m[0].trim(), sure:!pushed, note: pushed ? "「" + m[0].trim() + "」今年已经过了，按明年算" : ""});
  }
  ntScan(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?/g, text, function(m){
    if(ntValidMD(+m[2], +m[3])) absDate(+m[1], +m[2], +m[3], m, false);
  });
  ntScan(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g, text, function(m){
    if(ntValidMD(+m[1], +m[2])) absDate(today.getFullYear(), +m[1], +m[2], m, true);
  });
  ntScan(/(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d./])/g, text, function(m){
    var before = text.charAt(m.index - 1);
    if(/[\d./:：]/.test(before)) return;
    var after = text.slice(m.index + m[0].length);
    var mo = +m[1], d = +m[2];
    if(/^\s*[点时]/.test(after)){
      // 「11.10 点」：可能是 11月10日，也可能是 11:10 —— 当时间用，但必须请核对
      if(mo <= 23 && d <= 59) times.push({i:m.index, e:m.index + m[0].length + after.match(/^\s*[点时]/)[0].length,
        h:mo, mi:d, period:"", amb:"「" + m[0].trim() + "点」可能是 " + mo + "月" + d + "日，也可能是 " + ntPad(mo) + ":" + ntPad(d) + "，这里先按时间算"});
      return;
    }
    if(ntValidMD(mo, d)) absDate(today.getFullYear(), mo, d, m, true);
  });
  ntScan(/(今天|今日|今晚|今早|今夜|明天|明日|明晚|明早|后天)(早上|上午|中午|下午|傍晚|晚上|夜里)?/g, text, function(m){
    var w = m[1], off = /^今/.test(w) ? 0 : (w === "后天" ? 2 : 1);
    var per = m[2] || ({"今晚":"晚上","今夜":"夜里","明晚":"晚上","今早":"早上","明早":"早上"})[w] || "";
    dates.push({i:m.index, e:m.index + m[0].length, d:ntAddDays(today, off), src:m[0], sure:true, period:per, note:""});
  });
  ntScan(/(本|这|下个|下)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/g, text, function(m){
    // 紧跟在具体日期后面的「（周二）」只是注释，不单独算
    for(var k=0;k<dates.length;k++){ if(m.index >= dates[k].e && m.index - dates[k].e <= 3 && !m[1]) return; }
    var target = NT_DOW[m[2]], cur = (today.getDay()+6)%7, pre = m[1] || "", d, sure = true, note = "";
    var monday = ntAddDays(today, -cur);
    if(pre === "下" || pre === "下个") d = ntAddDays(monday, 7 + target);
    else if(pre){ d = ntAddDays(monday, target); if(target < cur){ sure = false; note = "「" + m[0].trim() + "」已经过了，请核对"; } }
    else d = ntAddDays(monday, target < cur ? 7 + target : target);
    dates.push({i:m.index, e:m.index + m[0].length, d:d, src:m[0].trim(), sure:sure, note:note});
  });
  ntScan(/(早上|上午|中午|下午|傍晚|晚上|夜里|凌晨)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{2})|点\s*(半)|点\s*(\d{1,2})\s*分?|[点时])/g, text, function(m){
    var before = text.charAt(m.index - 1);
    if(!m[1] && /[\d./]/.test(before)) return;
    for(var k=0;k<times.length;k++){ if(m.index < times[k].e && m.index + m[0].length > times[k].i) return; }
    var h = +m[2], mi = m[3] ? +m[3] : (m[4] ? 30 : (m[5] ? +m[5] : 0));
    if(h > 24 || mi > 59) return;
    times.push({i:m.index, e:m.index + m[0].length, h:h, mi:mi, period:m[1] || ""});
  });
  dates.sort(function(a,b){ return a.i - b.i; });
  // 去掉互相重叠的日期（保留先出现、更长的）
  var ds = [];
  for(var a=0;a<dates.length;a++){
    var x = dates[a], clash = false;
    for(var b=0;b<ds.length;b++){ if(x.i < ds[b].e && x.e > ds[b].i){ clash = true; if(x.e - x.i > ds[b].e - ds[b].i) ds[b] = x; break; } }
    if(!clash) ds.push(x);
  }
  function score(i, e){
    var s = 0, after = text.slice(e, e + 14), before = text.slice(Math.max(0, i - 8), i);
    if(/^[^，。；;！!\n]{0,12}?(前|之前|以前|截止|为止|过期|逾期)/.test(after)) s += 10;
    if(/(截止|截至|最晚|最迟)[^，。；;\n]{0,4}$/.test(before)) s += 8;
    else if(/(于|在)\s*$/.test(before)) s += 2;
    return s;
  }
  var cands = [], used = {};
  for(var c=0;c<ds.length;c++){
    var D = ds[c], T = null;
    for(var t=0;t<times.length;t++){
      var gap = times[t].i - D.e;
      if(gap >= 0 && gap <= 10 && !/[，。；;！!\n]/.test(text.slice(D.e, times[t].i))){ T = times[t]; used[t] = 1; break; }
    }
    var per = D.period || "";
    if(!per){ var pm = text.slice(D.e, D.e + 6).match(NT_PERIOD_RE); if(pm) per = pm[1]; }
    if(T && T.period) per = T.period;
    var end = T ? T.e : D.e;
    cands.push({D:D, T:T, per:per, i:D.i, e:end, s:score(D.i, end)});
  }
  for(var u=0;u<times.length;u++){
    if(used[u]) continue;
    cands.push({D:null, T:times[u], per:times[u].period, i:times[u].i, e:times[u].e, s:score(times[u].i, times[u].e) - 1});
  }
  if(!cands.length) return {due:"", sure:false, exact:false, period:"", src:"", note:"原文里没找到截止时间"};
  cands.sort(function(p,q){ return q.s - p.s || p.i - q.i; });
  var best = cands[0], sure = true, exact = false, hh = 20, mm = 0, day;
  if(best.D){ day = best.D.d; if(!best.D.sure) sure = false; if(best.D.note) notes.push(best.D.note); }
  if(best.T){
    exact = true; hh = best.T.h; mm = best.T.mi;
    if(/下午|傍晚|晚上|夜里/.test(best.per) && hh < 12) hh += 12;
    if(best.per === "中午" && hh <= 2) hh += 12;
    if(hh === 24){ hh = 23; mm = 59; }
    if(best.T.amb){ sure = false; notes.push(best.T.amb); }
  } else if(best.per){
    var dp = NT_PERIOD_DEF[best.per].split(":"); hh = +dp[0]; mm = +dp[1]; sure = false;
    notes.push("原文只写了「" + best.per + "」，先按 " + NT_PERIOD_DEF[best.per] + " 算");
  } else { sure = false; notes.push("原文没写几点，先按 20:00 算"); }
  if(!day){
    sure = false;
    var nowMin = now.getHours()*60 + now.getMinutes();
    day = (hh*60 + mm > nowMin) ? today : ntAddDays(today, 1);
    notes.push("原文只写了几点、没写哪天，先按" + (+day === +today ? "今天" : "明天") + "算");
  }
  var src = text.slice(best.i, best.e).trim();
  return {due: ntYmd(day) + "T" + ntPad(hh) + ":" + ntPad(mm), sure:sure, exact:exact, period: exact ? "" : best.per, src:src, note:notes.join("；")};
}
function ntCleanWhat(s){
  s = String(s || "").replace(/^\s+|\s+$/g, "");
  s = s.replace(/^(?:好|一下|齐)/, "");
  s = s.replace(/^(?:本班|全班|各班|各位|每位|所有|全体)?(?:同学|学生)(?:们)?的?/, "");
  s = s.replace(/^(?:本班|全班)的?/, "");
  s = s.replace(/(?:统一|一并|按时|及时|务必|并)$/, "");
  return s.replace(/^\s+|\s+$/g, "").slice(0, 40);
}
var NT_WHERE_RE = /(交到|交给|交至|送到|送至|发到|发至|发送到|发送至|发给|提交到|提交至|上传到|上传至|填到|填至|放到|报送至|报送到)\s*([^，。；,;！!\n]{2,30})/;
function parseNotice(raw, now){
  now = now || new Date();
  var text = String(raw || "").replace(/\r/g, "").trim();
  var flat0 = text.replace(/\s*\n\s*/g, "，");
  var due = ntFindDue(flat0, now);
  // 括号里的逗号不当分句（「（Word，不少于800字）」）
  var flat = flat0.replace(/（[^（）]*）|\([^()]*\)/g, function(s){ return s.replace(/[，,]/g, "、"); });
  // 交到哪
  var where = "", verb = "", wm = flat.match(NT_WHERE_RE);
  if(wm){
    verb = wm[1];
    where = wm[2].replace(/(?:即可|就行|就可以|处|前|之前)$/, "").replace(/^\s+|\s+$/g, "");
    where = where.replace(/[于在]?\s*\d{1,2}\s*月.*$/, "").replace(/^\s+|\s+$/g, "");
    if(/^(?:辅导员|老师|我)$/.test(where) && verb === "交给") where = where; // 交给辅导员 也算地点
  }
  // 交什么
  var what = "", m;
  var reA = /(?:把|将)(?!于)([^，。；,;！!\n]{2,40}?)(?:统一|一并|按时|及时)?(?:交到|交给|交至|发到|发至|发送到|发送至|发给|提交到|提交至|上传到|上传至|送到|送至|填到|填至|放到|交上|上交|提交|上传|填写|交|发|送)/;
  m = flat.match(reA);
  if(m) what = ntCleanWhat(m[1]);
  if(!what){
    var reB = /(收齐|收集|汇总|统计|上交|提交|填写|完成|上传|报送|上报|交)(?!到|给|至|于|流)([^，。；,;！!\n]{2,40})/g, mb;
    reB.lastIndex = 0;
    while((mb = reB.exec(flat))){
      var cand = mb[2].replace(/(?:交到|交给|交至|发到|发至|提交至|提交到|上传至|上传到|送至|送到)[\s\S]*$/, "").replace(/(?:以班级为单位|由班长统一)[\s\S]*$/, "");
      cand = ntCleanWhat(cand);
      if(cand.length >= 2 && !/^(?:时间|截止)/.test(cand)){
        var tail = !where && cand.match(/^(.{2,}?)(?:到|至)([^（）()]{2,20})$/);
        if(tail){ cand = ntCleanWhat(tail[1]); where = tail[2].replace(/(?:即可|就行|前|之前)$/, ""); verb = /上传/.test(mb[1]) ? "上传到" : "提交到"; }
        what = cand; break;
      }
    }
  }
  // 谁来交
  var who = "", whoSure = true;
  var am = flat.match(/(全体同学|全班同学|每位同学|所有同学|本班同学|本班学生|各位同学|男生|女生|男同学|女同学|宿舍长|寝室长|各宿舍|每个宿舍|各寝室|团员|党员|入党积极分子|班委|各组组长|小组长|新生|学生干部)/);
  if(am){
    var a = am[1];
    who = /全体|全班|每位|所有|本班|各位/.test(a) ? "全班同学" : (/各宿舍|每个宿舍|各寝室/.test(a) ? "每个宿舍" : a.replace("男同学","男生").replace("女同学","女生"));
  } else { who = "全班同学"; whoSure = false; }
  // 收法：以班级为单位 / 班长收齐 / 统一 → 同学交给我，我统一交（不允许改成「各自提交」）
  var mode = /以班级为单位|由班长统一|班长(?:统一)?(?:收齐|收集|汇总)|收齐|汇总|统一(?:提交|上交|交|报送)|统一收/.test(flat) ? "monitor" : "self";
  // 材料 / 格式补充（原句照录，带「班长」「各班」的不录）
  var extra = [], clauses = flat.split(/[，。；;！!,]+/);
  for(var i=0;i<clauses.length && extra.length < 2;i++){
    var cl = clauses[i].replace(/^\s+|\s+$/g, "");
    if(!cl || /班长|各班|逾期|过期|不候/.test(cl)) continue;
    var km = cl.match(/纸质|电子版|手写|签名|签字|盖章|截图|复印件|扫描件|附件|表格|命名|格式|PDF|pdf|Word|word|Excel|字数|照片|证件照/);
    if(!km) continue;
    if(what && what.indexOf(km[0]) >= 0) continue;
    if(what && cl.indexOf(what) >= 0) continue;
    extra.push(cl.replace(/^(?:请|并|另外|注意)/, ""));
  }
  var sm = flat.match(/逾期不候|过期不候|过时不候|逾期不予[^，。；,;！!\n]{0,4}|不予受理|不可补交|不得补交|不接受补交|不再补收|一律不收/);
  var flags = {what:!what, where:!where, who:!whoSure, due:!due.sure, collect:!due.sure};
  return {raw:text, what:what, where:where, verb:verb, who:who, mode:mode, due:due.due, dueSure:due.sure,
    dueExact:due.exact, duePeriod:due.period, dueSrc:due.src, dueNote:due.note,
    extra:extra.join("；"), strict:!!sm, strictSrc: sm ? sm[0] : "", flags:flags};
}
function ntDueText(due, exact, period){
  if(!due) return "";
  var p = String(due).split("T"), d = p[0].split("-"), dt = new Date(+d[0], +d[1]-1, +d[2]);
  var s = (+d[1]) + "月" + (+d[2]) + "日（" + NT_DOW_NAME[(dt.getDay()+6)%7] + "）";
  if(exact) return s + p[1].slice(0,5);
  if(period) return s + period;
  return s;
}
/* 群公告：像人写的短消息；没识别的不编，留「【待补】」给你填 */
function composeNotice(f){
  var L = ["【班委通知】"];
  var greet = (!f.who || f.who === "全班同学" || f.who === "全体同学") ? "各位同学" : "各位同学（本条涉及：" + f.who + "）";
  var dueTxt = ntDueText(f.due, f.exact, f.period);
  var when = dueTxt ? "请于" + dueTxt + "前，" : "请";
  var s;
  if(!f.what && !f.where && f.raw){
    L.push(greet + "，转发一则通知：");
    L.push(String(f.raw).replace(/^\s+|\s+$/g, ""));
    if(dueTxt) L.push("截止：" + dueTxt + "。");
    if(f.strict) L.push("逾期不候，请务必按时。");
    L.push("谢谢配合。"); L.push("——班长 白鑫宇");
    return L.join("\n");
  }
  if(f.mode === "monitor"){
    s = greet + "，" + when + (f.what ? "把" + f.what + "交给我" : "把材料交给我") +
        (f.where ? "，由我统一" + (/^(?:发|交给|上传|提交|送)/.test(f.verb || "") ? f.verb : "交到") + f.where : "，由我统一上交") + "。";
  } else {
    var v = f.verb || "交到";
    s = greet + "，" + when + (f.what ? "将" + f.what : "按要求") + (f.where ? v + f.where : (f.what ? "按要求提交" : "完成")) + "。";
  }
  if(!dueTxt) s += "截止时间：【待补】。";
  L.push(s);
  if(f.extra) L.push("要求：" + String(f.extra).replace(/[。；;]+$/, "") + "。");
  if(f.strict) L.push("逾期不候，请务必按时。");
  L.push("谢谢配合。");
  L.push("——班长 白鑫宇");
  return L.join("\n");
}
/* NT-PARSER-END */

/* ================= 收齐统计：纯函数（不碰 DOM；node 可单独测） ================= */
/* COL-PURE-START */
var COL_NEG_RE = /没交|未交|还没|没有交|没提交|未提交|没上交|未上交|没完成|未完成|忘了交|忘交|交不了|没法交|不交|缺交|未收到|没收到/;
/* 名单粘贴：一行一个，也认逗号 / 顿号 / 分号 / 空白；去掉序号、学号、@，去重保序 */
function rosterParse(text){
  var parts = String(text || "").replace(/\r/g, "").split(/[\n,，、;；|\t ]+|\u3000+/), out = [], seen = {};
  for(var i=0;i<parts.length;i++){
    var s = parts[i].replace(/^[@＠]+/, "").replace(/^[\(（\[【]?\d+[\)）\]】.．:：、-]*/, "").replace(/\d{5,}/g, "")
      .replace(/[：:。.!！?？"“”'‘’（）()【】\[\]<>《》]+$/g, "").replace(/^[：:。.!！?？"“”'‘’（）()【】\[\]<>《》]+/g, "").trim();
    if(!s || /^\d+$/.test(s) || s.length > 20) continue;
    if(seen[s]) continue;
    seen[s] = 1; out.push(s);
  }
  return out;
}
function rosterMerge(base, add){
  var out = (base || []).slice(), seen = {};
  out.forEach(function(n){ seen[n] = 1; });
  (add || []).forEach(function(n){ if(n && !seen[n]){ seen[n] = 1; out.push(n); } });
  return out;
}
/* 从群聊天记录里找名单上的名字：
 * - 一行里出现名字就算「已交」（兼容 @张三、张三已交、已交 张三、张三：[图片]）
 * - 长名字优先（「张三丰」不会误勾「张三」）
 * - 一行里有「没交 / 还没 / 未交」等字样 → 这行的名字都不勾，单独报出来
 * - 单字名不自动匹配（太容易误中）
 * 返回 {hit:[], neg:[], already:[], unknownLines:n, skipped:[]}；只告诉调用方该勾谁，绝不返回「取消勾选」 */
function chatMatch(text, roster, checked){
  checked = checked || {};
  var names = (roster || []).filter(function(n){ return n && n.length >= 2; }).slice().sort(function(a,b){ return b.length - a.length; });
  var skipped = (roster || []).filter(function(n){ return n && n.length < 2; });
  var lines = String(text || "").replace(/\r/g, "").split(/\n+/);
  var hit = [], neg = [], already = [], seenHit = {}, seenNeg = {}, unknown = 0;
  for(var li=0; li<lines.length; li++){
    var line = lines[li].trim(); if(!line) continue;
    var mask = line, found = [];
    for(var k=0;k<names.length;k++){
      var n = names[k], at = mask.indexOf(n);
      if(at < 0) continue;
      found.push(n);
      while(at >= 0){ mask = mask.slice(0, at) + new Array(n.length + 1).join("\u0000") + mask.slice(at + n.length); at = mask.indexOf(n); }
    }
    if(!found.length){ if(/[\u4e00-\u9fa5A-Za-z]/.test(line)) unknown++; continue; }
    var isNeg = COL_NEG_RE.test(mask.replace(/\u0000+/g, " "));
    found.forEach(function(n){
      if(isNeg){ if(!seenNeg[n] && !seenHit[n]){ seenNeg[n] = 1; } return; }
      if(seenHit[n]) return;
      seenHit[n] = 1;
      if(checked[n]) already.push(n); else hit.push(n);
    });
  }
  for(var x in seenNeg) if(!seenHit[x]) neg.push(x);
  return {hit:hit, neg:neg, already:already, unknownLines:unknown, skipped:skipped};
}
/* 已交记录里不在当前名单的姓名（改名 / 删人后保留在数据里，不显示在表上） */
function colOrphans(checked, roster){
  var inR = {}, out = [];
  (roster || []).forEach(function(n){ inR[n] = 1; });
  for(var n in (checked || {})) if(checked[n] && !inR[n]) out.push(n);
  return out;
}
function colStats(checked, roster){
  var done = 0;
  (roster || []).forEach(function(n){ if(checked && checked[n]) done++; });
  return {done:done, total:(roster || []).length, left:(roster || []).length - done};
}
/* 「还没交」催办文案：直接贴进群。ctx = {what, due:"YYYY-MM-DDTHH:MM", where, mode} */
function colUnpaidText(names, ctx, dueText){
  ctx = ctx || {};
  var who = names.join("、");
  var head = "还没交" + (ctx.what ? "「" + ctx.what + "」" : "") + "的同学：" + who + "（共 " + names.length + " 人）";
  var to = ctx.mode === "monitor" ? "交给我" : (ctx.where ? "交到" + ctx.where : "按要求提交");
  var when = dueText ? "请于" + dueText + "前" + to : "请尽快" + to;
  return head + "，" + when + "，谢谢～";
}
/* COL-PURE-END */

/* ================= 转发通知：界面（v3.1） ================= */
var nt = {sid:"", lastRaw:"", outDirty:false, colTouched:false, timer:null, added:false};
var NT_FIELDS = ["ntWhat","ntWho","ntMode","ntWhere","ntStuDate","ntStuTime","ntColDate","ntColTime","ntStrict","ntExtra"];
var NT_FLAG_OF = {ntWhat:"what", ntWho:"who", ntWhere:"where", ntStuDate:"due", ntStuTime:"due", ntColDate:"collect", ntColTime:"collect"};
function ntSetFlag(k, on){ var el = $("chk-" + k); if(el) el.hidden = !on; }
function ntSplitDue(due){ var p = String(due || "").split("T"); return {d:p[0] || "", t:(p[1] || "").slice(0,5)}; }
function ntFieldDue(dId, tId){
  var d = $(dId).value, t = normTime($(tId).value);
  return (d && t) ? d + "T" + t : "";
}
function ntReadFields(){
  var stu = ntFieldDue("ntStuDate","ntStuTime");
  return {raw:nt.parsed ? nt.parsed.raw : $("ntRaw").value.trim(),
    what:$("ntWhat").value.trim(), who:$("ntWho").value.trim(), where:$("ntWhere").value.trim(),
    verb:nt.parsed ? nt.parsed.verb : "", mode:$("ntMode").value,
    due:stu, exact:nt.exact, period:nt.exact ? "" : nt.period,
    collect:ntFieldDue("ntColDate","ntColTime"),
    extra:$("ntExtra").value.trim(), strict:$("ntStrict").value === "1"};
}
function ntShowWarn(msg){ var w = $("ntOutWarn"); if(!w) return; w.hidden = !msg; w.textContent = msg || ""; }
function ntRefreshHints(){
  var f = ntReadFields(), post = ntPostDue(f);
  $("ntPostHint").textContent = "约 " + dtShort(new Date(post).getTime()) + " 提醒你去发（待办截止就是这个点）";
  $("ntColHint").textContent = f.collect ? "截止 " + dtShort(new Date(f.collect).getTime()) + "，提前 1 天和 2 小时各提醒一次" : "先在上面填「我要收齐的时间」";
}
function ntGenerate(force){
  var raw = $("ntRaw").value.trim();
  if(!raw){ $("ntOutCard").hidden = true; $("ntFieldCard").hidden = true; nt.parsed = null; return false; }
  if(raw !== nt.lastRaw){ nt.sid = uid(); nt.added = false; nt.colTouched = false; nt.lastRaw = raw; }
  var p = parseNotice(raw, new Date());
  nt.parsed = p; nt.exact = p.dueExact; nt.period = p.duePeriod;
  var sd = ntSplitDue(p.due);
  $("ntWhat").value = p.what; $("ntWho").value = p.who; $("ntWhere").value = p.where;
  $("ntMode").value = p.mode; $("ntStrict").value = p.strict ? "1" : "0"; $("ntExtra").value = p.extra;
  $("ntStuDate").value = sd.d; $("ntStuTime").value = sd.t;
  $("ntColDate").value = sd.d; $("ntColTime").value = sd.t;
  for(var k in p.flags) ntSetFlag(k, p.flags[k]);
  var note = p.dueNote || "";
  if(p.dueSrc) note = "原文：「" + p.dueSrc + "」" + (note ? "。" + note : "");
  $("ntDueNote").textContent = note; $("ntDueNote").hidden = !note;
  $("ntDueNote").classList.toggle("nt-note-warn", !p.dueSure);
  $("ntModeNote").hidden = p.mode !== "monitor";
  qsa("#ntFieldCard [aria-invalid]").forEach(function(el){ el.removeAttribute("aria-invalid"); });
  $("ntOutCard").hidden = false; $("ntFieldCard").hidden = false;
  if(!nt.outDirty || force){ $("ntOut").value = composeNotice(ntReadFields()); nt.outDirty = false; ntShowWarn(""); }
  else ntShowWarn("原文改了，但你手改过公告，没有覆盖。需要的话点「用这些字段重写公告」。");
  ntRefreshHints();
  return true;
}
function ntOnField(id){
  if(NT_FLAG_OF[id]) ntSetFlag(NT_FLAG_OF[id], false);
  if(id === "ntStuTime") nt.exact = true;
  if((id === "ntStuDate" || id === "ntStuTime") && !nt.colTouched){
    $("ntColDate").value = $("ntStuDate").value; $("ntColTime").value = $("ntStuTime").value;
  }
  if(id === "ntColDate" || id === "ntColTime"){ nt.colTouched = true; ntSetFlag("collect", false); }
  if(id === "ntMode") $("ntModeNote").hidden = $("ntMode").value !== "monitor";
  if(!nt.outDirty){ $("ntOut").value = composeNotice(ntReadFields()); ntShowWarn(""); }
  else ntShowWarn("你手改过公告，字段改动没自动写进去。需要的话点「用这些字段重写公告」。");
  ntRefreshHints();
}
function ntRewrite(){
  if(!nt.parsed && !ntGenerate(true)){ toast("先粘贴通知原文"); return; }
  if(nt.outDirty && !window.confirm("公告文字你手改过，按字段重写会覆盖这些修改。继续？")) return;
  $("ntOut").value = composeNotice(ntReadFields()); nt.outDirty = false; ntShowWarn("");
  toast("已按字段重写公告");
}
function ntLogUpsert(){
  var f = ntReadFields(), out = $("ntOut").value.trim();
  if(!out) return;
  if(!nt.sid) nt.sid = uid();
  var prev = ntLogById(nt.sid);
  var entry = {id:nt.sid, at:new Date().toISOString(), title:f.what || f.raw.slice(0,18) || "通知",
    due:f.due, broadcast:out, raw:f.raw, what:f.what, where:f.where, mode:f.mode, stuDue:f.due ? localISO(f.due) : ""};
  if(prev && isObj(prev.collectChecked)) entry.collectChecked = prev.collectChecked;   // 收齐勾选跟着这条记录走
  state.noticeLog = (state.noticeLog || []).filter(function(x){ return x && x.id !== nt.sid; });
  state.noticeLog.unshift(entry);
  if(state.noticeLog.length > 30) state.noticeLog.length = 30;
  save(); renderNoticeLog();
}
function ntCopy(){
  var out = $("ntOut").value.trim();
  if(!out){ toast("先粘贴通知，生成群公告"); return; }
  ntLogUpsert();
  copyText(out, /【待补/.test(out) ? "已复制。注意公告里还有【待补】没填" : "已复制，去班群粘贴");
}
/* 发群提醒：原文一般不写「几点前发群」，所以设在 1 小时后（不晚于同学截止），绝不默认明天 20:00 */
function ntPostDue(f){
  var t = Date.now() + 60*60000;
  t = Math.ceil(t / (5*60000)) * 5*60000;
  if(f && f.due){ var sd = new Date(localISO(f.due)).getTime(); if(isFinite(sd) && sd > Date.now() && sd < t) t = sd; }
  var d = new Date(t);
  return fmt(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function ntAddTodos(){
  if(!nt.parsed && !ntGenerate(true)){ toast("先粘贴通知原文"); $("ntRaw").focus(); return; }
  var f = ntReadFields(), out = $("ntOut").value.trim() || composeNotice(f);
  var wantPost = $("ntPostOn").checked, wantCol = $("ntColOn").checked;
  if(!wantPost && !wantCol){ toast("两个提醒都关了，没东西可加"); return; }
  if(wantCol && !f.collect){
    toast("先填「我要收齐的时间」，或关掉「提醒我收齐」");
    $("ntColDate").setAttribute("aria-invalid","true"); $("ntColDate").focus(); return;
  }
  if(nt.added && !window.confirm("这条通知已经加过待办了，再加一次？")) return;
  var name = f.what || (f.raw.slice(0,16) + (f.raw.length > 16 ? "…" : "")) || "班长通知";
  var base = {type:"notice", audience:f.who || "全班", note:f.raw, broadcast:out, what:f.what, noticeId:nt.sid,
    where:f.where, mode:f.mode, stuDue:f.due ? localISO(f.due) : "",
    done:false, createdAt:new Date().toISOString()};
  var made = [];
  if(wantPost){
    var pd = ntPostDue(f);
    state.todos.push(fill({id:uid(), role:"post", title:"发群：" + name, due:localISO(pd), leadMin:0, alertsMin:[0]}, base));
    made.push("发群 " + dtShort(new Date(localISO(pd)).getTime()));
  }
  if(wantCol){
    state.todos.push(fill({id:uid(), role:"collect", title:"收齐：" + name, due:localISO(f.collect), leadMin:1440, collectChecked:{}}, base));
    made.push("收齐 " + dtShort(new Date(localISO(f.collect)).getTime()));
  }
  nt.added = true;
  ntLogUpsert(); save(); renderTodos(); renderSoon(); renderReminders();
  var guess = wantCol && !$("chk-collect").hidden;
  toast("已加入待办：" + made.join("、") + (guess ? "。收齐时间是推测的，请先核对时间" : (wantCol && !(state.classRoster || []).length ? "。导入本班名单后可逐人勾已交" : "")));
}
function ntClear(){
  $("ntRaw").value = ""; nt.lastRaw = ""; nt.outDirty = false; nt.parsed = null;
  $("ntOut").value = ""; ntShowWarn(""); ntGenerate(false); $("ntRaw").focus();
}
function ntPaste(){
  if(!navigator.clipboard || !navigator.clipboard.readText){ toast("这个浏览器不让读剪贴板，长按输入框粘贴"); $("ntRaw").focus(); return; }
  navigator.clipboard.readText().then(function(s){
    if(!s || !s.trim()){ toast("剪贴板是空的"); return; }
    $("ntRaw").value = s.trim(); nt.outDirty = false; ntGenerate(true); ntScrollOut(); toast("已粘贴并生成，看一眼标「请核对」的项");
  }, function(){ toast("没拿到剪贴板，长按输入框粘贴"); $("ntRaw").focus(); });
}
function ntScrollOut(){ var c = $("ntOutCard"); if(c && !c.hidden && window.innerWidth < 1024) try { c.scrollIntoView({behavior:"smooth", block:"start"}); } catch(_){ c.scrollIntoView(); } }
function ntLogById(id){ var L = state.noticeLog || []; for(var i=0;i<L.length;i++) if(L[i] && L[i].id === id) return L[i]; return null; }
function ntLoad(id){
  var e = ntLogById(id); if(!e) return;
  $("ntRaw").value = e.raw || ""; nt.outDirty = false; nt.lastRaw = "";
  ntGenerate(true); nt.sid = e.id; nt.added = false;
  if(e.broadcast){ $("ntOut").value = e.broadcast; nt.outDirty = e.broadcast !== composeNotice(ntReadFields()); }
  window.scrollTo(0,0); toast("已载入，可以接着改");
}
function renderNoticeLog(){
  var box = $("ntLog"); if(!box) return;
  var L = (state.noticeLog || []).filter(function(x){ return x && x.broadcast; });
  if(!L.length){ box.innerHTML = '<li class="empty">还没有转发记录。复制公告或加入待办后会出现在这里。</li>'; return; }
  box.innerHTML = L.map(function(e){
    var at = new Date(e.at).getTime(), ct = ntCollectTodoOf(e.id);
    var colBtn = ct ? '<button type="button" class="btn btn-sm btn-col" data-act="col-open" data-kind="todo" data-id="'+esc(ct.id)+'">收齐表 · '+esc(colProgressText(ct))+'</button>'
      : '<button type="button" class="btn btn-sm btn-col" data-act="col-open" data-kind="log" data-id="'+esc(e.id)+'">收齐表'+(isObj(e.collectChecked) && Object.keys(e.collectChecked).length ? ' · '+esc(colProgressText(e)) : '')+'</button>';
    return '<li class="nt-log-item"><div class="nt-log-main"><b>'+esc(e.title)+'</b>'+
      '<small>'+(e.due ? '截止 '+esc(dateCN(e.due))+' '+esc(String(e.due).slice(11,16)) : '截止未填')+(isFinite(at) ? ' · 转发于 '+dtShort(at) : '')+'</small></div>'+
      '<div class="nt-log-act">'+colBtn+'<button type="button" class="btn btn-sm" data-act="nt-log-copy" data-id="'+esc(e.id)+'">复制公告</button>'+
      '<button type="button" class="btn btn-sm" data-act="nt-log-load" data-id="'+esc(e.id)+'">载入再改</button></div></li>';
  }).join("");
}
/* 今日页入口：有没收齐 / 没发群的通知就显示最近一条（收齐的带「已交 x/y」），否则一个「转发通知」按钮 */
function ntCollectTodoOf(noticeId){
  if(!noticeId) return null;
  var c = state.todos.filter(function(t){ return isCollectTodo(t) && t.noticeId === noticeId; });
  c.sort(function(a,b){ return (a.done - b.done) || (new Date(a.due) - new Date(b.due)); });
  return c[0] || null;
}
function ntEntryRow(t, extra){
  var over = new Date(t.due).getTime() < Date.now();
  var when = (over ? '<em class="over">已过期</em> · ' : '截止 ') + esc(dateCN(t.due)) + ' ' + esc(timeCN(t.due));
  if(isCollectTodo(t)){
    var r = state.classRoster || [], s = colStats(colChecked(t), r);
    var prog = r.length ? '<em class="nt-prog' + (s.left ? '' : ' ok') + '">' + esc(colProgressText(t)) + '</em>' : '<em class="nt-prog none">还没导入名单</em>';
    return '<button type="button" class="nt-entry-btn has" data-act="col-open" data-kind="todo" data-id="' + esc(t.id) + '"><b>' + esc(t.title) + '</b>' +
      '<span>' + prog + ' · ' + when + extra + '</span><i aria-hidden="true">›</i></button>';
  }
  return '<a class="nt-entry-btn has" href="#/todos/list"><b>' + esc(t.title) + '</b><span>' + when + extra + '</span><i aria-hidden="true">›</i></a>';
}
function renderNoticeEntry(){
  var box = $("ntEntry"); if(!box) return;
  var open = state.todos.filter(function(t){ return t.type === "notice" && !t.done && isFinite(new Date(t.due).getTime()); })
    .sort(function(a,b){ return new Date(a.due) - new Date(b.due); });
  if(!open.length){
    box.innerHTML = '<button type="button" class="nt-entry-btn" data-act="nt-open"><b>转发通知</b><span>粘贴辅导员的消息，生成群公告</span><i aria-hidden="true">›</i></button>';
    return;
  }
  var first = open[0], col1 = null;
  for(var i=0;i<open.length;i++){ if(isCollectTodo(open[i])){ col1 = open[i]; break; } }
  var rows = [first];
  if(col1 && col1 !== first) rows.push(col1);
  var more = open.length - rows.length;
  box.innerHTML = '<div class="nt-entry-rows">' + rows.map(function(t, k){
    return ntEntryRow(t, (k === rows.length - 1 && more > 0) ? ' · 还有 ' + more + ' 条' : '');
  }).join("") + '</div>' +
    '<button type="button" class="btn btn-sm nt-entry-new" data-act="nt-open">+ 转发通知</button>';
}

/* ================= 收齐统计：界面（v3.2，名单只存本机） ================= */
var col = {kind:"", id:"", filter:"all", gender:"", lastMsg:""};
function isCollectTodo(t){ return !!t && (t.role === "collect" || /^收齐[：:]/.test(String(t.title || ""))); }
function colTarget(kind, id){
  if(kind === "log") return ntLogById(id);
  var t = todoById(id); return t;
}
function colChecked(obj){ if(!obj) return {}; if(!isObj(obj.collectChecked)) obj.collectChecked = {}; return obj.collectChecked; }
function colCtx(obj, kind){
  if(!obj) return {};
  var due = obj.stuDue || obj.due || "";
  var what = obj.what || String(obj.title || "").replace(/^(?:收齐|发群)[：:]\s*/, "");
  var who = obj.who || obj.audience || "";
  return {what:what, due:due ? String(due).slice(0,16) : "", where:obj.where || "", mode:obj.mode || (kind === "todo" && obj.type === "notice" ? "monitor" : ""), who:who};
}
function colDueText(ctx){ return ctx.due && /T\d\d:\d\d/.test(ctx.due) ? ntDueText(ctx.due, true, "") : ""; }
function colProgressText(obj){
  var r = state.classRoster || [];
  if(!r.length) return "还没导入名单";
  var s = colStats(colChecked(obj), r);
  return s.left ? "已交 " + s.done + "/" + s.total : "已收齐 " + s.total + "/" + s.total;
}
function colOpen(kind, id){
  var obj = colTarget(kind, id);
  if(!obj){ toast("这条记录找不到了"); return; }
  col.kind = kind; col.id = id; col.filter = "all"; col.lastMsg = "";
  col.gender = audienceGender(colCtx(obj, kind).who);
  if($("colChat")) $("colChat").value = "";
  renderColSheet(); openSheet("colSheet");
}
function renderColSheet(){
  var box = $("colBody"); if(!box || !col.id) return;
  var obj = colTarget(col.kind, col.id);
  if(!obj){ closeSheet("colSheet"); return; }
  var ctx = colCtx(obj, col.kind), dueTxt = colDueText(ctx);
  $("colTitle").textContent = "收齐表";
  $("colSub").textContent = (ctx.what || obj.title || "通知") + (dueTxt ? " · 同学截止 " + dueTxt : "");
  var allRoster = state.classRoster || [], ck = colChecked(obj);
  if(!allRoster.length){
    $("colMain").hidden = true; $("colEmpty").hidden = false; $("colClearBtn").hidden = true;
    return;
  }
  $("colMain").hidden = false; $("colEmpty").hidden = true; $("colClearBtn").hidden = false;
  var gBox = $("colGender");
  if(gBox) gBox.hidden = !rosterHasGender(allRoster);
  setPressed(qsa("#colGender button"), function(b){ return (b.getAttribute("data-v") || "") === (col.gender || ""); });
  var roster = rosterByGender(allRoster, col.gender);
  var s = colStats(ck, roster);
  var scopeNote = col.gender ? ("（" + col.gender + "生 " + s.total + " 人）") : "";
  $("colStat").innerHTML = '<b>' + s.done + '</b><span>/ ' + s.total + ' 已交' + scopeNote + '</span>' +
    (s.left ? '<em>未交 ' + s.left + ' 人</em>' : '<em class="ok">全部收齐</em>');
  var bar = $("colBar"); bar.style.width = (s.total ? Math.round(s.done / s.total * 100) : 0) + "%";
  setPressed(qsa("#colFilter button"), function(b){ return b.getAttribute("data-v") === col.filter; });
  var list = roster.filter(function(n){ return col.filter === "all" || (col.filter === "done" ? !!ck[n] : !ck[n]); });
  $("colList").innerHTML = list.length ? list.map(function(n){
    var on = !!ck[n], meta = rosterInfoLine(n);
    return '<li><button type="button" class="col-name' + (on ? ' on' : '') + '" data-act="col-tick" data-name="' + esc(n) + '" aria-pressed="' + on + '">' +
      '<i aria-hidden="true">' + TICK_SVG + '</i><span class="col-txt"><b>' + esc(n) + '</b>' +
      (meta ? '<small>' + esc(meta) + '</small>' : '') + '</span></button></li>';
  }).join("") : '<li class="empty">' + (col.filter === "left" ? "没有未交的人了。" : "还没人勾上。") + '</li>';
  var orph = colOrphans(ck, roster);
  var on = $("colOrphan");
  if(orph.length){
    on.hidden = false;
    $("colOrphanTxt").textContent = "有 " + orph.length + " 条已交记录的名字不在当前名单里（" + orph.slice(0,6).join("、") + (orph.length > 6 ? "…" : "") + "），已保留没删；名单里加回这些名字就会恢复。";
  } else on.hidden = true;
  $("colMsg").textContent = col.lastMsg; $("colMsg").hidden = !col.lastMsg;
}
function colToggle(name){
  var obj = colTarget(col.kind, col.id); if(!obj) return;
  var ck = colChecked(obj);
  if(ck[name]) delete ck[name]; else ck[name] = true;
  save(); renderColSheet(); colRefreshOutside();
  if(navigator.vibrate) try { navigator.vibrate(6); } catch(_){}
}
function colRefreshOutside(){ renderTodos(); renderNoticeEntry(); renderNoticeLog(); }
function colCopyLeft(){
  var obj = colTarget(col.kind, col.id); if(!obj) return;
  var roster = rosterByGender(state.classRoster || [], col.gender), ck = colChecked(obj);
  if(!(state.classRoster || []).length){ toast("先导入名单"); return; }
  var left = roster.filter(function(n){ return !ck[n]; });
  if(!left.length){ toast("全员已交，没有要催的"); return; }
  var ctx = colCtx(obj, col.kind);
  copyText(colUnpaidText(left, ctx, colDueText(ctx)), "已复制未交名单（" + left.length + " 人），去群里粘贴");
}
function colFromChat(){
  var obj = colTarget(col.kind, col.id); if(!obj) return;
  var txt = $("colChat").value;
  if(!txt.trim()){ toast("先把群里的回复粘贴进来"); $("colChat").focus(); return; }
  var ck = colChecked(obj), r = chatMatch(txt, state.classRoster || [], ck);
  r.hit.forEach(function(n){ ck[n] = true; });   // 只加不减：没匹配到的人保持原样
  var msg = [];
  msg.push(r.hit.length ? "勾上 " + r.hit.length + " 人：" + r.hit.join("、") : "没有新勾上的人");
  if(r.already.length) msg.push("本来就勾着 " + r.already.length + " 人");
  if(r.neg.length) msg.push("像是「还没交」的没勾：" + r.neg.join("、"));
  if(r.unknownLines) msg.push(r.unknownLines + " 行没认出名单里的名字，需要的话手点");
  if(r.skipped.length) msg.push("单字名不自动匹配：" + r.skipped.join("、"));
  col.lastMsg = msg.join("。") + "。";
  save(); renderColSheet(); colRefreshOutside();
  toast(r.hit.length ? "从聊天记录勾上 " + r.hit.length + " 人" : "没匹配到新的人，可以手点");
}
function colClearOrphans(){
  var obj = colTarget(col.kind, col.id); if(!obj) return;
  var ck = colChecked(obj), orph = colOrphans(ck, state.classRoster || []);
  if(!orph.length) return;
  if(!window.confirm("删掉这 " + orph.length + " 条不在名单里的已交记录？")) return;
  orph.forEach(function(n){ delete ck[n]; });
  save(); renderColSheet(); toast("已清掉");
}
function colClearAll(){
  var obj = colTarget(col.kind, col.id); if(!obj) return;
  if(!window.confirm("把这条通知的勾选全部清空？（其他通知不受影响）")) return;
  obj.collectChecked = {}; save(); renderColSheet(); colRefreshOutside(); toast("这条通知的勾选已清空");
}
/* 所有带已交记录的对象（待办 + 转发记录），改名时一起迁移 */
function colAllTargets(){
  var out = [];
  (state.todos || []).forEach(function(t){ if(t && isObj(t.collectChecked)) out.push(t); });
  (state.noticeLog || []).forEach(function(e){ if(e && isObj(e.collectChecked)) out.push(e); });
  return out;
}

/* ---------- 本班名单 ---------- */
function rosterSet(list){ state.classRoster = list; save(); renderRosterAll(); }
function renderRosterAll(){
  if(!appReady) return;
  var n = (state.classRoster || []).length;
  var t = n ? "已导入 " + n + " 人" : "还没导入";
  if($("rosterState")) $("rosterState").textContent = "本班名单：" + t + " · 改动只存在这台设备";
  if($("ntRosterState")) $("ntRosterState").textContent = n ? "本班名单 " + n + " 人，收齐待办里点「收齐表」逐人勾" : "还没导入本班名单，导入后收齐待办能逐人勾、复制未交";
  renderRosterSheet(); renderColSheet(); colRefreshOutside();
}
function renderRosterSheet(){
  var box = $("rosterList"); if(!box) return;
  var r = state.classRoster || [];
  $("rosterCount").textContent = r.length ? "共 " + r.length + " 人。改名会带着已交记录走；删掉的人，已交记录仍保留在数据里。" : "还没有名单。从班级群或教务系统复制名单粘贴到上面。";
  box.innerHTML = r.map(function(n, i){
    var meta = rosterInfoLine(n), g = rosterInfo(n).gender;
    var hint = [g, meta].filter(Boolean).join(" · ");
    return '<li><span class="ro-i">' + (i+1) + '</span><div class="ro-main"><input class="ro-name" data-idx="' + i + '" value="' + esc(n) + '" aria-label="第 ' + (i+1) + ' 人姓名" autocomplete="off">' +
      (hint ? '<small class="ro-meta">' + esc(hint) + '</small>' : '') + '</div>' +
      '<button type="button" class="btn btn-icon btn-sm ro-del" data-act="ro-del" data-idx="' + i + '" aria-label="删除 ' + esc(n) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>';
  }).join("");
  $("rosterClear").hidden = !r.length;
}
function rosterOpen(){ $("roPaste").value = ""; renderRosterSheet(); openSheet("rosterSheet", $("roPaste")); }
function rosterImport(srcId, replace){
  var el = $(srcId), add = rosterParse(el.value);
  if(!add.length){ toast("没认出姓名：一行一个，或用逗号、顿号、空格隔开"); el.focus(); return; }
  var cur = state.classRoster || [];
  if(replace && cur.length && !window.confirm("用这 " + add.length + " 人替换现在的 " + cur.length + " 人？已交记录会保留，名字对得上的继续显示。")) return;
  var next = replace ? add : rosterMerge(cur, add), gained = next.length - (replace ? 0 : cur.length);
  el.value = ""; rosterSet(next);
  toast(replace ? "名单已替换为 " + next.length + " 人" : (gained ? "导入 " + gained + " 人，现在共 " + next.length + " 人" + (gained < add.length ? "（重复的已去掉）" : "") : "这些人都已经在名单里了"));
}
function rosterRename(idx, val){
  var r = (state.classRoster || []).slice(), old = r[idx];
  if(old === undefined) return;
  var nv = String(val || "").replace(/[\s\u3000]+/g, "").replace(/^[@＠]+/, "");
  if(!nv){ toast("名字不能空；要删人点右边的 ×"); renderRosterSheet(); return; }
  if(nv.length > 20){ toast("名字太长了（最多 20 字）"); renderRosterSheet(); return; }
  if(nv === old){ renderRosterSheet(); return; }
  var dup = r.indexOf(nv) >= 0;
  colAllTargets().forEach(function(o){ var ck = o.collectChecked; if(ck[old]){ ck[nv] = true; delete ck[old]; } });
  if(state.classRosterInfo && state.classRosterInfo[old]){
    if(!state.classRosterInfo[nv]) state.classRosterInfo[nv] = state.classRosterInfo[old];
    delete state.classRosterInfo[old];
  }
  if(dup) r.splice(idx, 1); else r[idx] = nv;
  rosterSet(r);
  toast(dup ? "「" + nv + "」已在名单里，已合并（勾选一并带过去）" : "已改为「" + nv + "」，已交记录跟着改了");
}
function rosterDel(idx){
  var r = (state.classRoster || []).slice(), n = r[idx]; if(n === undefined) return;
  if(!window.confirm("从名单删掉「" + n + "」？（已交记录保留在数据里，不显示）")) return;
  r.splice(idx, 1); rosterSet(r); toast("已删掉「" + n + "」");
}
function rosterAddOne(){
  var el = $("roOne"), add = rosterParse(el.value);
  if(!add.length){ el.focus(); return; }
  var before = (state.classRoster || []).length, next = rosterMerge(state.classRoster, add);
  el.value = ""; rosterSet(next);
  toast(next.length > before ? "已添加" : "已经在名单里了");
  try { el.focus(); } catch(_){}
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
  if(Array.isArray(t.alertsMin)){   // v3.1「发群」待办：到点就提醒
    for(var i=0;i<t.alertsMin.length;i++){ var m = +t.alertsMin[i] || 0;
      pts.push({label: m ? "提前 " + leadText(m) : "到点去发群", at:due - m*60000}); }
    return pts;
  }
  pts.push({label:"提前 " + leadText(ty.lead) + "首发", at:due - ty.lead*60000});
  if(ty.extra) pts.push({label:"截止前 " + leadText(ty.extra) + "二次催", at:due - ty.extra*60000});
  return pts;
}
function noticeText(t, second){
  var d = dateCN(t.due), tm = timeCN(t.due);
  if(t.type === "notice"){
    if(!second && t.broadcast) return t.broadcast;
    return second
      ? "【提醒】" + (t.what || t.title) + " 将于 " + d + " " + tm + " 截止，还没交的同学请抓紧，谢谢～"
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
    : "辅导员的通知在「转发通知」里一键变成群公告，再加「发群」「收齐」两条提醒。";
  setPressed(qsa("#todoQuery [data-tq]"), function(b){
    var k = b.getAttribute("data-tq"); return k === "risk" ? todoQuery.riskSort : k === todoQuery.scope;
  });
  if(!list.length){
    $("todoList").innerHTML = '<li class="empty">' +
      (all.length ? '这个筛选下没有待办，点「全部」看回来。' : '还没有待办。在「转发通知」粘贴辅导员的消息，可一键加「发群」「收齐」提醒；或者用表单加一条。') + '</li>';
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
          (isCollectTodo(t)?'<button type="button" class="btn btn-sm btn-col" data-act="col-open" data-kind="todo" data-id="'+esc(t.id)+'">收齐表 · '+esc(colProgressText(t))+'</button>':'')+
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
  L.push("DESCRIPTION:" + escICS("看明天待办与风险等级；翻一遍班级群有没有新通知，需要转发的用「转发通知」生成群公告。"));
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
    var alarms = Array.isArray(t.alertsMin) ? t.alertsMin.map(function(m){ m = +m || 0; return m ? "-PT" + m + "M" : "PT0S"; }) : ty.alarms;
    for(var j=0;j<alarms.length;j++){
      L.push("BEGIN:VALARM");
      L.push("ACTION:DISPLAY");
      L.push("DESCRIPTION:" + escICS(j === 0 ? noticeText(t,false) : noticeText(t,true)));
      L.push("TRIGGER:" + alarms[j]);
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
    if(!Array.isArray(state.noticeLog)) state.noticeLog = [];
    state.classRoster = cleanRoster(state.classRoster);
    if(!isObj(state.classRosterInfo)) state.classRosterInfo = {};
    applyRosterSeed(state);
    state.classRoster = cleanRoster(state.classRoster);
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
    case "nt-gen":
      if(!$("ntRaw").value.trim()){ toast("先把通知原文粘贴进来"); $("ntRaw").focus(); return; }
      if(nt.outDirty && !window.confirm("公告文字你手改过，重新生成会覆盖。继续？")) return;
      ntGenerate(true); ntScrollOut(); toast("已生成，标「请核对」的项看一眼"); break;
    case "nt-paste": ntPaste(); break;
    case "nt-clear": ntClear(); break;
    case "nt-copy": ntCopy(); break;
    case "nt-rewrite": ntRewrite(); break;
    case "nt-todo": ntAddTodos(); break;
    case "nt-open":
      go("todos", "notice");
      setTimeout(function(){ var r = $("ntRaw"); if(r){ try { r.focus({preventScroll:true}); } catch(_){ r.focus(); } } }, 60);
      break;
    case "nt-log-copy": var le = ntLogById(id); if(le) copyText(le.broadcast); break;
    case "nt-log-load": ntLoad(id); break;
    /* 收齐表 / 本班名单（v3.2） */
    case "col-open": colOpen(el.getAttribute("data-kind") || "todo", id); break;
    case "col-close": closeSheet("colSheet"); break;
    case "col-tick": colToggle(el.getAttribute("data-name")); break;
    case "col-filter": col.filter = el.getAttribute("data-v"); renderColSheet(); break;
    case "col-gender": col.gender = el.getAttribute("data-v") || ""; renderColSheet(); break;
    case "col-copy": colCopyLeft(); break;
    case "col-chat": colFromChat(); break;
    case "col-chat-paste":
      if(!navigator.clipboard || !navigator.clipboard.readText){ toast("这个浏览器不让读剪贴板，长按输入框粘贴"); $("colChat").focus(); return; }
      navigator.clipboard.readText().then(function(v){ if(v && v.trim()){ $("colChat").value = v.trim(); colFromChat(); } else toast("剪贴板是空的"); },
        function(){ toast("没拿到剪贴板，长按输入框粘贴"); $("colChat").focus(); });
      break;
    case "col-import": rosterImport("colRosterRaw", false); break;
    case "col-orphan-clear": colClearOrphans(); break;
    case "col-clear": colClearAll(); break;
    case "ro-open": rosterOpen(); break;
    case "ro-close": closeSheet("rosterSheet"); break;
    case "ro-add": rosterImport("roPaste", false); break;
    case "ro-replace": rosterImport("roPaste", true); break;
    case "ro-one": rosterAddOne(); break;
    case "ro-del": rosterDel(+el.getAttribute("data-idx")); break;
    case "ro-clear":
      if(!window.confirm("清空整份名单？各通知的已交记录会保留在数据里，重新导入同名的人会恢复。")) return;
      rosterSet([]); toast("名单已清空"); break;
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
    else if(e.target.id === "roOneForm"){ e.preventDefault(); rosterAddOne(); }
    else if(e.target.id === "ttForm"){ e.preventDefault(); saveCourse(); }
  });
  root.addEventListener("input", function(e){
    var id = e.target.id;
    if(id === "ttWeeks") updateWeeksHint();
    else if(id === "tqText"){ todoQuery.text = e.target.value; renderTodos(); }
    else if(id === "ntRaw"){
      clearTimeout(nt.timer);
      nt.timer = setTimeout(function(){ ntGenerate(false); }, 400);
    }
    else if(id === "ntOut"){ nt.outDirty = true; }
    else if(NT_FIELDS.indexOf(id) >= 0 && id !== "ntMode" && id !== "ntStrict") ntOnField(id);
  });
  root.addEventListener("paste", function(e){
    var tg = e.target;
    if(tg && tg.id === "ntRaw" && (!tg.value.trim() || (tg.selectionStart === 0 && tg.selectionEnd === tg.value.length))) nt.outDirty = false;
  });
  root.addEventListener("change", function(e){
    var el = e.target, id = el.id;
    switch(id){
      case "tdType": updateLeadHint(); break;
      case "ntMode": case "ntStrict": ntOnField(id); break;
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
    if(el.classList && el.classList.contains("ro-name")) rosterRename(+el.getAttribute("data-idx"), el.value);
  });
}

/* ================= 总渲染 / 启动 ================= */
function renderAll(){
  if(!appReady) return;
  renderHeader(); renderTonight(); renderTimeline(); renderSoon(); renderWeather();
  renderWeek(); renderBuy(); renderStock(); renderGrid();
  renderTimetable(); renderTodos(); renderReminders(); renderSettings(); renderNoticeLog(); renderRosterAll();
}
function onResume(){
  if(!appReady || document.visibilityState === "hidden") return;
  var prev = TODAY_KEY; setToday();
  if(prev !== TODAY_KEY){ ui.expanded = {}; renderAll(); }   // 跨过零点：自动换成新的一天
  else { renderHeader(); renderTimeline(); renderSoon(); }
  if(weatherIsStale()) fetchWeather();
}
/* 跟随系统深浅色：CSS 用 prefers-color-scheme 自动切；这里只同步浏览器 / 状态栏的 theme-color */
var THEME_COLOR = {light:"#eef5f3", dark:"#0b1b19"};
function syncThemeColor(){
  var dark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  qsa('meta[name="theme-color"]').forEach(function(m){ m.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light); });
  document.documentElement.setAttribute("data-scheme", dark ? "dark" : "light");
}
function boot(){
  state = load(); refreshRefs(); save();   // 落盘一次性迁移结果
  $("lockForm").addEventListener("submit", function(e){ e.preventDefault(); tryUnlock(); });
  $("pinInput").addEventListener("input", function(){ if(/^\d{4}$/.test(this.value)) tryUnlock(); });
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("pageshow", function(e){ if(e.persisted) onResume(); });
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    var top = ["rosterSheet","colSheet","ttSheet"].filter(function(id){ var el = $(id); return el && !el.hidden; })[0];
    if(top) closeSheet(top);
  });
  syncThemeColor();
  if(window.matchMedia){
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if(mq.addEventListener) mq.addEventListener("change", syncThemeColor); else if(mq.addListener) mq.addListener(syncThemeColor);
  }
  setInterval(onResume, 5*60000);
  if(isUnlocked()) unlockApp(); else showLock();
  if("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){
    navigator.serviceWorker.register("sw.js?sharecode=" + SHARECODE, {scope:"./"}).catch(function(){});
  }
}
window.__BAISIR__ = {version:VERSION, hashPin:hashPin, storageKey:KEY};
boot();
})();
