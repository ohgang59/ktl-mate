// 관리자 대시보드 동작.
const API = "";

const $ = (s) => document.querySelector(s);
const todayCountEl = $("#todayCount");
const monthCountEl = $("#monthCount");
const collectedCountEl = $("#collectedCount");
const donutChart = $("#donutChart");
const donutPercent = $("#donutPercent");
const currentTime = $("#currentTime");
const pendingTab = $("#pendingTab");
const completedTab = $("#completedTab");
const testTableBody = $("#testTableBody");
const listSummary = $("#listSummary");
const statusColumn = $("#statusColumn");
const detailModal = $("#detailModal");
const modalStatus = $("#modalStatus");
const modalTitle = $("#modalTitle");
const modalContent = $("#modalContent");
const closeModalButton = $("#closeModalButton");
const editButton = $("#editButton");
const saveButton = $("#saveButton");
const cancelEditButton = $("#cancelEditButton");
const deleteButton = $("#deleteButton");
const bizSelect = $("#bizSelect");
const predictCategorySelect = $("#predictCategorySelect");
const predictSubcategorySelect = $("#predictSubcategorySelect");
const predictedCompletion = $("#predictedCompletion");
const predictionSummary = $("#predictionSummary");
const calendarGrid = $("#calendarGrid");
const calendarMonthLabel = $("#calendarMonthLabel");
const prevMonthButton = $("#prevMonthButton");
const nextMonthButton = $("#nextMonthButton");
const shapBox = $("#shapBox");
const shapList = $("#shapList");
const receiptForecastBiz = $("#receiptForecastBiz");
const receiptForecastMeta = $("#receiptForecastMeta");
const receiptForecastList = $("#receiptForecastList");
const receiptForecastShap = $("#receiptForecastShap");

let catalog = {}; // biz -> mid -> [subs]
let currentView = "pending";
let visibleCalendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = new Date();
let cache = { applications: [] };
let currentApp = null;     // application currently in modal
let editing = false;
let receiptForecastData = null;
let selectedReceiptForecastDate = null;

function getStoredResultCount() {
  try {
    return JSON.parse(localStorage.getItem("ktl-admin-results-v1") || "[]").length;
  } catch {
    return 0;
  }
}

async function api(path, init) {
  const r = await fetch(API + path, init);
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

const fmtDateTime = (v) => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
const fmtDate = (v) => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(v));
const fmtDur = (s, e) => {
  const ms = new Date(e) - new Date(s);
  const h = Math.max(1, Math.round(ms / 3600000));
  const d = Math.floor(h / 24); const r = h % 24;
  if (d === 0) return `${r}시간`; if (r === 0) return `${d}일`; return `${d}일 ${r}시간`;
};
const isSameDate = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

function fillSelect(el, values) {
  el.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  el.disabled = values.length === 0;
}

