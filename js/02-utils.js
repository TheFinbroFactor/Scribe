function normalizeSubject(name){
  if (!name) return '';
  const k = String(name).toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,;:]+$/,'');
  return SUBJECT_ALIASES[k] || String(name).trim();
}

function detectSubject(text){
  if (!text) return '';
  const t = String(text).toLowerCase();
  const keys = Object.keys(SUBJECT_ALIASES).sort((a,b) => b.length - a.length);
  for (const alias of keys){
    let idx = t.indexOf(alias);
    while (idx !== -1){
      const before = idx === 0 ? ' ' : t[idx - 1];
      const after = t[idx + alias.length] || ' ';
      if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) return SUBJECT_ALIASES[alias];
      idx = t.indexOf(alias, idx + 1);
    }
  }
  return '';
}

function detectType(text){
  const t = String(text || '').toLowerCase();
  if (/\b(exam|exams|final exam|midterm|mid-term|end of year exam|assessment week|ncea external|external exam)\b/.test(t)) return 'Exam';
  if (/\b(test|tests|quiz|quizzes|spot test|unit test|topic test|assessment|internal|mock exam|practice exam|practice test)\b/.test(t)) return 'Test';
  if (/\b(project|portfolio|presentation|group project|inquiry|investigation)\b/.test(t)) return 'Project';
  if (/\b(homework|home work|hw|worksheet|exercise|practice|revision|read chapter|reading)\b/.test(t)) return 'Homework';
  if (/\b(assignment|coursework|task|activity|submit|hand in|hand-in|essay|report|lab report|submission)\b/.test(t)) return 'Assignment';
  if (/\b(assembly|mufti|sports day|athletics|carnival|excursion|trip|concert|production|fundraiser|book week|fete|open day|interview|holiday|term start|term end)\b/.test(t)) return 'Event';
  if (/\b(due|deadline|remember|don't forget|action required)\b/.test(t)) return 'Reminder';
  return 'Assignment';
}

const MONTH_MAP = { jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,
  jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,
  nov:10,november:10,dec:11,december:11 };
const MONTH_ABBR_RE = 'jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december';
const DOW_RE = 'sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat';
const DAY_ABBR = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };

function parseDate(text, ref = new Date()){
  if (!text) return null;
  const t = String(text).toLowerCase();
  const thisYear = ref.getFullYear();
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m){ const d = new Date(+m[1], +m[2]-1, +m[3], 23, 59); if (!isNaN(d.getTime())) return d.getTime(); }
  m = t.match(/\b(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?\b/);
  if (m){
    const a = +m[1], b = +m[2];
    let yr = m[3] ? +m[3] : thisYear; if (yr < 100) yr += 2000;
    let day = a, mon = b;
    if (a > 12 && b <= 12){ day = a; mon = b; } else if (b > 12 && a <= 12){ day = b; mon = a; }
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12){
      const d = new Date(yr, mon-1, day, 23, 59);
      if (!m[3] && d.getTime() < ref.getTime() - 30*86400000) d.setFullYear(d.getFullYear() + 1);
      return d.getTime();
    }
  }
  m = t.match(new RegExp(`\\b(?:(${DOW_RE})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ABBR_RE})(?:[,\\s]+(\\d{2,4}))?\\b`));
  if (m){
    const mon = MONTH_MAP[m[3]]; let yr = m[4] ? +m[4] : thisYear; if (yr < 100) yr += 2000;
    const d = new Date(yr, mon, +m[2], 23, 59);
    if (!m[4] && d.getTime() < ref.getTime() - 30*86400000) d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  m = t.match(new RegExp(`\\b(${MONTH_ABBR_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{2,4}))?\\b`));
  if (m){
    const mon = MONTH_MAP[m[1]]; let yr = m[3] ? +m[3] : thisYear; if (yr < 100) yr += 2000;
    const d = new Date(yr, mon, +m[2], 23, 59);
    if (!m[3] && d.getTime() < ref.getTime() - 30*86400000) d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  if (/\b(today|tonight)\b/.test(t)){ const d = new Date(ref); d.setHours(23,59,0,0); return d.getTime(); }
  if (/\b(tomorrow|tmrw|tmr)\b/.test(t)){ const d = new Date(ref); d.setDate(d.getDate()+1); d.setHours(23,59,0,0); return d.getTime(); }
  m = t.match(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/);
  if (m){
    const d = new Date(ref); const n = +m[1];
    if (/week/.test(m[2])) d.setDate(d.getDate() + n * 7);
    else if (/month/.test(m[2])) d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n);
    d.setHours(23,59,0,0);
    return d.getTime();
  }
  m = t.match(new RegExp(`\\b(${DOW_RE})\\b`));
  if (m){
    const target = DAY_ABBR[m[1].slice(0,3)];
    if (target !== undefined){
      const d = new Date(ref);
      let delta = (target - d.getDay() + 7) % 7; if (delta === 0) delta = 7;
      d.setDate(d.getDate() + delta); d.setHours(23, 59, 0, 0);
      return d.getTime();
    }
  }
  return null;
}

function startOfDay(d = new Date()){ const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); }

function daysUntil(ts){
  if (!ts) return null;
  const a = new Date();
  const b = new Date(ts);
  const aDay = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bDay = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bDay - aDay) / 86400000);
}

function dueLabel(ts){
  const d = daysUntil(ts);
  if (d === null) return { text:'No due date', cls:'ok' };
  if (d < 0){
    const n = Math.abs(d);
    return { text: n === 1 ? '1 day overdue' : `${n} days overdue`, cls:'overdue' };
  }
  if (d === 0) return { text:'Due today', cls:'overdue' };
  if (d === 1) return { text:'Due tomorrow', cls:'soon' };
  if (d <= 7) return { text:`Due in ${d} days`, cls:'soon' };
  return { text:`Due ${fmtDate(ts)}`, cls:'ok' };
}

