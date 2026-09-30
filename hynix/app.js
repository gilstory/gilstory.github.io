'use strict';
/* SK하이닉스 내일 아침 시가 확률 — 실시간 화면 + 과거 통계 화면 */

const ORDER = ['HYNIX', 'NQ', 'QQQ', 'SOXX', 'MU', 'SKHY', 'KNF', 'SEC', 'NVDA', 'INTC', 'SNDK', 'ZN', 'CL'];
const DEFAULT_HIDDEN = ['NVDA', 'INTC', 'SNDK', 'ZN', 'CL']; // 흐름 그래프에서 처음엔 꺼 둠(범례를 누르면 켜짐)
const SHORT = { HYNIX: '하이닉스', NQ: '나스닥 선물', QQQ: 'QQQ', SOXX: 'SOXX', MU: '마이크론', SKHY: 'SKHY', KNF: '코스피200 선물', SEC: '삼성전자', NVDA: '엔비디아', INTC: '인텔', SNDK: '샌디스크', ZN: '국채10년 선물', CL: 'WTI 유가' };
const KIND = { flow: '15:00 이후 흐름', lvl: '전일 종가 대비', rel: '하이닉스 대비 상대강도(15:00 이후)', aft: '당일 KRX 종가 대비', vwap: '애프터 VWAP 대비' };
const TNAME = { trade: '매수→08시 시가', gapk: 'KRX 종가 대비 갭' };
const S = { live: null, stats: null, view: 'ref', day: '', hidden: new Set(['NVDA', 'INTC', 'SNDK', 'ZN', 'CL']), tab: 'live', sTarget: 'trade', sMark: null, bSeries: 'SOXX', bKind: 'rel', nextAt: 0 };
const charts = {};
const STATIC = window.STATIC_SITE === true; // GitHub Pages 공개 웹판: 서버 없이 data/*.json만 읽음
const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const WD = '일월화수목금토';
const isNum = (x) => x !== null && x !== undefined && !Number.isNaN(x);
const fmtP = (x, d = 2) => (isNum(x) ? (x > 0 ? '+' : '') + x.toFixed(d) + '%' : '–');
const pct0 = (p) => (isNum(p) ? Math.round(p * 100) + '%' : '–');
const won = (x) => (isNum(x) ? Math.round(x).toLocaleString() + '원' : '–');
const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dlabel = (iso) => (iso ? `${iso.slice(5).replace('-', '/')}(${WD[new Date(iso + 'T00:00:00').getDay()]})` : '');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('hx2.' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('hx2.' + k, JSON.stringify(v)); } catch { /* 저장 불가 */ } },
};

