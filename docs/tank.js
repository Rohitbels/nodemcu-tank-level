/*
 * Water tank display.
 *
 * Loaded by the small page the NodeMCU serves at "/". The NodeMCU only measures:
 * GET /api pings the sensor and returns { "d": <cm from sensor to water> } (d is null when there is no echo).
 * This file polls every 3 s, stores each reading in localStorage, and draws the tank:
 * green while the water is further below the sensor than CONFIG.redCm, red once it is that close.
 * Fill % is the water level as a share of the whole tank depth, and the red line's % comes from the same formula.
 * The History tab charts those stored readings per day and copies them as CSV.
 * Settings (theme, tank depth, tank diameter) are kept in localStorage. Levels are worked out from d when shown, so a new depth also applies to past days.
 *
 * GitHub Pages serves this file with max-age=600, so phones pick up a change within 10 minutes of it
 * going live, on their next page load. Bumping ?v= in the NodeMCU page skips that wait but needs a re-flash.
 */
(function () {
  'use strict';
  if (window.tankApp) return;
  window.tankApp = true;

  const CONFIG = {
    api: '/api',
    pollMs: 3000,
    tankCm: 70,   // probe face to tank floor; the default until Settings changes it
    tankMaxCm: 500,
    diameterMinCm: 10,
    diameterMaxCm: 1000,
    minUsableCm: 5, // smallest gap allowed between the red line and the tank floor
    pctStep: 25,   // spacing of the % marks on the gauge and chart
    redCm: 25,    // red when the water is this close to the probe or closer
    retainDays: 7,
    gapMin: 2     // a break longer than this many minutes shows as a gap in the chart
  };
  CONFIG.tankMinCm = CONFIG.redCm + CONFIG.minUsableCm;

  // ---------- Formulas: everything shown on the page comes from these ----------

  const FULL_PCT = 100;
  const round1 = n => Math.round(n * 10) / 10;
  const usableCm = () => CONFIG.tankCm - CONFIG.redCm;  // water depth at the red line
  const levelOf = d => Math.min(CONFIG.tankCm, Math.max(0, CONFIG.tankCm - d));  // cm above the floor
  const pctOf = d => levelOf(d) / CONFIG.tankCm * FULL_PCT;  // 100% is the whole tank
  const redPct = () => pctOf(CONFIG.redCm);  // where the red line falls on that scale
  const pctText = pct => Math.round(pct) + '%';
  const CM3_PER_LITRE = 1000;
  // Assumes a round tank with straight sides
  const litresAt = levelCm => Math.PI * (settings.diameterCm / 2) ** 2 * levelCm / CM3_PER_LITRE;
  const litresText = levelCm => Math.round(litresAt(levelCm)).toLocaleString() + ' L';
  function pctTicks() {
    const ticks = [];
    for (let pct = 0; pct <= FULL_PCT; pct += CONFIG.pctStep) ticks.push(pct);
    return ticks;
  }

  // ---------- Storage: one localStorage key per day, each an array of [time ms, d cm or null] ----------

  const PREFIX = 'tank.day.';
  const pad = n => String(n).padStart(2, '0');
  const dayKey = t => {
    const d = new Date(t);
    return PREFIX + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  function loadDay(key) {
    try {
      const list = JSON.parse(localStorage.getItem(key));
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function storedDays() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
      }
    } catch (e) { /* storage unavailable */ }
    return keys.sort(); // YYYY-MM-DD sorts oldest first
  }

  function pruneOldDays() {
    const oldest = dayKey(Date.now() - CONFIG.retainDays * 86400000);
    storedDays().forEach(k => {
      if (k < oldest) {
        try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
      }
    });
  }

  let today = { key: dayKey(Date.now()), list: loadDay(dayKey(Date.now())) };

  function record(reading) {
    const key = dayKey(reading[0]);
    if (key !== today.key) {
      today = { key: key, list: loadDay(key) };
      pruneOldDays();
    }
    today.list.push(reading);
    const json = JSON.stringify(today.list);
    try {
      localStorage.setItem(key, json);
    } catch (e) {
      // Storage full: drop the oldest other day and try once more
      const old = storedDays().filter(k => k !== key)[0];
      try {
        if (old) localStorage.removeItem(old);
        localStorage.setItem(key, json);
      } catch (e2) { /* keep going without saving */ }
    }
  }

  // ---------- Settings: one localStorage record, on this device only ----------

  const SETTINGS_KEY = 'tank.settings';
  const settings = { theme: 'system', tankCm: null, diameterCm: null }; // null: not set by the user
  const validTank = cm => Number.isFinite(cm) && cm >= CONFIG.tankMinCm && cm <= CONFIG.tankMaxCm;
  const validDiameter = cm => Number.isFinite(cm) && cm >= CONFIG.diameterMinCm && cm <= CONFIG.diameterMaxCm;

  function readSaved() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function loadSettings() {
    const saved = readSaved();
    if (['system', 'light', 'dark'].includes(saved.theme)) settings.theme = saved.theme;
    if (validTank(saved.tankCm)) settings.tankCm = CONFIG.tankCm = saved.tankCm;
    if (validDiameter(saved.diameterCm)) settings.diameterCm = saved.diameterCm;
  }

  // Reads the record back, so a browser that ignores the write counts as a failure
  function saveSettings() {
    const json = JSON.stringify(settings);
    try {
      localStorage.setItem(SETTINGS_KEY, json);
      return localStorage.getItem(SETTINGS_KEY) === json;
    } catch (e) {
      return false;
    }
  }

  // False on a first visit and when the browser has lost the settings: the two look identical
  const tankSaved = () => validTank(readSaved().tankCm);

  // ---------- UI ----------

  const DARK = `
    --bg: #0a1217; --panel: #111c23; --fg: #e3ecf1; --muted: #8ea1ab; --line: #22323b; --tank: #15232b;
    --water: #3a95db; --water-top: #69b4ec; --red: #ff5b4d; --red-tint: rgba(255,91,77,.14); --green: #3cc07a; --off: #6c7c85;
    --on-state: #0a1217; color-scheme: dark;`;

  const CSS = `
:root {
  color-scheme: light; --on-state: #ffffff;
  --bg: #eef3f6; --panel: #ffffff; --fg: #0f1c24; --muted: #5b6b75; --line: #d3dde3; --tank: #e3ebf0;
  --water: #2f86c9; --water-top: #5aa6df; --red: #d33a2e; --red-tint: rgba(211,58,46,.10); --green: #23905a; --off: #8a979f;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { ${DARK} }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; text-align: left; background: var(--bg); color: var(--fg); font: 15px/1.45 var(--font);
  padding: 0 max(16px, env(safe-area-inset-right, 0px)) calc(16px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); }
body[data-tab="History"], body[data-tab="Settings"] { padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)); } /* room to scroll clear of the floating indicator */
button { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
main { flex: 1; display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 860px; margin: 0 auto; }
.num { font-variant-numeric: tabular-nums; }
header { position: sticky; top: 0; z-index: 6; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: max(8px, env(safe-area-inset-top, 0px)) 0 8px; background: var(--bg); }
.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--off); }
.nav { flex: none; display: flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--tank); }
.nav button { display: grid; place-items: center; min-width: 44px; min-height: 44px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--muted); font: 600 14px var(--font); cursor: pointer; }
.nav #tabToday { padding: 0 10px; }
.nav button[aria-selected="true"] { background: var(--panel); color: var(--fg); box-shadow: 0 0 0 1px var(--line); }
h1 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; white-space: nowrap; }
.fab { position: fixed; z-index: 5; right: max(16px, env(safe-area-inset-right, 0px)); bottom: max(16px, env(safe-area-inset-bottom, 0px));
  display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; background: var(--state, var(--off)); color: var(--on-state);
  font: 700 19px var(--font); box-shadow: 0 4px 14px rgba(0,0,0,.3); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
body[data-state="green"] { --state: var(--green); }
body[data-state="red"] { --state: var(--red); }
body[data-state="off"] { --state: var(--off); }
body[data-state="red"] .fab { animation: tank-pulse 1s ease-out infinite; }
@keyframes tank-pulse { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--red) 60%, transparent); } to { box-shadow: 0 0 0 16px transparent; } }
/* Today fills the screen: the top card keeps its height and the tank card takes the rest, down to a 290px minimum that keeps
   the gauge labels readable. Only below that does the page scroll. */
.cols { flex: 1 1 auto; display: grid; grid-template-rows: auto minmax(290px,1fr); gap: 14px; }
@media (min-width: 680px) {
  .cols { grid-template-columns: minmax(0,1fr) minmax(0,1fr); grid-template-rows: minmax(290px,1fr); align-items: start; max-height: 760px; }
  h1 { font-size: 22px; }
  .gauge { order: -1; align-self: stretch; }
  .hist dl div { padding: 10px 12px; }
  .hist dd { font-size: 18px; }
}
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; min-width: 0; }
/* Taken out of the flow so the drawing scales to its card instead of setting the card's height */
.gauge { position: relative; }
.gauge svg { position: absolute; top: 14px; left: 14px; width: calc(100% - 28px); height: calc(100% - 28px); }
.gauge .t, .gauge .tl { font-size: 13px; }
.t { fill: var(--muted); font: 11px var(--mono); }
.tl { font: 600 11.5px var(--font); }
.tank-bg { fill: var(--tank); }
.tank-wall { fill: none; stroke: var(--fg); stroke-width: 2.5; }
.tick { stroke: var(--muted); stroke-width: 1; }
.zone-red { fill: var(--red-tint); }
.line-red { stroke: var(--red); stroke-width: 2; }
.lbl-red { fill: var(--red); }
.probe { fill: var(--fg); }
#water { transition: transform .8s ease; }
.water { fill: var(--water); }
.wave { fill: var(--water-top); animation: tank-wave 3s linear infinite; }
@keyframes tank-wave { to { transform: translateX(-65px); } }
.level-tag { fill: var(--fg); font: 700 17px var(--font); }
.big { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.big strong { font-size: 44px; line-height: 1; font-weight: 700; }
.big span { color: var(--muted); }
dl { margin: 14px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
dl div { background: var(--panel); padding: 10px 12px; }
dt { font-size: 12px; color: var(--muted); }
dd { margin: 2px 0 0; font-size: 18px; font-weight: 600; }
.foot { color: var(--muted); font-size: 12.5px; margin: 12px 0 0; }
.hist { display: grid; gap: 12px; }
.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: var(--tank); }
.tabs button { font: 600 14px var(--font); min-height: 44px; border: 0; border-radius: 9px; background: transparent; color: var(--muted); cursor: pointer; }
.tabs button[aria-pressed="true"] { background: var(--panel); color: var(--fg); box-shadow: 0 0 0 1px var(--line); }
.tabs.three { grid-template-columns: repeat(3, 1fr); }
.settings { display: grid; gap: 20px; }
.notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 14px; border-radius: 14px; background: var(--red-tint); border: 1px solid var(--red); }
.notice p { flex: 1 1 180px; margin: 0; font-size: 14px; }
.field { display: grid; gap: 8px; }
.field-name { font-weight: 600; }
.field p { margin: 0; color: var(--muted); font-size: 13px; }
.field-row { display: flex; align-items: center; gap: 8px; }
.field-row input { flex: 1; min-width: 0; min-height: 44px; padding: 0 12px; font: 16px var(--font); color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; }
.field-row span { color: var(--muted); }
#tankForm { gap: 16px; }
#tankForm .copy { justify-self: start; }
.settings .foot { margin: 0; }
.hist-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.hist-actions span { color: var(--muted); font-size: 12.5px; }
.copy { font: 600 14px var(--font); min-height: 44px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
.days { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 4px; }
.days button { font: 11px/1.25 var(--font); min-height: 44px; padding: 4px 0; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
.days button b { display: block; font-size: 14px; font-weight: 600; }
@media (min-width: 360px) { .days button { font-size: 12px; } }
.days button.none { color: var(--muted); }
.days button[aria-pressed="true"] { background: var(--fg); border-color: var(--fg); color: var(--panel); }
.day-name { margin: 0; font-weight: 600; }
.chart { position: relative; touch-action: pan-y; }
.chart svg { display: block; width: 100%; height: 220px; }
.grid { stroke: var(--line); stroke-width: 1; }
.gap { fill: var(--tank); }
.hline { fill: none; stroke: var(--water); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.hdot { fill: var(--water); }
.halo { paint-order: stroke; stroke: var(--panel); stroke-width: 3px; }
.cross { stroke: var(--muted); stroke-width: 1; }
.hmark { fill: var(--water); stroke: var(--panel); stroke-width: 2; }
.tip { position: absolute; top: 4px; left: 0; pointer-events: none; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--muted); font-size: 12px; white-space: nowrap; }
.tip strong { color: var(--fg); font-size: 14px; }
.hist dl { margin: 0; grid-template-columns: repeat(3, minmax(0,1fr)); }
.hist dl div { padding: 10px; }
.hist dd { font-size: 16px; }
.hist .foot { margin: 0; }
#copyBox { width: 100%; height: 120px; font: 16px var(--mono); color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; }
@media (prefers-reduced-motion: reduce) { .wave, body[data-state="red"] .fab { animation: none; } #water { transition: none; } }
`;

  const TOP = 40, BOTTOM = 390;
  const px = () => (BOTTOM - TOP) / CONFIG.tankCm;
  const yOf = levelCm => BOTTOM - levelCm * px();

  function buildSvg() {
    const yRed = yOf(usableCm());
    let ticks = '';
    pctTicks().forEach(pct => {
      const y = yOf(pct / FULL_PCT * CONFIG.tankCm);
      ticks += `<line class="tick" x1="58" y1="${y}" x2="68" y2="${y}"/>` +
        `<text class="t num" x="52" y="${y + 4}" text-anchor="end">${pct}%</text>`;
    });
    let wave = 'M5 46';
    for (let i = 0; i < 8; i++) wave += ' q16.25 -6 32.5 0';
    return `
<svg viewBox="0 0 300 420" role="img" aria-label="Tank gauge with the water level and the red line at ${pctText(redPct())}, ${CONFIG.redCm} cm below the sensor">
  <defs><clipPath id="inside"><rect x="70" y="${TOP}" width="130" height="${BOTTOM - TOP}" rx="6"/></clipPath></defs>
  <rect class="tank-bg" x="70" y="${TOP}" width="130" height="${BOTTOM - TOP}" rx="6"/>
  <g clip-path="url(#inside)">
    <rect class="zone-red" x="70" y="${TOP}" width="130" height="${yRed - TOP}"/>
    <g id="water">
      <path class="wave" d="${wave} V60 H5 Z"/>
      <rect class="water" x="70" y="46" width="130" height="${BOTTOM - TOP}"/>
    </g>
    <line class="line-red" x1="70" y1="${yRed}" x2="200" y2="${yRed}"/>
  </g>
  <rect class="tank-wall" x="70" y="${TOP}" width="130" height="${BOTTOM - TOP}" rx="6"/>
  <rect class="probe" x="125" y="24" width="20" height="16" rx="3"/>
  <text class="t" x="150" y="20" text-anchor="middle">sensor</text>
  ${ticks}
  <text class="tl lbl-red" x="208" y="${yRed - 3}">red above</text>
  <text class="t lbl-red" x="208" y="${yRed + 11}">${pctText(redPct())}</text>
  <text class="level-tag num" id="levelTag" x="135" y="380" text-anchor="middle"></text>
</svg>`;
  }

  function buildPage() {
    if (window.fallbackTimer) clearInterval(window.fallbackTimer);
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.body.removeAttribute('style');
    document.body.innerHTML = `
<main>
  <header>
    <h1>Water tank <span class="dot" id="conn" role="img" aria-label="Connecting" title="Connecting"></span></h1>
    <nav class="nav" id="tabs" role="tablist" aria-label="View">
      <button type="button" role="tab" id="tabToday" aria-controls="panelToday" aria-selected="true">Today</button>
      <button type="button" role="tab" id="tabHistory" aria-controls="panelHistory" aria-selected="false" aria-label="History" title="History" tabindex="-1"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/></svg></button>
      <button type="button" role="tab" id="tabSettings" aria-controls="panelSettings" aria-selected="false" aria-label="Settings" title="Settings" tabindex="-1"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
    </nav>
  </header>
  <section class="notice" id="notice" hidden>
    <p>Tank size isn't saved on this phone. Levels are using a ${CONFIG.tankCm} cm tank and may be wrong.</p>
    <button class="copy" id="noticeSet" type="button">Set tank size</button>
  </section>
  <div class="cols" id="panelToday" role="tabpanel" aria-labelledby="tabToday">
    <section class="card">
      <div class="big"><strong class="num" id="levelBig">--</strong><span>full</span></div>
      <dl>
        <div><dt id="availLabel">Water available</dt><dd class="num" id="waterAvail">--</dd></div>
        <div><dt>Gap to sensor</dt><dd class="num" id="gap">--</dd></div>
      </dl>
      <p class="foot num" id="updated">No reading yet</p>
    </section>
    <section class="card gauge" id="gauge">${buildSvg()}</section>
  </div>
  <section class="card hist" id="panelHistory" role="tabpanel" aria-labelledby="tabHistory" hidden>
    <div class="days" id="days"></div>
    <p class="day-name" id="dayName"></p>
    <div class="chart" id="chart"></div>
    <dl>
      <div><dt>Highest</dt><dd class="num" id="dayHigh">--</dd></div>
      <div><dt>Lowest</dt><dd class="num" id="dayLow">--</dd></div>
      <div><dt>Readings</dt><dd class="num" id="dayCount">--</dd></div>
    </dl>
    <p class="foot" id="histNote"></p>
    <div class="hist-actions"><button class="copy" id="copy" type="button">Copy Data</button><span id="copyMsg" aria-live="polite"></span></div>
    <textarea id="copyBox" readonly hidden aria-label="History data as CSV"></textarea>
  </section>
  <section class="card settings" id="panelSettings" role="tabpanel" aria-labelledby="tabSettings" hidden>
    <div class="field">
      <span class="field-name" id="themeName">Appearance</span>
      <div class="tabs three" id="themes" role="group" aria-labelledby="themeName">
        <button type="button" data-theme-choice="system">System</button>
        <button type="button" data-theme-choice="light">Light</button>
        <button type="button" data-theme-choice="dark">Dark</button>
      </div>
    </div>
    <form class="field" id="tankForm" novalidate>
      <div class="field">
      <label class="field-name" for="tankInput">Tank depth</label>
      <p>Distance from the sensor down to the tank floor. The red line stays ${CONFIG.redCm} cm below the sensor, and its % updates to match. Past days update too.</p>
      <div class="field-row">
        <input id="tankInput" type="number" inputmode="decimal" min="${CONFIG.tankMinCm}" max="${CONFIG.tankMaxCm}" step="any" aria-describedby="tankMsg">
        <span>cm</span>
      </div>
      </div>
      <div class="field">
        <label class="field-name" for="tankDiameter">Tank diameter (optional)</label>
        <p>Inside width of a round tank, used to show litres. Leave blank to show water in cm.</p>
        <div class="field-row">
          <input id="tankDiameter" type="number" inputmode="decimal" min="${CONFIG.diameterMinCm}" max="${CONFIG.diameterMaxCm}" step="any" aria-describedby="tankMsg">
          <span>cm</span>
        </div>
      </div>
      <button class="copy" type="submit">Save</button>
      <p id="tankMsg" aria-live="polite"></p>
    </form>
    <p class="foot">Settings are saved on this phone only.</p>
  </section>
  <div class="fab" role="status"><span id="fabLabel" aria-hidden="true">--</span><span class="sr" id="fabInfo">Waiting for sensor</span></div>
</main>`;
  }

  const $ = id => document.getElementById(id);
  let lastOk = 0, failures = 0, lastD = null;

  function setConn(text, color) {
    const dot = $('conn');
    dot.title = text;
    dot.setAttribute('aria-label', text);
    dot.style.background = `var(--${color})`;
  }

  // label is what the floating indicator shows; info is read out by screen readers
  function setStatus(state, label, info) {
    document.body.dataset.state = state;
    $('fabLabel').textContent = label;
    $('fabInfo').textContent = info;
  }

  function render(d) {
    const offline = failures >= 2;
    setConn(offline ? 'Offline' : 'Live', offline ? 'red' : 'green');

    if (offline) {
      setStatus('off', '--', 'NodeMCU not responding. Check that the board is powered and the phone is on the same Wi-Fi.');
      return;
    }
    if (d === undefined) return;
    if (d === null) {
      setConn('No echo from the sensor', 'red');
      setStatus('off', '--', 'No echo from the sensor. Check the tank and the probe cable.');
      return;
    }

    lastD = d;
    drawLevel(d);

    if (d <= CONFIG.redCm) {
      setStatus('red', 'OFF', 'Stop the motor. Water is within ' + CONFIG.redCm + ' cm of the sensor.');
    } else {
      setStatus('green', 'OK', 'OK. Water is more than ' + CONFIG.redCm + ' cm below the sensor.');
    }
  }

  function drawLevel(d) {
    const level = levelOf(d);
    $('water').style.transform = `translateY(${(CONFIG.tankCm - level) * px()}px)`;
    const pct = pctText(pctOf(d));
    $('levelTag').setAttribute('y', Math.min(BOTTOM - 8, Math.max(TOP + 30, yOf(level) + 22)));
    $('levelTag').textContent = pct;
    $('levelBig').textContent = pct;
    $('availLabel').textContent = settings.diameterCm ? 'Water available' : 'Water available up to';
    $('waterAvail').textContent = settings.diameterCm ? litresText(level) : level.toFixed(1) + ' cm';
    $('gap').textContent = d.toFixed(1) + ' cm';
  }

  // ---------- History: a day of readings reduced to one point per minute ----------

  const MINUTE = 60000;
  const CHART = { h: 220, left: 36, right: 8, top: 10, bottom: 22 };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let selected = null;  // day key the user picked; null follows today
  let view = null;      // what the chart is showing
  let daysHtml = '';
  let chartWidth = 0;

  function dayBounds(key) {
    const [y, m, d] = key.slice(PREFIX.length).split('-').map(Number);
    return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() };
  }

  function median(values) {
    const v = values.slice().sort((a, b) => a - b), mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  const readingsFor = key => key === today.key ? today.list : loadDay(key);

  // One entry per minute that has readings. d and pct are null when every reading in it was a no-echo.
  // The median keeps a single bad echo from showing up as a spike.
  function minutesOf(list, start) {
    const buckets = new Map();
    list.forEach(r => {
      const min = Math.floor((r[0] - start) / MINUTE);
      if (!buckets.has(min)) buckets.set(min, { ds: [], noEcho: 0 });
      if (r[1] == null) buckets.get(min).noEcho++;
      else buckets.get(min).ds.push(r[1]);
    });
    return [...buckets.keys()].sort((a, b) => a - b).map(min => {
      const b = buckets.get(min);
      const d = b.ds.length ? round1(median(b.ds)) : null;
      return { min, d, pct: d == null ? null : round1(pctOf(d)), readings: b.ds.length, noEcho: b.noEcho };
    });
  }

  function lastDays() {
    const now = new Date(), keys = [];
    for (let i = CONFIG.retainDays - 1; i >= 0; i--) {
      keys.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).getTime()));
    }
    return keys;
  }

  function renderDays(keys, shownKey) {
    const stored = new Set(storedDays());
    const todayKey = keys[keys.length - 1];
    const html = keys.map(key => {
      const date = new Date(dayBounds(key).start);
      const name = key === todayKey ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' });
      const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      return `<button type="button" data-day="${key}" aria-label="${label}" aria-pressed="${key === shownKey}"` +
        `${stored.has(key) ? '' : ' class="none"'}>${name}<b class="num">${date.getDate()}</b></button>`;
    }).join('');
    if (html !== daysHtml) $('days').innerHTML = daysHtml = html;
  }

  const timeOf = ms => {
    const d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  function loadView() {
    const keys = lastDays();
    const todayKey = keys[keys.length - 1];
    if (selected && !keys.includes(selected)) selected = null;
    const key = selected || todayKey;
    const { start, end } = dayBounds(key);
    const minutes = minutesOf(readingsFor(key), start);
    view = {
      key, start, end, todayKey,
      total: (end - start) / MINUTE,
      // Today's chart stops at the current minute: the rest of the day isn't a gap, it hasn't happened yet
      until: key === todayKey ? Math.floor((Date.now() - start) / MINUTE) : (end - start) / MINUTE,
      points: minutes.filter(m => m.pct != null),
      noEcho: minutes.reduce((n, m) => n + m.noEcho, 0),
      drawnAt: Date.now()
    };
    renderDays(keys, key);
  }

  const chartY = pct => CHART.top + (1 - pct / FULL_PCT) * (CHART.h - CHART.top - CHART.bottom);

  function drawChart() {
    const box = $('chart');
    const w = chartWidth = box.clientWidth || 320;
    const { left, right, top, bottom, h } = CHART;
    const { points, total, until, start } = view;
    const x = min => left + min / total * (w - left - right);
    const y = chartY;
    const plotBottom = h - bottom;
    let out = '';

    if (points.length) { // shaded bands where nothing was recorded
      const band = (a, b) => {
        if (b - a > CONFIG.gapMin) out += `<rect class="gap" x="${x(a).toFixed(1)}" y="${top}" width="${(x(b) - x(a)).toFixed(1)}" height="${plotBottom - top}"/>`;
      };
      band(0, points[0].min);
      points.forEach((p, i) => { if (i) band(points[i - 1].min, p.min); });
      band(points[points.length - 1].min, until);
    }

    pctTicks().forEach(pct => {
      out += `<line class="grid" x1="${left}" y1="${y(pct)}" x2="${w - right}" y2="${y(pct)}"/>` +
        `<text class="t num" x="${left - 6}" y="${y(pct) + 4}" text-anchor="end">${pct}%</text>`;
    });
    for (let hour = 0; hour <= 24; hour += 6) {
      const d = new Date(start);
      d.setHours(hour, 0, 0, 0);
      const anchor = hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle';
      out += `<text class="t num" x="${x((d.getTime() - start) / MINUTE).toFixed(1)}" y="${h - 6}" text-anchor="${anchor}">${pad(hour)}:00</text>`;
    }

    // Split the line wherever there is a gap; a minute with no neighbours is drawn as a dot
    let path = '', dots = '';
    points.forEach((p, i) => {
      const joined = i > 0 && p.min - points[i - 1].min <= CONFIG.gapMin;
      const next = points[i + 1];
      const alone = !joined && !(next && next.min - p.min <= CONFIG.gapMin);
      const px = x(p.min).toFixed(1), py = y(p.pct).toFixed(1);
      if (alone) dots += `<circle class="hdot" cx="${px}" cy="${py}" r="2"/>`;
      else path += (joined ? 'L' : 'M') + px + ' ' + py;
    });
    out += `<path class="hline" d="${path}"/>${dots}`;

    out += `<line class="line-red" x1="${left}" y1="${y(redPct())}" x2="${w - right}" y2="${y(redPct())}"/>` +
      `<text class="t lbl-red halo" x="${w - right - 2}" y="${y(redPct()) - 5}" text-anchor="end">red ${pctText(redPct())}</text>`;
    if (!points.length) {
      out += `<text class="t" x="${(left + w - right) / 2}" y="${(top + plotBottom) / 2 + 28}" text-anchor="middle">No readings this day</text>`;
    }
    out += `<line class="cross" id="cross" y1="${top}" y2="${plotBottom}" visibility="hidden"/>` +
      `<circle class="hmark" id="hmark" r="4" visibility="hidden"/>`;

    const label = points.length
      ? `Tank fill through the day, from ${pctText(Math.min(...points.map(p => p.pct)))} to ${pctText(Math.max(...points.map(p => p.pct)))}, with the red line at ${pctText(redPct())}`
      : 'No readings this day';
    box.innerHTML = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${out}</svg><div class="tip" id="tip" hidden></div>`;
  }

  function renderHistory() {
    const { key, start, points, noEcho, todayKey } = view;
    const name = new Date(start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    $('dayName').textContent = key === todayKey ? 'Today, ' + name : name;
    const pcts = points.map(p => p.pct);
    $('dayHigh').textContent = pcts.length ? pctText(Math.max(...pcts)) : '--';
    $('dayLow').textContent = pcts.length ? pctText(Math.min(...pcts)) : '--';
    $('dayCount').textContent = points.reduce((n, p) => n + p.readings, 0).toLocaleString();
    $('histNote').textContent = 'Shaded areas are times nothing was recorded. This phone only saves readings while this page is open.' +
      (noEcho ? ' ' + noEcho.toLocaleString() + ' no-echo readings are left out.' : '');
    drawChart();
  }

  function showHistory() {
    loadView();
    renderHistory();
  }

  // The chart measures its width when drawn, so it can only be drawn while its tab is showing
  const historyOpen = () => !$('panelHistory').hidden;

  const TABS = ['Today', 'History', 'Settings'];
  let currentTab = TABS[0];

  function showTab(name) {
    currentTab = name;
    document.body.dataset.tab = name;
    TABS.forEach(tab => {
      const on = tab === name;
      $('panel' + tab).hidden = !on;
      $('tab' + tab).setAttribute('aria-selected', on);
      $('tab' + tab).tabIndex = on ? 0 : -1;
    });
    window.scrollTo(0, 0);
    updateNotice();
    if (name === 'History') showHistory();
    if (name === 'Settings') fillSettings();
  }

  // Polling calls this. Past days don't change, so only today's view is redrawn, once a minute.
  function updateHistory() {
    if (!historyOpen()) return;
    const dayChanged = dayKey(Date.now()) !== view.todayKey;
    const followingToday = view.key === view.todayKey;
    const fresh = view.points.length && Date.now() - view.drawnAt < MINUTE;
    if (dayChanged || (followingToday && !fresh)) showHistory();
  }

  function hoverChart(e) {
    const svg = $('chart').querySelector('svg'), tip = $('tip');
    if (!svg) return;
    const { left, right } = CHART;
    const { points, total, start, until } = view;
    const w = chartWidth, plotW = w - left - right;
    const px = e.clientX - svg.getBoundingClientRect().left;
    const min = Math.min(total, Math.max(0, (px - left) / plotW * total));
    let near = null;
    points.forEach(p => { if (!near || Math.abs(p.min - min) < Math.abs(near.min - min)) near = p; });
    // Snap to a reading within 8 px; otherwise say so instead of implying a value
    const hit = near && Math.abs(near.min - min) <= Math.max(CONFIG.gapMin, 8 / plotW * total) ? near : null;
    if (!hit && min > until) return hideHover();

    const at = hit ? hit.min : min;
    const cx = left + at / total * plotW;
    const cross = $('cross'), mark = $('hmark');
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    mark.setAttribute('visibility', hit ? 'visible' : 'hidden');
    if (hit) {
      mark.setAttribute('cx', cx);
      mark.setAttribute('cy', chartY(hit.pct));
    }
    tip.textContent = '';
    if (hit) {
      const value = document.createElement('strong');
      value.className = 'num';
      value.textContent = pctText(hit.pct);
      tip.append(value, ' ');
    }
    tip.append(timeOf(start + at * MINUTE) + (hit ? '' : ' · no readings'));
    tip.hidden = false;
    tip.style.left = Math.min(w - tip.offsetWidth, Math.max(0, cx - tip.offsetWidth / 2)) + 'px';
  }

  function hideHover() {
    const tip = $('tip');
    if (!tip) return;
    tip.hidden = true;
    $('cross').setAttribute('visibility', 'hidden');
    $('hmark').setAttribute('visibility', 'hidden');
  }

  // Every stored day as one CSV row per minute. Per-minute keeps a week small enough to paste from a phone;
  // raw 3 s readings could run to several MB. Minutes with nothing recorded have no row.
  function exportCsv() {
    const rows = ['time,level_pct,distance_cm,readings,no_echo'];
    const days = storedDays();
    days.forEach(key => {
      const { start } = dayBounds(key);
      const date = key.slice(PREFIX.length);
      minutesOf(readingsFor(key), start).forEach(m => {
        const hasEcho = m.d != null;
        rows.push(`${date} ${timeOf(start + m.min * MINUTE)},${hasEcho ? m.pct.toFixed(1) : ''},${hasEcho ? m.d.toFixed(1) : ''},${m.readings},${m.noEcho}`);
      });
    });
    return { text: rows.join('\n') + '\n', rows: rows.length - 1, days: days.length };
  }

  // The page is plain http, where browsers remove navigator.clipboard, so execCommand does the real work here
  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* handled by the caller */ }
    area.remove();
    return ok;
  }

  async function copyData() {
    const { text, rows, days } = exportCsv();
    const box = $('copyBox'), msg = $('copyMsg');
    box.hidden = true;
    if (!rows) {
      msg.textContent = 'Nothing saved yet';
      return;
    }
    let ok = legacyCopy(text);
    if (!ok && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) { /* show it for a manual copy below */ }
    }
    if (ok) {
      msg.textContent = `Copied ${rows.toLocaleString()} rows, ${days} day${days === 1 ? '' : 's'}`;
    } else {
      msg.textContent = 'Select all below and copy';
      box.value = text;
      box.hidden = false;
      box.focus();
      box.select();
    }
  }

  function bindHistory() {
    TABS.forEach(tab => $('tab' + tab).addEventListener('click', () => showTab(tab)));
    $('tabs').addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const step = e.key === 'ArrowRight' ? 1 : TABS.length - 1;
      const next = TABS[(TABS.indexOf(currentTab) + step) % TABS.length];
      showTab(next);
      $('tab' + next).focus();
    });
    $('days').addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      selected = button.dataset.day === view.todayKey ? null : button.dataset.day; // Today keeps following today
      showHistory();
    });
    $('copy').addEventListener('click', copyData);
    const chart = $('chart');
    chart.addEventListener('pointerdown', hoverChart);
    chart.addEventListener('pointermove', hoverChart);
    chart.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideHover(); });
    // On touch nothing "leaves" the chart, so a tap anywhere else dismisses the readout
    document.addEventListener('pointerdown', e => { if (!chart.contains(e.target)) hideHover(); });
    window.addEventListener('resize', () => {
      if (historyOpen() && $('chart').clientWidth !== chartWidth) drawChart();
    });
  }

  // ---------- Settings page ----------

  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = settings.theme;
    // The browser bar on phones follows this
    const bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.content = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelectorAll('[data-theme-choice]').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.themeChoice === settings.theme);
    });
  }

  function saved(text) {
    $('tankMsg').textContent = saveSettings() ? text : 'Could not save on this phone. This will reset when the page reloads.';
    updateNotice();
  }

  function updateNotice() {
    $('notice').hidden = tankSaved() || currentTab === 'Settings';
  }

  function fillSettings() {
    $('tankInput').value = CONFIG.tankCm;
    $('tankDiameter').value = settings.diameterCm == null ? '' : settings.diameterCm;
    $('tankMsg').textContent = '';
  }

  function saveTank(e) {
    e.preventDefault();
    const cm = round1(parseFloat($('tankInput').value));
    if (!validTank(cm)) {
      $('tankMsg').textContent = `Enter a depth from ${CONFIG.tankMinCm} to ${CONFIG.tankMaxCm} cm.`;
      return;
    }
    const blank = $('tankDiameter').value.trim() === '';
    const diameter = blank ? null : round1(parseFloat($('tankDiameter').value));
    if (!blank && !validDiameter(diameter)) {
      $('tankMsg').textContent = `Enter a diameter from ${CONFIG.diameterMinCm} to ${CONFIG.diameterMaxCm} cm, or leave it blank.`;
      return;
    }
    settings.tankCm = CONFIG.tankCm = cm;
    settings.diameterCm = diameter;
    $('tankInput').value = cm;
    $('gauge').innerHTML = buildSvg();
    if (lastD != null) drawLevel(lastD);
    const capacity = diameter ? ` A full tank holds ${litresText(cm)}.` : '';
    saved(`Saved. Tank depth is ${cm} cm, red line at ${pctText(redPct())}.${capacity}`);
  }

  function bindSettings() {
    $('themes').addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      settings.theme = button.dataset.themeChoice;
      applyTheme();
      saved('Saved.');
    });
    $('tankForm').addEventListener('submit', saveTank);
    $('noticeSet').addEventListener('click', () => showTab('Settings'));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  }

  setInterval(() => {
    if (!lastOk) return;
    const s = Math.round((Date.now() - lastOk) / 1000);
    $('updated').textContent = 'Updated ' + (s < 2 ? 'just now' : s + ' s ago');
  }, 1000);

  // One request every pollMs. The next one is scheduled after the previous finishes, so they never overlap.
  async function poll() {
    const started = Date.now();
    let d;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(CONFIG.api, { cache: 'no-store', signal: ctrl.signal });
      const j = await res.json();
      clearTimeout(timer);
      failures = 0;
      lastOk = Date.now();
      d = j.d == null ? null : round1(j.d);
      record([lastOk, d]);
    } catch (e) {
      failures++;
    }
    render(d);
    updateHistory();
    setTimeout(poll, Math.max(0, CONFIG.pollMs - (Date.now() - started)));
  }

  function start() {
    pruneOldDays();
    loadSettings();
    buildPage();
    applyTheme();
    bindHistory();
    bindSettings();
    updateNotice();
    poll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
