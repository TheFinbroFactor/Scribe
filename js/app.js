/* ================================================================
   SCRIBE — student dashboard on the local SQLite backend
   ================================================================ */

import {
  CURRICULUM, JUNIOR_LEARNING_AREAS, JUNIOR_RESULT_SUBJECTS, JUNIOR_TARGETS, SCHOLARSHIP_SUBJECTS,
  subjectsForYear, defaultSubjectsForYear, predecessorsFor, successorsFor, nodesForYear,
  entryCriteriaFor, pathwayChain, reachableFrom
} from './academic-data.js';

const LS_CONFIG = 'scribe.config.v1';
const LS_SESSION = 'scribe.session.v1';
const LS_DATA = uid => `scribe.data.${uid}.v1`;
const LEGACY_LS_DATA = uid => `studentos.data.${uid}.v1`; // local-mode data saved before the rename
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Used only when requesting Google API access after the account login.
const CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly'
];
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly'
];
const GOOGLE_SCOPES = [...CLASSROOM_SCOPES, ...GMAIL_SCOPES];

// Google configuration and school branding come from the Scribe server.
let SCHOOL_CONFIG = null;
const DEFAULT_CALENDAR_SUBSCRIPTIONS = [];

const DEFAULT_SETTINGS = {
  theme: 'light',
  timetable: [],
  weeklyActivities: [],
  calendarSubscriptions: [],
  notifyNewAssignment: true,
  notifyDueSoon: true,
  notifyNewTest: true,
  notifyAnnouncements: true,
  onboardingSeen: false,
  trustedDomains: [],
  trustedSenders: [],
  emailLookbackDays: 30,
  enableClassroom: true,
  enableGmail: true,
  effortSubjects: ['Maths','English','Science','History','PE','Art','Music','Technology'],
  sidebarFeatures: ['assignments','calendar','weekly','effort','planner','pathways','results','integrations']
};

const SUBJECTS = ['Maths','Mathematics','English','Science','Biology','Chemistry','Physics',
  'History','Geography','Economics','Business','Accounting','Art','Music','Drama','PE',
  'Physical Education','Health','Computing','Computer Science','ICT','Digital Technology',
  'Technology','Languages','French','Spanish','German','Japanese','Maori','Te Reo Maori',
  'Social Studies','Media Studies','Design','Graphics','Food Technology','Woodwork','Stats'];

const SUBJECT_ALIASES = {
  'pe': 'PE & Health','p.e.': 'PE & Health','p.e': 'PE & Health','phys ed': 'PE & Health','physed': 'PE & Health',
  'physical education': 'PE & Health','physical education and health': 'PE & Health','physical ed': 'PE & Health',
  'pe & health': 'PE & Health','pe and health': 'PE & Health','pe/health': 'PE & Health','health': 'PE & Health',
  'health and physical education': 'PE & Health','hpe': 'PE & Health',
  'math': 'Mathematics','maths': 'Mathematics','mathematics': 'Mathematics','maths methods': 'Mathematics','mathematics methods': 'Mathematics',
  'english': 'English','eng': 'English','science': 'Science','sci': 'Science',
  'biology': 'Biology','bio': 'Biology','chemistry': 'Chemistry','chem': 'Chemistry',
  'physics': 'Physics','phys': 'Physics','history': 'History','hist': 'History',
  'geography': 'Geography','geo': 'Geography','social studies': 'Social Studies','social science': 'Social Studies',
  'social sciences': 'Social Studies','soc sci': 'Social Studies','sst': 'Social Studies',
  'economics': 'Economics','econ': 'Economics','eco': 'Economics','accounting': 'Accounting','acc': 'Accounting',
  'accnt': 'Accounting','acct': 'Accounting','business': 'Business','business studies': 'Business','busn': 'Business',
  'commerce': 'Commerce'
};

const STOP_WORDS = new Set(['the','and','for','with','this','that','from','your','you','are','was','have','has','will','due','a','an','of','to','in','on','at','by','is','it','be','or','as','please','complete','finish','submit','work','task','activity','week','term','day','new','all']);

/* ── Subject detection ───────────────────────────────────────
   Used by Classroom sync, Gmail sync, Smart Paste and imports. */
const COURSE_CODE_SUBJECTS = {
  ENG:'English', ENX:'English', EN2:'English', ESS:'English', EAL:'English as an Additional Language',
  MAT:'Mathematics', MAX:'Mathematics', MAC:'Mathematics', MAS:'Mathematics', MAA:'Mathematics', MTH:'Mathematics',
  SCI:'Science', SCX:'Science', BSC:'Science', PSC:'Science', AGS:'Science',
  BIO:'Biology', BSS:'Biology', CHE:'Chemistry', CSS:'Chemistry', PHY:'Physics', PES:'Physics',
  SOS:'Social Studies', SST:'Social Studies', RST:'Religious Education', RSS:'Religious Education', RED:'Religious Education',
  PED:'PE & Health', PEA:'PE & Health', PEB:'PE & Health', HPE:'PE & Health', SLS:'Sports Leadership',
  COM:'Commerce', ACC:'Accounting', ECO:'Economics', BUS:'Business', GEO:'Geography', HIS:'History', CLS:'Classical Studies',
  MED:'Media Studies', DRA:'Drama', MUS:'Music', MUI:'Music', ART:'Art', DES:'Art', PNT:'Art', PHO:'Photography',
  MAO:'Te Reo Maori', SPA:'Spanish', CHI:'Chinese', CSC:'Computer Science', ICT:'ICT', DVC:'Design',
  MTE:'Technology', CAR:'Carpentry', HOS:'Hospitality', FDT:'Food Technology', STE:'STEAM'
};
function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** "10MAT", "9ENG2" or "11PSC – Mr Smith" → subject name, otherwise ''. */
function subjectFromCourseCode(text){
  const m = String(text || '').toUpperCase().match(/(?:^|[^A-Z0-9])(?:[7-9]|1[0-3])\s?([A-Z]{3})[A-Z0-9]?(?![A-Z])/);
  return m ? (COURSE_CODE_SUBJECTS[m[1]] || '') : '';
}

/** Tidy a subject or course name into the name Scribe uses for it. */
function normalizeSubject(name){
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const fromCode = subjectFromCourseCode(raw);
  if (fromCode) return fromCode;
  const cleaned = raw.replace(/^(?:year|yr|y)\s*\d{1,2}\s*[-–:]?\s*/i, '').trim() || raw;
  return SUBJECT_ALIASES[cleaned.toLowerCase()] || cleaned;
}

/** Find a subject mentioned anywhere in a piece of text, otherwise ''. */
let _subjectMatchers = null;
function detectSubject(text){
  const hay = String(text || '');
  if (!hay.trim()) return '';
  if (!_subjectMatchers){
    const names = [...new Set([...KNOWN_SUBJECTS, ...SUBJECTS])];
    const aliases = Object.keys(SUBJECT_ALIASES).filter(a => a.length >= 4 && !/[.]/.test(a));
    _subjectMatchers = [
      ...names.map(n => ({ name: n, len: n.length, re: new RegExp(`(?:^|[^A-Za-z])${escapeRegExp(n)}(?![A-Za-z])`, n === n.toUpperCase() ? '' : 'i') })),
      ...aliases.map(a => ({ name: SUBJECT_ALIASES[a], len: a.length, re: new RegExp(`(?:^|[^A-Za-z])${escapeRegExp(a)}(?![A-Za-z])`, 'i') }))
    ].sort((a, b) => b.len - a.len);
  }
  for (const m of _subjectMatchers){ if (m.re.test(hay)) return m.name; }
  return subjectFromCourseCode(hay);
}

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
/** yyyy-mm-dd in the student's own time zone, for <input type="date">. */
function dateInputValue(ts = Date.now()){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDate(ts){ if (!ts) return ''; return new Date(ts).toLocaleDateString(undefined, { day:'numeric', month:'short' }); }
function fmtDateLong(ts){ if (!ts) return ''; return new Date(ts).toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'long' }); }
function fmtTime(ts){ if (!ts) return ''; return new Date(ts).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' }); }
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
function startOfDay(d = new Date()){ const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); }
function daysUntil(ts){ if (!ts) return null; return Math.round((startOfDay(new Date(ts)) - startOfDay()) / 86400000); }
function dueLabel(ts){
  const d = daysUntil(ts);
  if (d === null) return { text:'No due date', cls:'ok' };
  if (d < 0)  return { text:`${Math.abs(d)} day${Math.abs(d)>1?'s':''} overdue`, cls:'overdue' };
  if (d === 0) return { text:'Due today', cls:'overdue' };
  if (d === 1) return { text:'Due tomorrow', cls:'soon' };
  if (d <= 7) return { text:`Due in ${d} days`, cls:'soon' };
  return { text:`Due ${fmtDate(ts)}`, cls:'ok' };
}
function isoWeekKey(ts){
  const d = new Date(ts);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return { year: t.getUTCFullYear(), week, key: `${t.getUTCFullYear()}-W${String(week).padStart(2,'0')}` };
}
function sameDay(a, b){ return startOfDay(new Date(a)) === startOfDay(new Date(b)); }
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
function normalizeTitle(s){
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
}
function timeToMin(t){
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minToTime(m){
  return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
}

function toast(msg, type='info', title=''){
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { info:'ℹ️', success:'✅', error:'⚠️', warn:'⏳' };
  el.innerHTML = `
    <div class="toast-ico">${icons[type]||'ℹ️'}</div>
    <div>${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}<div class="toast-msg">${escapeHtml(msg)}</div></div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, type === 'error' ? 7000 : 4200);
}

function openModal({ title, subtitle='', body, footer='', wide=false, xl=false, onMount }){
  const root = $('#modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal ${xl ? 'xl' : wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div style="flex:1"><h3>${escapeHtml(title)}</h3>${subtitle ? `<div class="modal-sub">${escapeHtml(subtitle)}</div>` : ''}</div>
        <button class="modal-close" data-close aria-label="Close">✕</button>
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

function schoolHintFromUrl(){
  try { return new URLSearchParams(location.search).get('school')?.trim().toLowerCase() || ''; } catch { return ''; }
}
function schoolForUi(){
  return App?.school || SCHOOL_CONFIG || null;
}
function schoolNameForUi(){
  return schoolForUi()?.name || 'your school';
}
async function loadServerGoogleConfig(schoolSlug=''){
  try {
    const hint = schoolSlug || App?.user?.school?.slug || schoolHintFromUrl();
    const qs = hint ? `?school=${encodeURIComponent(hint)}` : '';
    const r = await fetch(`/api/auth/google-config${qs}`, { credentials:'same-origin' });
    if (!r.ok) return { googleClientId:'', school:SCHOOL_CONFIG, schools:App?.availableSchools || [] };
    const body = await r.json();
    SCHOOL_CONFIG = body.school || null;
    if (typeof App !== 'undefined') App.availableSchools = body.schools || [];
    return { googleClientId: body.clientId || '', school: body.school || null, schools: body.schools || [] };
  } catch {
    return { googleClientId:'', school:SCHOOL_CONFIG, schools:App?.availableSchools || [] };
  }
}


async function apiFetch(path, options = {}){
  const opts = { credentials: 'same-origin', ...options };
  opts.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const r = await fetch(`/api${path}`, opts);
  let body = null;
  try { body = await r.json(); } catch {}
  if (!r.ok){
    const err = new Error(body?.error || `Request failed (${r.status})`);
    err.status = r.status;
    err.code = body?.code || '';
    err.payload = body || {};
    throw err;
  }
  return body;
}

/* ── Google Services token manager ─────────────────────────── */
const GoogleServices = {
  accessToken: null, expiresAt: 0, scopes: [], tokenClient: null, clientId: '', _scopeKey: '', ready: false,
  setToken(token, expiresIn, scopes){
    this.accessToken=token; this.expiresAt=now() + (Number(expiresIn||3600)*1000) - 30000; this.scopes=scopes||[];
    try{ sessionStorage.setItem('scribe.gtoken', JSON.stringify({t:token,e:this.expiresAt,s:this.scopes})); }catch{}
  },
  restore(){
    try{ const raw=sessionStorage.getItem('scribe.gtoken'); if(!raw) return false; const {t,e,s}=JSON.parse(raw); if(e>now()+5000){ this.accessToken=t; this.expiresAt=e; this.scopes=s||[]; return true; } }catch{}
    return false;
  },
  clear(){ this.accessToken=null; this.expiresAt=0; this.scopes=[]; this.tokenClient=null; this.ready=false; try{ sessionStorage.removeItem('scribe.gtoken'); }catch{} },
  has(scopes){
    if(!this.accessToken || this.expiresAt<=now()+5000) return false;
    if(!scopes?.length) return true;
    const have=new Set(this.scopes); return scopes.every(s=>have.has(s));
  },
  async waitForLib(timeout=10000){
    const t0=Date.now(); while(!(window.google?.accounts?.oauth2) && Date.now()-t0<timeout) await new Promise(r=>setTimeout(r,120));
    return !!window.google?.accounts?.oauth2;
  },
  async ensureClient(clientId, scopes){
    if(!clientId) throw new Error('Google Client ID is not configured on this Scribe server.');
    if(!(await this.waitForLib())) throw new Error('Google Identity Services failed to load.');
    const scopeKey=[...scopes].sort().join(' ');
    if(this.tokenClient && this._scopeKey===scopeKey && this.clientId===clientId) return;
    this.clientId=clientId; this._scopeKey=scopeKey; this.scopes=scopes;
    this.tokenClient=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:scopeKey,callback:()=>{}});
    this.ready=true;
  },
  requestToken(){
    return new Promise((resolve,reject)=>{
      if(!this.tokenClient) return reject(new Error('Google OAuth is not initialised.'));
      this.tokenClient.callback=(resp)=>{
        if(resp?.error) return reject(new Error(resp.error_description || resp.error));
        this.setToken(resp.access_token, resp.expires_in || 3600, this.scopes); resolve(resp.access_token);
      };
      this.tokenClient.error_callback=(err)=>reject(new Error(err?.message || 'Google access was cancelled.'));
      try{ this.tokenClient.requestAccessToken({prompt:''}); }catch(e){ reject(e); }
    });
  },
  async getToken(scopes=GOOGLE_SCOPES,{interactive=true}={}){
    const cfg=await loadServerGoogleConfig(App?.user?.school?.slug || SCHOOL_CONFIG?.slug || '');
    await this.ensureClient(cfg.googleClientId,scopes);
    if(this.accessToken && this.has(scopes)) return this.accessToken;
    if(!interactive) throw new Error('NEEDS_CONSENT');
    return this.requestToken();
  }
};

/* ── Google API fetcher ───────────────────────────────────── */
async function gfetchJson(url, token){
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new Error('TOKEN_EXPIRED');
  if (r.status === 403){
    const txt = await r.text().catch(() => '');
    if (/insufficient|scope|permission/i.test(txt)) throw new Error('INSUFFICIENT_SCOPE');
    if (/disabled|blocked|denied|not.?enabled|forbidden/i.test(txt)) throw new Error('ACCESS_BLOCKED');
    throw new Error(`Google API 403: ${txt.slice(0, 140)}`);
  }
  if (r.status === 429) throw new Error('RATE_LIMITED');
  if (!r.ok){
    const txt = await r.text().catch(() => '');
    throw new Error(`Google API ${r.status}: ${txt.slice(0, 140)}`);
  }
  return r.json();
}

/* ── Classroom API sync ───────────────────────────────────── */
async function syncClassroom({ interactive=true } = {}){
  const token = await GoogleServices.getToken(CLASSROOM_SCOPES, { interactive });

  const coursesResp = await gfetchJson(
    'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=100',
    token
  );
  const courses = coursesResp.courses || [];
  Store.cache.courses = courses.map(c => ({
    id: c.id, name: c.name, section: c.section || '',
    room: c.room || '', ownerId: c.ownerId || '',
    updatedAt: now()
  }));

  const raw = [];
  for (const c of courses){
    try {
      let pageToken = '';
      let pages = 0;
      do {
        const url = `https://classroom.googleapis.com/v1/courses/${c.id}/courseWork?courseWorkStates=PUBLISHED&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const cw = await gfetchJson(url, token);
        for (const w of (cw.courseWork || [])){
          const due = w.dueDate
            ? new Date(
                w.dueDate.year,
                (w.dueDate.month || 1) - 1,
                w.dueDate.day || 1,
                w.dueTime?.hours ?? 23,
                w.dueTime?.minutes ?? 59
              ).getTime()
            : null;
          raw.push({
            id: `gc-${w.id}`,
            externalId: w.id,
            courseId: c.id,
            title: w.title || 'Coursework',
            description: w.description || '',
            dueDate: due,
            subject: normalizeSubject(c.name),
            typeHint: mapWorkType(w.workType),
            url: w.alternateLink || '',
            source: 'Google Classroom'
          });
        }
        pageToken = cw.nextPageToken || '';
        pages++;
      } while (pageToken && pages < 5);
    } catch (e){
      console.warn(`Failed to read course ${c.name}:`, e.message);
    }
  }

  const r = await importItems(raw, 'Google Classroom');
  Store.cache.integrations.classroom = {
    id: 'classroom', connected: true, lastSync: now(), method: 'api',
    imported: Store.all('assignments').filter(a => (a.sources||[]).some(s => s.source === 'Google Classroom')).length,
    courses: courses.length
  };
  await Store.saveUserDoc();
  return { added: r.added, merged: r.merged, courses: courses.length };
}

function mapWorkType(w){
  switch (w){
    case 'ASSIGNMENT': return 'Assignment';
    case 'SHORT_ANSWER_QUESTION':
    case 'MULTIPLE_CHOICE_QUESTION': return 'Homework';
    default: return null;
  }
}

/* ── Gmail API sync ───────────────────────────────────────── */
function buildGmailQuery(){
  const s = Store.cache.settings;
  const parts = [];
  if (s.trustedDomains?.length){
    parts.push('(' + s.trustedDomains.map(d => `from:${d}`).join(' OR ') + ')');
  } else if (s.trustedSenders?.length){
    parts.push('(' + s.trustedSenders.map(d => `from:${d}`).join(' OR ') + ')');
  } else {
    parts.push('(subject:(homework OR assignment OR test OR exam OR quiz OR project OR due OR deadline OR notice OR reminder OR important OR newsletter OR assessment))');
  }
  parts.push(`newer_than:${Math.max(1, Number(s.emailLookbackDays) || 30)}d`);
  return parts.join(' ');
}

function parseGmailMessage(msg){
  const headers = msg.payload?.headers || [];
  const get = n => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';
  const subject = sanitiseText(get('Subject'), 220);
  const from = sanitiseText(get('From'), 200);
  const date = Number(msg.internalDate) || now();

  let body = '';
  const walk = part => {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data){
      body += base64UrlDecode(part.body.data) + '\n';
    } else if (part.parts){
      part.parts.forEach(walk);
    }
  };
  walk(msg.payload);
  if (!body && msg.payload?.body?.data) body = base64UrlDecode(msg.payload.body.data);
  if (!body && msg.snippet) body = msg.snippet;

  return { subject, from, date, body: sanitiseText(body, 3000) };
}

function base64UrlDecode(data){
  try {
    const s = data.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
}

async function importNotices(rawItems, sourceLabel){
  let count = 0;
  for (const raw of rawItems){
    const title = sanitiseText(raw.title, 220) || 'Notice';
    const body = sanitiseText(raw.description, 4000);
    const date = raw.date || parseDate(`${title} ${body}`) || now();
    const wk = isoWeekKey(date);
    const note = {
      id: raw.id || uid(), title, body, date, weekKey:wk.key, weekNumber:wk.week, weekYear:wk.year,
      source:sourceLabel, url:raw.url || '', kind:raw.kind || 'Notice', read:false, important:false, saved:false, createdAt:now()
    };
    const exists = Store.all('weeklyNotes').some(n => n.title === note.title && Math.abs((n.date || 0) - note.date) < 3*86400000);
    if (!exists){ await Store.put('weeklyNotes', note); count++; }
  }
  return count;
}

async function syncGmail({ interactive=true } = {}){
  const token = await GoogleServices.getToken(GMAIL_SCOPES, { interactive });
  const q = buildGmailQuery();

  const list = await gfetchJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=40&q=${encodeURIComponent(q)}`,
    token
  );
  const ids = (list.messages || []).map(m => m.id);

  const rawAssignments = [];
  const rawNotices = [];
  for (const id of ids){
    try {
      const msg = await gfetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, token);
      const parsed = parseGmailMessage(msg);
      if (!parsed) continue;
      const haystack = `${parsed.subject} ${parsed.body}`;
      const type = detectType(haystack);
      const hasDeadline = /\b(due|deadline|by \w+day|hand in|submit|exam|test|assessment)\b/i.test(haystack);
      const isNotice = ['Notice','Announcement','Event','Newsletter'].includes(type);
      if (isNotice){
        rawNotices.push({
          id:`notice-${id}`, title:parsed.subject || 'School notice', description:(parsed.from ? `From ${parsed.from}\n\n` : '') + parsed.body.slice(0, 2800),
          date:parsed.date, url:`https://mail.google.com/mail/u/0/#inbox/${id}`, kind:type
        });
      }
      if (!hasDeadline && !['Assignment','Homework','Test','Exam','Project','Reminder'].includes(type)) continue;

      rawAssignments.push({
        id: `gm-${id}`,
        title: parsed.subject || 'Email',
        description: (parsed.from ? `From ${parsed.from}\n\n` : '') + parsed.body.slice(0, 1500),
        dueDate: parseDate(haystack, new Date(parsed.date)),
        url: `https://mail.google.com/mail/u/0/#inbox/${id}`,
        typeHint: type === 'Reminder' ? null : type,
        subject: detectSubject(haystack),
        source: 'Email'
      });
    } catch (e){
      console.warn(`Failed to read message ${id}:`, e.message);
    }
  }

  const r = await importItems(rawAssignments, 'Email');
  const notices = await importNotices(rawNotices, 'Email');
  Store.cache.integrations.email = {
    id: 'email', connected: true, lastSync: now(),
    imported: Store.all('assignments').filter(x => (x.sources||[]).some(s => s.source === 'Email')).length,
    notices: Store.all('weeklyNotes').filter(x => x.source === 'Email').length,
    scanned: ids.length,
    query: q
  };
  await Store.saveUserDoc();
  return { added: r.added, merged: r.merged, notices, scanned: ids.length };
}