function populatePredictSelects() {
  const bizes = Object.keys(catalog).sort();
  fillSelect(bizSelect, bizes);
  onBizChange();
}
function onBizChange() {
  const mids = Object.keys(catalog[bizSelect.value] || {}).sort();
  fillSelect(predictCategorySelect, mids);
  onMidChange();
}
function onMidChange() {
  const subs = (catalog[bizSelect.value]?.[predictCategorySelect.value] || []).slice().sort();
  fillSelect(predictSubcategorySelect, subs);
  refreshPrediction();
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

async function refreshPrediction() {
  if (!selectedCalendarDate || !bizSelect.value) return;
  const body = {
    biz: bizSelect.value,
    mid: predictCategorySelect.value,
    sub: predictSubcategorySelect.value,
    receive_on: toISODate(selectedCalendarDate),
  };
  try {
    const [pred, exp] = await Promise.all([
      api("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      api("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    ]);
    predictedCompletion.textContent = fmtDate(pred.predicted_complete_at);
    predictionSummary.textContent = `${fmtDate(selectedCalendarDate)} 접수 · ${body.biz} > ${body.mid} > ${body.sub} · 예상 ${pred.predicted_days}일 (${pred.low_days}~${pred.high_days}일, 신뢰도 ${Math.round(pred.confidence * 100)}%, 혼잡도 ${pred.congestion})`;
    renderShap(exp);
  } catch (e) {
    predictionSummary.textContent = "예측 실패: " + e.message;
  }
}

function renderShap(exp) {
  const top = exp.top_features.slice(0, 5);
  const max = Math.max(...top.map((t) => Math.abs(t.shap)));
  shapList.innerHTML = top.map((t) => {
    const w = Math.round((Math.abs(t.shap) / max) * 100);
    const cls = t.shap >= 0 ? "pos" : "neg";
    return `<div class="shap-bar"><span class="label">${t.feature}=${t.value}</span><div class="bar ${cls}" style="width:${w}%"></div><span class="val">${t.shap.toFixed(3)}</span></div>`;
  }).join("");
  shapBox.hidden = false;
}

function updateClock() {
  currentTime.textContent = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}

async function refreshDashboard() {
  try {
    const d = await api("/api/dashboard");
    todayCountEl.textContent = d.today;
    monthCountEl.textContent = d.month;
    collectedCountEl.textContent = (d.collected ?? 0) + getStoredResultCount();
    const pct = d.month === 0 ? 0 : Math.round((d.today / d.month) * 100);
    donutPercent.textContent = `${pct}%`;
    donutChart.style.background = `conic-gradient(var(--accent) ${pct * 3.6}deg, #e4ecef 0deg)`;
  } catch {}
}

function getPrecomputedReceiptForecast() {
  const data = window.KTL_PRECOMPUTED_RESULTS;
  if (!data?.scopes) return null;
  const allScopeName = Object.keys(data.scopes).find((name) => name === "전체") || Object.keys(data.scopes)[0];
  const scopeName = receiptForecastBiz.value || allScopeName;
  const scope = data.scopes[scopeName] || data.scopes[allScopeName];
  return {
    scope: scope.scope,
    data_from: scope.data_from,
    data_through: scope.data_through,
    warning: scope.warning,
    forecast: scope.forecast.slice(0, 14),
    businesses: Object.keys(data.scopes).filter((name) => name !== allScopeName),
    validation: data.volume_model?.validation || {},
  };
}

async function refreshReceiptForecast() {
  try {
    receiptForecastMeta.textContent = "사전 계산 결과를 불러오는 중입니다.";
    let d = getPrecomputedReceiptForecast();
    if (!d) {
      const params = new URLSearchParams({ days: "14" });
      if (receiptForecastBiz.value) params.set("biz", receiptForecastBiz.value);
      d = await api(`/api/forecast/receipts?${params}`);
    }
    receiptForecastData = d;
    if (receiptForecastBiz.options.length === 1) {
      d.businesses.forEach((biz) => {
        const option = document.createElement("option");
        option.value = biz;
        option.textContent = biz;
        receiptForecastBiz.appendChild(option);
      });
    }
    const selectedMetric = receiptForecastBiz.value
      ? d.validation?.per_business?.[receiptForecastBiz.value]
      : d.validation;
    const wape = selectedMetric?.wape == null ? "-" : `${(selectedMetric.wape * 100).toFixed(1)}%`;
    receiptForecastMeta.innerHTML = [
      `<b>${escapeHtml(d.scope)}</b> · 검증 WAPE ${wape}`,
      `학습 데이터 ${escapeHtml(d.data_from)} ~ ${escapeHtml(d.data_through)}`,
      d.warning ? `<div class="forecast-warning">${escapeHtml(d.warning)}</div>` : "",
    ].join("<br>");
    const max = Math.max(1, ...d.forecast.map((row) => row.predicted_count));
    if (!d.forecast.some((row) => row.date === selectedReceiptForecastDate)) {
      selectedReceiptForecastDate = d.forecast[0]?.date || null;
    }
    receiptForecastList.innerHTML = d.forecast.map((row) => {
      const width = Math.max(1, Math.round(row.predicted_count / max * 100));
      const high = ["높음", "매우 높음"].includes(row.congestion);
      const label = new Intl.DateTimeFormat("ko-KR", { month:"numeric", day:"numeric", weekday:"short" }).format(new Date(`${row.date}T00:00:00`));
      const selected = row.date === selectedReceiptForecastDate;
      return `<button type="button" class="forecast-row ${selected ? "selected" : ""}" data-forecast-date="${escapeHtml(row.date)}" aria-pressed="${selected}" title="80% 예상 범위 ${row.low}~${row.high}건 · 혼잡도 ${escapeHtml(row.congestion)}">
        <span>${escapeHtml(label)}</span>
        <div class="forecast-track"><div class="forecast-fill ${high ? "high" : ""}" style="width:${width}%"></div></div>
        <strong>${row.predicted_count}</strong>
      </button>`;
    }).join("");
    renderReceiptForecastShap(
      d.forecast.find((row) => row.date === selectedReceiptForecastDate)
    );
  } catch (e) {
    receiptForecastMeta.textContent = `접수량 예측 실패: ${e.message}`;
    receiptForecastList.innerHTML = "";
    receiptForecastShap.innerHTML = "";
  }
}

function renderReceiptForecastShap(row) {
  if (!row) { receiptForecastShap.innerHTML = ""; return; }
  const explanation = row.explanation;
  if (!explanation) {
    receiptForecastShap.innerHTML = `<p class="receipt-shap-note">사업구분을 선택하면 날짜별 영향 요인을 볼 수 있습니다.</p>`;
    return;
  }
  const top = explanation.top_features || [];
  const maxAbs = Math.max(0.0001, ...top.map((item) => Math.abs(item.shap)));
  const label = new Intl.DateTimeFormat("ko-KR", { month:"long", day:"numeric", weekday:"short" }).format(new Date(`${row.date}T00:00:00`));
  const clipped = explanation.was_clipped_to_zero
    ? ` · 모델 원출력 ${explanation.raw_prediction.toFixed(1)}건을 0건으로 보정`
    : "";
  receiptForecastShap.innerHTML = `
    <h4>${escapeHtml(label)} 예측 영향 요인</h4>
    <p class="receipt-shap-summary">기준값 ${explanation.base_value.toFixed(1)}건 + 요인 기여 ${explanation.contribution_sum >= 0 ? "+" : ""}${explanation.contribution_sum.toFixed(1)}건${clipped}</p>
    ${top.map((item) => {
      const width = Math.max(2, Math.round(Math.abs(item.shap) / maxAbs * 100));
      const cls = item.shap >= 0 ? "pos" : "neg";
      const sign = item.shap >= 0 ? "+" : "";
      return `<div class="receipt-shap-row" title="${escapeHtml(item.feature)}=${escapeHtml(item.value)}">
        <div>
          <div class="receipt-shap-label"><b>${escapeHtml(item.feature)}</b><span>${escapeHtml(item.value)}</span></div>
          <div class="forecast-track"><div class="forecast-fill receipt-shap-fill ${cls}" style="width:${width}%"></div></div>
        </div>
        <strong class="receipt-shap-value ${cls}">${sign}${item.shap.toFixed(1)}</strong>
      </div>`;
    }).join("")}
    <p class="receipt-shap-note" style="margin-top:8px;">빨강은 예측 증가, 파랑은 감소입니다. 시차값은 과거 계절 패턴, 이동평균은 해당 사업의 과거 평균으로 보완했습니다.</p>`;
}

async function refreshHotspots() {
  try {
    const d = await api("/api/forecast/hotspots?top_k=5");
    const banner = document.getElementById("hotspotBanner");
    const list = document.getElementById("hotspotList");
    if (!banner || !list || !d.rows?.length) return;
    const alerts = d.rows.filter(r => r.alert);
    if (alerts.length === 0) { banner.hidden = true; return; }
    banner.hidden = false;
    list.innerHTML = `다음달(${d.next_month}월) 평년 대비 몰릴 것으로 예상되는 분야 <b>${alerts.length}건</b>: ` +
      alerts.slice(0, 5).map(r => `<span style="display:inline-block; margin:2px 4px; padding:2px 8px; background:#ffe0b2; border-radius:10px;"><b>${r.mid}</b> (${r.next_ratio.toFixed(2)}×, ${r.next_count.toLocaleString()}건)</span>`).join("");
  } catch {}
}

async function refreshAlerts() {
  try {
    const d = await api("/api/alerts");
    const banner = document.getElementById("alertBanner");
    const list = document.getElementById("alertList");
    const counts = document.getElementById("alertCounts");
    if (!banner || !list) return;
    const total = d.counts.overdue + d.counts.due_soon + d.counts.outliers;
    if (total === 0) { banner.hidden = true; return; }
    banner.hidden = false;
    counts.textContent = `(지연 ${d.counts.overdue} · 임박 ${d.counts.due_soon} · 이상치 ${d.counts.outliers})`;
    const chip = (txt, bg) => `<span style="display:inline-block; margin:2px 4px; padding:2px 8px; background:${bg}; border-radius:10px;">${txt}</span>`;
    const parts = [];
    d.overdue.slice(0, 3).forEach(r => parts.push(chip(
      `⏰ #${r.id} ${r.category||""}/${r.sample||""} <b>${r.days_overdue}일 지연</b>`, "#ffcdd2")));
    d.due_soon.slice(0, 3).forEach(r => parts.push(chip(
      `📅 #${r.id} ${r.category||""}/${r.sample||""} <b>D-${r.days_left}</b>`, "#ffe0b2")));
    d.outliers.slice(0, 3).forEach(r => parts.push(chip(
      `📊 #${r.id} 예측 ${r.predicted_days}일 vs 실제 ${r.actual_days}일 (z=${r.z})`, "#e1bee7")));
    list.innerHTML = parts.join("") || "<span style='opacity:.7'>모두 정상</span>";
  } catch {}
}

async function refreshList() {
  pendingTab.classList.toggle("active", currentView === "pending");
  completedTab.classList.toggle("active", currentView === "completed");
  statusColumn.textContent = currentView === "pending" ? "처리" : "완료 소요시간";
  cache.applications = await api(`/api/applications?status=${currentView}`);
  listSummary.textContent = `${cache.applications.length}건`;
  if (cache.applications.length === 0) {
    testTableBody.innerHTML = `<tr><td colspan="4">표시할 시험이 없습니다.</td></tr>`;
    return;
  }
  testTableBody.innerHTML = cache.applications.map((a) => {
    const right = currentView === "pending"
      ? `<button class="complete-button" type="button" data-complete-id="${a.id}">완료시험으로 변경</button>`
      : `<span class="duration-badge">${a.completed_at ? fmtDur(a.received_at, a.completed_at) : "-"}</span>`;
    return `<tr data-test-id="${a.id}"><td>${escapeHtml(a.category)}</td><td>${escapeHtml(a.subcategory)}</td><td class="sample-cell">${escapeHtml(a.sample_name || "-")}</td><td>${right}</td></tr>`;
  }).join("");
}

function detailSection(title, items) {
  return `<section class="detail-section"><h3>${escapeHtml(title)}</h3><div class="detail-grid">${items.map(([l,v])=>`<div class="detail-item"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v || "-")}</strong></div>`).join("")}</div></section>`;
}