/* ───────── 차트 공통 ───────── */
function baseOpts() {
  const muted = css('--muted'), grid = css('--grid');
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css('--surface'), titleColor: css('--ink'), bodyColor: css('--ink-2'), borderColor: css('--axis'), borderWidth: 1, padding: 8 } },
    scales: {
      x: { grid: { color: grid, drawTicks: false }, border: { color: css('--axis') }, ticks: { color: muted, font: { size: 11 } } },
      y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, font: { size: 11 }, padding: 6 } },
    },
  };
}
function mkChart(id, cfg) {
  if (charts[id]) { charts[id].destroy(); }
  charts[id] = new Chart($(id), cfg);
  return charts[id];
}
// 수평 기준선 플러그인
const hline = {
  id: 'hline',
  afterDraw(chart, _a, o) {
    if (!o.lines) return;
    const { ctx, chartArea: { left, right }, scales: { y } } = chart;
    for (const l of o.lines) {
      const py = y.getPixelForValue(l.y);
      ctx.save(); ctx.strokeStyle = l.color || css('--axis'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
      if (l.label) { ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui'; ctx.textAlign = 'right'; ctx.fillText(l.label, right - 4, py - 4); }
      ctx.restore();
    }
  },
};

/* ───────── 실시간 ───────── */
function probLabel(p, t) {
  if (!isNum(p)) return ['계산 전', '--muted'];
  p = Math.round(p * 100) / 100;
  const L = t === 'trade' ? ['강한 매수', '매수 우위', '중립', '관망', '매수 비추천'] : ['갭상승 유력', '갭상승 우위', '중립', '갭하락 우위', '갭하락 유력'];
  if (p >= 0.65) return [L[0], '--up'];
  if (p >= 0.55) return [L[1], '--up'];
  if (p > 0.45) return [L[2], '--ink-2'];
  if (p > 0.35) return [L[3], '--down'];
  return [L[4], '--down'];
}
function renderProb(pre, t, L) {
  const cur = L.current && L.current.targets[t];
  const when = L.current ? `${dlabel(L.date)} ${L.current.mark} 기준${L.current.minute ? (STATIC ? ' (게시 시점 스냅샷)' : ' (1분 실시간)') : ''}` : `${dlabel(L.date)} — 15:05 이후 계산`;
  $(pre + 'When').textContent = t === 'trade' && L.hynix.now ? `${when} · 매수가(NXT) ${won(L.hynix.now)}` : t === 'gapk' && L.hynix.close ? `${when} · KRX 종가 ${won(L.hynix.close)}${isNum(L.hynix.aft) ? ` · 지금 NXT ${fmtP(L.hynix.aft)}` : ''}` : when;
  if (!cur || !isNum(cur.p)) {
    $(pre + 'Pct').textContent = '–'; $(pre + 'Pct').style.color = css('--muted');
    $(pre + 'Label').textContent = '계산 전'; $(pre + 'Label').style.color = css('--muted');
    $(pre + 'Fill').style.width = '0'; $(pre + 'Grid').innerHTML = ''; $(pre + 'Rel').innerHTML = ''; $(pre + 'Note').textContent = '';
    return;
  }
  const [lab, col] = probLabel(cur.p, t);
  $(pre + 'Pct').textContent = Math.round(cur.p * 100) + '%';
  $(pre + 'Pct').style.color = css(col);
  $(pre + 'Label').textContent = lab; $(pre + 'Label').style.color = css(col);
  $(pre + 'Fill').style.width = (cur.p * 100).toFixed(1) + '%';
  $(pre + 'Fill').style.background = css(col);
  $(pre + 'Base').style.left = ((cur.base ?? 0.5) * 100).toFixed(1) + '%';
  const what = t === 'trade' ? '상승' : '갭상승';
  $(pre + 'Grid').innerHTML = `
    <dt>로지스틱 회귀 확률</dt><dd>${pct0(cur.pl)}</dd>
    <dt>과거 비슷한 흐름 ${cur.k}일 중 ${what}</dt><dd>${cur.ups}일 (${pct0(cur.pk)})</dd>
    <dt>${t === 'trade' ? '예상 수익률(매수가 대비)' : '예상 시가 갭'}</dt><dd class="${cls(cur.e)}">${fmtP(cur.e)}</dd>
    <dt>비슷한 날들의 실제 평균</dt><dd class="${cls(cur.nn_mean)}">${fmtP(cur.nn_mean)}</dd>
    <dt>과거 기본 ${what} 확률 <span class="muted tiny">(막대 세로선)</span></dt><dd>${pct0(cur.base)}</dd>`;
  const ev = cur.eval || {};
  const top = (ev.buckets || []).find((b) => b.label === '65% 이상');
  const good = isNum(ev.auc) && ev.auc >= 0.6;
  $(pre + 'Rel').innerHTML = `<span class="tag ${good ? 'good' : 'weak'}">${good ? '예측력 있음' : '예측력 약함'}</span>
    이 시각 모델의 과거 검증: AUC <b>${isNum(ev.auc) ? ev.auc.toFixed(2) : '–'}</b> · 방향 적중 <b>${pct0(ev.hit)}</b> (늘 ‘오른다’고 찍으면 ${pct0(ev.hit_base)})
    ${top && top.n ? ` · 65% 이상이던 ${top.n}일 중 <b>${pct0(top.up)}</b> ${what}` : ''}`;
  if (t === 'trade') {
    const line = (key, name) => {
      const it = (L.indicators || []).find((i) => i.key === key);
      const b = it && it.bin_trade;
      if (!b || !isNum(it.rel)) return '';
      const d = b.up - (cur.base ?? 0.5);
      return `${name} 상대강도 <b class="${cls(it.rel)}">${fmtP(it.rel)}</b> → 과거 같은 구간(${b.label}) 다음 날 시가가 매수가보다 높았던 비율 <b class="${d >= 0.08 ? 'up' : d <= -0.08 ? 'down' : ''}">${pct0(b.up)}</b> <span class="muted">(${b.n}일)</span>`;
    };
    const lines = [line('SOXX', 'SOXX'), line('SNDK', '샌디스크')].filter(Boolean);
    $('tKey').innerHTML = lines.length
      ? `<b>가장 꾸준한 신호</b><br>${lines.join('<br>')}<br><span class="muted tiny">6월 전·후 두 기간 모두 유의했던 지표입니다(SOXX r≈0.20·0.26, 샌디스크 r≈0.17·0.32).</span>`
      : '';
  }
  const miss = cur.missing && cur.missing.length ? `데이터 없는 지표(${[...new Set(cur.missing)].map((k) => SHORT[k] || k).join(', ')})는 빼고 다시 계산했습니다. ` : '';
  const replay = L.state === 'replay' ? '지난 날짜의 큰 숫자는 그날 이전 데이터로만 학습한 확률이고, 위 세부값은 전체 기간 모델 기준(참고용)입니다. ' : '';
  $(pre + 'Note').textContent = `${replay}${miss}최종 % = (로지스틱 회귀 + 비슷한 날 비율) ÷ 2.`;
}

function renderRemain(L) {
  const R = L.remain, box = $('remainCard');
  if (!R) { box.hidden = true; return; }
  box.hidden = false;
  const c = R.check || {};
  const good = R.remain >= 0.3, bad = R.remain <= -0.3;
  $('remainWhen').textContent = `${dlabel(L.date)} ${R.mark} 기준 · KRX 종가 ${won(R.close)}`;
  const reflected = R.gap_e >= 0.5 ? Math.max(0, Math.min(999, (R.aft / R.gap_e) * 100)) : null; // 예상 갭이 작으면 비율이 무의미
  $('remainSummary').innerHTML = `
    <dt>예상 익일 08:00 시가 <span class="muted tiny">(KRX 종가 대비, 갭 모델)</span></dt><dd class="${cls(R.gap_e)}">${fmtP(R.gap_e)} <span class="muted tiny">≈ ${won(R.open_est)}</span></dd>
    <dt>이미 반영 <span class="muted tiny">(지금 NXT 가격)</span></dt><dd class="${cls(R.aft)}">${fmtP(R.aft)} <span class="muted tiny">${won(R.now)}</span></dd>
    <dt><b>남은 여력</b> <span class="muted tiny">(지금 가격 → 예상 시가)</span></dt><dd class="${cls(R.remain)}"><b>${fmtP(R.remain)}</b></dd>
    ${isNum(reflected) ? `<dt>반영률</dt><dd>${Math.round(reflected)}%</dd>` : ''}`;
  // 가로 눈금: 0(KRX 종가) · 지금 NXT · 예상 시가
  const vals = [0, R.aft, R.gap_e], lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
  const x = (v) => ((v - lo) / (hi - lo)) * 100;
  const a = Math.min(R.aft, R.gap_e), b = Math.max(R.aft, R.gap_e);
  $('remainBar').innerHTML = `
    <div class="rb-track"></div>
    <div class="rb-seg ${R.gap_e >= R.aft ? 'up' : 'down'}" style="left:${x(a)}%;width:${x(b) - x(a)}%"></div>
    <div class="rb-mk zero" style="left:${x(0)}%"><span>${Math.abs(x(0) - x(R.gap_e)) < 18 ? '' : 'KRX 종가 0%'}</span></div>
    <div class="rb-mk now" style="left:${x(R.aft)}%"><span>지금 NXT ${fmtP(R.aft)}</span></div>
    <div class="rb-mk exp" style="left:${x(R.gap_e)}%"><span>예상 시가 ${fmtP(R.gap_e)}</span></div>`;
  const tip = good ? `아직 덜 반영됨 — 예상 시가가 지금 가격보다 ${fmtP(R.remain)} 높음` : bad ? `이미 넘어섬 — 지금 가격이 예상 시가보다 ${fmtP(-R.remain)} 높음` : '남은 여력 작음 — 지금 가격과 예상 시가 차이가 ±0.3%p 이내';
  $('remainTip').innerHTML = `<b class="${good ? 'up' : bad ? 'down' : ''}">${tip}</b>` + (R.bin ? ` · 과거 남은 여력이 이 구간(${R.bin.label})이던 ${R.bin.n}일: 실제 다음 날 시가가 매수가보다 평균 <b class="${cls(R.bin.mean)}">${fmtP(R.bin.mean)}</b>, 상승 ${pct0(R.bin.up)}` : '');
  // 시간대별 선 그래프
  const pts = L.timeline.filter((t) => isNum(t.gap_e));
  const o = baseOpts();
  o.interaction = { mode: 'index', intersect: false };
  o.scales.y.ticks.callback = (v) => v + '%';
  o.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: css('--ink-2'), boxWidth: 14, boxHeight: 3, font: { size: 12 } } };
  o.plugins.tooltip.callbacks = { label: (cx) => ` ${cx.dataset.label}: ${fmtP(cx.parsed.y)}`, afterBody: (items) => { const i = items[0].dataIndex; return `남은 여력: ${fmtP(pts[i].remain)}`; } };
  o.plugins.hline = { lines: [{ y: 0, label: 'KRX 종가' }] };
  const upFill = css('--up') + '26', downFill = css('--down') + '26';
  mkChart('remainChart', { type: 'line', data: { labels: pts.map((t) => t.mark), datasets: [
    { label: '지금 NXT 가격', data: pts.map((t) => +t.aft.toFixed(3)), borderColor: css('--s-HYNIX'), backgroundColor: css('--s-HYNIX'), borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.15 },
    { label: '예상 익일 시가', data: pts.map((t) => +t.gap_e.toFixed(3)), borderColor: css('--ink'), backgroundColor: css('--ink'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15,
      fill: { target: 0, above: upFill, below: downFill } },
  ] }, options: o, plugins: [hline] });
  // 과거 검증
  const labels = ['하위 20%', '20~40%', '중간', '60~80%', '상위 20%'];
  $('remainCheck').innerHTML = c.bins ? `<tr><th>남은 여력 구간</th><th class="num">범위</th><th class="num">일수</th><th class="num">실제 평균(매수가 대비)</th><th class="num">상승 비율</th></tr>` +
    c.bins.map((b, i) => `<tr${R.bin && R.bin.q === i ? ' class="on"' : ''}><td>${labels[i]}</td><td class="num">${fmtP(b.lo)} ~ ${fmtP(b.hi)}</td><td class="num">${b.n}</td><td class="num ${cls(b.mean)}">${fmtP(b.mean)}</td><td class="num">${pct0(b.up)}</td></tr>`).join('') : '';
  $('remainNote').textContent = c.n ? `${L.state === 'replay' ? '지난 날짜의 예상 시가는 전체 기간 모델 기준(참고용)입니다. ' : ''}과거 ${c.n}일, 매일 그날 이전 데이터로만 계산해 검증: 예상 갭과 실제 갭의 상관 ${c.r_gap.toFixed(2)}, 남은 여력과 실제 수익의 상관 ${c.r_remain.toFixed(2)}(약함). 하루하루의 오차는 평균 ±${c.err_sd.toFixed(1)}%p로 커서, 남은 여력은 “방향 참고”로만 보세요.` : '';
}

function renderTimeline(L) {
  const labels = L.model_marks.slice();
  const byIdx = Object.fromEntries(L.timeline.map((t) => [t.m, t]));
  for (const t of L.timeline) if (t.now) labels[t.m - 1] = t.mark + ' 현재';
  const byMark = Object.fromEntries(labels.map((lb, i) => [lb, byIdx[i + 1]]).filter(([, v]) => v));
  const ds = [
    { label: '매수→08시 시가', data: labels.map((m) => (byMark[m] && isNum(byMark[m].trade) ? +(byMark[m].trade * 100).toFixed(1) : null)), borderColor: css('--s-trade'), backgroundColor: css('--s-trade'), borderWidth: 2.5, pointRadius: 3.5, pointBorderColor: css('--surface'), pointBorderWidth: 1.5 },
    { label: 'KRX 종가 대비 갭', data: labels.map((m) => (byMark[m] && isNum(byMark[m].gapk) ? +(byMark[m].gapk * 100).toFixed(1) : null)), borderColor: css('--s-gap'), backgroundColor: css('--s-gap'), borderWidth: 2, pointRadius: 3, pointBorderColor: css('--surface'), pointBorderWidth: 1.5 },
  ];
  const o = baseOpts();
  o.interaction = { mode: 'index', intersect: false };
  o.scales.y.min = 0; o.scales.y.max = 100;
  o.scales.y.ticks.callback = (v) => v + '%';
  o.scales.y.ticks.stepSize = 25;
  o.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: css('--ink-2'), boxWidth: 14, boxHeight: 3, font: { size: 12 } } };
  o.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${c.parsed.y}%` };
  o.plugins.hline = { lines: [{ y: 50, label: '50%' }] };
  mkChart('tlChart', { type: 'line', data: { labels, datasets: ds }, options: o, plugins: [hline] });
}

function renderFlow(L) {
  const ds = [];
  for (const s of ORDER) {
    const v = L.v[s];
    if (!v) continue;
    const data = S.view === 'ref' ? L.paths[s] : v.map((x) => (isNum(x) && L.base0[s] ? +((x / L.base0[s] - 1) * 100).toFixed(3) : null));
    const hourly = L.res[s] === 60;
    ds.push({ label: SHORT[s], key: s, data, borderColor: css('--s-' + s), backgroundColor: css('--s-' + s), borderWidth: s === 'HYNIX' ? 3 : 2,
      pointRadius: hourly ? 4 : 0, pointHoverRadius: 5, pointBorderColor: css('--surface'), pointBorderWidth: 2, spanGaps: true, tension: 0.15, hidden: S.hidden.has(s), order: s === 'HYNIX' ? 0 : 1 });
  }
  const o = baseOpts();
  o.interaction = { mode: 'index', intersect: false };
  o.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${fmtP(c.parsed.y)}` };
  o.scales.y.ticks.callback = (v) => v + '%';
  mkChart('flowChart', { type: 'line', data: { labels: L.marks, datasets: ds }, options: o });
  const meta = (k) => L.series.find((x) => x.key === k) || {};
  $('flowLegend').innerHTML = ds.map((d) => {
    const mc = L.current ? L.current.m : d.data.length - 1; // 판단 시각(표와 같은 시점) 값
    const val = [...d.data.slice(0, mc + 1)].reverse().find(isNum);
    return `<div class="lg ${S.hidden.has(d.key) ? 'off' : ''}" data-k="${d.key}" title="${esc(meta(d.key).src)} · 기준: ${esc(S.view === 'ref' ? meta(d.key).ref : '15:00 가격')}">
      <span class="sw" style="background:${d.borderColor}"></span><span class="nm">${esc(meta(d.key).name)}</span><span class="val ${cls(val)}">${fmtP(val)}</span></div>`;
  }).join('') || '<span class="muted">아직 15:00 이후 데이터가 없습니다.</span>';
  document.querySelectorAll('#flowLegend .lg').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.k; S.hidden.has(k) ? S.hidden.delete(k) : S.hidden.add(k); renderFlow(S.live);
  }));
}

