/* Olimpiada akademiyasi — Django API bilan ishlaydigan interfeys (vanilla JS, build talab qilmaydi). */
'use strict';
const API = '/api';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Math.round(n || 0)).toLocaleString('ru-RU').replace(/ /g, ' ') + " so'm";
const today = () => new Date().toLocaleDateString('sv-SE');
const hhmm = (t) => (t || '').slice(0, 5);
const DN = { DCJ: 'Du-Chor-Ju', SPSh: 'Se-Pay-Sha' };
const TUMAN = ['Namangan shahri', 'Namangan tumani', 'Chortoq', 'Chust', 'Kosonsoy', 'Mingbuloq', 'Norin', 'Pop', "To‘raqo‘rg‘on", "Uchqo‘rg‘on", 'Uychi', "Yangiqo‘rg‘on", 'Yangi Namangan'];
const tmnList = () => `<datalist id="tmn">${TUMAN.map((x) => `<option value="${x}">`).join('')}</datalist>`;
document.body.insertAdjacentHTML('beforeend', tmnList());
const ROLE = { admin: 'Admin', administrator: "O'quv markaz administratori", bugalter: 'Bugalter', teacher: "O'qituvchi", support: 'Support teacher' };
const SECS = [['dash', 'Asosiy'], ['att', 'Davomat'], ['pay', "To'lov"], ['sal', 'Oylik'], ['room', 'Xonalar'], ['stf', 'Xodimlar'], ['new', 'Yangi'], ['arch', 'Arxiv']];
const LV = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const HOURS = Array.from({ length: 9 }, (_, i) => String(i + 8).padStart(2, '0') + ':00');
const MONTHN = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const mname = (m) => { const [y, x] = m.split('-'); return MONTHN[+x - 1][0].toUpperCase() + MONTHN[+x - 1].slice(1) + ' ' + y; };
const FIELD = { full_name: 'F.I.Sh', username: 'Login', password: 'Parol', phone: 'Telefon', name: 'Nomi', room: 'Xona', start_time: 'Boshlanish vaqti', amount: 'Summa', month: 'Oy', date: 'Sana', slug: 'Kod', price: 'Narx', non_field_errors: '' };

/* ---------- holat ---------- */
let access = null;
let refresh = null;
const S = { me: null, view: 'dash', msg: null, d: {}, mo: null, loading: false };
const store = () => (localStorage.getItem('oqm_r') ? localStorage : sessionStorage);
const safe = (f) => { try { return f(); } catch { return null; } };

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

function errText(d, status) {
  if (status === 429 || status === 403 && d && /lock|block/i.test(JSON.stringify(d))) return "Juda ko'p urinish. 30 daqiqadan keyin qayta urinib ko'ring";
  if (!d) return status >= 500 ? 'Serverda xatolik. Keyinroq urinib ko‘ring' : `Xatolik (${status})`;
  if (typeof d === 'string') return d;
  if (d.detail) return Array.isArray(d.detail) ? d.detail.join('; ') : String(d.detail);
  const out = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === 'suggestions') continue;
    const txt = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join('; ') : typeof v === 'object' ? errText(v) : v;
    const label = k in FIELD ? FIELD[k] : k;
    out.push(label ? `${label}: ${txt}` : txt);
  }
  return out.join(' · ') || `Xatolik (${status})`;
}

async function doRefresh() {
  if (!refresh) return false;
  try {
    const r = await fetch(API + '/auth/refresh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh }) });
    if (!r.ok) return false;
    const d = await r.json();
    access = d.access;
    if (d.refresh) { refresh = d.refresh; if (!S.adm) store().setItem('oqm_r', refresh); }
    return true;
  } catch { return false; }
}

async function api(path, opt = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (access) h.Authorization = 'Bearer ' + access;
  let r;
  try {
    r = await fetch(API + path, { method: opt.method || 'GET', headers: h, body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined });
  } catch { throw new ApiError("Serverga ulanib bo'lmadi", 0); }
  if (r.status === 401 && refresh && !opt.retry) {
    if (await doRefresh()) return api(path, { ...opt, retry: 1 });
    localLogout();
    throw new ApiError('Sessiya tugadi. Qayta kiring', 401);
  }
  let d = null;
  if (r.status !== 204) { try { d = await r.json(); } catch { d = null; } }
  if (!r.ok) throw new ApiError(errText(d, r.status), r.status, d);
  return d;
}
const list = async (p) => { const d = await api(p + (p.includes('?') ? '&' : '?') + 'limit=1000'); return d.results || d; };
const post = (p, body = {}) => api(p, { method: 'POST', body });
const patch = (p, body) => api(p, { method: 'PATCH', body });

/* ---------- yordamchilar ---------- */
const isT = () => S.me && (S.me.role === 'teacher' || S.me.role === 'support');
const can = (s) => (S.me && S.me.permissions[s]) || 0;
const isAdmin = () => S.me && S.me.role === 'admin';
function toast(m, t = 'ok') {
  const box = $('#toast'); if (!box) return;
  const n = document.createElement('div'); n.className = 'toast ' + t; n.setAttribute('role', t === 'err' ? 'alert' : 'status');
  n.innerHTML = `<span class="ti">${t === 'err' ? '⚠' : '✓'}</span><span>${esc(m)}</span>`;
  box.appendChild(n);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 300); }, t === 'err' ? 7000 : 3200);
}
const ok = (m) => { S.msg = null; toast(m, 'ok'); };
const bad = (e) => { const m = e.message || String(e); S.msg = { t: 'err', m }; toast(m, 'err'); };

