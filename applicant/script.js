// 신청자 화면 동작.
const API = "";

const $ = (s) => document.querySelector(s);

const todayLabel = $("#todayLabel");
const durationChart = $("#durationChart");
const fastestLabel = $("#fastestLabel");
const toggleChartButton = $("#toggleChartButton");
const receiptButton = $("#receiptButton");
const calcButton = $("#calcButton");
const receiptView = $("#receiptView");
const calcView = $("#calcView");

const formBiz = $("#formBiz");
const formMid = $("#formMid");
const formSub = $("#formSub");
const draftStatus = $("#draftStatus");
const submitMessage = $("#submitMessage");
const receiptForm = $("#receiptForm");
const draftKey = "ktl-applicant-draft-v2";
const applicationKey = "ktl-applications-v1";
const staticData = window.KTL_PRECOMPUTED_RESULTS || {};

const calcBiz = $("#calcBiz");
const categorySelect = $("#categorySelect");
const subcategorySelect = $("#subcategorySelect");
const calcDate = $("#calcDate");
const calculatedDays = $("#calculatedDays");
const calculatedDate = $("#calculatedDate");
const calculateButton = $("#calculateButton");

const recBiz = $("#recBiz"), recMid = $("#recMid"), recSub = $("#recSub");
const recEarliest = $("#recEarliest"), recDeadline = $("#recDeadline");
const recPriority = $("#recPriority"), recButton = $("#recButton");
const recommendationList = $("#recommendationList");
const recommendationMessage = $("#recommendationMessage");

const chatLog = $("#chatLog"), chatInput = $("#chatInput"), chatSend = $("#chatSend");

const calendarGrid = $("#calendarGrid");
const calendarMonthLabel = $("#calendarMonthLabel");
const prevMonthButton = $("#prevMonthButton"), nextMonthButton = $("#nextMonthButton");
const calendarBizSelect = $("#calendarBizSelect");
const calendarCategorySelect = $("#calendarCategorySelect");
const calendarSubcategorySelect = $("#calendarSubcategorySelect");
const calendarCompletionDate = $("#calendarCompletionDate");
const calendarSelectionSummary = $("#calendarSelectionSummary");

let catalog = {};
let bizStats = [];
let visibleCalendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = null;
let isChartExpanded = false;

async function api(p, init) {
  const r = await fetch(API + p, init);
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}
const fmtDate = (v) => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(v));
const isSameDate = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

function addBusinessDays(startValue, days) {
  const date = new Date(`${startValue}T00:00:00`);
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) left -= 1;
  }
  return toISO(date);
}

function businessStat(biz) {
  return bizStats.find((row) => row.biz === biz) || { n: 0, avg_days: 14, median_days: 10, std_days: 7 };
}

function congestionFor(biz, receiveOn) {
  const scopes = staticData.scopes || {};
  const allKey = Object.keys(scopes).find((key) => key === "전체") || Object.keys(scopes)[0];
  const scope = scopes[biz] || scopes[allKey];
  const rows = scope?.forecast || [];
  const match = rows.find((row) => row.date === receiveOn);
  if (match?.congestion) return match.congestion;
  const weekday = new Date(`${receiveOn}T00:00:00`).getDay();
  return weekday === 0 || weekday === 6 ? "낮음" : "보통";
}

function rulePrediction({ biz, mid, sub, receive_on }) {
  const stat = businessStat(biz);
  const text = `${mid || ""} ${sub || ""}`;
  let factor = 1;
  if (/인증서\s*발급|성적서\s*발급/.test(text)) factor *= 0.78;
  if (/사후관리/.test(text)) factor *= 0.9;
  if (/교정/.test(text)) factor *= 0.88;
  if (/전자파|환경|신뢰성/.test(text)) factor *= 1.12;
  if (/방폭|승강기|안전인증/.test(text)) factor *= 1.18;
  const congestion = congestionFor(biz, receive_on);
  factor *= ({ "낮음": 0.94, "보통": 1, "높음": 1.1, "매우 높음": 1.18 }[congestion] || 1);
  const base = Number(stat.median_days || stat.avg_days || 10);
  const predictedDays = Math.max(1, Math.round(base * factor));
  const spread = Math.max(2, Math.round(Number(stat.std_days || predictedDays * 0.35) * 0.3));
  const confidence = Math.min(0.91, 0.55 + Math.log10(Number(stat.n || 1) + 1) / 17);
  return {
    predicted_days: predictedDays,
    predicted_complete_at: addBusinessDays(receive_on, predictedDays),
    low_days: Math.max(1, predictedDays - spread),
    high_days: predictedDays + spread,
    confidence,
    congestion,
    source: "rule_based",
  };
}