function openDetail(a) {
  currentApp = a;
  editing = false;
  saveButton.hidden = true;
  cancelEditButton.hidden = true;
  editButton.hidden = false;
  modalStatus.textContent = a.status === "pending" ? "미완료된 시험" : "완료된 시험";
  modalTitle.textContent = `${a.sample_name || "(시료명 없음)"} 신청 양식 (#${a.id})`;
  renderViewMode();
  detailModal.classList.remove("hidden");
  loadExplain(a.id);
}

async function loadExplain(id) {
  const slot = document.getElementById("explainSlot");
  if (!slot) return;
  slot.innerHTML = '<span style="color:#789;">AI 분석 중…</span>';
  try {
    const d = await api(`/api/applications/${id}/explain`);
    const p = d.prediction || {};
    const top = (d.shap?.top_features || []).slice(0, 3);
    const conf = p.confidence != null ? `${Math.round(p.confidence*100)}%` : "-";
    const band = (p.low_days != null && p.high_days != null)
      ? `${p.low_days}일 ~ ${p.high_days}일` : "-";
    const cmp = (d.actual_days != null && p.predicted_days != null)
      ? `<div class="detail-item" style="grid-column:1/-1; background:${Math.abs(d.actual_days - p.predicted_days) > 2*(p.history_std||7) ? "#fdecea" : "#eef6ee"};">
           <span>예측 vs 실제</span>
           <strong>예측 ${p.predicted_days}일 / 실제 ${d.actual_days}일 (오차 ${(d.actual_days - p.predicted_days).toFixed(1)}일)</strong>
         </div>` : "";
    const shapHtml = top.length === 0 ? "<span style='color:#789;'>영향 요인 데이터 없음</span>" :
      top.map(f => {
        const sign = f.shap >= 0 ? "+" : "";
        const color = f.shap >= 0 ? "#c62828" : "#2e7d32";
        return `<div style="display:flex; gap:8px; padding:4px 0; border-bottom:1px dotted #ddd;">
                  <span style="flex:0 0 130px; color:#345;">${f.feature}</span>
                  <span style="flex:1; color:#566; font-size:12px;">${f.value}</span>
                  <strong style="color:${color}; font-variant-numeric:tabular-nums;">${sign}${f.shap.toFixed(3)}</strong>
                </div>`;
      }).join("");
    slot.innerHTML = `
      <section class="detail-section"><h3>🧠 AI 예측 신뢰도 · 영향 요인</h3>
        <div class="detail-grid">
          <div class="detail-item"><span>예측 신뢰도</span><strong>${conf}</strong></div>
          <div class="detail-item"><span>80% 신뢰 구간</span><strong>${band}</strong></div>
          <div class="detail-item"><span>유사 사례</span><strong>${p.history_count?.toLocaleString() || 0}건 (평균 ${p.history_mean ?? "-"}일)</strong></div>
          <div class="detail-item"><span>접수월 혼잡도</span><strong>${p.congestion ?? "-"}</strong></div>
          ${cmp}
        </div>
        <div style="margin-top:10px; padding:10px; background:#f8fafb; border-radius:6px;">
          <div style="font-size:12px; color:#456; margin-bottom:6px;">상위 영향 요인 (+는 소요일 증가 방향)</div>
          ${shapHtml}
        </div>
      </section>`;
  } catch (e) {
    slot.innerHTML = `<div style="color:#a55; font-size:12px;">분석 실패: ${e.message}</div>`;
  }
}

