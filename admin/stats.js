const DATA = window.KTL_PRECOMPUTED_RESULTS || {};
const $ = (selector) => document.querySelector(selector);
const fmt = (value) => new Intl.NumberFormat("ko-KR").format(Number(value || 0));

function barRows(target, rows, getLabel, getValue, formatter, colorClass = "") {
  const max = Math.max(1, ...rows.map(getValue));
  target.innerHTML = rows.map((row) => {
    const value = Number(getValue(row) || 0);
    return `<div class="bar-row">
      <span class="bar-label" title="${getLabel(row)}">${getLabel(row)}</span>
      <div class="bar-track"><div class="bar-fill ${colorClass}" style="width:${Math.max(1, value / max * 100)}%"></div></div>
      <span class="bar-value">${formatter(value)}</span>
    </div>`;
  }).join("");
}

function renderKpis() {
  $("#rawRows").textContent = fmt(DATA.volume_model?.raw_csv_rows);
  $("#trainingRows").textContent = fmt(DATA.processing_model?.training_rows);
  $("#volumeWape").textContent = `${((DATA.volume_model?.validation?.wape || 0) * 100).toFixed(1)}%`;
  $("#processingMae").textContent = `${Number(DATA.processing_model?.validation?.mae || 0).toFixed(1)}일`;
}

function renderBusinessCharts() {
  const stats = [...(DATA.biz_stats || [])];
  const total = stats.reduce((sum, row) => sum + Number(row.n || 0), 0) || 1;
  const byVolume = stats.sort((a, b) => b.n - a.n);
  barRows($("#volumeBars"), byVolume, r => r.biz, r => r.n / total * 100, v => `${v.toFixed(1)}%`);

  const byDuration = [...stats].sort((a, b) => b.avg_days - a.avg_days);
  barRows($("#durationBars"), byDuration, r => r.biz, r => r.avg_days, v => `${v.toFixed(1)}일`, "orange");

  $("#businessTable").innerHTML = byDuration.map((row) => `<tr>
    <td><strong>${row.biz}</strong></td><td class="num">${fmt(row.n)}</td>
    <td class="num">${Number(row.avg_days).toFixed(1)}일</td><td class="num">${Number(row.median_days).toFixed(1)}일</td>
    <td class="num">${(Number(row.avg_days) - Number(row.median_days)).toFixed(1)}일</td>
  </tr>`).join("");
}

function renderForecast() {
  const scopes = DATA.scopes || {};
  const allKey = Object.keys(scopes).find((key) => key === "전체") || Object.keys(scopes)[0];
  const rows = (scopes[allKey]?.forecast || []).slice(0, 14);
  const max = Math.max(1, ...rows.map(row => Number(row.predicted_count || 0)));
  $("#forecastChart").innerHTML = rows.map((row) => {
    const date = new Date(`${row.date}T00:00:00`);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const height = Math.max(2, Number(row.predicted_count || 0) / max * 88);
    const label = new Intl.DateTimeFormat("ko-KR", {month:"numeric", day:"numeric"}).format(date);
    return `<div class="forecast-col" title="${label} · ${row.predicted_count}건">
      <span class="forecast-value">${Math.round(row.predicted_count)}</span>
      <div class="forecast-bar ${weekend ? "weekend" : ""}" style="height:${height}%"></div>
      <span class="forecast-label">${label}</span>
    </div>`;
  }).join("");
}

function renderShap() {
  const rows = (DATA.global_shap || []).slice(0, 9);
  barRows($("#shapBars"), rows, r => r.feature, r => r.share_pct, v => `${v.toFixed(1)}%`, "blue");
}

renderKpis();
renderBusinessCharts();
renderForecast();
renderShap();
