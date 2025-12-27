/* ========= 工具 ========= */
const PRESETS = Array.from({ length: 12 }, (_, i) => (i + 1) * 5); // 5..60
const $ = (id) => document.getElementById(id);

const pad2 = (n) => String(n).padStart(2, "0");
const nowMs = () => Date.now();

function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function cnWeekday(d) { return ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][d.getDay()]; }
function formatMMSS(sec) { const m = Math.floor(sec / 60); const s = Math.max(0, sec % 60); return `${pad2(m)}:${pad2(s)}`; }
function formatHM(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function escapeHtml(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function readFileText(file){
  return await file.text();
}

/* ========= 本地存储 Key ========= */
const K = {
  THEME: "pomodoro.theme",
  DEVICE_ID: "pomodoro.deviceId",
  TIMER: "pomodoro.timerState",
  RECORDS: "pomodoro.records" // array
};

/* ========= UI ========= */
const todayText = $("todayText");
const notifyBtn = $("notifyBtn");
const themeBtn = $("themeBtn");

const presetChips = $("presetChips");
const customMinutes = $("customMinutes");
const applyCustom = $("applyCustom");
const durationMeta = $("durationMeta");

const noteInput = $("noteInput");
const startBtn = $("startBtn");
const pauseBtn = $("pauseBtn");
const resetBtn = $("resetBtn");

const timeMain = $("timeMain");
const timeSub = $("timeSub");

const ticksGroup = $("ticks");
const handGroup = $("handGroup");
const progressArc = $("progressArc");

const todayList = $("todayList");
const exportTodayBtn = $("exportTodayBtn");
const openArchiveBtn = $("openArchiveBtn");

const archiveBackdrop = $("archiveBackdrop");
const archiveBody = $("archiveBody");
const closeArchiveBtn = $("closeArchiveBtn");

const exportAllJsonBtn = $("exportAllJsonBtn");
const exportAllCsvBtn = $("exportAllCsvBtn");
const importFiles = $("importFiles");
const importMergeBtn = $("importMergeBtn");
const mergeMeta = $("mergeMeta");

/* ========= Service Worker / 通知 ========= */
async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("./sw.js"); } catch { return null; }
}
async function ensureNotifyPermission() {
  if (!("Notification" in window)) {
    notifyBtn.textContent = "通知：不支持";
    notifyBtn.disabled = true;
    return "denied";
  }
  let p = Notification.permission;
  if (p === "default") p = await Notification.requestPermission();
  notifyBtn.textContent = p === "granted" ? "通知：已授权" : (p === "denied" ? "通知：已拒绝" : "通知：未授权");
  return p;
}
function showFinishNotification(note) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const title = "计时结束";
  const body = note ? `事项：${note}` : "你的计时已完成";

  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "SHOW_NOTIFICATION", title, body });
    return;
  }
  try { new Notification(title, { body, tag: "pomodoro-finish", renotify: true }); } catch {}
}

/* ========= 主题 ========= */
function getTheme(){ return localStorage.getItem(K.THEME) || "auto"; }
function applyTheme(mode){
  localStorage.setItem(K.THEME, mode);
  const root = document.documentElement;
  if (mode === "light") root.dataset.theme = "light";
  else if (mode === "dark") root.dataset.theme = "dark";
  else root.dataset.theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

  themeBtn.textContent = `外观：${mode==="auto"?"自动":(mode==="light"?"浅色":"深色")}`;
}
function cycleTheme(){
  const cur = getTheme();
  const next = cur === "auto" ? "light" : (cur === "light" ? "dark" : "auto");
  applyTheme(next);
}