/* ── Store ─────────────────────────────────────────────────── */
const Store = {
  uid: null, mode: 'server', cache: null, _saveTimer: null,

  async init(user){
    this.uid = user.uid;
    if (user.real){
      this.mode = 'server';
      if (user.school?.slug) {
        const cfg = await loadServerGoogleConfig(user.school.slug);
        SCHOOL_CONFIG = cfg.school || null;
      } else {
        // Global administrators can exist without belonging to a school.
        SCHOOL_CONFIG = null;
      }
      const result = await apiFetch('/data');
      this.cache = result.data || emptyData();
    } else {
      this.mode = 'local';
      SCHOOL_CONFIG = null;
      let raw = null;
      try { raw = localStorage.getItem(LS_DATA(this.uid)) ?? localStorage.getItem(LEGACY_LS_DATA(this.uid)); } catch {}
      try { this.cache = raw ? JSON.parse(raw) : emptyData(); } catch { this.cache = emptyData(); }
      if (!raw && user.uid === 'demo-user') this.cache = seedDemoData();
      this.persistNow();
    }
    this.ensureShape();
    ensureBuiltinCalendar(this.cache);
    return this.cache;
  },

  ensureShape(){
    const d = this.cache;
    for (const k of ['assignments','events','weeklyNotes','notifications','courses','studySessions','effortReports','results']){
      if (!Array.isArray(d[k])) d[k] = [];
    }
    if (!d.integrations || typeof d.integrations !== 'object') d.integrations = {};
    if (!d.settings) d.settings = { ...DEFAULT_SETTINGS };
    const schoolDefaults = {};
    if (Array.isArray(SCHOOL_CONFIG?.defaultSidebarFeatures)) schoolDefaults.sidebarFeatures = SCHOOL_CONFIG.defaultSidebarFeatures;
    if (typeof SCHOOL_CONFIG?.enableClassroom === 'boolean') schoolDefaults.enableClassroom = SCHOOL_CONFIG.enableClassroom;
    if (typeof SCHOOL_CONFIG?.enableGmail === 'boolean') schoolDefaults.enableGmail = SCHOOL_CONFIG.enableGmail;
    d.settings = { ...DEFAULT_SETTINGS, ...schoolDefaults, ...d.settings };
    if (!Array.isArray(d.settings.calendarSubscriptions)) d.settings.calendarSubscriptions = [];
    if (!Array.isArray(d.settings.timetable)) d.settings.timetable = [];
    if (!Array.isArray(d.settings.weeklyActivities)) d.settings.weeklyActivities = [];
    if (!Array.isArray(d.settings.effortSubjects)) d.settings.effortSubjects = [...DEFAULT_SETTINGS.effortSubjects];
    if (!Array.isArray(d.settings.sidebarFeatures)) d.settings.sidebarFeatures = [...DEFAULT_SETTINGS.sidebarFeatures];
    if (!d.profile) d.profile = {};
    if (!d.settings.navigationV2Added){
      d.settings.sidebarFeatures = [...new Set([...(d.settings.sidebarFeatures || []), 'pathways', 'results'])];
      d.settings.navigationV2Added = true;
    }
  },

  persistNow(){
    if (this.mode === 'local' && this.uid){
      try { localStorage.setItem(LS_DATA(this.uid), JSON.stringify(this.cache)); } catch(e){ console.warn(e); }
    }
  },
  persist(){
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (this.mode === 'local') this.persistNow();
      else this.saveUserDoc().catch(e => console.warn('User data save failed', e));
    }, 220);
  },
  all(c){ return this.cache[c] || []; },
  get(c, id){ return this.all(c).find(x => x.id === id) || null; },

  async put(collection, doc){
    const arr = this.cache[collection];
    const idx = arr.findIndex(x => x.id === doc.id);
    const record = { ...doc, updatedAt: now() };
    if (idx >= 0) arr[idx] = { ...arr[idx], ...record };
    else arr.push({ createdAt: now(), ...record });
    if (this.mode === 'local') this.persist();
    else await apiFetch(`/data/${encodeURIComponent(collection)}/${encodeURIComponent(doc.id)}`, { method:'PUT', body: JSON.stringify(arr.find(x => x.id === doc.id)) });
    return arr.find(x => x.id === doc.id);
  },

  async remove(collection, id){
    this.cache[collection] = this.all(collection).filter(x => x.id !== id);
    if (this.mode === 'local') this.persist();
    else await apiFetch(`/data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { method:'DELETE' });
  },

  async removeAll(){
    const cols = ['assignments','events','weeklyNotes','notifications','courses','studySessions','effortReports','results'];
    for (const k of cols) this.cache[k] = [];
    this.cache.integrations = {};
    if (this.mode === 'local') this.persistNow();
    else await apiFetch('/data', { method:'DELETE' });
  },

  async saveUserDoc(){
    if (this.mode !== 'server') return;
    await apiFetch('/user', {
      method:'PUT',
      body: JSON.stringify({ settings:this.cache.settings, integrations:this.cache.integrations, profile:this.cache.profile })
    });
  }
};

function ensureBuiltinCalendar(cache){
  const configured = (SCHOOL_CONFIG?.calendarSubscriptions || DEFAULT_CALENDAR_SUBSCRIPTIONS).filter(x => x?.url);
  const existing = Array.isArray(cache.settings.calendarSubscriptions) ? cache.settings.calendarSubscriptions : [];
  const configuredIds = new Set(configured.map(x => x.id));
  const custom = existing.filter(x => !x.builtin || configuredIds.has(x.id));
  const built = configured.map((item, index) => {
    const old = existing.find(x => x.id === item.id || x.url === item.url);
    return {
      id: item.id || `school-calendar-${index+1}`,
      name: item.name || 'School Calendar',
      url: item.url,
      builtin: true,
      lastSync: old?.lastSync || null,
      count: old?.count || 0,
      error: old?.error || null
    };
  });
  cache.settings.calendarSubscriptions = [...built, ...custom.filter(x => !x.builtin)];
}

async function fetchCalendarUrl(url){
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (r.ok) return r;
    if (r.status >= 400 && r.status < 500) throw new Error(`HTTP ${r.status}`);
  } catch(e){}
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const r2 = await fetch(proxyUrl, { redirect: 'follow' });
    if (r2.ok) return r2;
    throw new Error(`HTTP ${r2.status} (via proxy)`);
  } catch(e2){
    throw new Error(`Could not reach the calendar. ${e2.message}`);
  }
}

function emptyData(){
  return {
    assignments: [], events: [], weeklyNotes: [], notifications: [],
    courses: [], studySessions: [], effortReports: [], results: [],
    integrations: {}, settings: { ...DEFAULT_SETTINGS }, profile: {}
  };
}

async function dedupeExistingEvents(){
  const events = Store.all('events');
  const seen = new Map();
  const toRemove = [];
  for (const event of events){
    if (!event.start) continue;
    const dayKey = startOfDay(new Date(event.start));
    const normalized = normalizeTitle(event.title);
    const key = `${normalized}|${dayKey}`;
    if (seen.has(key)){
      const existing = seen.get(key);
      const existingScore = (existing.description?.length || 0) + (existing.url ? 10 : 0) + (existing.location ? 5 : 0);
      const newScore = (event.description?.length || 0) + (event.url ? 10 : 0) + (event.location ? 5 : 0);
      if (newScore > existingScore){ toRemove.push(existing.id); seen.set(key, event); }
      else { toRemove.push(event.id); }
    } else { seen.set(key, event); }
  }
  for (const id of toRemove) await Store.remove('events', id);
  return toRemove.length;
}

async function dedupeExistingAssignments(){
  const items = Store.all('assignments');
  const seen = new Map();
  const toRemove = [];
  for (const item of items){
    if (!item.dueDate) continue;
    const dayKey = startOfDay(new Date(item.dueDate));
    const normalized = normalizeTitle(item.title);
    const key = `${normalized}|${dayKey}`;
    if (seen.has(key)){
      const existing = seen.get(key);
      const existingScore = (existing.manual ? 100 : 0) + (existing.sources?.length || 0) * 5 + (existing.description?.length || 0);
      const newScore = (item.manual ? 100 : 0) + (item.sources?.length || 0) * 5 + (item.description?.length || 0);
      if (newScore > existingScore){ toRemove.push(existing.id); seen.set(key, item); }
      else { toRemove.push(item.id); }
    } else { seen.set(key, item); }
  }
  for (const id of toRemove) await Store.remove('assignments', id);
  return toRemove.length;
}

function detectType(text){
  const t = String(text || '').toLowerCase();
  if (/\b(exam|exams|final exam|midterm|mid-term|end of year exam|assessment week|ncea external|external exam)\b/.test(t)) return 'Exam';
  if (/\b(test|tests|quiz|quizzes|spot test|unit test|topic test|assessment|internal|mock exam|practice exam|practice test)\b/.test(t)) return 'Test';
  if (/\b(project|portfolio|presentation|group project|inquiry|investigation)\b/.test(t)) return 'Project';
  if (/\b(homework|home work|hw|worksheet|exercise|practice|revision|read chapter|reading|due reading)\b/.test(t)) return 'Homework';
  if (/\b(assignment|coursework|task|activity|submit|hand in|hand-in|essay|report|lab report|submission)\b/.test(t)) return 'Assignment';
  if (/\b(assembly|mufti|mufti day|sports day|athletics|carnival|excursion|trip|concert|production|fundraiser|book week|fete|open day|interview|holiday|term start|term end)\b/.test(t)) return 'Event';
  if (/\b(due|deadline|remember|don't forget|dont forget|action required)\b/.test(t)) return 'Reminder';
  return 'Assignment';
}

const MONTH_MAP = { jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,
  jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,
  nov:10,november:10,dec:11,december:11 };
const DAY_ABBR = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
const MONTH_ABBR_RE = 'jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december';
const DOW_RE = 'sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat';

function parseDate(text, ref = new Date()){
  if (!text) return null;
  const t = String(text).toLowerCase();
  const thisYear = ref.getFullYear();
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m){
    const d = new Date(+m[1], +m[2]-1, +m[3], 23, 59);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  m = t.match(/\b(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?\b/);
  if (m){
    const a = +m[1], b = +m[2];
    let yr = m[3] ? +m[3] : thisYear;
    if (yr < 100) yr += 2000;
    let day = a, mon = b;
    if (a > 12 && b <= 12){ day = a; mon = b; }
    else if (b > 12 && a <= 12){ day = b; mon = a; }
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12){
      const d = new Date(yr, mon-1, day, 23, 59);
      if (!m[3] && d.getTime() < ref.getTime() - 30*86400000) d.setFullYear(d.getFullYear() + 1);
      return d.getTime();
    }
  }
  m = t.match(new RegExp(`\\b(?:(${DOW_RE})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ABBR_RE})(?:[,\\s]+(\\d{2,4}))?\\b`));
  if (m){
    const mon = MONTH_MAP[m[3]];
    let yr = m[4] ? +m[4] : thisYear;
    if (yr < 100) yr += 2000;
    const d = new Date(yr, mon, +m[2], 23, 59);
    if (!m[4] && d.getTime() < ref.getTime() - 30*86400000) d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  m = t.match(new RegExp(`\\b(${MONTH_ABBR_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{2,4}))?\\b`));
  if (m){
    const mon = MONTH_MAP[m[1]];
    let yr = m[3] ? +m[3] : thisYear;
    if (yr < 100) yr += 2000;
    const d = new Date(yr, mon, +m[2], 23, 59);
    if (!m[3] && d.getTime() < ref.getTime() - 30*86400000) d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  if (/\b(today|tonight)\b/.test(t)){ const d = new Date(ref); d.setHours(23,59,0,0); return d.getTime(); }
  if (/\b(tomorrow|tmrw|tmr)\b/.test(t)){ const d = new Date(ref); d.setDate(d.getDate()+1); d.setHours(23,59,0,0); return d.getTime(); }
  if (/\bday\s+after\s+tomorrow\b/.test(t)){ const d = new Date(ref); d.setDate(d.getDate()+2); d.setHours(23,59,0,0); return d.getTime(); }
  if (/\bnext\s+week\b|\bin\s+a\s+week\b/.test(t)){ const d = new Date(ref); d.setDate(d.getDate()+7); d.setHours(23,59,0,0); return d.getTime(); }
  if (/\b(end\s+of\s+week|eow)\b/.test(t)){
    const d = new Date(ref);
    const delta = (5 - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (delta || 7));
    d.setHours(23,59,0,0);
    return d.getTime();
  }
  m = t.match(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/);
  if (m){
    const d = new Date(ref);
    const n = +m[1];
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
      let delta = (target - d.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      d.setDate(d.getDate() + delta);
      d.setHours(23, 59, 0, 0);
      return d.getTime();
    }
  }
  return null;
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

/* ── Smart Paste ───────────────────────────────────────────── */
const CLASSROOM_TYPE_MARKER = /^(assignment|material|quiz|question|exam|homework|short answer question|multiple choice question|submission|task)$/i;
const CLASSROOM_SECTION_HEADER = /^(to-?dos?|missing|done|all classes|all topics|all work|topics?|next week|this week|later|today|tomorrow|yesterday|upcoming|recently assigned|assigned|posted|turned in|graded|returned|view|see all|view all|no due dates?|no due|due dates?)$/i;

function looksLikeDateOnlyLine(line){
  if (!line) return false;
  const t = String(line).trim();
  if (t.length > 50) return false;
  if (new RegExp(`^(?:${DOW_RE})[\\s,]*\\d{1,2}(?:st|nd|rd|th)?[\\s,]+(?:${MONTH_ABBR_RE})(?:[,\\s]+\\d{2,4})?$`, 'i').test(t)) return true;
  if (new RegExp(`^\\d{1,2}(?:st|nd|rd|th)?[\\s,]+(?:${MONTH_ABBR_RE})(?:[,\\s]+\\d{2,4})?$`, 'i').test(t)) return true;
  if (new RegExp(`^(?:${MONTH_ABBR_RE})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:[,\\s]+\\d{2,4})?$`, 'i').test(t)) return true;
  if (new RegExp(`^${DOW_RE}$`, 'i').test(t)) return true;
  if (/^(today|tonight|tomorrow|tmrw|tmr|next week|this week)$/i.test(t)) return true;
  if (/^(due\s+)?\d{4}-\d{2}-\d{2}$/i.test(t)) return true;
  if (/^(due\s+)?\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?$/i.test(t)) return true;
  if (/^due\s+/i.test(t) && t.length < 50) return true;
  if (/^(?:by|on)\s+/i.test(t) && t.length < 50) return true;
  return false;
}

function isNoiseLine(line){
  if (!line) return true;
  const t = line.trim();
  if (!t) return true;
  if (/^Loading\b/i.test(t)) return true;
  if (/^more_vert|^more_horiz|^expand_more/i.test(t)) return true;
  if (/^Open your work for/i.test(t)) return true;
  if (/^Posted\s+\w+,\s+\w+\s+\d+/i.test(t)) return true;
  if (/^Posted\s+on\b/i.test(t)) return true;
  if (/^\d+\s*(?:comment|comments|student|students|attachment|attachments|submission|submissions|turned in|assigned)$/i.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^(calendar_today|schedule|attachment|insert_drive_file|check_circle|radio_button_unchecked)$/i.test(t)) return true;
  if (/^(Turned in|Assigned|Missing|Graded|Returned|Viewed|Done|Not done)$/i.test(t)) return true;
  if (/^\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(t)) return true;
  if (/^(1[0-2]|[1-9])\s*(?:AM|PM)$/i.test(t)) return true;
  if (/^~?\d+\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours)$/i.test(t)) return true;
  if (/^\d+\s*(?:pt|pts|point|points|%)$/i.test(t)) return true;
  if (/^(View|See|Open|Open instructions|Open assignment)$/i.test(t)) return true;
  if (/^Click\s+to\s+/i.test(t)) return true;
  if (/^(Edit|Delete|Duplicate|Move|Archive|Restore)$/i.test(t)) return true;
  if (/^https?:\/\/\S+$/i.test(t)) return true;
  return false;
}

function looksLikeEmail(text){
  if (!text) return false;
  const lines = text.split(/\r?\n/).slice(0, 40);
  let headerCount = 0;
  for (const line of lines){
    if (/^\s*(from|to|cc|bcc|sent|date|subject|reply-to)\s*:\s*\S/i.test(line)) headerCount++;
  }
  return headerCount >= 2;
}

function looksLikeClassroomPage(text){
  if (!text) return false;
  if (looksLikeEmail(text)) return false;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  let markerCount = 0, dateCount = 0, dueCount = 0;
  for (const line of lines.slice(0, 100)){
    if (CLASSROOM_TYPE_MARKER.test(line)) markerCount++;
    if (/^due\s+/i.test(line)) dueCount++;
    if (looksLikeDateOnlyLine(line)) dateCount++;
  }
  if (markerCount >= 2 && (dateCount >= 1 || dueCount >= 1)) return true;
  if (markerCount >= 1 && dateCount >= 1) return true;
  if (dueCount >= 1 && dateCount >= 1) return true;
  return false;
}

function detectPasteFormat(text){
  if (!text || !text.trim()) return 'empty';
  if (looksLikeClassroomPage(text)) return 'classroom';
  if (looksLikeEmail(text)) return 'email';
  return 'generic';
}

function parseDueLine(raw){
  if (!raw) return null;
  let t = String(raw).trim();
  t = t.replace(/^due(?:\s+date)?\s*[:\-]?\s*/i, '').replace(/^(?:on|by|at|before)\s*/i, '').trim();
  if (!t || t.length > 60) return null;
  return parseDate(t);
}

function parseDateOnlyLine(raw){
  if (!raw) return null;
  return parseDate(String(raw).trim());
}

function extractInlineDue(text){
  if (!text) return null;
  const t = String(text);
  let m = t.match(/\b(?:due|by|before|deadline|submit(?:\s+by)?|hand\s+in(?:\s+by)?)\s*[:\-]?\s*((?:on\s+|by\s+)?(?:today|tonight|tomorrow|tmrw|tmr|next\s+week|this\s+week|end\s+of\s+week|eow|(?:\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)|(?:\d{4}-\d{2}-\d{2})|(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b(?:\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december))?)?)|(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?:\s+\d{2,4})?)|(?:(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}(?:st|nd|rd|th)?)))/i);
  if (m){
    const date = parseDate(m[1]);
    if (date){
      return { date, matched: m[0], cleaned: t.replace(m[0], '').replace(/\s+/g, ' ').trim() };
    }
  }
  const d = parseDate(t);
  if (d) return { date: d, matched: '', cleaned: t };
  return null;
}

function smartPasteClassroom(text){
  const rawLines = text.split(/\r?\n/).map(l => l.replace(/\s+/g,' ').trim()).filter(Boolean);
  if (!rawLines.length) return [];

  let cutoff = rawLines.length;
  for (let i = 0; i < rawLines.length; i++){
    const clean = rawLines[i].toLowerCase().replace(/[:\-–—]/g, '').trim();
    if (/^(no due dates?|no due)$/.test(clean)){ cutoff = i; break; }
  }
  const lines = rawLines.slice(0, cutoff);

  const blocks = [];
  let current = null;
  for (const line of lines){
    if (CLASSROOM_TYPE_MARKER.test(line)){
      if (current && current.lines.length) blocks.push(current);
      current = { marker: line.toLowerCase(), lines: [] };
    } else if (current){
      if (isNoiseLine(line)) continue;
      current.lines.push(line);
    }
  }
  if (current && current.lines.length) blocks.push(current);

  const results = [];
  const seen = new Set();

  for (const block of blocks){
    const bl = block.lines.filter(l => !CLASSROOM_SECTION_HEADER.test(l));
    if (!bl.length) continue;

    let dueDate = null, dueIdx = -1;
    for (let i = bl.length - 1; i >= 0; i--){
      if (looksLikeDateOnlyLine(bl[i])){
        const d = parseDueLine(bl[i]) || parseDateOnlyLine(bl[i]);
        if (d){ dueDate = d; dueIdx = i; break; }
      }
    }
    let titleIdx = 0;
    while (titleIdx < bl.length && (titleIdx === dueIdx || isNoiseLine(bl[titleIdx]))) titleIdx++;
    const title = (bl[titleIdx] || '').trim();
    if (!title || title.length < 2) continue;

    let course = '';
    if (dueIdx > titleIdx + 1){
      for (let i = titleIdx + 1; i < dueIdx; i++){
        const candidate = bl[i].trim();
        if (!candidate || isNoiseLine(candidate)) continue;
        const fromCode = subjectFromCourseCode(candidate);
        if (fromCode){ course = candidate; break; }
        const detected = detectSubject(candidate);
        if (detected){ course = candidate; break; }
        if (/^[A-Za-z][A-Za-z0-9\s&\-'\.]{1,40}$/.test(candidate) && candidate.split(/\s+/).length <= 4){
          if (!course) course = candidate;
        }
      }
    }
    if (!course){
      const m = title.match(/\b(Y?\d{1,2}[A-Z]{2,6})\b/);
      if (m) course = m[1];
    }

    let cleanTitle = title;
    if (!dueDate){
      const inline = extractInlineDue(title);
      if (inline && inline.date){
        dueDate = inline.date;
        cleanTitle = inline.cleaned || title;
      }
    }
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();
    if (!cleanTitle) cleanTitle = title;
    cleanTitle = cleanTitle.replace(/^(?:assignment|homework|task|quiz|test|exam|project|submission|material)\s*[:\-–—]\s*/i, '').trim();
    if (!cleanTitle) continue;

    const key = cleanTitle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let type = 'Assignment';
    const titleType = detectType(cleanTitle);
    if (titleType !== 'Assignment') type = titleType;
    else if (/quiz|question/i.test(block.marker)) type = 'Homework';
    else if (/exam/i.test(block.marker)) type = 'Exam';
    else if (/homework/i.test(block.marker)) type = 'Homework';

    let subject = '';
    if (course){
      subject = subjectFromCourseCode(course) || detectSubject(course);
      if (!subject && /^[A-Za-z][A-Za-z0-9\s&\-'\.]{1,40}$/.test(course)) subject = course;
    }
    if (!subject) subject = detectSubject(cleanTitle);
    subject = normalizeSubject(subject);

    results.push({
      id: `paste-${uid()}`,
      title: sanitiseText(cleanTitle, 200),
      description: course && course !== subject ? `From ${course}` : '',
      type, subject, dueDate: dueDate || null,
      source: 'Google Classroom', url: '',
      sources: [{ source: 'Google Classroom', url: '', addedAt: now() }],
      completed: false, manual: false,
      priority: computePriority({ type, dueDate }),
      mergedCount: 1, createdAt: now()
    });
  }
  return results;
}

function stripReplyPrefix(s){ return String(s || '').replace(/^\s*(?:(?:re|fwd|fw|aw)\s*:\s*)+/i, '').trim(); }

function cleanEmailBody(body){
  const lines = body.split(/\r?\n/);
  const kept = [];
  let cutoff = lines.length;
  for (let i = 0; i < lines.length; i++){
    const line = lines[i];
    if (/^\s*On\s+.{5,80}\s+wrote:\s*$/i.test(line)){ cutoff = i; break; }
    if (/^\s*-----+\s*Original Message\s*-----+/i.test(line)){ cutoff = i; break; }
    if (/^\s*_{5,}\s*$/.test(line) && i > 2){ cutoff = i; break; }
    if (/^\s*--\s*$/.test(line) && i > 2){ cutoff = i; break; }
    if (/^\s*Sent from my /i.test(line)){ cutoff = i; break; }
    if (/^\s*(Kind|Best|Warm)\s+regards[,!]?\s*$/i.test(line)){ cutoff = i; break; }
    if (/^\s*Thanks[,!]?\s*$/i.test(line) && i > lines.length - 6){ cutoff = i; break; }
    if (/^\s*Ng[āa]\s+mihi[,!]?\s*$/i.test(line)){ cutoff = i; break; }
  }
  for (let i = 0; i < cutoff; i++){
    const line = lines[i];
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

function smartPasteEmail(text){
  const lines = text.split(/\r?\n/);
  const headers = {};
  let bodyStart = 0, inHeader = true;
  for (let i = 0; i < lines.length; i++){
    const line = lines[i];
    if (inHeader){
      const m = line.match(/^\s*(from|to|cc|bcc|sent|date|subject|reply-to)\s*:\s*(.*)$/i);
      if (m){ headers[m[1].toLowerCase()] = m[2].trim(); bodyStart = i + 1; }
      else if (line.trim() === '' && Object.keys(headers).length > 0){ bodyStart = i + 1; inHeader = false; break; }
      else if (Object.keys(headers).length > 0){ bodyStart = i; inHeader = false; break; }
    }
  }
  const rawBody = lines.slice(bodyStart).join('\n').trim();
  const body = cleanEmailBody(rawBody);
  const subjectHeader = stripReplyPrefix(headers.subject || '');
  const haystack = `${subjectHeader}\n${body}`;
  const globalType = detectType(haystack);
  const globalSubject = normalizeSubject(detectSubject(haystack));
  const globalDue = parseDate(haystack);

  const bulletItems = [];
  let currentBullet = null;
  const bulletRe = /^\s*(?:[-*•·▪◦‣○●◆■]|\d+[.)]|[a-z][.)])\s+(.+)$/i;
  for (const rawLine of body.split(/\r?\n/)){
    const m = rawLine.match(bulletRe);
    if (m){
      if (currentBullet) bulletItems.push(currentBullet);
      currentBullet = m[1].trim();
    } else if (currentBullet && rawLine.trim() && !/^\s*$/.test(rawLine)){
      if (/^\s{2,}/.test(rawLine) || rawLine.length < 80) currentBullet += ' ' + rawLine.trim();
    }
  }
  if (currentBullet) bulletItems.push(currentBullet);

  if (bulletItems.length >= 2){
    const results = [];
    const seen = new Set();
    for (const b of bulletItems){
      const inline = extractInlineDue(b);
      const itemDue = inline ? inline.date : globalDue;
      let cleanBullet = inline && inline.cleaned ? inline.cleaned : b;
      let title = cleanBullet.split(/[.\n]/)[0].trim();
      if (title.length > 140) title = title.slice(0, 140).replace(/\s+\S*$/, '') + '…';
      title = sanitiseText(stripReplyPrefix(title), 200);
      const key = title.toLowerCase();
      if (!title || key.length < 3 || seen.has(key)) continue;
      seen.add(key);
      const itemType = detectType(b) || globalType;
      const itemSubject = normalizeSubject(detectSubject(b)) || globalSubject;
      results.push({
        id: `email-${uid()}`,
        title, description: sanitiseText(b, 2000),
        type: itemType, subject: itemSubject,
        dueDate: itemDue || null,
        source: 'Email', url: '',
        sources: [{ source: 'Email', url: '', addedAt: now() }],
        completed: false, manual: false,
        priority: computePriority({ type: itemType, dueDate: itemDue }),
        mergedCount: 1, createdAt: now()
      });
    }
    if (results.length) return results;
  }

  let title = subjectHeader;
  if (!title || title.length < 3){
    const firstLine = body.split(/\n/).map(l => l.trim())
      .find(l => l.length > 3 && !/^(hi|hello|kia ora|dear|hey|good (morning|afternoon|evening)|greetings)\b/i.test(l));
    title = firstLine ? firstLine.split(/[.!?]/)[0] : 'Email item';
  }
  return [{
    id: `email-${uid()}`,
    title: sanitiseText(title, 200),
    description: sanitiseText(body, 3000),
    type: globalType, subject: globalSubject,
    dueDate: globalDue || null,
    source: 'Email', url: '',
    sources: [{ source: 'Email', url: '', addedAt: now() }],
    completed: false, manual: false,
    priority: computePriority({ type: globalType, dueDate: globalDue }),
    mergedCount: 1, createdAt: now()
  }];
}

function smartPasteGeneral(text){
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = [];
  const isBulletStart = l => /^\s*(?:[-*•·▪◦‣○●◆■]|\d+[.)]|[a-z][.)])\s+/i.test(l);
  const isHeaderLike = l => /^\s*(?:assignment|homework|task|todo|to-do|hwk|hw|test|exam|project|quiz)\s*[:\-–—]/i.test(l);
  const pushCurrent = () => {
    const c = current.join(' ').replace(/\s+/g, ' ').trim();
    if (c.length >= 3) chunks.push(c);
    current = [];
  };
  for (const rawLine of lines){
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()){ pushCurrent(); continue; }
    if (isNoiseLine(line)) continue;
    if (isBulletStart(line)){
      pushCurrent();
      current.push(line.replace(/^\s*(?:[-*•·▪◦‣○●◆■]|\d+[.)]|[a-z][.)])\s+/, ''));
      continue;
    }
    if (isHeaderLike(line)){
      pushCurrent();
      current.push(line);
      continue;
    }
    if (current.length === 0){
      current.push(line.trim());
    } else {
      const prev = current[current.length - 1];
      if (/[.!?]$/.test(prev) && line.trim().length > 20){ pushCurrent(); current.push(line.trim()); }
      else if (/^[A-Z]/.test(line.trim()) && current.join(' ').length > 120){ pushCurrent(); current.push(line.trim()); }
      else current.push(line.trim());
    }
  }
  pushCurrent();

  const results = [];
  const seen = new Set();
  for (const chunk of chunks){
    if (chunk.length < 3) continue;
    const inline = extractInlineDue(chunk);
    let dueDate = inline ? inline.date : null;
    let workingText = inline && inline.cleaned ? inline.cleaned : chunk;
    workingText = workingText.replace(/^(?:assignment|homework|task|todo|to-do|hwk|hw|test|exam|project|quiz)\s*[:\-–—]\s*/i, '').trim();
    const firstDateMatch = workingText.match(new RegExp(`^(?:${DOW_RE})[\\s,]*\\d{0,2}(?:st|nd|rd|th)?[\\s,]*(?:${MONTH_ABBR_RE})?[\\s,]*\\d{0,4}\\s*[\\-–—:]?\\s*`, 'i'));
    if (firstDateMatch && firstDateMatch[0].length > 3){
      const testDate = parseDate(firstDateMatch[0]);
      if (testDate){ dueDate = dueDate || testDate; workingText = workingText.slice(firstDateMatch[0].length).trim(); }
    }
    let title = workingText.split(/(?<=[.!?])\s+/)[0].trim();
    if (title.length > 140) title = title.slice(0, 140).replace(/\s+\S*$/, '') + '…';
    title = sanitiseText(title, 200);
    if (!title || title.length < 3) continue;
    if (isNoiseLine(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const type = detectType(chunk);
    const subject = normalizeSubject(detectSubject(chunk));
    results.push({
      id: `paste-${uid()}`,
      title, description: sanitiseText(chunk, 2000),
      type, subject, dueDate: dueDate || null,
      source: 'Paste', url: '',
      sources: [{ source: 'Paste', url: '', addedAt: now() }],
      completed: false, manual: false,
      priority: computePriority({ type, dueDate }),
      mergedCount: 1, createdAt: now()
    });
  }
  return results;
}

function smartPaste(text){
  if (!text || !text.trim()) return [];
  const fmt = detectPasteFormat(text);
  if (fmt === 'classroom'){
    const items = smartPasteClassroom(text);
    if (items.length) return items;
  }
  if (fmt === 'email'){
    const items = smartPasteEmail(text);
    if (items.length) return items;
  }
  return smartPasteGeneral(text);
}

/* ── PDF effort report ─────────────────────────────────────── */
async function loadPdfJs(){
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${PDFJS_CDN}"]`);
    const onReady = () => {
      if (window.pdfjsLib){ window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(window.pdfjsLib); }
      else reject(new Error('pdf.js loaded but not available'));
    };
    if (existing){ existing.addEventListener('load', onReady); existing.addEventListener('error', reject); return; }
    const script = document.createElement('script');
    script.src = PDFJS_CDN;
    script.onload = onReady;
    script.onerror = () => reject(new Error('Could not load pdf.js — check your internet connection.'));
    document.head.appendChild(script);
  });
}

async function extractPdfText(file){
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    for (const item of content.items){
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) out += '\n';
      out += item.str;
      lastY = y;
    }
    out += '\n\n';
  }
  return out;
}

const KNOWN_SUBJECTS = ['Physical Education and Health','Physical Education','Religious Education','Social Studies','Media Studies','Digital Technology','Business Studies','Te Reo Maori','Mathematics','Commerce','English','Science','History','Geography','Economics','Accounting','Biology','Chemistry','Physics','Art','Music','Drama','Dance','Health','ICT','PE','Technology','Languages','French','Spanish','German','Japanese','Maori','Stats','Statistics'];

function parseEffortReportText(rawText){
  const text = rawText.replace(/\s+/g, ' ').trim();
  const attendance = (() => { const m = text.match(/Attendance[:\s]*([\d.]+)\s*%/i); return m ? Number(m[1]) : null; })();
  const studentCodeMatch = text.match(/\b(\d{1,2}[A-Z]{2,5})\b/);
  const studentCode = studentCodeMatch ? studentCodeMatch[1] : '';
  const ratings = [];
  let remaining = text;
  for (const sub of KNOWN_SUBJECTS){
    const escaped = sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '[\\s\\S]{0,240}?Year\\s*\\d+\\s*([0-9\\-\\.]+)', 'i');
    const m = remaining.match(re);
    if (!m) continue;
    const data = m[1];
    const avgMatch = data.match(/(\d+\.\d+)\s*$/);
    const yearAvg = avgMatch ? parseFloat(avgMatch[1]) : null;
    const beforeAvg = avgMatch ? data.slice(0, data.lastIndexOf(avgMatch[1])) : data;
    const weekRatings = [];
    for (const ch of beforeAvg){
      if (/[1-5]/.test(ch)) weekRatings.push(Number(ch));
      else if (ch === '-') weekRatings.push(null);
    }
    const nonNull = weekRatings.filter(r => r !== null);
    const latest = nonNull.length ? nonNull[nonNull.length - 1] : null;
    ratings.push({
      subject: sub, weekRatings, yearAvg,
      rating: latest !== null ? latest : (yearAvg !== null ? Math.round(yearAvg) : 3)
    });
    const startIdx = remaining.indexOf(m[0]);
    if (startIdx >= 0) remaining = remaining.slice(0, startIdx) + ' '.repeat(m[0].length) + remaining.slice(startIdx + m[0].length);
  }
  return { attendance, studentCode, ratings };
}

/* ── Activity & timetable parsers ─────────────────────────── */
function normalizeTimeInput(s){
  if (!s) return null;
  const parts = String(s).trim().split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1] ? parseInt(parts[1], 10) : 0;
  if (isNaN(h)) return null;
  if (!parts[1] && h >= 1 && h <= 7) h += 12;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function parseActivitiesText(text){
  const out = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const dayRegex = /^(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)\s*[:\-]?\s*(.+)$/i;
  for (const line of lines){
    const m = line.match(dayRegex);
    if (!m) continue;
    const day = DAY_ABBR[m[1].toLowerCase().slice(0, 3)];
    if (day === undefined) continue;
    const rest = m[2].trim();
    const timeMatch = rest.match(/(\d{1,2}(?::\d{2})?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?)/i);
    if (!timeMatch) continue;
    const start = normalizeTimeInput(timeMatch[1]);
    const end = normalizeTimeInput(timeMatch[2]);
    if (!start || !end) continue;
    const name = rest.replace(timeMatch[0], '').replace(/\s+/g, ' ').trim().replace(/^[:\-–—]\s*/, '').trim();
    if (!name) continue;
    out.push({ id: uid(), day, start, end, name });
  }
  return out;
}

function parseTimetableText(text){
  const out = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const dayRegex = /(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)/i;
  for (const line of lines){
    const dayMatch = line.match(dayRegex);
    if (!dayMatch) continue;
    const day = DAY_ABBR[dayMatch[1].toLowerCase().slice(0, 3)];
    if (day === undefined) continue;
    const timeMatch = line.match(/(\d{1,2}(?::\d{2})?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?)/i);
    if (!timeMatch) continue;
    const start = normalizeTimeInput(timeMatch[1]);
    const end = normalizeTimeInput(timeMatch[2]);
    let rest = line.replace(dayMatch[0], '').replace(timeMatch[0], '').replace(/[|,]/g, ' ').replace(/\s+/g, ' ').trim();
    const roomMatch = rest.match(/\b([A-Z]{1,3}\d{1,3})\b/);
    const room = roomMatch ? roomMatch[1] : '';
    if (room) rest = rest.replace(room, '').replace(/\s+/g, ' ').trim();
    const subject = rest.replace(/^[:\-–—]\s*/, '').trim();
    if (!subject && !room) continue;
    out.push({ day, start, end, subject: subject || 'Class', room });
  }
  return out;
}