function renderViewMode() {
  const a = currentApp;
  const completion = a.completion;
  const outcomeLabels = {
    passed: "적합", failed: "부적합", conditional: "조건부 적합",
    inconclusive: "판정 보류", cancelled: "취소", completed: "완료",
  };
  const delayLabels = {
    sample_issue: "시료 문제", equipment: "장비·설비", retest: "재시험",
    customer_request: "고객 요청", staffing: "인력·일정", other: "기타",
  };
  const completionHtml = a.status === "completed" && completion
    ? detailSection("자동 수집된 완료 결과", [
        ["시험 결과", outcomeLabels[completion.outcome] || completion.outcome],
        ["지연 사유", delayLabels[completion.delay_reason] || completion.delay_reason || "없음"],
        ["재시험 여부", completion.rework_required ? "예" : "아니오"],
        ["실제 처리일수", completion.actual_days != null ? `${completion.actual_days.toFixed(1)}일` : "-"],
        ["예측 오차", completion.prediction_error_days != null ? `${completion.prediction_error_days.toFixed(1)}일` : "-"],
        ["결과 요약", completion.result_summary || "-"],
        ["수집 시각", completion.collected_at ? fmtDateTime(completion.collected_at) : "-"],
      ])
    : a.status === "pending" ? renderCompletionForm() : "";
  modalContent.innerHTML = [
    detailSection("시험 정보", [
      ["사업구분", a.biz], ["중분류", a.category], ["소분류", a.subcategory],
      ["시료 이름", a.sample_name],
      ["접수 일시", fmtDateTime(a.received_at)],
      ["완료 일시", a.completed_at ? fmtDateTime(a.completed_at) : "미완료"],
      ["완료 소요시간", a.completed_at ? fmtDur(a.received_at, a.completed_at) : "진행중"],
      ["AI 예측 소요일", a.predicted_days != null ? `${a.predicted_days}일` : "-"],
      ["AI 예측 완료일", a.predicted_complete_at ? a.predicted_complete_at.slice(0,10) : "-"],
    ]),
    detailSection("신청자 정보", [
      ["회사명", a.applicant?.company], ["사업자등록번호", a.applicant?.business_no],
      ["회사주소", a.applicant?.address], ["대표자", PiiMask.maskName(a.applicant?.ceo)],
      ["신청인", PiiMask.maskName(a.applicant?.name)], ["전화번호", PiiMask.maskPhone(a.applicant?.phone)],
      ["휴대폰", PiiMask.maskPhone(a.applicant?.mobile)], ["E-mail", PiiMask.maskEmail(a.applicant?.email)],
      ["FAX", PiiMask.maskPhone(a.applicant?.fax)],
    ]),
    detailSection("접수 및 발급 정보", [
      ["결제방법", a.request?.payment], ["성적서 종류", a.request?.report],
      ["시료처리", a.request?.return_method], ["택배 주소", a.request?.return_address],
      ["특이사항", a.request?.notes],
    ]),
    completionHtml,
    `<div id="explainSlot"></div>`,
  ].join("");
  const completeButton = document.getElementById("completeWithResultButton");
  if (completeButton) completeButton.addEventListener("click", saveCompletionResult);
}

