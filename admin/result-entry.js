const DATA = window.KTL_PRECOMPUTED_RESULTS || {};
const CATALOG = DATA.catalog || {};
const STORAGE_KEY = "ktl-admin-results-v1";
const $ = (selector) => document.querySelector(selector);
const form = $("#resultForm");
const bizSelect = $("#resultBiz");
const midSelect = $("#resultMid");
const subSelect = $("#resultSub");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

function fill(select, values) {
  select.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  select.disabled = values.length === 0;
}

function refreshMids() {
  fill(midSelect, Object.keys(CATALOG[bizSelect.value] || {}).sort());
  refreshSubs();
}

function refreshSubs() {
  fill(subSelect, [...(CATALOG[bizSelect.value]?.[midSelect.value] || [])].sort());
}

function loadRows() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveRows(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function dayDiff(startValue, endValue) {
  if (!startValue || !endValue) return null;
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  return Math.max(0, Math.round((end - start) / 86400000));
}

function businessDayDiff(startValue, endValue) {
  if (!startValue || !endValue) return null;
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function updatePreview() {
  const elapsed = dayDiff($("#receivedOn").value, $("#completedOn").value);
  const business = businessDayDiff($("#receivedOn").value, $("#completedOn").value);
  const predicted = Number(form.elements.predicted_days.value);
  $("#elapsedPreview").textContent = elapsed == null ? "-" : `${elapsed}일`;
  $("#businessPreview").textContent = business == null ? "-" : `${business}일`;
  $("#errorPreview").textContent = business == null || !form.elements.predicted_days.value
    ? "-" : `${business - predicted >= 0 ? "+" : ""}${(business - predicted).toFixed(1)}일`;
}

function structuredRecord() {
  const values = Object.fromEntries(new FormData(form).entries());
  const elapsed = dayDiff(values.received_on, values.completed_on);
  const business = businessDayDiff(values.received_on, values.completed_on);
  const predicted = values.predicted_days === "" ? null : Number(values.predicted_days);
  return {
    record_id: `RESULT-${Date.now()}`,
    receipt_no: values.receipt_no.trim(),
    biz: values.biz,
    mid: values.mid,
    sub: values.sub,
    received_on: values.received_on,
    completed_on: values.completed_on,
    elapsed_days: elapsed,
    business_days: business,
    predicted_days: predicted,
    prediction_error_days: predicted == null ? null : Number((business - predicted).toFixed(1)),
    delayed: values.outcome === "지연 완료" || (predicted != null && business > predicted),
    outcome: values.outcome,
    delay_reason: values.delay_reason.trim(),
    rework_required: form.elements.rework_required.checked,
    department: values.department.trim(),
    result_summary: values.result_summary.trim(),
    source: "admin_result_entry",
    training_ready: Boolean(values.biz && values.mid && values.sub && business != null),
    saved_at: new Date().toISOString(),
  };
}

function renderRows() {
  const rows = loadRows();
  $("#resultCount").textContent = `${rows.length}건`;
  $("#resultRows").innerHTML = rows.length ? rows.slice().reverse().map(row => `<tr>
    <td>${escapeHtml(row.receipt_no)}</td><td>${escapeHtml(row.biz)}</td><td>${escapeHtml(row.sub)}</td>
    <td>${row.received_on}</td><td>${row.completed_on}</td><td class="num">${row.business_days}일</td><td>${escapeHtml(row.outcome)}</td>
  </tr>`).join("") : `<tr><td class="empty" colspan="7">저장된 결과가 없습니다.</td></tr>`;
}

function download(content, filename, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  download(JSON.stringify(loadRows(), null, 2), `ktl-results-${new Date().toISOString().slice(0,10)}.json`, "application/json;charset=utf-8");
}

function exportCsv() {
  const rows = loadRows();
  if (!rows.length) { $("#saveMessage").textContent = "내보낼 데이터가 없습니다."; return; }
  const headers = Object.keys(rows[0]);
  const quote = value => `"${String(value ?? "").replaceAll('"','""')}"`;
  const csv = "\ufeff" + [headers.join(","), ...rows.map(row => headers.map(key => quote(row[key])).join(","))].join("\r\n");
  download(csv, `ktl-results-${new Date().toISOString().slice(0,10)}.csv`, "text/csv;charset=utf-8");
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if ($("#completedOn").value < $("#receivedOn").value) {
    $("#saveMessage").textContent = "완료일은 접수일보다 빠를 수 없습니다.";
    return;
  }
  const rows = loadRows();
  rows.push(structuredRecord());
  saveRows(rows);
  $("#saveMessage").textContent = "구조화 데이터로 저장했습니다.";
  renderRows();
});

$("#resetButton").addEventListener("click", () => {
  form.reset();
  setDefaultDates();
  refreshMids();
  updatePreview();
  $("#saveMessage").textContent = "";
});
$("#csvButton").addEventListener("click", exportCsv);
$("#jsonButton").addEventListener("click", exportJson);
bizSelect.addEventListener("input", refreshMids);
midSelect.addEventListener("input", refreshSubs);
$("#receivedOn").addEventListener("input", updatePreview);
$("#completedOn").addEventListener("input", updatePreview);
form.elements.predicted_days.addEventListener("input", updatePreview);

function setDefaultDates() {
  const today = new Date().toISOString().slice(0,10);
  $("#receivedOn").value = today;
  $("#completedOn").value = today;
}

fill(bizSelect, Object.keys(CATALOG).sort());
refreshMids();
setDefaultDates();
updatePreview();
renderRows();
