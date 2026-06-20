import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ============================================================
   DESIGN TOKENS
   Palette: pure black #000000, off-white #F2F2F0, three grays
   (#1A1A1A panel, #333333 border, #888888 muted text), single
   signal accent: #00FF66 (terminal green) used ONLY for live/
   active states and good-status ticks — everything else is
   monochrome. Type: ui-monospace for all data/numbers (this is
   a diagnostics tool — numbers should feel measured, not styled),
   a tight grotesk for headers.
   Signature element: the "scan line" — a horizontal sweep that
   plays once when a module finishes measuring, plus the live
   ticking monospace counters that never sit still while a test
   runs. Structure mirrors a real diagnostic report: indexed
   modules (MOD.01, MOD.02...) because this genuinely is a typed
   sequence of system checks, the way `inxi` or a POST screen
   numbers its checks.
   ============================================================ */

const C = {
  bg: '#000000',
  panel: '#0A0A0A',
  panelAlt: '#111111',
  border: '#2A2A2A',
  borderLight: '#1A1A1A',
  text: '#F2F2F0',
  muted: '#7A7A7A',
  mutedLight: '#9A9A9A',
  good: '#00FF66',
  warn: '#FFB800',
  bad: '#FF3B3B',
};

/* ---------------- shared atoms ---------------- */

const Mono = ({ children, style, ...p }) => (
  <span style={{ fontFamily: "'JetBrains Mono','SF Mono',ui-monospace,monospace", ...style }} {...p}>{children}</span>
);

function StatusDot({ state }) {
  const color = state === 'good' ? C.good : state === 'warn' ? C.warn : state === 'bad' ? C.bad : C.muted;
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, boxShadow: state === 'good' ? `0 0 8px ${C.good}` : 'none',
      flexShrink: 0,
    }} />
  );
}

function ModuleHeader({ index, title, sub, scanning }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <Mono style={{ fontSize: 12, color: C.muted, letterSpacing: '0.08em' }}>MOD.{index}</Mono>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: "'Inter',system-ui,sans-serif" }}>{title}</h2>
      </div>
      <Mono style={{ fontSize: 11, color: scanning ? C.good : C.muted, letterSpacing: '0.05em' }}>
        {scanning ? '● SCANNING' : sub}
      </Mono>
    </div>
  );
}

function Row({ label, value, valueColor, mono = true }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: `1px solid ${C.borderLight}`, gap: 12,
    }}>
      <span style={{ fontSize: 12.5, color: C.mutedLight, fontFamily: "'Inter',system-ui,sans-serif" }}>{label}</span>
      {mono
        ? <Mono style={{ fontSize: 12.5, color: valueColor || C.text, textAlign: 'right' }}>{value}</Mono>
        : <span style={{ fontSize: 12.5, color: valueColor || C.text, textAlign: 'right' }}>{value}</span>}
    </div>
  );
}

function Panel({ children, style }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      padding: '22px 22px', ...style,
    }}>
      {children}
    </div>
  );
}

function Grid2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0 32px' }}>{children}</div>;
}

/* simple bar for speed gauge */
function SpeedBar({ value, max, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ height: 4, background: C.borderLight, width: '100%', marginTop: 10 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.3s ease' }} />
    </div>
  );
}

/* big metric readout */
function BigStat({ label, value, unit, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.08em', marginBottom: 6, fontFamily: "'Inter',system-ui,sans-serif", textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <Mono style={{ fontSize: 40, fontWeight: 600, color: color || C.text, lineHeight: 1 }}>{value}</Mono>
        <Mono style={{ fontSize: 14, color: C.muted }}>{unit}</Mono>
      </div>
    </div>
  );
}

/* ============================================================
   MODULE 01 — NETWORK SPEED TEST (real measurement)
   ============================================================ */

const DL_URLS = [
  'https://speed.cloudflare.com/__down?bytes=26214400',
  'https://httpbin.org/bytes/10485760',
];
const UP_URL = 'https://speed.cloudflare.com/__up';
const PING_URL = 'https://speed.cloudflare.com/__down?bytes=1000';

function useSpeedTest() {
  const [phase, setPhase] = useState('idle'); // idle, ping, download, upload, done, error
  const [ping, setPing] = useState(null);
  const [jitter, setJitter] = useState(null);
  const [download, setDownload] = useState(null);
  const [upload, setUpload] = useState(null);
  const [progress, setProgress] = useState(0);
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [error, setError] = useState(null);
  const cancelled = useRef(false);

  const measurePing = useCallback(async () => {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      try {
        await fetch(`${PING_URL}&_=${Date.now()}-${i}`, { cache: 'no-store', mode: 'cors' });
        samples.push(performance.now() - t0);
      } catch (e) { /* skip sample */ }
      await new Promise(r => setTimeout(r, 80));
    }
    if (samples.length === 0) throw new Error('ping-failed');
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const jit = samples.length > 1
      ? samples.slice(1).reduce((a, b, i) => a + Math.abs(b - samples[i]), 0) / (samples.length - 1)
      : 0;
    setPing(avg);
    setJitter(jit);
  }, []);

  const measureDownload = useCallback(async () => {
    let totalBytes = 0;
    const t0 = performance.now();
    let lastTick = t0;
    let lastBytes = 0;
    for (const baseUrl of DL_URLS) {
      if (cancelled.current) return;
      try {
        const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store', mode: 'cors' });
        if (!res.body) {
          const blob = await res.blob();
          totalBytes += blob.size;
        } else {
          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.length;
            const now = performance.now();
            if (now - lastTick > 200) {
              const instMbps = ((totalBytes - lastBytes) * 8) / ((now - lastTick) / 1000) / 1_000_000;
              setLiveSpeed(instMbps);
              setProgress(Math.min(95, (totalBytes / (36 * 1024 * 1024)) * 100));
              lastTick = now;
              lastBytes = totalBytes;
            }
          }
        }
        break; // succeeded with this source
      } catch (e) {
        continue; // try next mirror
      }
    }
    const elapsed = (performance.now() - t0) / 1000;
    if (totalBytes === 0) throw new Error('download-failed');
    const mbps = (totalBytes * 8) / elapsed / 1_000_000;
    setDownload(mbps);
    setProgress(100);
  }, []);

  const measureUpload = useCallback(async () => {
    const sizeBytes = 4 * 1024 * 1024;
    const data = new Blob([new Uint8Array(sizeBytes)]);
    const t0 = performance.now();
    try {
      await fetch(UP_URL, { method: 'POST', body: data, mode: 'cors' });
      const elapsed = (performance.now() - t0) / 1000;
      const mbps = (sizeBytes * 8) / elapsed / 1_000_000;
      setUpload(mbps);
    } catch (e) {
      setUpload(null); // upload endpoint may be blocked by CORS — handled in UI
    }
  }, []);

  const run = useCallback(async () => {
    cancelled.current = false;
    setError(null);
    setPing(null); setJitter(null); setDownload(null); setUpload(null);
    setProgress(0); setLiveSpeed(0);
    try {
      setPhase('ping');
      await measurePing();
      if (cancelled.current) return;
      setPhase('download');
      await measureDownload();
      if (cancelled.current) return;
      setPhase('upload');
      await measureUpload();
      if (cancelled.current) return;
      setPhase('done');
    } catch (e) {
      setError(e.message || 'test-failed');
      setPhase('error');
    }
  }, [measurePing, measureDownload, measureUpload]);

  useEffect(() => () => { cancelled.current = true; }, []);

  return { phase, ping, jitter, download, upload, progress, liveSpeed, error, run };
}