function binCell(b, base) {
  if (!b) return '<td class="num muted">–</td>';
  const diff = isNum(base) ? b.up - base : 0;
  const c = diff >= 0.08 ? 'up' : diff <= -0.08 ? 'down' : '';
  return `<td class="num"><b class="${c}">${pct0(b.up)}</b> <span class="muted tiny">${b.label}·${b.n}일</span></td>`;
}
function renderIndicators(L) {
  const bt = L.current && L.current.targets.trade ? L.current.targets.trade.base : null;
  const bg = L.current && L.current.targets.gapk ? L.current.targets.gapk.base : null;
  $('indSub').textContent = L.current ? `— ${L.current.mark} 기준` : '';
  const head = `<tr><th>지표</th><th class="num">현재가</th><th class="num">전일 종가 대비</th><th class="num">15:00 이후</th><th class="num">하이닉스 대비</th>
    <th class="num">과거 같은 구간 → 08시 시가&gt;매수가</th><th class="num">→ KRX 종가 대비 갭상승</th></tr>`;
  const body = L.indicators.map((i) => {
    if (i.missing) return `<tr><td>${esc(i.name)}</td><td class="muted" colspan="6">오늘 데이터 없음</td></tr>`;
    const px = i.key === 'HYNIX' ? won(i.price) : isNum(i.price) ? i.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '–';
    return `<tr><td><span class="sw-dot" style="background:${css('--s-' + i.key)}"></span>${esc(i.name)}${i.res === 60 ? ' <span class="muted tiny">1시간봉</span>' : ''}</td>
      <td class="num">${px}</td><td class="num ${cls(i.lvl)}">${fmtP(i.lvl)}</td><td class="num ${cls(i.flow)}">${fmtP(i.flow)}</td>
      <td class="num ${cls(i.rel)}">${i.key === 'HYNIX' ? '–' : fmtP(i.rel)}</td>${binCell(i.bin_trade, bt)}${binCell(i.bin_gap, bg)}</tr>`;
  }).join('');
  $('indTbl').innerHTML = head + body;
}