/* ========= 设备 ID ========= */
function getDeviceId(){
  let id = localStorage.getItem(K.DEVICE_ID);
  if (!id){
    id = crypto?.randomUUID ? crypto.randomUUID() : `dev_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    localStorage.setItem(K.DEVICE_ID, id);
  }
  return id;
}

/* ========= 记录读写 ========= */
function loadRecords(){
  const raw = localStorage.getItem(K.RECORDS);
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}
function saveRecords(arr){
  localStorage.setItem(K.RECORDS, JSON.stringify(arr));
}

function buildMarkdownForDay(dateKey, items){
  const d = new Date(dateKey + "T00:00:00");
  let out = `# 行动事项 · ${dateKey}（${cnWeekday(d)}）\n\n`;
  if (!items.length) return out + "（无记录）\n";
  items.forEach((it, idx) => {
    out += `${idx+1}. **${it.start_hm} - ${it.end_hm}**  ${it.note?.trim() ? it.note.trim() : "（无备注）"}\n`;
  });
  return out;
}

function buildCsv(records){
  const header = ["id","device_id","date_key","weekday","start_ms","end_ms","start_hm","end_hm","note"];
  const esc = (v) => `"${String(v ?? "").replaceAll('"','""')}"`;
  const lines = [header.join(",")];
  for (const r of records){
    lines.push([
      r.id, r.device_id, r.date_key, r.weekday,
      r.start_ms, r.end_ms, r.start_hm, r.end_hm,
      esc(r.note || "")
    ].join(","));
  }
  return lines.join("\n");
}

/* ========= 表盘 ========= */
function renderTicks(){
  ticksGroup.innerHTML = "";
  for (let i=0;i<60;i++){
    const ang = (i/60)*2*Math.PI;
    const major = (i%5===0);
    const r1 = major ? 100 : 102;
    const r2 = major ? 110 : 106;
    const x1 = 130 + r1*Math.cos(ang);
    const y1 = 130 + r1*Math.sin(ang);
    const x2 = 130 + r2*Math.cos(ang);
    const y2 = 130 + r2*Math.sin(ang);

    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("class","tick");
    line.style.opacity = major ? "1" : ".65";
    ticksGroup.appendChild(line);
  }
}
function setDialProgress(remainSec, totalSec){
  const r = 92;
  const C = 2*Math.PI*r;
  const p = totalSec>0 ? Math.max(0, Math.min(1, remainSec/totalSec)) : 0;
  const dash = C*p;
  const gap = C-dash;
  progressArc.style.strokeDasharray = `${dash} ${gap}`;
  const deg = 360*(1-p);
  handGroup.setAttribute("transform", `rotate(${deg} 130 130)`);
}

/* ========= 计时器 ========= */
// timerState: {running,totalSec,startAtMs,endAtMs,note,pausedRemainSec}
let timerState = null;
let tickHandle = null;
let selectedMinutes = 25;

function loadTimerState(){
  const raw = localStorage.getItem(K.TIMER);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function saveTimerState(s){ localStorage.setItem(K.TIMER, JSON.stringify(s)); }
function clearTimerState(){ localStorage.removeItem(K.TIMER); }

function stopTick(){
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}
function startTick(){
  stopTick();
  tickHandle = setInterval(() => {
    if (!timerState || !timerState.running) return;
    const remain = Math.max(0, Math.ceil((timerState.endAtMs - nowMs())/1000));
    if (remain <= 0){
      finishTimer();
      return;
    }
    paint(remain);
  }, 250);
}

function paint(remainSec){
  timeMain.textContent = formatMMSS(remainSec);
  setDialProgress(remainSec, timerState?.totalSec || 1);

  if (!timerState){
    timeSub.textContent = "未开始";
    return;
  }
  if (timerState.running){
    const end = new Date(timerState.endAtMs);
    timeSub.textContent = `结束于 ${formatHM(end)} · ${timerState.note?.trim() ? timerState.note.trim() : "无备注"}`;
  } else {
    timeSub.textContent = `已暂停 · ${timerState.note?.trim() ? timerState.note.trim() : "无备注"}`;
  }
}

function refreshButtons(){
  if (!timerState){
    startBtn.textContent = "开始";
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = true;
    paint(0);
    return;
  }
  if (timerState.running){
    startBtn.textContent = "运行中";
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    resetBtn.disabled = false;
  } else {
    startBtn.textContent = "继续";
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = false;
  }
}

function startTimer(minutes, note){
  const totalSec = Math.max(1, Math.floor(minutes*60));
  const startAtMs = nowMs();
  const endAtMs = startAtMs + totalSec*1000;
  timerState = { running:true, totalSec, startAtMs, endAtMs, note: note || "", pausedRemainSec:null };
  saveTimerState(timerState);
  startTick();
  refreshButtons();
  paint(totalSec);
}

function pauseTimer(){
  if (!timerState || !timerState.running) return;
  const remain = Math.max(0, Math.ceil((timerState.endAtMs - nowMs())/1000));
  timerState.running = false;
  timerState.pausedRemainSec = remain;
  saveTimerState(timerState);
  stopTick();
  refreshButtons();
  paint(remain);
}

function resumeTimer(){
  if (!timerState || timerState.running) return;
  const remain = timerState.pausedRemainSec ?? 0;
  timerState.running = true;
  timerState.endAtMs = nowMs() + remain*1000;
  timerState.pausedRemainSec = null;
  saveTimerState(timerState);
  startTick();
  refreshButtons();
  paint(remain);
}

function resetTimer(){
  timerState = null;
  clearTimerState();
  stopTick();
  refreshButtons();
  setDialProgress(0,1);
  timeMain.textContent = "00:00";
  timeSub.textContent = "未开始";
}

function finishTimer(){
  if (!timerState) return;
  const deviceId = getDeviceId();
  const endAtMs = nowMs();

  const sd = new Date(timerState.startAtMs);
  const ed = new Date(endAtMs);

  const rec = {
    id: `${deviceId}_${timerState.startAtMs}`, // 去重关键
    device_id: deviceId,
    date_key: ymd(sd),
    weekday: cnWeekday(sd),
    start_ms: timerState.startAtMs,
    end_ms: endAtMs,
    start_hm: formatHM(sd),
    end_hm: formatHM(ed),
    note: (timerState.note || "").trim()
  };

  const records = loadRecords();
  if (!records.some(x => x.id === rec.id)){
    records.push(rec);
    records.sort((a,b) => a.start_ms - b.start_ms);
    saveRecords(records);
  }

  showFinishNotification(rec.note);
  resetTimer();
  renderToday();
}

/* ========= UI：预设 chips ========= */
function renderChips(){
  presetChips.innerHTML = PRESETS.map(m => `
    <button class="chip ${m===selectedMinutes?"active":""}" data-min="${m}">${m} 分钟</button>
  `).join("");
  durationMeta.textContent = `当前：${selectedMinutes} 分钟`;
}

presetChips.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-min]");
  if (!b) return;
  selectedMinutes = Number(b.getAttribute("data-min"));
  renderChips();
});