async function predictWithFallback(payload) {
  try {
    return await api("/api/predict", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  } catch {
    return rulePrediction(payload);
  }
}

function priorityScore(row, priority, deadline) {
  const congestion = { "낮음": 0, "보통": 1, "높음": 2, "매우 높음": 3 }[row.congestion] ?? 1;
  const uncertainty = row.high_days - row.low_days;
  if (priority === "stable") return uncertainty * 10 + row.predicted_days;
  if (priority === "avoid_congestion") return congestion * 100 + row.predicted_days;
  if (priority === "meet_deadline" && deadline) {
    const late = Math.max(0, (new Date(row.predicted_complete_at) - new Date(deadline)) / 86400000);
    return (row.meets_deadline ? 0 : 10000) + late * 100 + row.predicted_days;
  }
  return row.predicted_days * 10 + congestion;
}

function ruleRecommendations({ biz, mid, sub, earliest, deadline, priority, n = 5 }) {
  const start = new Date(`${earliest}T00:00:00`);
  const candidates = [];
  for (let offset = 0; offset < 35; offset += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const prediction = rulePrediction({ biz, mid, sub, receive_on: toISO(date) });
    const row = {
      receive_on: toISO(date),
      predicted_complete_at: prediction.predicted_complete_at,
      predicted_days: prediction.predicted_days,
      low_days: prediction.low_days,
      high_days: prediction.high_days,
      congestion: prediction.congestion,
      meets_deadline: !deadline || prediction.predicted_complete_at <= deadline,
      source: "rule_based",
    };
    row.score = priorityScore(row, priority, deadline);
    candidates.push(row);
  }
  return candidates.sort((a, b) => a.score - b.score || a.receive_on.localeCompare(b.receive_on)).slice(0, n);
}

async function recommendationsWithFallback(payload) {
  try {
    return await api("/api/recommend", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  } catch {
    return ruleRecommendations(payload);
  }
}

function findChatSelection(text) {
  const biz = Object.keys(catalog).find((name) => text.includes(name)) || recBiz.value;
  const mids = Object.keys(catalog[biz] || {});
  const mid = mids.find((name) => text.includes(name)) || (biz === recBiz.value ? recMid.value : mids[0]);
  const subs = catalog[biz]?.[mid] || [];
  const sub = subs.find((name) => text.includes(name)) || (biz === recBiz.value && mid === recMid.value ? recSub.value : subs[0]);
  return { biz, mid, sub };
}

function chatDate(text) {
  const now = new Date();
  if (text.includes("다음주")) now.setDate(now.getDate() + 7);
  if (text.includes("다음달")) now.setMonth(now.getMonth() + 1);
  const iso = text.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2,"0")}-${String(iso[3]).padStart(2,"0")}`;
  return toISO(now);
}

function chatDeadline(text) {
  const exact = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
  const monthEnd = text.match(/(\d{1,2})월\s*말/);
  if (!exact && !monthEnd) return null;
  const now = new Date();
  const month = Number((exact || monthEnd)[1]);
  let year = now.getFullYear();
  if (month < now.getMonth() + 1) year += 1;
  const day = exact ? Number(exact[2]) : new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

async function ruleChat(text) {
  const selection = findChatSelection(text);
  const priority = /안정/.test(text) ? "stable" : /혼잡/.test(text) ? "avoid_congestion" : /마감|까지/.test(text) ? "meet_deadline" : "fast";
  const earliest = chatDate(text);
  const deadline = chatDeadline(text);
  const rows = ruleRecommendations({ ...selection, earliest, deadline, priority, n: 3 });
  const lines = rows.map((row, index) => `${index + 1}순위 ${row.receive_on} 접수 → ${row.predicted_complete_at} 완료 예상 (${row.predicted_days}영업일, 혼잡도 ${row.congestion})`);
  return `학습 데이터 기반 규칙으로 ${selection.biz} > ${selection.mid} > ${selection.sub} 일정을 계산했습니다.\n${lines.join("\n")}${deadline ? `\n목표일 ${deadline} 기준 ${rows[0]?.meets_deadline ? "충족 가능성이 있습니다." : "일정 여유가 부족할 수 있습니다."}` : ""}\n정확한 일정은 실제 시료 상태와 담당 부서 확인에 따라 달라질 수 있습니다.`;
}

function fillSel(el, items) {
  el.innerHTML = items.map((v) => `<option value="${v}">${v}</option>`).join("");
  el.disabled = items.length === 0;
}

function bindLinkedSelects(bizEl, midEl, subEl, onChange) {
  const refresh = () => {
    const mids = Object.keys(catalog[bizEl.value] || {}).sort();
    fillSel(midEl, mids);
    refreshMid();
  };
  const refreshMid = () => {
    const subs = (catalog[bizEl.value]?.[midEl.value] || []).slice().sort();
    fillSel(subEl, subs);
    onChange && onChange();
  };
  bizEl.addEventListener("input", refresh);
  midEl.addEventListener("input", refreshMid);
  subEl.addEventListener("input", () => onChange && onChange());
  return { refresh, refreshMid };
}

function renderChart() {
  const items = bizStats.slice().sort((a, b) => a.avg_days - b.avg_days);
  const max = Math.max(...items.map((c) => c.avg_days || 0));
  const fastest = items[0];
  fastestLabel.textContent = `가장 빠른 사업구분: ${fastest.biz} ${Math.round(fastest.avg_days)}일`;
  const palette = ["#126b67", "#3067a6", "#b9821a", "#cf563e", "#4f7d45", "#6b5b95"];
  const visible = isChartExpanded ? items : items.slice(0, 8);
  durationChart.classList.toggle("collapsed", !isChartExpanded);
  durationChart.innerHTML = visible.map((c, i) => {
    const w = Math.round(((c.avg_days || 0) / max) * 100);
    const color = palette[i % palette.length];
    return `<div class="chart-row"><span>${c.biz}</span><div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div><strong>${(c.avg_days||0).toFixed(1)}일</strong></div>`;
  }).join("");
  toggleChartButton.textContent = isChartExpanded ? "접기" : `펼치기 (${items.length}개 전체 보기)`;
}

function renderCalendar() {
  const y = visibleCalendarDate.getFullYear(), m = visibleCalendarDate.getMonth();
  const first = new Date(y, m, 1).getDay();
  const last = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  calendarMonthLabel.textContent = `${y}년 ${m + 1}월`;
  const blanks = Array.from({ length: first }, () => '<button class="calendar-day empty" type="button" tabindex="-1"></button>');
  const days = Array.from({ length: last }, (_, i) => {
    const day = i + 1;
    const dt = new Date(y, m, day);
    const cls = ["calendar-day", isSameDate(dt, today) ? "today" : "", isSameDate(dt, selectedCalendarDate) ? "selected" : ""].filter(Boolean).join(" ");
    return `<button class="${cls}" type="button" data-calendar-day="${day}">${day}</button>`;
  });
  calendarGrid.innerHTML = [...blanks, ...days].join("");
}

async function refreshCalendarPrediction() {
  if (!selectedCalendarDate) {
    calendarCompletionDate.textContent = "날짜를 선택하세요";
    calendarSelectionSummary.textContent = "분류와 접수일을 선택하면 예측 완료일이 표시됩니다.";
    return;
  }
  const p = await predictWithFallback({ biz: calendarBizSelect.value, mid: calendarCategorySelect.value,
    sub: calendarSubcategorySelect.value, receive_on: toISO(selectedCalendarDate) });
  calendarCompletionDate.textContent = fmtDate(p.predicted_complete_at);
  calendarSelectionSummary.textContent = `${fmtDate(selectedCalendarDate)} 접수 · ${calendarBizSelect.value} > ${calendarCategorySelect.value} > ${calendarSubcategorySelect.value} · 예상 ${p.predicted_days}일 (${p.low_days}~${p.high_days}일, 신뢰도 ${Math.round(p.confidence*100)}%, 혼잡도 ${p.congestion})${p.source === "rule_based" ? " · 룰 기반" : ""}`;
}

async function calculateDuration() {
  if (!calcDate.value) {
    calculatedDays.textContent = "-";
    calculatedDate.textContent = "접수일을 선택하세요";
    return;
  }
  const p = await predictWithFallback({ biz: calcBiz.value, mid: categorySelect.value, sub: subcategorySelect.value, receive_on: calcDate.value });
  calculatedDays.textContent = `${p.predicted_days}일 (${p.low_days}~${p.high_days})`;
  calculatedDate.textContent = `예상 완료일 ${fmtDate(p.predicted_complete_at)} · 신뢰도 ${Math.round(p.confidence*100)}% · 혼잡도 ${p.congestion}${p.source === "rule_based" ? " · 룰 기반 계산" : ""}`;
}

async function fetchRecommend() {
  if (!recEarliest.value) { recommendationMessage.textContent = "희망 시작일을 선택해주세요."; return; }
  recommendationMessage.textContent = "추천 계산 중...";
  const recs = await recommendationsWithFallback({
    biz: recBiz.value, mid: recMid.value, sub: recSub.value,
    earliest: recEarliest.value, deadline: recDeadline.value || null,
    priority: recPriority.value, n: 5,
  });
  if (!recs.length) { recommendationList.innerHTML = ""; recommendationMessage.textContent = "추천 결과가 없습니다."; return; }
  recommendationList.innerHTML = recs.map((r, i) => {
    const receiveDate = String(r.receive_on || "-").replaceAll("-", ".");
    const completeDate = String(r.predicted_complete_at || "-").replaceAll("-", ".");
    const days = Number.isInteger(Number(r.predicted_days)) ? Number(r.predicted_days) : Number(r.predicted_days).toFixed(1);
    const deadline = recDeadline.value
      ? `<span class="recommend-deadline ${r.meets_deadline ? "" : "late"}">${r.meets_deadline ? "마감 가능" : "마감 초과"}</span>`
      : "";
    return `<article class="recommend-card ${i === 0 ? "best" : ""}">
      <div class="recommend-card-head">
        <span class="recommend-rank">${i + 1}</span>
        <span class="recommend-card-title">${i === 0 ? "가장 추천하는 일정" : "추천 일정"}</span>
        ${deadline}
      </div>
      <div class="recommend-route">
        <div class="recommend-date"><span>접수일</span><b>${receiveDate}</b></div>
        <span class="recommend-arrow" aria-hidden="true">→</span>
        <div class="recommend-date"><span>예상 완료일</span><b>${completeDate}</b></div>
      </div>
      <div class="recommend-meta">
        <span class="recommend-chip">예상 ${days}일</span>
        <span class="recommend-chip congestion">혼잡도 ${r.congestion || "보통"}</span>
      </div>
    </article>`;
  }).join("");
  recommendationMessage.textContent = recs[0]?.source === "rule_based"
    ? "학습 데이터 규칙으로 적합한 순서대로 정리했습니다."
    : "예측 결과를 바탕으로 적합한 순서대로 정리했습니다.";
}

async function chatAsk() {
  const text = chatInput.value.trim();
  if (!text) return;
  appendChat("user", text);
  chatInput.value = "";
  appendChat("bot", "분석 중...");
  try {
    const r = await api("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
    chatLog.lastElementChild.querySelector(".bubble").textContent = r.message;
  } catch {
    chatLog.lastElementChild.querySelector(".bubble").textContent = await ruleChat(text);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}
function appendChat(role, text) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<span class="bubble"></span>`;
  div.querySelector(".bubble").textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setActiveView(name) {
  const isReceipt = name === "receipt";
  receiptButton.classList.toggle("active", isReceipt);
  calcButton.classList.toggle("active", !isReceipt);
  receiptView.classList.toggle("active", isReceipt);
  calcView.classList.toggle("active", !isReceipt);
}

function serializeForm() {
  const fd = new FormData(receiptForm);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = v;
  return obj;
}

async function submitForm(ev) {
  ev.preventDefault();
  const obj = serializeForm();
  const payload = {
    biz: obj.biz, category: obj.category, subcategory: obj.subcategory,
    sample_name: obj.sample_name,
    company: obj.company, business_no: obj.business_no, address: obj.address,
    ceo: obj.ceo, applicant_name: obj.applicant_name, phone: obj.phone,
    mobile: obj.mobile, email: obj.email, fax: obj.fax,
    payment: obj.payment, report: obj.report,
    return_method: obj.return_method, return_address: obj.return_address,
    notes: obj.notes, samples: [],
  };
  try {
    const r = await api("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const p = r.prediction || {};
    submitMessage.textContent = `전송완료! 신청번호 ${r.id} · 예상 완료 ${p.predicted_complete_at || "-"} (${p.predicted_days || "-"}일, 혼잡도 ${p.congestion || "-"})`;
    receiptForm.reset();
    localStorage.removeItem(draftKey);
  } catch {
    const prediction = rulePrediction({ biz: payload.biz, mid: payload.category, sub: payload.subcategory, receive_on: toISO(new Date()) });
    let applications = [];
    try { applications = JSON.parse(localStorage.getItem(applicationKey) || "[]"); } catch {}
    const id = Date.now();
    applications.push({
      id, status: "pending", received_at: new Date().toISOString(), completed_at: null,
      biz: payload.biz, category: payload.category, subcategory: payload.subcategory,
      sample_name: payload.sample_name, payment: payload.payment, report: payload.report,
      return_method: payload.return_method, return_address: payload.return_address, notes: payload.notes,
      applicant: { company: payload.company, business_no: payload.business_no, address: payload.address,
        ceo: payload.ceo, applicant_name: payload.applicant_name, phone: payload.phone,
        mobile: payload.mobile, email: payload.email, fax: payload.fax },
      predicted_days: prediction.predicted_days,
      predicted_complete_at: prediction.predicted_complete_at,
      prediction_source: "rule_based",
      local_only: true,
    });
    localStorage.setItem(applicationKey, JSON.stringify(applications));
    submitMessage.textContent = `접수완료! 신청번호 ${id} · 예상 완료 ${prediction.predicted_complete_at} (${prediction.predicted_days}일, 혼잡도 ${prediction.congestion}) · 브라우저에 안전하게 저장되었습니다.`;
    receiptForm.reset();
    formBiz.dispatchEvent(new Event("input"));
    localStorage.removeItem(draftKey);
  }
}

function bind() {
  receiptButton.addEventListener("click", () => setActiveView("receipt"));
  calcButton.addEventListener("click", () => setActiveView("calc"));
  toggleChartButton.addEventListener("click", () => { isChartExpanded = !isChartExpanded; renderChart(); });
  calculateButton.addEventListener("click", calculateDuration);
  recButton.addEventListener("click", fetchRecommend);
  chatSend.addEventListener("click", chatAsk);
  chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") chatAsk(); });
  receiptForm.addEventListener("submit", submitForm);
  $("#saveDraftButton").addEventListener("click", () => {
    localStorage.setItem(draftKey, JSON.stringify(serializeForm()));
    draftStatus.textContent = `임시저장됨 ${new Date().toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit" })}`;
  });
  calendarGrid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-calendar-day]"); if (!b) return;
    selectedCalendarDate = new Date(visibleCalendarDate.getFullYear(), visibleCalendarDate.getMonth(), Number(b.dataset.calendarDay));
    renderCalendar(); refreshCalendarPrediction();
  });
  prevMonthButton.addEventListener("click", () => { visibleCalendarDate = new Date(visibleCalendarDate.getFullYear(), visibleCalendarDate.getMonth() - 1, 1); renderCalendar(); });
  nextMonthButton.addEventListener("click", () => { visibleCalendarDate = new Date(visibleCalendarDate.getFullYear(), visibleCalendarDate.getMonth() + 1, 1); renderCalendar(); });
}