function renderNN(L) {
  const cur = L.current && L.current.targets.trade;
  if (!cur) { $('nnTbl').innerHTML = '<tr><td class="muted">15:10 이후 계산됩니다.</td></tr>'; $('nnSub').textContent = ''; return; }
  $('nnSub').textContent = `— 매수 모델 기준 ${L.current.mark} 특징값이 가장 가까운 ${cur.nn.length}일, 누르면 그날을 다시 봅니다`;
  $('nnTbl').innerHTML = `<tr><th>날짜</th><th class="num">거리(작을수록 비슷)</th><th class="num">다음 날 08시 시가(매수가 대비)</th></tr>` +
    cur.nn.map((o) => `<tr class="click" data-d="${o.d}"><td>${o.d} (${WD[new Date(o.d + 'T00:00:00').getDay()]})</td><td class="num">${o.dist.toFixed(2)}</td><td class="num ${cls(o.y)}"><b>${fmtP(o.y)}</b></td></tr>`).join('');
  $('nnTbl').querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => { $('daySel').value = tr.dataset.d; S.day = tr.dataset.d; loadLive(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}

function renderOutcome(L) {
  const o = L.outcome, card = $('outcomeCard');
  if (!o) { card.hidden = true; return; }
  const last = L.timeline.find((t) => t.m === L.decide);
  const pT = last ? last.trade : null, pG = last ? last.gapk : null;
  const hitT = isNum(pT) ? ((pT >= 0.5) === (o.trade > 0) ? '적중' : '빗나감') : '';
  const hitG = isNum(pG) ? ((pG >= 0.5) === (o.gapk > 0) ? '적중' : '빗나감') : '';
  card.hidden = false;
  card.innerHTML = `<h2>실제 결과 — 다음 거래일 ${dlabel(o.next)} 08:00 시가 ${won(o.open08)}</h2>
    <div class="outcome">
      <span>19:50 매수가 ${won(o.p1950)} 대비 <b class="${cls(o.trade)}">${fmtP(o.trade)}</b> ${hitT ? `<span class="muted">(19:50 확률 ${pct0(pT)} → ${hitT})</span>` : ''}</span>
      <span>KRX 종가 ${won(o.close)} 대비 <b class="${cls(o.gapk)}">${fmtP(o.gapk)}</b> ${hitG ? `<span class="muted">(19:50 확률 ${pct0(pG)} → ${hitG})</span>` : ''}</span>
    </div>`;
}

function renderLive() {
  const L = S.live;
  if (!L) return;
  $('banner').textContent = L.message + (L.job && L.job.live_error ? `\n실시간 갱신 오류: ${L.job.live_error}` : '');
  $('banner').dataset.state = L.state;
  renderProb('t', 'trade', L);
  renderProb('g', 'gapk', L);
  renderOutcome(L);
  renderRemain(L);
  renderTimeline(L);
  renderFlow(L);
  renderIndicators(L);
  renderNN(L);
  const first = STATIC ? `<option value="">최근 거래일 (${S.index ? dlabel(S.index.latest) : ''})</option>` : '<option value="">오늘 (실시간)</option>';
  const opts = [first].concat(L.days.map((d) => `<option value="${d}">${d} (${WD[new Date(d + 'T00:00:00').getDay()]})</option>`));
  if ($('daySel').options.length !== opts.length) $('daySel').innerHTML = opts.join('');
  $('daySel').value = S.day;
  updateStatus();
}

/* ───────── 과거 통계 ───────── */
function renderStats() {
  const st = S.stats;
  if (!st || st.empty) return;
  if (S.sMark == null) S.sMark = st.decide;
  const t = S.sTarget, m = String(S.sMark);
  if (!$('sMark').options.length) {
    $('sMark').innerHTML = st.marks.slice(1, st.decide + 1).map((mk, i) => `<option value="${i + 1}">${mk}</option>`).join('');
    $('bSeries').innerHTML = ORDER.map((k) => `<option value="${k}">${SHORT[k]}</option>`).join('');
  }
  $('sMark').value = m; $('sTarget').value = t; $('bSeries').value = S.bSeries; $('bKind').value = S.bKind;
  const md = st.models[t][m], ev = st.eval[t][m];
  $('sInfo').innerHTML = `학습 ${md.n}일 · 과거 기본 상승확률 ${pct0(md.base)} · 이 시각 모델 지표: ${md.features.map(featLabel).join(', ')}`;
  $('statsGen').textContent = `통계 계산 시각 ${st.generated.replace('T', ' ')} · 데이터 ${st.data_update ? st.data_update.replace('T', ' ').slice(0, 16) : '–'} · 가장 최근 결과 ${st.last_outcome || '–'} 아침`;

  // AUC 추이
  const labels = st.marks.slice(1, st.decide + 1);
  const o = baseOpts();
  o.scales.y.min = 0.3; o.scales.y.max = 0.8;
  o.interaction = { mode: 'index', intersect: false };
  o.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: css('--ink-2'), boxWidth: 14, boxHeight: 3, font: { size: 12 } } };
  o.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: AUC ${c.parsed.y.toFixed(2)}` };
  o.plugins.hline = { lines: [{ y: 0.5, label: '0.5 동전 던지기' }, { y: 0.6, label: '0.6' }] };
  mkChart('aucChart', { type: 'line', data: { labels, datasets: [
    { label: '매수→08시 시가', data: labels.map((_, i) => st.eval.trade[i + 1]?.auc ?? null), borderColor: css('--s-trade'), backgroundColor: css('--s-trade'), borderWidth: 2.5, pointRadius: 3 },
    { label: 'KRX 종가 대비 갭', data: labels.map((_, i) => st.eval.gapk[i + 1]?.auc ?? null), borderColor: css('--s-gap'), backgroundColor: css('--s-gap'), borderWidth: 2, pointRadius: 3 },
  ] }, options: o, plugins: [hline] });

  // 신뢰도 타일
  $('evalTitle').textContent = `예측 신뢰도 — ${TNAME[t]}, ${st.marks[+m]} 모델`;
  if (ev) {
    const tiles = [
      ['검증한 날', `${ev.n}일`, `${ev.from} ~ ${ev.to}`],
      ['AUC', ev.auc.toFixed(2), ev.auc >= 0.6 ? '의미 있음' : '약함 (0.5 = 동전)'],
      ['방향 적중률', pct0(ev.hit), `늘 ‘오른다’고 찍으면 ${pct0(ev.hit_base)}`],
      ['확률 정확도 개선', (ev.skill * 100).toFixed(1) + '%', '브라이어 점수, 기본 확률 대비'],
      ['추천 55%↑ 날만', fmtP(ev.sig.mean), `${ev.sig.n}회 · ${pct0(ev.sig.win)} 상승 (1회 평균)`],
      ['매일 했다면', fmtP(ev.all.mean), `${ev.all.n}회 · ${pct0(ev.all.win)} 상승 (1회 평균)`],
    ];
    $('evalTiles').innerHTML = tiles.map(([k, v, d]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
    $('calibTbl').innerHTML = `<tr><th>추천 %</th><th class="num">일수</th><th class="num">실제 상승 비율</th><th class="num">평균 결과</th></tr>` +
      ev.buckets.map((b) => `<tr><td>${b.label}</td><td class="num">${b.n}</td><td class="num">${pct0(b.up)}</td><td class="num ${cls(b.mean)}">${fmtP(b.mean)}</td></tr>`).join('');
  }

  // 계수
  const feats = md.features;
  const w = md.w.slice(1);
  $('coefNote').textContent = `표준화 로지스틱 회귀 계수. 빨강 = 이 값이 클수록 다음 날 ${t === 'trade' ? '시가가 매수가보다 높을' : '갭상승할'} 확률↑, 파랑 = 반대.`;
  $('coefBox').style.height = Math.max(150, 30 * feats.length + 40) + 'px';
  const oc = baseOpts();
  oc.indexAxis = 'y';
  oc.scales.y.grid.display = false;
  oc.plugins.tooltip.callbacks = { label: (c) => ` 계수 ${c.parsed.x.toFixed(3)}` };
  mkChart('coefChart', { type: 'bar', data: { labels: feats.map(featLabel), datasets: [{ data: w, backgroundColor: w.map((v) => css(v >= 0 ? '--up' : '--down')), borderRadius: 4, barPercentage: 0.6 }] }, options: oc });

  renderBins();
  renderResearch();

  // 상관 표
  const cr = st.corr[t][m], cd = st.cond[t][m];
  $('corrSub').textContent = `— ${TNAME[t]}, ${st.marks[+m]} 기준 (5분위: 지표가 낮은 20% → 높은 20% 구간별 상승 비율)`;
  const keys = Object.keys(cr).sort((a, b) => Math.abs(cr[b].r || 0) - Math.abs(cr[a].r || 0));
  $('corrTbl').innerHTML = `<tr><th>지표</th><th>특징</th><th class="num">상관 r</th><th class="num">p값</th><th class="num">일수</th><th>의미</th><th class="num">하위 20%</th><th class="num">20~40</th><th class="num">중간</th><th class="num">60~80</th><th class="num">상위 20%</th></tr>` +
    keys.map((k) => {
      const c = cr[k], [s, kind] = k.split('.');
      const sig = !isNum(c.p) ? '' : c.p < 0.01 ? '매우 유의' : c.p < 0.05 ? '유의' : c.p < 0.1 ? '약함' : '없음';
      const inModel = feats.includes(k) ? ' <span class="tag weak">모델</span>' : '';
      return `<tr class="click" data-k="${k}"><td>${SHORT[s]}${inModel}</td><td>${KIND[kind]}</td><td class="num ${cls(c.r)}">${isNum(c.r) ? c.r.toFixed(3) : '–'}</td><td class="num">${isNum(c.p) ? c.p.toFixed(3) : '–'}</td><td class="num">${c.n}</td><td>${sig}</td>` +
        (cd[k] || []).map((b) => `<td class="num">${pct0(b.up)}</td>`).join('') + '</tr>';
    }).join('');
  $('corrTbl').querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => {
    [S.bSeries, S.bKind] = tr.dataset.k.split('.'); $('bSeries').value = S.bSeries; $('bKind').value = S.bKind; renderBins();
  }));
}
function featLabel(f) { const [s, k] = f.split('.'); return `${SHORT[s]} ${KIND[k]}`; }
function renderBins() {
  const st = S.stats, t = S.sTarget, m = String(S.sMark);
  const key = `${S.bSeries}.${S.bKind}`;
  const bins = st.cond[t][m][key];
  if (!bins) {
    $('binTbl').innerHTML = `<tr><td class="muted">${SHORT[S.bSeries]} ${KIND[S.bKind]}: 표본이 부족하거나 해당 없는 조합입니다.</td></tr>`;
    if (charts.binChart) { charts.binChart.destroy(); delete charts.binChart; }
    return;
  }
  const base = st.models[t][m].base;
  const labels = ['하위 20%', '20~40%', '중간', '60~80%', '상위 20%'];
  const o = baseOpts();
  o.scales.y.min = 0; o.scales.y.max = 100;
  o.scales.y.ticks.callback = (v) => v + '%';
  o.plugins.tooltip.callbacks = { label: (c) => ` 다음 날 상승 ${c.parsed.y.toFixed(0)}% (${bins[c.dataIndex].n}일)` };
  o.plugins.hline = { lines: [{ y: base * 100, label: `평균 ${pct0(base)}` }] };
  mkChart('binChart', { type: 'bar', data: { labels, datasets: [{ data: bins.map((b) => +(b.up * 100).toFixed(1)), backgroundColor: css('--s-' + S.bSeries), borderRadius: 4, barPercentage: 0.6 }] }, options: o, plugins: [hline] });
  $('binTbl').innerHTML = `<tr><th>구간</th><th class="num">지표 범위</th><th class="num">일수</th><th class="num">다음 날 상승</th><th class="num">평균 결과</th></tr>` +
    bins.map((b, i) => `<tr><td>${labels[i]}</td><td class="num">${fmtP(b.lo)} ~ ${fmtP(b.hi)}</td><td class="num">${b.n}</td><td class="num">${pct0(b.up)}</td><td class="num ${cls(b.mean)}">${fmtP(b.mean)}</td></tr>`).join('');
}
function renderCoverage() {
  const st = S.stats;
  if (!st || st.empty) return;
  $('covTbl').innerHTML = `<tr><th>지표</th><th>출처</th><th>기준가</th><th class="num">보유 일수</th><th>시작일</th><th class="num">10분 단위 일수</th></tr>` +
    ORDER.map((k) => {
      const m = st.series.find((x) => x.key === k) || {}, c = st.coverage[k] || {};
      return `<tr><td><span class="sw-dot" style="background:${css('--s-' + k)}"></span>${esc(m.name)}</td><td>${esc(m.src)}</td><td>${esc(m.ref)}</td><td class="num">${c.days ?? 0}</td><td>${c.first ?? '–'}</td><td class="num">${c.tenmin ?? 0}</td></tr>`;
    }).join('');
}

/* ───────── 서버 통신 ───────── */
async function loadLiveStatic() {
  const d = S.day || S.index.latest;
  const L = await (await fetch(`data/live/${d}.json`)).json();
  L.days = S.index.days; L.series = S.index.series;
  if (!S.day) {
    L.message = `공개 웹판 — ${S.index.generated.replace('T', ' ').slice(0, 16)}에 올린 스냅샷입니다. 실시간 확률(1분 갱신)은 집 PC에서 실행.bat으로 여는 앱에서만 됩니다(한국투자증권 API 키가 필요해 공개 웹에는 넣지 않음).`;
    L.state = 'replay';
  }
  S.live = L;
  renderLive();
}
async function loadLive(refresh) {
  if (STATIC) return loadLiveStatic().catch(() => { $('banner').textContent = '데이터를 불러오지 못했습니다.'; });
  const q = S.day ? `?date=${S.day}` : refresh ? '?refresh=1' : '';
  const b = $('btnRefresh');
  b.disabled = true; b.textContent = '갱신 중…';
  try {
    const r = await fetch('/api/live' + q);
    const L = await r.json();
    if (L.empty) { $('banner').textContent = '처음 실행이라 과거 데이터를 모으고 통계를 계산하는 중입니다(2~3분).'; pollJob(); return; }
    S.live = L;
    renderLive();
    if (L.job && L.job.running) pollJob();
  } catch (e) {
    $('banner').textContent = '서버에 연결할 수 없습니다. 실행.bat 창이 켜져 있는지 확인하세요.';
  } finally {
    b.disabled = false; b.textContent = '지금 갱신';
    scheduleNext();
  }
}
async function loadResearch() {
  try {
    const r = await (await fetch(STATIC ? 'data/research.json' : '/api/research')).json();
    if (!r.empty) S.research = r;
  } catch { /* 연구 결과 없음 */ }
}
function renderResearch() {
  const R = S.research, box = $('researchBody');
  if (!R) { box.innerHTML = '<p class="muted">연구 결과 파일이 없습니다(python research.py).</p>'; return; }
  const t = S.sTarget, r = R[t];
  const tn = t === 'trade' ? '19:50 매수 → 익일 08:00 시가' : '익일 08:00 시가의 KRX 종가 대비 갭';
  const f2 = (x) => (isNum(x) ? x.toFixed(3) : '–');
  const verdict = (u) => {
    const a = isNum(u.p) && u.p < 0.05, b = isNum(u.p_hold) && u.p_hold < 0.05, same = Math.sign(u.r || 0) === Math.sign(u.r_hold || 0);
    if (a && b && same) return '<span class="tag good">두 기간 모두 유의</span>';
    if ((a || b) && !same) return '<span class="tag weak">방향 뒤집힘</span>';
    if (a || b) return '<span class="tag weak">한 기간만</span>';
    return '<span class="muted">없음</span>';
  };
  const uni = r.univariate.slice().sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const h = r.holdout, dc = r.dev_compare;
  let html = `<p class="small">대상: <b>${tn}</b> · 6월 전 ${r.n_dev}일로 고르고, 6월 후 ${r.n_hold}일로 한 번만 시험(${R.generated ? R.generated.slice(0, 10) : ''}).</p>`;
  html += `<h3>최종 시험 결과(6월 이후, 학습·선택에 쓰지 않은 기간)</h3><div class="tbl-wrap"><table class="tbl"><tr><th>방식</th><th class="num">AUC (90% 범위)</th><th class="num">방향 적중</th><th class="num">추천 60%↑ 날</th><th class="num">매일</th></tr>` +
    Object.entries(h).map(([k, v]) => `<tr><td>${esc(k)}${k === r.chosen ? ' <span class="tag weak">개발 구간 1위</span>' : ''}</td><td class="num">${f2(v.auc)} (${v.auc_90ci ? v.auc_90ci.map((x) => x.toFixed(2)).join('~') : '–'})</td><td class="num">${pct0(v.hit)} <span class="muted tiny">기본 ${pct0(v.base_up)}</span></td><td class="num">${v.sig60.n}회 · ${pct0(v.sig60.win)} ${isNum(v.sig60.mean) ? fmtP(v.sig60.mean) : ''}</td><td class="num">${pct0(v.base_up)} ${fmtP(v.mean_all)}</td></tr>`).join('') + '</table></div>';
  html += `<h3>모델 비교(6월 전 개발 구간 워크포워드)</h3><div class="tbl-wrap"><table class="tbl"><tr><th>방식</th><th class="num">지표 수</th><th class="num">AUC</th><th class="num">방향 적중</th><th class="num">추천 60%↑ 날</th></tr>` +
    Object.entries(dc).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.features.length}</td><td class="num">${f2(v.auc)}</td><td class="num">${pct0(v.hit)}</td><td class="num">${v.sig60.n}회 · ${pct0(v.sig60.win)}</td></tr>`).join('') + '</table></div>';
  html += `<h3>지표 ${uni.length}개 하나씩 — 6월 전과 6월 후에 같은 방향으로 유의했는가</h3><div class="tbl-wrap"><table class="tbl"><tr><th>지표</th><th>묶음</th><th class="num">6월 전 r (p)</th><th class="num">6월 후 r (p)</th><th>판정</th></tr>` +
    uni.map((u) => `<tr><td>${esc(u.label)}</td><td class="muted">${esc(u.group)}</td><td class="num ${cls(u.r)}">${f2(u.r)} <span class="muted tiny">(${isNum(u.p) ? u.p.toFixed(2) : '–'})</span></td><td class="num ${cls(u.r_hold)}">${f2(u.r_hold)} <span class="muted tiny">(${isNum(u.p_hold) ? u.p_hold.toFixed(2) : '–'})</span></td><td>${verdict(u)}</td></tr>`).join('') + '</table></div>';
  if (R.trade.timing) {
    const tt = (rows) => rows.map((x) => `<tr><td>${esc(x.label)}</td>` + ['all', 'dev', 'hold'].map((k) => `<td class="num ${cls(x[k].mean)}">${fmtP(x[k].mean)} <span class="muted tiny">· ${pct0(x[k].win)}</span></td>`).join('') + '</tr>').join('');
    const head = '<tr><th></th><th class="num">전체 (평균 · 상승 비율)</th><th class="num">6월 전</th><th class="num">6월 후</th></tr>';
    html += `<h3>매수 시각별 → 익일 08:00 시가 매도</h3><div class="tbl-wrap"><table class="tbl">${head}${tt(R.trade.timing.buy)}</table></div>`;
    html += `<h3>19:50 매수 → 매도 시각별</h3><div class="tbl-wrap"><table class="tbl">${head}${tt(R.trade.timing.sell)}</table></div>`;
  }
  box.innerHTML = html;
}
async function loadStats() {
  try {
    S.stats = await (await fetch(STATIC ? 'data/stats.json' : '/api/stats')).json();
    renderCoverage();
    if (S.tab === 'stats') renderStats();
  } catch { /* 다음 시도 */ }
}
let jobTimer = null;
async function pollJob() {
  clearTimeout(jobTimer);
  try {
    const s = await (await fetch('/api/status')).json();
    if (s.running) {
      const last = (s.log[s.log.length - 1] || '').replace(/^\[.*?\]\s*/, '');
      $('status').textContent = '수집·통계 계산 중… ' + last;
      if (!STATIC) {
        const prev = S.live && S.live.data_update ? S.live.data_update.replace('T', ' ').slice(0, 16) : '–';
        $('banner').dataset.state = 'live';
        $('banner').textContent = `밀린 데이터를 받아 통계를 갱신하는 중입니다(마지막 수집 ${prev}). 끝나면 자동으로 새 통계로 바뀝니다.
진행: ${last}`;
      }
      jobTimer = setTimeout(pollJob, 3000);
    } else {
      if (s.error) $('banner').textContent = '수집 오류: ' + s.error;
      await loadStats();
      await loadLive();
    }
  } catch { jobTimer = setTimeout(pollJob, 5000); }
}