function localDateTimeValue(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function renderCompletionForm() {
  return `<section class="completion-box" id="completionBox">
    <h3>시험 결과 정리 · 자동 학습 데이터 수집</h3>
    <p class="hint">완료 처리 시 분류, 기존 예측, 실제 처리일수와 구조화된 결과가 자동 저장됩니다. 신청자·연락처·시료명은 복제하지 않으며, 결과 요약에는 개인정보를 입력하지 마세요.</p>
    <div class="completion-grid">
      <label for="completionAt">완료 일시</label>
      <input id="completionAt" type="datetime-local" value="${localDateTimeValue()}" />
      <label for="completionOutcome">시험 결과</label>
      <select id="completionOutcome" required>
        <option value="">선택하세요</option>
        <option value="passed">적합</option>
        <option value="failed">부적합</option>
        <option value="conditional">조건부 적합</option>
        <option value="inconclusive">판정 보류</option>
        <option value="cancelled">취소</option>
      </select>
      <label for="completionDelay">지연 사유</label>
      <select id="completionDelay">
        <option value="">없음</option>
        <option value="sample_issue">시료 문제</option>
        <option value="equipment">장비·설비</option>
        <option value="retest">재시험</option>
        <option value="customer_request">고객 요청</option>
        <option value="staffing">인력·일정</option>
        <option value="other">기타</option>
      </select>
      <label for="completionRework">재시험 발생</label>
      <input id="completionRework" type="checkbox" style="width:auto; justify-self:start;" />
      <label for="completionSummary">결과 요약</label>
      <textarea id="completionSummary" maxlength="2000" placeholder="시험 결과와 특이사항을 간단히 기록"></textarea>
    </div>
    <div class="completion-actions">
      <button id="completeWithResultButton" class="complete-button" type="button">결과 저장 및 완료 처리</button>
    </div>
  </section>`;
}

async function saveCompletionResult() {
  if (!currentApp) return;
  const outcome = document.getElementById("completionOutcome")?.value;
  const completedAt = document.getElementById("completionAt")?.value;
  if (!outcome) { alert("시험 결과를 선택해주세요."); return; }
  if (!completedAt) { alert("완료 일시를 입력해주세요."); return; }
  const button = document.getElementById("completeWithResultButton");
  if (button) { button.disabled = true; button.textContent = "저장 중…"; }
  const payload = {
    completed_at: new Date(completedAt).toISOString(),
    outcome,
    delay_reason: document.getElementById("completionDelay")?.value || null,
    rework_required: !!document.getElementById("completionRework")?.checked,
    result_summary: document.getElementById("completionSummary")?.value.trim() || null,
  };
  try {
    currentApp = await api(`/api/applications/${currentApp.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    modalStatus.textContent = "완료된 시험";
    renderViewMode();
    loadExplain(currentApp.id);
    await Promise.all([refreshList(), refreshDashboard(), refreshAlerts()]);
  } catch (e) {
    alert("완료 결과 저장 실패: " + e.message);
    if (button) { button.disabled = false; button.textContent = "결과 저장 및 완료 처리"; }
  }
}

const _editFields = [
  ["시험 정보", [
    ["status", "상태", "select", ["pending","completed"]],
    ["biz", "사업구분"],
    ["category", "중분류"],
    ["subcategory", "소분류"],
    ["sample_name", "시료 이름"],
    ["received_at", "접수 일시", "datetime-local"],
    ["completed_at", "완료 일시", "datetime-local"],
    ["predicted_days", "AI 예측 소요일", "number"],
    ["predicted_complete_at", "AI 예측 완료일", "datetime-local"],
  ]],
  ["신청자 정보", [
    ["company", "회사명"], ["business_no", "사업자등록번호"],
    ["address", "회사주소", "textarea"], ["ceo", "대표자"],
    ["applicant_name", "신청인"], ["phone", "전화번호"],
    ["mobile", "휴대폰"], ["email", "E-mail"], ["fax", "FAX"],
  ]],
  ["접수 및 발급 정보", [
    ["payment", "결제방법"], ["report", "성적서 종류"],
    ["return_method", "시료처리"], ["return_address", "택배 주소", "textarea"],
    ["notes", "특이사항", "textarea"],
  ]],
];

function _flatVal(a, k) {
  if (k in a) return a[k];
  if (a.applicant && k in a.applicant) return a.applicant[k];
  if (k === "name" && a.applicant) return a.applicant.name;
  if (a.request && k in a.request) return a.request[k];
  return null;
}

function _toLocalDT(v) {
  if (!v) return "";
  // input[type=datetime-local] expects YYYY-MM-DDTHH:MM
  return v.slice(0,16);
}

function renderEditMode() {
  const a = currentApp;
  const html = _editFields.map(([title, fields]) => {
    const rows = fields.map(([key, label, kind, options]) => {
      let raw = _flatVal(a, key);
      if (key === "applicant_name") raw = a.applicant?.name;
      let val = raw == null ? "" : String(raw);
      let input;
      if (kind === "select") {
        input = `<select name="${key}">${options.map(o => `<option value="${o}" ${o===val?"selected":""}>${o}</option>`).join("")}</select>`;
      } else if (kind === "textarea") {
        input = `<textarea name="${key}">${val}</textarea>`;
      } else if (kind === "number") {
        input = `<input type="number" name="${key}" value="${val}" />`;
      } else if (kind === "datetime-local") {
        input = `<input type="datetime-local" name="${key}" value="${_toLocalDT(val)}" />`;
      } else {
        input = `<input type="text" name="${key}" value="${val.replace(/"/g,"&quot;")}" />`;
      }
      return `<label>${label}</label>${input}`;
    }).join("");
    return `<section class="edit-section"><h3>${title}</h3><div class="edit-grid">${rows}</div></section>`;
  }).join("");
  modalContent.innerHTML = `<form id="editForm">${html}</form>`;
}