/* ── Dedupe & import ───────────────────────────────────────── */
function tokenSet(s){
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w)));
}
function jaccard(a, b){
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function findDuplicate(incoming, pool){
  const tIn = tokenSet(incoming.title);
  for (const existing of pool){
    if (existing.manual) continue;
    const tEx = tokenSet(existing.title);
    if (jaccard(tIn, tEx) < 0.5) continue;
    const subjMatch = !incoming.subject || !existing.subject || incoming.subject.toLowerCase() === existing.subject.toLowerCase();
    if (!subjMatch) continue;
    if (incoming.dueDate && existing.dueDate){
      const diffDays = Math.abs(incoming.dueDate - existing.dueDate) / 86400000;
      if (diffDays > 3) continue;
    }
    return existing;
  }
  return null;
}
function mergeInto(existing, incoming){
  const sources = existing.sources || [];
  if (!sources.some(s => s.source === incoming.source && s.url === incoming.url)){
    sources.push({ source: incoming.source, url: incoming.url || '', addedAt: now() });
  }
  return {
    ...existing, sources,
    dueDate: existing.manual && existing.dueDate ? existing.dueDate : (existing.dueDate || incoming.dueDate),
    description: (existing.description && existing.description.length > (incoming.description||'').length) ? existing.description : (incoming.description || existing.description),
    subject: existing.subject || incoming.subject,
    type: existing.type !== 'Other' ? existing.type : incoming.type,
    priority: computePriority({ ...existing, dueDate: existing.dueDate || incoming.dueDate }),
    mergedCount: (existing.mergedCount || 1) + 1
  };
}

async function importItems(rawItems, sourceLabel){
  let added = 0, merged = 0;
  for (const raw of rawItems){
    const cleanTitle = sanitiseText(raw.title, 220) || 'Untitled item';
    const cleanDesc  = sanitiseText(raw.description, 4000);
    const haystack = `${cleanTitle} ${cleanDesc}`;
    const type = raw.typeHint || raw.type || detectType(haystack);
    const rawSubject = raw.subject || detectSubject(haystack);
    const subject = normalizeSubject(rawSubject);
    const dueDate = raw.dueDate || parseDate(haystack);
    const candidate = {
      id: raw.id || uid(),
      title: cleanTitle, description: cleanDesc, type, subject,
      dueDate: dueDate || null,
      source: sourceLabel, url: raw.url || '',
      sources: raw.sources || [{ source: sourceLabel, url: raw.url || '', addedAt: now() }],
      completed: false, manual: false, priority: 'low',
      createdAt: now()
    };
    candidate.priority = computePriority(candidate);
    if (dueDate){
      const dayKey = startOfDay(new Date(dueDate));
      const normalized = normalizeTitle(cleanTitle);
      const exactDup = Store.all('assignments').find(a => {
        if (!a.dueDate) return false;
        if (startOfDay(new Date(a.dueDate)) !== dayKey) return false;
        return normalizeTitle(a.title) === normalized;
      });
      if (exactDup){
        const mergedRecord = mergeInto(exactDup, candidate);
        const idx = Store.cache.assignments.findIndex(x => x.id === exactDup.id);
        if (idx >= 0) Store.cache.assignments.splice(idx, 1);
        await Store.put('assignments', mergedRecord);
        merged++; continue;
      }
    }
    const dup = findDuplicate(candidate, Store.all('assignments'));
    if (dup){ await Store.put('assignments', mergeInto(dup, candidate)); merged++; }
    else {
      await Store.put('assignments', candidate);
      if (candidate.dueDate || candidate.type === 'Test' || candidate.type === 'Exam') await maybeNotify(candidate);
      added++;
    }
  }
  return { added, merged };
}

async function pushNotification({ kind, title, body='', link='', dedupeKey='' }){
  if (dedupeKey){
    const dupe = Store.all('notifications').find(n => n.dedupeKey === dedupeKey && (now() - n.createdAt) < 7*86400000);
    if (dupe) return null;
  }
  const n = { id: uid(), kind, title: sanitiseText(title, 200), body: sanitiseText(body, 400), link, read: false, dedupeKey, createdAt: now() };
  await Store.put('notifications', n);
  renderNotifDot();
  if ($('#notif-panel') && !$('#notif-panel').hidden) renderNotifPanel();
  return n;
}

async function maybeNotify(item){
  const s = Store.cache.settings;
  if (item.type === 'Test' || item.type === 'Exam'){
    if (s.notifyNewTest){
      await pushNotification({ kind:'test', title:`New ${item.type.toLowerCase()}: ${item.title}`,
        body: item.dueDate ? `On ${fmtDateLong(item.dueDate)}${item.subject ? ' · ' + item.subject : ''}` : '',
        link:'#/assignments', dedupeKey:`test:${item.title}:${item.dueDate || ''}` });
    }
    return;
  }
  if (s.notifyNewAssignment){
    await pushNotification({ kind:'assignment', title:`New ${item.type.toLowerCase()}: ${item.title}`,
      body: item.dueDate ? `Due ${fmtDateLong(item.dueDate)}${item.subject ? ' · ' + item.subject : ''}` : '',
      link:'#/assignments', dedupeKey:`new:${item.title}:${item.dueDate || ''}` });
  }
}

async function checkDueSoon(){
  if (!Store.cache.settings.notifyDueSoon) return;
  for (const a of Store.all('assignments')){
    if (a.completed || !a.dueDate) continue;
    const d = daysUntil(a.dueDate);
    if (d === 0 || d === 1){
      await pushNotification({ kind:'due', title:`${a.title} is due ${d === 0 ? 'today' : 'tomorrow'}`,
        body: a.subject ? `${a.subject} · ${a.type}` : a.type,
        link:'#/assignments', dedupeKey:`due:${a.id}:${startOfDay(new Date(a.dueDate))}` });
    }
  }
}

/* ── ICS ───────────────────────────────────────────────────── */
function parseICS(text){
  if (!text) return [];
  const events = [];
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks){
    const ev = {};
    for (const line of block.split(/\r?\n/)){
      const m = line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (key === 'SUMMARY') ev.title = value;
      else if (key === 'DESCRIPTION') ev.description = value;
      else if (key === 'DTSTART') ev.start = parseICSDate(value);
      else if (key === 'DTEND') ev.end = parseICSDate(value);
      else if (key === 'URL') ev.url = value;
      else if (key === 'UID') ev.uid = value;
      else if (key === 'LOCATION') ev.location = value;
    }
    if (ev.title && ev.start) events.push(ev);
  }
  return events;
}
function parseICSDate(v){
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h='00', mi='00', s='00', z] = m;
  return (z ? new Date(Date.UTC(+y, +mo-1, +d, +h, +mi, +s)) : new Date(+y, +mo-1, +d, +h, +mi, +s)).getTime();
}
function eventExists(title, start, excludeId = null){
  if (!start) return false;
  const dayKey = startOfDay(new Date(start));
  const norm = normalizeTitle(title);
  return Store.all('events').some(e => e.id !== excludeId && e.start && startOfDay(new Date(e.start)) === dayKey && normalizeTitle(e.title) === norm);
}