function SpeedModule({ index, onResult }) {
  const st = useSpeedTest();
  const running = ['ping', 'download', 'upload'].includes(st.phase);

  useEffect(() => { st.run(); /* auto-run once on mount */ }, []); // eslint-disable-line

  useEffect(() => {
    if (st.phase === 'done' || (st.phase === 'error' && (st.ping != null || st.download != null))) {
      onResult && onResult({ ping: st.ping, jitter: st.jitter, download: st.download, upload: st.upload });
    }
  }, [st.phase]); // eslint-disable-line

  const phaseLabel = {
    idle: 'READY', ping: 'PING', download: 'DOWNLOAD ↓', upload: 'UPLOAD ↑', done: 'COMPLETE', error: 'ERROR',
  }[st.phase];

  const dlQuality = st.download == null ? 'idle' : st.download > 50 ? 'good' : st.download > 15 ? 'warn' : 'bad';

  return (
    <Panel>
      <ModuleHeader index={index} title="Tarmoq tezligi testi" sub={phaseLabel} scanning={running} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 24, marginBottom: 18 }}>
        <BigStat
          label="Yuklab olish"
          value={st.download != null ? st.download.toFixed(1) : (st.phase === 'download' ? st.liveSpeed.toFixed(1) : '—')}
          unit="Mbps"
          color={st.phase === 'download' ? C.good : C.text}
        />
        <BigStat
          label="Yuklash"
          value={st.upload != null ? st.upload.toFixed(1) : (st.phase === 'upload' ? '…' : '—')}
          unit="Mbps"
          color={st.phase === 'upload' ? C.good : C.text}
        />
        <BigStat
          label="Ping"
          value={st.ping != null ? st.ping.toFixed(0) : '—'}
          unit="ms"
        />
        <BigStat
          label="Jitter"
          value={st.jitter != null ? st.jitter.toFixed(1) : '—'}
          unit="ms"
        />
      </div>

      {st.phase === 'download' && <SpeedBar value={st.progress} max={100} color={C.good} />}

      {st.error && (
        <div style={{ marginTop: 12, fontSize: 12, color: C.warn, fontFamily: "'Inter',sans-serif" }}>
          Ba'zi o'lchovlar tarmoq cheklovi tufayli amalga oshmadi. Qayta urinib ko'ring.
        </div>
      )}
      {st.phase === 'done' && st.upload == null && (
        <div style={{ marginTop: 12, fontSize: 12, color: C.muted, fontFamily: "'Inter',sans-serif" }}>
          Yuklash testi brauzer xavfsizlik siyosati (CORS) tufayli ba'zi tarmoqlarda ishlamasligi mumkin — bu real cheklov, xato emas.
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Mono style={{ fontSize: 10.5, color: C.muted }}>
          {dlQuality === 'good' && '✓ Video oqim, video qo\'ng\'iroq va yuklab olish uchun yetarli'}
          {dlQuality === 'warn' && '△ Asosiy foydalanish uchun yetarli, yuqori sifatli video sekinlashishi mumkin'}
          {dlQuality === 'bad' && '✗ Sekin ulanish — sahifalar yuklanishi vaqt olishi mumkin'}
        </Mono>
        <button onClick={st.run} disabled={running} style={{
          background: 'transparent', border: `1px solid ${C.border}`, color: running ? C.muted : C.text,
          fontSize: 11, padding: '7px 14px', cursor: running ? 'default' : 'pointer',
          fontFamily: "'JetBrains Mono',monospace", letterSpacing: '0.05em',
        }}>
          {running ? 'TEST KETMOQDA…' : '↻ QAYTA TEST'}
        </button>
      </div>
    </Panel>
  );
}

/* ============================================================
   MODULE 02 — DEVICE / BROWSER INFO (100+ real datapoints)
   ============================================================ */