/* 자동 갱신: 오늘 화면 + 평일 14:50~20:10은 1분마다, 그 외에는 10분마다 상태만 */
function kstNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })); }
function inWindow() { const n = kstNow(), hm = n.getHours() * 60 + n.getMinutes(); return n.getDay() >= 1 && n.getDay() <= 5 && hm >= 14 * 60 + 50 && hm <= 20 * 60 + 10; }
let liveTimer = null;
function scheduleNext() {
  clearTimeout(liveTimer);
  if (!$('auto').checked || S.day) { S.nextAt = 0; updateStatus(); return; }
  const ms = inWindow() ? 60 * 1000 : 10 * 60 * 1000;
  S.nextAt = Date.now() + ms;
  liveTimer = setTimeout(() => loadLive(), ms);
}
function updateStatus() {
  const L = S.live;
  if (!L) return;
  if (STATIC) { $('status').textContent = `게시 ${S.index.generated.replace('T', ' ').slice(5, 16)}`; return; }
  const upd = L.data_update ? L.data_update.slice(11, 19) : '–';
  const nx = S.nextAt ? ` · 다음 갱신 ${Math.max(0, Math.round((S.nextAt - Date.now()) / 1000))}초` : '';
  if (!$('status').textContent.startsWith('수집')) $('status').textContent = `시세 ${upd}${nx}`;
}
setInterval(updateStatus, 1000);