function computePriority(item){
  const d = daysUntil(item.dueDate);
  let p = 'low';
  if (d !== null){
    if (d < 0 || d === 0 || d === 1) p = 'urgent';
    else if (d <= 3) p = 'high';
    else if (d <= 7) p = 'medium';
  }
  if (item.type === 'Test' || item.type === 'Exam'){
    p = p === 'urgent' ? 'urgent' : p === 'high' ? 'urgent' : p === 'medium' ? 'high' : 'medium';
  }
  if (item.type === 'Project' && p === 'low') p = 'medium';
  return p;
}

function estimateMinutes(item){
  switch(item.type){
    case 'Exam': return 180;
    case 'Test': return 90;
    case 'Project': return 150;
    case 'Assignment': return 60;
    case 'Homework': return 40;
    default: return 25;
  }
}

/* ── Icons ───────────────────────────────────────────────── */
const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  chart: `<svg ${S}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  trend: `<svg ${S}><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>`,
  bell: `<svg ${S}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  search: `<svg ${S}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  link: `<svg ${S}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  upload: `<svg ${S}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  pin: `<svg ${S}><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-6V5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v6z"/></svg>`,
  user: `<svg ${S}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  palette: `<svg ${S}><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
  mail: `<svg ${S}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  alert: `<svg ${S}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  edit: `<svg ${S}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg ${S}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  zap: `<svg ${S}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  book: `<svg ${S}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  bulb: `<svg ${S}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A6 6 0 1 0 7.5 11.5c.76.76 1.23 1.52 1.41 2.5"/></svg>`,
  folder: `<svg ${S}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  check: `<svg ${S}><polyline points="20 6 9 17 4 12"/></svg>`,
  calendar: `<svg ${S}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  target: `<svg ${S}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  file: `<svg ${S}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
  fileText: `<svg ${S}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  refresh: `<svg ${S}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  info: `<svg ${S}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

/* ── Helpers ─────────────────────────────────────────────── */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
const now = () => Date.now();

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function sanitiseText(input, maxLen = 4000){
  if (!input) return '';
  let s = String(input);
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
  s = s.replace(/\s+/g,' ').trim();
  return s.slice(0, maxLen);
}
function fmtDate(ts){ if (!ts) return ''; return new Date(ts).toLocaleDateString(undefined, { day:'numeric', month:'short' }); }
function fmtDateLong(ts){ if (!ts) return ''; return new Date(ts).toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'long' }); }
function relativeTime(ts){
  if (!ts) return 'never';
  const diff = now() - ts;
  if (diff < 45_000) return 'just now';
  const m = Math.round(diff/60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m/60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h/24);
  if (d < 7) return `${d} day${d>1?'s':''} ago`;
  return fmtDate(ts);
}
function monthMatrix(year, month){
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const cells = [];
  for (let i = 0; i < 42; i++){ const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); }
  return cells;
}
function ratingClass(r){
  r = Math.round(r || 0);
  if (r <= 1) return 'r1';
  if (r === 2) return 'r2';
  if (r === 3) return 'r3';
  if (r === 4) return 'r4';
  return 'r5';
}
function ratingColor(v){
  const n = Math.round(v || 0);
  if (n <= 1) return '#ef4444';
  if (n === 2) return '#f97316';
  if (n === 3) return '#eab308';
  if (n === 4) return '#84cc16';
  return '#10b981';
}
function svgPointColor(r){
  return ratingColor(r);
}

const TITLE_PREFIX_RE = /^\s*(?:re|fw|fwd)\s*:\s*|^\s*\[[^\]]{1,60}\]\s*|^\s*(?:new|updated)\s+(?:assignment|material|announcement|question|quiz|test)\s*(?:posted|created|added)?\s*:?\s*/gi;
function stripTitlePrefixes(s){
  let t = String(s || '');
  for (let i = 0; i < 3; i++){
    const next = t.replace(TITLE_PREFIX_RE, '');
    if (next === t) break;
    t = next;
  }
  return t.trim();
}
function normalizeTitle(s){
  return stripTitlePrefixes(s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

function toast(msg, type='info', title=''){
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? ICON.check : type === 'error' ? ICON.alert : ICON.info;
  el.innerHTML = `<div class="toast-ico">${icon}</div>
    <div>${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}<div class="toast-msg">${escapeHtml(msg)}</div></div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, type === 'error' ? 9000 : 4500);
}

function openModal({ title, subtitle='', body, footer='', wide=false, xl=false, onMount }){
  const root = $('#modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal ${xl ? 'xl' : wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div style="flex:1"><h3>${escapeHtml(title)}</h3>${subtitle ? `<div class="modal-sub">${escapeHtml(subtitle)}</div>` : ''}</div>
        <button class="modal-close" data-close aria-label="Close">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  const onKey = e => { if (e.key === 'Escape'){ close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  if (onMount) onMount(back, close);
  return { el: back, close };
}

function confirmDialog(title, message, confirmLabel='Confirm', danger=false){
  return new Promise(resolve => {
    openModal({
      title,
      body: `<p style="font-size:14px;line-height:1.65;color:var(--text-2)">${escapeHtml(message)}</p>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger?'btn-danger':'btn-primary'}" id="cf-ok">${escapeHtml(confirmLabel)}</button>`,
      onMount(el, closeFn){
        $('#cf-ok', el).addEventListener('click', () => { closeFn(); resolve(true); });
        el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) resolve(false); });
      }
    });
  });
}