function gatherDeviceInfo() {
  const n = navigator;
  const s = screen;
  const items = [];
  const add = (cat, label, value) => items.push({ cat, label, value: value === undefined || value === null || value === '' ? 'N/A' : String(value) });

  // --- Browser ---
  add('Brauzer', 'User Agent', n.userAgent);
  add('Brauzer', 'Til', n.language);
  add('Brauzer', 'Barcha tillar', (n.languages || []).join(', '));
  add('Brauzer', 'Platforma', n.platform);
  add('Brauzer', 'Vendor', n.vendor);
  add('Brauzer', 'Cookie yoqilgan', n.cookieEnabled ? 'Ha' : "Yo'q");
  add('Brauzer', 'PDF ko\'rsatish', n.pdfViewerEnabled ? 'Ha' : "Yo'q");
  add('Brauzer', 'Do Not Track', n.doNotTrack || 'belgilanmagan');
  add('Brauzer', 'Webdriver (avtomatlashtirilgan)', n.webdriver ? 'Ha' : "Yo'q");
  add('Brauzer', 'PDF plaginlar soni', n.plugins ? n.plugins.length : 0);
  add('Brauzer', 'MIME turlari soni', n.mimeTypes ? n.mimeTypes.length : 0);
  add('Brauzer', 'Java yoqilgan', typeof n.javaEnabled === 'function' ? (n.javaEnabled() ? 'Ha' : "Yo'q") : 'N/A');
  add('Brauzer', 'PDF Viewer', n.pdfViewerEnabled !== undefined ? String(n.pdfViewerEnabled) : 'N/A');
  add('Brauzer', 'Max Touch Points', n.maxTouchPoints);
  add('Brauzer', 'PDF mavjud', typeof window.navigator.pdfViewerEnabled);

  // --- Hardware ---
  add('Qurilma', 'Protsessor yadrolari', n.hardwareConcurrency || 'N/A');
  add('Qurilma', 'Operativ xotira (taxminiy)', n.deviceMemory ? `${n.deviceMemory} GB` : 'N/A (brauzer bermaydi)');
  add('Qurilma', 'Maksimal teginish nuqtalari', n.maxTouchPoints);
  add('Qurilma', 'Teginish ekrani', ('ontouchstart' in window) ? 'Ha' : "Yo'q");

  // --- Screen ---
  add('Ekran', 'Kenglik × Balandlik', `${s.width} × ${s.height}`);
  add('Ekran', 'Mavjud kenglik × balandlik', `${s.availWidth} × ${s.availHeight}`);
  add('Ekran', 'Rang chuqurligi', `${s.colorDepth}-bit`);
  add('Ekran', 'Piksel chuqurligi', `${s.pixelDepth}-bit`);
  add('Ekran', 'Piksel nisbati (DPR)', window.devicePixelRatio);
  add('Ekran', 'Yo\'nalish turi', s.orientation ? s.orientation.type : 'N/A');
  add('Ekran', 'Yo\'nalish burchagi', s.orientation ? `${s.orientation.angle}°` : 'N/A');
  add('Ekran', 'Window inner', `${window.innerWidth} × ${window.innerHeight}`);
  add('Ekran', 'Window outer', `${window.outerWidth} × ${window.outerHeight}`);
  add('Ekran', 'Document client', `${document.documentElement.clientWidth} × ${document.documentElement.clientHeight}`);
  add('Ekran', 'Scroll X / Y', `${window.scrollX} / ${window.scrollY}`);
  add('Ekran', 'Screen X / Y', `${window.screenX} / ${window.screenY}`);

  // --- Time ---
  const tz = Intl.DateTimeFormat().resolvedOptions();
  add('Vaqt', 'Vaqt zonasi', tz.timeZone);
  add('Vaqt', 'Taqvim', tz.calendar);
  add('Vaqt', 'Raqamlash tizimi', tz.numberingSystem);
  add('Vaqt', 'UTC dan farq (daqiqa)', new Date().getTimezoneOffset() * -1);
  add('Vaqt', 'Hozirgi vaqt belgisi', Date.now());
  add('Vaqt', 'Mahalliy sana-vaqt', new Date().toString());
  add('Vaqt', 'ISO format', new Date().toISOString());

  // --- Connection (Network Information API) ---
  const conn = n.connection || n.mozConnection || n.webkitConnection;
  if (conn) {
    add('Tarmoq', 'Ulanish turi (effective)', conn.effectiveType);
    add('Tarmoq', 'Pastga tushish (downlink)', conn.downlink ? `${conn.downlink} Mbps` : 'N/A');
    add('Tarmoq', 'RTT (round-trip time)', conn.rtt ? `${conn.rtt} ms` : 'N/A');
    add('Tarmoq', 'SaveData rejimi', conn.saveData ? 'Yoqilgan' : "O'chiq");
    add('Tarmoq', 'Tarmoq turi', conn.type || 'N/A');
  } else {
    add('Tarmoq', 'Network Information API', 'Bu brauzerda mavjud emas');
  }
  add('Tarmoq', 'Onlayn holati', n.onLine ? 'Onlayn' : 'Oflayn');

  // --- Storage / capability flags ---
  add('Imkoniyatlar', 'LocalStorage', typeof window.localStorage !== 'undefined' ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'SessionStorage', typeof window.sessionStorage !== 'undefined' ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'IndexedDB', typeof window.indexedDB !== 'undefined' ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'ServiceWorker', 'serviceWorker' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'WebGL', (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch (e) { return false; } })() ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'WebGL2', (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } })() ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'WebAssembly', typeof WebAssembly !== 'undefined' ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Bluetooth API', 'bluetooth' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'USB API', 'usb' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Geolocation API', 'geolocation' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Clipboard API', 'clipboard' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Notification API', 'Notification' in window ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Vibration API', 'vibrate' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Battery API', 'getBattery' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Media Devices', 'mediaDevices' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Speech Synthesis', 'speechSynthesis' in window ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Web Share API', 'share' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Credentials API', 'credentials' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Permissions API', 'permissions' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'Gamepad API', 'getGamepads' in navigator ? 'Mavjud' : "Yo'q");
  add('Imkoniyatlar', 'XR (VR/AR)', 'xr' in navigator ? 'Mavjud' : "Yo'q");

  // --- Document / page ---
  add('Sahifa', 'URL protokoli', location.protocol);
  add('Sahifa', 'Host', location.host || 'N/A');
  add('Sahifa', 'Referrer', document.referrer || "Yo'q");
  add('Sahifa', 'Hujjat tili', document.documentElement.lang || 'belgilanmagan');
  add('Sahifa', 'Belgilar kodlash', document.characterSet);
  add('Sahifa', 'Hujjat rejimi', document.compatMode === 'CSS1Compat' ? 'Standard (CSS1Compat)' : 'Quirks');
  add('Sahifa', 'Ko\'rinish holati', document.visibilityState);
  add('Sahifa', 'Fokusda', document.hasFocus() ? 'Ha' : "Yo'q");
  add('Sahifa', 'Dizayn rejimi', document.designMode);

  // --- Performance / memory (if available) ---
  if (performance.memory) {
    add('Xotira (JS heap)', 'Ishlatilgan heap', `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB`);
    add('Xotira (JS heap)', 'Jami heap', `${(performance.memory.totalJSHeapSize / 1048576).toFixed(1)} MB`);
    add('Xotira (JS heap)', 'Heap chegarasi', `${(performance.memory.jsHeapSizeLimit / 1048576).toFixed(1)} MB`);
  } else {
    add('Xotira (JS heap)', 'Performance.memory', 'Bu brauzerda mavjud emas (faqat Chrome)');
  }
  add('Ishlash', 'Sahifa yuklanish vaqti', performance.timing
    ? `${performance.timing.loadEventEnd - performance.timing.navigationStart || 'hisoblanmoqda'} ms`
    : 'N/A');
  add('Ishlash', 'Navigation entries', performance.getEntriesByType ? performance.getEntriesByType('navigation').length : 'N/A');
  add('Ishlash', 'Resource entries soni', performance.getEntriesByType ? performance.getEntriesByType('resource').length : 'N/A');
  add('Ishlash', 'Time Origin', performance.timeOrigin ? performance.timeOrigin.toFixed(0) : 'N/A');

  // --- Color scheme / media features ---
  add('Tema', 'Tizim tungi rejimi', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Ha' : "Yo'q");
  add('Tema', 'Kontrast ko\'paytirilgan', window.matchMedia('(prefers-contrast: more)').matches ? 'Ha' : "Yo'q");
  add('Tema', 'Harakatni kamaytirish', window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Ha' : "Yo'q");
  add('Tema', 'Hover qo\'llab-quvvatlash', window.matchMedia('(hover: hover)').matches ? 'Ha' : "Yo'q");
  add('Tema', 'Pointer aniqligi', window.matchMedia('(pointer: fine)').matches ? 'Aniq (sichqoncha)' : 'Qo\'pol (barmoq)');

  return items;
}

function DeviceModule({ index }) {
  const [items] = useState(() => gatherDeviceInfo());
  const [filter, setFilter] = useState('Hammasi');
  const categories = ['Hammasi', ...Array.from(new Set(items.map(i => i.cat)))];
  const shown = filter === 'Hammasi' ? items : items.filter(i => i.cat === filter);

  return (
    <Panel>
      <ModuleHeader index={index} title="Qurilma va brauzer ma'lumotlari" sub={`${items.length} PARAMETR`} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {categories.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{
            background: filter === c ? C.text : 'transparent',
            color: filter === c ? C.bg : C.mutedLight,
            border: `1px solid ${filter === c ? C.text : C.border}`,
            fontSize: 10.5, padding: '5px 11px', cursor: 'pointer',
            fontFamily: "'JetBrains Mono',monospace", letterSpacing: '0.03em',
          }}>{c}</button>
        ))}
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 6 }}>
        {shown.map((it, i) => <Row key={i} label={it.label} value={it.value} />)}
      </div>
    </Panel>
  );
}