async function syncCalendarSubscriptions(){
  const subs = Store.cache.settings.calendarSubscriptions || [];
  if (!subs.length) return { added: 0, subs: 0, errors: [] };
  let totalAdded = 0;
  const errors = [];
  for (const sub of subs){
    try {
      const r = await fetchCalendarUrl(sub.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const events = parseICS(text);
      let added = 0;
      for (const ev of events){
        if (ev.start < now() - 90*86400000) continue;
        const existing = Store.all('events').find(e => e.icsUid === ev.uid && e.icsSource === sub.url);
        if (!existing && eventExists(ev.title, ev.start)) continue;
        const record = {
          id: existing ? existing.id : `ics-${uid()}`,
          title: sanitiseText(ev.title, 200),
          description: sanitiseText(ev.description || '', 2000),
          start: ev.start, end: ev.end || null,
          location: sanitiseText(ev.location || '', 200),
          source: sub.name || 'Calendar', url: ev.url || '',
          icsUid: ev.uid, icsSource: sub.url, manual: false,
          createdAt: existing ? existing.createdAt : now()
        };
        await Store.put('events', record);
        if (!existing) added++;
      }
      totalAdded += added;
      sub.lastSync = now(); sub.count = events.length; sub.error = null;
    } catch (e){ sub.error = e.message; errors.push(`${sub.name || sub.url}: ${e.message}`); }
  }
  await Store.saveUserDoc();
  return { added: totalAdded, subs: subs.length, errors };
}

/* ── Master sync ───────────────────────────────────────────── */
let syncing = false;
async function syncAll({ interactive = true, silent = false } = {}){
  if (syncing) return;
  syncing = true;
  setSyncUI('busy', 'Syncing…');
  const btn = $('#sync-btn');
  if (btn){ btn.disabled = true; $('.sync-spinner', btn).hidden = false; $('.sync-label', btn).textContent = 'Syncing…'; }

  const results = [], errors = [];
  const s = Store.cache.settings;
  const googleReady = App.user?.real === true;

  // Calendar
  try {
    const r = await syncCalendarSubscriptions();
    if (r.added) results.push(`Calendar: ${r.added} new`);
    for (const e of r.errors) errors.push(e);
  } catch(e){ errors.push(`Calendar: ${e.message}`); }

  // Classroom
  if (googleReady && s.enableClassroom !== false && (interactive || GoogleServices.has(CLASSROOM_SCOPES))){
    try {
      const r = await syncClassroom({ interactive });
      if (r.added || r.merged) results.push(`Classroom: ${r.added} new${r.merged ? `, ${r.merged} merged` : ''}`);
    } catch (e){
      if (e.message === 'TOKEN_EXPIRED' || e.message === 'NOT_SIGNED_IN') errors.push('Google session expired — sign in again to sync Classroom.');
      else if (e.message === 'ACCESS_BLOCKED') errors.push('Classroom access blocked by your school admin.');
      else if (e.message === 'INSUFFICIENT_SCOPE') errors.push('Classroom permissions missing — sign out and back in.');
      else errors.push(`Classroom: ${e.message}`);
    }
  }

  // Gmail
  if (googleReady && s.enableGmail !== false && (interactive || GoogleServices.has(GMAIL_SCOPES))){
    try {
      const r = await syncGmail({ interactive });
      if (r.added || r.merged) results.push(`Email: ${r.added} new${r.merged ? `, ${r.merged} merged` : ''}`);
    } catch (e){
      if (e.message === 'TOKEN_EXPIRED' || e.message === 'NOT_SIGNED_IN') errors.push('Google session expired — sign in again to sync Email.');
      else if (e.message === 'ACCESS_BLOCKED') errors.push('Gmail access blocked by your school admin.');
      else if (e.message === 'INSUFFICIENT_SCOPE') errors.push('Gmail permissions missing — sign out and back in.');
      else errors.push(`Email: ${e.message}`);
    }
  }

  await dedupeExistingEvents();
  await dedupeExistingAssignments();
  await checkDueSoon();

  syncing = false;
  if (btn){ btn.disabled = false; $('.sync-spinner', btn).hidden = true; $('.sync-label', btn).textContent = 'Sync'; }

  if (results.length){ setSyncUI('ok', `Synced ${relativeTime(now())}`); if (!silent) toast(results.join(' · '), 'success', 'Sync complete'); }
  else if (!errors.length){ setSyncUI('ok', `Synced ${relativeTime(now())}`); if (!silent) toast('Everything is up to date.', 'success'); }
  for (const err of errors){ toast(err, 'error', 'Sync problem'); setSyncUI('err', 'Sync error'); }
  render();
  return { results, errors };
}
function setSyncUI(state, text){
  const chip = $('#sync-status');
  const txt = $('#sync-status .sync-text');
  if (txt) txt.textContent = text;
  if (chip){ chip.classList.remove('ok','busy','err'); if (state) chip.classList.add(state); }
}

/* ── App state ────────────────────────────────────────────── */
const App = {
  user: null, school: null, availableSchools: [], route: '#/dashboard',
  adminSchools: [], adminSelectedSchool: null, adminLoaded: false,
  filters: { assignments: 'all', search: '', subject: 'all', sort: 'due' },
  calMonth: new Date().getMonth(), calYear: new Date().getFullYear(),
  fabOpen: false
};

const SIDEBAR_FEATURES = [
  { id:'assignments', group:'Overview', icon:'📝', label:'Assignments', href:'#/assignments', badge:'assignments' },
  { id:'calendar', group:'Overview', icon:'📅', label:'Calendar', href:'#/calendar' },
  { id:'weekly', group:'Organise', icon:'🗒️', label:'Weekly Notes', href:'#/weekly' },
  { id:'effort', group:'Organise', icon:'📊', label:'Effort Reports', href:'#/effort' },
  { id:'planner', group:'Organise', icon:'🎯', label:'Study Planner', href:'#/planner' },
  { id:'pathways', group:'Organise', icon:'🌱', label:'Academic Pathways', href:'#/pathways' },
  { id:'results', group:'Organise', icon:'📈', label:'Results', href:'#/results' },
  { id:'integrations', group:'Account', icon:'🔌', label:'Integrations', href:'#/integrations' }
];
function isAdminUser(){ return ['global_admin','school_admin'].includes(App.user?.role); }
function renderSidebar(){
  const nav=$('#sidebar'); if(!nav || !Store.cache?.settings) return;
  const enabled=new Set(Store.cache.settings.sidebarFeatures || DEFAULT_SETTINGS.sidebarFeatures);
  const groups={
    Overview:[{ id:'dashboard', icon:'⌂', label:'Dashboard', href:'#/dashboard', badge:null }],
    Organise:[],
    Account:[]
  };
  for(const item of SIDEBAR_FEATURES){ if(!enabled.has(item.id)) continue; (groups[item.group] ||= []).push(item); }
  let html='';
  for(const group of ['Overview','Organise','Account']){
    const items=groups[group]||[]; if(!items.length && group!=='Account') continue;
    html += `<div class="sidebar-group"><div class="sidebar-label">${group}</div>`;
    for(const item of items){
      const badge=item.badge==='assignments' ? `<span class="nav-badge" id="badge-assignments" hidden></span>` : '';
      html += `<a class="nav-item" href="${item.href}" data-sidebar-feature="${item.id}"><span class="nav-ico">${item.icon}</span><span>${item.label}</span>${badge}</a>`;
    }
    if(group==='Account'){
      if (isAdminUser()) html += `<a class="nav-item" href="#/admin"><span class="nav-ico">🏫</span><span>School Admin</span></a>`;
      html += `<a class="nav-item" href="#/settings"><span class="nav-ico">⚙️</span><span>Settings</span></a>`;
    }
    html += '</div>';
  }
  html += `<div class="sidebar-foot"><div class="sync-chip" id="sync-status"><span class="sync-dot"></span><span class="sync-text">Not synced yet</span></div></div>`;
  nav.innerHTML=html;
}

function render(){
  renderSidebar();
  const route = (location.hash || '#/dashboard').split('?')[0];
  App.route = route;
  $$('.nav-item').forEach(a => a.classList.toggle('active', a.getAttribute('href') === route));
  const view = $('#view');
  if (!view) return;
  switch(route){
    case '#/assignments': view.innerHTML = viewAssignments(); break;
    case '#/calendar': view.innerHTML = viewCalendar(); break;
    case '#/weekly': view.innerHTML = viewWeekly(); break;
    case '#/effort': view.innerHTML = viewEffort(); break;
    case '#/planner': view.innerHTML = viewPlanner(); break;
    case '#/pathways': view.innerHTML = viewAcademicPathways(); break;
    case '#/results': view.innerHTML = viewResults(); break;
    case '#/integrations': view.innerHTML = viewIntegrations(); break;
    case '#/settings': view.innerHTML = viewSettings(); break;
    case '#/admin':
      if (!isAdminUser()){ location.hash = '#/dashboard'; return; }
      view.innerHTML = viewAdmin();
      if (!App.adminLoaded) loadAdminSchools();
      break;
    default: view.innerHTML = viewDashboard();
  }
  bindViewEvents();
  updateBadges();
}

function updateBadges(){
  const open = Store.all('assignments').filter(a => !a.completed && a.dueDate && daysUntil(a.dueDate) >= 0).length;
  const badge = $('#badge-assignments');
  if (badge){ badge.textContent = open; badge.hidden = open === 0; }
  const unread = Store.all('notifications').filter(n => !n.read).length;
  const dot = $('#notif-dot');
  if (dot) dot.hidden = unread === 0;
}

function getChecklistState(){
  const d = Store.cache;
  return {
    account: true,
    google: !!d.integrations?.classroom?.connected,
    firstItem: (d.assignments || []).length > 0,
    effort: (d.effortReports || []).length > 0
  };
}

function renderChecklist(){
  const s = getChecklistState();
  const done = Object.values(s).filter(Boolean).length;
  const total = 4;
  if (done >= total) return '';
  const items = [
    { key:'account', icon:'👤', text:'Create your account', done: true },
    { key:'google', icon:'🔗', text:'Connect Google to sync Classroom & Email', done: s.google, action:'sync-now' },
    { key:'firstItem', icon:'📝', text:'Import your first assignments', done: s.firstItem, action:'paste-classroom' },
    { key:'effort', icon:'📊', text:'Upload your first effort report', done: s.effort, action:'upload-effort' }
  ];
  return `
  <section class="checklist-card">
    <div class="checklist-head">
      <div class="checklist-title">🚀 Getting started</div>
      <div class="row" style="gap:8px">
        <span class="chip chip-indigo">${done}/${total}</span>
        <button class="btn btn-sm btn-ghost" data-action="dismiss-checklist">Dismiss</button>
      </div>
    </div>
    <div class="checklist-items">
      ${items.map(it => `
        <div class="checklist-item ${it.done ? 'done' : ''}" ${it.done || !it.action ? '' : `data-action="${it.action}" role="button" tabindex="0"`}>
          <div class="checklist-box">${it.done ? '✓' : ''}</div>
          <div class="checklist-text">${it.icon} ${escapeHtml(it.text)}</div>
          ${!it.done && it.action ? '<span class="tiny muted">→</span>' : ''}
        </div>`).join('')}
    </div>
  </section>`;
}

function viewDashboard(){
  const assignments = Store.all('assignments');
  const events = Store.all('events');
  const settings = Store.cache.settings;
  const open = assignments.filter(a => !a.completed);
  const overdue = open.filter(a => a.dueDate && daysUntil(a.dueDate) < 0);
  const dueToday = open.filter(a => a.dueDate && daysUntil(a.dueDate) === 0);
  const dueWeek = open.filter(a => a.dueDate && daysUntil(a.dueDate) >= 0 && daysUntil(a.dueDate) <= 7);
  const tests = open.filter(a => a.type === 'Test' || a.type === 'Exam');
  const name = (App.user?.displayName || '').split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayEvents = events.filter(e => e.start && sameDay(e.start, now()));
  const todayItems = [...dueToday, ...overdue];
  const isEmpty = !assignments.length && !events.length;
  const efforts = Store.all('effortReports').sort((a,b) => b.date - a.date);
  const latestEffort = efforts[0];
  const effortCard = latestEffort ? `
    <section class="card">
      <div class="card-head">
        <div class="card-title">📊 Latest effort report</div>
        <a class="btn btn-sm btn-ghost" href="#/effort">All reports</a>
      </div>
      <div class="card-body">${renderEffortSummaryMini(latestEffort)}</div>
    </section>` : `
    <section class="card">
      <div class="card-head"><div class="card-title">📊 Effort reports</div></div>
      <div class="card-body">
        <p class="small muted" style="margin-bottom:14px">Upload your weekly PDF from school — Scribe reads every subject and rating.</p>
        <button class="btn btn-primary btn-sm" data-action="upload-effort">📤 Upload effort report</button>
      </div>
    </section>`;
  return `
  <div class="page-head">
    <h1 class="page-title">${greet}, ${escapeHtml(name)} 👋</h1>
    <p class="page-sub">${new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${open.length} open item${open.length===1?'':'s'}</p>
  </div>
  ${renderChecklist()}
  ${isEmpty ? renderWelcomeEmpty() : `
  <div class="stat-grid">
    <div class="stat ${overdue.length ? 'warn' : ''}">
      <div class="stat-label">Overdue</div><div class="stat-value">${overdue.length}</div>
      <div class="stat-sub">${overdue.length ? 'Needs attention first' : 'All clear'}</div>
    </div>
    <div class="stat"><div class="stat-label">Due today</div><div class="stat-value">${dueToday.length}</div>
      <div class="stat-sub">${dueToday.length ? 'Finish these today' : 'Nothing due today'}</div></div>
    <div class="stat"><div class="stat-label">Next 7 days</div><div class="stat-value">${dueWeek.length}</div>
      <div class="stat-sub">Assignments &amp; tasks</div></div>
    <div class="stat ${tests.length ? 'warn' : 'good'}">
      <div class="stat-label">Tests &amp; exams</div><div class="stat-value">${tests.length}</div>
      <div class="stat-sub">${tests.length ? 'Start revising early' : 'None scheduled'}</div></div>
  </div>`}
  <div class="cols cols-main">
    <div class="stack">
      <section class="card">
        <div class="card-head"><div class="card-title">🎯 What should I do next?</div>
          <a class="btn btn-sm btn-ghost" href="#/planner">Planner</a></div>
        <div class="card-body" style="padding-top:6px;padding-bottom:10px">${renderNextActions()}</div>
      </section>
      <section class="card">
        <div class="card-head"><div class="card-title">📌 Today</div>
          <span class="chip chip-gray">${todayItems.length + todayEvents.length} item${(todayItems.length+todayEvents.length)===1?'':'s'}</span></div>
        ${renderTodaySection(todayItems, todayEvents)}
      </section>
    </div>
    <div class="stack">
      ${effortCard}
      <section class="card">
        <div class="card-head"><div class="card-title">🗓️ Today's timetable</div>
          <button class="btn btn-sm btn-subtle" data-action="edit-timetable">Edit</button></div>
        <div class="card-body">${renderTimetable(settings.timetable)}</div>
      </section>
      <section class="card">
        <div class="card-head"><div class="card-title">🏃 Weekly activities</div>
          <button class="btn btn-sm btn-subtle" data-action="edit-activities">Edit</button></div>
        <div class="card-body">${renderActivitiesToday(settings.weeklyActivities)}</div>
      </section>
    </div>
  </div>`;
}

function renderEffortSummaryMini(report){
  if (!report || !report.ratings?.length) return '<div class="muted small">No ratings recorded.</div>';
  const avg = report.ratings.reduce((s, r) => s + r.rating, 0) / report.ratings.length;
  return `
    <div class="row-between" style="margin-bottom:12px">
      <div><div class="small muted">${fmtDateLong(report.date)}</div>
        <div class="strong" style="font-size:15px;margin-top:2px">${report.ratings.length} subjects rated</div></div>
      <div class="effort-avg"><b>${avg.toFixed(1)}</b>/ 5</div>
    </div>
    <div class="effort-bars">
      ${report.ratings.slice(0, 5).map(r => `
        <div class="effort-bar-row">
          <div class="effort-bar-subject truncate">${escapeHtml(r.subject)}</div>
          <div class="effort-bar-track"><div class="effort-bar-fill ${ratingClass(r.rating)}" style="width:${r.rating/5*100}%"></div></div>
          <div class="effort-bar-val">${r.rating}</div>
        </div>`).join('')}
    </div>
    ${report.ratings.length > 5 ? `<div class="tiny muted" style="margin-top:8px">+${report.ratings.length - 5} more subjects</div>` : ''}`;
}

function renderWelcomeEmpty(){
  return `
  <div class="card card-pad" style="text-align:center;padding:44px 24px">
    <div style="font-size:52px;margin-bottom:14px">🎒</div>
    <h2 style="font-size:22px;margin-bottom:10px">Let's get your school life in one place</h2>
    <p class="muted" style="max-width:520px;margin:0 auto 24px;font-size:14.5px;line-height:1.65">
      Sign in with Google and everything syncs automatically — <strong>Classroom assignments</strong>, <strong>school emails</strong>, and your calendar.
    </p>
    <div class="row" style="justify-content:center;flex-wrap:wrap;gap:10px">
      <button class="btn btn-primary" data-action="sync-now">🔄 Sync now</button>
      <button class="btn btn-ghost" data-action="paste-classroom">✨ Smart Paste</button>
      <button class="btn btn-ghost" data-action="upload-effort">📤 Upload effort report</button>
    </div>
  </div>`;
}

function renderNextActions(){
  const items = Store.all('assignments').filter(a => !a.completed);
  if (!items.length){
    return `<div class="empty" style="padding:32px 12px">
      <div class="empty-ico">🌤️</div>
      <div class="empty-title">Nothing on your plate</div>
      <div class="empty-sub">Sync Google or Smart Paste to fill this in.</div>
      <div class="empty-actions">
        <button class="btn btn-sm btn-primary" data-action="sync-now">🔄 Sync now</button>
        <button class="btn btn-sm btn-ghost" data-action="paste-classroom">✨ Smart Paste</button>
      </div>
    </div>`;
  }
  const scored = items.map(i => ({ i, score: plannerScore(i) })).sort((a,b) => b.score - a.score).slice(0, 5);
  return scored.map(({ i }, idx) => {
    const due = dueLabel(i.dueDate);
    const cls = i.priority === 'urgent' ? 'urgent' : i.priority === 'high' ? 'high' : i.priority === 'low' ? 'low' : '';
    return `
    <div class="next-item ${cls}">
      <div class="next-rank">${idx + 1}</div>
      <div style="flex:1;min-width:0">
        <div class="item-title" style="margin-bottom:3px">${escapeHtml(i.title)}</div>
        <div class="item-meta">
          ${i.subject ? `<span class="chip chip-indigo">${escapeHtml(i.subject)}</span>` : ''}
          <span class="chip chip-gray">${escapeHtml(i.type)}</span>
          <span class="due ${due.cls}">${escapeHtml(due.text)}</span>
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" data-action="complete" data-id="${i.id}">Done</button>
    </div>`;
  }).join('');
}

function plannerScore(i){
  const d = daysUntil(i.dueDate);
  let s = 0;
  if (d !== null && d < 0) s += 1000;
  if (d !== null && d >= 0) s += Math.max(0, 300 - d * 30);
  if (i.type === 'Test') s += 150;
  if (i.type === 'Exam') s += 220;
  s += estimateMinutes(i) * 0.35;
  if (i.priority === 'high') s += 25;
  if (i.priority === 'medium') s += 10;
  return s;
}

function renderTodaySection(todayItems, todayEvents){
  if (!todayItems.length && !todayEvents.length){
    return `<div class="empty" style="padding:34px 20px">
      <div class="empty-ico">✅</div><div class="empty-title">Nothing due today</div>
      <div class="empty-sub">A good moment to get ahead on something from this week.</div></div>`;
  }
  let html = '';
  for (const e of todayEvents){
    html += `<div class="item"><div class="item-check" style="border-color:var(--sky-500);background:var(--sky-50);cursor:default">📅</div>
      <div class="item-main"><div class="item-title">${escapeHtml(e.title || e.name)}</div>
      <div class="item-meta"><span class="chip chip-sky">Event</span>
        ${e.source ? `<span class="chip chip-gray">${escapeHtml(e.source)}</span>` : ''}
        ${e.start ? `<span class="tiny muted">${fmtTime(e.start)}</span>` : ''}</div></div></div>`;
  }
  for (const a of todayItems){
    const due = dueLabel(a.dueDate);
    html += `<div class="item ${a.completed ? 'done' : ''}">
      <div class="item-check ${a.completed ? 'on' : ''}" data-action="complete" data-id="${a.id}">${a.completed ? '✓' : ''}</div>
      <div class="item-main"><div class="item-title">${escapeHtml(a.title)}</div>
        ${a.description ? `<div class="item-desc">${escapeHtml(a.description)}</div>` : ''}
        <div class="item-meta">
          ${a.subject ? `<span class="chip chip-indigo">${escapeHtml(a.subject)}</span>` : ''}
          <span class="chip chip-gray">${escapeHtml(a.type)}</span></div></div>
      <div class="item-side"><span class="due ${due.cls}">${escapeHtml(due.text)}</span></div></div>`;
  }
  return html;
}

function renderTimetable(timetable){
  if (!timetable || !timetable.length){
    return `<div class="empty" style="padding:24px 12px"><div class="empty-ico">🕘</div>
      <div class="empty-title">No timetable yet</div>
      <div class="empty-sub">Add your periods once and Scribe shows today's lessons here.</div>
      <button class="btn btn-sm btn-primary" style="margin-top:12px" data-action="edit-timetable">Add timetable</button></div>`;
  }
  const todayDow = new Date().getDay();
  const todays = timetable.filter(t => Number(t.day) === todayDow).sort((a,b) => (a.start||'').localeCompare(b.start||''));
  if (!todays.length){
    return `<div class="empty" style="padding:24px 12px"><div class="empty-ico">🎉</div>
      <div class="empty-title">No classes today</div>
      <div class="empty-sub">Enjoy the break — or get ahead on upcoming work.</div></div>`;
  }
  const nowHM = new Date().toTimeString().slice(0,5);
  return todays.map(t => {
    const isNow = t.start && t.end && nowHM >= t.start && nowHM <= t.end;
    return `<div class="tt-row ${isNow ? 'tt-now' : ''}">
      <div class="tt-time">${escapeHtml(t.start || '')}${t.end ? '–' + escapeHtml(t.end) : ''}</div>
      <div style="flex:1;min-width:0"><div class="tt-sub">${escapeHtml(t.subject || 'Class')}</div>
        ${t.room ? `<div class="tiny muted">Room ${escapeHtml(t.room)}</div>` : ''}</div>
      ${isNow ? '<span class="chip chip-indigo">Now</span>' : ''}</div>`;
  }).join('');
}

function renderActivitiesToday(activities){
  if (!activities || !activities.length){
    return `<div class="empty" style="padding:24px 12px"><div class="empty-ico">🎾</div>
      <div class="empty-title">No activities yet</div>
      <div class="empty-sub">Add your weekly activities so the planner can schedule around them.</div>
      <button class="btn btn-sm btn-primary" style="margin-top:12px" data-action="edit-activities">Add activities</button></div>`;
  }
  const todayDow = new Date().getDay();
  const todays = activities.filter(a => Number(a.day) === todayDow).sort((a,b) => (a.start||'').localeCompare(b.start||''));
  if (!todays.length){
    return `<div class="empty" style="padding:24px 12px"><div class="empty-ico">☀️</div>
      <div class="empty-title">Free after school</div>
      <div class="empty-sub">No activities scheduled today.</div></div>`;
  }
  return todays.map(a => `
    <div class="tt-row">
      <div class="tt-time">${escapeHtml(a.start)}–${escapeHtml(a.end)}</div>
      <div style="flex:1;min-width:0"><div class="tt-sub">${escapeHtml(a.name)}</div></div>
      <span class="chip chip-violet">Activity</span></div>`).join('');
}

function viewAssignments(){
  const f = App.filters;
  let items = Store.all('assignments');
  if (f.assignments === 'open') items = items.filter(a => !a.completed);
  else if (f.assignments === 'overdue') items = items.filter(a => !a.completed && a.dueDate && daysUntil(a.dueDate) < 0);
  else if (f.assignments === 'week') items = items.filter(a => !a.completed && a.dueDate && daysUntil(a.dueDate) >= 0 && daysUntil(a.dueDate) <= 7);
  else if (f.assignments === 'tests') items = items.filter(a => a.type === 'Test' || a.type === 'Exam');
  else if (f.assignments === 'done') items = items.filter(a => a.completed);
  if (f.subject !== 'all') items = items.filter(a => a.subject === f.subject);
  if (f.search){ const q = f.search.toLowerCase(); items = items.filter(a => `${a.title} ${a.description} ${a.subject}`.toLowerCase().includes(q)); }
  if (f.sort === 'due') items.sort((a,b) => (a.dueDate || Infinity) - (b.dueDate || Infinity));
  else if (f.sort === 'priority'){ const rank = { urgent:0, high:1, medium:2, low:3 }; items.sort((a,b) => (rank[a.priority]??3) - (rank[b.priority]??3)); }
  else items.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
  const subjects = [...new Set(Store.all('assignments').map(a => a.subject).filter(Boolean))].sort();
  const open = Store.all('assignments').filter(a => !a.completed).length;
  const seg = (val, label) => `<button class="${f.assignments === val ? 'on' : ''}" data-filter="assignments" data-value="${val}">${label}</button>`;
  return `
  <div class="page-head row-between wrap">
    <div><h1 class="page-title">Assignments</h1><p class="page-sub">${open} open · ${Store.all('assignments').length} total</p></div>
    <div class="row">
      <button class="btn btn-ghost" data-action="sync-now">🔄 Sync</button>
      <button class="btn btn-primary" data-action="paste-classroom">✨ Smart Paste</button>
      <button class="btn btn-ghost" data-action="new-assignment">＋ New</button>
    </div>
  </div>
  <div class="filters">
    <div class="seg">${seg('all','All')}${seg('open','Open')}${seg('overdue','Overdue')}${seg('week','This week')}${seg('tests','Tests')}${seg('done','Done')}</div>
    <select class="select" data-filter="subject"><option value="all">All subjects</option>${subjects.map(s => `<option value="${escapeHtml(s)}" ${f.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
    <select class="select" data-filter="sort">
      <option value="due" ${f.sort === 'due' ? 'selected' : ''}>Sort: Due date</option>
      <option value="priority" ${f.sort === 'priority' ? 'selected' : ''}>Sort: Priority</option>
      <option value="created" ${f.sort === 'created' ? 'selected' : ''}>Sort: Recently added</option>
    </select>
  </div>
  <div class="card">
    ${items.length ? items.map(renderAssignmentItem).join('') : `
      <div class="empty"><div class="empty-ico">📝</div>
        <div class="empty-title">No assignments yet</div>
        <div class="empty-sub">Sync Google or Smart Paste a To-do list.</div>
        <div class="empty-actions">
          <button class="btn btn-sm btn-primary" data-action="sync-now">🔄 Sync now</button>
          <button class="btn btn-sm btn-ghost" data-action="paste-classroom">✨ Smart Paste</button>
        </div>
      </div>`}
  </div>`;
}

function renderAssignmentItem(a){
  const due = dueLabel(a.dueDate);
  const prio = { urgent:['chip-red','Urgent'], high:['chip-amber','High'], medium:['chip-sky','Medium'], low:['chip-gray','Low'] }[a.priority] || ['chip-gray','Low'];
  const sources = a.sources && a.sources.length ? a.sources : [{ source: a.source, url: a.url }];
  const uniqueSources = [...new Map(sources.map(s => [s.source, s])).values()];
  return `
  <div class="item ${a.completed ? 'done' : ''} ${!a.completed && a.dueDate && daysUntil(a.dueDate) < 0 ? 'overdue' : ''}">
    <div class="item-check ${a.completed ? 'on' : ''}" data-action="complete" data-id="${a.id}">${a.completed ? '✓' : ''}</div>
    <div class="item-main">
      <div class="item-title">
        ${escapeHtml(a.title)}
        ${a.manual ? '<span class="chip chip-gray">Manual</span>' : ''}
        ${a.mergedCount > 1 ? `<span class="chip chip-indigo">${a.mergedCount} sources</span>` : ''}
      </div>
      ${a.description ? `<div class="item-desc">${escapeHtml(a.description)}</div>` : ''}
      <div class="item-meta">
        ${a.subject ? `<span class="chip chip-indigo">${escapeHtml(a.subject)}</span>` : ''}
        <span class="chip chip-gray">${escapeHtml(a.type)}</span>
        <span class="chip ${prio[0]}">${prio[1]}</span>
        ${uniqueSources.map(s => s.url ? `<a class="src-link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener" style="font-size:11.5px;font-weight:600;color:var(--primary);text-decoration:none">↗ ${escapeHtml(s.source)}</a>` : `<span class="chip chip-gray">${escapeHtml(s.source || 'Manual')}</span>`).join('')}
      </div>
    </div>
    <div class="item-side">
      <span class="due ${due.cls}">${escapeHtml(due.text)}</span>
      <div class="row" style="gap:4px">
        <button class="icon-btn" style="width:30px;height:30px;font-size:14px" data-action="edit-assignment" data-id="${a.id}">✏️</button>
        <button class="icon-btn" style="width:30px;height:30px;font-size:14px" data-action="delete-assignment" data-id="${a.id}">🗑️</button>
      </div>
    </div>
  </div>`;
}

function viewCalendar(){
  const y = App.calYear, m = App.calMonth;
  const cells = monthMatrix(y, m);
  const monthName = new Date(y, m, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' });
  const allEvents = [];
  for (const a of Store.all('assignments')){
    if (a.dueDate) allEvents.push({ date: a.dueDate, title: a.title, kind: (a.type === 'Test' || a.type === 'Exam') ? 'test' : 'work', id: a.id });
  }
  for (const e of Store.all('events')){
    if (e.start) allEvents.push({ date: e.start, title: e.title, kind: 'event', id: e.id, source: e.source });
  }
  const todayTs = startOfDay();
  const upcoming = allEvents.filter(e => startOfDay(new Date(e.date)) >= todayTs).sort((a,b) => a.date - b.date).slice(0, 14);
  return `
  <div class="page-head row-between wrap">
    <div><h1 class="page-title">Calendar</h1><p class="page-sub">Deadlines, tests and school events</p></div>
    <div class="row">
      <button class="btn btn-ghost btn-sm" data-action="cal-prev">←</button>
      <div class="strong" style="min-width:170px;text-align:center">${monthName}</div>
      <button class="btn btn-ghost btn-sm" data-action="cal-next">→</button>
      <button class="btn btn-subtle btn-sm" data-action="cal-today">Today</button>
    </div>
  </div>
  <div class="cols cols-main">
    <div class="card card-pad">
      <div class="cal-head">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
      <div class="cal-grid">
        ${cells.map(d => {
          const ts = startOfDay(d);
          const dayEvents = allEvents.filter(e => startOfDay(new Date(e.date)) === ts);
          const isToday = ts === todayTs;
          const out = d.getMonth() !== m;
          return `<div class="cal-day ${out ? 'out' : ''} ${isToday ? 'today' : ''}">
            <div class="cal-num">${d.getDate()}</div>
            ${dayEvents.slice(0,3).map(e => `<div class="cal-ev ${e.kind === 'test' ? 'test' : e.kind === 'event' ? 'event' : ''}" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</div>`).join('')}
            ${dayEvents.length > 3 ? `<div class="cal-more">+${dayEvents.length - 3} more</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-title">⏭️ Upcoming</div></div>
      <div class="card-body" style="padding-top:8px;padding-bottom:8px">
        ${upcoming.length ? upcoming.map(e => {
          const d = daysUntil(e.date);
          const cls = d <= 1 ? 'overdue' : d <= 3 ? 'soon' : 'ok';
          return `<div class="row" style="padding:9px 0;border-bottom:1px solid var(--border);gap:11px">
            <div style="width:42px;flex:none;text-align:center">
              <div style="font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase">${new Date(e.date).toLocaleDateString(undefined,{month:'short'})}</div>
              <div style="font-size:17px;font-weight:800;letter-spacing:-.03em">${new Date(e.date).getDate()}</div>
            </div>
            <div style="flex:1;min-width:0">
              <div class="small strong truncate">${escapeHtml(e.title)}</div>
              <div class="tiny muted">${escapeHtml(e.kind === 'test' ? 'Test / Exam' : e.kind === 'event' ? (e.source || 'Event') : 'Assignment')}</div>
            </div>
            <span class="due ${cls}" style="font-size:11px">${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `in ${d}d`}</span>
          </div>`;
        }).join('') : `<div class="empty" style="padding:30px 10px">
          <div class="empty-ico">📅</div><div class="empty-title">Nothing upcoming</div>
          <div class="empty-sub">Your school calendar will fill this in on the next sync.</div></div>`}
      </div>
    </div>
  </div>`;
}

function viewEffort(){
  const reports = Store.all('effortReports').sort((a,b) => b.date - a.date);
  if (!reports.length){
    return `
    <div class="page-head"><h1 class="page-title">Effort Reports</h1>
      <p class="page-sub">Upload your weekly report PDF — Scribe reads every subject and rating</p></div>
    <div class="int-upload-card">
      <div style="font-size:48px;margin-bottom:12px">📤</div>
      <h3 style="font-size:18px;margin-bottom:6px">Upload your effort report</h3>
      <p class="small muted" style="max-width:420px;margin:0 auto 18px;line-height:1.6">
        Drag in the PDF from your Friday email. Scribe pulls out every subject, weekly rating, and your year average automatically.
      </p>
      <button class="btn btn-primary btn-lg" data-action="upload-effort">📤 Choose PDF</button>
      <div class="tiny muted" style="margin-top:14px">Or press <kbd>E</kbd> anywhere</div>
    </div>`;
  }
  const latest = reports[0];
  const avgOf = r => r.ratings.length ? r.ratings.reduce((s, x) => s + x.rating, 0) / r.ratings.length : 0;
  return `
  <div class="page-head row-between wrap">
    <div><h1 class="page-title">Effort Reports</h1>
      <p class="page-sub">${reports.length} report${reports.length===1?'':'s'} · upload a new PDF each Friday</p></div>
    <button class="btn btn-primary" data-action="upload-effort">📤 Upload report</button>
  </div>
  <section class="card" style="margin-bottom:20px">
    <div class="card-head">
      <div class="card-title">📊 This week · ${escapeHtml(latest.studentCode || '')}</div>
      <div class="effort-avg"><b>${avgOf(latest).toFixed(1)}</b>/ 5</div>
    </div>
    <div class="card-body">
      ${latest.attendance != null ? `<div class="row" style="gap:10px;margin-bottom:14px"><span class="chip chip-green">Attendance ${latest.attendance}%</span><span class="chip chip-gray">${fmtDateLong(latest.date)}</span></div>` : `<div class="tiny muted" style="margin-bottom:14px">Week of ${fmtDateLong(latest.date)}</div>`}
      <div class="effort-bars">
        ${latest.ratings.sort((a,b) => a.rating - b.rating).map(r => `
          <div class="effort-bar-row">
            <div class="effort-bar-subject truncate">${escapeHtml(r.subject)}</div>
            <div class="effort-bar-track"><div class="effort-bar-fill ${ratingClass(r.rating)}" style="width:${r.rating/5*100}%"></div></div>
            <div class="effort-bar-val">${r.rating}${r.yearAvg != null ? `<span class="tiny muted" style="font-weight:500"> · ${r.yearAvg.toFixed(1)}</span>` : ''}</div>
          </div>`).join('')}
      </div>
    </div>
  </section>
  <section class="card">
    <div class="card-head"><div class="card-title">📜 All reports</div></div>
    <div class="card-body" style="padding-top:8px">
      ${reports.map(r => {
        const avg = avgOf(r);
        return `
        <div class="row" style="padding:11px 0;border-bottom:1px solid var(--border);gap:12px;align-items:center">
          <div style="width:52px;flex:none;text-align:center">
            <div style="font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase">${new Date(r.date).toLocaleDateString(undefined,{month:'short'})}</div>
            <div style="font-size:17px;font-weight:800;letter-spacing:-.03em">${new Date(r.date).getDate()}</div>
          </div>
          <div style="flex:1;min-width:0">
            <div class="small strong">${r.ratings.length} subject${r.ratings.length===1?'':'s'}${r.studentCode ? ` · ${escapeHtml(r.studentCode)}` : ''}</div>
            <div class="tiny muted truncate">${r.ratings.map(x => `${x.subject}: ${x.rating}`).join(' · ')}</div>
          </div>
          <div class="effort-avg" style="padding:4px 10px;font-size:11px"><b style="font-size:15px">${avg.toFixed(1)}</b></div>
          <button class="icon-btn" style="width:30px;height:30px;font-size:14px" data-action="delete-effort" data-id="${r.id}">🗑️</button>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

/* ── Academic pathways ────────────────────────────────────── */
function studentYearLevel(){
  const y = Number(Store.cache?.profile?.yearLevel || 0);
  return y >= 7 && y <= 13 ? y : null;
}
function isJuniorYear(y = studentYearLevel()){ return y !== null && y <= 8; }

/** Subjects the student is enrolled in (falls back to the year's default list). */
function studentSubjects(){
  const y = studentYearLevel();
  if (y === null) return [];
  if (y <= 8) return [...JUNIOR_LEARNING_AREAS];
  const saved = Store.cache.profile?.subjects;
  return Array.isArray(saved) && saved.length ? [...saved] : defaultSubjectsForYear(y);
}

/** Subjects offered in result and progress pickers: only what the student takes. */
function resultSubjectOptions(){
  const y = studentYearLevel();
  const base = y === null ? subjectsForYear(9) : y <= 8 ? JUNIOR_RESULT_SUBJECTS : (studentSubjects().length ? studentSubjects() : subjectsForYear(y));
  const used = Store.all('results').map(r => r.subject).filter(Boolean);
  return [...new Set([...base, ...used])].sort((a,b) => a.localeCompare(b));
}

/** Read a free-text grade ("82%", "17/20", "Merit", "B+") as a rough band. */
function gradeInfo(grade){
  const g = String(grade || '').trim().toLowerCase();
  if (!g) return { pct:null, band:null };
  let pct = null, m;
  if ((m = g.match(/(\d{1,3}(?:\.\d+)?)\s*%/))) pct = Number(m[1]);
  else if ((m = g.match(/^(\d{1,3}(?:\.\d+)?)\s*(?:\/|out of)\s*(\d{1,3}(?:\.\d+)?)$/)) && Number(m[2]) > 0) pct = Number(m[1]) / Number(m[2]) * 100;
  if (pct !== null){
    pct = Math.max(0, Math.min(100, pct));
    return { pct, band: pct >= 75 ? 'strong' : pct >= 50 ? 'ontrack' : 'focus' };
  }
  if (/not\s+(yet\s+)?achieved|below|working towards|needs|emerging|beginning|fail/.test(g)) return { pct:null, band:'focus' };
  if (/excellence|excellent|exceed|above|advanced|outstanding|distinction/.test(g)) return { pct:null, band:'strong' };
  if (/merit|achieved|\bat\b|meeting|expected|proficient|satisfactory|good|pass/.test(g)) return { pct:null, band:'ontrack' };
  if (/^(a\+|e)$/.test(g)) return { pct:null, band:'strong' };
  if (/^(a-?|b[+-]?|c\+?|m)$/.test(g)) return { pct:null, band:'ontrack' };
  if (/^(c-|d[+-]?|n|na)$/.test(g)) return { pct:null, band:'focus' };
  return { pct:null, band:null };
}
const BAND_LABEL = { strong:'Strong', ontrack:'On track', focus:'Needs focus' };
const BAND_CHIP = { strong:'chip-green', ontrack:'chip-indigo', focus:'chip-amber' };

function latestResultFor(names){
  const wanted = new Set([].concat(names).map(x => String(x).trim().toLocaleLowerCase()));
  return Store.all('results')
    .filter(r => wanted.has(String(r.subject || '').trim().toLocaleLowerCase()))
    .sort((a,b) => (b.date || b.createdAt || 0) - (a.date || a.createdAt || 0))[0] || null;
}

/* Years 7–8: what to aim for before Year 9. */
function renderJuniorPathway(year){
  const wanted = new Set(Store.cache.profile?.targetSubjects || []);
  const options = JUNIOR_TARGETS.filter(t => t.option);
  const shown = JUNIOR_TARGETS.filter(t => !t.option || wanted.has(t.subject));
  const tally = { strong:0, ontrack:0, focus:0, none:0 };
  const cards = shown.map(t => {
    const r = latestResultFor(t.track);
    const info = r ? gradeInfo(r.grade) : { band:null };
    if (!t.option) tally[!r ? 'none' : info.band || 'none']++;
    let status;
    if (!r) status = `<div class="junior-status none"><span class="chip chip-gray">No result yet</span><span>Add a ${escapeHtml(t.track[0])} result to see how you are tracking.</span></div>`;
    else if (info.band === 'strong') status = `<div class="junior-status strong"><span class="chip chip-green">Strong · ${escapeHtml(r.grade)}</span><span>You are ahead of the target. ${t.extension ? escapeHtml(t.extension) : 'Keep it going.'}</span></div>`;
    else if (info.band === 'ontrack') status = `<div class="junior-status ontrack"><span class="chip chip-indigo">On track · ${escapeHtml(r.grade)}</span><span>${t.extension ? 'Push towards above-expected results to keep extension classes open later.' : 'Keep building on this.'}</span></div>`;
    else if (info.band === 'focus') status = `<div class="junior-status focus"><span class="chip chip-amber">Needs focus · ${escapeHtml(r.grade)}</span><span>${t.selective ? 'Talk to your teacher or coach about what selection looks for.' : `Below the target for now. Make this a priority before Year 9 and ask your teacher for next steps.`}</span></div>`;
    else status = `<div class="junior-status none"><span class="chip chip-gray">Latest · ${escapeHtml(r.grade)}</span><span>Ask your teacher how this compares with the expected level.</span></div>`;
    return `<article class="junior-goal ${t.option ? 'is-option' : ''}">
      <div class="junior-goal-head"><strong>${escapeHtml(t.subject)}</strong><span class="chip ${t.option ? 'chip-indigo' : 'chip-gray'}">${t.option ? 'Your choice' : 'Compulsory'}</span></div>
      <div class="junior-goal-from">Builds on ${escapeHtml(t.area)}</div>
      <dl class="junior-goal-list"><div><dt>Aim for</dt><dd>${escapeHtml(t.aim)}</dd></div><div><dt>To prepare</dt><dd>${escapeHtml(t.prepare)}</dd></div></dl>
      ${status}
    </article>`;
  }).join('');
  const compulsory = JUNIOR_TARGETS.filter(t => !t.option).length;
  return `
  <section class="card junior-pathway-note">
    <div class="card-head"><div><div class="card-title">🌱 Your path to Year 9</div><p class="small muted" style="margin-top:4px">${year === 7 ? 'You have Years 7 and 8 to build these foundations.' : 'This is your last year before Year 9 subject selection.'} Your learning areas are set by the College until Year 9.</p></div><span class="chip chip-green">Year ${year}</span></div>
    <div class="card-body">
      <div class="junior-tally">
        <div><strong>${tally.strong + tally.ontrack}</strong><span>of ${compulsory} compulsory Year 9 subjects on track</span></div>
        <div><strong>${tally.focus}</strong><span>need${tally.focus === 1 ? 's' : ''} focus</span></div>
        <div><strong>${tally.none}</strong><span>with no result saved yet</span></div>
        <button class="btn btn-sm btn-primary" data-action="new-result">＋ Add result</button>
      </div>
      <div class="junior-choose">
        <div class="junior-choose-label"><strong>Year 9 options you are interested in</strong><span class="small muted">Year 9 students choose two. Tap to add or remove.</span></div>
        <div class="junior-choose-chips">${options.map(t => `<button type="button" class="target-chip ${wanted.has(t.subject) ? 'on' : ''}" aria-pressed="${wanted.has(t.subject)}" data-action="toggle-target" data-subject="${escapeHtml(t.subject)}">${wanted.has(t.subject) ? '✓ ' : ''}${escapeHtml(t.subject)}</button>`).join('')}</div>
      </div>
      <div class="junior-goal-grid">${cards}</div>
      <div class="alert alert-info" style="margin-top:14px"><span>ℹ️</span><div><strong>How this works:</strong> the College does not publish grade cut-offs for Year 9, so these are preparation targets rather than entry rules. In Year 9 everyone takes English, Health, Mathematics, Physical Education, Religious Education, Science, Social Studies and Digital Technologies, plus two options. Your results in Years 7 and 8 matter most for extension classes and for being ready for the options you want.</div></div>
    </div>
  </section>`;
}

/* Years 9–12: where each current subject leads next year, with entry guides. */
function renderNextStep(year, selected){
  const next = year + 1;
  const data = CURRICULUM[next];
  if (!data) return '';
  const mine = [...selected];
  if (!mine.length){
    return `<section class="card next-step-card"><div class="card-head"><div class="card-title">➡️ Your next step · Year ${next}</div></div><div class="card-body"><p class="small muted">Choose your Year ${year} subjects in Settings to see which Year ${next} courses they lead to.</p><button class="btn btn-sm btn-primary" style="margin-top:10px" data-nav="#/settings">Choose subjects</button></div></section>`;
  }
  const linked = new Set();
  const rows = mine.map(s => {
    const targets = successorsFor(year, s);
    if (!targets.length) return '';
    const r = latestResultFor(s);
    const info = r ? gradeInfo(r.grade) : { pct:null, band:null };
    const chips = targets.map(t => {
      linked.add(t);
      const crit = entryCriteriaFor(next, t);
      const node = nodesForYear(next).find(n => n.name === t);
      const ext = node && (node.type === 'extension' || node.type === 'scholarship');
      let state = '', note = '';
      if (crit?.min && (crit.from || []).includes(s)){
        if (info.pct !== null){
          const gap = Math.round(info.pct - crit.min);
          state = gap >= 0 ? 'met' : 'short';
          note = gap >= 0 ? `${Math.round(info.pct)}% · guide ${crit.min}%` : `${Math.abs(gap)}% short of ${crit.min}%`;
        } else note = `Guide ${crit.min}%`;
      } else if (ext) note = node.type === 'scholarship' ? 'Scholarship' : 'By selection';
      return `<button type="button" class="next-target ${state} ${ext ? 'ext' : ''}" data-action="pathway-node" data-key="${next}|${escapeHtml(t)}" title="${escapeHtml(crit?.text || '')}"><span>${escapeHtml(t)}</span>${note ? `<em>${escapeHtml(note)}</em>` : ''}</button>`;
    }).join('');
    return `<div class="next-step-row">
      <div class="next-step-from"><strong>${escapeHtml(s)}</strong>${r ? `<span class="chip ${BAND_CHIP[info.band] || 'chip-gray'}">${escapeHtml(r.grade)}</span>` : '<span class="tiny muted">No result saved</span>'}</div>
      <div class="next-step-arrow" aria-hidden="true">→</div>
      <div class="next-step-to">${chips}</div>
    </div>`;
  }).join('');
  const open = nodesForYear(next).filter(n => (n.type === 'core' || n.type === 'option') && !linked.has(n.name));
  const noLink = open.filter(n => !predecessorsFor(next, n.name).length);
  const otherLink = open.filter(n => predecessorsFor(next, n.name).length);
  const chip = n => `<button type="button" class="next-target open" data-action="pathway-node" data-key="${next}|${escapeHtml(n.name)}">${escapeHtml(n.name)}</button>`;
  return `<section class="card next-step-card">
    <div class="card-head"><div><div class="card-title">➡️ Your next step · Year ${next}</div><p class="small muted" style="margin-top:4px">${escapeHtml(data.selectionNote || '')}</p></div></div>
    <div class="card-body">
      <div class="next-step-label">Direct pathways from your subjects</div>
      ${rows || '<p class="small muted">None of your current subjects has a direct continuation next year.</p>'}
      ${noLink.length ? `<div class="next-step-label">Also available · no prerequisite subject</div><div class="next-step-open">${noLink.map(chip).join('')}</div>` : ''}
      ${otherLink.length ? `<div class="next-step-label">Follows a subject you are not taking · check with the HOD</div><div class="next-step-open">${otherLink.map(chip).join('')}</div>` : ''}
      <p class="tiny muted" style="margin-top:12px">Percentages compare your latest saved result with the entry guide published in the 2027 handbook. Students who miss a guide can still ask for HOD approval. Tap any course for details.</p>
    </div>
  </section>`;
}

function renderScholarshipStep(selected){
  const mine = [...selected].filter(s => SCHOLARSHIP_SUBJECTS.includes(s));
  return `<section class="card next-step-card">
    <div class="card-head"><div><div class="card-title">🎓 Scholarship in Year 13</div><p class="small muted" style="margin-top:4px">Teachers recommend Scholarship entry to suitable students. It sits above NCEA Level 3 and is optional.</p></div></div>
    <div class="card-body">${mine.length ? `<div class="next-step-label">Your subjects with a Scholarship opportunity</div><div class="next-step-open">${mine.map(s => `<button type="button" class="next-target ext" data-action="pathway-node" data-key="13|${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>` : '<p class="small muted">Choose your Year 13 subjects in Settings to see which of them offer Scholarship.</p>'}</div>
  </section>`;
}

/* What one node on the map says about itself. */
function pathwayNodeInfo(y, node, ctx){
  const { year, selected, reach } = ctx;
  const prev = predecessorsFor(y, node.name);
  const key = `${y}|${node.name}`;
  const isExt = node.type === 'extension' || node.type === 'scholarship';
  let cls = 'available', kind = 'Available option', origin = prev.length ? '' : 'No prerequisite subject';
  if (year && y === year){
    const on = selected.has(node.name);
    cls = on ? 'direct student-selected' : (isExt ? 'available' : 'available not-taken');
    kind = on ? (y <= 8 ? 'Your learning area' : 'Your subject') : (isExt ? 'By selection' : 'Not one of your subjects');
    origin = '';
  } else if (year && y > year && reach.has(key)){
    const fromMine = prev.filter(p => (y - 1 === year ? selected.has(p) : reach.has(`${y-1}|${p}`)));
    cls = 'direct on-my-path'; kind = 'Direct pathway'; origin = `From your ${fromMine.join(', ') || prev.join(', ')}`;
  } else if (prev.length){
    const future = year && y > year;
    cls = future ? 'linked' : 'direct';
    kind = future ? 'Pathway from another subject' : 'Direct pathway';
    origin = `${future ? 'Follows' : 'From'} ${prev.join(', ')}`;
  }
  return { key, prev, cls, kind, origin, isExt };
}

function renderPathwayNode(y, node, ctx){
  const info = pathwayNodeInfo(y, node, ctx);
  const crit = entryCriteriaFor(y, node.name);
  const result = (!ctx.year || y <= ctx.year) ? latestResultFor(node.name) : null;
  const kindCls = info.isExt ? 'extension-kind' : info.cls.includes('direct') ? 'direct-kind' : 'available-kind';
  const kindText = info.isExt ? `${node.type === 'scholarship' ? 'Scholarship course' : 'Exelerate · extension'}${info.cls.includes('on-my-path') ? ' · on your pathway' : ''}` : info.kind;
  const tags = [
    node.type === 'core' ? '<span class="pathway-tag">Core</span>' : '',
    crit?.min ? `<span class="pathway-tag">Entry guide ${crit.min}%</span>` : '',
    y === 13 && SCHOLARSHIP_SUBJECTS.includes(node.name) ? '<span class="pathway-tag tag-ext">Scholarship</span>' : ''
  ].join('');
  return `<button type="button" class="pathway-node ${info.cls} ${info.isExt ? 'extension-node' : ''}" data-action="pathway-node" data-key="${escapeHtml(info.key)}" aria-pressed="false">
    <span class="pathway-node-title">${escapeHtml(node.name)}</span>
    <span class="pathway-node-meta"><span class="pathway-kind ${kindCls}">${escapeHtml(kindText)}</span>${info.origin ? `<span class="pathway-origin">${escapeHtml(info.origin)}</span>` : ''}${tags ? `<span class="pathway-tags">${tags}</span>` : ''}${result ? `<span class="pathway-result">Latest result: ${escapeHtml(result.grade)}</span>` : ''}</span>
  </button>`;
}

function viewAcademicPathways(){
  const year = studentYearLevel();
  const junior = isJuniorYear(year);
  const selected = new Set(year ? studentSubjects() : []);
  const reach = year ? reachableFrom(year, [...selected]) : new Set();
  const ctx = { year, selected, reach };
  const showPast = !year || App.pathwayShowPast;
  const mapYears = [7,8,9,10,11,12,13].filter(y => showPast || y >= year);
  const group = (label, nodes, y) => nodes.length ? `<div class="pathway-group-label">${label}</div>${nodes.map(n => renderPathwayNode(y, n, ctx)).join('')}` : '';
  const map = mapYears.map(y => {
    const nodes = nodesForYear(y);
    const body = y <= 8
      ? group('Learning areas', nodes, y)
      : group('Core', nodes.filter(n => n.type === 'core'), y)
        + group('Options', nodes.filter(n => n.type === 'option'), y)
        + group('Exelerate and Scholarship', nodes.filter(n => n.type === 'extension' || n.type === 'scholarship'), y);
    const note = y <= 8 ? 'Set by the College; subject selection starts in Year 9.' : (CURRICULUM[y].selectionNote || '');
    return `<section class="pathway-year-column ${year === y ? 'is-current' : ''}" data-year-col="${y}">
      <div class="pathway-year-heading"><strong>Year ${y}${year === y ? ' <span class="chip chip-indigo">You are here</span>' : ''}</strong><span>${y <= 8 ? 'Homeroom programme' : y <= 10 ? 'Curriculum' : y === 11 ? 'Sacred Heart Certificate' : `NCEA Level ${y-10}`}</span></div>
      <div class="pathway-node-list">${body}<div class="pathway-origin pathway-selection-note">${escapeHtml(note)}</div></div>
    </section>`;
  }).join('');
  const yearTabs = mapYears.map(y => `<button type="button" class="pathway-year ${year === y ? 'on' : ''}" data-action="pathway-jump" data-year="${y}">Year ${y}</button>`).join('');
  const focusPanel = !year ? '' : junior ? renderJuniorPathway(year) : year === 13 ? renderScholarshipStep(selected) : renderNextStep(year, selected);

  return `
  <div class="page-head row-between wrap pathway-page-head">
    <div><h1 class="page-title">Academic Pathways</h1><p class="page-sub">See where your subjects lead, what else is open to you, and what to aim for.</p></div>
    <div class="pathway-current-year"><label class="label" for="pathway-year-select">Current year level</label><select id="pathway-year-select" class="select" data-profile="yearLevel"><option value="">Choose year level</option>${[7,8,9,10,11,12,13].map(y=>`<option value="${y}" ${year===y?'selected':''}>Year ${y}</option>`).join('')}</select></div>
  </div>
  ${focusPanel}
  <section class="card pathway-map-card">
    <div class="card-head"><div><div class="card-title">Course map · Years ${mapYears[0]}–13</div><p class="small muted" style="margin-top:4px">Every subject offered in later years is shown, whether or not it follows from something you take now. Tap a subject to trace its pathway.</p></div>
      ${year && year > 7 ? `<button class="btn btn-sm btn-ghost" data-action="pathway-toggle-past">${showPast ? 'Hide earlier years' : 'Show earlier years'}</button>` : ''}</div>
    <div class="pathway-legend"><span><i class="legend-direct"></i> Direct pathway ${year ? 'from your subjects' : 'from an earlier subject'}</span>${year ? '<span><i class="legend-linked"></i> Follows a subject you are not taking</span>' : ''}<span><i class="legend-available"></i> Available option, no prerequisite subject</span><span><i class="legend-extension"></i> Exelerate, extension and Scholarship</span></div>
    <div class="pathway-year-tabs" aria-label="Jump to a year level">${yearTabs}</div>
    <div id="pathway-detail" class="pathway-detail" hidden></div>
    <div class="pathway-map-scroll"><div class="pathway-map" style="--pathway-cols:${mapYears.length}">${map}</div></div>
  </section>
  <section class="card pathway-footnote">
    <div class="card-body"><strong>How to read this map</strong><p class="small muted" style="margin-top:5px">Pathways and entry guides come from the Sacred Heart College 2027 Curriculum Handbook. They are a guide, not a guarantee: subject availability, acceleration and entry depend on College decisions, class sizes and timetabling, and students who miss an entry guide can ask for HOD approval. Scribe does not decide eligibility. Talk to the relevant teacher or Head of Department about specific choices.</p><p class="small muted" style="margin-top:8px">NCEA Scholarship sits above Level 3. Students from Years 9–13 may attempt it, and teachers usually recommend entry in Years 12 and 13. The handbook does not use the name Exelerate, so Scribe shows the College's invitation-only extension and accelerate classes (ENX, MAX, SCX and the Music Institute) under that heading. Confirm the details with the College.</p></div>
  </section>`;
}

/* Trace one subject's pathway on the map without re-rendering the page. */
function focusPathwayNode(key){
  const mapEl = $('.pathway-map');
  const detail = $('#pathway-detail');
  if (!mapEl || !detail) return;
  if (!key || App.pathwayFocus === key){
    App.pathwayFocus = null;
    mapEl.classList.remove('has-focus');
    $$('.pathway-node', mapEl).forEach(n => { n.classList.remove('in-chain', 'is-focus'); n.setAttribute('aria-pressed', 'false'); });
    detail.hidden = true; detail.innerHTML = '';
    return;
  }
  const sep = key.indexOf('|');
  const y = Number(key.slice(0, sep)), name = key.slice(sep + 1);
  const hidden = !$$('.pathway-node', mapEl).some(n => n.dataset.key === key);
  if (hidden){ App.pathwayShowPast = true; App.pathwayFocus = null; render(); focusPathwayNode(key); return; }
  App.pathwayFocus = key;
  const chain = pathwayChain(y, name);
  mapEl.classList.add('has-focus');
  $$('.pathway-node', mapEl).forEach(n => {
    n.classList.toggle('in-chain', chain.has(n.dataset.key));
    n.classList.toggle('is-focus', n.dataset.key === key);
    n.setAttribute('aria-pressed', String(n.dataset.key === key));
  });
  const prev = predecessorsFor(y, name), next = successorsFor(y, name);
  const crit = entryCriteriaFor(y, name);
  const node = nodesForYear(y).find(n => n.name === name);
  const rows = [];
  rows.push(`<div><dt>Leads from</dt><dd>${prev.length ? escapeHtml(prev.map(p => `Year ${y-1} ${p}`).join(', ')) : (y <= 7 ? 'Starting point' : 'No prerequisite subject. It is open as a new option.')}</dd></div>`);
  rows.push(`<div><dt>Leads to</dt><dd>${next.length ? escapeHtml(next.map(n => `Year ${y+1} ${n}`).join(', ')) : (y === 13 ? 'End of school pathways' : 'No direct continuation listed')}</dd></div>`);
  if (crit) rows.push(`<div><dt>Entry guide</dt><dd>${escapeHtml(crit.text)}</dd></div>`);
  if (crit?.min){
    const src = (crit.from || []).map(f => ({ f, r: latestResultFor(f) })).find(x => x.r);
    const pct = src ? gradeInfo(src.r.grade).pct : null;
    if (src && pct !== null){
      const gap = Math.round(pct - crit.min);
      rows.push(`<div><dt>Your result</dt><dd><span class="chip ${gap >= 0 ? 'chip-green' : 'chip-amber'}">${escapeHtml(src.r.grade)} in ${escapeHtml(src.f)}</span> ${gap >= 0 ? `${gap}% above the ${crit.min}% guide.` : `${Math.abs(gap)}% short of the ${crit.min}% guide. Lift this result or talk to the HOD.`}</dd></div>`);
    } else rows.push(`<div><dt>Your result</dt><dd>Save a percentage result for ${escapeHtml((crit.from || []).join(' or '))} to compare it with the ${crit.min}% guide.</dd></div>`);
  }
  if (y === 13 && SCHOLARSHIP_SUBJECTS.includes(name)) rows.push('<div><dt>Scholarship</dt><dd>A Scholarship exam, portfolio or programme is available for this subject. Teachers recommend entry.</dd></div>');
  const typeLabel = { core:'Core', option:'Option', foundation:'Learning area', extension:'Exelerate · extension', scholarship:'Scholarship course' }[node?.type] || '';
  detail.innerHTML = `<div class="pathway-detail-head"><div><strong>Year ${y} · ${escapeHtml(name)}</strong>${typeLabel ? `<span class="chip ${node.type === 'extension' || node.type === 'scholarship' ? 'chip-violet' : 'chip-gray'}">${typeLabel}</span>` : ''}</div><button class="btn btn-sm btn-ghost" data-action="pathway-clear">Clear</button></div><dl class="pathway-detail-list">${rows.join('')}</dl>`;
  detail.hidden = false;
  detail.scrollIntoView({ block:'nearest', behavior:'smooth' });
}

/* ── Results ───────────────────────────────────────────────── */
function viewResults(){
  const results = Store.all('results').slice().sort((a,b) => (b.date||b.createdAt||0) - (a.date||a.createdAt||0));
  const bySubject = new Map();
  for (const r of results){
    const key = r.subject || 'Unspecified subject';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(r);
  }
  const filter = bySubject.has(App.resultsFilter) ? App.resultsFilter : '';
  const shown = filter ? bySubject.get(filter) : results;
  const latest = results[0];
  const pcts = results.map(r => gradeInfo(r.grade).pct).filter(x => x !== null);
  const average = pcts.length ? Math.round(pcts.reduce((s,x) => s + x, 0) / pcts.length) : null;

  const subjectCards = [...bySubject.entries()].sort((a,b) => a[0].localeCompare(b[0])).map(([name, list]) => {
    const info = gradeInfo(list[0].grade);
    const older = list.slice(1).map(r => gradeInfo(r.grade).pct).find(x => x !== null);
    const trend = info.pct !== null && older !== undefined ? (info.pct > older ? '<span class="result-trend up">▲ up</span>' : info.pct < older ? '<span class="result-trend down">▼ down</span>' : '<span class="result-trend">● steady</span>') : '';
    return `<button type="button" class="result-subject ${filter === name ? 'on' : ''}" data-action="filter-results" data-subject="${escapeHtml(name)}" aria-pressed="${filter === name}">
      <span class="result-subject-name">${escapeHtml(name)}</span>
      <span class="result-subject-meta">${list.length} result${list.length === 1 ? '' : 's'}${trend}</span>
      <span class="result-grade band-${info.band || 'none'}">${escapeHtml(list[0].grade || '—')}</span>
    </button>`;
  }).join('');

  const rows = shown.map(r => {
    const info = gradeInfo(r.grade);
    return `<article class="result-row">
      <div class="result-grade result-grade-lg band-${info.band || 'none'}">${escapeHtml(r.grade || '—')}</div>
      <div class="result-row-main">
        <h3 class="result-row-title">${escapeHtml(r.title || 'Assessment')}</h3>
        <div class="result-row-meta"><span class="chip chip-indigo">${escapeHtml(r.subject || 'Unspecified')}</span><span class="chip chip-gray">${escapeHtml(r.kind || 'Assessment')}</span><span class="result-row-date">${r.date ? fmtDateLong(r.date) : 'No date'}</span></div>
        ${r.feedback ? `<p class="result-row-feedback">${escapeHtml(r.feedback)}</p>` : ''}
      </div>
      <div class="results-actions"><button class="btn btn-ghost btn-sm" data-action="edit-result" data-id="${r.id}">Edit</button><button class="icon-btn" aria-label="Delete result" data-action="delete-result" data-id="${r.id}">✕</button></div>
    </article>`;
  }).join('');

  return `
  <div class="page-head row-between wrap">
    <div><h1 class="page-title">Results</h1><p class="page-sub">A clear record of your assessment results and progress.</p></div>
    <button class="btn btn-primary" data-action="new-result">＋ Add result</button>
  </div>
  <div class="results-summary-grid ${average !== null ? 'has-4' : ''}">
    <div class="results-summary-card"><span class="results-summary-label">Results recorded</span><strong>${results.length}</strong><span class="results-summary-sub">Across all subjects</span></div>
    <div class="results-summary-card"><span class="results-summary-label">Subjects tracked</span><strong>${bySubject.size}</strong><span class="results-summary-sub">With at least one result</span></div>
    <div class="results-summary-card"><span class="results-summary-label">Most recent</span><strong class="results-latest-grade">${latest ? escapeHtml(latest.grade || '—') : '—'}</strong><span class="results-summary-sub">${latest ? `${escapeHtml(latest.subject || 'Unspecified subject')} · ${fmtDate(latest.date)}` : 'No results yet'}</span></div>
    ${average !== null ? `<div class="results-summary-card"><span class="results-summary-label">Average</span><strong>${average}%</strong><span class="results-summary-sub">Across ${pcts.length} percentage result${pcts.length === 1 ? '' : 's'}</span></div>` : ''}
  </div>
  ${results.length ? `
  <div class="results-layout">
    <section class="card results-list-card">
      <div class="card-head"><div><div class="card-title">${filter ? escapeHtml(filter) : 'Assessment history'}</div><p class="small muted" style="margin-top:4px">${filter ? 'Showing one subject, newest first.' : 'Newest first. Results are stored exactly as entered.'}</p></div><div class="row" style="gap:8px">${filter ? '<button class="btn btn-sm btn-ghost" data-action="filter-results" data-subject="">Show all</button>' : ''}<span class="chip chip-gray">${shown.length} record${shown.length===1?'':'s'}</span></div></div>
      <div class="result-rows">${rows}</div>
    </section>
    <aside class="card results-subjects-card">
      <div class="card-head"><div><div class="card-title">By subject</div><p class="small muted" style="margin-top:4px">Latest result in each. Tap to filter.</p></div></div>
      <div class="result-subjects">${subjectCards}</div>
    </aside>
  </div>` : `
  <section class="card results-list-card"><div class="empty"><div class="empty-ico">📈</div><div class="empty-title">No results recorded yet</div><div class="empty-sub">Add a result to keep your assessment history together. You can enter a grade, percentage, comment or school report descriptor.</div><div class="empty-actions"><button class="btn btn-sm btn-primary" data-action="new-result">＋ Add your first result</button></div></div></section>`}`;
}

function openResultModal(existing = null){
  const result = existing || {};
  const subjects = resultSubjectOptions();
  openModal({
    title: existing ? 'Edit result' : 'Add result',
    subtitle: 'Record the result using the wording or grade your teacher provided.',
    body: `
      <div class="field"><label class="label" for="result-title">Assessment name *</label><input class="input" id="result-title" maxlength="180" value="${escapeHtml(result.title||'')}" placeholder="e.g. Algebra test"></div>
      <div class="field"><label class="label" for="result-subject">Subject *</label><select class="select" id="result-subject"><option value="">Choose a subject</option>${subjects.map(x=>`<option value="${escapeHtml(x)}" ${result.subject===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select></div>
      <div class="row result-modal-row" style="gap:12px;align-items:flex-start"><div class="field" style="flex:1"><label class="label" for="result-grade">Result / grade *</label><input class="input" id="result-grade" maxlength="60" value="${escapeHtml(result.grade||'')}" placeholder="e.g. 82%, Merit, Achieved"></div><div class="field" style="flex:1"><label class="label" for="result-date">Date</label><input class="input" id="result-date" type="date" value="${result.date ? dateInputValue(result.date) : dateInputValue()}"></div></div>
      <div class="field"><label class="label" for="result-kind">Assessment type</label><select class="select" id="result-kind">${['Test','Assignment','Exam','Practical','Project','School report','Other'].map(x=>`<option ${result.kind===x?'selected':''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label class="label" for="result-feedback">Teacher feedback / notes (optional)</label><textarea class="textarea" id="result-feedback" maxlength="1200" placeholder="What went well? What should improve?">${escapeHtml(result.feedback||'')}</textarea></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="result-save">${existing?'Save changes':'Add result'}</button>`,
    onMount(el, close){
      $('#result-save', el).addEventListener('click', async () => {
        const title = sanitiseText($('#result-title',el).value,180);
        const subject = sanitiseText($('#result-subject',el).value,100);
        const grade = sanitiseText($('#result-grade',el).value,60);
        if (!title || !subject || !grade){ toast('Enter an assessment name, subject and result.','error'); return; }
        const dateInput = $('#result-date',el).value;
        const date = dateInput ? new Date(dateInput+'T12:00:00').getTime() : now();
        await Store.put('results', { id: existing?.id || uid(), title, subject, grade, date, kind: $('#result-kind',el).value, feedback: sanitiseText($('#result-feedback',el).value,1200) });
        close(); toast(existing?'Result updated':'Result added','success'); render();
      });
    }
  });
}

/* ── Study planner ────────────────────────────────────────── */
function findFreeSlots(dayKey, durationMin, activities){
  const dayOfWeek = new Date(dayKey).getDay();
  const dayActivities = activities
    .filter(a => Number(a.day) === dayOfWeek)
    .map(a => ({ start: timeToMin(a.start), end: timeToMin(a.end), name: a.name }))
    .sort((a,b) => a.start - b.start);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const windowStart = isWeekend ? 9 * 60 : 15 * 60 + 30;
  const windowEnd = 21 * 60;
  const slots = [];
  let cursor = windowStart;
  for (const act of dayActivities){
    if (act.start > cursor && act.start - cursor >= durationMin){
      slots.push({ start: cursor, end: act.start, blocked: act.name });
    }
    cursor = Math.max(cursor, act.end);
  }
  if (windowEnd - cursor >= durationMin) slots.push({ start: cursor, end: windowEnd, blocked: null });
  return slots;
}

function scheduleSession(assignment, sessionDays, totalMinutes, activities, busy){
  const d = daysUntil(assignment.dueDate);
  const perSession = Math.round(totalMinutes / sessionDays);
  const out = [];
  for (let k = 0; k < sessionDays; k++){
    const dayOffset = d === null ? k : Math.max(0, d - (sessionDays - 1 - k));
    const dayKey = startOfDay(new Date(Date.now() + dayOffset * 86400000));
    const daySessions = busy[dayKey] || [];
    const free = findFreeSlots(dayKey, perSession, activities);
    free.sort((a,b) => a.start - b.start);
    let placed = null;
    for (const slot of free){
      let start = slot.start;
      for (const s of daySessions){
        if (s.end <= start) continue;
        if (start + perSession <= s.start) break;
        start = s.end;
      }
      if (start + perSession <= slot.end){ placed = { start, end: start + perSession }; break; }
    }
    if (!placed) continue;
    (busy[dayKey] = busy[dayKey] || []).push(placed);
    out.push({
      assignmentId: assignment.id,
      title: `${k === 0 ? 'Start' : k === sessionDays - 1 ? 'Finish' : 'Continue'}: ${assignment.title}`,
      subject: assignment.subject, minutes: perSession,
      day: dayKey, start: placed.start, end: placed.end, type: assignment.type
    });
  }
  return out;
}

function fmtMinutes(mins){
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m/60)}h ${m % 60}m` : `${m/60}h`;
}

function viewPlanner(){
  const items = Store.all('assignments').filter(a => !a.completed);
  const sessions = Store.all('studySessions').sort((a,b) => (a.start||0) - (b.start||0));
  const activities = Store.cache.settings.weeklyActivities || [];
  const ranked = items.map(i => ({ i, score: plannerScore(i) })).sort((a,b) => b.score - a.score);
  const busy = {};
  const suggestions = [];
  for (const { i } of ranked){
    const mins = estimateMinutes(i);
    const d = daysUntil(i.dueDate);
    const sessionDays = Math.min(3, Math.max(1, d === null ? 2 : d));
    const placed = scheduleSession(i, sessionDays, mins, activities, busy);
    suggestions.push(...placed);
  }
  const byDay = {};
  for (const s of suggestions){ (byDay[s.day] = byDay[s.day] || []).push(s); }
  Object.values(byDay).forEach(arr => arr.sort((a,b) => a.start - b.start));
  const days = Object.keys(byDay).map(Number).sort((a,b) => a - b).slice(0, 7);
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Free study time for the next seven days, after activities and suggested sessions.
  const week = Array.from({ length: 7 }, (_, k) => {
    const dayKey = startOfDay(new Date(Date.now() + k * 86400000));
    // For today, only count time that is still ahead.
    const nowMin = k === 0 ? new Date().getHours() * 60 + new Date().getMinutes() : 0;
    const slots = findFreeSlots(dayKey, 10, activities)
      .map(x => ({ ...x, start: Math.max(x.start, nowMin) }))
      .filter(x => x.end - x.start >= 10);
    const free = slots.reduce((s, x) => s + (x.end - x.start), 0);
    const planned = (byDay[dayKey] || []).reduce((s, x) => s + x.minutes, 0);
    return { dayKey, slots, free, planned, left: Math.max(0, free - planned) };
  });
  const maxFree = Math.max(1, ...week.map(d => d.free));
  const plannedTotal = days.reduce((s, d) => s + byDay[d].reduce((t, x) => t + x.minutes, 0), 0);
  const nextDue = items.filter(i => i.dueDate).sort((a,b) => a.dueDate - b.dueDate)[0];
  const tightest = week.filter(d => d.planned > 0).sort((a,b) => a.left - b.left)[0];
  const tip = !ranked.length ? 'Nothing is waiting. Use a free block to review notes or get ahead on reading.'
    : tightest && tightest.left < 30 ? `${new Date(tightest.dayKey).toLocaleDateString(undefined,{weekday:'long'})} is nearly full. Move a session earlier in the week if you can.`
    : nextDue && daysUntil(nextDue.dueDate) <= 1 ? `"${nextDue.title}" is due ${daysUntil(nextDue.dueDate) <= 0 ? 'today' : 'tomorrow'}. Do that session first.`
    : 'Short sessions count. A 10 to 15 minute gap is enough to start a task or revise one topic.';

  const activityHtml = activities.length ? activities.slice().sort((a,b) => a.day - b.day || a.start.localeCompare(b.start)).map(a => `
    <div class="activity-row">
      <div class="activity-day">${dayNames[a.day]}</div>
      <div class="activity-time">${escapeHtml(a.start)}–${escapeHtml(a.end)}</div>
      <div class="activity-name truncate">${escapeHtml(a.name)}</div>
      <button class="icon-btn" style="width:26px;height:26px;font-size:13px;color:var(--red-500)" aria-label="Remove activity" data-action="delete-activity" data-id="${a.id}">✕</button>
    </div>`).join('') : `<div class="empty" style="padding:18px 12px">
      <div class="empty-title">No activities yet</div>
      <div class="empty-sub">Add tutoring, sport or music so the planner can schedule around them.</div>
      <button class="btn btn-sm btn-primary" style="margin-top:10px" data-action="edit-activities">Add activities</button></div>`;

  return `
  <div class="page-head row-between wrap">
    <div><h1 class="page-title">Study Planner</h1><p class="page-sub">Recommended sessions built around your week</p></div>
    ${sessions.length ? `<button class="btn btn-ghost" data-action="clear-sessions">Clear saved sessions</button>` : ''}
  </div>
  <div class="planner-stats">
    <div class="planner-stat"><span class="planner-stat-label">To plan</span><strong>${ranked.length}</strong><span class="planner-stat-sub">open task${ranked.length === 1 ? '' : 's'}</span></div>
    <div class="planner-stat"><span class="planner-stat-label">Suggested study</span><strong>${fmtMinutes(plannedTotal)}</strong><span class="planner-stat-sub">over ${days.length || 0} day${days.length === 1 ? '' : 's'}</span></div>
    <div class="planner-stat"><span class="planner-stat-label">Next due</span><strong class="planner-stat-text truncate">${nextDue ? escapeHtml(nextDue.title) : 'Nothing due'}</strong><span class="planner-stat-sub">${nextDue ? escapeHtml(dueLabel(nextDue.dueDate).text) : 'You are all caught up'}</span></div>
    <div class="planner-stat"><span class="planner-stat-label">Free today</span><strong>${fmtMinutes(week[0].left)}</strong><span class="planner-stat-sub">after activities and sessions</span></div>
  </div>
  <div class="planner-layout">
    <section class="card planner-suggestions">
      <div class="card-head"><div class="card-title">🗓️ Study plan</div><span class="chip chip-gray">${suggestions.length} session${suggestions.length === 1 ? '' : 's'}</span></div>
      <div class="card-body planner-scroll">
        ${days.length ? days.map(day => {
          const list = byDay[day];
          const total = list.reduce((s, x) => s + x.minutes, 0);
          const isToday = day === startOfDay();
          return `<div class="planner-day">
            <div class="planner-day-head">
              <div class="strong small">${isToday ? 'Today' : new Date(day).toLocaleDateString(undefined,{weekday:'long', day:'numeric', month:'short'})}</div>
              <span class="chip chip-gray">${total} min</span>
            </div>
            ${list.map(s => `
              <div class="planner-session">
                <div class="planner-session-time">${minToTime(s.start)}<span>${minToTime(s.end)}</span></div>
                <div style="flex:1;min-width:0">
                  <div class="small strong truncate">${escapeHtml(s.title)}</div>
                  <div class="tiny muted truncate">${escapeHtml(s.subject || s.type)} · ${s.minutes} min</div>
                </div>
                <button class="btn btn-sm btn-subtle" data-action="save-session" data-assignment="${s.assignmentId}" data-title="${escapeHtml(s.title)}" data-minutes="${s.minutes}" data-day="${day}" data-start="${s.start}">Save</button>
              </div>`).join('')}
          </div>`;
        }).join('') : `<div class="empty" style="padding:30px 10px">
          <div class="empty-ico">✨</div><div class="empty-title">No sessions needed</div>
          <div class="empty-sub">You're all caught up.</div></div>`}
      </div>
    </section>
    <section class="card planner-priorities">
      <div class="card-head"><div class="card-title">📋 Priority order</div><span class="chip chip-gray">${ranked.length}</span></div>
      <div class="card-body planner-scroll" style="padding-top:4px">
        ${ranked.length ? ranked.map(({ i }, idx) => {
          const due = dueLabel(i.dueDate);
          const cls = i.priority === 'urgent' ? 'urgent' : i.priority === 'high' ? 'high' : i.priority === 'low' ? 'low' : '';
          return `<div class="next-item ${cls}">
            <div class="next-rank">${idx+1}</div>
            <div style="flex:1;min-width:0">
              <div class="item-title" style="margin-bottom:3px">${escapeHtml(i.title)}</div>
              <div class="item-meta">
                ${i.subject ? `<span class="chip chip-indigo">${escapeHtml(i.subject)}</span>` : ''}
                <span class="chip chip-gray">${escapeHtml(i.type)}</span>
                <span class="chip chip-gray">~${estimateMinutes(i)} min</span>
                <span class="due ${due.cls}">${escapeHtml(due.text)}</span>
              </div>
            </div>
          </div>`;
        }).join('') : `<div class="empty" style="padding:34px 12px">
          <div class="empty-ico">🎯</div><div class="empty-title">Nothing to plan yet</div>
          <div class="empty-sub">Sync Google or Smart Paste your Classroom work.</div>
          <div class="empty-actions"><button class="btn btn-sm btn-primary" data-action="sync-now">🔄 Sync now</button></div>
        </div>`}
      </div>
    </section>
    <div class="planner-side">
      <section class="card planner-free">
        <div class="card-head"><div class="card-title">⏱️ Available study time</div></div>
        <div class="card-body">
          ${week.map((d, k) => `<div class="free-row" title="${d.slots.map(s => `${minToTime(s.start)}–${minToTime(s.end)}`).join(', ') || 'No free blocks'}">
            <span class="free-day">${k === 0 ? 'Today' : dayNames[new Date(d.dayKey).getDay()]}</span>
            <span class="free-track"><i class="free-planned" style="width:${Math.min(100, d.planned / maxFree * 100)}%"></i><i class="free-left" style="width:${d.left / maxFree * 100}%"></i></span>
            <span class="free-val">${fmtMinutes(d.left)}</span>
          </div>`).join('')}
          <div class="free-key"><span><i class="free-planned"></i> Planned</span><span><i class="free-left"></i> Still free</span></div>
          <p class="planner-tip">💡 ${escapeHtml(tip)}</p>
        </div>
      </section>
      <section class="card planner-activities">
        <div class="card-head"><div class="card-title">🏃 Weekly activities</div>
          <button class="btn btn-sm btn-ghost" data-action="edit-activities">Edit</button></div>
        <div class="card-body" style="padding-top:8px;padding-bottom:8px">${activityHtml}</div>
      </section>
      ${sessions.length ? `
      <section class="card planner-saved">
        <div class="card-head"><div class="card-title">🔖 Saved sessions</div><span class="chip chip-gray">${sessions.length}</span></div>
        <div class="card-body" style="padding-top:4px;padding-bottom:6px">
          ${sessions.map(s => `
            <div class="row planner-saved-row">
              <div style="flex:1;min-width:0">
                <div class="small strong truncate">${escapeHtml(s.title)}</div>
                <div class="tiny muted">${fmtDateLong(s.start)} · ${s.minutes} min</div>
              </div>
              <button class="icon-btn" style="width:30px;height:30px;font-size:14px" aria-label="Delete saved session" data-action="delete-session" data-id="${s.id}">🗑️</button>
            </div>`).join('')}
        </div>
      </section>` : ''}
    </div>
  </div>`;
}

/* ── Integrations ─────────────────────────────────────────── */
function viewIntegrations(){
  const subs = Store.cache.settings.calendarSubscriptions || [];
  const i = Store.cache.integrations || {};
  const s = Store.cache.settings;
  const googleReady = GoogleServices.has();
  const classroomOn = i.classroom?.connected;
  const emailOn = i.email?.connected;
  const classroomItems = Store.all('assignments').filter(a => (a.sources || []).some(s => s.source === 'Google Classroom'));
  const emailItems = Store.all('assignments').filter(a => (a.sources || []).some(s => s.source === 'Email'));
  const courses = Store.all('courses');
  const lastSync = Math.max(i.classroom?.lastSync || 0, i.email?.lastSync || 0) || 0;

  return `
  <div class="page-head">
    <h1 class="page-title">Integrations</h1>
    <p class="page-sub">Sync Google Classroom, Gmail, and your school calendar.</p>
  </div>

  <div class="stack">

    <!-- Google sync status -->
    <section class="card card-pad int-card" style="border:2px solid ${googleReady ? 'var(--green-500)' : 'var(--amber-500)'};background:${googleReady ? 'linear-gradient(135deg,var(--green-50) 0%,#fff 100%)' : 'linear-gradient(135deg,var(--amber-50) 0%,#fff 100%)'}">
      <div class="int-logo" style="background:${googleReady ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#f59e0b,#d97706)'};color:#fff;border:none;font-size:22px">🔗</div>
      <div class="int-body">
        <div class="int-name">
          Google Account
          <span class="status-pill ${googleReady ? 'on' : 'off'}"><span class="pdot"></span>${googleReady ? 'Connected' : 'Not connected'}</span>
        </div>
        <div class="int-desc">
          ${googleReady
            ? 'Signed in. Scribe can read your Classroom courses, coursework, and school emails.'
            : 'Your Google account is signed in, but Scribe still needs permission to read Classroom and Gmail.'}
        </div>
        ${googleReady ? `<div class="int-stats">
          <div class="int-stat"><b>${courses.length}</b>Classroom courses</div>
          <div class="int-stat"><b>${classroomItems.length}</b>Classroom items</div>
          <div class="int-stat"><b>${emailItems.length}</b>Email items</div>
          <div class="int-stat"><b>${relativeTime(lastSync)}</b>last sync</div>
        </div>` : ''}
        <div class="int-actions">
          ${googleReady
            ? `<button class="btn btn-primary btn-sm" data-action="sync-now">🔄 Sync now</button>
               <button class="btn btn-ghost btn-sm" data-action="connect-google-api">Reconnect access</button>`
            : `<button class="btn btn-primary btn-sm" data-action="connect-google-api">Connect Google</button>`}
        </div>
      </div>
    </section>

    <!-- Classroom + Gmail toggles -->
    ${googleReady ? `
    <div class="cols cols-2">
      <section class="card card-pad int-card">
        <div class="int-logo" style="background:linear-gradient(135deg,#34a853,#0f9d58);color:#fff;border:none;font-size:20px">🎓</div>
        <div class="int-body">
          <div class="int-name">Google Classroom</div>
          <div class="int-desc">Every published assignment and quiz from your active courses.</div>
          <div class="int-actions">
            <label class="checkbox"><input type="checkbox" data-setting="enableClassroom" ${s.enableClassroom !== false ? 'checked' : ''}> <span class="small">Include in sync</span></label>
          </div>
        </div>
      </section>
      <section class="card card-pad int-card">
        <div class="int-logo" style="background:linear-gradient(135deg,#ea4335,#c5221f);color:#fff;border:none;font-size:20px">📧</div>
        <div class="int-body">
          <div class="int-name">School Emails</div>
          <div class="int-desc">Reads school emails to find deadlines, tests, and reminders.</div>
          <div class="int-actions">
            <label class="checkbox"><input type="checkbox" data-setting="enableGmail" ${s.enableGmail !== false ? 'checked' : ''}> <span class="small">Include in sync</span></label>
          </div>
        </div>
      </section>
    </div>` : ''}

    <!-- Smart Paste fallback -->
    <section class="card card-pad int-card hero">
      <div class="int-logo" style="background:linear-gradient(135deg,#6366f1,#4338ca);color:#fff;border:none;font-size:22px">✨</div>
      <div class="int-body">
        <div class="int-name">Smart Paste <span class="chip chip-green">Always available</span></div>
        <div class="int-desc int-hero-body">
          Copy your Classroom To-do page, an email, or a plain list — Scribe extracts every assignment.
          Works even when Google sync is blocked or unavailable.
        </div>
        <div class="int-hero-actions">
          <button class="btn btn-primary btn-lg" data-action="paste-classroom">✨ Smart Paste</button>
          <button class="btn btn-ghost" data-action="show-paste-help">How it works</button>
        </div>
      </div>
    </section>

    <!-- Effort reports -->
    <section class="card card-pad int-card" style="border:2px solid var(--violet-500);background:linear-gradient(135deg,var(--violet-50) 0%,#fff 100%)">
      <div class="int-logo" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;border:none;font-size:22px">📤</div>
      <div class="int-body">
        <div class="int-name">Upload effort report PDF</div>
        <div class="int-desc">Drop in your weekly PDF from school. Scribe reads every subject, weekly rating and your year average.</div>
        <div class="int-hero-actions"><button class="btn btn-primary" data-action="upload-effort">📤 Upload report</button></div>
      </div>
    </section>

    <!-- School calendars -->
    <section class="card">
      <div class="card-head">
        <div class="card-title">📆 School calendars</div>
        <button class="btn btn-sm btn-ghost" data-action="add-calendar-sub">＋ Add calendar</button>
      </div>
      <div class="card-body" style="padding-top:8px;padding-bottom:8px">
        ${subs.length ? subs.map(sub => `
          <div class="set-row">
            <div class="set-info">
              <div class="set-name">
                ${escapeHtml(sub.name)}
                ${sub.builtin ? '<span class="chip chip-indigo" style="margin-left:6px">Built-in</span>' : ''}
                ${sub.error ? '<span class="chip chip-red" style="margin-left:6px">Error</span>' : ''}
              </div>
              <div class="set-desc truncate">${escapeHtml(sub.error || sub.url)}</div>
            </div>
            <div class="set-control">
              <button class="btn btn-ghost btn-sm" data-sync="calendar">Sync</button>
              ${!sub.builtin ? `<button class="btn btn-danger-soft btn-sm" data-action="remove-calendar-sub" data-id="${sub.id}">Remove</button>` : ''}
            </div>
          </div>`).join('') : `<div class="empty" style="padding:26px 10px">
          <div class="empty-title">No calendars yet</div>
          <div class="empty-sub">Add a public ICS URL to pull in school events.</div></div>`}
      </div>
    </section>
  </div>`;
}


/* ── School administration ───────────────────────────────── */
function adminSchoolPayloadFromForm(){
  const features = $$('[data-admin-feature]').filter(x => x.checked).map(x => x.dataset.adminFeature);
  return {
    name: $('#admin-school-name')?.value.trim() || '',
    slug: $('#admin-school-slug')?.value.trim() || '',
    domainsCsv: $('#admin-school-domains')?.value.trim() || '',
    calendarUrls: $('#admin-school-calendars')?.value.trim() || '',
    adminEmailsCsv: $('#admin-school-admins')?.value.trim() || '',
    logoUrl: $('#admin-school-logo')?.value.trim() || '',
    allowPersonalAccounts: !!$('#admin-personal-accounts')?.checked,
    defaultSidebarFeatures: features
  };
}
function adminFormHtml(school, isGlobal){
  const s = school || { name:'', slug:'', domains:[], calendarSubscriptions:[], adminEmails:[], logoUrl:'', allowPersonalAccounts:false, defaultSidebarFeatures:DEFAULT_SETTINGS.sidebarFeatures };
  const featureSet = new Set(s.defaultSidebarFeatures || DEFAULT_SETTINGS.sidebarFeatures);
  return `
  <section class="card">
    <div class="card-head"><div class="card-title">🏫 ${isGlobal ? (school ? 'Edit school' : 'Add school') : 'Your school'}</div></div>
    <div class="card-body">
      <div class="cols cols-2">
        <div class="field"><label class="label">School name</label><input class="input" id="admin-school-name" value="${escapeHtml(s.name || '')}" placeholder="Example College"></div>
        <div class="field"><label class="label">School code / slug</label><input class="input" id="admin-school-slug" value="${escapeHtml(s.slug || '')}" placeholder="example-college"></div>
      </div>
      <div class="field"><label class="label">Google Workspace domains</label><textarea class="textarea" id="admin-school-domains" rows="2" placeholder="school.nz, students.school.nz">${escapeHtml((s.domains || []).join(', '))}</textarea><div class="hint">Students using a Google account from one of these domains are automatically placed into this school.</div></div>
      <div class="field"><label class="label">School calendar URLs</label><textarea class="textarea" id="admin-school-calendars" rows="3" placeholder="https://school.example/calendar.ics">${escapeHtml((s.calendarSubscriptions || []).map(x => x.url).join('\n'))}</textarea><div class="hint">Optional public ICS feeds, one per line. Students cannot change these built-in school calendars.</div></div>
      <div class="field"><label class="label">School administrator emails</label><textarea class="textarea" id="admin-school-admins" rows="2" placeholder="admin@school.nz">${escapeHtml((s.adminEmails || []).join(', '))}</textarea><div class="hint">Google accounts listed here can manage this school's settings.</div></div>
      <div class="field"><label class="label">Logo URL (optional)</label><input class="input" id="admin-school-logo" value="${escapeHtml(s.logoUrl || '')}" placeholder="https://…"></div>
      <label class="checkbox" style="margin:8px 0 18px"><input type="checkbox" id="admin-personal-accounts" ${s.allowPersonalAccounts ? 'checked' : ''}> <span>Allow students to use personal Google accounts</span></label>
      <div class="admin-features"><div class="label" style="margin-bottom:8px">Default sidebar features</div>${SIDEBAR_FEATURES.map(f => `<label class="sidebar-setting"><input type="checkbox" data-admin-feature="${f.id}" ${featureSet.has(f.id) ? 'checked' : ''}><span><span class="sidebar-setting-icon">${f.icon}</span><span><strong>${escapeHtml(f.label)}</strong><small>${escapeHtml(f.group)}</small></span></span></label>`).join('')}</div>
      <div class="row" style="justify-content:flex-end;margin-top:18px;gap:8px"><button class="btn btn-primary" data-action="admin-save-school" data-id="${escapeHtml(s.id || '')}">Save school</button></div>
    </div>
  </section>`;
}
function viewAdmin(){
  const isGlobal = App.user?.role === 'global_admin';
  const selected = isGlobal ? App.adminSelectedSchool : (App.adminSelectedSchool || App.school || null);
  return `
  <div class="page-head"><h1 class="page-title">School Admin</h1><p class="page-sub">Manage school settings without touching the Scribe code.</p></div>
  ${isGlobal ? `
    <section class="card card-pad" style="margin-bottom:18px">
      <div class="card-head" style="padding:0 0 12px"><div class="card-title">Schools</div><button class="btn btn-primary btn-sm" data-action="admin-new-school">＋ Add school</button></div>
      <div class="admin-school-list">${App.adminSchools.length ? App.adminSchools.map(s => `<button class="admin-school-item ${selected?.id===s.id?'on':''}" data-action="admin-select-school" data-id="${escapeHtml(s.id)}"><span class="school-choice-ico">🏫</span><span style="text-align:left"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml((s.domains||[]).join(', ') || 'No domain restriction')}</small></span><span>→</span></button>`).join('') : '<div class="empty"><div class="empty-title">No schools configured</div><div class="empty-sub">Add your first school below.</div></div>'}</div>
    </section>` : ''}
  ${adminFormHtml(selected, isGlobal)}
  <section class="card" style="margin-top:18px"><div class="card-body"><div class="small muted"><strong>How student sign-in works:</strong> students simply click Continue with Google. Scribe verifies the Google account, matches the school's domain, and creates the Scribe account automatically.</div></div></section>`;
}
async function loadAdminSchools(){
  if(!isAdminUser()) return;
  try{
    const data = await apiFetch('/admin/schools');
    App.adminSchools = data.schools || [];
    App.adminLoaded = true;
    if (App.user?.role === 'global_admin' && !App.adminSelectedSchool) App.adminSelectedSchool = App.adminSchools[0] || null;
    if (App.user?.role === 'school_admin') App.adminSelectedSchool = App.adminSchools.find(s => s.id === App.school?.id) || null;
    if (App.route === '#/admin') render();
  }catch(e){ toast(e.message || 'Could not load schools','error'); }
}
async function saveAdminSchool(id){
  const payload=adminSchoolPayloadFromForm();
  try{
    const data = id ? await apiFetch(`/admin/schools/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(payload)})
                     : await apiFetch('/admin/schools',{method:'POST',body:JSON.stringify(payload)});
    const saved=data.school;
    if(App.user?.role === 'global_admin') App.adminSelectedSchool=saved;
    if(App.user?.school?.id === saved.id){
      App.school=saved; SCHOOL_CONFIG=saved;
      App.user.school={id:saved.id,slug:saved.slug,name:saved.name,logoUrl:saved.logoUrl||''};
      if (App.user.role === 'school_admin' || App.user.role === 'student') {
        const email = String(App.user.email || '').toLowerCase();
        App.user.role = Array.isArray(saved.adminEmails) && saved.adminEmails.map(x=>String(x).toLowerCase()).includes(email) ? 'school_admin' : 'student';
      }
    }
    App.adminLoaded=false;
    toast('School saved','success');
    await loadAdminSchools();
  }catch(e){ toast(e.message || 'Could not save school','error'); }
}

function saveStudentYearLevel(year){
  const y = Number(year);
  if (!Number.isInteger(y) || y < 7 || y > 13) return Promise.resolve();
  const previousYear = Number(Store.cache.profile.yearLevel || 0);
  const previousSubjects = Array.isArray(Store.cache.profile.subjects) ? Store.cache.profile.subjects : [];
  Store.cache.profile.yearLevel = y;
  if (y <= 8){
    // Junior learning areas are fixed by the College's homeroom programme.
    Store.cache.profile.subjects = [...JUNIOR_LEARNING_AREAS];
  } else {
    const valid = new Set(subjectsForYear(y));
    const carried = previousSubjects.filter(x => valid.has(x));
    const defaults = previousYear === y ? [] : defaultSubjectsForYear(y);
    Store.cache.profile.subjects = [...new Set([...defaults, ...carried])];
  }
  // Save profile changes in demo/local mode as well as to the server-backed profile.
  Store.persistNow();
  return Store.saveUserDoc();
}

function viewSettings(){
  const s = Store.cache.settings;
  return `
  <div class="page-head"><h1 class="page-title">Settings</h1><p class="page-sub">Account, sync, privacy and appearance</p></div>
  <div class="cols cols-2">
  <section class="card" style="margin-bottom:18px;grid-column:1/-1">
      <div class="card-head"><div class="card-title">🧭 Sidebar</div><div class="row"><button class="btn btn-ghost btn-sm" data-action="sidebar-all">Show all</button><button class="btn btn-ghost btn-sm" data-action="sidebar-core">Core only</button></div></div>
      <div class="card-body">
        <p class="small muted" style="margin-bottom:14px">Choose which Scribe features appear in the sidebar. Settings always stays visible so you can change this later.</p>
        <div class="sidebar-settings-grid">
          ${SIDEBAR_FEATURES.map(f => `<label class="sidebar-setting"><input type="checkbox" data-sidebar-setting="${f.id}" ${(s.sidebarFeatures||DEFAULT_SETTINGS.sidebarFeatures).includes(f.id) ? 'checked' : ''}><span><span class="sidebar-setting-icon">${f.icon}</span><span><strong>${escapeHtml(f.label)}</strong><small>${escapeHtml(f.group)}</small></span></span></label>`).join('')}
        </div>
      </div>
    </section>


    <section class="card">
      <div class="card-head"><div class="card-title">👤 Account</div></div>
      <div class="card-body">
        <div class="row" style="gap:14px;margin-bottom:18px">
          <img id="settings-avatar" class="avatar avatar-lg" alt="" referrerpolicy="no-referrer">
          <div style="min-width:0">
            <div class="strong">${escapeHtml(App.user?.displayName || 'Student')}</div>
            <div class="small muted truncate">${escapeHtml(App.user?.email || '')}</div>
          </div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">Storage</div><div class="set-desc">${Store.mode === 'server' ? 'Stored in the Scribe local SQLite database.' : 'Local browser only (demo mode).'}</div></div>
          <div class="set-control"><span class="chip ${Store.mode === 'server' ? 'chip-green' : 'chip-amber'}">${Store.mode === 'server' ? 'Local server' : 'Browser'}</span></div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">Appearance</div><div class="set-desc">Light or dark theme.</div></div>
          <div class="set-control">
            <select class="select" data-setting="theme" style="width:130px">
              <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
            </select>
          </div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">Replay welcome tour</div><div class="set-desc">See the onboarding again.</div></div>
          <div class="set-control"><button class="btn btn-ghost btn-sm" data-action="replay-onboarding">Replay</button></div>
        </div>
      </div>
    </section>

    <section class="card profile-academic-card" style="grid-column:1/-1">
      <div class="card-head"><div><div class="card-title">🎓 Academic profile</div><p class="small muted" style="margin-top:4px">Choose your current year level and the subjects you are taking.</p></div></div>
      <div class="card-body">
        <div class="field profile-year-field"><label class="label" for="profile-year-level">Year level</label><select id="profile-year-level" class="select" data-profile="yearLevel"><option value="">Choose your year level</option>${[7,8,9,10,11,12,13].map(y=>`<option value="${y}" ${Number(Store.cache.profile?.yearLevel)===y?'selected':''}>Year ${y}</option>`).join('')}</select></div>
        ${studentYearLevel() ? (() => {
          const y = studentYearLevel();
          const junior = y <= 8;
          const selected = new Set(Store.cache.profile?.subjects || (junior ? JUNIOR_LEARNING_AREAS : defaultSubjectsForYear(y)));
          return `<div class="profile-subject-head"><strong>${junior ? `Year ${y} learning areas` : `Year ${y} subjects`}</strong><span class="chip ${junior?'chip-amber':'chip-indigo'}">${junior?'Locked until Year 9':'Editable'}</span></div>
          ${junior ? `<p class="small muted" style="margin-bottom:12px">The College describes Years 7–8 as a homeroom-based programme supported by specialist teachers. These learning areas are locked in Scribe until Year 9.</p>` : `<p class="small muted" style="margin-bottom:12px">Select the subjects you are currently studying. This list is based on the 2027 curriculum overview; actual choices and availability are confirmed by the College.</p>`}
          <div class="profile-subject-grid">${subjectsForYear(y).map(sub=>`<label class="profile-subject-option ${junior?'locked':''}"><input type="checkbox" data-profile-subject="${escapeHtml(sub)}" ${selected.has(sub)?'checked':''} ${junior?'disabled':''}><span>${escapeHtml(sub)}</span></label>`).join('')}</div>`;
        })() : `<p class="small muted">Select your year level to load the relevant subjects and pathway information.</p>`}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">📧 Email filtering</div></div>
      <div class="card-body">
        <p class="small muted" style="margin-bottom:14px">Narrow down which emails get scanned. If you leave these blank, Scribe uses a broad keyword search across all recent emails.</p>
        <div class="field" style="margin-bottom:12px">
          <label class="label">Trusted domains (comma separated)</label>
          <input class="input" data-setting="trustedDomainsCsv" value="${escapeHtml((s.trustedDomains||[]).join(', '))}" placeholder="e.g. sacredheart.school.nz, school.nz">
          <div class="hint">Only emails from these domains will be scanned.</div>
        </div>
        <div class="field" style="margin-bottom:12px">
          <label class="label">How far back to look</label>
          <select class="select" data-setting="emailLookbackDays">
            <option value="7" ${s.emailLookbackDays === 7 ? 'selected' : ''}>7 days</option>
            <option value="14" ${s.emailLookbackDays === 14 ? 'selected' : ''}>14 days</option>
            <option value="30" ${s.emailLookbackDays === 30 ? 'selected' : ''}>30 days</option>
            <option value="60" ${s.emailLookbackDays === 60 ? 'selected' : ''}>60 days</option>
            <option value="90" ${s.emailLookbackDays === 90 ? 'selected' : ''}>90 days</option>
          </select>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">🔄 Sync</div></div>
      <div class="card-body">
        ${notifRow('enableClassroom', 'Sync Google Classroom', 'Pull assignments from your active courses.')}
        ${notifRow('enableGmail', 'Sync school emails', 'Read school emails to find deadlines and tests.')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">🔔 Notifications</div></div>
      <div class="card-body">
        ${notifRow('notifyNewAssignment', 'New assignments', 'Alert when a new assignment is imported.')}
        ${notifRow('notifyDueSoon', 'Approaching deadlines', 'Alert when work is due today or tomorrow.')}
        ${notifRow('notifyNewTest', 'New tests and exams', 'Alert when a test or exam is detected.')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">🛡️ Privacy &amp; data</div></div>
      <div class="card-body">
        <div class="set-row">
          <div class="set-info"><div class="set-name">Clean up duplicates</div><div class="set-desc">Remove duplicate events with the same title on the same day.</div></div>
          <div class="set-control"><button class="btn btn-ghost btn-sm" data-action="cleanup-duplicates">Clean up now</button></div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">Export your data</div><div class="set-desc">Download everything as JSON.</div></div>
          <div class="set-control"><button class="btn btn-ghost btn-sm" data-action="export-data">Download</button></div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">Delete all data</div><div class="set-desc">Permanently removes every item you or Scribe created.</div></div>
          <div class="set-control"><button class="btn btn-danger-soft btn-sm" data-action="wipe-data">Delete</button></div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">Revoke Google access</div><div class="set-desc">Discards the access token held in this browser tab.</div></div>
          <div class="set-control"><button class="btn btn-ghost btn-sm" data-action="revoke-google">Revoke</button></div>
        </div>
      </div>
    </section>

    <section class="card" style="grid-column:1/-1">
      <div class="card-head"><div class="card-title">⌨️ Keyboard shortcuts</div></div>
      <div class="card-body">
        <div class="shortcut-grid">
          <div class="shortcut-row"><span>Smart Paste</span><kbd>P</kbd></div>
          <div class="shortcut-row"><span>Upload effort report</span><kbd>E</kbd></div>
          <div class="shortcut-row"><span>New assignment</span><kbd>N</kbd></div>
          <div class="shortcut-row"><span>Search</span><kbd>/</kbd></div>
          <div class="shortcut-row"><span>Sync</span><kbd>S</kbd></div>
          <div class="shortcut-row"><span>Dashboard</span><kbd>G</kbd> <kbd>D</kbd></div>
        </div>
      </div>
    </section>
  </div>`;
}

function notifRow(key, name, desc){
  const on = Store.cache.settings[key] !== false;
  return `
  <div class="set-row">
    <div class="set-info"><div class="set-name">${name}</div><div class="set-desc">${desc}</div></div>
    <div class="set-control"><label class="checkbox"><input type="checkbox" data-setting="${key}" ${on ? 'checked' : ''}></label></div>
  </div>`;
}

let viewBound = false;
function bindViewEvents(){
  if (viewBound) return;
  viewBound = true;
  const view = $('#view');

  view.addEventListener('click', async (e) => {
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn){ location.hash = navBtn.dataset.nav; return; }
    const filterBtn = e.target.closest('[data-filter="assignments"]');
    if (filterBtn){ App.filters.assignments = filterBtn.dataset.value; render(); return; }
    const action = e.target.closest('[data-action]');
    if (!action) return;
    const a = action.dataset.action;
    const id = action.dataset.id;

    switch(a){
      case 'complete': {
        const item = Store.get('assignments', id);
        if (item){
          item.completed = !item.completed;
          item.completedAt = item.completed ? now() : null;
          await Store.put('assignments', item);
          toast(item.completed ? 'Marked complete' : 'Marked incomplete', 'success');
          render();
        }
        break;
      }
      case 'delete-assignment': {
        const item = Store.get('assignments', id);
        if (!item) break;
        if (await confirmDialog('Delete assignment?', `"${item.title}" will be removed.`, 'Delete', true)){
          await Store.remove('assignments', id);
          toast('Deleted', 'success'); render();
        }
        break;
      }
      case 'edit-assignment': openAssignmentModal(Store.get('assignments', id)); break;
      case 'new-assignment': openAssignmentModal(null, 'Assignment'); break;
      case 'new-test': openAssignmentModal(null, 'Test'); break;
      case 'new-event': openAssignmentModal(null, 'Event'); break;
      case 'upload-effort': openEffortUploadModal(); break;
      case 'new-note': openNoteFormModal(); break;
      case 'new-result': openResultModal(); break;
      case 'edit-result': openResultModal(Store.get('results', id)); break;
      case 'delete-result': {
        if (await confirmDialog('Delete result?', 'This assessment result will be removed.', 'Delete', true)){ await Store.remove('results', id); render(); }
        break;
      }
      case 'pathway-node': focusPathwayNode(action.dataset.key); break;
      case 'pathway-clear': focusPathwayNode(null); break;
      case 'pathway-toggle-past': App.pathwayShowPast = !App.pathwayShowPast; App.pathwayFocus = null; render(); break;
      case 'pathway-jump': {
        const col = $(`[data-year-col="${Number(action.dataset.year)}"]`);
        const scroller = $('.pathway-map-scroll');
        if (col && scroller) scroller.scrollTo({ left: col.offsetLeft - scroller.firstElementChild.offsetLeft, behavior:'smooth' });
        break;
      }
      case 'toggle-target': {
        const subject = action.dataset.subject;
        const chosen = new Set(Store.cache.profile.targetSubjects || []);
        if (chosen.has(subject)) chosen.delete(subject);
        else if (chosen.size >= 2){ toast('Year 9 students choose two options. Remove one first.', 'error'); break; }
        else chosen.add(subject);
        Store.cache.profile.targetSubjects = [...chosen];
        Store.persistNow();
        await Store.saveUserDoc();
        render();
        break;
      }
      case 'filter-results': App.resultsFilter = App.resultsFilter === action.dataset.subject ? '' : (action.dataset.subject || ''); render(); break;
      case 'set-pathway-year': {
        const y = Number(action.dataset.year);
        await saveStudentYearLevel(y);
        render();
        break;
      }
      case 'open-paste': openClassroomPasteModal(); break;
      case 'delete-note': {
        if (await confirmDialog('Delete note?', 'This note will be removed.', 'Delete', true)){ await Store.remove('weeklyNotes', id); render(); }
        break;
      }
      case 'toggle-note-read': { const n=Store.get('weeklyNotes',id); if(n){ n.read=!n.read; await Store.put('weeklyNotes',n); render(); } break; }
      case 'toggle-note-important': { const n=Store.get('weeklyNotes',id); if(n){ n.important=!n.important; await Store.put('weeklyNotes',n); render(); } break; }
      case 'open-note': { const n=Store.get('weeklyNotes',id); if(n && !n.read){ n.read=true; await Store.put('weeklyNotes',n); } if(n) openNoteModal(n); break; }
      case 'mark-week-read': {
        const wk=action.dataset.week;
        for(const n of Store.all('weeklyNotes')) if((n.weekKey || isoWeekKey(n.date||n.createdAt).key)===wk && !n.read){ n.read=true; await Store.put('weeklyNotes',n); }
        render(); break;
      }

      case 'delete-effort': {
        if (await confirmDialog('Delete effort report?', 'This week\'s ratings will be removed.', 'Delete', true)){
          await Store.remove('effortReports', id); render();
        }
        break;
      }
      case 'cal-prev': App.calMonth--; if (App.calMonth < 0){ App.calMonth = 11; App.calYear--; } render(); break;
      case 'cal-next': App.calMonth++; if (App.calMonth > 11){ App.calMonth = 0; App.calYear++; } render(); break;
      case 'cal-today': App.calMonth = new Date().getMonth(); App.calYear = new Date().getFullYear(); render(); break;
      case 'save-session': {
        const day = Number(action.dataset.day);
        const startMin = Number(action.dataset.start);
        await Store.put('studySessions', {
          id: uid(), title: action.dataset.title,
          assignmentId: action.dataset.assignment,
          minutes: Number(action.dataset.minutes),
          start: day + startMin * 60000, createdAt: now()
        });
        toast('Session saved', 'success'); render();
        break;
      }
      case 'delete-session': await Store.remove('studySessions', id); render(); break;
      case 'clear-sessions': {
        if (await confirmDialog('Clear saved sessions?', 'All saved study sessions will be removed.', 'Clear', true)){
          for (const s of Store.all('studySessions')) await Store.remove('studySessions', s.id);
          render();
        }
        break;
      }
      case 'edit-timetable': openTimetableModal(); break;
      case 'edit-activities': openActivitiesModal(); break;
      case 'delete-activity': {
        const acts = Store.cache.settings.weeklyActivities;
        const idx = acts.findIndex(x => x.id === id);
        if (idx >= 0){ acts.splice(idx, 1); await Store.saveUserDoc(); render(); }
        break;
      }
      case 'dismiss-checklist': {
        Store.cache.settings.onboardingSeen = true;
        await Store.saveUserDoc(); render();
        break;
      }
      case 'paste-classroom': openClassroomPasteModal(); break;
      case 'log-effort': openEffortUploadModal(); break;
      case 'show-paste-help': openPasteHelpModal(); break;
      case 'sync-now': syncAll({ silent: false }); break;
      case 'reconnect-google': await signInGoogle(); break;
      case 'connect-google-api': {
        try {
          const settings = Store.cache.settings || DEFAULT_SETTINGS;
          if (settings.enableClassroom !== false) await GoogleServices.getToken(CLASSROOM_SCOPES,{interactive:true});
          if (settings.enableGmail !== false) await GoogleServices.getToken(GMAIL_SCOPES,{interactive:true});
          toast('Google access connected','success'); render();
        } catch(e){ toast(e.message || 'Could not connect Google','error'); }
        break;
      }
      case 'admin-new-school': App.adminSelectedSchool=null; render(); break;
      case 'admin-select-school': App.adminSelectedSchool=App.adminSchools.find(s => s.id === id) || null; render(); break;
      case 'admin-save-school': await saveAdminSchool(id || (App.adminSelectedSchool?.id || '')); break;
      case 'revoke-google': GoogleServices.clear(); toast('Google access revoked', 'success'); break;
      case 'cleanup-duplicates': {
        const removedEvents = await dedupeExistingEvents();
        const removedItems = await dedupeExistingAssignments();
        const total = removedEvents + removedItems;
        toast(total ? `Removed ${total} duplicate${total===1?'':'s'}` : 'No duplicates found', 'success');
        render();
        break;
      }
      case 'sidebar-all': Store.cache.settings.sidebarFeatures = SIDEBAR_FEATURES.map(x=>x.id); await Store.saveUserDoc(); render(); toast('All features shown','success'); break;
      case 'sidebar-core': Store.cache.settings.sidebarFeatures = ['assignments','calendar','weekly']; await Store.saveUserDoc(); render(); toast('Core features shown','success'); break;
      case 'export-data': exportData(); break;
      case 'replay-onboarding': {
        Store.cache.settings.onboardingSeen = false;
        await Store.saveUserDoc(); render(); showOnboarding();
        break;
      }
      case 'wipe-data': {
        if (await confirmDialog('Delete all data?', 'Every item will be permanently removed. This cannot be undone.', 'Delete everything', true)){
          await Store.removeAll();
          toast('Data deleted', 'success'); render();
        }
        break;
      }
      case 'add-calendar-sub': openAddCalendarModal(); break;
      case 'remove-calendar-sub': {
        const subs = Store.cache.settings.calendarSubscriptions;
        const idx = subs.findIndex(x => x.id === id);
        if (idx >= 0 && !subs[idx].builtin){
          if (await confirmDialog('Remove this calendar?', 'Its events will no longer sync.', 'Remove', true)){
            subs.splice(idx, 1); await Store.saveUserDoc(); render();
          }
        }
        break;
      }
    }
  });

  view.addEventListener('change', async (e) => {
    const f = e.target.dataset.filter;
    if (f){ App.filters[f] = e.target.value; render(); return; }
    const sidebarSetting = e.target.dataset.sidebarSetting;
    if (sidebarSetting){
      const enabled = new Set(Store.cache.settings.sidebarFeatures || []);
      if (e.target.checked) enabled.add(sidebarSetting); else enabled.delete(sidebarSetting);
      Store.cache.settings.sidebarFeatures = [...enabled];
      await Store.saveUserDoc();
      const changedFeature = SIDEBAR_FEATURES.find(x => x.id === sidebarSetting);
      if (!e.target.checked && changedFeature?.href === App.route) location.hash = '#/dashboard';
      else render();
      toast('Sidebar updated', 'success');
      return;
    }
    const profileKey = e.target.dataset.profile;
    if (profileKey === 'yearLevel'){
      const y = Number(e.target.value);
      if (!y){ delete Store.cache.profile.yearLevel; delete Store.cache.profile.subjects; Store.persistNow(); await Store.saveUserDoc(); render(); return; }
      await saveStudentYearLevel(y);
      render();
      toast(`Year ${y} profile saved`, 'success');
      return;
    }
    const profileSubject = e.target.dataset.profileSubject;
    if (profileSubject){
      if (studentYearLevel() !== null && studentYearLevel() <= 8){
        Store.cache.profile.subjects = [...JUNIOR_LEARNING_AREAS];
        Store.persistNow();
        await Store.saveUserDoc();
        render();
        return;
      }
      const selected = new Set(Store.cache.profile.subjects || []);
      if (e.target.checked) selected.add(profileSubject); else selected.delete(profileSubject);
      Store.cache.profile.subjects = [...selected];
      Store.persistNow();
      await Store.saveUserDoc();
      toast('Subjects updated', 'success');
      return;
    }
    const setting = e.target.dataset.setting;
    if (setting === 'trustedDomainsCsv'){
      const val = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      Store.cache.settings.trustedDomains = val;
      await Store.saveUserDoc();
      toast('Saved', 'success');
      return;
    }
    if (setting){
      const isBool = e.target.type === 'checkbox';
      const val = isBool ? e.target.checked : (isNaN(e.target.value) ? e.target.value : Number(e.target.value));
      Store.cache.settings[setting] = val;
      await Store.saveUserDoc();
      if (setting === 'theme') document.documentElement.dataset.theme = e.target.value;
      toast('Saved', 'success');
    }
  });
}

/* ── Effort upload modal ──────────────────────────────────── */
function openEffortUploadModal(){
  let parsed = null;
  openModal({
    title: '📤 Upload effort report',
    subtitle: 'Drop in the PDF from your Friday email — Scribe reads it for you',
    xl: true,
    body: `
      <div id="eu-step1">
        <div class="drop-zone" id="eu-drop">
          <div class="drop-zone-ico">📄</div>
          <div class="drop-zone-title">Drop your PDF here</div>
          <div class="drop-zone-sub">or click to choose a file<br>Scribe reads every subject and rating automatically</div>
          <input type="file" id="eu-file" accept="application/pdf,.pdf" hidden>
        </div>
        <div class="row" style="justify-content:center;margin-top:14px">
          <button class="btn btn-ghost btn-sm" id="eu-cancel">Cancel</button>
        </div>
      </div>
      <div id="eu-step2" hidden>
        <div id="eu-status" class="alert alert-info" style="margin-bottom:14px">
          <span class="spinner"></span><div>Reading your PDF…</div>
        </div>
        <div id="eu-preview"></div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="eu-save" disabled>Save report</button>`,
    onMount(el, close){
      const drop = $('#eu-drop', el);
      const fileInput = $('#eu-file', el);
      const status = $('#eu-status', el);
      const preview = $('#eu-preview', el);
      const saveBtn = $('#eu-save', el);

      const handleFile = async (file) => {
        if (!file) return;
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf'){ toast('Please upload a PDF file', 'error'); return; }
        $('#eu-step1', el).hidden = true;
        $('#eu-step2', el).hidden = false;
        status.className = 'alert alert-info';
        status.innerHTML = `<span class="spinner"></span><div>Reading your PDF…</div>`;
        preview.innerHTML = '';
        try {
          const text = await extractPdfText(file);
          parsed = parseEffortReportText(text);
          if (!parsed.ratings.length){
            status.className = 'alert alert-warn';
            status.innerHTML = `<span>⚠️</span><div>Couldn't find subject ratings in this PDF. It might be a different format.</div>`;
          } else {
            status.className = 'alert alert-success';
            status.innerHTML = `<span>✅</span><div>Found <strong>${parsed.ratings.length} subjects</strong>${parsed.attendance != null ? ` · attendance ${parsed.attendance}%` : ''}${parsed.studentCode ? ` · ${escapeHtml(parsed.studentCode)}` : ''}.</div>`;
          }
          renderEffortPreview();
          saveBtn.disabled = false;
        } catch (err){
          status.className = 'alert alert-error';
          status.innerHTML = `<span>⚠️</span><div>Could not read the PDF: ${escapeHtml(err.message)}</div>`;
        }
      };

      const renderEffortPreview = () => {
        if (!parsed || !parsed.ratings.length){
          preview.innerHTML = '<div class="empty" style="padding:30px 10px"><div class="empty-title">No subjects detected</div></div>';
          return;
        }
        preview.innerHTML = `
          <div class="card">
            <div class="card-body">
              <div class="row-between" style="margin-bottom:14px">
                <div>
                  <div class="small muted">Report date</div>
                  <input class="input" type="date" id="eu-date" value="${dateInputValue()}" style="max-width:160px;margin-top:4px">
                </div>
                <div class="effort-avg"><b>${(parsed.ratings.reduce((s,x)=>s+x.rating,0)/parsed.ratings.length).toFixed(1)}</b>/ 5</div>
              </div>
              <div class="effort-bars">
                ${parsed.ratings.map(r => `
                  <div class="effort-bar-row">
                    <div class="effort-bar-subject truncate">${escapeHtml(r.subject)}</div>
                    <div class="effort-bar-track"><div class="effort-bar-fill ${ratingClass(r.rating)}" style="width:${r.rating/5*100}%"></div></div>
                    <div class="effort-bar-val">${r.rating}${r.yearAvg != null ? `<span class="tiny muted" style="font-weight:500"> · ${r.yearAvg.toFixed(1)}</span>` : ''}</div>
                  </div>`).join('')}
              </div>
            </div>
          </div>`;
      };

      drop.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
      ['dragenter','dragover'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave','drop'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove('drag'); }));
      drop.addEventListener('drop', e => { handleFile(e.dataTransfer.files[0]); });
      $('#eu-cancel', el).addEventListener('click', close);

      saveBtn.addEventListener('click', async () => {
        if (!parsed || !parsed.ratings.length){ toast('No subject ratings to save', 'warn'); return; }
        const dateVal = $('#eu-date', el)?.value;
        const date = dateVal ? new Date(dateVal + 'T15:00:00').getTime() : Date.now();
        const wk = isoWeekKey(date);
        await Store.put('effortReports', {
          id: uid(), date, weekKey: wk.key,
          studentCode: parsed.studentCode, attendance: parsed.attendance,
          ratings: parsed.ratings, source: 'PDF upload', createdAt: now()
        });
        close();
        toast(`Saved · ${parsed.ratings.length} subjects`, 'success', 'Effort report added');
        render();
      });
    }
  });
}

/* ── Paste help modal ─────────────────────────────────────── */
function openPasteHelpModal(){
  openModal({
    title: '✨ How Smart Paste works',
    wide: true,
    body: `
      <p class="small" style="color:var(--text-2);line-height:1.65;margin-bottom:16px">
        Smart Paste figures out what you've pasted and sorts it into assignments automatically. Works even if Google sync is unavailable.
      </p>
      <div class="howto-grid">
        <div class="howto-step">
          <div class="howto-num">🎓</div>
          <div class="howto-step-body">
            <strong>Google Classroom To-do</strong>
            Open <a href="https://classroom.google.com/u/0/h" target="_blank" rel="noopener">classroom.google.com</a> → <em>To-do</em>.
            Click on the page, <kbd>Ctrl</kbd>+<kbd>A</kbd> then <kbd>Ctrl</kbd>+<kbd>C</kbd>, then paste here.
          </div>
        </div>
        <div class="howto-step">
          <div class="howto-num">📧</div>
          <div class="howto-step-body">
            <strong>Any school email</strong>
            Select the whole email (including the <code>From:</code> / <code>Subject:</code> headers) and paste.
            Scribe uses the subject line as the title, strips quoted replies, and pulls dates from the body.
          </div>
        </div>
        <div class="howto-step">
          <div class="howto-num">📝</div>
          <div class="howto-step-body">
            <strong>Any list or message</strong>
            A bullet list, a note from a teacher, anything. Each line becomes a task.
          </div>
        </div>
      </div>
      <div class="alert alert-info" style="margin-top:16px">
        <span>💡</span>
        <div>
          <strong>What makes it smart:</strong>
          <ul style="margin:8px 0 0 18px;line-height:1.7;font-size:12.5px">
            <li>Recognises dates in ~15 formats: <em>"21st Sept"</em>, <em>"21/09/26"</em>, <em>"next Monday"</em>, <em>"end of week"</em>, <em>"in 3 days"</em></li>
            <li>Detects course codes: <em>10ENG</em> → English, <em>Y10MAT</em> → Mathematics</li>
            <li>Unifies subjects: PE, Health, Physical Ed all become <em>PE &amp; Health</em></li>
            <li>Strips email signatures, quoted replies, and forwarded chains</li>
            <li>Skips the "No due date" section from Classroom automatically</li>
          </ul>
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Got it</button><button class="btn btn-primary" id="ph-go">Open Smart Paste</button>`,
    onMount(el, close){ $('#ph-go', el).addEventListener('click', () => { close(); openClassroomPasteModal(); }); }
  });
}

/* ── Smart Paste modal ───────────────────────────────────── */
function openClassroomPasteModal(){
  let parsedItems = [];
  openModal({
    title: '✨ Smart Paste',
    subtitle: 'Paste anything — Classroom, email, or a list. Scribe figures it out.',
    xl: true,
    body: `
      <div class="alert alert-info" style="margin-bottom:14px">
        <span>💡</span>
        <div><strong>Works with anything.</strong> Copy your Classroom To-do page, select an entire email, or paste a simple list.</div>
      </div>
      <div class="paste-grid">
        <div>
          <div class="row-between" style="margin-bottom:6px">
            <label class="label">Paste here</label>
            <span class="format-badge" id="cp-format">—</span>
          </div>
          <textarea class="textarea paste-input" id="cp-input" placeholder="Examples:

Classroom To-do:
assignment
Chapter 5 questions
10 Maths
Monday 21 Sept

Or an email:
From: teacher@school.nz
Subject: Science test next Wednesday
Hi Alex, remember the test covers chapters 4-6...

Or a list:
- Read chapters 3-4 by Friday
- Maths worksheet due Monday"></textarea>
        </div>
        <div>
          <div class="row-between" style="margin-bottom:6px">
            <label class="label">Detected items</label>
            <span class="chip chip-violet" id="cp-count">0</span>
          </div>
          <div class="paste-preview" id="cp-preview">
            <div class="paste-empty">Paste on the left, or click<br><strong>Detect</strong><br>to see what Scribe finds.</div>
          </div>
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-subtle" id="cp-detect">🔍 Detect items</button>
      <button class="btn btn-primary" id="cp-import" disabled>Add 0 items</button>`,
    onMount(el, close){
      const input = $('#cp-input', el);
      const preview = $('#cp-preview', el);
      const countChip = $('#cp-count', el);
      const formatChip = $('#cp-format', el);
      const importBtn = $('#cp-import', el);

      const setFormatChip = (fmt) => {
        formatChip.className = 'format-badge';
        if (fmt === 'classroom'){ formatChip.classList.add('classroom'); formatChip.textContent = '🎓 Classroom To-do'; }
        else if (fmt === 'email'){ formatChip.classList.add('email'); formatChip.textContent = '📧 Email'; }
        else if (fmt === 'generic'){ formatChip.classList.add('generic'); formatChip.textContent = '📝 Text'; }
        else { formatChip.textContent = '—'; }
      };

      const renderPreview = () => {
        if (!parsedItems.length){
          preview.innerHTML = `<div class="paste-empty">Nothing detected yet.<br>Paste on the left, or click <strong>Detect items</strong>.</div>`;
          countChip.textContent = '0';
          importBtn.disabled = true;
          importBtn.textContent = 'Add 0 items';
          return;
        }
        preview.innerHTML = `
          <h4>${parsedItems.length} item${parsedItems.length === 1 ? '' : 's'} found</h4>
          ${parsedItems.map((it, idx) => `
            <div class="paste-item" data-idx="${idx}">
              <div class="paste-item-head">
                <input class="paste-item-title" data-field="title" value="${escapeHtml(it.title)}">
                <button class="paste-item-remove" data-remove="${idx}" title="Remove">✕</button>
              </div>
              <div class="paste-item-meta">
                <select data-field="type">
                  ${['Assignment','Homework','Test','Exam','Project','Event','Reminder','Other'].map(t => `<option ${it.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
                <input type="date" data-field="dueDate" value="${it.dueDate ? dateInputValue(it.dueDate) : ''}">
                <input type="text" data-field="subject" placeholder="Subject" value="${escapeHtml(it.subject || '')}" style="width:120px">
              </div>
            </div>`).join('')}`;
        countChip.textContent = String(parsedItems.length);
        importBtn.disabled = false;
        importBtn.textContent = `Add ${parsedItems.length} item${parsedItems.length === 1 ? '' : 's'}`;
        $$('.paste-item', preview).forEach(node => {
          const idx = Number(node.dataset.idx);
          node.querySelectorAll('[data-field]').forEach(field => {
            field.addEventListener('input', () => {
              const k = field.dataset.field;
              if (k === 'dueDate'){
                parsedItems[idx].dueDate = field.value ? new Date(field.value + 'T23:59:00').getTime() : null;
                parsedItems[idx].priority = computePriority(parsedItems[idx]);
              } else {
                parsedItems[idx][k] = field.value;
              }
            });
          });
          node.querySelector('[data-remove]')?.addEventListener('click', () => { parsedItems.splice(idx, 1); renderPreview(); });
        });
      };

      const detect = () => {
        const text = input.value;
        if (!text || !text.trim()){
          parsedItems = [];
          setFormatChip('empty');
          renderPreview();
          return;
        }
        setFormatChip(detectPasteFormat(text));
        parsedItems = smartPaste(text);
        renderPreview();
      };

      $('#cp-detect', el).addEventListener('click', detect);
      input.addEventListener('paste', () => setTimeout(detect, 60));
      input.addEventListener('input', () => {
        if (input.value.length > 20){ clearTimeout(input._t); input._t = setTimeout(detect, 700); }
      });

      importBtn.addEventListener('click', async () => {
        if (!parsedItems.length) return;
        const r = await importItems(parsedItems, 'Paste');
        close();
        const parts = [];
        if (r.added) parts.push(`${r.added} added`);
        if (r.merged) parts.push(`${r.merged} merged`);
        toast(parts.join(', ') || 'Nothing new', 'success', 'Smart Paste complete');
        setSyncUI('ok', `Imported ${relativeTime(now())}`);
        render();
      });

      setTimeout(() => input.focus(), 80);
    }
  });
}

function openAssignmentModal(existing, presetType){
  const isEdit = !!existing;
  const a = existing || { title:'', description:'', subject:'', type: presetType || 'Assignment', dueDate:null };
  openModal({
    title: isEdit ? 'Edit item' : `New ${(presetType || 'assignment').toLowerCase()}`,
    body: `
      <div class="field"><label class="label">Title *</label>
        <input class="input" id="m-title" placeholder="e.g. Chapter 5 questions" value="${escapeHtml(a.title)}"></div>
      <div class="field"><label class="label">Details</label>
        <textarea class="textarea" id="m-desc" placeholder="Optional details…">${escapeHtml(a.description)}</textarea></div>
      <div class="row" style="gap:12px;align-items:flex-start">
        <div class="field" style="flex:1"><label class="label">Type</label>
          <select class="select" id="m-type">
            ${['Assignment','Homework','Test','Exam','Project','Event','Reminder','Other'].map(t => `<option ${a.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
        <div class="field" style="flex:1"><label class="label">Subject</label>
          <input class="input" id="m-subject" placeholder="Maths" value="${escapeHtml(a.subject)}"></div>
      </div>
      <div class="field"><label class="label">Due date</label>
        <input class="input" type="date" id="m-due" value="${a.dueDate ? dateInputValue(a.dueDate) : ''}"></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="m-save">${isEdit ? 'Save' : 'Add'}</button>`,
    onMount(el, close){
      $('#m-save', el).addEventListener('click', async () => {
        const title = $('#m-title', el).value.trim();
        if (!title){ toast('Please enter a title', 'error'); return; }
        const dueVal = $('#m-due', el).value;
        const record = {
          id: a.id || uid(),
          title: sanitiseText(title, 220),
          description: sanitiseText($('#m-desc', el).value, 4000),
          type: $('#m-type', el).value,
          subject: sanitiseText($('#m-subject', el).value, 60),
          dueDate: dueVal ? new Date(dueVal + 'T23:59:00').getTime() : null,
          manual: true, completed: a.completed || false, source: 'Manual',
          sources: a.sources?.length ? a.sources : [{ source:'Manual', url:'', addedAt: now() }],
          createdAt: a.createdAt || now()
        };
        record.priority = computePriority(record);
        await Store.put('assignments', record);
        close();
        toast(isEdit ? 'Updated' : 'Added', 'success'); render();
      });
      setTimeout(() => $('#m-title', el)?.focus(), 60);
    }
  });
}

function viewWeekly(){
  const notes = Store.all('weeklyNotes');
  const efforts = Store.all('effortReports').sort((a,b) => b.date - a.date);
  const latestEffort = efforts[0];

  const notesHtml = !notes.length ? `
    <div class="card"><div class="empty">
      <div class="empty-ico">🗒️</div>
      <div class="empty-title">No weekly notes yet</div>
      <div class="empty-sub">Paste an email or wait for the next sync — school notices will be grouped here automatically.</div>
      <div class="empty-actions">
        <button class="btn btn-sm btn-primary" data-action="new-note">＋ Write a note</button>
        <button class="btn btn-sm btn-ghost" data-action="open-paste">⚡ Paste an email</button>
      </div>
    </div></div>` : (() => {
    const grouped = {};
    for (const n of notes){
      const wk = n.weekKey || isoWeekKey(n.date || n.createdAt).key;
      (grouped[wk] = grouped[wk] || []).push(n);
    }
    const weeks = Object.keys(grouped).sort().reverse();
    return weeks.map(wk => {
      const list = grouped[wk].sort((a,b) => (b.date||0) - (a.date||0));
      const meta = isoWeekKey(list[0].date || list[0].createdAt);
      const unread = list.filter(n => !n.read).length;
      const notices = list.filter(n => ['Notice','School Notice','Announcement'].includes(n.kind));
      const events = list.filter(n => n.kind === 'Event');
      const other = list.filter(n => !notices.includes(n) && !events.includes(n));
      const renderGroup = (title, arr, icon) => !arr.length ? '' : `
        <div style="margin-bottom:16px">
          <div class="row" style="gap:7px;margin-bottom:8px">
            <span>${icon}</span>
            <span class="strong small" style="text-transform:uppercase;letter-spacing:.05em;font-size:11.5px;color:var(--text-3)">${title}</span>
          </div>
          ${arr.map(n => renderNoteItem(n)).join('')}
        </div>`;
      return `
      <section class="card" style="margin-bottom:18px">
        <div class="card-head">
          <div><div class="card-title">Week ${meta.week} · ${meta.year}</div><div class="tiny muted" style="margin-top:2px">${list.length} item${list.length===1?'':'s'}${unread ? ` · ${unread} unread` : ''}</div></div>
          <button class="btn btn-sm btn-ghost" data-action="mark-week-read" data-week="${wk}">Mark all read</button>
        </div>
        <div class="card-body">
          ${renderGroup('School Notices', notices, '📢')}
          ${renderGroup('Events & Important Dates', events, '🎪')}
          ${renderGroup('General Information', other, '📄')}
        </div>
      </section>`;
    }).join('');
  })();

  return `
  <div class="page-head row-between wrap">
    <div><h1 class="page-title">Weekly Notes</h1><p class="page-sub">School notices and your Friday effort reports</p></div>
    <button class="btn btn-primary" data-action="new-note">＋ New note</button>
  </div>

  ${latestEffort ? `
  <div class="effort-banner">
    <div class="effort-header">
      <div class="effort-title">📊 This week's effort report</div>
      <div class="row">
        <div class="effort-avg"><b>${(latestEffort.ratings.reduce((s,r)=>s+r.rating,0)/latestEffort.ratings.length).toFixed(1)}</b>/ 5</div>
        <a class="btn btn-sm btn-ghost" href="#/effort">View all reports</a>
        <button class="btn btn-sm btn-primary" data-action="log-effort">Log new week</button>
      </div>
    </div>
    <div class="effort-bars">
      ${latestEffort.ratings.map(r => `
        <div class="effort-bar-row">
          <div class="effort-bar-subject truncate">${escapeHtml(r.subject)}</div>
          <div class="effort-bar-track">
            <div class="effort-bar-fill ${ratingClass(r.rating)}" style="width:${r.rating/5*100}%"></div>
          </div>
          <div class="effort-bar-val">${r.rating}</div>
        </div>`).join('')}
    </div>
    <div class="tiny muted" style="margin-top:12px">Logged ${relativeTime(latestEffort.date)}</div>
  </div>` : `
  <div class="effort-banner">
    <div class="effort-header">
      <div class="effort-title">📊 Effort Reports</div>
      <button class="btn btn-sm btn-primary" data-action="log-effort">Log this week's report</button>
    </div>
    <p class="small" style="color:var(--text-2);line-height:1.6">
      Log your weekly effort ratings from the Friday email. Scribe will track your progress subject by subject, week by week.
    </p>
  </div>`}

  ${notesHtml}`;
}

function renderNoteItem(n){
  const icons = { Notice:'📢', Announcement:'📣', Event:'🎪', 'School Notice':'📌' };
  return `
  <div class="item" style="padding-left:0;padding-right:0">
    <div class="item-check" style="border:none;background:transparent;cursor:default;font-size:17px">${icons[n.kind] || '📄'}</div>
    <div class="item-main">
      <div class="item-title" style="font-size:13.9px">
        <button type="button" class="note-open" data-action="open-note" data-id="${n.id}">${escapeHtml(n.title)}</button>
        ${!n.read ? '<span class="chip chip-indigo">New</span>' : ''}
        ${n.important ? '<span class="chip chip-amber">★</span>' : ''}
      </div>
      ${n.body ? `<div class="item-desc">${escapeHtml(n.body)}</div>` : ''}
      <div class="item-meta">
        <span class="chip chip-gray">${escapeHtml(n.kind)}</span>
        <span class="chip chip-gray">${escapeHtml(n.source)}</span>
        <span class="tiny muted">${fmtDateLong(n.date)}</span>
      </div>
    </div>
    <div class="item-side">
      <button class="icon-btn" style="width:30px;height:30px;font-size:13px" data-action="toggle-note-read" data-id="${n.id}">${n.read ? '📬' : '📭'}</button>
      <button class="icon-btn" style="width:30px;height:30px;font-size:13px" data-action="toggle-note-important" data-id="${n.id}">${n.important ? '⭐' : '☆'}</button>
      <button class="icon-btn" style="width:30px;height:30px;font-size:13px" data-action="delete-note" data-id="${n.id}">🗑️</button>
    </div>
  </div>`;
}

function openNoteFormModal(){
  openModal({
    title: 'New note',
    body: `
      <div class="field"><label class="label">Title *</label><input class="input" id="n-title" placeholder="e.g. Mufti Day Friday"></div>
      <div class="field"><label class="label">Details</label><textarea class="textarea" id="n-body" placeholder="Add details…"></textarea></div>
      <div class="row" style="gap:12px;align-items:flex-start">
        <div class="field" style="flex:1"><label class="label">Kind</label>
          <select class="select" id="n-kind">
            <option>Notice</option><option>Announcement</option>
            <option>School Notice</option><option>Event</option>
          </select></div>
        <div class="field" style="flex:1"><label class="label">Date</label>
          <input class="input" type="date" id="n-date" value="${dateInputValue()}"></div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="n-save">Add note</button>`,
    onMount(el, close){
      $('#n-save', el).addEventListener('click', async () => {
        const title = $('#n-title', el).value.trim();
        if (!title){ toast('Please enter a title', 'error'); return; }
        const dateVal = $('#n-date', el).value;
        const date = dateVal ? new Date(dateVal + 'T12:00:00').getTime() : now();
        const wk = isoWeekKey(date);
        await Store.put('weeklyNotes', {
          id: uid(), title: sanitiseText(title, 220),
          body: sanitiseText($('#n-body', el).value, 4000),
          date, weekKey: wk.key, weekNumber: wk.week, weekYear: wk.year,
          kind: $('#n-kind', el).value, source: 'Manual',
          url: '', read: false, important: false, saved: false, createdAt: now()
        });
        close();
        toast('Note added', 'success');
        render();
      });
    }
  });
}

function openNoteModal(n){
  openModal({
    title: n.title,
    subtitle: `${n.kind} · ${n.source} · ${fmtDateLong(n.date)}`,
    body: `${n.body ? `<p style="font-size:14px;line-height:1.75;white-space:pre-wrap;color:var(--text-2)">${escapeHtml(n.body)}</p>` : '<p class="muted">No further detail.</p>'}`,
    footer: `<button class="btn btn-primary" data-close>Close</button>`
  });
}

function openTimetableModal(){
  const tt = Store.cache.settings.timetable || [];
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  openModal({
    title: '🗓️ Weekly timetable',
    xl: true,
    body: `
      <div class="alert alert-info" style="margin-bottom:14px">
        <span>💡</span>
        <div><strong>Fastest way:</strong> paste lines like <code>Monday 9:00-10:00 Maths M12</code> and click <em>Auto-fill</em>.</div>
      </div>
      <div class="field" style="margin-bottom:14px">
        <label class="label">Paste your timetable</label>
        <textarea class="textarea" id="tt-paste" placeholder="Monday 9:00-10:00 Maths M12
Monday 10:05-11:05 English E7" style="min-height:120px;font-family:ui-monospace,monospace;font-size:12px"></textarea>
      </div>
      <button class="btn btn-subtle btn-sm" id="tt-autofill">✨ Auto-fill</button>
      <div style="height:1px;background:var(--border);margin:18px 0"></div>
      <div id="tt-rows">
        ${tt.length ? tt.map((t, i) => ttRowHtml(t, i, days)).join('') : ttRowHtml({ day:1, start:'09:00', end:'10:00', subject:'', room:'' }, 0, days)}
      </div>
      <button class="btn btn-ghost btn-sm" id="tt-add" style="margin-top:12px">＋ Add period</button>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="tt-save">Save</button>`,
    onMount(el, close){
      let counter = $$('.tt-row-input', el).length;
      const addRow = (data) => {
        const wrap = document.createElement('div');
        wrap.innerHTML = ttRowHtml(data, counter++, days);
        $('#tt-rows', el).appendChild(wrap.firstElementChild);
      };
      $('#tt-add', el).addEventListener('click', () => addRow({ day:1, start:'', end:'', subject:'', room:'' }));
      $('#tt-autofill', el).addEventListener('click', () => {
        const parsed = parseTimetableText($('#tt-paste', el).value);
        if (!parsed.length){ toast('Couldn\'t find any timetable lines', 'warn'); return; }
        $('#tt-rows', el).innerHTML = '';
        counter = 0;
        parsed.forEach(p => addRow(p));
        toast(`Added ${parsed.length} period${parsed.length === 1 ? '' : 's'}`, 'success');
      });
      $('#tt-save', el).addEventListener('click', async () => {
        const rows = $$('.tt-row-input', el).map(r => ({
          day: Number($('.tt-day', r).value),
          start: $('.tt-start', r).value,
          end: $('.tt-end', r).value,
          subject: sanitiseText($('.tt-subject', r).value, 60),
          room: sanitiseText($('.tt-room', r).value, 20)
        })).filter(r => r.subject);
        Store.cache.settings.timetable = rows;
        await Store.saveUserDoc();
        close();
        toast(`Saved ${rows.length} period${rows.length===1?'':'s'}`, 'success'); render();
      });
      el.addEventListener('click', e => { if (e.target.closest('.tt-del')) e.target.closest('.tt-row-input').remove(); });
    }
  });
}
function ttRowHtml(t, idx, days){
  return `<div class="tt-row-input row" style="gap:8px;margin-bottom:8px;align-items:center">
    <select class="select tt-day" style="width:120px">
      ${days.map((d, i) => `<option value="${i}" ${Number(t.day) === i ? 'selected' : ''}>${d}</option>`).join('')}
    </select>
    <input class="input tt-start" type="time" value="${t.start || ''}" style="width:106px">
    <input class="input tt-end" type="time" value="${t.end || ''}" style="width:106px">
    <input class="input tt-subject grow" placeholder="Subject" value="${escapeHtml(t.subject || '')}">
    <input class="input tt-room" placeholder="Room" value="${escapeHtml(t.room || '')}" style="width:88px">
    <button class="icon-btn tt-del" style="color:var(--red-600)">✕</button>
  </div>`;
}

function openActivitiesModal(){
  openModal({
    title: '🏃 Weekly activities',
    xl: true,
    body: `
      <div class="alert alert-info" style="margin-bottom:14px">
        <span>💡</span>
        <div><strong>Fastest way:</strong> paste lines like <code>Monday: Tutoring 4-4:30</code> and click <em>Auto-fill</em>.</div>
      </div>
      <div class="field" style="margin-bottom:14px">
        <label class="label">Paste your weekly activities</label>
        <textarea class="textarea" id="act-paste" placeholder="Monday: Tutoring 4-4:30
Tuesday: Tutoring 4-5" style="min-height:120px;font-family:ui-monospace,monospace;font-size:12px"></textarea>
      </div>
      <button class="btn btn-subtle btn-sm" id="act-autofill">✨ Auto-fill</button>
      <div style="height:1px;background:var(--border);margin:18px 0"></div>
      <div id="act-rows"></div>
      <button class="btn btn-ghost btn-sm" id="act-add" style="margin-top:12px">＋ Add activity</button>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="act-save">Save</button>`,
    onMount(el, close){
      const rows = $('#act-rows', el);
      const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const existing = Store.cache.settings.weeklyActivities || [];
      const renderRow = (data) => {
        const div = document.createElement('div');
        div.className = 'row';
        div.style.cssText = 'gap:8px;margin-bottom:8px;align-items:center';
        div.dataset.act = data.id || uid();
        div.innerHTML = `
          <select class="select act-day" style="width:130px">
            ${days.map((d, i) => `<option value="${i}" ${Number(data.day) === i ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
          <input class="input act-start" type="time" value="${data.start || ''}" style="width:110px">
          <input class="input act-end" type="time" value="${data.end || ''}" style="width:110px">
          <input class="input act-name grow" placeholder="Tutoring, Padel…" value="${escapeHtml(data.name || '')}">
          <button class="icon-btn act-del" style="color:var(--red-600)">✕</button>`;
        rows.appendChild(div);
      };
      if (existing.length) existing.forEach(renderRow);
      else renderRow({ day: 1, start:'16:00', end:'17:00', name:'' });
      $('#act-add', el).addEventListener('click', () => renderRow({ day:1, start:'16:00', end:'17:00', name:'' }));
      $('#act-autofill', el).addEventListener('click', () => {
        const parsed = parseActivitiesText($('#act-paste', el).value);
        if (!parsed.length){ toast('Couldn\'t find any activity lines', 'warn'); return; }
        rows.innerHTML = '';
        parsed.forEach(renderRow);
        toast(`Added ${parsed.length} activit${parsed.length === 1 ? 'y' : 'ies'}`, 'success');
      });
      $('#act-save', el).addEventListener('click', async () => {
        const list = $$('.row[data-act]', el).map(r => ({
          id: r.dataset.act,
          day: Number($('.act-day', r).value),
          start: $('.act-start', r).value,
          end: $('.act-end', r).value,
          name: sanitiseText($('.act-name', r).value, 80)
        })).filter(r => r.name && r.start && r.end);
        Store.cache.settings.weeklyActivities = list;
        await Store.saveUserDoc();
        close();
        toast(`Saved ${list.length} activit${list.length === 1 ? 'y' : 'ies'}`, 'success'); render();
      });
      el.addEventListener('click', e => { if (e.target.closest('.act-del')) e.target.closest('.row[data-act]').remove(); });
    }
  });
}

function openAddCalendarModal(){
  openModal({
    title: 'Add a calendar',
    body: `
      <div class="field"><label class="label">Calendar name</label>
        <input class="input" id="cal-name" placeholder="e.g. Sports Fixtures"></div>
      <div class="field"><label class="label">ICS URL</label>
        <input class="input" id="cal-url" placeholder="https://…/basic.ics" style="font-family:ui-monospace,monospace;font-size:12px">
        <div class="hint">Must be an .ics feed.</div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="cal-add">Add calendar</button>`,
    onMount(el, close){
      $('#cal-add', el).addEventListener('click', async () => {
        const name = $('#cal-name', el).value.trim() || 'Calendar';
        const url = $('#cal-url', el).value.trim();
        if (!url || !/^https?:\/\//.test(url)){ toast('Please paste a valid URL', 'error'); return; }
        Store.cache.settings.calendarSubscriptions.push({ id: uid(), name, url, builtin: false, lastSync: null, count: 0, error: null });
        await Store.saveUserDoc();
        close();
        toast('Calendar added — syncing…', 'success'); render();
        syncCalendarSubscriptions().then(() => render());
      });
    }
  });
}

/* ── Onboarding ──────────────────────────────────────────── */
let onbStep = 1;
let onbData = { name: '', path: '' };

function showOnboarding(){
  const overlay = document.createElement('div');
  overlay.className = 'onboarding';
  overlay.id = 'onboarding';
  overlay.innerHTML = `<div class="onboarding-card" id="onb-card"></div>`;
  document.body.appendChild(overlay);
  onbStep = 1;
  renderOnb();
}
function closeOnboarding(){
  const el = $('#onboarding');
  if (el) el.remove();
  Store.cache.settings.onboardingSeen = true;
  Store.saveUserDoc();
}
function renderOnb(){
  const card = $('#onb-card');
  if (!card) return;
  const dots = [1,2,3].map(n => `<div class="onb-dot ${n === onbStep ? 'on' : n < onbStep ? 'done' : ''}"></div>`).join('');
  let body = '';
  if (onbStep === 1){
    body = `<div class="onb-content">
      <h2>Welcome to Scribe 👋</h2>
      <p class="lead">Let's get you set up in 30 seconds. You can change anything later.</p>
      <div class="field"><label class="label">Your name</label>
        <input class="input" id="onb-name" placeholder="Alex" value="${escapeHtml(App.user?.displayName?.split(' ')[0] || '')}">
      </div>
      ${App.school?.name ? `<div class="school-context">🏫 ${escapeHtml(App.school.name)}</div>` : ''}
    </div>
    <div class="onb-actions">
      <button class="btn btn-ghost" data-onb="skip">Skip</button>
      <button class="btn btn-primary" data-onb="next">Continue →</button>
    </div>`;
  } else if (onbStep === 2){
    body = `<div class="onb-content">
      <h2>How would you like to start?</h2>
      <p class="lead">Both work on any school account.</p>
      <div class="onb-cards">
        <button class="onb-card ${onbData.path === 'google' ? 'on' : ''}" data-onb-card="google">
          <div class="onb-card-ico">🔗</div>
          <div class="onb-card-body"><h4>Sync with Google</h4><p>Classroom assignments and school emails pulled in automatically.</p></div>
        </button>
        <button class="onb-card ${onbData.path === 'paste' ? 'on' : ''}" data-onb-card="paste">
          <div class="onb-card-ico">✨</div>
          <div class="onb-card-body"><h4>Smart Paste</h4><p>Copy your Classroom To-do, an email, or a list. Scribe sorts it out.</p></div>
        </button>
      </div>
    </div>
    <div class="onb-actions">
      <button class="btn btn-ghost" data-onb="back">← Back</button>
      <button class="btn btn-primary" data-onb="next" ${!onbData.path ? 'disabled' : ''}>Continue →</button>
    </div>`;
  } else {
    body = `<div class="onb-content">
      <h2>You're all set 🎉</h2>
      <p class="lead">Three things to know:</p>
      <div class="onb-feature-list">
        <div class="onb-feature"><div class="onb-feature-ico">🔄</div>
          <div><strong>Sync</strong>Press <kbd>S</kbd> or use the Sync button to pull the latest.</div></div>
        <div class="onb-feature"><div class="onb-feature-ico">✨</div>
          <div><strong>Smart Paste</strong>Press <kbd>P</kbd> anywhere. Handles Classroom, emails, and any list.</div></div>
        <div class="onb-feature"><div class="onb-feature-ico">📊</div>
          <div><strong>Upload effort reports</strong>Press <kbd>E</kbd> to drop in this week's PDF.</div></div>
      </div>
    </div>
    <div class="onb-actions">
      <button class="btn btn-ghost" data-onb="back">← Back</button>
      <button class="btn btn-primary" data-onb="finish">Open Scribe →</button>
    </div>`;
  }
  card.innerHTML = `<button class="onboarding-skip" data-onb="skip">Skip tour</button><div class="onb-progress">${dots}</div>${body}`;
  card.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-onb]');
    const cardBtn = e.target.closest('[data-onb-card]');
    if (cardBtn){ onbData.path = cardBtn.dataset.onbCard; renderOnb(); return; }
    if (btn){
      const action = btn.dataset.onb;
      if (action === 'skip'){ closeOnboarding(); return; }
      if (action === 'back'){ onbStep--; renderOnb(); return; }
      if (action === 'next' && onbStep === 1){
        onbData.name = $('#onb-name').value.trim();
        if (onbData.name && !App.user?.displayName) App.user.displayName = onbData.name;
        onbStep = 2; renderOnb(); return;
      }
      if (action === 'next' && onbStep === 2){ onbStep = 3; renderOnb(); return; }
      if (action === 'finish'){
        closeOnboarding();
        if (onbData.path === 'google'){ location.hash = '#/integrations'; setTimeout(() => syncAll({ silent: false }), 400); }
        else if (onbData.path === 'paste'){ location.hash = '#/dashboard'; setTimeout(() => openClassroomPasteModal(), 400); }
        else location.hash = '#/dashboard';
      }
    }
  });
}

/* ── Notifications ───────────────────────────────────────── */
function renderNotifDot(){
  const unread = Store.all('notifications').filter(n => !n.read).length;
  const dot = $('#notif-dot');
  if (dot) dot.hidden = unread === 0;
}
function renderNotifPanel(){
  const panel = $('#notif-panel');
  if (!panel) return;
  const list = [...Store.all('notifications')].sort((a,b) => b.createdAt - a.createdAt).slice(0, 30);
  const icons = { assignment:'📝', due:'⏰', test:'📊' };
  panel.innerHTML = `
    <div class="notif-head">
      <div class="strong" style="font-size:14px">Notifications</div>
      ${list.some(n => !n.read) ? `<button class="btn btn-sm btn-ghost" id="notif-clear">Mark all read</button>` : ''}
    </div>
    <div class="notif-list">
      ${list.length ? list.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-notif="${n.id}" data-link="${escapeHtml(n.link || '')}">
          <div class="notif-ico">${icons[n.kind] || '🔔'}</div>
          <div class="notif-body">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            ${n.body ? `<div class="tiny muted truncate">${escapeHtml(n.body)}</div>` : ''}
            <div class="notif-meta">${relativeTime(n.createdAt)}</div>
          </div>
        </div>`).join('') : `<div class="notif-empty">Nothing yet — new items will appear here.</div>`}
    </div>`;
  const clearBtn = $('#notif-clear', panel);
  if (clearBtn){
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      for (const n of Store.all('notifications')){ if (!n.read){ n.read = true; await Store.put('notifications', n); } }
      renderNotifPanel(); renderNotifDot();
    });
  }
  $$('.notif-item', panel).forEach(item => {
    item.addEventListener('click', async () => {
      const n = Store.get('notifications', item.dataset.notif);
      if (n && !n.read){ n.read = true; await Store.put('notifications', n); }
      panel.hidden = true;
      $('#notif-btn')?.setAttribute('aria-expanded', 'false');
      if (item.dataset.link) location.hash = item.dataset.link;
      renderNotifDot();
    });
  });
}

/* ── Search ──────────────────────────────────────────────── */
/** Every word typed must appear somewhere in the text (any order). */
function searchMatches(text, tokens){
  const hay = String(text || '').toLocaleLowerCase();
  return tokens.every(t => hay.includes(t));
}
/** A short excerpt around the first match, with the matching words marked. */
function searchSnippet(text, tokens, len = 96){
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const lower = clean.toLocaleLowerCase();
  const first = tokens.map(t => lower.indexOf(t)).filter(i => i >= 0).sort((a,b) => a - b)[0];
  let start = first === undefined ? 0 : Math.max(0, first - 28);
  let piece = clean.slice(start, start + len);
  if (start > 0) piece = '…' + piece;
  if (start + len < clean.length) piece += '…';
  let html = escapeHtml(piece);
  for (const t of [...tokens].sort((a,b) => b.length - a.length)){
    html = html.replace(new RegExp(`(${escapeRegExp(escapeHtml(t))})(?![^<]*>)`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

function runSearch(q){
  const box = $('#search-results');
  if (!box) return;
  q = q.trim().toLocaleLowerCase();
  if (q.length < 2){ box.hidden = true; return; }
  const tokens = q.split(/\s+/).filter(Boolean);
  const groups = [];
  const add = (label, hits) => { if (hits.length) groups.push({ label, hits }); };

  add('Assignments and tests', Store.all('assignments')
    .filter(a => searchMatches(`${a.title} ${a.description || ''} ${a.subject || ''}`, tokens))
    .map(a => ({ icon:'📝', title:a.title, sub:escapeHtml(`${a.subject || a.type} · ${dueLabel(a.dueDate).text}`), link:'#/assignments' })));

  // Notes: every saved note, including ones the student wrote, matched on title and on content.
  add('Notes', Store.all('weeklyNotes')
    .map(n => {
      const title = n.title || 'Untitled note';
      const content = [n.body, n.content, n.text, n.description].filter(Boolean).map(x => sanitiseText(x, 12000)).join(' ');
      return { n, title, content };
    })
    .filter(x => searchMatches(`${x.title} ${x.n.subject || ''} ${x.n.kind || ''} ${x.content}`, tokens))
    .sort((a,b) => (b.n.source === 'Manual') - (a.n.source === 'Manual') || (b.n.date || 0) - (a.n.date || 0))
    .map(({ n, title, content }) => {
      const inContent = tokens.some(t => content.toLocaleLowerCase().includes(t));
      const meta = escapeHtml(`${n.source === 'Manual' ? 'Your note' : (n.kind || 'Note')} · ${fmtDate(n.date || n.createdAt)}`);
      return { icon:'🗒️', title, sub: inContent ? `${searchSnippet(content, tokens)} <span class="search-meta">· ${meta}</span>` : meta, link:'#/weekly', noteId:n.id };
    }));

  add('Calendar', Store.all('events')
    .filter(e => searchMatches(`${e.title} ${e.description || ''}`, tokens))
    .map(e => ({ icon:'🎪', title:e.title, sub:escapeHtml(`${e.source || 'Event'} · ${fmtDate(e.start)}`), link:'#/calendar' })));

  add('Results', Store.all('results')
    .filter(r => searchMatches(`${r.title} ${r.subject || ''} ${r.grade || ''} ${r.feedback || ''}`, tokens))
    .map(r => ({ icon:'📈', title:r.title || 'Assessment', sub:escapeHtml(`${r.subject || 'Result'} · ${r.grade || ''}`), link:'#/results' })));

  const PER_GROUP = 5;
  box.innerHTML = groups.length
    ? groups.map(g => `<div class="search-group">${escapeHtml(g.label)}${g.hits.length > PER_GROUP ? ` <span>· showing ${PER_GROUP} of ${g.hits.length}</span>` : ''}</div>` + g.hits.slice(0, PER_GROUP).map(h => `<div class="search-item" role="option" tabindex="-1" data-link="${h.link}" ${h.noteId ? `data-note-id="${escapeHtml(h.noteId)}"` : ''}>
        <span style="font-size:16px">${h.icon}</span>
        <div style="min-width:0"><div class="t truncate">${escapeHtml(h.title)}</div><div class="tiny muted truncate">${h.sub}</div></div>
      </div>`).join('')).join('')
    : `<div class="search-empty">No matches for "${escapeHtml(q)}"</div>`;
  box.hidden = false;
  $$('.search-item', box).forEach(item => {
    item.addEventListener('click', () => {
      const noteId = item.dataset.noteId;
      const link = item.dataset.link;
      box.hidden = true; $('#global-search').value = '';
      $('#global-search').blur();
      const openNote = () => { const note = noteId && Store.get('weeklyNotes', noteId); if (note) openNoteModal(note); };
      if (location.hash === link){ openNote(); return; }
      location.hash = link;
      if (noteId) setTimeout(openNote, 80);
    });
  });
}

/* ── Auth ────────────────────────────────────────────────── */
let authMode = 'signin';
function setAuthMode(mode='signin'){
  authMode = mode;
  $('#auth-heading').textContent = 'Welcome to Scribe';
  $('#auth-subheading').textContent = App.school?.name
    ? `Use your Google account to continue to ${App.school.name}.`
    : 'Use your Google account to get started. Your account is created automatically.';
  if ($('#name-field')) $('#name-field').hidden = true;
  if ($('#email-submit-label')) $('#email-submit-label').textContent = 'Sign in';
  if ($('#auth-error')) $('#auth-error').hidden = true;
}
function showAuthError(m){ const b = $('#auth-error'); b.textContent = m; b.hidden = false; }

async function submitEmailAuth(){
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const name = $('#auth-name')?.value.trim() || '';
  $('#auth-error').hidden = true;
  if (!email || !email.includes('@')){ showAuthError('Please enter a valid email.'); return; }
  if (!password || password.length < 6){ showAuthError('Passwords must be at least 6 characters.'); return; }
  // Google sign-in is the normal account creation path. Email/password is only a fallback for existing local accounts.
  const btn=$('#email-submit-btn'), spinner=$('#email-spinner'), label=$('#email-submit-label');
  const orig=label.textContent; btn.disabled=true; spinner.hidden=false; label.textContent=authMode==='signup'?'Creating…':'Signing in…';
  try{
    const result = await apiFetch('/auth/signin', {
      method:'POST', body:JSON.stringify({ email, password, schoolSlug: App.school?.slug || schoolHintFromUrl() })
    });
    await onUserSignedIn({ ...result.user, real:true });
  }catch(err){ showAuthError(err.message || 'Sign-in failed.'); }
  finally{ btn.disabled=false; spinner.hidden=true; label.textContent=orig; }
}
function friendlyAuthError(err){
  const code = err.code || '';
  switch(code){
    case 'auth/email-already-in-use': return 'That email is already registered. Sign in instead.';
    case 'auth/invalid-email': return 'That email address looks wrong.';
    case 'auth/weak-password': return 'Password too weak. Use at least 6 characters.';
    case 'auth/user-not-found': return 'No account found. Create one instead?';
    case 'auth/wrong-password': case 'auth/invalid-credential': return 'Incorrect email or password.';
    case 'auth/too-many-requests': return 'Too many attempts. Wait a minute.';
    case 'auth/operation-not-allowed': return 'Email sign-in is not enabled on this project.';
    default: return err.message || 'Sign-in failed.';
  }
}
async function resetPassword(){
  const email = $('#auth-email').value.trim();
  if (!email || !email.includes('@')){ showAuthError('Enter your email first.'); return; }
  showAuthError('Password reset is not configured yet. Google sign-in is the recommended account method.');
}
function showAuth(){
  $('#boot').classList.add('gone'); $('#auth-screen').hidden=false; $('#app').hidden=true; $('#fab').hidden=true;
  $('#mode-badge').textContent='🔐 Secure sign-in'; $('#mode-badge').classList.add('live');
  setAuthMode('signin');
  $('#email-form')?.reset(); if ($('#auth-error')) $('#auth-error').hidden=true;
  const emailForm = $('#email-form');
  if (emailForm) emailForm.onsubmit = (e)=>{ e.preventDefault(); submitEmailAuth(); };
  $('#demo-btn').onclick=()=>enterDemoMode();
  const schoolLabel=$('#auth-school-label');
  if(schoolLabel){
    if(App.school?.name){ schoolLabel.textContent=`For ${App.school.name}`; schoolLabel.hidden=false; }
    else { schoolLabel.hidden=true; }
  }
  initGoogleSignInButton();
}
function showApp(){
  $('#boot').classList.add('gone');
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  $('#fab').hidden = false;
  const u = App.user || {};
  const fallback = `https://ui-avatars.com/api/?background=4f46e5&color=fff&bold=true&name=${encodeURIComponent(u.displayName || 'Student')}`;
  const img = u.photoURL || fallback;
  for (const id of ['avatar','avatar-lg']){
    const el = document.getElementById(id);
    if (el){ el.src = img; el.onerror = () => { el.src = fallback; }; }
  }
  const sa = $('#settings-avatar');
  if (sa) sa.src = img;
  $('#account-name').textContent = u.displayName || 'Student';
  $('#account-email').textContent = u.email || '';
  const schoolTitle = $('#account-school');
  if (schoolTitle) schoolTitle.textContent = u.school?.name || '';
}

async function waitForGoogleIdentity(timeout=10000){
  const t0=Date.now();
  while (!(window.google?.accounts?.id) && Date.now()-t0 < timeout) await new Promise(r=>setTimeout(r,120));
  return !!window.google?.accounts?.id;
}
async function handleGoogleCredential(response){
  const box=$('#google-error'); if(box) box.hidden=true;
  try{
    const result = await apiFetch('/auth/google',{
      method:'POST',
      body:JSON.stringify({credential:response.credential, schoolSlug:App.school?.slug || schoolHintFromUrl()})
    });
    await onUserSignedIn({...result.user, real:true});
  }catch(err){
    if(err.code === 'SCHOOL_SELECTION_REQUIRED' && err.payload?.schools?.length){
      openSchoolChooser(err.payload.schools, response.credential);
      return;
    }
    if(box){
      box.hidden=false;
      box.innerHTML=`<span>⚠️</span><div>${escapeHtml(err.message || 'Google sign-in failed.')}</div>`;
    }
  }
}
function openSchoolChooser(schools, credential){
  openModal({
    title:'Choose your school',
    subtitle:'This is only needed when the same Google account could belong to more than one Scribe school.',
    body:`<div class="school-choice-list">${schools.map(s => `
      <button class="school-choice" data-school-slug="${escapeHtml(s.slug)}">
        <span class="school-choice-ico">🏫</span><span><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.slug)}</small></span><span>→</span>
      </button>`).join('')}</div>`,
    footer:'',
    onMount(el, close){
      $$('.school-choice', el).forEach(btn => btn.addEventListener('click', async () => {
        btn.disabled=true;
        try {
          const result=await apiFetch('/auth/google',{method:'POST',body:JSON.stringify({credential,schoolSlug:btn.dataset.schoolSlug})});
          close();
          await onUserSignedIn({...result.user,real:true});
        } catch(e){ btn.disabled=false; toast(e.message || 'Could not sign in','error'); }
      }));
    }
  });
}
function initGoogleIdentity(clientId){
  if(!window.google?.accounts?.id || !clientId) return false;
  google.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: false
  });
  window.__scribeGsiInitialised=true;
  const host=$('#enter-btn');
  if(host){
    host.innerHTML='';
    google.accounts.id.renderButton(host,{theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:360});
  }
  return true;
}
async function initGoogleSignInButton(){
  const cfg=await loadServerGoogleConfig(App.school?.slug || schoolHintFromUrl());
  const host=$('#enter-btn');
  if(!host) return;
  if(!cfg.googleClientId){
    host.innerHTML='<button type="button" class="btn btn-google btn-block" id="google-fallback-btn">Continue with Google</button>';
    $('#google-fallback-btn')?.addEventListener('click',signInGoogle);
    return;
  }
  if(await waitForGoogleIdentity()) initGoogleIdentity(cfg.googleClientId);
  else host.innerHTML='<button type="button" class="btn btn-google btn-block" id="google-fallback-btn">Continue with Google</button>';
  $('#google-fallback-btn')?.addEventListener('click',signInGoogle);
}

async function signInGoogle(){
  $('#google-error').hidden = true;
  const cfg = await loadServerGoogleConfig(App.school?.slug || schoolHintFromUrl());
  if (!cfg.googleClientId){
    $('#google-error').hidden=false;
    $('#google-error').innerHTML='<span>⚠️</span><div>Google sign-in is not set up on this Scribe site yet. Please ask your Scribe administrator.</div>';
    return;
  }
  if (!(await waitForGoogleIdentity())){
    $('#google-error').hidden=false;
    $('#google-error').innerHTML='<span>⚠️</span><div>Google Identity Services did not load. Check your internet connection and Content Security Policy.</div>';
    return;
  }
  if (!window.__scribeGsiInitialised){ initGoogleIdentity(cfg.googleClientId); }
  // The rendered Google button owns the actual OAuth interaction. This fallback
  // prompts One Tap when the user clicks the surrounding sign-in area.
  try { google.accounts.id.prompt(); }
  catch (e){ console.warn(e); }
}

async function enterDemoMode(){
  const session = { uid: 'demo-user', displayName: 'Demo Student', email: 'demo@scribe.local', photoURL: '', real: false };
  try { localStorage.setItem(LS_SESSION, JSON.stringify(session)); } catch {}
  await onUserSignedIn(session);
}

async function onUserSignedIn(user){
  App.user = user;
  App.school = user.school || null;
  if (user.real && App.school?.slug) {
    const cfg = await loadServerGoogleConfig(App.school.slug);
    SCHOOL_CONFIG = cfg.school || SCHOOL_CONFIG;
  }
  try { localStorage.setItem(LS_SESSION, JSON.stringify(user)); } catch {}
  await Store.init(user);
  GoogleServices.restore();
  await dedupeExistingEvents();
  await dedupeExistingAssignments();
  document.documentElement.dataset.theme = Store.cache.settings.theme || 'light';
  renderSidebar();
  showApp(); render(); checkDueSoon();
  setTimeout(()=>{ syncCalendarSubscriptions().then(()=>render()).catch(e=>console.warn('Calendar auto-sync failed',e)); },500);
  if (GoogleServices.has()) setTimeout(()=>syncAll({interactive:false,silent:true}).catch(()=>{}),900);
  if (!Store.cache.settings.onboardingSeen) setTimeout(()=>showOnboarding(),700);
}

async function signOut(){
  try { await apiFetch('/auth/signout',{method:'POST',body:'{}'}); } catch {}
  GoogleServices.clear();
  try { localStorage.removeItem(LS_SESSION); } catch {}
  App.user=null; Store.uid=null; Store.cache=null;
  location.hash=''; location.reload();
}

/* ── Demo data ───────────────────────────────────────────── */
function seedDemoData(){
  const d = emptyData();
  const day = 86400000;
  const today = startOfDay();
  d.assignments = [
    { id:'a1', title:'Chapter 5 questions', description:'From Maths', type:'Homework', subject:'Mathematics', dueDate: today + day, source:'Google Classroom', url:'', sources:[{source:'Google Classroom',url:''}], completed:false, manual:false, priority:'urgent', mergedCount:1, createdAt: now() - day*2 },
    { id:'a2', title:'Science test — chapters 4 to 6', description:'From Science', type:'Test', subject:'Science', dueDate: today + day*3, source:'Google Classroom', url:'', sources:[{source:'Google Classroom',url:''}], completed:false, manual:false, priority:'urgent', mergedCount:1, createdAt: now() - day*3 },
    { id:'a3', title:'Read chapters 3–4 of the novel', description:'From English', type:'Homework', subject:'English', dueDate: today + day*5, source:'Google Classroom', url:'', sources:[{source:'Google Classroom',url:''}], completed:false, manual:false, priority:'medium', mergedCount:1, createdAt: now() - day }
  ];
  d.events = [
    { id:'e1', title:'Whole school assembly', description:'Sports awards.', start: today + day*1 + 9*3600000, source:'School Calendar', manual:false, createdAt: now() - day*2 }
  ];
  const mkEffort = (daysAgo, ratings) => ({
    id: `er-${daysAgo}`, date: today - daysAgo * day,
    studentCode: '10SWG', attendance: 96,
    ratings, source: 'PDF upload', createdAt: now() - daysAgo * day
  });
  d.effortReports = [
    mkEffort(2, [
      { subject:'Commerce', rating:5, yearAvg:4.7, weekRatings:[5,5,5,5,null] },
      { subject:'English', rating:5, yearAvg:5.0, weekRatings:[5,5,5,5,5,5,5,5,4,5] },
      { subject:'ICT', rating:5, yearAvg:4.9, weekRatings:[4,4,5,5,5,5,5] },
      { subject:'Mathematics', rating:5, yearAvg:4.9, weekRatings:[5,5,5,5,5,5,5,4] },
      { subject:'Physical Education and Health', rating:4, yearAvg:4.0, weekRatings:[4,4,5,null] },
      { subject:'Religious Education', rating:5, yearAvg:4.9, weekRatings:[5,5,5,5,5,5,5,null] },
      { subject:'Science', rating:5, yearAvg:4.8, weekRatings:[5,5,5,5,5,5,null] },
      { subject:'Social Studies', rating:5, yearAvg:5.0, weekRatings:[5,5,5,5,5,5,5,null] },
      { subject:'Te Reo Maori', rating:5, yearAvg:4.9, weekRatings:[5,5,5,5,5,5,null] }
    ])
  ];
  d.settings.timetable = [
    { day:1, start:'09:00', end:'10:00', subject:'Maths', room:'M12' },
    { day:1, start:'10:05', end:'11:05', subject:'English', room:'E7' },
    { day:2, start:'09:00', end:'10:00', subject:'Science', room:'S3' },
    { day:3, start:'09:00', end:'10:00', subject:'English', room:'E7' },
    { day:4, start:'09:00', end:'10:00', subject:'Maths', room:'M12' },
    { day:5, start:'09:00', end:'10:00', subject:'English', room:'E7' }
  ];
  d.settings.weeklyActivities = [
    { id:'act1', day:1, start:'16:00', end:'16:30', name:'Tutoring' },
    { id:'act2', day:2, start:'16:00', end:'17:00', name:'Tutoring' },
    { id:'act3', day:3, start:'15:15', end:'16:00', name:'Padel' }
  ];
  d.settings.onboardingSeen = true;
  d.profile = { seeded:true };
  return d;
}

/* ── Global UI wiring ────────────────────────────────────── */
function wireGlobalUI(){
  $('#menu-btn')?.addEventListener('click', () => {
    const sb = $('#sidebar');
    const open = sb.classList.toggle('open');
    $('#scrim').hidden = !open;
    $('#menu-btn').setAttribute('aria-expanded', String(open));
  });
  $('#scrim')?.addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#scrim').hidden = true;
  });
  const closeAllDropdowns = () => {
    $('#notif-panel').hidden = true;
    $('#account-panel').hidden = true;
    $('#search-results')?.setAttribute('hidden', '');
    $('#notif-btn')?.setAttribute('aria-expanded', 'false');
    $('#account-btn')?.setAttribute('aria-expanded', 'false');
  };
  $('#notif-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = $('#notif-panel');
    const willOpen = panel.hidden;
    closeAllDropdowns();
    if (willOpen){ panel.hidden = false; $('#notif-btn').setAttribute('aria-expanded', 'true'); renderNotifPanel(); }
  });
  $('#account-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = $('#account-panel');
    const willOpen = panel.hidden;
    closeAllDropdowns();
    if (willOpen){ panel.hidden = false; $('#account-btn').setAttribute('aria-expanded', 'true'); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown') && !e.target.closest('.topbar-search')) closeAllDropdowns();
    if (App.fabOpen && !e.target.closest('#fab') && !e.target.closest('#fab-menu')) toggleFab();
  });
  $$('#account-panel [data-nav]').forEach(btn => {
    btn.addEventListener('click', () => { location.hash = btn.dataset.nav; closeAllDropdowns(); });
  });
  $('#signout-btn')?.addEventListener('click', signOut);
  $('#help-btn')?.addEventListener('click', () => { closeAllDropdowns(); openHelpModal(); });
  $('#sync-btn')?.addEventListener('click', () => syncAll({ silent: false }));
  $('#smart-paste-btn')?.addEventListener('click', () => openClassroomPasteModal());
  $('#fab')?.addEventListener('click', toggleFab);
  const searchInput = $('#global-search');
  searchInput?.addEventListener('input', (e) => runSearch(e.target.value));
  searchInput?.addEventListener('focus', (e) => { if (e.target.value.length > 1) runSearch(e.target.value); });
  searchInput?.addEventListener('keydown', (e) => {
    const box = $('#search-results');
    if (e.key === 'Escape'){ if (box) box.hidden = true; searchInput.blur(); }
    else if (e.key === 'Enter'){ const first = box && !box.hidden && $('.search-item', box); if (first){ e.preventDefault(); first.click(); } }
  });
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top:0, behavior:'smooth' }); });
  let gPressed = false;
  document.addEventListener('keydown', (e) => {
    const inInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    if (inInput) return;
    if ($('#onboarding')) return;
    if (e.key === '/'){ e.preventDefault(); searchInput?.focus(); return; }
    if (e.key === '?' || (e.shiftKey && e.key === '/')){ e.preventDefault(); openHelpModal(); return; }
    const k = e.key.toLowerCase();
    if (k === 'n'){ e.preventDefault(); openAssignmentModal(null, 'Assignment'); return; }
    if (k === 'p'){ e.preventDefault(); openClassroomPasteModal(); return; }
    if (k === 'e'){ e.preventDefault(); openEffortUploadModal(); return; }
    if (k === 's'){ e.preventDefault(); $('#sync-btn')?.click(); return; }
    if (k === 'g'){ gPressed = true; setTimeout(() => { gPressed = false; }, 800); return; }
    if (gPressed){
      if (k === 'd'){ location.hash = '#/dashboard'; gPressed = false; }
      else if (k === 'a'){ location.hash = '#/assignments'; gPressed = false; }
      else if (k === 'c'){ location.hash = '#/calendar'; gPressed = false; }
      else if (k === 'e'){ location.hash = '#/effort'; gPressed = false; }
      else if (k === 'p'){ location.hash = '#/planner'; gPressed = false; }
    }
  });
  $('#view')?.addEventListener('click', (e) => {
    const sync = e.target.closest('[data-sync]');
    if (sync){ syncOne(sync.dataset.sync); return; }
  });
}
async function syncOne(key){
  const btn = document.querySelector(`[data-sync="${key}"]`);
  if (btn){ btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    if (key === 'calendar'){
      const r = await syncCalendarSubscriptions();
      toast(`${r.added} new event${r.added===1?'':'s'}`, 'success', 'Calendar synced');
    }
    await checkDueSoon();
    setSyncUI('ok', `Synced ${relativeTime(now())}`);
  } catch (err){ toast(err.message, 'error', 'Sync failed'); }
  finally { if (btn){ btn.disabled = false; btn.textContent = 'Sync'; } render(); }
}
function toggleFab(){
  App.fabOpen = !App.fabOpen;
  $('#fab').classList.toggle('open', App.fabOpen);
  $('#fab-menu').hidden = !App.fabOpen;
  if (App.fabOpen) renderFabMenu();
}
function renderFabMenu(){
  $('#fab-menu').innerHTML = `
    <button class="fab-item highlight" data-quick="sync-now">
      <span class="fab-ico">🔄</span><span>Sync everything</span><kbd>S</kbd>
    </button>
    <button class="fab-item highlight" data-quick="paste-classroom">
      <span class="fab-ico">✨</span><span>Smart Paste</span><kbd>P</kbd>
    </button>
    <div class="menu-sep"></div>
    <button class="fab-item" data-quick="upload-effort">
      <span class="fab-ico">📤</span><span>Upload effort report</span><kbd>E</kbd>
    </button>
    <button class="fab-item" data-quick="new-assignment"><span class="fab-ico">📝</span><span>Assignment</span><kbd>N</kbd></button>
    <button class="fab-item" data-quick="new-test"><span class="fab-ico">📊</span><span>Test or exam</span></button>
    <button class="fab-item" data-quick="new-event"><span class="fab-ico">📅</span><span>Event</span></button>
    <div class="menu-sep"></div>
    <button class="fab-item" data-quick="edit-activities"><span class="fab-ico">🏃</span><span>Weekly activities</span></button>`;
  $$('#fab-menu .fab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.quick;
      toggleFab();
      if (q === 'sync-now') syncAll({ silent: false });
      else if (q === 'paste-classroom') openClassroomPasteModal();
      else if (q === 'upload-effort') openEffortUploadModal();
      else if (q === 'new-assignment') openAssignmentModal(null, 'Assignment');
      else if (q === 'new-test') openAssignmentModal(null, 'Test');
      else if (q === 'new-event') openAssignmentModal(null, 'Event');
      else if (q === 'edit-activities') openActivitiesModal();
    });
  });
}
function openHelpModal(){
  openModal({
    title: 'Keyboard shortcuts',
    subtitle: 'Press ? anytime to see this',
    body: `<div class="shortcut-grid">
      <div class="shortcut-row"><span>Sync everything</span><kbd>S</kbd></div>
      <div class="shortcut-row"><span>Smart Paste</span><kbd>P</kbd></div>
      <div class="shortcut-row"><span>Upload effort report</span><kbd>E</kbd></div>
      <div class="shortcut-row"><span>New assignment</span><kbd>N</kbd></div>
      <div class="shortcut-row"><span>Search</span><kbd>/</kbd></div>
      <div class="shortcut-row"><span>Dashboard</span><kbd>G</kbd> <kbd>D</kbd></div>
      <div class="shortcut-row"><span>Assignments</span><kbd>G</kbd> <kbd>A</kbd></div>
      <div class="shortcut-row"><span>Planner</span><kbd>G</kbd> <kbd>P</kbd></div>
    </div>`,
    footer: `<button class="btn btn-primary" data-close>Got it</button>`
  });
}
async function exportData(){
  const payload = {
    exportedAt: new Date().toISOString(),
    user: { email: App.user?.email, name: App.user?.displayName },
    data: {
      assignments: Store.all('assignments'), events: Store.all('events'),
      weeklyNotes: Store.all('weeklyNotes'),
      notifications: Store.all('notifications'),
      studySessions: Store.all('studySessions'), courses: Store.all('courses'),
      effortReports: Store.all('effortReports'), results: Store.all('results'),
      settings: Store.cache.settings, profile: Store.cache.profile
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `scribe-export-${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Downloaded', 'success');
}

/* ── Boot ────────────────────────────────────────────────── */
async function boot(){
  const bootEl=$('#boot');
  const safety=setTimeout(()=>{ if(!bootEl.classList.contains('gone')){ console.warn('Boot timed out'); showAuth(); } },6000);
  try{
    const initialCfg = await loadServerGoogleConfig(schoolHintFromUrl());
    if (initialCfg.school) App.school = initialCfg.school;
    App.availableSchools = initialCfg.schools || [];
    const result=await apiFetch('/auth/me');
    clearTimeout(safety);
    if(result.user){ await onUserSignedIn({...result.user,real:true}); }
    else{
      const raw=localStorage.getItem(LS_SESSION);
      if(raw){ try{ const cached=JSON.parse(raw); if(!cached.real) await onUserSignedIn(cached); else showAuth(); } catch{ showAuth(); } }
      else showAuth();
    }
    wireGlobalUI();
  }catch(err){
    clearTimeout(safety); console.error('Boot error:',err);
    bootEl.innerHTML=`<div class="boot-mark" style="background:var(--red-500);animation:none">!</div><div class="boot-text">Scribe could not start</div><div style="max-width:520px;text-align:left;color:var(--text-2);font-size:13px;line-height:1.7;padding:0 24px"><p style="margin-bottom:10px"><strong>${escapeHtml(err.message||'Unknown error')}</strong></p><p style="margin-top:14px"><button class="btn btn-primary btn-sm" onclick="location.reload()">Reload</button></p></div>`;
  }
}
boot();

window.Scribe = {
  version: '2.1.0-multi-school',
  get state(){ return Store.cache; },
  get config(){ return { school:SCHOOL_CONFIG, googleConfigured: !!SCHOOL_CONFIG?.googleConfigured }; },
  syncAll, exportData,
  syncClassroom, syncGmail, GoogleServices,
  showOnboarding,
  openEffortUploadModal, openClassroomPasteModal, openActivitiesModal, openTimetableModal,
  dedupeExistingEvents, dedupeExistingAssignments,
  smartPaste, smartPasteClassroom, smartPasteEmail, smartPasteGeneral,
  detectPasteFormat, detectSubject, normalizeSubject, subjectFromCourseCode,
  parseDate, extractInlineDue, parseEffortReportText, parseActivitiesText, parseTimetableText
};