applyCustom.addEventListener("click", () => {
  const m = Number(customMinutes.value);
  if (!Number.isFinite(m) || m <= 0) return;
  selectedMinutes = m;
  presetChips.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
  durationMeta.textContent = `当前：${selectedMinutes} 分钟（自定义）`;
});

/* ========= 今日/历史渲染 ========= */
function renderToday(){
  const todayKey = ymd(new Date());
  const records = loadRecords().filter(r => r.date_key === todayKey).sort((a,b)=>a.start_ms-b.start_ms);

  const d = new Date();
  todayText.textContent = `${todayKey}（${cnWeekday(d)}）`;

  if (!records.length){
    todayList.innerHTML = `<div class="hint">暂无记录。完成一次计时后会自动记录“起止时间 + 备注”。</div>`;
    return;
  }

  todayList.innerHTML = records.map(r => `
    <div class="logItem">
      <div class="logTop">
        <div class="logTime">${r.start_hm} - ${r.end_hm}</div>
        <div class="logMeta">${r.date_key} ${r.weekday}</div>
      </div>
      <div class="logNote">${escapeHtml(r.note || "")}</div>
    </div>
  `).join("");
}

function openArchive(){
  const records = loadRecords().slice().sort((a,b)=>b.start_ms-a.start_ms);
  if (!records.length){
    archiveBody.innerHTML = `<div class="hint">暂无历史记录。</div>`;
    archiveBackdrop.classList.remove("hidden");
    return;
  }

  const byDate = new Map();
  for (const r of records){
    if (!byDate.has(r.date_key)) byDate.set(r.date_key, []);
    byDate.get(r.date_key).push(r);
  }
  const keys = Array.from(byDate.keys()).sort((a,b)=>b.localeCompare(a));

  archiveBody.innerHTML = keys.map(k => {
    const day = byDate.get(k).slice().sort((a,b)=>a.start_ms-b.start_ms);
    const md = buildMarkdownForDay(k, day);
    return `
      <div class="sheet">
        <div class="sheetTitle">${k}（${cnWeekday(new Date(k+"T00:00:00"))}）</div>
        <div class="sheetText">${escapeHtml(md)}</div>
        <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
          <button class="pill" data-export="${k}">下载该日文档</button>
        </div>
      </div>
    `;
  }).join("");

  archiveBody.onclick = (e) => {
    const btn = e.target.closest("button[data-export]");
    if (!btn) return;
    const k = btn.getAttribute("data-export");
    const day = loadRecords().filter(r => r.date_key === k).sort((a,b)=>a.start_ms-b.start_ms);
    downloadText(`行动事项_${k}.md`, buildMarkdownForDay(k, day));
  };

  archiveBackdrop.classList.remove("hidden");
}