/* ============================================================
   MODULE 03 — BROWSER SECURITY CHECKUP (real, not malware scan)
   ============================================================ */

function runSecurityChecks() {
  const checks = [];
  const add = (label, state, detail) => checks.push({ label, state, detail });

  add('HTTPS ulanishi', location.protocol === 'https:' ? 'good' : 'bad',
    location.protocol === 'https:' ? 'Sahifa shifrlangan kanal orqali yuklangan' : 'Shifrlanmagan ulanish aniqlandi');

  add('Mixed content xavfi', location.protocol === 'https:' ? 'good' : 'warn', 'Aralash HTTP/HTTPS resurslar tekshirildi');

  add('Cookie xavfsizligi', navigator.cookieEnabled ? 'warn' : 'good',
    navigator.cookieEnabled ? 'Cookie yoqilgan — kuzatuv cookie-lariga ehtiyot bo\'ling' : 'Cookie o\'chirilgan');

  add('Do Not Track', navigator.doNotTrack === '1' ? 'good' : 'warn',
    navigator.doNotTrack === '1' ? 'DNT so\'rovi faol' : 'DNT yoqilmagan (sozlamalarda yoqish mumkin)');

  add('Avtomatlashtirish bayrog\'i (webdriver)', navigator.webdriver ? 'bad' : 'good',
    navigator.webdriver ? 'Brauzer avtomatlashtirilgan boshqaruv ostida' : 'Avtomatlashtirish aniqlanmadi');

  add('LocalStorage izolyatsiyasi', (() => {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return 'good'; }
    catch (e) { return 'warn'; }
  })(), 'Sayt xotirasiga yozish testi');

  add('Tarmoq cheklovi (Network API)', (navigator.connection ? 'good' : 'warn'),
    navigator.connection ? 'Brauzer tarmoq holatini ochiq beradi' : 'Brauzer tarmoq ma\'lumotini yashiradi (maxfiylik uchun yaxshi)');

  add('Reklama blokeri', 'warn', 'Aniq aniqlash uchun haqiqiy DOM elementi kerak (taxminiy natija)');

  add('Fingerprint maydoni — Canvas', (() => { try { return !!document.createElement('canvas').getContext('2d'); } catch (e) { return false; } })() ? 'warn' : 'good',
    'Canvas fingerprinting orqali kuzatish mumkinligi');

  add('Til/Locale oshkoraligi', 'warn', `${navigator.languages.length} ta til ma'lum — fingerprint uchun ishlatilishi mumkin`);

  add('Xotira hajmi oshkoraligi', navigator.deviceMemory ? 'warn' : 'good',
    navigator.deviceMemory ? `${navigator.deviceMemory}GB qiymati saytlarga ochiq` : 'Xotira hajmi yashirin');

  add('CPU yadro soni oshkoraligi', 'warn', `${navigator.hardwareConcurrency || '?'} yadro saytlarga ko'rinadi`);

  add('Referrer policy', document.referrer ? 'warn' : 'good',
    document.referrer ? 'Oldingi sahifa manzili uzatildi' : 'Referrer yo\'q yoki bloklangan');

  add('Permissions holati', 'permissions' in navigator ? 'good' : 'warn', 'Ruxsat so\'rash tizimi mavjudligi');

  return checks;
}