function loadDraft() {
  const d = localStorage.getItem(draftKey); if (!d) return;
  try {
    const obj = JSON.parse(d);
    Object.entries(obj).forEach(([k, v]) => {
      const el = receiptForm.querySelector(`[name="${k}"]`); if (el) el.value = v;
    });
    draftStatus.textContent = "임시저장된 양식을 불러왔습니다.";
  } catch {}
}

(async function init() {
  todayLabel.textContent = fmtDate(new Date());
  const staticData = window.KTL_PRECOMPUTED_RESULTS || {};
  catalog = staticData.catalog || {};
  bizStats = staticData.biz_stats || [];
  try {
    const [liveCatalog, liveBizStats] = await Promise.all([
      api("/api/catalog"),
      api("/api/stats/biz"),
    ]);
    if (Object.keys(liveCatalog || {}).length) catalog = liveCatalog;
    if (liveBizStats?.length) bizStats = liveBizStats;
  } catch (error) {
    console.info("정적 분류 데이터를 사용합니다.", error);
  }

  const bizes = Object.keys(catalog).sort();
  fillSel(formBiz, bizes); fillSel(calcBiz, bizes); fillSel(recBiz, bizes); fillSel(calendarBizSelect, bizes);

  bindLinkedSelects(formBiz, formMid, formSub);
  bindLinkedSelects(calcBiz, categorySelect, subcategorySelect);
  bindLinkedSelects(recBiz, recMid, recSub);
  bindLinkedSelects(calendarBizSelect, calendarCategorySelect, calendarSubcategorySelect, refreshCalendarPrediction);

  // initialize cascades
  formBiz.dispatchEvent(new Event("input"));
  calcBiz.dispatchEvent(new Event("input"));
  recBiz.dispatchEvent(new Event("input"));
  calendarBizSelect.dispatchEvent(new Event("input"));

  calcDate.value = toISO(new Date());
  recEarliest.value = toISO(new Date());

  if (bizStats.length) renderChart();
  renderCalendar();
  bind();
  loadDraft();
  appendChat("bot", "안녕하세요! 시험 종목과 시기, 마감일, 우선순위(빨리/안정/혼잡회피/마감)를 입력해 주세요. 서버 연결이 없어도 학습 데이터 기반 규칙으로 접수 일정을 추천해 드립니다.");
})();