/* ========= 导出/导入合并 ========= */
function exportToday(){
  const k = ymd(new Date());
  const day = loadRecords().filter(r => r.date_key === k).sort((a,b)=>a.start_ms-b.start_ms);
  downloadText(`行动事项_${k}.md`, buildMarkdownForDay(k, day));
}

function exportAllJson(){
  const records = loadRecords().slice().sort((a,b)=>a.start_ms-b.start_ms);
  const payload = {
    schema: "pomodoro_local_v1",
    exported_at_ms: nowMs(),
    device_id: getDeviceId(),
    records
  };
  downloadText(`pomodoro_all_${ymd(new Date())}.json`, JSON.stringify(payload, null, 2));
}

function exportAllCsv(){
  const records = loadRecords().slice().sort((a,b)=>a.start_ms-b.start_ms);
  downloadText(`pomodoro_all_${ymd(new Date())}.csv`, buildCsv(records));
}

async function importAndMerge(){
  const files = Array.from(importFiles.files || []);
  if (!files.length){
    mergeMeta.textContent = "请选择一个或多个 JSON 文件。";
    return;
  }

  const current = loadRecords();
  const map = new Map(current.map(r => [r.id, r]));
  let added = 0;
  let readOk = 0;

  for (const f of files){
    try{
      const txt = await readFileText(f);
      const obj = JSON.parse(txt);
      const recs = Array.isArray(obj?.records) ? obj.records : (Array.isArray(obj) ? obj : []);
      for (const r of recs){
        if (!r || !r.id) continue;
        if (!map.has(r.id)){
          map.set(r.id, r);
          added++;
        }
      }
      readOk++;
    } catch {
      // skip
    }
  }

  const merged = Array.from(map.values()).sort((a,b)=>a.start_ms-b.start_ms);
  saveRecords(merged);
  renderToday();

  mergeMeta.textContent = `导入完成：读取文件 ${readOk}/${files.length}，新增记录 ${added} 条，合并后总计 ${merged.length} 条。`;
}

/* ========= 事件绑定 ========= */
themeBtn.addEventListener("click", cycleTheme);
notifyBtn.addEventListener("click", ensureNotifyPermission);

startBtn.addEventListener("click", async () => {
  await ensureNotifyPermission();
  if (!timerState){
    startTimer(selectedMinutes, (noteInput.value || "").trim());
    return;
  }
  if (!timerState.running) resumeTimer();
});
pauseBtn.addEventListener("click", () => pauseTimer());
resetBtn.addEventListener("click", () => resetTimer());

exportTodayBtn.addEventListener("click", () => exportToday());
openArchiveBtn.addEventListener("click", () => openArchive());
closeArchiveBtn.addEventListener("click", () => archiveBackdrop.classList.add("hidden"));
archiveBackdrop.addEventListener("click", (e) => { if (e.target === archiveBackdrop) archiveBackdrop.classList.add("hidden"); });

exportAllJsonBtn.addEventListener("click", () => exportAllJson());
exportAllCsvBtn.addEventListener("click", () => exportAllCsv());
importMergeBtn.addEventListener("click", () => importAndMerge());

document.addEventListener("visibilitychange", () => {
  if (!timerState || !timerState.running) return;
  const remain = Math.max(0, Math.ceil((timerState.endAtMs - nowMs())/1000));
  if (remain <= 0) finishTimer();
});

/* ========= 启动 ========= */
async function boot(){
  applyTheme(getTheme());
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (getTheme() === "auto") applyTheme("auto");
  });

  renderTicks();
  renderChips();
  setDialProgress(0,1);

  await registerSW();
  try { await navigator.serviceWorker.ready; } catch {}

  if ("Notification" in window){
    notifyBtn.textContent =
      Notification.permission==="granted" ? "通知：已授权" :
      (Notification.permission==="denied" ? "通知：已拒绝" : "通知：未授权");
  } else {
    notifyBtn.textContent = "通知：不支持";
    notifyBtn.disabled = true;
  }

  timerState = loadTimerState();
  if (timerState && timerState.running){
    const remain = Math.max(0, Math.ceil((timerState.endAtMs - nowMs())/1000));
    if (remain <= 0) {
      // 过期：结算
      finishTimer();
    } else {
      startTick();
      paint(remain);
    }
  }
  refreshButtons();
  renderToday();
}

boot();