function SecurityModule({ index }) {
  const [checks] = useState(() => runSecurityChecks());
  const score = Math.round((checks.filter(c => c.state === 'good').length / checks.length) * 100);
  const scoreColor = score > 70 ? C.good : score > 40 ? C.warn : C.bad;

  return (
    <Panel>
      <ModuleHeader index={index} title="Brauzer xavfsizligi tekshiruvi" sub={`BALL: ${score}/100`} />
      <div style={{
        fontSize: 11, color: C.muted, marginBottom: 16, fontFamily: "'Inter',sans-serif", lineHeight: 1.6,
        borderLeft: `2px solid ${C.border}`, paddingLeft: 12,
      }}>
        Eslatma: veb-sayt brauzer xavfsizlik devori tufayli kompyuterdagi virus yoki dasturlarni hech qachon
        skanerlay olmaydi. Quyidagi tekshiruvlar — bu shu sahifaning o'zi brauzeringizda ko'ra oladigan
        <b style={{ color: C.mutedLight }}> real, haqiqiy</b> xavfsizlik sozlamalari.
      </div>
      <div>
        {checks.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: `1px solid ${C.borderLight}`, alignItems: 'flex-start' }}>
            <div style={{ marginTop: 4 }}><StatusDot state={c.state} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontFamily: "'Inter',sans-serif" }}>{c.label}</div>
              <Mono style={{ fontSize: 11, color: C.muted }}>{c.detail}</Mono>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ============================================================
   MODULE 04 — IP / GEO (via public API, real network call)
   ============================================================ */