function pwField(name, label, ac = 'new-password', val = '') {
  return `<label>${label}<span class="pw"><input type="password" name="${name}" autocomplete="${ac}" value="${esc(val)}"><button type="button" class="eye" data-a="eye" aria-label="Parolni ko'rsatish" title="Ko'rsatish / yashirish">👁</button></span></label>`;
}
function genPw() {
  const set = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*!?'];
  const buf = new Uint32Array(14); crypto.getRandomValues(buf);
  const ch = (i, s) => s[buf[i] % s.length];
  const arr = [ch(0, set[0]), ch(1, set[1]), ch(2, set[2]), ch(3, set[3]), ...Array.from({ length: 8 }, (_, i) => ch(4 + i, set[0] + set[1] + set[2]))];
  for (let i = arr.length - 1; i > 0; i--) { const j = buf[i] % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr.join('');
}

/* ---------- kirish / chiqish ---------- */
function localLogout() {
  access = null; refresh = null; S.me = null; S.mo = null; S.d = {}; S.adm = null; S.bell = 0;
  safe(() => { localStorage.removeItem('oqm_r'); sessionStorage.removeItem('oqm_r'); });
  render();
}

async function login(f) {
  S.lerr = '';
  const d = await api('/auth/login/', { method: 'POST', body: { username: f.username.trim(), password: f.password, remember: !!f.remember } });
  access = d.access; refresh = d.refresh;
  safe(() => { localStorage.removeItem('oqm_r'); sessionStorage.removeItem('oqm_r'); (f.remember ? localStorage : sessionStorage).setItem('oqm_r', refresh); localStorage.setItem('oqm_user', f.username.trim()); });
  S.me = d.user;
  await enter();
}

async function restore() {
  refresh = safe(() => localStorage.getItem('oqm_r') || sessionStorage.getItem('oqm_r'));
  if (!refresh) return false;
  if (!(await doRefresh())) { localLogout(); return false; }
  try { S.me = await api('/auth/me/'); } catch { localLogout(); return false; }
  return true;
}

async function loadBell() {
  S.bell = 0;
  if (!S.me || !(isT() || can('att') >= 1)) return;
  const [al, bd] = await Promise.all([api('/alerts/').catch(() => []), api('/contact-board/').catch(() => ({}))]);
  S.bell = new Set([...(al.results || al).map((x) => x.student), ...(bd.absent_today || []).map((x) => x.student)]).size;
}

async function enter() {
  await loadBell();
  S.view = tabs()[0][0];
  S.msg = null;
  await go(S.view);
  if (S.me.must_change_password && !S.adm) { S.mo = { t: 'pw', force: true }; render(); }
}

/* ---------- bo'limlar ---------- */
function tabs() {
  if (!S.me) return [];
  if (isT()) return [['dash', 'Guruhlarim'], ['att', 'Davomat'], ['sal', 'Oylik'], ...[['pay', "To'lov"], ['room', 'Xonalar'], ['stf', 'Xodimlar'], ['new', 'Yangi'], ['arch', 'Arxiv']].filter(([k]) => can(k))];
  const t = [];
  if (can('dash')) t.push(['dash', 'Asosiy']);
  if (can('att')) t.push(['att', 'Davomat']);
  if (can('pay')) t.push(['pay', "To'lov"]);
  if (can('sal')) t.push(['sal', 'Oylik']);
  if (can('room')) t.push(['room', 'Xonalar']);
  if (can('stf')) t.push(['stf', 'Xodimlar']);
  if (can('dash')) t.push(['stu', "O'quvchilar"]);
  if (can('new')) t.push(['new', 'Yangi']);
  if (can('arch')) t.push(['arch', 'Arxiv']);
  if (isAdmin()) t.push(['log', 'Tarix'], ['bak', 'Zaxira'], ['set', 'Sozlamalar']);
  return t;
}

let busy = false;
async function go(view) {
  S.view = view; S.loading = true; S.mo = null; render();
  try { await (L[view] ? L[view]() : null); } catch (e) { bad(e); }
  S.loading = false; render();
}
async function run(fn, keepModal = true) {
  if (busy) return; busy = true;
  try { await fn(); } catch (e) { bad(e); if (e.status === 401) { busy = false; return; } }
  busy = false;
  if (!keepModal) S.mo = null;
  render();
}

const subjects = async () => { if (!S.subj) S.subj = await list('/subjects/'); return S.subj; };
const roomList = async () => (S.rooms = await list('/rooms/'));
const loadPlan = async () => { if (!isT() && S.d.room) S.d.room.sp = await api('/groups/support-plan/').catch(() => S.d.room.sp || []); };
const loadCf = async () => { if (!isT()) S.cf = await api('/groups/conflicts/').catch(() => S.cf || []); };
const settings = async () => { if (!S.set) S.set = await api('/settings/'); return S.set; };
function months() {
  const s = S.set; if (!s) return [today().slice(0, 7)];
  let [y, m] = s.academic_start.split('-').map(Number); const out = [];
  for (let i = 0; i < s.academic_months; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
function curMonth() { const c = today().slice(0, 7), ms = months(); return ms.includes(c) ? c : ms[0]; }

/* ---------- ma'lumotlarni yuklash ---------- */
const L = {
  async dash() {
    await Promise.all([subjects(), settings()]);
    const d = (S.d.dash = { groups: await list('/groups/'), alerts: await api('/alerts/').then((x) => x.results || x).catch(() => []) });
    if (!isT()) { d.stats = await api('/groups/stats/'); await loadCf(); d.conflicts = S.cf; } else d.sp = await api('/groups/support-plan/').catch(() => []);
    S.d.sf = S.d.sf || 'all';
  },
  async att() {
    await settings();
    const a = (S.d.att = S.d.att || { date: today(), marks: {} });
    a.groups = await list('/groups/');
    await loadBoard();
    if (a.group) await loadSheet(); else a.sheet = null;
  },
  async pay() {
    await settings();
    const p = (S.d.pay = S.d.pay || { ps: 'list', month: curMonth(), q: '' });
    if (p.ps === 'list') { await calcLoad(); }
    if (p.ps === 'list') { const [ov, mr] = await Promise.all([api('/finance/overview/?month=' + p.month), api('/finance/month/?month=' + p.month)]); p.ov = ov; p.rows = mr.rows; p.closed = mr.closed; }
    if (p.ps === 'debt') p.debt = await api('/finance/debtors/?month=' + p.month);
    if (p.ps === 'cash') { [p.cash, p.sum] = await Promise.all([list('/cash/?month=' + p.month), api('/cash/summary/?month=' + p.month)]); }
  },
  async sal() {
    await settings();
    const s = (S.d.sal = S.d.sal || { month: curMonth() });
    if (isT()) s.me = await api('/salary/me/?month=' + s.month); else s.rows = await api('/salary/?month=' + s.month);
  },
  async room() { await Promise.all([subjects(), roomList()]); S.d.room = S.d.room || { days: 'DCJ', panel: '', view: 'cards', h: Math.min(18, Math.max(8, new Date().getHours())) }; S.d.room.groups = await list('/groups/'); S.d.room.staff = await list('/staff/').catch(() => []); await loadCf(); await loadPlan(); },
  async stf() {
    await subjects();
    const s = (S.d.stf = S.d.stf || { arch: false });
    s.staff = await list('/staff/' + (s.arch ? '?archived=1' : ''));
  },
  async stu() {
    await Promise.all([subjects(), settings()]);
    const s = (S.d.stu = S.d.stu || { q: '', subject: '', f: 'all' });
    const qs = new URLSearchParams();
    if (s.q) qs.set('q', s.q);
    if (s.subject) qs.set('subject', s.subject);
    if (s.f === 'nogroup') qs.set('nogroup', '1');
    const [students, groups] = await Promise.all([list('/students/' + (qs.toString() ? '?' + qs : '')), list('/groups/')]);
    s.students = students; s.groups = groups;
    s.debt = null;
    if (can('pay') >= 1) { const mr = await api('/finance/month/?month=' + curMonth()); s.debt = Object.fromEntries(mr.rows.map((r) => [r.student, (r.owe || 0) + (r.prev_debt || 0)])); }
  },
  async new() { await Promise.all([subjects(), roomList()]); S.d.new = { groups: await list('/groups/') }; },
  async bak() { S.d.bak = { list: await api('/backups/') }; },
  async arch() {
    const f = (S.d.arch && S.d.arch.f) || 'all';
    S.d.arch = { f, students: await list('/students/?archived=1'), groups: await list('/groups/'), staff: can('stf') >= 1 ? (await list('/staff/?archived=1').catch(() => [])).filter((u) => u.archived_at) : [] };
  },
  async log() { S.d.log = await list('/audit/'); },
  async set() { const st = (S.d.set = S.d.set || { tab: 'gen' }); S.set = await api('/settings/'); S.subj = await list('/subjects/'); if (st.tab === 'perm') st.staff = await list('/staff/?archived=1'); },
};
async function calcLoad() {
  if (!S.subj) S.subj = await list('/subjects/');
  const p = S.d.pay, c = (p.calc = p.calc || { from: '', days: 'DCJ', subs: [], disc: 0 });
  if (!c.from || c.from.slice(0, 7) !== p.month) { const t = today(); c.from = t.slice(0, 7) === p.month ? t : p.month + '-01'; }
  if (!c.subs.length && S.subj && S.subj.length) c.subs = [S.subj.find((x) => x.is_active !== false).id];
  c.res = await api(`/finance/calc/?month=${p.month}&days=${c.days}&from=${c.from}&subjects=${c.subs.join(',')}&discount=${c.disc || 0}`).catch(() => null);
}

async function loadBoard() {
  const a = S.d.att;
  a.alerts = await api('/alerts/').then((x) => x.results || x).catch(() => []);
  const b = await api('/contact-board/').catch(() => ({}));
  a.absent = b.absent_today || [];
  a.contacts = b.contacts || [];
  S.bell = new Set([...a.alerts.map((x) => x.student), ...a.absent.map((x) => x.student)]).size;
}

async function loadSheet() {
  const a = S.d.att;
  a.sheet = await api(`/attendance/?group=${a.group}&date=${a.date}`);
  a.marks = {}; a.smarks = {}; a.sheet.students.forEach((s) => { if (s.present !== null) a.marks[s.student] = s.present; if (s.support_present !== null && s.support_present !== undefined) a.smarks[s.student] = s.support_present; });
}

/* ---------- chizish ---------- */
/* Dizayn modellari: 1 = klassik (yuqori menyu), 2 = 3D yon menyu, 3 = kristal panel (chap tomonda 3D ikonkalar) */
const UIN = ['Klassik', '3D yon menyu', 'Kristal panel'];
const ICON = { dash: '🏠', att: '✅', pay: '💳', sal: '💼', room: '🚪', stf: '👥', stu: '🎓', new: '➕', arch: '🗄️', log: '📜', bak: '💾', set: '⚙️' };
const uiGet = () => { const v = safe(() => localStorage.getItem('oqm_ui')); return ['1', '2', '3'].includes(v) ? v : '2'; };
function render() {
  const hdr = document.querySelector('header'), app = $('#app');
  S.ui = S.ui || uiGet(); document.body.className = `ui${S.ui}${S.me ? ' in' : ''}`;
  if (!S.me) {
    hdr.style.display = 'none'; app.className = 'full'; app.innerHTML = loginH(); $('#md').innerHTML = '';
    return;
  }
  hdr.style.display = ''; app.className = '';
  $('#nav').innerHTML = tabs().map(([k, l]) => `<button class="tab ${S.view === k ? 'on' : ''}" data-a="tab" data-v="${k}" title="${esc(l)}"><span class="ni" aria-hidden="true">${ICON[k] || '•'}</span><span class="nl">${esc(l)}</span></button>`).join('');
  $('#who').textContent = `${S.me.full_name || S.me.username} · ${ROLE[S.me.role]}`;
  const bl = $('#bell'); if (bl) { bl.style.display = S.me && (isT() || can('att') >= 1) ? '' : 'none'; $('#bn').textContent = S.bell || ''; bl.classList.toggle('on', !!S.bell); }
  const msg = S.adm ? `<div class="card" style="border-color:var(--mid);display:flex;gap:10px;align-items:center;margin-bottom:10px"><span style="flex:1">👁 Siz <b>${esc(S.me.full_name || S.me.username)}</b> (${ROLE[S.me.role]}) nomidan ko‘ryapsiz. Faqat ko‘rish uchun — o‘zgarishlar shu xodim nomidan yoziladi.</span><button class="btn pri" data-a="unimp">Admin sifatida qaytish</button></div>` : '';
  app.innerHTML = msg + (S.loading ? '<div class="spin"><div class="ld"><div class="ldc"><i>π</i><i>∑</i><i>√x</i><i>Aa</i><i>15</i><i>Kids</i></div><div class="lds"></div></div><div>Yuklanmoqda…</div></div>' : (V[S.view] ? V[S.view]() : ''));
  $('#md').innerHTML = S.mo ? modalH() : '';
}

function loginH() {
  const last = S.lu || safe(() => localStorage.getItem('oqm_user')) || '';
  return `<div class="lg"><div class="lg-art"><img class="lg-logo" src="logo.png" alt="Olimpiada akademiyasi" width="200" height="200"><p>Guruhlar, davomat, to'lov va xonalar — bitta joyda.</p></div>
  <form class="lg-f" data-f="login"><h2>Kirish</h2>${S.lerr ? `<div class="lo" role="alert">${esc(S.lerr)}</div>` : ''}
  <label>Login<input name="username" autocomplete="username" autocapitalize="none" value="${esc(last)}" required></label>
  ${pwField('password', 'Parol', 'current-password')}
  <label class="rm"><input type="checkbox" name="remember"> Shu qurilmada eslab qolish (30 kun)</label>
  <button class="btn pri" type="submit">Kirish</button><a href="#" data-about="1" class="mu" style="text-decoration:none">ℹ Dastur haqida</a></form></div>`;
}

const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
const subjOpts = (sel) => (S.subj || []).filter((s) => s.is_active).map((s) => opt(s.slug, s.name, sel)).join('');
const roomsOf = (groups) => [...new Set([...(S.rooms || []).map((r) => r.name), ...groups.map((g) => g.room).filter(Boolean)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const roomSel = (sel, groups) => `<select name="room"><option value="">— xona tanlang —</option>${roomsOf(groups).map((r) => opt(r, 'Xona ' + r, sel)).join('')}</select>`;
const timeOf = (g) => (g.start_time ? hhmm(g.start_time) : '—');
const isKidsG = (g) => !!(S.subj || []).find((x) => x.slug === g.subject)?.is_kids;
/* Kidsda o'qituvchilar darsdagi KETMA-KETLIKda ko'rsatiladi (position 0 = English, 1 = Math; tartib guruhning o'ziga xos) */
function teachersHtml(g) {
  if (!isKidsG(g)) return g.teachers.map((t) => esc(t.name)).join(' + ') || '<span class="mu">O‘qituvchi yo‘q</span>';
  const eng = g.teachers.find((t) => t.position === 0), mat = g.teachers.find((t) => t.position === 1);
  const seq = g.kids_order === 'E' ? [[eng, 'English'], [mat, 'Math']] : [[mat, 'Math'], [eng, 'English']];
  const out = seq.filter(([t]) => t).map(([t, l]) => `${esc(t.name)} <span class="mu">(${l})</span>`);
  return out.join(' + ') || '<span class="mu">O‘qituvchi yo‘q</span>';
}
/* ---- Band/bo'sh hisoblash (backend schedule.py bilan bir xil qoidalar) ---- */
const slotOf = (g, over = {}) => ({ id: g.id, name: g.name, days: g.days, hour: g.start_time ? +g.start_time.slice(0, 2) : null, room: g.room, kids: isKidsG(g), order: g.kids_order, teachers: g.teachers.map((t) => t.id), ...over });
const ovl = (a, b) => a[0] < b[1] && b[0] < a[1];
const occ = (x) => [x.hour, x.hour + 2];
const twin = (x, i) => { const t = x.hour; if (!x.kids) return [t, t + 2]; const eF = x.order === 'E', eng = eF ? [t, t + 1] : [t + 1, t + 2], mat = eF ? [t + 1, t + 2] : [t, t + 1]; return i === 0 ? eng : i === 1 ? mat : [t, t + 2]; };
const othersOf = (all, id) => (all || []).filter((g) => g.id !== id && g.days && g.start_time).map((g) => slotOf(g));
const live = (c) => c.days && c.hour !== null && !Number.isNaN(c.hour);
const roomBy = (c, room, others) => { if (!live(c) || !room) return ''; const o = others.find((x) => x.days === c.days && x.room === room && ovl(occ({ ...c, room }), occ(x))); return o ? o.name : ''; };
const teacherBy = (c, tid, i, others) => { if (!live(c) || !tid) return ''; const o = others.find((x) => x.days === c.days && x.teachers.some((t, j) => t === tid && ovl(twin(c, i), twin(x, j)))); return o ? `${o.name}, ${String(o.hour).padStart(2, '0')}:00` : ''; };
const busyOpt = (v, label, sel, by) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''} ${by && String(sel) !== String(v) ? 'disabled' : ''}>${esc(label)}${by ? ` — band (${esc(by)})` : ''}</option>`;
function addStuForm(groups) {
  return `<form class="card fg" data-f="addstu" style="margin-bottom:12px"><h2 style="grid-column:1/-1;margin:0">＋ Yangi o'quvchi</h2><label>F.I.Sh<input name="full_name" required></label><label>Telefon<input name="phone" type="tel" placeholder="+998901234567"></label><label>Ota-ona telefon raqami<input name="parent_phone" type="tel" placeholder="+998901234567"></label><label>Tuman<input name="district" list="tmn"></label><label>Tug'ilgan sana<input type="date" name="birth_date" max="${today()}"></label><label>Maktab sinfi<input name="class_name"></label><label>Darsni boshlagan sana<input type="date" name="started_on" value="${today()}" required></label>
    <label>Guruh<select name="group"><option value="">Keyin biriktiraman</option>${groups.map((g) => opt(g.id, `${g.name} (${g.student_count}/${S.set ? S.set.max_group_size : 15})`, '')).join('')}</select></label><label>Izoh<input name="note"></label><button class="btn pri">Qo'shish</button></form>`;
}

/* ---------- ko'rinishlar ---------- */
function calcCard(p) {
  const c = p.calc, r = c && c.res; if (!c) return '';
  const subs = (S.subj || []).filter((x) => x.is_active !== false);
  return `<details class="card" style="margin:10px 0" ${c.open ? 'open' : ''}><summary><b>🧮 To‘lov kalkulyatori</b> <span class="mu">— qaysi kundan boshlasa, shunga qarab</span></summary><div class="row"><label class="mu">Boshlash sanasi<br><input type="date" data-a="cc" data-v="from" value="${esc(c.from)}" min="${p.month}-01" max="${p.month}-31"></label><label class="mu">Kunlar<br><select data-a="cc" data-v="days"><option value="DCJ" ${c.days === 'DCJ' ? 'selected' : ''}>Du-Chor-Ju</option><option value="SPSh" ${c.days === 'SPSh' ? 'selected' : ''}>Se-Pay-Sha</option></select></label><label class="mu">Chegirma (so‘m)<br><input type="number" min="0" step="10000" style="width:120px" data-a="cc" data-v="disc" value="${c.disc || 0}"></label></div><div class="row">${subs.map((x) => `<label class="chip"><input type="checkbox" data-a="cc" data-v="sub:${x.id}" ${c.subs.includes(x.id) ? 'checked' : ''}> ${esc(x.name)} · ${money(x.price)}</label>`).join('')}</div>${r ? `<div>Oyda <b>${r.lessons_total}</b> ta dars, qolgan: <b>${r.lessons_left}</b> ta → to‘lov: <b class="st2" style="font-size:20px">${money(r.amount)}</b> <span class="mu">(to‘liq: ${money(r.full)})</span></div>` : '<div class="mu">Hisoblab bo‘lmadi</div>'}</details>`;
}
/* O'qituvchi/support o'z jadvali: qaysi kuni, soat nechada, qaysi xonada */
const WD_NAMES = { DCJ: 'Dushanba · Chorshanba · Juma', SPSh: 'Seshanba · Payshanba · Shanba' };
function myItems(groups, sp) {
  const me = S.me.id, out = [], p2 = (h) => `${String(h).padStart(2, '0')}:00`;
  groups.filter((g) => g.days && g.start_time).forEach((g) => {
    const x = slotOf(g), i = x.teachers.indexOf(me);
    if (S.me.role === 'teacher' && i >= 0) {
      const w = twin(x, i), kids = isKidsG(g), sub = kids ? ((g.teachers.find((t) => t.id === me) || {}).position === 0 ? 'English' : 'Math') : '';
      out.push({ days: g.days, from: w[0], to: w[1], name: g.name, room: g.room, kind: 'main', note: kids ? `${sub} · ${p2(w[0])}–${p2(w[1])}` : 'Asosiy dars', n: g.student_count });
    }
    if (g.supports.some((y) => y.id === me)) {
      const pl = (sp || []).find((q) => q.group === g.id), h = x.hour + 2;
      out.push({ days: g.days, from: h, to: h + 1, name: g.name, room: pl ? pl.room : '', kind: 'sup', note: 'Support darsi', n: g.student_count });
    }
  });
  return out.sort((a, b) => a.from - b.from || a.name.localeCompare(b.name, undefined, { numeric: true }));
}
function mySched(d) {
  const items = myItems(d.groups, d.sp), p2 = (h) => `${String(h).padStart(2, '0')}:00`, view = S.d.tsv || 'today';
  const wd = new Date().getDay(), tdays = [1, 3, 5].includes(wd) ? 'DCJ' : [2, 4, 6].includes(wd) ? 'SPSh' : '', nowH = new Date().getHours();
  const item = (it, hl) => `<a href="#" class="card sched ${it.kind === 'sup' ? 'sup' : ''} ${hl && nowH >= it.from && nowH < it.to ? 'now' : ''}" data-a="grp" data-v="${(d.groups.find((g) => g.name === it.name) || {}).id}"><b class="tm">${p2(it.from)}–${p2(it.to)}</b><span class="sn"><b>${esc(it.name)}</b><span class="mu">${esc(it.note)} · ${it.n} o‘quvchi</span></span><span class="rm">${it.room ? 'Xona ' + esc(it.room) : '<span class="mu">xona yo‘q</span>'}</span></a>`;
  const col = (k, hl) => { const l = items.filter((x) => x.days === k); return `<div><div class="mu" style="margin:6px 0">${WD_NAMES[k]}</div>${l.map((x) => item(x, hl)).join('') || '<p class="mu">Dars yo‘q</p>'}</div>`; };
  const tabsH = `<div class="row" style="margin:0 0 6px"><button class="chip ${view === 'today' ? 'on' : ''}" data-a="tsv" data-v="today">Bugun</button><button class="chip ${view === 'week' ? 'on' : ''}" data-a="tsv" data-v="week">Haftalik</button></div>`;
  const body = view === 'today'
    ? (tdays ? col(tdays, true) : '<p class="mu">Bugun dam olish kuni — dars yo‘q.</p>')
    : `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">${col('DCJ', tdays === 'DCJ')}${col('SPSh', tdays === 'SPSh')}</div>`;
  return `<h2>🗓 Mening jadvalim</h2>${tabsH}${items.length ? body : '<p class="mu">Sizga hali dars jadvali biriktirilmagan.</p>'}`;
}
const V = {
  dash() {
    const d = S.d.dash; if (!d) return '';
    const max = S.set ? S.set.max_group_size : 15;
    const sf = S.d.sf;
    const lvS = (S.subj || []).find((x) => x.slug === sf && x.has_levels), lvf = lvS ? S.d.lvf || '' : '', free = !!S.d.free;
    const gs = d.groups.filter((g) => (sf === 'all' || g.subject === sf) && (!lvf || g.level === lvf) && (!free || g.student_count < max));
    const T = d.stats && d.stats.totals, SS = d.stats && d.stats.subjects;
    const card = (k, v, sub, h, a) => `<div class="card sc" style="--h:${h};${a ? 'cursor:pointer' : ''}" ${a ? `data-a="tab" data-v="${a}"` : ''}><div class="mu">${k}</div><div class="stat">${v}</div><div class="mu">${sub}</div></div>`;
    const tot = T ? `<div class="grid intro">${card("Jami o'quvchilar", T.students, T.nogroup ? `shundan guruhsiz: <b class="st0">${T.nogroup}</b>` : 'hammasi guruhda', 236, can('dash') ? 'stu' : '')}${card('Jami guruhlar', T.groups, `bo'sh o'rinlar: ${T.free_places} · ${T.rooms} ta xona`, 160, can('room') ? 'room' : '')}${card("Jami o'qituvchilar", T.teachers, 'faol xodimlar', 28, can('stf') ? 'stf' : '')}${card('Jami supportlar', T.supports, 'faol xodimlar', 300, can('stf') ? 'stf' : '')}</div>` : '';
    const bars = SS && T ? `<div class="card" style="margin-top:10px"><b>Yo'nalishlar bo'yicha</b>${SS.map((x) => `<div style="margin-top:8px"><div class="row" style="margin:0"><span style="flex:1">${esc(x.name)}</span><span class="mu">${x.groups} guruh · <b>${x.students}</b> o'quvchi</span></div><div class="bar"><i style="width:${T.students ? Math.round((x.students / T.students) * 100) : 0}%;background:var(--ac)"></i></div></div>`).join('')}</div>` : '';
    const stats = d.stats ? `<div class="grid intro" style="margin-top:10px"><div class="card sc"><div class="mu">Jadval to'qnashuvi</div><div class="stat ${d.stats.conflicts ? 'st0' : 'st2'}">${d.stats.conflicts}</div><div class="mu">ustma-ust tushishlar</div></div></div>` : '';
    const conf = d.conflicts && d.conflicts.length ? `<div class="card" style="margin-top:10px;border-color:var(--mid)"><b>⚠ Jadvalda ustma-ust tushishlar</b><div class="mu">Guruh nomini bossangiz, xona/vaqt/o'qituvchini o'zgartirib hal qilasiz. Yangi to'qnashuv qo'shib bo'lmaydi.</div><ul style="margin:6px 0 0;padding-left:18px">${d.conflicts.slice(0, 12).map((c) => { const g = d.groups.find((x) => x.name === c.group); return `<li>${g ? `<a href="#" class="gl" data-a="grp" data-v="${g.id}">${esc(c.group)}</a>` : esc(c.group)}: ${esc(c.message)}</li>`; }).join('')}</ul></div>` : '';
    const al = d.alerts.length ? `<div class="card" style="margin-top:10px;border-color:var(--lo)"><b>🔔 ${S.set ? S.set.alert_threshold : 3} tadan ko'p dars qoldirganlar (${d.alerts.length})</b><div class="mu">Ota-ona bilan bog'lanib, "Davomat" bo'limida izoh yozing.</div><div>${d.alerts.slice(0, 15).map((s) => `<span class="tag">${esc(s.name)} · ${s.absences ?? ''}</span> `).join('')}</div></div>` : '';
    const chips = `<div class="row"><button class="chip ${sf === 'all' ? 'on' : ''}" data-a="sf" data-v="all">Hammasi</button>${(S.subj || []).map((s) => `<button class="chip ${sf === s.slug ? 'on' : ''}" data-a="sf" data-v="${esc(s.slug)}">${esc(s.name)}</button>`).join('')}${lvS ? `<select data-a="lvf" aria-label="Daraja"><option value="">Barcha darajalar</option>${['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((x) => opt(x, x, lvf)).join('')}</select>` : ''}<label class="mu"><input type="checkbox" data-a="free" ${free ? 'checked' : ''}> Faqat bo‘sh joyi bor guruhlar</label></div>`;
    const fillOf = (n) => (n >= max ? ['g', 'st2', 'To‘lgan'] : n >= 10 ? ['g', 'st2', 'Yaxshi'] : n >= 5 ? ['o', 'st1', 'Joy bor'] : ['r', 'st0', 'Kam — qo‘shish kerak']);
    const cards = gs.map((g) => { const [bc, tc, tl] = fillOf(g.student_count); return `<div class="card gc" data-a="grp" data-v="${g.id}"><div class="row" style="margin:0"><b style="flex:1">${esc(g.name)}</b>${g.level ? `<span class="tag">${esc(g.level)}</span>` : ''}</div>
      <div class="mu">${teachersHtml(g)}</div>
      <div class="mu">${g.room ? 'Xona ' + esc(g.room) : 'Xona yo‘q'} · ${DN[g.days] || '—'} · ${timeOf(g)}</div>
      <div class="bar"><i class="${bc}" style="width:${Math.min(100, (g.student_count / max) * 100)}%"></i></div><div class="fl"><b class="${tc}">${g.student_count}/${max}</b> · <span class="${tc}">${tl}</span></div></div>`; }).join('');
    return `${tot}${bars}${stats}${conf}${al}${isT() ? mySched(d) : ''}<h2>${isT() ? 'Guruhlarim' : 'Guruhlar'}</h2>${chips}<div class="grid">${cards || '<p class="mu">Hozircha guruh yo‘q. ' + (can('new') ? '"Yangi" bo‘limidan qo‘shing.' : '') + '</p>'}</div>`;
  },

  att() {
    const a = S.d.att; if (!a) return '';
    const sh = a.sheet, locked = !!(sh && sh.can_edit === false), supLocked = !!(sh && sh.can_edit_support === false);
    const canMark = (S.me.role === 'teacher' || can('att') >= 2) && !locked, canSup = (S.me.role === 'support' || (S.me.role !== 'teacher' && can('att') >= 2)) && !supLocked;
    let body = '<p class="mu">Guruhni tanlang.</p>';
    if (sh) {
      const rows = sh.students.map((s) => {
        const m = a.marks[s.student], sm = (a.smarks || {})[s.student];
        const dis = sh.finalized || !canMark ? 'disabled' : '';
        return `<tr><td>${esc(s.name)}</td><td class="num">${s.absences ? `<span class="tag" style="color:var(--lo)">${s.absences} qoldirgan</span>` : '—'}</td>
        <td><button class="chip ${m === true ? 'on' : ''}" ${dis} data-a="mk" data-v="${s.student}:1">Keldi</button> <button class="chip ${m === false ? 'on' : ''}" style="${m === false ? 'background:var(--lo);border-color:var(--lo)' : ''}" ${dis} data-a="mk" data-v="${s.student}:0">Kelmadi</button></td>${sh.has_support ? `<td><button class="chip ${sm === true ? 'on' : ''}" ${canSup ? '' : 'disabled'} data-a="smk" data-v="${s.student}:1">Keldi</button> <button class="chip ${sm === false ? 'on' : ''}" style="${sm === false ? 'background:var(--lo);border-color:var(--lo)' : ''}" ${canSup ? '' : 'disabled'} data-a="smk" data-v="${s.student}:0">Kelmadi</button></td>` : ''}</tr>`;
      }).join('');
      const lockMsg = locked ? `<div class="card" style="border-color:var(--mid);margin:0 0 8px">🔒 Dars vaqti tugagan${sh.window ? ` (davomat ${sh.window} oralig‘ida belgilanadi)` : ''}. Endi davomatni faqat <b>admin</b> o‘zgartira oladi.</div>` : sh.window && !sh.is_admin && !sh.finalized ? `<div class="mu" style="margin:0 0 6px">⏱ Davomatni ${sh.window} oralig‘ida belgilash va tahrirlash mumkin.</div>` : '';
      body = `${lockMsg}<div class="row"><b>${sh.finalized ? '🔒 Yakunlangan' : 'Ochiq'}</b>${canMark && !sh.finalized ? '<button class="chip" data-a="allpres">Hammasi keldi</button><button class="btn pri" data-a="savemk">Saqlash</button><button class="btn" data-a="finmk">Yakunlash</button>' : ''}${sh.finalized && sh.is_admin ? '<button class="btn" data-a="reopenmk">Qayta ochish</button>' : ''}</div>
      <div class="wrap"><table><tr><th>O'quvchi</th><th>Qoldirgan</th><th>Dars davomati</th>${sh.has_support ? `<th>Support darsi <span class="mu">(${esc((sh.supports || []).join(', '))})</span></th>` : ''}</tr>${rows || '<tr><td colspan="4" class="mu">Guruhda o‘quvchi yo‘q</td></tr>'}</table></div>
      ${sh.has_support && canSup ? '<div class="row"><b>Support darsi:</b><button class="chip" data-a="allsup">Hammasi keldi</button><button class="btn pri" data-a="savesup">Support davomatini saqlash</button></div>' : ''}
      <div class="demo">Yakunlangan davomat o'qituvchi oyligiga hisoblanadi. Dars vaqti o‘tgach faqat admin o‘zgartira oladi.${sh.has_support ? ' Support darsiga kelmaslik “3 tadan ko‘p dars qoldirdi” hisobiga qo‘shilmaydi, support oyligi esa belgilangan summa (o‘quvchi soniga bog‘liq emas).' : ''}</div>`;
    }
    const canCt = S.me.role !== 'teacher' && can('att') >= 2;
    const phones = (s) => `<div class="row" style="margin:4px 0"><span>📞 O‘quvchi: ${s.phone ? `<a href="tel:${esc(s.phone)}"><b>${esc(s.phone)}</b></a>` : '<span class="st0">kiritilmagan</span>'}</span><span>👪 Ota-ona: ${s.parent_phone ? `<a href="tel:${esc(s.parent_phone)}"><b>${esc(s.parent_phone)}</b></a>` : '<span class="st0">kiritilmagan</span>'}</span></div>`;
    const ctForm = (s) => canCt ? `<form data-f="contact" data-id="${s.student}"><div class="row" style="margin:6px 0 0"><input name="note" placeholder="Kim bilan gaplashdingiz va sabab nima? (majburiy)" style="flex:1;min-width:200px" required minlength="3"><button class="btn pri">Bog‘lanildi</button></div></form>` : '<div class="mu">Administrator ota-onaga bog‘lanadi</div>';
    const alerts = a.alerts.length ? `<h2>🔴 ${S.set ? S.set.alert_threshold : 3} tadan ko‘p dars qoldirganlar (${a.alerts.length})</h2>${a.alerts.map((s) => `<div class="card" style="margin:6px 0;border-color:var(--lo)"><b>${esc(s.name)}</b> <span class="mu">${esc((s.groups || []).join(', '))}</span> · <b class="st0">${s.absences} dars qoldirgan</b>${s.last_note ? `<div class="mu">Oxirgi bog‘lanish: ${new Date(s.last_contact_at).toLocaleDateString('uz-UZ')} — “${esc(s.last_note)}”. Shundan keyin yana <b>${s.since_contact}</b> dars qoldirdi.</div>` : ''}${phones(s)}${ctForm(s)}</div>`).join('')}` : '';
    const absent = (a.absent || []).length ? `<h2>📞 Bugun kelmaganlar (${a.absent.length})</h2>${a.absent.map((s) => `<div class="card" style="margin:6px 0"><b>${esc(s.name)}</b> <span class="mu">${esc(s.group)}</span> · <span class="mu">jami ${s.absences} dars qoldirgan</span>${phones(s)}${ctForm(s)}</div>`).join('')}` : '';
    const hist = (a.contacts || []).length ? `<details style="margin-top:10px"><summary class="mu">Bog‘lanilganlar (${a.contacts.length})</summary>${a.contacts.map((c) => `<div class="card" style="margin:6px 0"><b>${esc(c.name)}</b> <span class="mu">${esc((c.groups || []).join(', '))} · ${new Date(c.created_at).toLocaleString('uz-UZ')} · ${esc(c.by)} · ${c.missed_at_time} dars qoldirgan</span><div>📝 ${esc(c.note)}</div></div>`).join('')}</details>` : '';
    return `<div class="row" style="margin:0 0 8px"><label class="mu">Sana <input type="date" data-a="attd" value="${a.date}" max="${today()}"></label></div><div class="grid gcards">${a.groups.slice().sort((x, y) => (x.days || '').localeCompare(y.days || '') || (x.start_time || '').localeCompare(y.start_time || '') || x.name.localeCompare(y.name, undefined, { numeric: true })).map((g) => `<button class="card gcard ${String(a.group) === String(g.id) ? 'on' : ''}" data-a="attc" data-v="${g.id}"><b>${esc(g.name)}</b><span class="mu">${g.days ? DN[g.days] : '—'} · ${timeOf(g)}${g.room ? ' · xona ' + esc(g.room) : ''}</span><span class="mu">${g.student_count} o‘quvchi</span></button>`).join('') || '<p class="mu">Sizga guruh biriktirilmagan.</p>'}</div>${alerts}${absent}<div style="margin-top:10px">${body}</div>${hist}`;
  },

  pay() {
    const p = S.d.pay; if (!p) return '';
    const ed = can('pay') >= 2;
    const mo = `<select data-a="paym">${months().map((m) => opt(m, mname(m), p.month)).join('')}</select>`;
    const tabsH = `<div class="row">${[['list', "O'quvchilar"], ['debt', 'Qarzdorlar'], ['cash', 'Kassa']].map(([k, l]) => `<button class="chip ${p.ps === k ? 'on' : ''}" data-a="pps" data-v="${k}">${l}</button>`).join('')}${mo}</div>`;
    if (p.ps === 'list') {
      const o = p.ov, q = (p.q || '').toLowerCase(), pf = p.pf || 'all';
      const okF = (r) => pf === 'all' || (pf === 'debt' ? r.owe > 0 : pf === 'over' ? r.paid > r.due : r.status === pf);
      const over = p.rows.reduce((a, r) => a + Math.max(0, r.paid - r.due), 0);
      const rows = p.rows.filter((r) => r.due || r.prev_debt).filter((r) => !q || r.name.toLowerCase().includes(q)).filter(okF).map((r) => `<tr class="rw" data-a="pst" data-v="${r.student}"><td><b>${esc(r.name)}</b><div class="mu">${esc(r.groups.join(', '))}</div></td><td class="num">${money(r.due)}${r.discount ? `<div class="mu">chegirma −${money(r.discount)}</div>` : ''}</td><td class="num">${money(r.paid)}</td><td class="num ${r.owe ? 'st0' : ''}">${money(r.owe)}</td><td class="num ${r.prev_debt ? 'st0' : ''}">${r.prev_debt ? money(r.prev_debt) : '—'}</td><td class="st${r.status === 'paid' ? 2 : r.status === 'partial' ? 1 : 0}">${r.status === 'paid' ? "✅ To'langan" : r.status === 'partial' ? '◐ Qisman' : '○ To‘lanmagan'}</td></tr>`).join('');
      return `${tabsH}<div class="grid intro"><div class="card sc"><div class="mu">Reja</div><div class="stat">${money(o.plan)}</div></div><div class="card sc"><div class="mu">To'langan</div><div class="stat st2">${money(o.paid)}</div></div><div class="card sc"><div class="mu">Qolgan qarz</div><div class="stat st0">${money(o.debt)}</div></div><div class="card sc"><div class="mu">Oldingi oylar qarzi</div><div class="stat">${money(o.prev_debt)}</div></div><div class="card sc"><div class="mu">Haqdorlar (ortiqcha to‘langan)</div><div class="stat st2">${money(over)}</div></div></div>
      ${calcCard(p)}
      <div class="row">${[['all', 'Hammasi'], ['debt', 'Qarzdorlar'], ['partial', 'Qisman'], ['paid', 'To‘langan'], ['over', 'Haqdorlar']].map(([k, l]) => `<button class="chip ${pf === k ? 'on' : ''}" data-a="pfl" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="row">${isAdmin() ? '<button class="chip" data-a="newmonth">＋ Yangi oyga o‘tish</button>' : ''}${p.closed ? '<b>🔒 Oy yopilgan</b>' : ''}${ed && !p.closed ? '<button class="btn" data-a="closem">Oyni yakunlash (yopish)</button>' : ''}${p.closed && isAdmin() ? '<button class="btn" data-a="reopenm">Qayta ochish</button>' : ''}<span class="mu">${S.set && S.set.auto_next_month ? '🔁 Yangi oy avtomatik ochiladi' : ''}${S.set && S.set.auto_close_month ? ' · o‘tgan oylar avtomatik yopiladi' : ''}</span><input data-a="payq" placeholder="Qidirish…" value="${esc(p.q || '')}" style="flex:1;min-width:140px"></div>
      <div class="wrap"><table><tr><th>O'quvchi</th><th>To'lov</th><th>To'langan</th><th>Qarz</th><th>Oldingi qarz</th><th>Holat</th></tr>${rows || '<tr><td colspan="6" class="mu">Bu oy uchun to‘lov yo‘q</td></tr>'}</table></div>`;
    }
    if (p.ps === 'debt') {
      const dd = p.debt;
      return `${tabsH}<h2>Qarzdorlar</h2><div class="wrap"><table><tr><th>O'quvchi</th><th>Umumiy qarz</th></tr>${dd.debtors.map((r) => `<tr class="rw" data-a="pst" data-v="${r.student}"><td>${esc(r.name)}</td><td class="num st0">${money(r.debt)}</td></tr>`).join('') || '<tr><td colspan="2" class="mu">Qarzdor yo‘q 🎉</td></tr>'}</table></div>
      ${dd.creditors.length ? `<h2>Avans (ortiqcha to'lov)</h2><div class="wrap"><table>${dd.creditors.map((r) => `<tr><td>${esc(r.name)}</td><td class="num st2">${money(r.credit)}</td></tr>`).join('')}</table></div>` : ''}`;
    }
    const sm = p.sum;
    const form = ed ? `<form class="card fg" data-f="cash" style="margin:10px 0"><label>Turi<select name="kind"><option value="chiqim">Chiqim</option><option value="kirim">Kirim</option></select></label><label>Kategoriya<input name="category" list="cats" required><datalist id="cats">${['Ijara', 'Kommunal', 'Reklama', 'Jihozlar', 'Boshqa'].map((c) => `<option>${c}</option>`).join('')}</datalist></label><label>Summa<input type="number" name="amount" min="1" required></label><label>Sana<input type="date" name="date" value="${today()}" required></label><label>Izoh<input name="note"></label><button class="btn pri">＋ Qo'shish</button></form>` : '';
    return `${tabsH}<div class="grid intro"><div class="card sc"><div class="mu">O'quvchi to'lovlari</div><div class="stat">${money(sm.payments)}</div></div><div class="card sc"><div class="mu">Kirim</div><div class="stat st2">${money(sm.kirim)}</div></div><div class="card sc"><div class="mu">Chiqim</div><div class="stat st0">${money(sm.chiqim)}</div></div><div class="card sc"><div class="mu">Qoldiq</div><div class="stat">${money(sm.balance)}</div></div></div>${form}
    <div class="wrap"><table><tr><th>Sana</th><th>Tur</th><th>Kategoriya</th><th>Summa</th><th>Izoh</th><th></th></tr>${p.cash.map((c) => `<tr><td>${c.date}</td><td>${c.kind}</td><td>${esc(c.category)}</td><td class="num">${money(c.amount)}</td><td>${esc(c.note)}</td><td>${ed && c.category !== 'oylik' ? `<button class="chip" data-a="cashdel" data-v="${c.id}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">Yozuv yo‘q</td></tr>'}</table></div>`;
  },

  sal() {
    const s = S.d.sal; if (!s) return '';
    const mo = `<div class="row"><select data-a="salm">${months().map((m) => opt(m, mname(m), s.month)).join('')}</select></div>`;
    if (isT()) {
      const r = s.me;
      return `${mo}<div class="card" style="max-width:420px"><h2 style="margin-top:0">${mname(s.month)}</h2>${r.rate !== null && r.rate !== undefined ? `<div>Kelgan o‘quvchi-darslar: <b>${Math.round((r.student_days || 0) * 10) / 10}</b> · 1 soatlik dars ulushi: ${money(r.rate)} / oydagi darslar soni</div>` : ''}<div>Hisoblangan: <b>${money(r.accrued)}</b></div><div>To'langan: <b>${money(r.paid)}</b></div><div>Qolgan: <b>${money(r.left)}</b>${r.left < 0 ? ' <span class="mu">(avans oylikdan ko‘p berilgan)</span>' : ''}</div><div class="demo">Davomat saqlanishi bilan oylikka darrov qo‘shiladi.</div></div>`;
    }
    const ed = can('sal') >= 2;
    const gr = isAdmin() ? `<form class="card row" data-f="genrate" style="margin:0 0 10px"><label style="flex:1;min-width:220px"><b>Umumiy ulush</b> <span class="mu">— 1 soatlik dars uchun 1 o‘quvchi/oyiga (standart 75 000; 2 soatlik dars = 150 000). Oydagi darslar soniga (12–13) bo‘linadi, faqat kelgan darslar to‘lanadi</span><input type="number" name="rate" min="0" step="1000" value="${S.set ? S.set.default_rate : 0}" required></label><button class="btn pri">Saqlash</button></form>` : '';
    return `${mo}${gr}<div class="wrap"><table><tr><th>Xodim</th><th>Lavozim</th><th>Kelgan darslar</th><th>1 soat ulushi</th><th>Hisoblangan</th><th>To'langan</th><th>Qolgan</th><th></th></tr>${s.rows.map((r) => `<tr class="rw" data-a="salv" data-v="${r.staff}"><td><b>${esc(r.name)}</b></td><td>${r.role === 'support' ? 'Support' : "O'qituvchi"}</td><td class="num">${r.student_days === null ? '—' : Math.round(r.student_days * 10) / 10}</td><td class="num">${r.rate === null ? '—' : money(r.rate)}</td><td class="num">${money(r.accrued)}</td><td class="num">${money(r.paid)}</td><td class="num ${r.left ? 'st0' : ''}" ${r.left < 0 ? 'title="Avans oylikdan ko‘p berilgan"' : ''}>${money(r.left)}</td><td>${ed && r.left > 0 ? `<button class="chip" data-a="paysal" data-v="${r.staff}">To'lash</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">Xodim yo‘q</td></tr>'}</table></div><div class="demo">Xodim qatorini bossangiz, u haqidagi ma'lumot ochiladi va oylik/stavkani shu yerning o'zida o'zgartirish mumkin.</div>`;
  },

  room() {
    const r = S.d.room; if (!r) return '';
    const eRoom = can('room') >= 2, rooms = roomsOf(r.groups);
    const hrs = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const kidsLen = () => 2;
    const sh = (g) => +g.start_time.slice(0, 2), p2 = (h) => String(h).padStart(2, '0') + ':00';
    const gs = r.groups.filter((g) => g.days === r.days && g.start_time && g.room);
    const sp = (r.sp || []).filter((x) => x.days === r.days), supNames = (id) => (r.groups.find((g) => g.id === id)?.supports || []).map((x) => x.name);
    const spIn = (rm, hh) => sp.filter((x) => x.room === rm && x.hour === hh);
    const cfm = {}; (S.cf || []).forEach((c) => { (cfm[c.group] = cfm[c.group] || []).push(c.message); (cfm[c.with] = cfm[c.with] || []).push(`${c.group}: ${c.message}`); });
    const cell = (room, h) => {
      const hit = gs.filter((g) => g.room === room && h >= sh(g) && h < sh(g) + kidsLen(g));
      if (!hit.length) return `<td class="cellb free">${eRoom ? `<button class="slot" data-a="rslot" data-v="${esc(room)}|${h}" title="Shu vaqtga guruh biriktirish">＋ bo‘sh</button>` : '<span class="mu">bo‘sh</span>'}</td>`;
      return `<td class="cellb ${hit.length > 1 || hit.some((g) => cfm[g.name]) ? 'x' : 'o'}">${hit.map((g) => (h === sh(g)
        ? `<a href="#" class="gl" data-a="rgrp" data-v="${g.id}">${cfm[g.name] ? '⚠ ' : ''}${esc(g.name)}</a>${cfm[g.name] ? `<div class="cfm">${esc(cfm[g.name][0])}</div>` : ''}<div class="tc">${teachersHtml(g)}</div><div class="mu">${g.student_count} o‘quvchi · ${p2(sh(g))}–${p2(sh(g) + kidsLen(g))}</div>`
        : `<a href="#" class="gl cont" data-a="rgrp" data-v="${g.id}">↳ ${esc(g.name)} davomi</a>`)).join('<hr>')}</td>`;
    };
    const rid = (rm) => (S.rooms || []).find((x) => x.name === rm);
    const hourSel = `<select data-a="rhour" aria-label="Soat">${hrs.map((x) => opt(x, p2(x), r.h)).join('')}</select>`;
    const viewT = ['cards', 'grid'].map((k) => `<button class="chip ${r.view === k ? 'on' : ''}" data-a="rview" data-v="${k}">${k === 'cards' ? '▦ Kartalar' : '▤ Haftalik jadval'}</button>`).join('');
    const head = `<div class="row">${['DCJ', 'SPSh'].map((k) => `<button class="chip ${r.days === k ? 'on' : ''}" data-a="rdays" data-v="${k}">${DN[k]}</button>`).join('')}${r.view === 'grid' ? '' : hourSel}${viewT}<span style="flex:1"></span>${eRoom ? `<button class="chip ${r.panel === 'room' ? 'on' : ''}" data-a="rpanel" data-v="room">＋ Xona qo‘shish</button>` : ''}${isAdmin() ? `<button class="chip ${r.panel === 'sub' ? 'on' : ''}" data-a="rpanel" data-v="sub">＋ Fan qo‘shish</button>` : ''}${eRoom && can('stf') >= 1 ? `<button class="chip ${r.panel === 'sup' ? 'on' : ''}" data-a="rpanel" data-v="sup">＋ Support biriktirish</button>` : ''}${can('new') >= 2 ? '<button class="chip" data-a="tab" data-v="new">＋ Guruh</button>' : ''}</div>`;
    const sups = (r.staff || []).filter((u) => u.role === 'support' && !u.archived_at);
    const supPanel = r.panel === 'sup' && eRoom ? `<div class="card" style="margin:0 0 10px"><form class="row" data-f="supadd" style="margin:0"><label style="flex:1;min-width:170px">Guruh<select name="group" required><option value="">— guruh tanlang —</option>${r.groups.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((g) => opt(g.id, `${g.name}${g.room ? ' · xona ' + g.room : ''}${g.supports.length ? ' · ' + g.supports.map((x) => x.name).join('+') : ''}`, '')).join('')}</select></label><label style="flex:1;min-width:170px">Support<select name="support" required><option value="">— support tanlang —</option>${sups.map((u) => opt(u.id, u.full_name || u.username, '')).join('')}</select></label><button class="btn pri">Biriktirish</button></form>${r.groups.some((g) => g.supports.length) ? `<div class="row">${r.groups.filter((g) => g.supports.length).map((g) => g.supports.map((x) => `<span class="tag">${esc(g.name)} · ${esc(x.name)} <a href="#" data-a="supdel" data-v="${g.id}:${x.id}" title="Olib tashlash" style="text-decoration:none">✕</a></span>`).join(' ')).join(' ')}</div>` : ''}</div>` : '';
    const panel0 = r.panel === 'room' && eRoom ? `<form class="card row" data-f="addroom" style="margin:0 0 10px"><label style="flex:1;min-width:160px">Yangi xona raqami/nomi<input name="name" maxlength="10" required placeholder="Masalan: 205"></label><button class="btn pri">Xonani qo‘shish</button></form>`
      : r.panel === 'sub' && isAdmin() ? `<form class="card fg" data-f="addsub" style="margin:0 0 10px"><label>Fan nomi<input name="name" required placeholder="Masalan: Rus tili"></label><label>Kod (lotin, kichik harf)<input name="slug" required pattern="[a-z0-9_\\-]+" placeholder="rus"></label><label>Guruh nomi prefiksi<input name="prefix" placeholder="Rus_"></label><label>Oylik narx (so'm)<input type="number" name="price" value="600000" step="1000" min="0"></label><label><input type="checkbox" name="has_levels"> A1–C2 darajalar bor</label><button class="btn pri">Fanni qo‘shish</button></form>` : '';
    const panel = supPanel || panel0;
    const rowH = (rm) => { const n = r.groups.filter((g) => g.room === rm).length, o = rid(rm); return `<th class="rh">${esc(rm)}<div class="mu">${n} guruh</div>${eRoom && o && !n ? `<button class="chip" data-a="roomdel" data-v="${o.id}" title="Xonani o‘chirish" style="padding:0 6px">✕</button>` : ''}</th>`; };
    const loose = r.groups.filter((g) => !g.room || !g.start_time || !g.days);
    const looseH = loose.length ? `<h2>Jadvali to‘liq emas guruhlar (${loose.length})</h2><div class="row">${loose.map((g) => `<a href="#" class="tag" data-a="rgrp" data-v="${g.id}">${esc(g.name)}</a>`).join('')}</div>` : '';
    const cfl = (S.cf || []).length ? `<div class="card" style="margin:0 0 10px;border-color:var(--mid)"><b>⚠ Ustma-ust tushishlar (${S.cf.length})</b><div class="mu">Guruhni bossangiz, xona/vaqt/o‘qituvchini o‘zgartirib hal qilasiz. Yangi to‘qnashuv qo‘shib bo‘lmaydi.</div><ul style="margin:6px 0 0;padding-left:18px">${S.cf.map((c) => { const g = r.groups.find((x) => x.name === c.group), o = r.groups.find((x) => x.name === c.with); return `<li>${g ? `<a href="#" class="gl" data-a="rgrp" data-v="${g.id}">${esc(c.group)}</a>` : esc(c.group)} ↔ ${o ? `<a href="#" class="gl" data-a="rgrp" data-v="${o.id}">${esc(o.name)}</a>` : esc(c.with)}: ${esc(c.message)}</li>`; }).join('')}</ul></div>` : '<div class="card okm" style="margin:0 0 10px">✅ Jadvalda ustma-ust tushish yo‘q</div>';
    const h = +r.h, hq = p2(h);
    const seg = (g) => {
      const st = sh(g), i = h - st;
      if (!isKidsG(g)) return { kind: 'main', label: 'Asosiy dars · 2 soat', range: `${p2(st)}–${p2(st + 2)}`, who: g.teachers.map((t) => t.name) };
      const eng = g.teachers.find((t) => t.position === 0), mat = g.teachers.find((t) => t.position === 1);
      const seq = g.kids_order === 'E' ? [[eng, 'English'], [mat, 'Math']] : [[mat, 'Math'], [eng, 'English']];
      return { kind: 'main', label: `${seq[i][1]} · 1 soat`, range: `${p2(h)}–${p2(h + 1)}`, who: seq[i][0] ? [seq[i][0].name] : [] };
    };
    const supCard = (x) => `<div style="margin-top:6px"><a href="#" class="gl" data-a="rgrp" data-v="${x.group}">${esc(x.name)}</a> <span class="tag">Support</span><div class="mu">${p2(x.hour)}–${p2(x.hour + 1)}${x.own_room ? ' · guruhning o‘z xonasi' : ' · asosiy xona band — dastur shu xonani topdi'}</div><div class="rw2"><b>${supNames(x.group).map(esc).join(' + ') || '—'}</b></div></div>`;
    const rcard = (rm) => {
      const hit = gs.filter((g) => g.room === rm && h >= sh(g) && h < sh(g) + kidsLen(g)), sin = spIn(rm, h);
      if (!hit.length && sin.length) return `<div class="card rc busy"><div class="row" style="margin:0"><b style="flex:1">Xona ${esc(rm)}</b><span class="tag mid">Support</span></div>${sin.map(supCard).join('<hr>')}</div>`;
      if (!hit.length) return `<div class="card rc free" ${eRoom ? `data-a="rslot" data-v="${esc(rm)}|${h}" style="cursor:pointer" title="Shu vaqtga guruh biriktirish"` : ''}><div class="row" style="margin:0"><b style="flex:1">Xona ${esc(rm)}</b><span class="tag ok">Bo‘sh</span></div><div class="mu">Dars yo‘q${eRoom ? ' · bosib guruh biriktiring' : ''}</div></div>`;
      return `<div class="card rc busy ${hit.length > 1 || hit.some((g) => cfm[g.name]) ? 'cx' : ''}"><div class="row" style="margin:0"><b style="flex:1">Xona ${esc(rm)}</b><span class="tag mid">Band</span></div>${hit.map((g) => { const q = seg(g); return `<div style="margin-top:6px"><a href="#" class="gl" data-a="rgrp" data-v="${g.id}">${cfm[g.name] ? '⚠ ' : ''}${esc(g.name)}</a> ${g.level ? `<span class="tag">${esc(g.level)}</span>` : ''}<div class="mu">${q.label} · ${q.range}</div><div class="rw2"><b>${q.who.length ? q.who.map(esc).join(' + ') : '—'}</b></div></div>`; }).join('<hr>')}${sin.map(supCard).join('')}</div>`;
    };
    const gd = r.groups.filter((g) => g.days === r.days && g.start_time);
    const staffBusy = (u) => {
      for (const g of gd) {
        const x = slotOf(g), ti = x.teachers.indexOf(u.id);
        if (u.role === 'teacher' && ti >= 0) { const w = twin(x, ti); if (h >= w[0] && h < w[1]) return `${g.name}${g.room ? ' · xona ' + g.room : ''} · ${p2(w[0])}–${p2(w[1])}`; }
        if (u.role === 'support' && g.supports.some((y) => y.id === u.id) && h === sh(g) + 2) { const pl = sp.find((x) => x.group === g.id); return `${g.name}${pl && pl.room ? ' · xona ' + pl.room : ''} · ${p2(h)}–${p2(h + 1)}`; }
      }
      return '';
    };
    const people = (r.staff || []).filter((u) => (u.role === 'teacher' || u.role === 'support') && !u.archived_at).sort((a, b) => (a.role === b.role ? 0 : a.role === 'teacher' ? -1 : 1));
    const pcard = (u) => { const b = staffBusy(u); return `<div class="card rc ${b ? 'busy' : 'free'}"><div class="row" style="margin:0"><b style="flex:1">${esc(u.full_name || u.username)}</b><span class="tag ${b ? 'mid' : 'ok'}">${b ? 'Band' : 'Bo‘sh'}</span></div><div class="mu">${u.role === 'support' ? 'Support' : 'O‘qituvchi'} · ${b ? esc(b) : 'hozir dars yo‘q'}</div></div>`; };
    const cardsH = `<h2>🚪 Xonalar · ${DN[r.days]} · ${hq}</h2><div class="grid rcg">${rooms.map(rcard).join('')}</div>${people.length ? `<h2>🧑‍🏫 O‘qituvchi va supportlar · ${hq}</h2><div class="grid rcg">${people.map(pcard).join('')}</div>` : ''}`;
    const tone = (g) => (isKidsG(g) ? 'k' : g.subject === 'math' ? 'm' : g.subject === 'eng' ? 'e' : 'o');
    const laneOf = (list) => { const out = new Map(), ends = []; list.slice().sort((a, b) => sh(a) - sh(b)).forEach((g) => { let l = ends.findIndex((e) => e <= sh(g)); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = sh(g) + kidsLen(g); out.set(g.id, l); }); return [out, Math.max(1, ends.length)]; };
    const blocks = rooms.map((rm, ci) => {
      const list = gs.filter((g) => g.room === rm), [lane, nl] = laneOf(list);
      return list.map((g) => {
        const L0 = lane.get(g.id), bad = !!cfm[g.name], len = kidsLen(g);
        return `<a href="#" class="wkb t-${bad ? 'x' : tone(g)}" data-a="rgrp" data-v="${g.id}" style="grid-column:${ci + 2};grid-row:${sh(g) - 6} / span ${len};width:calc(${100 / nl}% - 6px);margin-left:calc(${(100 / nl) * L0}% + 3px)" title="${esc(g.name)} · ${p2(sh(g))}–${p2(sh(g) + len)}${bad ? ' · to‘qnashuv: ' + esc(cfm[g.name][0]) : ''}"><b>${bad ? '⚠ ' : ''}${esc(g.name)}</b><span class="wkt">${p2(sh(g))}–${p2(sh(g) + len)} · ${g.student_count} o‘q.</span><span class="wkw">${g.teachers.map((t) => esc(t.name)).join(' + ') || '<i>o‘qituvchi yo‘q</i>'}</span></a>`;
      }).join('');
    }).join('');
    const spBlocks = sp.filter((x) => x.room && rooms.includes(x.room) && x.hour >= 8 && x.hour <= 18).map((x) => `<a href="#" class="wkb t-s" data-a="rgrp" data-v="${x.group}" style="grid-column:${rooms.indexOf(x.room) + 2};grid-row:${x.hour - 6}" title="Support · ${esc(x.name)} · ${p2(x.hour)}–${p2(x.hour + 1)}"><b>Support · ${esc(x.name)}</b><span class="wkt">${p2(x.hour)}–${p2(x.hour + 1)}${x.own_room ? '' : ' · boshqa xona'}</span><span class="wkw">${supNames(x.group).map(esc).join(' + ')}</span></a>`).join('');
    const noRoom = sp.filter((x) => !x.room);
    const bg = hrs.map((x, ri) => rooms.map((rm, ci) => { const busy = gs.some((g) => g.room === rm && x >= sh(g) && x < sh(g) + kidsLen(g)) || spIn(rm, x).length > 0; return busy || !eRoom ? `<div class="wkc" style="grid-column:${ci + 2};grid-row:${ri + 2}"></div>` : `<button class="wkc add" data-a="rslot" data-v="${esc(rm)}|${x}" title="Xona ${esc(rm)} · ${p2(x)} — guruh biriktirish" style="grid-column:${ci + 2};grid-row:${ri + 2}">＋</button>`; }).join('')).join('');
    const tableH = `<div class="wkw3"><div class="wk" style="grid-template-columns:62px repeat(${rooms.length},minmax(190px,1fr));grid-template-rows:46px repeat(${hrs.length},68px)"><div class="wkh corner">${DN[r.days]}</div>${rooms.map((rm, ci) => `<div class="wkh" style="grid-column:${ci + 2};grid-row:1">Xona ${esc(rm)}<small>${r.groups.filter((g) => g.room === rm).length} guruh</small>${eRoom && rid(rm) && !r.groups.some((g) => g.room === rm) ? `<button class="chip" data-a="roomdel" data-v="${rid(rm).id}" title="Xonani o‘chirish" style="padding:0 6px">✕</button>` : ''}</div>`).join('')}${hrs.map((x, ri) => `<div class="wkt0" style="grid-row:${ri + 2}">${p2(x)}</div>`).join('')}${bg}${blocks}${spBlocks}</div></div>${noRoom.length ? `<div class="card msg err">⚠ Support uchun bo‘sh xona topilmadi: ${noRoom.map((x) => `${esc(x.name)} (${p2(x.hour)})`).join(', ')}. Xona qo‘shing yoki vaqtni o‘zgartiring.</div>` : ''}<div class="demo"><span class="lgd k"></span> Kids <span class="lgd m"></span> Matematika <span class="lgd e"></span> English <span class="lgd x"></span> to‘qnashuv · bo‘sh katakdagi <b>＋</b> ni bossangiz shu vaqtga guruh biriktirasiz · blokni bossangiz tahrirlash oynasi ochiladi. <span class="lgd s"></span> Support (1 soat, asosiy darsdan keyin; bo‘sh xonani dastur o‘zi topadi). Asosiy dars hammasida 2 soat; Kids’da 1 soat Math + 1 soat English, Kids1/Kids2 almashadi.</div>`;
    return `${head}${panel}${cfl}${r.view === 'grid' ? tableH : cardsH}${looseH}`;
  },

  stf() {
    const s = S.d.stf; if (!s) return '';
    const ed = can('stf') >= 2, sal = can('sal') >= 1;
    const form = ed ? `<form class="card fg" data-f="addstaff" style="margin-bottom:10px"><label>Lavozim<select name="role" data-a="rolesel"><option value="teacher">O'qituvchi</option><option value="support">Support teacher</option>${isAdmin() ? '<option value="administrator">O‘quv markaz administratori</option><option value="bugalter">Bugalter</option>' : ''}</select></label>
    <label>F.I.Sh<input name="full_name" required></label><label>Login<input name="username" autocapitalize="none" required></label>
    <label>Yo'nalish<select name="category"><option value="">—</option>${subjOpts('')}</select></label><label>Telefon<input name="phone" type="tel"></label><label>Tuman<input name="district" list="tmn"></label><label>Ishga kirgan<input name="work_from" type="date" value="${today()}"></label><label style="grid-column:1/-1">Tavsif (tajriba, izoh — ixtiyoriy)<textarea name="description" rows="2" maxlength="2000"></textarea></label>
    ${can('sal') >= 2 ? `<label>Ulush (1 soatlik dars, 1 o'quvchi/oyiga) yoki support oyligi<input name="pay" type="number" step="1000" min="0"></label>` : ''}
    ${pwField('password', 'Parol (kamida 8 belgi, katta-kichik harf, raqam)')}<button type="button" class="chip" data-a="genpw">🔑 Parol yaratish</button><button class="btn pri">＋ Qo'shish</button></form>` : '';
    const sq = (s.q || '').toLowerCase();
    const rows = s.staff.filter((u) => (!s.rf || u.role === s.rf) && (!s.cat || u.category === s.cat) && (!sq || [u.full_name, u.username, u.phone].some((x) => (x || '').toLowerCase().includes(sq)))).map((u) => `<tr class="rw" data-a="stview" data-v="${u.id}"><td><b>${esc(u.full_name || u.username)}</b>${u.archived_at ? ' <span class="tag">arxiv</span>' : ''}</td><td>${esc(u.username)}</td><td>${ROLE[u.role]}</td><td>${esc(u.category || '—')}</td><td>${esc(u.phone || '—')}</td>${sal ? `<td class="num">${u.role === 'support' ? money(u.monthly_salary) + '/oy' : u.rate ? money(u.rate) : 'umumiy'}</td>` : ''}<td>${ed ? `<button class="chip" data-a="stedit" data-v="${u.id}">Tahrirlash</button> ${isAdmin() && u.role !== 'admin' && !u.archived_at ? `<button class="chip" data-a="stnewpw" data-v="${u.id}" title="Yangi parol yaratish">🔑</button><button class="chip" data-a="imp" data-v="${u.id}" title="Shu xodim nomidan ko‘rish">👁</button> ` : ''}${isAdmin() && u.role !== 'admin' ? `<button class="chip" data-a="stperm" data-v="${u.id}">🔐 Ruxsatlar</button> ` : ''}${u.archived_at ? `<button class="chip" data-a="strest" data-v="${u.id}">Qaytarish</button>` : u.id !== S.me.id ? `<button class="chip" data-a="starch" data-v="${u.id}">Arxivlash</button>` : ''}` : ''}</td></tr>`).join('');
    return `${form}<div class="row"><input data-a="stfq" placeholder="Ism, login yoki telefon…" value="${esc(s.q || '')}" style="flex:1;min-width:160px">${[['', 'Hammasi'], ['teacher', "O'qituvchilar"], ['support', 'Supportlar'], ['administrator', 'Administratorlar'], ['bugalter', 'Bugalterlar']].map(([k, l]) => `<button class="chip ${(s.rf || '') === k ? 'on' : ''}" data-a="stfr" data-v="${k}">${l}</button>`).join('')}<select data-a="stfc"><option value="">Barcha yo‘nalishlar</option>${subjOpts(s.cat || '')}</select><label class="mu"><input type="checkbox" data-a="starchv" ${s.arch ? 'checked' : ''}> Arxivdagilarni ham ko'rsatish</label></div><div class="wrap"><table><tr><th>Xodim</th><th>Login</th><th>Lavozim</th><th>Yo'nalish</th><th>Telefon</th>${sal ? '<th>Stavka / oylik</th>' : ''}<th></th></tr>${rows}</table></div><div class="demo">Xodim qatorini bossangiz, u haqidagi to'liq ma'lumot (tavsif, guruhlari) ochiladi. Parollar xavfsizlik uchun hech qachon ko'rsatilmaydi — faqat yangisini belgilash mumkin.</div>`;
  },

  new() {
    const n = S.d.new; if (!n) return '';
    const sf = addStuForm(n.groups);
    const gf = can('room') >= 2 ? `<form class="card fg" data-f="addgrp"><h2 style="grid-column:1/-1;margin:0">＋ Yangi guruh</h2><label>Nomi<input name="name" required placeholder="Mat_6 / E11_A2 / Kids_uz9"></label><label>Yo'nalish<select name="subject">${subjOpts('')}</select></label><label>Daraja (English)<select name="level"><option value="">—</option>${LV.map((l) => `<option>${l}</option>`).join('')}</select></label><label>Xona${roomSel('', n.groups)}</label><label>Kunlar<select name="days"><option value="">—</option>${Object.entries(DN).map(([k, v]) => opt(k, v, '')).join('')}</select></label><label>Boshlanish<select name="start_time"><option value="">—</option>${HOURS.map((h) => `<option>${h}</option>`).join('')}</select></label><button class="btn pri">Guruh yaratish</button><div class="mu" style="grid-column:1/-1">Xona yoki o'qituvchi band bo'lsa, tizim bo'sh variantlarni taklif qiladi.</div></form>` : '';
    return sf + gf;
  },

  stu() {
    const s = S.d.stu; if (!s) return '';
    const ed = can('new') >= 2, dbt = s.debt;
    const filters = `<div class="row"><input data-a="stuq" placeholder="Ism yoki telefon bo‘yicha qidirish…" value="${esc(s.q || '')}" style="flex:1;min-width:180px"><select data-a="stusub"><option value="">Barcha yo‘nalishlar</option>${subjOpts(s.subject)}</select><button class="chip ${s.f === 'all' ? 'on' : ''}" data-a="stuf" data-v="all">Hammasi</button><button class="chip ${s.f === 'nogroup' ? 'on' : ''}" data-a="stuf" data-v="nogroup">Guruhsiz</button></div>`;
    const rows = s.students.map((x) => `<tr class="rw" data-a="stv" data-v="${x.id}"><td><b>${esc(x.full_name)}</b><div class="mu">${esc(x.phone || '')}${x.parent_phone ? ` · ota-ona: ${esc(x.parent_phone)}` : ''}</div></td><td>${esc(x.district || '—')}</td><td>${esc(x.class_name || '—')}</td><td>${x.groups.map((g) => `<span class="tag">${esc(g.name)}</span>`).join(' ') || '<span class="mu">guruhsiz</span>'}</td><td class="num">${x.absences ? `<span class="tag" style="color:var(--lo)">${x.absences}</span>` : '—'}</td>${dbt ? `<td class="num ${dbt[x.id] ? 'st0' : ''}">${dbt[x.id] ? money(dbt[x.id]) : '—'}</td>` : ''}</tr>`).join('');
    return `${ed ? addStuForm(s.groups) : ''}<h2 style="margin-top:0">O'quvchilar <span class="mu">(${s.students.length})</span></h2>${filters}<div class="wrap"><table><tr><th>O'quvchi</th><th>Tuman</th><th>Sinf</th><th>Guruhlari</th><th>Qoldirgan</th>${dbt ? '<th>Qarz</th>' : ''}</tr>${rows || '<tr><td colspan="6" class="mu">O‘quvchi topilmadi</td></tr>'}</table></div><div class="demo">O'quvchi qatorini bossangiz, uning ma'lumotlari ochiladi: tahrirlash, guruhga biriktirish, ota-ona bilan aloqa tarixi${dbt ? " va to'lovlari" : ''}.</div>`;
  },

  arch() {
    const a = S.d.arch; if (!a) return '';
    const ED = can('arch') >= 2, SL = { left: 'Ketgan', paused: "To'xtatilgan", later: 'Keyin boshlaydi', rejected: 'Rad etdi' };
    const chips = `<div class="row">${[['all', 'Hammasi'], ...Object.entries(SL)].map(([k, l]) => `<button class="chip ${a.f === k ? 'on' : ''}" data-a="archf" data-v="${k}">${l} <span class="mu">${k === 'all' ? a.students.length : a.students.filter((x) => x.status === k).length}</span></button>`).join('')}</div>`;
    const stf = a.staff && a.staff.length ? `<h2>Xodimlar arxivi <span class="mu">(${a.staff.length})</span></h2><div class="wrap"><table><tr><th>Xodim</th><th>Lavozim</th><th>Arxivga o‘tgan</th><th></th></tr>${a.staff.map((u) => `<tr><td><b>${esc(u.full_name || u.username)}</b><div class="mu">${esc(u.phone || '')}</div></td><td>${esc(ROLE[u.role] || u.role)}</td><td class="num">${new Date(u.archived_at).toLocaleDateString('uz-UZ')}</td><td>${can('stf') >= 2 ? `<button class="chip" data-a="starest" data-v="${u.id}">Qaytarish</button>` : ''}${isAdmin() ? ` <button class="chip" data-a="stdel" data-v="${u.id}" data-w="arch" title="Butunlay o‘chirish">🗑 O‘chirish</button>` : ''}</td></tr>`).join('')}</table></div>` : '';
    return `<h2 style="margin-top:0">Arxiv</h2>${chips}<div class="wrap"><table><tr><th>O'quvchi</th><th>Holat</th><th>Sabab</th><th>Boshlanish</th><th></th></tr>${a.students.filter((s) => a.f === 'all' || s.status === a.f).map((s) => `<tr><td><b>${esc(s.full_name)}</b><div class="mu">${esc(s.phone || '')}</div></td><td>${SL[s.status] || s.status}</td><td>${esc(s.archive_reason || '—')}</td><td>${s.archive_start || '—'}</td><td>${ED ? `<form data-f="restore" data-id="${s.id}" class="row" style="margin:0"><select name="group"><option value="">Guruhsiz</option>${a.groups.map((g) => opt(g.id, g.name, '')).join('')}</select><button class="chip">Faollashtirish</button><button type="button" class="chip" data-a="studel" data-v="${s.id}" title="Butunlay o‘chirish">🗑</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">Arxiv bo‘sh</td></tr>'}</table></div>${stf}`;
  },

  bak() {
    const b = S.d.bak; if (!b) return '';
    const sz = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
    return `<h2 style="margin-top:0">Zaxira (backup)</h2><div class="row"><button class="btn pri" data-a="bakmk">💾 Hozir zaxira olish</button><span class="mu">Butun baza (o‘quvchilar, guruhlar, to‘lovlar, davomat, xodimlar) bitta faylga saqlanadi.</span></div>
    <div class="wrap"><table><tr><th>Fayl</th><th>Sana</th><th>Hajmi</th><th></th></tr>${b.list.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.safety ? ' <span class="tag">tiklashdan oldingi</span>' : ''}</td><td class="num">${new Date(x.created).toLocaleString('uz-UZ')}</td><td class="num">${sz(x.size)}</td><td><button class="chip" data-a="bakdl" data-v="${esc(x.name)}">⬇ Yuklab olish</button> <button class="chip" data-a="bakrest" data-v="${esc(x.name)}">♻ Tiklash</button></td></tr>`).join('') || '<tr><td colspan="4" class="mu">Hali zaxira yo‘q</td></tr>'}</table></div>
    <div class="demo">Tiklashdan oldin tizim joriy holatni avtomatik saqlaydi. Tiklash barcha hozirgi ma’lumotlarni tanlangan zaxira holatiga qaytaradi.</div>`;
  },

  log() {
    const l = S.d.log; if (!l) return '';
    return `<h2 style="margin-top:0">Tarix (kim, nima, qachon)</h2><div class="wrap"><table><tr><th>Vaqt</th><th>Foydalanuvchi</th><th>Amal</th><th>Obyekt</th><th>Tafsilot</th><th>IP</th></tr>${l.map((x) => `<tr><td class="num">${new Date(x.created_at).toLocaleString('uz-UZ')}</td><td>${esc(x.username)}</td><td>${esc(x.action)}</td><td>${esc(x.target)}</td><td>${esc(x.detail)}</td><td>${esc(x.ip || '')}</td></tr>`).join('')}</table></div>`;
  },

  set() {
    const st = S.d.set; if (!st) return '';
    const tabs = [['gen', 'Umumiy'], ['subj', 'Fanlar (yo‘nalishlar)'], ['perm', 'Akkauntlar va ruxsatlar']];
    const head = `<div class="row">${tabs.map(([k, l]) => `<button class="chip ${st.tab === k ? 'on' : ''}" data-a="settab" data-v="${k}">${l}</button>`).join('')}</div>`;
    if (st.tab === 'subj') {
      const rows = S.subj.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.is_active ? '' : ' <span class="tag">nofaol</span>'}</td><td>${esc(x.slug)}</td><td>${esc(x.prefix || '—')}</td><td class="num">${money(x.price)}</td><td>${x.has_levels ? 'A1–C2' : '—'}</td><td>${x.is_kids ? '1+1+1 soat' : '—'}</td><td><button class="chip" data-a="subedit" data-v="${x.id}">Tahrirlash</button></td></tr>`).join('');
      return `${head}<div class="wrap"><table><tr><th>Fan</th><th>Kod</th><th>Guruh prefiksi</th><th>Oylik narx</th><th>Daraja</th><th>Turi</th><th></th></tr>${rows}</table></div>
      <form class="card fg" data-f="addsub" style="margin-top:10px"><h2 style="grid-column:1/-1;margin:0">＋ Yangi fan qo'shish</h2><label>Nomi<input name="name" required placeholder="Masalan: Rus tili"></label><label>Kod (lotin, kichik harf)<input name="slug" required pattern="[a-z0-9_\\-]+" placeholder="rus"></label><label>Guruh nomi prefiksi<input name="prefix" placeholder="Rus_"></label><label>Oylik narx (so'm)<input type="number" name="price" value="600000" step="1000" min="0"></label><label><input type="checkbox" name="has_levels"> A1–C2 darajalar bor</label><button class="btn pri">＋ Fan qo'shish</button></form>
      <div class="demo">Yangi fan qo'shilgach, "Yangi" bo'limidan shu fan bo'yicha guruh yaratish mumkin. Guruhi bor fanni o'chirib bo'lmaydi — nofaol qiling.</div>`;
    }
    if (st.tab === 'perm') {
      const accs = (st.staff || []).filter((u) => u.role === 'administrator' || u.role === 'bugalter');
      const LV = [['0', "Yo'q"], ['1', "Ko'rish"], ['2', "O'zgartirish"]];
      const isArc = (u) => !u.is_active || !!u.archived_at;
      const mkRow = (u) => `<form class="card" data-f="permsave" data-id="${u.id}" style="margin:8px 0"><div class="row" style="margin:0"><b style="flex:1">${esc(u.full_name || u.username)} <span class="tag">${ROLE[u.role]}</span> <span class="mu">${esc(u.username)}</span>${u.is_active ? '' : ' <span class="tag">arxiv</span>'}</b></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-top:8px">${SECS.map(([k, l]) => `<label class="mu">${l}<select name="perm_${k}" style="width:100%">${LV.map(([v, t]) => opt(v, t, u.perms && k in u.perms ? u.perms[k] : (DEFP[u.role] || {})[k] ?? 0)).join('')}</select></label>`).join('')}</div>
        <div class="row">${pwField('password', 'Yangi parol (ixtiyoriy)')}<button type="button" class="chip" data-a="genpw">🔑</button><button class="btn pri">Saqlash</button>${u.is_active ? `<button type="button" class="chip" data-a="starch2" data-v="${u.id}">Arxivlash</button>` : `<button type="button" class="chip" data-a="strest2" data-v="${u.id}">Qaytarish</button>${isAdmin() ? `<button type="button" class="chip" data-a="stdel" data-v="${u.id}" data-w="set">🗑 O‘chirish</button>` : ''}`}</div></form>`;
      const arcL = accs.filter(isArc), rows = accs.filter((u) => !isArc(u)).map(mkRow).join('') + (arcL.length ? `<details class="card" style="margin:10px 0"><summary><b>🗄 Arxivdagi akkauntlar (${arcL.length})</b> <span class="mu">— tizimga kira olmaydi, asosiy ro‘yxatda ko‘rinmaydi</span></summary>${arcL.map(mkRow).join('')}</details>` : '');
      return `${head}<p class="mu">Har bir boshqaruv akkaunti uchun qaysi bo'limni <b>ko'rishi</b> va qaysi bo'limni <b>o'zgartirishi</b> mumkinligini belgilang. Tarix va Sozlamalar faqat adminga. O'qituvchilar qat'iy qoidada: faqat o'z guruhlari, davomat va o'z oyligi.</p>${rows || '<p class="mu">Hozircha administrator/bugalter akkaunti yo‘q. Quyida yarating.</p>'}
      <form class="card fg" data-f="addstaff" style="margin-top:10px"><h2 style="grid-column:1/-1;margin:0">＋ Yangi boshqaruv akkaunti</h2><label>Lavozim<select name="role"><option value="administrator">O'quv markaz administratori</option><option value="bugalter">Bugalter</option></select></label><label>F.I.Sh<input name="full_name" required></label><label>Login<input name="username" autocapitalize="none" required></label>${pwField('password', 'Parol')}<button type="button" class="chip" data-a="genpw">🔑 Parol yaratish</button><button class="btn pri">＋ Yaratish</button><div class="mu" style="grid-column:1/-1">Standart ruxsatlar lavozimga qarab qo'yiladi, keyin yuqoridan o'zgartirasiz.</div></form>`;
    }
    const s = S.set;
    return `${head}<form class="card fg" data-f="setsave"><h2 style="grid-column:1/-1;margin:0">Umumiy sozlamalar</h2><label>Guruhdagi maksimum o'quvchi<input type="number" name="max_group_size" min="1" max="60" value="${s.max_group_size}"></label><label>Standart ulush (1 soatlik dars, 1 o'quvchi/oyiga), so'm<input type="number" name="default_rate" min="0" step="1000" value="${s.default_rate}"></label><label>Guruhsiz o'quvchi oylik narxi<input type="number" name="default_price" min="0" step="1000" value="${s.default_price}"></label><label>O'quv yili boshlanishi (YYYY-MM)<input name="academic_start" pattern="\\d{4}-\\d{2}" value="${esc(s.academic_start)}"></label><label>Oylar soni<input type="number" name="academic_months" min="1" max="24" value="${s.academic_months}"></label>
      <h2 style="grid-column:1/-1;margin:10px 0 0">Davomat va oylar</h2><label>Necha darsdan ko‘p qoldirsa ota-ona bilan bog‘lanish kerak<input type="number" name="alert_threshold" min="1" max="30" value="${s.alert_threshold}"></label>
      <label class="chip" style="align-self:end"><input type="checkbox" name="auto_next_month" ${s.auto_next_month ? 'checked' : ''}> Oy tugasa yangi oy avtomatik ochilsin</label><label class="chip" style="align-self:end"><input type="checkbox" name="auto_close_month" ${s.auto_close_month ? 'checked' : ''}> O‘tgan oylar (davomati yakunlangan bo‘lsa) avtomatik yopilsin</label><button class="btn pri">Saqlash</button></form>`;
  },
};

/* ---------- modal ---------- */
function modalH() {
  const m = S.mo; if (!m) return '';
  const shell = (title, body, wide) => `<div class="modal" data-a="close"><div class="mb" data-a="stop" style="${wide ? 'max-width:760px' : 'max-width:460px'}" role="dialog" aria-modal="true"><div class="row" style="margin-top:0"><h2 style="margin:0;flex:1">${title}</h2>${m.force ? '' : '<button class="btn" data-a="close" aria-label="Yopish">✕</button>'}</div>${body}</div></div>`;
  if (m.t === 'pw') {
    return shell(m.force ? 'Parolni almashtiring' : 'Parolni o‘zgartirish', `${m.force ? '<p class="mu">Xavfsizlik uchun birinchi kirishda parolni yangilang.</p>' : ''}${S.msg && S.msg.t === 'err' ? `<div class="lo">${esc(S.msg.m)}</div>` : ''}<form data-f="chpw" class="fg" style="grid-template-columns:1fr">${pwField('old_password', 'Joriy parol', 'current-password')}${pwField('new_password', 'Yangi parol')}<div class="mu">Kamida 8 belgi: katta va kichik harf hamda raqam.</div><button class="btn pri">Saqlash</button></form>`);
  }
  if (m.t === 'npw') return shell('Yangi parol', `<p>${esc(m.u.full_name || m.u.username)} uchun yangi parol:</p><div class="card" style="font-size:20px;letter-spacing:1px;user-select:all"><b>${esc(m.pw)}</b></div><p class="mu">Login: <b>${esc(m.u.username)}</b>. Parolni hozir nusxalab oling — keyin ko‘rsatilmaydi. Xodim birinchi kirishda uni o‘zgartiradi.</p><div class="row"><button class="btn pri" data-a="close">Tushunarli</button></div>`);
  if (m.t === 'grp') return groupModal(m, shell);
  if (m.t === 'pst') return payModal(m, shell);
  if (m.t === 'st') return staffModal(m, shell);
  if (m.t === 'stv') return staffView(m, shell);
  if (m.t === 'sv') return salaryModal(m, shell);
  if (m.t === 'perm') return permModal(m, shell);
  if (m.t === 'slot') return slotModal(m, shell);
  if (m.t === 'stm') return studentModal(m, shell);
  if (m.t === 'sub') return shell(esc(m.x.name), `<form data-f="subsave" data-id="${m.x.id}" class="fg" style="grid-template-columns:1fr 1fr"><label>Nomi<input name="name" value="${esc(m.x.name)}" required></label><label>Guruh prefiksi<input name="prefix" value="${esc(m.x.prefix)}"></label><label>Oylik narx<input type="number" name="price" value="${m.x.price}" step="1000" min="0"></label><label>Kod<input value="${esc(m.x.slug)}" disabled></label><label><input type="checkbox" name="has_levels" ${m.x.has_levels ? 'checked' : ''}> A1–C2 darajalar bor</label><label><input type="checkbox" name="is_active" ${m.x.is_active ? 'checked' : ''}> Faol</label><button class="btn pri" style="grid-column:1/-1">Saqlash</button></form><div class="row"><button class="chip" data-a="subdel" data-v="${m.x.id}">Fanni o‘chirish</button></div>`);
  return '';
}

function groupModal(m, shell) {
  const g = m.g, st = m.students || [];
  const isKids = (S.subj || []).find((s) => s.slug === g.subject)?.is_kids;
  const hasLv = (S.subj || []).find((s) => s.slug === g.subject)?.has_levels;
  const eRoom = can('room') >= 2, eNew = can('new') >= 2, eArch = can('arch') >= 2, eStf = can('stf') >= 2;
  const sug = m.sug && m.sug.length ? `<div class="sug">${m.sug.map((x) => `<button type="button" class="chip" data-a="applysug" data-v="${esc(x.room)}|${esc(x.time)}">Xona ${esc(x.room)} · ${esc(x.time)}</button>`).join('')}</div>` : '';
  const mine = (S.cf || []).filter((c) => c.group === g.name || c.with === g.name);
  const cfn = mine.length ? `<div class="card" style="border-color:var(--mid);margin:0 0 8px"><b>⚠ Bu guruhda ustma-ust tushish bor</b><ul style="margin:4px 0 0;padding-left:18px">${mine.map((c) => `<li>${esc(c.group === g.name ? c.message : `${c.group}: ${c.message}`)}</li>`).join('')}</ul><div class="mu">Xona, vaqt yoki o‘qituvchini o‘zgartiring — tizim faqat to‘qnashuvsiz variantni saqlaydi.</div></div>` : '';
  const err = (m.err ? `<div class="card msg err">${m.err.map(esc).join('<br>')}</div>${sug}` : '') + cfn;
  const dr = m.draft || {}, dv = (k, d) => (k in dr ? dr[k] : d);
  const cur = { room: dv('room', g.room), days: dv('days', g.days), start: dv('start_time', hhmm(g.start_time)), order: dv('kids_order', g.kids_order) };
  const oth = othersOf(m.all || [g], g.id);
  const base = slotOf(g, { days: cur.days, hour: cur.start ? +cur.start.slice(0, 2) : null, room: cur.room, order: cur.order });
  const roomOpts = roomsOf(m.all || [g]).map((r) => busyOpt(r, 'Xona ' + r, cur.room, roomBy(base, r, oth))).join('');
  const hourOpts = HOURS.map((h) => { const c = { ...base, hour: +h.slice(0, 2) }; const by = roomBy(c, cur.room, oth) || (c.teachers.map((t, i) => teacherBy(c, t, i, oth)).find(Boolean) ? 'o‘qituvchi band' : ''); return busyOpt(h, h, cur.start, by); }).join('');
  const sched = eRoom ? `<form data-f="gsched" class="fg" style="margin:8px 0"><label>Xona<select name="room" data-a="gsf"><option value="">— xona tanlang —</option>${roomOpts}</select></label><label>Kunlar<select name="days" data-a="gsf"><option value="">—</option>${Object.entries(DN).map(([k, v]) => opt(k, v, cur.days)).join('')}</select></label><label>Boshlanish<select name="start_time" data-a="gsf"><option value="">—</option>${hourOpts}</select></label>${isKids ? `<label>Kids tartibi (faqat shu guruh)<select name="kids_order" data-a="gsf">${opt('M', 'Math → English', cur.order)}${opt('E', 'English → Math', cur.order)}</select></label>` : ''}${hasLv ? `<label>Daraja<select name="level" data-a="gsf"><option value="">—</option>${LV.map((l) => opt(l, l, dv('level', g.level))).join('')}</select></label>` : ''}<button class="btn pri">Jadvalni saqlash</button></form><div class="mu">“band” deb belgilangan xona, vaqt yoki o‘qituvchi tanlab bo‘lmaydi — shu vaqtda boshqa guruh bor.</div>` : `<div class="mu">${g.room ? 'Xona ' + esc(g.room) : ''} · ${DN[g.days] || '—'} · ${timeOf(g)}</div>`;
  const td = m.tdraft || {};
  const tch = eStf && m.staff ? `<form data-f="gteach" class="fg" style="margin:8px 0"><label>${isKids ? 'English o‘qituvchisi' : 'O‘qituvchi'}<select name="t0"><option value="">—</option>${m.staff.teachers.map((u) => busyOpt(u.id, u.full_name || u.username, td.t0 ?? g.teachers[0]?.id, teacherBy(base, u.id, 0, oth))).join('')}</select></label>${isKids ? `<label>Math o‘qituvchisi<select name="t1"><option value="">—</option>${m.staff.teachers.map((u) => busyOpt(u.id, u.full_name || u.username, td.t1 ?? g.teachers[1]?.id, teacherBy(base, u.id, 1, oth))).join('')}</select></label>` : ''}<button class="btn pri">O‘qituvchini saqlash</button></form>${isKids ? `<div class="mu">Dars tartibi: ${teachersHtml(g)}. Kids tartibi faqat shu guruhga ta'sir qiladi, boshqa guruhlar o'zgarmaydi.</div>` : ''}
    ${g.supports.length && g.start_time ? `<div class="mu" style="margin:4px 0">Support darsi: <b>${hhmm(`${String(+g.start_time.slice(0, 2) + 2).padStart(2, '0')}:00`)}–${String(+g.start_time.slice(0, 2) + 3).padStart(2, '0')}:00</b>${(() => { const pl = ((S.d.room && S.d.room.sp) || []).find((x) => x.group === g.id); return pl ? (pl.room ? ` · xona ${esc(pl.room)}${pl.own_room ? '' : ' (guruh xonasi band — dastur topdi)'}` : ' · bo‘sh xona topilmadi') : ''; })()}</div>` : ''}
    ${true ? `<form data-f="gsup" class="row"><span class="mu">Support:</span>${m.staff.supports.map((u) => `<label class="mu"><input type="checkbox" name="s" value="${u.id}" ${g.supports.some((x) => x.id === u.id) ? 'checked' : ''}> ${esc(u.full_name || u.username)}</label>`).join('') || '<span class="mu">support yo‘q</span>'}<button class="chip">Saqlash</button></form>` : ''}` : `<div>${teachersHtml(g)}</div>`;
  const rows = st.map((s) => `<tr><td>${esc(s.full_name)}<div class="mu">${esc(s.phone || '')}${s.parent_phone ? ` · ota-ona: ${esc(s.parent_phone)}` : ''}</div></td><td class="num">${s.absences ? `<span class="tag" style="color:var(--lo)">${s.absences}</span>` : '—'}</td><td>${eNew ? `<button class="chip" data-a="unenr" data-v="${s.id}">Guruhdan chiqarish</button>` : ''} ${eArch ? `<button class="chip" data-a="archform" data-v="${s.id}">Arxivga</button>` : ''}</td></tr>${m.arch === s.id ? `<tr><td colspan="3"><form data-f="archstu" data-id="${s.id}" class="row" style="margin:0"><select name="status"><option value="left">Ketgan</option><option value="paused">To'xtatilgan</option><option value="later">Keyin boshlaydi</option><option value="rejected">Rad etdi</option></select><input name="reason" placeholder="Sabab"><input type="date" name="start" title="'Keyin boshlaydi' uchun sana"><button class="btn pri">Arxivga o'tkazish</button></form></td></tr>` : ''}`).join('');
  const add = eNew ? `<form data-f="findstu" class="row"><input name="q" placeholder="Mavjud o‘quvchini qidirib qo‘shish…" style="flex:1"><button class="chip">Qidirish</button></form>${(m.found || []).map((s) => `<div class="row" style="margin:2px 0"><span style="flex:1">${esc(s.full_name)} <span class="mu">${s.groups.map((x) => esc(x.name)).join(', ')}</span></span><button class="chip" data-a="enr" data-v="${s.id}">＋ Qo'shish</button></div>`).join('')}` : '';
  const del = eRoom && !st.length ? '<div class="row"><button class="chip" data-a="grpdel">Guruhni o‘chirish</button></div>' : '';
  return shell(`${esc(g.name)} ${g.level ? `<span class="tag">${esc(g.level)}</span>` : ''}`, `${err}${sched}${tch}<h2>O'quvchilar (${st.length})</h2><div class="wrap"><table><tr><th>O'quvchi</th><th>Qoldirgan</th><th></th></tr>${rows || '<tr><td colspan="3" class="mu">Guruhda o‘quvchi yo‘q</td></tr>'}</table></div>${add}${del}`, true);
}

function studentModal(m, shell) {
  const x = m.s, ed = can('new') >= 2, eArch = can('arch') >= 2, groups = m.groups || [];
  const info = ed ? `<form data-f="stusave" data-id="${x.id}" class="fg" style="grid-template-columns:1fr 1fr"><label>F.I.Sh<input name="full_name" value="${esc(x.full_name)}" required></label><label>Telefon<input name="phone" type="tel" value="${esc(x.phone)}"></label><label>Ota-ona telefon raqami<input name="parent_phone" type="tel" value="${esc(x.parent_phone)}"></label><label>Tuman<input name="district" list="tmn" value="${esc(x.district)}"></label><label>Tug'ilgan sana<input type="date" name="birth_date" value="${esc(x.birth_date || '')}" max="${today()}"></label><label>Maktab sinfi<input name="class_name" value="${esc(x.class_name)}"></label><label>Darsni boshlagan sana<input type="date" name="started_on" value="${esc(x.started_on || '')}"></label><label>Qabul sanasi<input type="date" name="admitted_on" value="${esc(x.admitted_on || '')}"></label><label style="grid-column:1/-1">Izoh<input name="note" value="${esc(x.note)}"></label><button class="btn pri" style="grid-column:1/-1">Saqlash</button></form>`
    : `<div class="grid" style="grid-template-columns:1fr 1fr"><div><span class="mu">Telefon</span><div>${esc(x.phone || '—')}</div></div><div><span class="mu">Ota-ona telefoni</span><div>${esc(x.parent_phone || '—')}</div></div><div><span class="mu">Tuman</span><div>${esc(x.district || '—')}</div></div><div><span class="mu">Tug'ilgan sana</span><div>${esc(x.birth_date || '—')}</div></div><div><span class="mu">Sinf</span><div>${esc(x.class_name || '—')}</div></div><div><span class="mu">Boshlagan sana</span><div>${esc(x.started_on || '—')}</div></div><div style="grid-column:1/-1"><span class="mu">Izoh</span><div>${esc(x.note || '—')}</div></div></div>`;
  const gl = x.groups.map((g) => `<span class="tag">${esc(g.name)}${ed ? ` <a href="#" data-a="stuunenr" data-v="${g.id}" title="Guruhdan chiqarish" style="text-decoration:none">✕</a>` : ''}</span>`).join(' ') || '<span class="mu">Hozir guruhsiz</span>';
  const addg = ed ? `<form data-f="stuenr" class="row"><select name="group" required><option value="">Guruhga qo‘shish…</option>${groups.filter((g) => !x.groups.some((y) => y.id === g.id)).map((g) => opt(g.id, `${g.name} (${g.student_count}/${S.set ? S.set.max_group_size : 15})`, '')).join('')}</select><button class="chip">＋ Qo'shish</button></form>` : '';
  const con = m.contacts ? `<h2>Ota-ona bilan aloqa tarixi</h2>${m.contacts.map((c) => `<div class="card" style="margin:4px 0"><div class="mu">${new Date(c.created_at).toLocaleDateString('uz-UZ')} · ${esc(c.by || '')} · ${c.missed_at_time} dars qoldirgan</div>${esc(c.note)}</div>`).join('') || '<p class="mu">Hozircha yozuv yo‘q</p>'}` : '';
  const fin = can('pay') >= 1 ? `<div class="row"><button class="chip" data-a="stufin" data-v="${x.id}">💰 To'lovlari</button></div>` : '';
  const arch = eArch ? `<h2>Arxivga o‘tkazish</h2><form data-f="stuarch" data-id="${x.id}" class="row"><select name="status"><option value="left">Ketgan</option><option value="paused">To'xtatilgan</option><option value="later">Keyin boshlaydi</option><option value="rejected">Rad etdi</option></select><input name="reason" placeholder="Sabab"><input type="date" name="start" title="'Keyin boshlaydi' uchun sana"><button class="chip">Arxivga</button></form>` : '';
  return shell(esc(x.full_name), `<div class="row"><span>Dars qoldirgan: <b class="${x.absences ? 'st0' : ''}">${x.absences || 0}</b></span></div>${info}<h2>Guruhlari</h2><div>${gl}</div>${addg}${fin}${con}${arch}`, true);
}

function staffView(m, shell) {
  const u = m.u, sal = can('sal') >= 1, subj = (S.subj || []).find((x) => x.slug === u.category);
  const line = (k, v) => `<div><span class="mu">${k}</span><div>${v}</div></div>`;
  const grs = (m.groups || []).map((g) => `<div class="row" style="margin:2px 0"><b>${esc(g.name)}</b><span class="mu">${g.room ? 'Xona ' + esc(g.room) + ' · ' : ''}${DN[g.days] || '—'} · ${timeOf(g)} · ${g.student_count} o'quvchi</span></div>`).join('');
  return shell(esc(u.full_name || u.username), `<div class="row"><span class="tag">${ROLE[u.role]}</span>${u.archived_at ? '<span class="tag">arxiv</span>' : ''}</div>
    <div class="grid" style="grid-template-columns:1fr 1fr">${line('Login', esc(u.username))}${line("Yo'nalish", esc(subj ? subj.name : u.category || '—'))}${line('Telefon', esc(u.phone || '—'))}${line('Tuman', esc(u.district || '—'))}${line("Tug'ilgan sana", esc(u.birth_date || '—'))}${line('Ishga kirgan', esc(u.work_from || '—'))}${sal ? line(u.role === 'support' ? 'Oylik' : 'Stavka', u.role === 'support' ? money(u.monthly_salary) : u.rate ? money(u.rate) : 'umumiy') : ''}</div>
    <h2>Tavsif</h2><div class="card" style="white-space:pre-wrap;margin:0">${u.description ? esc(u.description) : '<span class="mu">Tavsif kiritilmagan</span>'}</div>
    <h2>Guruhlari</h2>${grs || '<p class="mu">Hozircha guruhi yo‘q</p>'}
    ${can('stf') >= 2 ? `<div class="row"><button class="btn pri" data-a="stedit" data-v="${u.id}">Tahrirlash</button>${isAdmin() && u.role !== 'admin' && !u.archived_at ? `<button class="chip" data-a="stnewpw" data-v="${u.id}">🔑 Yangi parol berish</button><button class="chip" data-a="imp" data-v="${u.id}">👁 Shu xodim nomidan ko‘rish</button>` : ''}</div>` : ''}`, true);
}

function permModal(m, shell) {
  const u = m.u, EXTRA = ['pay', 'room', 'stf', 'new', 'arch'], secs = u.role === 'teacher' || u.role === 'support' ? SECS.filter(([k]) => EXTRA.includes(k)) : SECS, LVL = [['0', "Yo'q"], ['1', "Ko'rish"], ['2', "O'zgartirish"]];
  const cur = (k) => (u.perms && k in u.perms ? u.perms[k] : (DEFP[u.role] || {})[k] ?? 0);
  return shell(`${esc(u.full_name || u.username)} — ruxsatlar`, `<div class="row"><span class="tag">${ROLE[u.role]}</span><span class="mu">${esc(u.username)}</span></div><p class="mu">Qaysi bo‘limni <b>ko‘rishi</b> va qaysi bo‘limni <b>o‘zgartirishi</b> mumkinligini belgilang.${u.role === 'teacher' || u.role === 'support' ? ' O‘qituvchi/support o‘z guruhlari, davomati va oylig‘ini doim ko‘radi — bu yerda unga qo‘shimcha bo‘limlar ochasiz.' : ''} O‘zgarish xodimning keyingi kirishida (yoki sahifa yangilanganda) kuchga kiradi.</p><form data-f="permm" data-id="${u.id}" class="fg" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">${secs.map(([k, l]) => `<label>${l}<select name="perm_${k}">${LVL.map(([v, t]) => opt(v, t, cur(k))).join('')}</select></label>`).join('')}<button class="btn pri" style="grid-column:1/-1">Ruxsatlarni saqlash</button></form>`, true);
}

function salaryModal(m, shell) {
  const d = m.d, s = d.salary, ed = can('sal') >= 2, sup = d.role === 'support', subj = (S.subj || []).find((x) => x.slug === d.category);
  const line = (k, v) => `<div><span class="mu">${k}</span><div>${v}</div></div>`;
  const grs = d.groups.map((g) => `<div class="row" style="margin:2px 0"><b>${esc(g.name)}</b><span class="mu">${g.room ? 'Xona ' + esc(g.room) + ' · ' : ''}${DN[g.days] || '—'} · ${timeOf(g)} · ${g.student_count} o'quvchi</span></div>`).join('');
  const form = ed ? `<form data-f="salsave" data-id="${d.id}" class="row"><label style="flex:1;min-width:200px">${sup ? 'Oylik maosh (so‘m)' : `Ulush — 1 soatlik dars, 1 o‘quvchi/oyiga (bo‘sh = umumiy ${money(d.default_rate)})`}<input type="number" name="value" step="1000" min="0" value="${(sup ? d.monthly_salary : d.rate) ?? ''}" ${sup ? 'required' : ''}></label><button class="btn pri">Saqlash</button>${s.left > 0 ? `<button type="button" class="btn" data-a="salpay" data-v="${d.id}">To‘lash (${money(s.left)})</button>` : ''}</form>` : '';
  return shell(esc(d.name), `<div class="row"><span class="tag">${ROLE[d.role]}</span>${subj ? `<span class="tag">${esc(subj.name)}</span>` : ''}<span class="mu">${mname(m.month)}</span></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${sup ? '' : line('Kelgan darslar', Math.round((s.student_days || 0) * 10) / 10)}${sup ? '' : line('1 soat ulushi', money(s.rate))}${line('Hisoblangan', `<b>${money(s.accrued)}</b>`)}${line("To'langan", money(s.paid))}${line('Qolgan', `<b class="${s.left ? 'st0' : 'st2'}">${money(s.left)}</b>${s.left < 0 ? '<div class="mu">avans ortiqcha</div>' : ''}`)}</div>
    ${!sup && (s.breakdown || []).length ? `<h2>Guruhlar bo‘yicha hisob</h2><div class="wrap"><table><tr><th>Guruh</th><th>Dars soati</th><th>Oydagi darslar</th><th>1 dars narxi</th><th>Kelgan</th><th>Kelmagan</th><th>Hisoblandi</th></tr>${s.breakdown.map((x) => `<tr><td>${esc(x.group)}</td><td class="num">${x.hours} soat</td><td class="num">${x.lessons}</td><td class="num">${money(x.per_lesson)}</td><td class="num">${x.present}</td><td class="num">${x.absent}</td><td class="num"><b>${money(x.earned)}</b></td></tr>`).join('')}</table></div><div class="mu">Hisob: 1 soatlik ulush × dars soati (Math/English 2 soat, Kids 1 soat) ÷ shu oydagi darslar soni = 1 dars narxi. O‘qituvchi faqat kelgan o‘quvchi darsi uchun oladi (davomat saqlanishi bilan oylikka darrov qo‘shiladi). Kidsda o‘qituvchi har guruhga 1 soatdan dars beradi — 1 soatlik ulush (75 000), Math/English’da 2 soat — 150 000.</div>` : ''}
    ${form}${ed ? `<form data-f="saladv" data-id="${d.id}" class="row"><label style="flex:1;min-width:200px">Avans / qisman to‘lov (so‘m)<input type="number" name="amount" min="1000" step="1000" required placeholder="Masalan: 500000"></label><button class="btn pri">💵 Avans berish</button></form><div class="mu">Berilgan summa “To‘langan”ga qo‘shiladi, qolgani “Qolgan”ga o‘tadi. Kassaga chiqim bo‘lib yoziladi.</div>` : ''}${(d.payments || []).length ? `<h2>Shu oy to‘lovlari</h2>${d.payments.map((x) => `<div class="row" style="margin:2px 0"><span class="mu">${esc(String(x.date))}</span><b>${money(x.amount)}</b><span class="tag">${esc(x.note || '')}</span></div>`).join('')}` : ''}${s.advance ? `<div class="mu">Hisoblangandan ortiqcha berilgan (avans qoldig‘i): <b>${money(s.advance)}</b></div>` : ''}<h2>Ma'lumotlari</h2><div class="grid" style="grid-template-columns:1fr 1fr">${line('Telefon', esc(d.phone || '—'))}${line('Tuman', esc(d.district || '—'))}</div>
    <h2>Tavsif</h2><div class="card" style="white-space:pre-wrap;margin:0">${d.description ? esc(d.description) : '<span class="mu">Tavsif kiritilmagan</span>'}</div>
    <h2>Guruhlari</h2>${grs || '<p class="mu">Hozircha guruhi yo‘q</p>'}`, true);
}

function slotModal(m, shell) {
  const gs = (S.d.room.groups || []).slice().sort((a, b) => (!!a.room - !!b.room) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const hh = String(m.h).padStart(2, '0') + ':00';
  const err = m.err ? `<div class="card msg err">${m.err.map(esc).join('<br>')}</div>` : '';
  const nw = can('new') >= 2 ? `<h2>Yoki yangi guruh yaratish</h2><form data-f="slotnew" class="fg"><label>Guruh nomi<input name="name" required placeholder="Mat_6 / E11_A2 / Kids_uz9"></label><label>Yo'nalish<select name="subject">${subjOpts('')}</select></label><button class="btn pri">Yaratib biriktirish</button></form><div class="mu">Yaratilgach, o‘qituvchini guruh oynasidan biriktirasiz.</div>` : '';
  return shell(`Xona ${esc(m.room)} · ${DN[m.days]} · ${hh}`, `${err}<p class="mu">Bo‘sh vaqtga mavjud guruhni biriktiring. Guruhning hozirgi xonasi/vaqti shu yangisiga almashadi; ustma-ust tushsa, tizim ogohlantiradi.</p><form data-f="slotassign" class="row"><select name="group" required style="flex:1;min-width:220px"><option value="">Guruhni tanlang…</option>${gs.map((g) => { const c = slotOf(g, { days: m.days, hour: m.h, room: m.room }), oth = othersOf(S.d.room.groups, g.id); const by = roomBy(c, m.room, oth) ? `xona band: ${roomBy(c, m.room, oth)}` : (() => { for (let i = 0; i < c.teachers.length; i++) { const b = teacherBy(c, c.teachers[i], i, oth); if (b) return `${g.teachers.find((t) => t.id === c.teachers[i])?.name || 'o‘qituvchi'} band: ${b}`; } return ''; })(); return busyOpt(g.id, `${g.name} — ${g.room ? `hozir: xona ${g.room}, ${DN[g.days] || '—'} ${timeOf(g)}` : 'jadvali yo‘q'}`, '', by); }).join('')}</select><button class="btn pri">Biriktirish</button></form>${nw}`);
}

function payModal(m, shell) {
  const f = m.fin, ed = can('pay') >= 2;
  const rows = f.rows.filter((r) => r.base || r.paid).map((r) => `<tr><td>${mname(r.month)}${r.closed ? ' 🔒' : ''}</td><td class="num">${money(r.base)}</td><td class="num">${r.discount ? '−' + money(r.discount) : '—'}</td><td class="num">${money(r.due)}</td><td class="num">${money(r.paid)}</td><td class="num ${r.owe && r.month <= today().slice(0, 7) ? 'st0' : 'mu'}">${r.month > today().slice(0, 7) ? 'kelgusi' : money(r.owe)}</td></tr>`).join('');
  const forms = ed ? `<form data-f="paystu" class="fg" style="margin:10px 0"><label>Summa (so'm)<input type="number" name="amount" min="1" required></label><label>Qaysi oyga<select name="month"><option value="">Avto (eng eski qarzdan)</option>${f.rows.filter((r) => r.due).map((r) => opt(r.month, mname(r.month), '')).join('')}</select></label><button class="btn pri">To'lov qabul qilish</button></form>
  <form data-f="discstu" class="fg"><label>Chegirma (so'm)<input type="number" name="amount" min="0" step="1000" required></label><label>Qaysi oydan boshlab<select name="month">${f.rows.filter((r) => r.base).map((r) => opt(r.month, mname(r.month), m.month)).join('')}</select></label><button class="btn">Chegirmani belgilash</button></form>` : '';
  return shell(esc(f.name), `<div class="row"><span>Umumiy qarz: <b class="${f.debt ? 'st0' : ''}">${money(f.debt)}</b></span>${f.credit ? `<span>Avans: <b class="st2">${money(f.credit)}</b></span>` : ''}</div><div class="wrap"><table><tr><th>Oy</th><th>Narx</th><th>Chegirma</th><th>To'lov</th><th>To'langan</th><th>Qarz</th></tr>${rows || '<tr><td colspan="6" class="mu">Ma‘lumot yo‘q</td></tr>'}</table></div>${forms}`, true);
}

function staffModal(m, shell) {
  const u = m.u, sal = can('sal') >= 2;
  const perms = u.role === 'administrator' || u.role === 'bugalter' ? `<div class="mu" style="grid-column:1/-1">Bo'limlarga ruxsat:</div>${SECS.map(([k, l]) => `<label>${l}<select name="perm_${k}">${[['0', "Yo'q"], ['1', "Ko'rish"], ['2', "O'zgartirish"]].map(([v, t]) => opt(v, t, u.perms && k in u.perms ? u.perms[k] : (m.defp[u.role] || {})[k] ?? 0)).join('')}</select></label>`).join('')}` : '';
  return shell(esc(u.full_name || u.username), `<form data-f="stsave" data-id="${u.id}" class="fg" style="grid-template-columns:1fr 1fr"><label>F.I.Sh<input name="full_name" value="${esc(u.full_name)}"></label><label>Telefon<input name="phone" value="${esc(u.phone)}"></label><label>Tuman<input name="district" list="tmn" value="${esc(u.district)}"></label><label>Yo'nalish<select name="category"><option value="">—</option>${subjOpts(u.category)}</select></label><label style="grid-column:1/-1">Tavsif (tajriba, izoh)<textarea name="description" rows="3" maxlength="2000">${esc(u.description)}</textarea></label>${sal ? `<label>${u.role === 'support' ? 'Oylik (so‘m)' : 'Stavka (so‘m)'}<input type="number" name="pay" step="1000" min="0" value="${(u.role === 'support' ? u.monthly_salary : u.rate) ?? ''}"></label>` : ''}${pwField('password', 'Yangi parol (bo‘sh = o‘zgarmaydi)')}<button type="button" class="chip" data-a="genpw">🔑 Yaratish</button>${perms}<button class="btn pri" style="grid-column:1/-1">Saqlash</button></form><div class="demo">Eski parolni ko'rib bo'lmaydi (xavfsizlik uchun faqat hash saqlanadi). Yangi parol berilsa, xodim birinchi kirishda uni almashtiradi.</div>`);
}

/* ---------- harakatlar (click) ---------- */
const DEFP = { administrator: { dash: 2, att: 2, pay: 1, sal: 0, room: 2, stf: 1, new: 2, arch: 2 }, bugalter: { dash: 1, att: 0, pay: 2, sal: 2, room: 0, stf: 0, new: 0, arch: 1 } };
let stuTimer;
const A = {
  stop() {},
  close(el, v, ev) { if (S.mo && S.mo.force) return; if (ev.target === el || el.tagName === 'BUTTON') { S.mo = null; S.msg = null; render(); } },
  eye(el) { const i = el.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; el.textContent = i.type === 'password' ? '👁' : '🙈'; },
  genpw(el) { const f = el.closest('form'), i = f.querySelector('input[name=password]'); i.value = genPw(); i.type = 'text'; const e = f.querySelector('.eye'); if (e) e.textContent = '🙈'; },
  tab: (el, v) => go(v),
  ui() { S.ui = String((+S.ui % 3) + 1); safe(() => localStorage.setItem('oqm_ui', S.ui)); render(); toast(`Dizayn: ${S.ui}. ${UIN[S.ui - 1]}`); },
  out: async () => { try { if (refresh) await post('/auth/logout/', { refresh }); } catch { /* chiqish baribir bajariladi */ } localLogout(); },
  profile() { S.mo = { t: 'pw' }; S.msg = null; render(); },
  sf(el, v) { S.d.sf = v; S.d.lvf = ''; render(); },
  lvf(el) { S.d.lvf = el.value; render(); },
  free(el) { S.d.free = el.checked; render(); },
  async grp(el, v) {
    const g = S.d.dash.groups.find((x) => x.id == v);
    S.mo = { t: 'grp', g, students: [], all: S.d.dash.groups }; render();
    await run(async () => { await loadGroupModal(); });
  },
  tsv(el, v) { S.d.tsv = v; render(); },
  attc: (el, v) => run(async () => { S.d.att.group = v; await loadSheet(); }),
  attg: (el) => run(async () => { S.d.att.group = el.value; if (el.value) await loadSheet(); else S.d.att.sheet = null; }),
  attd: (el) => run(async () => { S.d.att.date = el.value || today(); if (S.d.att.group) await loadSheet(); }),
  mk(el, v) { const [id, p] = v.split(':'); S.d.att.marks[id] = p === '1'; render(); },
  smk(el, v) { const [id, x] = v.split(':'); S.d.att.smarks[id] = x === '1'; render(); },
  allsup() { S.d.att.sheet.students.forEach((s) => { S.d.att.smarks[s.student] = true; }); render(); },
  savesup: () => run(async () => {
    const a = S.d.att, recs = Object.entries(a.smarks).map(([id, p]) => ({ student: +id, present: p }));
    if (!recs.length) throw new Error('Avval support davomatini belgilang');
    await post('/attendance/support/', { group: +a.group, date: a.date, records: recs }); await loadSheet(); ok('Support davomati saqlandi');
  }),
  allpres() { S.d.att.sheet.students.forEach((s) => { S.d.att.marks[s.student] = true; }); render(); },
  savemk: () => run(async () => { await saveMarks(); ok('Davomat saqlandi'); }),
  finmk: () => run(async () => { await saveMarks(); await post('/attendance/finalize/', { group: +S.d.att.group, date: S.d.att.date }); await loadSheet(); ok('Davomat yakunlandi'); }),
  reopenmk: () => run(async () => { await post('/attendance/reopen/', { group: +S.d.att.group, date: S.d.att.date }); await loadSheet(); ok('Davomat qayta ochildi'); }),
  pfl: (el, v) => { S.d.pay.pf = v; render(); },
  async cc(el, v) {
    const c = S.d.pay.calc; c.open = true;
    if (v.startsWith('sub:')) { const id = +v.slice(4); c.subs = el.checked ? [...new Set([...c.subs, id])] : c.subs.filter((x) => x !== id); }
    else if (v === 'disc') c.disc = Math.max(0, +el.value || 0); else c[v] = el.value || c[v];
    await calcLoad(); render();
  },
  newmonth: () => run(async () => {
    const n = S.set.academic_months + 1;
    if (!confirm(`Yangi oy qo‘shilsinmi? O‘quv yili ${n} oy bo‘ladi, eski oylar saqlanadi.`)) return;
    S.set = await patch('/settings/', { academic_months: n }); S.d.pay.month = months()[months().length - 1]; await L.pay(); ok('Yangi oy ochildi: ' + mname(S.d.pay.month));
  }),
  pps: (el, v) => { S.d.pay.ps = v; return go('pay'); },
  paym: (el) => { S.d.pay.month = el.value; return go('pay'); },
  payq(el) { S.d.pay.q = el.value; const pos = el.selectionStart; render(); const n = document.querySelector('[data-a=payq]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } },
  pst: (el, v) => run(async () => { S.mo = { t: 'pst', month: S.d.pay.month, fin: await api(`/students/${v}/finance/`), id: v }; }),
  closem: () => run(async () => { if (!confirm('Oyni yopasizmi? Yopilgan oyga to‘lov va chegirma kiritib bo‘lmaydi.')) return; await post(`/finance/months/${S.d.pay.month}/close/`); await L.pay(); ok('Oy yopildi'); }),
  reopenm: () => run(async () => { await post(`/finance/months/${S.d.pay.month}/reopen/`); await L.pay(); ok('Oy qayta ochildi'); }),
  cashdel: (el, v) => run(async () => { if (!confirm('O‘chirasizmi?')) return; await api(`/cash/${v}/`, { method: 'DELETE' }); await L.pay(); ok("O'chirildi"); }),
  salm: (el) => { S.d.sal.month = el.value; return go('sal'); },
  paysal: (el, v) => run(async () => { await post(`/salary/${v}/pay/`, { month: S.d.sal.month }); await L.sal(); ok("Oylik to'landi (kassaga chiqim yozildi)"); }),
  rdays(el, v) { S.d.room.days = v; render(); },
  gsf(el) { const m = S.mo, snap = (f) => (f ? Object.fromEntries(new FormData(f)) : null); m.draft = snap(el.closest('form')); m.tdraft = snap(document.querySelector('form[data-f=gteach]')) || m.tdraft; render(); },
  stperm(el, v) { S.mo = { t: 'perm', u: S.d.stf.staff.find((x) => x.id == v) }; render(); },
  rhour(el) { S.d.room.h = +el.value; render(); },
  rview(el, v) { S.d.room.view = v; render(); },
  supdel: (el, v) => run(async () => {
    const [gid, uid] = v.split(':').map(Number), g = S.d.room.groups.find((x) => x.id === gid);
    await post(`/groups/${gid}/supports/`, { supports: g.supports.map((x) => x.id).filter((x) => x !== uid) }); await refreshGroups(); ok('Support olib tashlandi');
  }),
  rpanel(el, v) { S.d.room.panel = S.d.room.panel === v ? '' : v; render(); },
  rslot(el, v) { const [room, h] = v.split('|'); S.mo = { t: 'slot', room, h: +h, days: S.d.room.days }; render(); },
  roomdel: (el, v) => run(async () => { if (!confirm('Xonani o‘chirasizmi?')) return; await api(`/rooms/${v}/`, { method: 'DELETE' }); await roomList(); ok("Xona o'chirildi"); }),
  salv: (el, v) => run(async () => { const month = S.d.sal.month; S.mo = { t: 'sv', month, d: await api(`/salary/${v}/?month=${month}`) }; }),
  salpay: (el, v) => run(async () => { const m = S.mo; await post(`/salary/${v}/pay/`, { month: m.month }); m.d = await api(`/salary/${v}/?month=${m.month}`); await L.sal(); ok("Oylik to'landi (kassaga chiqim yozildi)"); }),
  async rgrp(el, v) {
    const g = S.d.room.groups.find((x) => x.id == v);
    S.mo = { t: 'grp', g, students: [], all: S.d.room.groups }; render();
    await run(async () => { await loadGroupModal(); });
  },
  stview: (el, v) => run(async () => {
    const u = S.d.stf.staff.find((x) => x.id == v);
    S.mo = { t: 'stv', u, groups: [] };
    const gs = await list('/groups/').catch(() => []);
    S.mo.groups = gs.filter((g) => g.teachers.some((t) => t.id === u.id) || g.supports.some((t) => t.id === u.id));
  }),
  stuq(el) {
    S.d.stu.q = el.value; clearTimeout(stuTimer);
    stuTimer = setTimeout(async () => {
      await run(async () => { await L.stu(); });
      const n = document.querySelector('[data-a=stuq]'); if (n) { n.focus(); const l = n.value.length; n.setSelectionRange(l, l); }
    }, 300);
  },
  stusub: (el) => run(async () => { S.d.stu.subject = el.value; await L.stu(); }),
  stuf: (el, v) => run(async () => { S.d.stu.f = v; await L.stu(); }),
  stv: (el, v) => run(async () => {
    const x = S.d.stu.students.find((q) => q.id == v);
    S.mo = { t: 'stm', s: x, groups: S.d.stu.groups, contacts: null };
    if (can('att') >= 1) S.mo.contacts = await api(`/students/${v}/contacts/`).then((c) => c.results || c).catch(() => []);
  }),
  stuunenr: (el, v) => run(async () => { await post(`/students/${S.mo.s.id}/unenroll/`, { group: +v }); await reloadStu(); ok('Guruhdan chiqarildi'); }),
  stufin: (el, v) => run(async () => { await settings(); S.mo = { t: 'pst', month: curMonth(), fin: await api(`/students/${v}/finance/`), id: v }; }),
  starchv: (el) => { S.d.stf.arch = el.checked; return go('stf'); },
  starch: (el, v) => run(async () => { if (!confirm('Xodimni arxivlaysizmi? U tizimga kira olmaydi.')) return; await post(`/staff/${v}/archive/`); await L.stf(); ok('Arxivlandi'); }),
  bell: () => go('att'),
  stfq(el) { S.d.stf.q = el.value; const pos = el.selectionStart; render(); const n = document.querySelector('[data-a=stfq]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } },
  stfr: (el, v) => { S.d.stf.rf = v; render(); },
  stfc: (el) => { S.d.stf.cat = el.value; render(); },
  stnewpw: (el, v) => run(async () => {
    const u = (S.d.stf.staff || []).find((x) => x.id == v) || (S.mo && S.mo.u) || {};
    if (!confirm(`${u.full_name || u.username} uchun yangi parol yaratilsinmi? Eski parol ishlamay qoladi.`)) return;
    const pw = genPw(); await patch(`/staff/${v}/`, { password: pw });
    S.mo = { t: 'npw', u, pw };
  }),
  async imp(el, v) {
    const d = await post(`/auth/impersonate/${v}/`);
    S.adm = S.adm || { access, refresh, me: S.me, view: S.view };
    access = d.access; refresh = d.refresh; S.me = d.user; S.d = {}; S.mo = null; await enter();
  },
  async unimp() {
    const a = S.adm; S.adm = null; access = a.access; refresh = a.refresh; S.me = a.me; S.d = {}; S.mo = null; await loadBell(); await go(a.view);
  },
  bakmk: () => run(async () => { await post('/backups/'); await L.bak(); ok('Zaxira olindi'); }),
  bakrest: (el, v) => run(async () => {
    const t = prompt(`DIQQAT: barcha hozirgi ma’lumotlar "${v}" holatiga qaytariladi (oldin avtomatik zaxira olinadi).\n\nTasdiqlash uchun fayl nomini aynan yozing:`);
    if (t === null) return; if (t.trim() !== v) { bad('Fayl nomi mos kelmadi — tiklanmadi'); return; }
    await post(`/backups/${v}/restore/`, { confirm: t.trim() }); await L.bak(); ok('Ma’lumotlar tiklandi');
  }),
  async bakdl(el, v) {
    const r = await fetch(`${API}/backups/${v}/`, { headers: { Authorization: 'Bearer ' + access } });
    if (!r.ok) return bad('Yuklab bo‘lmadi');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = v; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  archf: (el, v) => { S.d.arch.f = v; render(); },
  studel: (el, v) => run(async () => {
    if (!confirm('Arxivdagi o‘quvchi butunlay o‘chiriladi (davomat, chegirma, aloqa tarixi ham). Davom etasizmi?')) return;
    try { await api(`/students/${v}/`, { method: 'DELETE' }); } catch (e) {
      const m = /PAYMENTS:(\d+):(\d+)/.exec(e.message || '');
      if (!m) throw e;
      if (!confirm(`Bu o‘quvchining ${m[1]} ta to‘lovi bor (jami ${money(+m[2])}). To‘lovlari ham o‘chadi va kassa hisobotlari o‘zgaradi. Baribir o‘chirasizmi?`)) return;
      await api(`/students/${v}/?force=1`, { method: 'DELETE' });
    }
    await L.arch(); ok('O‘quvchi o‘chirildi');
  }),
  stdel: (el, v) => run(async () => {
    if (!confirm('Arxivdagi xodim butunlay o‘chiriladi. Kassadagi oylik yozuvlari qoladi. Davom etasizmi?')) return;
    await api(`/staff/${v}/`, { method: 'DELETE' });
    if (el.dataset.w === 'set') await L.set(); else await L.arch();
    ok('Xodim o‘chirildi');
  }),
  starest: (el, v) => run(async () => { await post(`/staff/${v}/restore/`); await L.arch(); ok('Xodim qaytarildi'); }),
  strest: (el, v) => run(async () => { await post(`/staff/${v}/restore/`); await L.stf(); ok('Qaytarildi'); }),
  stedit(el, v) { S.mo = { t: 'st', u: S.d.stf.staff.find((x) => x.id == v), defp: DEFP }; render(); },
  applysug: (el, v) => run(async () => { const [room, time] = v.split('|'); const g = await patch(`/groups/${S.mo.g.id}/`, { room, start_time: time }); S.mo.err = null; S.mo.sug = null; S.mo.g = g; await refreshGroups(); ok(`Jadval yangilandi: xona ${room}, ${time}`); }),
  enr: (el, v) => run(async () => { await post(`/students/${v}/enroll/`, { group: S.mo.g.id }); S.mo.found = []; await loadGroupModal(); ok("O'quvchi guruhga qo'shildi"); }),
  unenr: (el, v) => run(async () => { await post(`/students/${v}/unenroll/`, { group: S.mo.g.id }); await loadGroupModal(); ok('Guruhdan chiqarildi'); }),
  archform(el, v) { S.mo.arch = +v; render(); },
  grpdel: () => run(async () => { if (!confirm('Guruhni o‘chirasizmi?')) return; await api(`/groups/${S.mo.g.id}/`, { method: 'DELETE' }); S.mo = null; await refreshGroups(); ok("Guruh o'chirildi"); }),
  rolesel() {},
  settab: (el, v) => { S.d.set.tab = v; return go('set'); },
  subedit(el, v) { S.mo = { t: 'sub', x: S.subj.find((x) => x.id == v) }; render(); },
  subdel: (el, v) => run(async () => { if (!confirm('Fanni o‘chirasizmi?')) return; await api(`/subjects/${v}/`, { method: 'DELETE' }); S.mo = null; S.subj = await list('/subjects/'); ok("Fan o'chirildi"); }),
  starch2: (el, v) => run(async () => { if (!confirm('Akkauntni arxivlaysizmi?')) return; await post(`/staff/${v}/archive/`); await L.set(); ok('Arxivlandi'); }),
  strest2: (el, v) => run(async () => { await post(`/staff/${v}/restore/`); await L.set(); ok('Qaytarildi'); }),
};

async function refreshGroups() {
  const gs = await list('/groups/');
  if (S.d.dash) S.d.dash.groups = gs;
  if (S.d.new) S.d.new.groups = gs;
  if (S.d.att) S.d.att.groups = gs;
  if (S.d.room) S.d.room.groups = gs;
  await loadCf(); await loadPlan(); if (S.d.dash) { S.d.dash.conflicts = S.cf; if (S.d.dash.stats) S.d.dash.stats.conflicts = (S.cf || []).length; }
  if (S.mo && S.mo.t === 'grp') { S.mo.all = gs; S.mo.g = gs.find((x) => x.id === S.mo.g.id) || S.mo.g; }
}
async function reloadStu() {
  const id = S.mo.s.id; await L.stu();
  S.mo.s = S.d.stu.students.find((q) => q.id === id) || S.mo.s; S.mo.groups = S.d.stu.groups;
}
async function loadGroupModal() {
  const m = S.mo; if (!S.rooms) await roomList(); await refreshGroups();
  m.students = await list(`/students/?group=${m.g.id}`);
  if (can('stf') >= 2 && !m.staff) { const [teachers, supports] = await Promise.all([list('/staff/?role=teacher'), list('/staff/?role=support')]); m.staff = { teachers, supports }; }
}
async function saveMarks() {
  const a = S.d.att, recs = Object.entries(a.marks).map(([s, p]) => ({ student: +s, present: p }));
  if (!recs.length) throw new Error('Avval davomatni belgilang');
  await post('/attendance/mark/', { group: +a.group, date: a.date, records: recs });
  await loadSheet();
  await loadBoard();
}

/* ---------- formalar (submit) ---------- */
const num = (v) => (v === '' || v === undefined ? undefined : Number(v));
const F = {
  login: async (f) => { try { await login(f); } catch (e) { S.lerr = /no active account/i.test(e.message) ? "Login yoki parol noto'g'ri" : e.message; S.lu = f.username; render(); } },
  async contact(f, form) {
    const note = (f.note || '').trim();
    if (note.length < 3) return bad('Avval izoh yozing: ota-ona nima sabab aytdi');
    await post(`/students/${form.dataset.id}/contacts/`, { note });
    await loadBoard();
    ok("Bog‘lanildi — izoh o‘quvchi kartasiga saqlandi");
  },
  async cash(f) { await post('/cash/', { ...f, amount: +f.amount }); await L.pay(); ok("Qo'shildi"); },
  async chpw(f) {
    await post('/auth/password/', f);
    const force = S.mo && S.mo.force; S.me.must_change_password = false; S.mo = null; ok("Parol o'zgartirildi");
    if (force) await go(S.view);
  },
  async paystu(f) {
    const body = { amount: +f.amount }; if (f.month) body.month = f.month;
    await post(`/students/${S.mo.id}/pay/`, body);
    S.mo.fin = await api(`/students/${S.mo.id}/finance/`); await L.pay(); ok("To'lov qabul qilindi");
  },
  async discstu(f) { await post(`/students/${S.mo.id}/discount/`, { month: f.month, amount: +f.amount }); S.mo.fin = await api(`/students/${S.mo.id}/finance/`); await L.pay(); ok('Chegirma belgilandi'); },
  async gsched(f) {
    const body = { room: f.room, days: f.days, start_time: f.start_time || null };
    if (f.kids_order) body.kids_order = f.kids_order; if (f.level !== undefined) body.level = f.level;
    try { S.mo.g = await patch(`/groups/${S.mo.g.id}/`, body); S.mo.draft = null; S.mo.err = null; S.mo.sug = null; await refreshGroups(); ok('Jadval saqlandi'); }
    catch (e) { if (e.data && e.data.schedule) { S.mo.err = e.data.schedule; S.mo.sug = e.data.suggestions || []; S.msg = null; toast(e.data.schedule.join('; '), 'err'); } else throw e; }
  },
  async gteach(f) {
    const ids = [f.t0, f.t1].filter(Boolean).map(Number);
    try { const g = await post(`/groups/${S.mo.g.id}/teachers/`, { teachers: ids }); S.mo.err = null; S.mo.tdraft = null; S.mo.g = g; await refreshGroups(); ok("O'qituvchi saqlandi"); }
    catch (e) { if (e.data && e.data.schedule) { S.mo.err = e.data.schedule; toast(e.data.schedule.join('; '), 'err'); S.msg = null; } else throw e; }
  },
  async gsup(f, form) { const ids = [...form.querySelectorAll('input[name=s]:checked')].map((i) => +i.value); try { S.mo.g = await post(`/groups/${S.mo.g.id}/supports/`, { supports: ids }); S.mo.err = null; await refreshGroups(); ok('Support saqlandi'); } catch (e) { if (e.data && e.data.schedule) { S.mo.err = e.data.schedule; toast(e.data.schedule.join('; '), 'err'); S.msg = null; } else throw e; } },
  async findstu(f) { S.mo.found = (await list(`/students/?q=${encodeURIComponent(f.q)}`)).filter((s) => !s.groups.some((x) => x.id === S.mo.g.id)).slice(0, 8); },
  async archstu(f, form) { await post(`/students/${form.dataset.id}/archive/`, { status: f.status, reason: f.reason, start: f.start || null }); S.mo.arch = null; await loadGroupModal(); ok('Arxivga o‘tkazildi'); },
  async addstaff(f, form) {
    const body = { username: f.username.trim(), full_name: f.full_name, role: f.role, category: f.category, phone: f.phone, district: f.district, work_from: f.work_from || null, description: f.description || '', password: f.password };
    if (f.pay) body[f.role === 'support' ? 'monthly_salary' : 'rate'] = +f.pay;
    await post('/staff/', body); await (S.view === 'set' ? L.set() : L.stf()); ok(`${f.full_name} qo'shildi. Login: ${f.username}. Birinchi kirishda parolni almashtiradi.`);
  },
  async stsave(f, form) {
    const u = S.mo.u, body = { full_name: f.full_name, phone: f.phone, district: f.district, category: f.category, description: f.description || '' };
    if (f.pay !== undefined && f.pay !== '') body[u.role === 'support' ? 'monthly_salary' : 'rate'] = +f.pay;
    if (f.password) body.password = f.password;
    if (u.role === 'administrator' || u.role === 'bugalter') body.perms = Object.fromEntries(SECS.map(([k]) => [k, +f['perm_' + k]]));
    await patch(`/staff/${form.dataset.id}/`, body); S.mo = null; await L.stf(); ok('Saqlandi');
  },
  async addstu(f) {
    const body = { full_name: f.full_name, phone: f.phone, parent_phone: f.parent_phone, district: f.district, birth_date: f.birth_date || null, class_name: f.class_name, note: f.note, started_on: f.started_on };
    if (f.group) body.group = +f.group; await post('/students/', body); await L[S.view](); ok(`${f.full_name} qo'shildi`);
  },
  async addgrp(f) {
    try { await post('/groups/', { name: f.name, subject: f.subject, level: f.level, room: f.room, days: f.days, start_time: f.start_time || null }); await L.new(); ok(`${f.name} guruhi yaratildi`); }
    catch (e) { if (e.data && e.data.schedule) throw new Error(e.data.schedule.join('; ') + (e.data.suggestions && e.data.suggestions.length ? '. Bo‘sh variantlar: ' + e.data.suggestions.slice(0, 4).map((x) => `xona ${x.room} ${x.time}`).join(', ') : '')); throw e; }
  },
  async stusave(f, form) {
    const body = { full_name: f.full_name, phone: f.phone, parent_phone: f.parent_phone, district: f.district, birth_date: f.birth_date || null, class_name: f.class_name, note: f.note, admitted_on: f.admitted_on || null };
    if (f.started_on) body.started_on = f.started_on;
    await patch(`/students/${form.dataset.id}/`, body); await reloadStu(); ok('Saqlandi');
  },
  async stuenr(f) { await post(`/students/${S.mo.s.id}/enroll/`, { group: +f.group }); await reloadStu(); ok("O'quvchi guruhga qo'shildi"); },
  async stuarch(f, form) { await post(`/students/${form.dataset.id}/archive/`, { status: f.status, reason: f.reason, start: f.start || null }); S.mo = null; await L.stu(); ok('Arxivga o‘tkazildi'); },
  async restore(f, form) { await post(`/students/${form.dataset.id}/restore/`, f.group ? { group: +f.group } : {}); await L.arch(); ok('Faollashtirildi'); },
  async setsave(f) { S.set = await patch('/settings/', { max_group_size: +f.max_group_size, default_rate: +f.default_rate, default_price: +f.default_price, academic_start: f.academic_start, academic_months: +f.academic_months, alert_threshold: +f.alert_threshold, auto_next_month: !!f.auto_next_month, auto_close_month: !!f.auto_close_month }); ok('Sozlamalar saqlandi'); },
  async subsave(f, form) { await patch(`/subjects/${form.dataset.id}/`, { name: f.name, prefix: f.prefix, price: +f.price, has_levels: !!f.has_levels, is_active: !!f.is_active }); S.mo = null; S.subj = await list('/subjects/'); ok('Fan saqlandi'); },
  async permsave(f, form) { const body = { perms: Object.fromEntries(SECS.map(([k]) => [k, +f['perm_' + k]])) }; if (f.password) body.password = f.password; await patch(`/staff/${form.dataset.id}/`, body); await L.set(); ok('Ruxsatlar saqlandi'); },
  async permm(f, form) { await patch(`/staff/${form.dataset.id}/`, { perms: Object.fromEntries(SECS.filter(([k]) => 'perm_' + k in f).map(([k]) => [k, +f['perm_' + k]])) }); S.mo = null; await L.stf(); ok('Ruxsatlar saqlandi'); },
  async saladv(f, form) { const m = S.mo; await post(`/salary/${form.dataset.id}/pay/`, { month: m.month, amount: +f.amount, note: 'Avans' }); m.d = await api(`/salary/${form.dataset.id}/?month=${m.month}`); await L.sal(); ok(`Avans berildi: ${money(+f.amount)}`); },
  async supadd(f) {
    const g = S.d.room.groups.find((x) => x.id == f.group), ids = [...new Set([...g.supports.map((x) => x.id), +f.support])];
    await post(`/groups/${g.id}/supports/`, { supports: ids }); await refreshGroups(); ok(`${g.name}: support biriktirildi`);
  },
  async genrate(f) { S.set = await patch('/settings/', { default_rate: +f.rate }); await L.sal(); ok(`Umumiy ulush: ${money(+f.rate)}`); },
  async salsave(f, form) { const m = S.mo; m.d = await patch(`/salary/${form.dataset.id}/?month=${m.month}`, { value: f.value }); await L.sal(); ok('Saqlandi'); },
  async addroom(f) { await post('/rooms/', { name: f.name.trim() }); await roomList(); S.d.room.panel = ''; ok(`Xona ${f.name.trim()} qo'shildi`); },
  async slotassign(f) {
    const m = S.mo;
    try { const g = await patch(`/groups/${f.group}/`, { room: m.room, days: m.days, start_time: String(m.h).padStart(2, '0') + ':00' }); S.mo = null; await refreshGroups(); ok(`${g.name} → xona ${m.room}, ${String(m.h).padStart(2, '0')}:00`); }
    catch (e) { if (e.data && e.data.schedule) { m.err = e.data.schedule; S.msg = null; toast(e.data.schedule.join('; '), 'err'); } else throw e; }
  },
  async slotnew(f) {
    const m = S.mo;
    try { const g = await post('/groups/', { name: f.name, subject: f.subject, room: m.room, days: m.days, start_time: String(m.h).padStart(2, '0') + ':00' }); await refreshGroups(); S.mo = { t: 'grp', g: S.d.room.groups.find((x) => x.id === g.id) || g, students: [], all: S.d.room.groups }; await loadGroupModal(); ok(`${f.name} yaratildi — endi o'qituvchini biriktiring`); }
    catch (e) { if (e.data && e.data.schedule) { m.err = e.data.schedule; S.msg = null; toast(e.data.schedule.join('; '), 'err'); } else throw e; }
  },
  async addsub(f) { await post('/subjects/', { name: f.name, slug: f.slug, prefix: f.prefix, price: +f.price, has_levels: !!f.has_levels }); S.subj = await list('/subjects/'); ok("Fan qo'shildi"); },
};

/* ---------- hodisalar ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  if (t.tagName === 'A') e.preventDefault();
  const a = t.dataset.a;
  if (['paym', 'attg', 'attd', 'salm', 'payq', 'starchv', 'rolesel', 'stuq', 'stusub', 'gsf', 'rhour', 'lvf', 'free', 'cc', 'stfq', 'stfc'].includes(a) && (t.tagName === 'SELECT' || t.tagName === 'INPUT')) return; // 'change'/'input' da ishlaydi
  if (!A[a]) return;
  if (a !== 'close' && a !== 'stop' && a !== 'eye' && a !== 'genpw') S.msg = null;
  const r = A[a](t, t.dataset.v, e);
  if (r && r.catch) r.catch((x) => { bad(x); render(); });
});
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-a]'); if (!t || !['paym', 'attg', 'attd', 'salm', 'starchv', 'stusub', 'gsf', 'rhour', 'lvf', 'free', 'cc', 'stfc'].includes(t.dataset.a)) return;
  A[t.dataset.a](t, t.dataset.v, e);
});
document.addEventListener('input', (e) => { const t = e.target; if (t.dataset && t.dataset.a === 'payq') A.payq(t); if (t.dataset && t.dataset.a === 'stuq') A.stuq(t); if (t.dataset && t.dataset.a === 'stfq') A.stfq(t); });
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-f]'); if (!form) return;
  e.preventDefault();
  const fn = F[form.dataset.f]; if (!fn) return;
  const f = {}; new FormData(form).forEach((v, k) => { f[k] = typeof v === 'string' ? v : ''; });
  form.querySelectorAll('input[type=checkbox]').forEach((c) => { if (c.name && c.name !== 's') f[c.name] = c.checked; });
  S.msg = null;
  if (form.dataset.f === 'login') { fn(f); return; }
  run(() => fn(f, form));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.mo && !S.mo.force) { S.mo = null; render(); } });

/* ---------- ishga tushirish ---------- */
(async () => {
  render();
  if (await restore()) await enter(); else render();
})();

/* ---------- 3D egilish (barcha kartalar) ---------- */
(() => {
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion:reduce)').matches || matchMedia('(pointer:coarse)').matches) return;
  let cur = null;
  const ok = (el) => el && !el.matches('form,.mb,.modal') && !el.querySelector('input,select,textarea') && el.offsetWidth < 900;
  const reset = () => { if (cur) { cur.classList.remove('tilt3'); cur.style.transform = ''; cur = null; } };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('.card,.gc,.sc,.rc');
    if (!ok(el)) return reset();
    if (cur && cur !== el) reset();
    cur = el; const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.classList.add('tilt3');
    el.style.setProperty('--mx', x * 100 + '%'); el.style.setProperty('--my', y * 100 + '%');
    el.style.transform = `perspective(900px) rotateX(${((0.5 - y) * 5).toFixed(2)}deg) rotateY(${((x - 0.5) * 6).toFixed(2)}deg) translateY(-2px)`;
  }, { passive: true });
  document.addEventListener('pointerleave', (e) => { if (e.target === cur) reset(); }, true);
})();
