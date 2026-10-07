const DATA = window.KTL_PRECOMPUTED_RESULTS || {};
const RESULT_KEY = "ktl-admin-results-v1";
const $ = (selector) => document.querySelector(selector);
const number = (value) => new Intl.NumberFormat("ko-KR").format(Number(value || 0));

function storedResults() {
  try { return JSON.parse(localStorage.getItem(RESULT_KEY) || "[]"); }
  catch { return []; }
}

function renderSummary() {
  const catalog = DATA.catalog || {};
  const businesses = Object.keys(catalog);
  const categoryPairs = businesses.reduce((sum, biz) => sum + Object.keys(catalog[biz] || {}).length, 0);
  const saved = storedResults();
  $("#trainingRows").textContent = number(DATA.processing_model?.training_rows);
  $("#rawRows").textContent = number(DATA.volume_model?.raw_csv_rows);
  $("#businessCount").textContent = `${businesses.length}개`;
  $("#categoryCount").textContent = `${categoryPairs}개`;
  $("#savedCount").textContent = `${saved.length}건`;
}

function renderBusinessRows() {
  const rows = [...(DATA.biz_stats || [])].sort((a, b) => b.n - a.n);
  const total = rows.reduce((sum, row) => sum + Number(row.n || 0), 0) || 1;
  $("#businessRows").innerHTML = rows.map((row) => {
    const share = row.n / total * 100;
    return `<tr>
      <td><strong>${row.biz}</strong></td>
      <td class="num">${number(row.n)}</td>
      <td><div class="share"><div class="track"><div class="fill" style="width:${Math.max(1, share)}%"></div></div><span>${share.toFixed(1)}%</span></div></td>
      <td class="num">${Number(row.avg_days).toFixed(1)}일</td>
      <td class="num">${Number(row.median_days).toFixed(1)}일</td>
    </tr>`;
  }).join("");
}

function renderSavedRows() {
  const saved = storedResults().slice().reverse().slice(0, 8);
  $("#savedRows").innerHTML = saved.length ? saved.map((row) => `<tr>
    <td>${row.receipt_no || "-"}</td><td>${row.biz || "-"}</td><td>${row.mid || "-"}</td>
    <td>${row.sub || "-"}</td><td class="num">${row.business_days ?? row.elapsed_days ?? "-"}일</td>
    <td>${row.outcome || "-"}</td><td>${row.saved_at ? new Date(row.saved_at).toLocaleString("ko-KR") : "-"}</td>
  </tr>`).join("") : `<tr><td colspan="7" class="empty">아직 저장된 결과가 없습니다. ‘새 결과 입력’에서 첫 결과를 저장하세요.</td></tr>`;
}

renderSummary();
renderBusinessRows();
renderSavedRows();