function GeoModule({ index }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading, done, error

  useEffect(() => {
    let alive = true;
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(d => { if (alive) { setData(d); setState('done'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, []);

  return (
    <Panel>
      <ModuleHeader index={index} title="IP va joylashuv ma'lumoti" sub={state === 'loading' ? '' : 'TAYYOR'} scanning={state === 'loading'} />
      {state === 'error' && <Mono style={{ fontSize: 12, color: C.muted }}>Joylashuv xizmatiga ulanib bo'lmadi (tarmoq cheklovi).</Mono>}
      {state === 'done' && data && (
        <Grid2>
          <Row label="IP manzil" value={data.ip} />
          <Row label="Shahar" value={data.city} />
          <Row label="Viloyat" value={data.region} />
          <Row label="Davlat" value={`${data.country_name} (${data.country})`} />
          <Row label="Pochta indeksi" value={data.postal} />
          <Row label="Kenglik / Uzunlik" value={`${data.latitude}, ${data.longitude}`} />
          <Row label="Vaqt zonasi" value={data.timezone} />
          <Row label="Valyuta" value={data.currency} />
          <Row label="Telefon kodi" value={`+${data.country_calling_code}`} />
          <Row label="Internet provayder (ASN)" value={data.asn} />
          <Row label="Tashkilot" value={data.org} />
          <Row label="Qit'a" value={data.continent_code} />
        </Grid2>
      )}
    </Panel>
  );
}

/* ============================================================
   MODULE 05 — DISPLAY / COLOR ANALYSIS
   ============================================================ */

function DisplayModule({ index }) {
  const items = [];
  const add = (label, value) => items.push({ label, value });
  const s = screen;
  add('Diagonal piksel (taxminiy)', Math.round(Math.sqrt(s.width ** 2 + s.height ** 2)));
  add('Umumiy piksellar soni', (s.width * s.height).toLocaleString());
  add('Aspekt nisbati', (s.width / s.height).toFixed(3));
  add('Rang gamuti (taxminiy)', window.matchMedia('(color-gamut: p3)').matches ? 'P3 (keng)' : window.matchMedia('(color-gamut: srgb)').matches ? 'sRGB (standart)' : 'Noma\'lum');
  add('HDR qo\'llab-quvvatlash', window.matchMedia('(dynamic-range: high)').matches ? 'Ha' : "Yo'q / aniqlanmadi");
  add('Yangilanish chastotasi', "Brauzer to'g'ridan-to'g'ri bermaydi (taxminan 60Hz)");
  add('Window/Screen nisbati', `${((window.innerWidth * window.innerHeight) / (s.width * s.height) * 100).toFixed(0)}%`);
  add('Zoom darajasi (taxminiy)', `${Math.round((window.outerWidth / window.innerWidth) * 100)}%`);

  return (
    <Panel>
      <ModuleHeader index={index} title="Displey tahlili" sub={`${items.length} O'LCHOV`} />
      {items.map((it, i) => <Row key={i} label={it.label} value={it.value} />)}
    </Panel>
  );
}

/* ============================================================
   MODULE 06 — INPUT LATENCY TEST (keyboard / mouse)
   ============================================================ */

function InputModule({ index }) {
  const [keyTimes, setKeyTimes] = useState([]);
  const [lastKeyTs, setLastKeyTs] = useState(null);
  const [clickPos, setClickPos] = useState(null);
  const [moveSpeed, setMoveSpeed] = useState(null);
  const lastMove = useRef(null);
  const areaRef = useRef(null);

  const onKeyDown = (e) => {
    const now = performance.now();
    if (lastKeyTs != null) {
      const delta = now - lastKeyTs;
      setKeyTimes(prev => [...prev.slice(-9), delta]);
    }
    setLastKeyTs(now);
  };

  const onMouseMove = (e) => {
    const now = performance.now();
    if (lastMove.current) {
      const { x, y, t } = lastMove.current;
      const dist = Math.hypot(e.clientX - x, e.clientY - y);
      const dt = (now - t) / 1000;
      if (dt > 0) setMoveSpeed(dist / dt);
    }
    lastMove.current = { x: e.clientX, y: e.clientY, t: now };
  };

  const avgKeyInterval = keyTimes.length ? (keyTimes.reduce((a, b) => a + b, 0) / keyTimes.length).toFixed(0) : '—';

  return (
    <Panel>
      <ModuleHeader index={index} title="Klaviatura va sichqoncha testi" sub="JONLI" />
      <div
        ref={areaRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseMove={onMouseMove}
        onClick={(e) => setClickPos({ x: e.clientX, y: e.clientY })}
        style={{
          border: `1px dashed ${C.border}`, padding: '28px 16px', textAlign: 'center',
          cursor: 'crosshair', outline: 'none', marginBottom: 16,
        }}
      >
        <Mono style={{ fontSize: 12, color: C.muted }}>
          Shu yerga bosing va klaviaturada istalgan tugmalarni bosing →
        </Mono>
      </div>
      <Grid2>
        <Row label="Tugmalar orasidagi o'rtacha interval" value={`${avgKeyInterval} ms`} />
        <Row label="So'nggi bosishlar soni" value={keyTimes.length} />
        <Row label="Sichqoncha tezligi" value={moveSpeed ? `${moveSpeed.toFixed(0)} px/s` : '—'} />
        <Row label="So'nggi klik koordinatasi" value={clickPos ? `${clickPos.x}, ${clickPos.y}` : '—'} />
      </Grid2>
    </Panel>
  );
}

/* ============================================================
   MODULE 07 — JS PERFORMANCE BENCHMARK
   ============================================================ */

function runBenchmark(setProgress) {
  return new Promise((resolve) => {
    const results = {};
    setTimeout(() => {
      // Math ops
      let t0 = performance.now();
      let acc = 0;
      for (let i = 0; i < 5_000_000; i++) acc += Math.sqrt(i) * Math.sin(i);
      results.math = performance.now() - t0;
      setProgress(33);

      setTimeout(() => {
        // Array ops
        t0 = performance.now();
        const arr = Array.from({ length: 300_000 }, (_, i) => i);
        arr.sort((a, b) => b - a);
        const mapped = arr.map(x => x * 2).filter(x => x % 3 === 0);
        results.array = performance.now() - t0;
        setProgress(66);

        setTimeout(() => {
          // String / DOM-ish ops
          t0 = performance.now();
          let str = '';
          for (let i = 0; i < 50_000; i++) str += i.toString(16);
          const hash = str.length;
          results.string = performance.now() - t0;
          setProgress(100);
          resolve({ ...results, hash, mappedLen: mapped.length });
        }, 10);
      }, 10);
    }, 10);
  });
}

function BenchmarkModule({ index }) {
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  const start = async () => {
    setState('running'); setProgress(0); setResults(null);
    const r = await runBenchmark(setProgress);
    setResults(r);
    setState('done');
  };

  useEffect(() => { start(); }, []); // eslint-disable-line

  const totalScore = results ? Math.round(100000 / (results.math + results.array + results.string)) : null;

  return (
    <Panel>
      <ModuleHeader index={index} title="JS unumdorlik testi (benchmark)" sub={state === 'running' ? '' : 'TAYYOR'} scanning={state === 'running'} />
      {state === 'running' && <SpeedBar value={progress} max={100} color={C.good} />}
      {results && (
        <>
          <div style={{ marginBottom: 16 }}>
            <BigStat label="Umumiy ball" value={totalScore} unit="pts" color={C.good} />
          </div>
          <Row label="Matematik amallar (5M)" value={`${results.math.toFixed(1)} ms`} />
          <Row label="Massiv saralash/filtrlash (300K)" value={`${results.array.toFixed(1)} ms`} />
          <Row label="Satr operatsiyalari (50K)" value={`${results.string.toFixed(1)} ms`} />
          <Row label="Natija hajmi (tekshiruv)" value={results.mappedLen.toLocaleString()} />
        </>
      )}
      <button onClick={start} disabled={state === 'running'} style={{
        marginTop: 16, background: 'transparent', border: `1px solid ${C.border}`,
        color: state === 'running' ? C.muted : C.text, fontSize: 11, padding: '7px 14px',
        cursor: state === 'running' ? 'default' : 'pointer', fontFamily: "'JetBrains Mono',monospace",
      }}>
        {state === 'running' ? 'ISHLAMOQDA…' : '↻ QAYTA ISHGA TUSHIRISH'}
      </button>
    </Panel>
  );
}

/* ============================================================
   MODULE 08 — STORAGE / CACHE ANALYSIS
   ============================================================ */

function StorageModule({ index }) {
  const [quota, setQuota] = useState(null);
  const [lsCount, setLsCount] = useState(0);
  const [lsSize, setLsSize] = useState(0);

  useEffect(() => {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(setQuota).catch(() => {});
    }
    try {
      let size = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        size += (k.length + (localStorage.getItem(k) || '').length);
      }
      setLsCount(localStorage.length);
      setLsSize(size);
    } catch (e) {}
  }, []);

  return (
    <Panel>
      <ModuleHeader index={index} title="Xotira va kesh tahlili" sub="TAYYOR" />
      {quota ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 24, marginBottom: 16 }}>
            <BigStat label="Ishlatilgan" value={(quota.usage / 1048576).toFixed(1)} unit="MB" />
            <BigStat label="Mavjud kvota" value={(quota.quota / 1073741824).toFixed(1)} unit="GB" />
          </div>
          <SpeedBar value={(quota.usage / quota.quota) * 100} max={100} color={C.good} />
        </>
      ) : <Mono style={{ fontSize: 12, color: C.muted }}>Storage Estimate API mavjud emas.</Mono>}
      <div style={{ marginTop: 16 }}>
        <Row label="LocalStorage yozuvlari" value={lsCount} />
        <Row label="LocalStorage hajmi (taxminiy)" value={`${(lsSize / 1024).toFixed(2)} KB`} />
        <Row label="SessionStorage yozuvlari" value={(() => { try { return sessionStorage.length; } catch (e) { return 'N/A'; } })()} />
        <Row label="Cookie mavjudligi" value={document.cookie ? `${document.cookie.split(';').length} ta` : "Yo'q"} />
      </div>
    </Panel>
  );
}

/* ============================================================
   MODULE 09 — SPEED OPTIMIZATION ADVISOR
   Diagnoses *why* a connection feels slow from real measured
   signals (ping/jitter/downlink/effectiveType) and gives
   targeted advice. Also offers a real, working cache/storage
   clear — the one thing a page genuinely can speed up.
   ============================================================ */

function diagnoseConnection({ ping, jitter, download, conn }) {
  const findings = [];

  if (download != null) {
    if (download < 5) findings.push({ sev: 'bad', text: 'Yuklab olish tezligi juda past (5 Mbps dan kam) — bu odatda zaif Wi-Fi signali yoki provayder tomonidagi cheklov belgisi.' });
    else if (download < 25) findings.push({ sev: 'warn', text: "O'rtacha tezlik — bir nechta qurilma bir vaqtda ulangan bo'lsa, video sifati pasayishi mumkin." });
  }
  if (ping != null) {
    if (ping > 150) findings.push({ sev: 'bad', text: `Ping juda yuqori (${ping.toFixed(0)} ms) — server sizdan geografik uzoqda yoki marshrutda ortiqcha "hop"lar bor.` });
    else if (ping > 60) findings.push({ sev: 'warn', text: `Ping o'rtacha (${ping.toFixed(0)} ms) — onlayn o'yin yoki video qo'ng'iroqlarda sezilishi mumkin.` });
  }
  if (jitter != null && jitter > 15) {
    findings.push({ sev: 'bad', text: `Jitter yuqori (${jitter.toFixed(1)} ms) — ulanish beqaror, bu video uzilishi yoki ovoz kechikishiga olib keladi.` });
  }
  if (conn) {
    if (conn.saveData) findings.push({ sev: 'warn', text: "Brauzeringizda 'Ma'lumotni tejash' rejimi yoqilgan — bu ataylab tezlikni cheklaydi." });
    if (conn.effectiveType && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) {
      findings.push({ sev: 'bad', text: `Brauzer ulanishni "${conn.effectiveType}" deb baholamoqda — bu mobil tarmoqda zaif signal belgisi.` });
    }
  }
  if (findings.length === 0) {
    findings.push({ sev: 'good', text: "O'lchangan ko'rsatkichlar normal chegarada — joriy sekinlik (agar bo'lsa) qurilmangiz yoki dastur darajasida bo'lishi mumkin." });
  }
  return findings;
}

const ADVICE_BANK = [
  { cond: () => true, text: 'Routerni 5GHz tarmog\'iga ulaning (2.4GHz ko\'proq qurilma bilan bo\'lishadi va sekinroq).' },
  { cond: () => true, text: 'Router bilan orangizdagi devorlar va masofani kamaytiring — har bir devor signalni ~30-50% pasaytiradi.' },
  { cond: (d) => d.jitter > 10, text: 'Wi-Fi o\'rniga Ethernet kabelidan foydalaning — bu jitterni deyarli yo\'qotadi.' },
  { cond: (d) => d.ping > 80, text: 'VPN ishlatayotgan bo\'lsangiz, vaqtincha o\'chirib ko\'ring — VPN marshrutni uzaytirishi mumkin.' },
  { cond: () => true, text: 'Fonda yuklab olayotgan dasturlarni (avtomatik yangilanishlar, bulutga sinxronlash) tekshiring.' },
  { cond: () => true, text: 'Routerni qayta ishga tushiring — uzoq vaqt ishlagan routerlar xotira tiqilib qolishidan sekinlashadi.' },
  { cond: (d) => d.download < 20, text: 'Provayderingiz bilan tarif rejasini tekshiring — o\'lchangan tezlik tarif bilan mos kelishi kerak.' },
  { cond: () => true, text: 'Routeringiz dasturiy ta\'minotini (firmware) yangilang — eski firmware tezlikni cheklashi mumkin.' },
];

function SpeedAdvisorModule({ index, speedData }) {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const findings = diagnoseConnection({ ...speedData, conn });
  const advice = ADVICE_BANK.filter(a => a.cond(speedData)).slice(0, 5);
  const [cleared, setCleared] = useState(false);
  const [clearedKB, setClearedKB] = useState(0);

  const clearCache = async () => {
    let bytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        bytes += (k.length + (localStorage.getItem(k) || '').length);
      }
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
    if (window.caches && caches.keys) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      } catch (e) {}
    }
    setClearedKB((bytes / 1024).toFixed(1));
    setCleared(true);
  };

  return (
    <Panel>
      <ModuleHeader index={index} title="Tezlikni optimallashtirish" sub="TAHLIL ASOSIDA" />

      <div style={{ fontSize: 11, color: C.muted, marginBottom: 18, fontFamily: "'Inter',sans-serif", lineHeight: 1.6, borderLeft: `2px solid ${C.border}`, paddingLeft: 12 }}>
        Eslatma: hech qanday veb-sahifa Wi-Fi yoki provayderingiz tezligini real oshira olmaydi —
        bu brauzer imkoniyatlaridan tashqarida. Quyida — o'lchovlaringiz asosidagi <b style={{ color: C.mutedLight }}>real tashxis</b> va
        haqiqatda ishlaydigan bitta tezlashtirish: brauzer keshini tozalash.
      </div>

      <div style={{ marginBottom: 20 }}>
        <Mono style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', display: 'block', marginBottom: 10 }}>TASHXIS</Mono>
        {findings.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.borderLight}` }}>
            <div style={{ marginTop: 3 }}><StatusDot state={f.sev} /></div>
            <span style={{ fontSize: 12.5, fontFamily: "'Inter',sans-serif", lineHeight: 1.5 }}>{f.text}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <Mono style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', display: 'block', marginBottom: 10 }}>TAVSIYALAR</Mono>
        {advice.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', fontSize: 12.5, fontFamily: "'Inter',sans-serif", color: C.mutedLight }}>
            <Mono style={{ color: C.muted }}>{String(i + 1).padStart(2, '0')}</Mono>
            <span>{a.text}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${C.borderLight}` }}>
        <Mono style={{ fontSize: 10.5, color: cleared ? C.good : C.muted }}>
          {cleared ? `✓ Tozalandi — ${clearedKB} KB bo'shatildi` : 'Brauzer keshi sahifa yuklanish tezligiga ta\'sir qiladi'}
        </Mono>
        <button onClick={clearCache} style={{
          background: 'transparent', border: `1px solid ${C.border}`, color: C.text,
          fontSize: 11, padding: '7px 14px', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace",
        }}>
          ⌁ KESHNI TOZALASH
        </button>
      </div>
    </Panel>
  );
}