/* ───────── 이벤트 ───────── */
function wire() {
  $('tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    S.tab = b.dataset.tab;
    $('tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    $('tab-live').hidden = S.tab !== 'live'; $('tab-stats').hidden = S.tab !== 'stats';
    if (S.tab === 'stats') renderStats(); else renderLive();
  }));
  $('daySel').addEventListener('change', (e) => { S.day = e.target.value; loadLive(); });
  $('btnRefresh').addEventListener('click', () => loadLive(true));
  $('auto').checked = store.get('auto') !== false;
  $('auto').addEventListener('change', (e) => { store.set('auto', e.target.checked); scheduleNext(); });
  $('viewSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    S.view = b.dataset.v;
    $('viewSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderFlow(S.live);
  }));
  $('sTarget').addEventListener('change', (e) => { S.sTarget = e.target.value; renderStats(); });
  $('sMark').addEventListener('change', (e) => { S.sMark = +e.target.value; renderStats(); });
  $('bSeries').addEventListener('change', (e) => { S.bSeries = e.target.value; renderBins(); });
  $('bKind').addEventListener('change', (e) => { S.bKind = e.target.value; renderBins(); });
  $('btnPublish').addEventListener('click', async () => {
    if (!confirm('지금 통계와 날짜별 기록을 공개 웹(gilstory.github.io/hynix)에 올릴까요? 누구나 볼 수 있는 주소입니다.')) return;
    const r = await (await fetch('/api/publish', { method: 'POST' })).json();
    $('status').textContent = r.started ? '웹판 만드는 중…' : '다른 작업이 진행 중입니다';
    pollJob();
  });
  $('btnRebuild').addEventListener('click', async () => {
    const r = await (await fetch('/api/update', { method: 'POST' })).json();
    $('status').textContent = r.started ? '수집·통계 계산 시작…' : '이미 진행 중입니다';
    pollJob();
  });
}

(async function init() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  wire();
  if (STATIC) {
    for (const id of ['btnRefresh', 'btnRebuild', 'btnPublish']) { const el = $(id); if (el) el.hidden = true; }
    $('auto').closest('label').hidden = true;
    S.index = await (await fetch('data/index.json')).json();
    await loadResearch();
    await loadStats();
    await loadLive();
    return;
  }
  await loadResearch();
  await loadStats();
  await loadLive();
  try {
    const s = await (await fetch('/api/status')).json();
    if (s.running) pollJob();
  } catch { /* 서버 연결 실패는 loadLive에서 안내 */ }
})();