async function saveEdits() {
  const form = document.getElementById("editForm");
  if (!form) return;
  const fd = new FormData(form);
  const payload = {};
  for (const [k, v] of fd.entries()) {
    if (v === "" || v == null) continue;
    if (k === "predicted_days") payload[k] = parseInt(v, 10);
    else if (["received_at","completed_at","predicted_complete_at"].includes(k))
      payload[k] = new Date(v).toISOString();
    else payload[k] = v;
  }
  try {
    const updated = await api(`/api/applications/${currentApp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    currentApp = updated;
    editing = false;
    saveButton.hidden = true;
    cancelEditButton.hidden = true;
    editButton.hidden = false;
    renderViewMode();
    await Promise.all([refreshList(), refreshDashboard()]);
  } catch (e) {
    alert("저장 실패: " + e.message);
  }
}

async function deleteCurrent() {
  if (!currentApp) return;
  if (!confirm(`#${currentApp.id} 신청을 정말 삭제하시겠습니까? (DB에서 영구 제거)`)) return;
  try {
    await api(`/api/applications/${currentApp.id}`, { method: "DELETE" });
    detailModal.classList.add("hidden");
    currentApp = null;
    await Promise.all([refreshList(), refreshDashboard()]);
  } catch (e) {
    alert("삭제 실패: " + e.message);
  }
}

async function completeApp(id) {
  const app = cache.applications.find((item) => item.id === id);
  if (!app) return;
  openDetail(app);
  requestAnimationFrame(() => document.getElementById("completionBox")?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function bind() {
  pendingTab.addEventListener("click", () => { currentView = "pending"; refreshList(); });
  completedTab.addEventListener("click", () => { currentView = "completed"; refreshList(); });
  testTableBody.addEventListener("click", (e) => {
    const cb = e.target.closest("[data-complete-id]");
    if (cb) { e.stopPropagation(); completeApp(Number(cb.dataset.completeId)); return; }
    const row = e.target.closest("[data-test-id]");
    if (!row) return;
    const a = cache.applications.find((x) => x.id === Number(row.dataset.testId));
    if (a) openDetail(a);
  });
  closeModalButton.addEventListener("click", () => detailModal.classList.add("hidden"));
  detailModal.addEventListener("click", (e) => { if (e.target === detailModal) detailModal.classList.add("hidden"); });
  PiiMask.bindToggle(document.getElementById("piiToggle"), () => {
    if (currentApp && !editing) renderViewMode();
  });
  editButton.addEventListener("click", () => {
    if (!currentApp) return;
    editing = true;
    editButton.hidden = true;
    saveButton.hidden = false;
    cancelEditButton.hidden = false;
    renderEditMode();
  });
  cancelEditButton.addEventListener("click", () => {
    editing = false;
    editButton.hidden = false;
    saveButton.hidden = true;
    cancelEditButton.hidden = true;
    renderViewMode();
  });
  saveButton.addEventListener("click", saveEdits);
  deleteButton.addEventListener("click", deleteCurrent);
  calendarGrid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-calendar-day]"); if (!b) return;
    selectedCalendarDate = new Date(visibleCalendarDate.getFullYear(), visibleCalendarDate.getMonth(), Number(b.dataset.calendarDay));
    renderCalendar(); refreshPrediction();
  });
  prevMonthButton.addEventListener("click", () => { visibleCalendarDate = new Date(visibleCalendarDate.getFullYear(), visibleCalendarDate.getMonth() - 1, 1); renderCalendar(); });
  nextMonthButton.addEventListener("click", () => { visibleCalendarDate = new Date(visibleCalendarDate.getFullYear(), visibleCalendarDate.getMonth() + 1, 1); renderCalendar(); });
  bizSelect.addEventListener("input", onBizChange);
  predictCategorySelect.addEventListener("input", onMidChange);
  predictSubcategorySelect.addEventListener("input", refreshPrediction);
  receiptForecastBiz.addEventListener("input", refreshReceiptForecast);
  receiptForecastList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-forecast-date]");
    if (!button || !receiptForecastData) return;
    selectedReceiptForecastDate = button.dataset.forecastDate;
    receiptForecastList.querySelectorAll("[data-forecast-date]").forEach((item) => {
      const selected = item.dataset.forecastDate === selectedReceiptForecastDate;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    renderReceiptForecastShap(
      receiptForecastData.forecast.find((row) => row.date === selectedReceiptForecastDate)
    );
  });
}

(async function init() {
  updateClock();
  collectedCountEl.textContent = getStoredResultCount();
  const staticData = window.KTL_PRECOMPUTED_RESULTS || {};
  catalog = staticData.catalog || {};
  if (Object.keys(catalog).length) populatePredictSelects();
  let backendAvailable = true;
  try {
    const liveCatalog = await api("/api/catalog");
    if (Object.keys(liveCatalog || {}).length) catalog = liveCatalog;
    populatePredictSelects();
  } catch {
    backendAvailable = false;
    predictedCompletion.textContent = "사전 계산 결과";
    predictionSummary.textContent = Object.keys(catalog).length
      ? "분류 목록을 불러왔습니다. 아래에서 미리 계산된 접수량 예측 결과를 확인하세요."
      : "분류 목록을 불러오지 못했습니다.";
  }
  renderCalendar();
  if (backendAvailable) {
    await Promise.all([refreshDashboard(), refreshList(), refreshReceiptForecast()]);
    await refreshPrediction();
    await refreshHotspots();
    await refreshAlerts();
  } else {
    await refreshReceiptForecast();
  }
  bind();
  setInterval(() => {
    updateClock();
    if (backendAvailable) refreshDashboard();
  }, 5000);
})();