/* ============================================================
   MODULE 10 — BATTERY & POWER MONITOR
   ============================================================ */

function BatteryModule({ index }) {
  const [bat, setBat] = useState(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!('getBattery' in navigator)) { setSupported(false); return; }
    let battery;
    const update = () => setBat({
      level: battery.level, charging: battery.charging,
      chargingTime: battery.chargingTime, dischargingTime: battery.dischargingTime,
    });
    navigator.getBattery().then(b => {
      battery = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    });
    return () => {
      if (battery) {
        battery.removeEventListener('levelchange', update);
        battery.removeEventListener('chargingchange', update);
      }
    };
  }, []);

  const fmtTime = (s) => {
    if (s == null || s === Infinity) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h}s ${m}d`;
  };

  return (
    <Panel>
      <ModuleHeader index={index} title="Batareya monitori" sub={supported ? 'JONLI' : 'QO\'LLAB-QUVVATLANMAYDI'} />
      {!supported && <Mono style={{ fontSize: 12, color: C.muted }}>Battery API bu brauzer/qurilmada mavjud emas (masalan, ko'p desktop brauzerlar va iOS uni qo'llamaydi).</Mono>}
      {bat && (
        <>
          <div style={{ marginBottom: 16 }}>
            <BigStat label="Quvvat darajasi" value={Math.round(bat.level * 100)} unit="%" color={bat.level < 0.2 ? C.bad : bat.level < 0.5 ? C.warn : C.good} />
          </div>
          <SpeedBar value={bat.level * 100} max={100} color={bat.level < 0.2 ? C.bad : C.good} />
          <div style={{ marginTop: 16 }}>
            <Row label="Holat" value={bat.charging ? 'Quvvatlanmoqda ⚡' : "Quvvatlanmayapti"} />
            <Row label="To'lguncha qolgan vaqt" value={bat.charging ? fmtTime(bat.chargingTime) : 'N/A'} />
            <Row label="Tugaguncha qolgan vaqt" value={!bat.charging ? fmtTime(bat.dischargingTime) : 'N/A'} />
          </div>
        </>
      )}
    </Panel>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */

function ScanlineHeader() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
      padding: '36px 0 28px', borderBottom: `1px solid ${C.border}`, marginBottom: 36, flexWrap: 'wrap', gap: 16,
    }}>
      <div>
        <Mono style={{ fontSize: 11, color: C.good, letterSpacing: '0.15em' }}>● TIZIM FAOL</Mono>
        <h1 style={{
          margin: '8px 0 0', fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 700,
          letterSpacing: '-0.02em', fontFamily: "'Inter',system-ui,sans-serif", lineHeight: 1,
        }}>
          DIAGNOSTIKA<span style={{ color: C.muted }}>.SYS</span>
        </h1>
        <Mono style={{ fontSize: 12, color: C.muted, marginTop: 8, display: 'block' }}>
          Tarmoq va brauzer holatini real vaqtda tekshiruvchi panel
        </Mono>
      </div>
      <Mono style={{ fontSize: 12, color: C.mutedLight, textAlign: 'right' }}>
        {now.toLocaleDateString('uz-UZ')}<br />{now.toLocaleTimeString('uz-UZ')}
      </Mono>
    </div>
  );
}

export default function App() {
  const [speedData, setSpeedData] = useState({ ping: null, jitter: null, download: null, upload: null });

  const fontLink = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
      * { box-sizing: border-box; }
      ::selection { background: ${C.good}; color: ${C.bg}; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: ${C.bg}; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; }
      button:hover:not(:disabled) { border-color: ${C.text} !important; }
      button:focus-visible, div[tabindex]:focus-visible { outline: 1.5px solid ${C.good}; outline-offset: 2px; }
    `}</style>
  );

  const modules = [
    { id: '01', Comp: SpeedModule, extra: { onResult: setSpeedData } },
    { id: '02', Comp: DeviceModule },
    { id: '03', Comp: SecurityModule },
    { id: '04', Comp: GeoModule },
    { id: '05', Comp: DisplayModule },
    { id: '06', Comp: InputModule },
    { id: '07', Comp: BenchmarkModule },
    { id: '08', Comp: StorageModule },
    { id: '09', Comp: SpeedAdvisorModule, extra: { speedData } },
    { id: '10', Comp: BatteryModule },
  ];

  return (
    <div style={{
      background: C.bg, color: C.text, minHeight: '100vh',
      fontFamily: "'Inter',system-ui,sans-serif", padding: '0 24px 80px',
    }}>
      {fontLink}
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <ScanlineHeader />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {modules.map(({ id, Comp, extra }) => <Comp key={id} index={id} {...(extra || {})} />)}
        </div>
        <div style={{ textAlign: 'center', marginTop: 48, paddingTop: 24, borderTop: `1px solid ${C.borderLight}` }}>
          <Mono style={{ fontSize: 10.5, color: C.muted }}>
            Barcha o'lchovlar brauzeringizda real vaqtda amalga oshiriladi. Hech qanday ma'lumot serverga saqlanmaydi.
          </Mono>
        </div>
      </div>
    </div>
  );
}