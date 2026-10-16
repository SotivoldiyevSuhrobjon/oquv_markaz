/* Olimpiya akademiyasi — Django API bilan ishlaydigan interfeys (vanilla JS, build talab qilmaydi). */
'use strict';
const API = '/api';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Math.round(n || 0)).toLocaleString('ru-RU').replace(/ /g, ' ') + " so'm";
const today = () => new Date().toLocaleDateString('sv-SE');
const hhmm = (t) => (t || '').slice(0, 5);
const DN = { DCJ: 'Du-Chor-Ju', SPSh: 'Se-Pay-Sha' };
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
    if (d.refresh) { refresh = d.refresh; store().setItem('oqm_r', refresh); }
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
const ok = (m) => { S.msg = { t: 'ok', m }; };
const bad = (e) => { S.msg = { t: 'err', m: e.message || String(e) }; };

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
  access = null; refresh = null; S.me = null; S.mo = null; S.d = {};
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

async function enter() {
  S.view = tabs()[0][0];
  S.msg = null;
  await go(S.view);
  if (S.me.must_change_password) { S.mo = { t: 'pw', force: true }; render(); }
}

/* ---------- bo'limlar ---------- */
function tabs() {
  if (!S.me) return [];
  if (isT()) return [['dash', 'Guruhlarim'], ['att', 'Davomat'], ['sal', 'Oylik']];
  const t = [];
  if (can('dash')) t.push(['dash', 'Asosiy']);
  if (can('att')) t.push(['att', 'Davomat']);
  if (can('pay')) t.push(['pay', "To'lov"]);
  if (can('sal')) t.push(['sal', 'Oylik']);
  if (can('room')) t.push(['room', 'Xonalar']);
  if (can('stf')) t.push(['stf', 'Xodimlar']);
  if (can('new')) t.push(['new', 'Yangi']);
  if (can('arch')) t.push(['arch', 'Arxiv']);
  if (isAdmin()) t.push(['log', 'Tarix'], ['set', 'Sozlamalar']);
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
    if (!isT()) { [d.stats, d.conflicts] = await Promise.all([api('/groups/stats/'), api('/groups/conflicts/')]); }
    S.d.sf = S.d.sf || 'all';
  },
  async att() {
    await settings();
    const a = (S.d.att = S.d.att || { date: today(), marks: {} });
    a.groups = await list('/groups/');
    a.alerts = await api('/alerts/').then((x) => x.results || x).catch(() => []);
    if (a.group) await loadSheet(); else a.sheet = null;
  },
  async pay() {
    await settings();
    const p = (S.d.pay = S.d.pay || { ps: 'list', month: curMonth(), q: '' });
    if (p.ps === 'list') { const [ov, mr] = await Promise.all([api('/finance/overview/?month=' + p.month), api('/finance/month/?month=' + p.month)]); p.ov = ov; p.rows = mr.rows; p.closed = mr.closed; }
    if (p.ps === 'debt') p.debt = await api('/finance/debtors/?month=' + p.month);
    if (p.ps === 'cash') { [p.cash, p.sum] = await Promise.all([list('/cash/?month=' + p.month), api('/cash/summary/?month=' + p.month)]); }
  },
  async sal() {
    await settings();
    const s = (S.d.sal = S.d.sal || { month: curMonth() });
    if (isT()) s.me = await api('/salary/me/?month=' + s.month); else s.rows = await api('/salary/?month=' + s.month);
  },
  async room() { S.d.room = S.d.room || { days: 'DCJ' }; S.d.room.groups = await list('/groups/'); },
  async stf() {
    await subjects();
    const s = (S.d.stf = S.d.stf || { arch: false });
    s.staff = await list('/staff/' + (s.arch ? '?archived=1' : ''));
  },
  async new() { await subjects(); S.d.new = { groups: await list('/groups/') }; },
  async arch() { S.d.arch = { students: await list('/students/?archived=1'), groups: await list('/groups/') }; },
  async log() { S.d.log = await list('/audit/'); },
  async set() { const st = (S.d.set = S.d.set || { tab: 'gen' }); S.set = await api('/settings/'); S.subj = await list('/subjects/'); if (st.tab === 'perm') st.staff = await list('/staff/?archived=1'); },
};
async function loadSheet() {
  const a = S.d.att;
  a.sheet = await api(`/attendance/?group=${a.group}&date=${a.date}`);
  a.marks = {}; a.sheet.students.forEach((s) => { if (s.present !== null) a.marks[s.student] = s.present; });
}

/* ---------- chizish ---------- */
function render() {
  const hdr = document.querySelector('header'), app = $('#app');
  if (!S.me) {
    hdr.style.display = 'none'; app.className = 'full'; app.innerHTML = loginH(); $('#md').innerHTML = '';
    return;
  }
  hdr.style.display = ''; app.className = '';
  $('#nav').innerHTML = tabs().map(([k, l]) => `<button class="tab ${S.view === k ? 'on' : ''}" data-a="tab" data-v="${k}">${esc(l)}</button>`).join('');
  $('#who').textContent = `${S.me.full_name || S.me.username} · ${ROLE[S.me.role]}`;
  const msg = S.msg ? `<div class="card msg ${S.msg.t === 'err' ? 'err' : 'okm'}" role="alert">${S.msg.t === 'err' ? '⚠ ' : '✅ '}${esc(S.msg.m)}</div>` : '';
  app.innerHTML = msg + (S.loading ? '<div class="spin">Yuklanmoqda…</div>' : (V[S.view] ? V[S.view]() : ''));
  $('#md').innerHTML = S.mo ? modalH() : '';
}

function loginH() {
  const last = S.lu || safe(() => localStorage.getItem('oqm_user')) || '';
  return `<div class="lg"><div class="lg-art"><div class="scene"><div class="cube"><i class="f f1">π</i><i class="f f2">Aa</i><i class="f f3">∑</i><i class="f f4">Kids</i><i class="f f5">√x</i><i class="f f6">15</i></div></div><h1>Olimpiya akademiyasi</h1><p>Guruhlar, davomat, to'lov va xonalar — bitta joyda.</p></div>
  <form class="lg-f" data-f="login"><h2>Kirish</h2>${S.lerr ? `<div class="lo" role="alert">${esc(S.lerr)}</div>` : ''}
  <label>Login<input name="username" autocomplete="username" autocapitalize="none" value="${esc(last)}" required></label>
  ${pwField('password', 'Parol', 'current-password')}
  <label class="rm"><input type="checkbox" name="remember"> Shu qurilmada eslab qolish (30 kun)</label>
  <button class="btn pri" type="submit">Kirish</button><a href="#" data-about="1" class="mu" style="text-decoration:none">ℹ Dastur haqida</a></form></div>`;
}

const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
const subjOpts = (sel) => (S.subj || []).filter((s) => s.is_active).map((s) => opt(s.slug, s.name, sel)).join('');
const roomsOf = (groups) => [...new Set(['101', '102', '103', '104', '105', '106', '107', '108', '201', '202', '203', '204', ...groups.map((g) => g.room).filter(Boolean)])].sort();
const timeOf = (g) => (g.start_time ? hhmm(g.start_time) : '—');

/* ---------- ko'rinishlar ---------- */
const V = {
  dash() {
    const d = S.d.dash; if (!d) return '';
    const max = S.set ? S.set.max_group_size : 15;
    const sf = S.d.sf;
    const gs = d.groups.filter((g) => sf === 'all' || g.subject === sf);
    const stats = d.stats ? `<div class="grid intro">${d.stats.subjects.map((s) => `<div class="card sc"><div class="mu">${esc(s.name)}</div><div class="stat">${s.students}</div><div class="mu">${s.groups} ta guruh · o'quvchi</div></div>`).join('')}<div class="card sc"><div class="mu">Jadval to'qnashuvi</div><div class="stat ${d.stats.conflicts ? 'st0' : 'st2'}">${d.stats.conflicts}</div><div class="mu">ustma-ust tushishlar</div></div></div>` : '';
    const conf = d.conflicts && d.conflicts.length ? `<div class="card" style="margin-top:10px;border-color:var(--mid)"><b>⚠ Jadvalda ustma-ust tushishlar</b><ul style="margin:6px 0 0;padding-left:18px">${d.conflicts.slice(0, 12).map((c) => `<li>${esc(c.group + ": " + c.message)}</li>`).join('')}</ul></div>` : '';
    const al = d.alerts.length ? `<div class="card" style="margin-top:10px;border-color:var(--lo)"><b>🔔 3 tadan ko'p dars qoldirganlar (${d.alerts.length})</b><div class="mu">Ota-ona bilan bog'lanib, "Davomat" bo'limida izoh yozing.</div><div>${d.alerts.slice(0, 15).map((s) => `<span class="tag">${esc(s.name)} · ${s.absences ?? ''}</span> `).join('')}</div></div>` : '';
    const chips = `<div class="row"><button class="chip ${sf === 'all' ? 'on' : ''}" data-a="sf" data-v="all">Hammasi</button>${(S.subj || []).map((s) => `<button class="chip ${sf === s.slug ? 'on' : ''}" data-a="sf" data-v="${esc(s.slug)}">${esc(s.name)}</button>`).join('')}</div>`;
    const cards = gs.map((g) => `<div class="card gc" data-a="grp" data-v="${g.id}"><div class="row" style="margin:0"><b style="flex:1">${esc(g.name)}</b>${g.level ? `<span class="tag">${esc(g.level)}</span>` : ''}</div>
      <div class="mu">${g.room ? 'Xona ' + esc(g.room) : 'Xona yo‘q'} · ${DN[g.days] || '—'} · ${timeOf(g)}</div>
      <div>${g.teachers.map((t) => esc(t.name)).join(' + ') || '<span class="mu">O‘qituvchi yo‘q</span>'}</div>
      <div class="bar"><i style="width:${Math.min(100, (g.student_count / max) * 100)}%"></i></div><div class="mu">${g.student_count}/${max} o'quvchi · bo'sh joy ${Math.max(0, max - g.student_count)}</div></div>`).join('');
    return `${stats}${conf}${al}<h2>${isT() ? 'Guruhlarim' : 'Guruhlar'}</h2>${chips}<div class="grid">${cards || '<p class="mu">Hozircha guruh yo‘q. ' + (can('new') ? '"Yangi" bo‘limidan qo‘shing.' : '') + '</p>'}</div>`;
  },

  att() {
    const a = S.d.att; if (!a) return '';
    const canMark = S.me.role === 'teacher' || can('att') >= 2;
    const sh = a.sheet;
    let body = '<p class="mu">Guruhni tanlang.</p>';
    if (sh) {
      const rows = sh.students.map((s) => {
        const m = a.marks[s.student];
        const dis = sh.finalized || !canMark ? 'disabled' : '';
        return `<tr><td>${esc(s.name)}</td><td class="num">${s.absences ? `<span class="tag" style="color:var(--lo)">${s.absences} qoldirgan</span>` : '—'}</td>
        <td><button class="chip ${m === true ? 'on' : ''}" ${dis} data-a="mk" data-v="${s.student}:1">Keldi</button> <button class="chip ${m === false ? 'on' : ''}" style="${m === false ? 'background:var(--lo);border-color:var(--lo)' : ''}" ${dis} data-a="mk" data-v="${s.student}:0">Kelmadi</button></td></tr>`;
      }).join('');
      body = `<div class="row"><b>${sh.finalized ? '🔒 Yakunlangan' : 'Ochiq'}</b>${canMark && !sh.finalized ? '<button class="chip" data-a="allpres">Hammasi keldi</button><button class="btn pri" data-a="savemk">Saqlash</button><button class="btn" data-a="finmk">Yakunlash</button>' : ''}${sh.finalized && (isAdmin() || can('att') >= 2) ? '<button class="btn" data-a="reopenmk">Qayta ochish</button>' : ''}</div>
      <div class="wrap"><table><tr><th>O'quvchi</th><th>Qoldirgan</th><th>Davomat</th></tr>${rows || '<tr><td colspan="3" class="mu">Guruhda o‘quvchi yo‘q</td></tr>'}</table></div>
      <div class="demo">Yakunlangan davomat o'qituvchi oyligiga hisoblanadi va o'zgartirilmaydi.</div>`;
    }
    const alerts = a.alerts.length ? `<h2>🔔 Ota-ona bilan bog'lanish kerak</h2>${a.alerts.map((s) => `<form class="card" data-f="contact" data-id="${s.student}" style="margin:6px 0"><b>${esc(s.name)}</b> <span class="mu">${esc(s.phone || '')} · ${s.absences ?? ''} dars qoldirgan</span><div class="row" style="margin:6px 0 0"><input name="note" placeholder="Ota-onasi bilan nima gaplashdingiz?" style="flex:1;min-width:200px" required><button class="btn pri">Saqlash</button></div></form>`).join('')}` : '';
    return `<div class="card"><div class="row" style="margin:0"><select data-a="attg"><option value="">Guruh…</option>${a.groups.map((g) => opt(g.id, `${g.name} · ${timeOf(g)}`, a.group)).join('')}</select><input type="date" data-a="attd" value="${a.date}" max="${today()}"></div></div><div style="margin-top:10px">${body}</div>${alerts}`;
  },

  pay() {
    const p = S.d.pay; if (!p) return '';
    const ed = can('pay') >= 2;
    const mo = `<select data-a="paym">${months().map((m) => opt(m, mname(m), p.month)).join('')}</select>`;
    const tabsH = `<div class="row">${[['list', "O'quvchilar"], ['debt', 'Qarzdorlar'], ['cash', 'Kassa']].map(([k, l]) => `<button class="chip ${p.ps === k ? 'on' : ''}" data-a="pps" data-v="${k}">${l}</button>`).join('')}${mo}</div>`;
    if (p.ps === 'list') {
      const o = p.ov, q = (p.q || '').toLowerCase();
      const rows = p.rows.filter((r) => r.due || r.prev_debt).filter((r) => !q || r.name.toLowerCase().includes(q)).map((r) => `<tr class="gc" data-a="pst" data-v="${r.student}"><td><b>${esc(r.name)}</b><div class="mu">${esc(r.groups.join(', '))}</div></td><td class="num">${money(r.due)}${r.discount ? `<div class="mu">chegirma −${money(r.discount)}</div>` : ''}</td><td class="num">${money(r.paid)}</td><td class="num ${r.owe ? 'st0' : ''}">${money(r.owe)}</td><td class="num ${r.prev_debt ? 'st0' : ''}">${r.prev_debt ? money(r.prev_debt) : '—'}</td><td class="st${r.status === 'paid' ? 2 : r.status === 'partial' ? 1 : 0}">${r.status === 'paid' ? "✅ To'langan" : r.status === 'partial' ? '◐ Qisman' : '○ To‘lanmagan'}</td></tr>`).join('');
      return `${tabsH}<div class="grid intro"><div class="card sc"><div class="mu">Reja</div><div class="stat">${money(o.plan)}</div></div><div class="card sc"><div class="mu">To'langan</div><div class="stat st2">${money(o.paid)}</div></div><div class="card sc"><div class="mu">Qolgan qarz</div><div class="stat st0">${money(o.debt)}</div></div><div class="card sc"><div class="mu">Oldingi oylar qarzi</div><div class="stat">${money(o.prev_debt)}</div></div></div>
      <div class="row">${p.closed ? '<b>🔒 Oy yopilgan</b>' : ''}${ed && !p.closed ? '<button class="btn" data-a="closem">Oyni yopish</button>' : ''}${p.closed && isAdmin() ? '<button class="btn" data-a="reopenm">Qayta ochish</button>' : ''}<input data-a="payq" placeholder="Qidirish…" value="${esc(p.q || '')}" style="flex:1;min-width:140px"></div>
      <div class="wrap"><table><tr><th>O'quvchi</th><th>To'lov</th><th>To'langan</th><th>Qarz</th><th>Oldingi qarz</th><th>Holat</th></tr>${rows || '<tr><td colspan="6" class="mu">Bu oy uchun to‘lov yo‘q</td></tr>'}</table></div>`;
    }
    if (p.ps === 'debt') {
      const dd = p.debt;
      return `${tabsH}<h2>Qarzdorlar</h2><div class="wrap"><table><tr><th>O'quvchi</th><th>Umumiy qarz</th></tr>${dd.debtors.map((r) => `<tr class="gc" data-a="pst" data-v="${r.student}"><td>${esc(r.name)}</td><td class="num st0">${money(r.debt)}</td></tr>`).join('') || '<tr><td colspan="2" class="mu">Qarzdor yo‘q 🎉</td></tr>'}</table></div>
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
      return `${mo}<div class="card" style="max-width:420px"><h2 style="margin-top:0">${mname(s.month)}</h2>${r.rate !== null && r.rate !== undefined ? `<div>O'quvchi-kun: <b>${Math.round((r.student_days || 0) * 10) / 10}</b> × ${money(r.rate)}</div>` : ''}<div>Hisoblangan: <b>${money(r.accrued)}</b></div><div>To'langan: <b>${money(r.paid)}</b></div><div>Qolgan: <b>${money(r.left)}</b></div><div class="demo">Faqat yakunlangan darslar hisoblanadi.</div></div>`;
    }
    const ed = can('sal') >= 2;
    return `${mo}<div class="wrap"><table><tr><th>Xodim</th><th>Lavozim</th><th>O'quvchi-kun</th><th>Stavka</th><th>Hisoblangan</th><th>To'langan</th><th>Qolgan</th><th></th></tr>${s.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.role === 'support' ? 'Support' : "O'qituvchi"}</td><td class="num">${r.student_days === null ? '—' : Math.round(r.student_days * 10) / 10}</td><td class="num">${r.rate === null ? '—' : money(r.rate)}</td><td class="num">${money(r.accrued)}</td><td class="num">${money(r.paid)}</td><td class="num ${r.left ? 'st0' : ''}">${money(r.left)}</td><td>${ed && r.left > 0 ? `<button class="chip" data-a="paysal" data-v="${r.staff}">To'lash</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">Xodim yo‘q</td></tr>'}</table></div>`;
  },

  room() {
    const r = S.d.room; if (!r) return '';
    const rooms = roomsOf(r.groups);
    const hrs = HOURS.map((h) => +h.slice(0, 2)).concat([17, 18]);
    const gs = r.groups.filter((g) => g.days === r.days && g.start_time && g.room);
    const head = `<div class="row">${['DCJ', 'SPSh'].map((k) => `<button class="chip ${r.days === k ? 'on' : ''}" data-a="rdays" data-v="${k}">${DN[k]}</button>`).join('')}</div>`;
    const kidsLen = (g) => (S.subj || []).find((s) => s.slug === g.subject)?.is_kids ? 3 : 2;
    const cell = (room, h) => {
      const hit = gs.filter((g) => g.room === room && h >= +g.start_time.slice(0, 2) && h < +g.start_time.slice(0, 2) + kidsLen(g));
      return `<td class="cellb ${hit.length > 1 ? 'x' : hit.length ? 'o' : ''}">${hit.map((g) => esc(g.name)).join('<br>')}</td>`;
    };
    return `${head}<div class="wrap"><table><tr><th>Xona</th>${hrs.map((h) => `<th>${String(h).padStart(2, '0')}:00</th>`).join('')}</tr>${rooms.map((rm) => `<tr><th>${esc(rm)}</th>${hrs.map((h) => cell(rm, h)).join('')}</tr>`).join('')}</table></div><div class="demo">Qizil — bir xonada bir vaqtda ikki guruh. Kids 3 soat, qolganlari 2 soat band qiladi.</div>`;
  },

  stf() {
    const s = S.d.stf; if (!s) return '';
    const ed = can('stf') >= 2, sal = can('sal') >= 1;
    const form = ed ? `<form class="card fg" data-f="addstaff" style="margin-bottom:10px"><label>Lavozim<select name="role" data-a="rolesel"><option value="teacher">O'qituvchi</option><option value="support">Support teacher</option>${isAdmin() ? '<option value="administrator">O‘quv markaz administratori</option><option value="bugalter">Bugalter</option>' : ''}</select></label>
    <label>F.I.Sh<input name="full_name" required></label><label>Login<input name="username" autocapitalize="none" required></label>
    <label>Yo'nalish<select name="category"><option value="">—</option>${subjOpts('')}</select></label><label>Telefon<input name="phone" type="tel"></label><label>Tuman<input name="district"></label><label>Ishga kirgan<input name="work_from" type="date" value="${today()}"></label>
    ${can('sal') >= 2 ? `<label>Stavka (1 o'quvchi/1 dars) yoki oylik<input name="pay" type="number" step="1000" min="0"></label>` : ''}
    ${pwField('password', 'Parol (kamida 8 belgi, katta-kichik harf, raqam)')}<button type="button" class="chip" data-a="genpw">🔑 Parol yaratish</button><button class="btn pri">＋ Qo'shish</button></form>` : '';
    const rows = s.staff.map((u) => `<tr><td><b>${esc(u.full_name || u.username)}</b>${u.archived_at ? ' <span class="tag">arxiv</span>' : ''}</td><td>${esc(u.username)}</td><td>${ROLE[u.role]}</td><td>${esc(u.category || '—')}</td><td>${esc(u.phone || '—')}</td>${sal ? `<td class="num">${u.role === 'support' ? money(u.monthly_salary) + '/oy' : u.rate ? money(u.rate) : 'umumiy'}</td>` : ''}<td>${ed ? `<button class="chip" data-a="stedit" data-v="${u.id}">Tahrirlash</button> ${u.archived_at ? `<button class="chip" data-a="strest" data-v="${u.id}">Qaytarish</button>` : u.id !== S.me.id ? `<button class="chip" data-a="starch" data-v="${u.id}">Arxivlash</button>` : ''}` : ''}</td></tr>`).join('');
    return `${form}<div class="row"><label class="mu"><input type="checkbox" data-a="starchv" ${s.arch ? 'checked' : ''}> Arxivdagilarni ham ko'rsatish</label></div><div class="wrap"><table><tr><th>Xodim</th><th>Login</th><th>Lavozim</th><th>Yo'nalish</th><th>Telefon</th>${sal ? '<th>Stavka / oylik</th>' : ''}<th></th></tr>${rows}</table></div><div class="demo">Parollar xavfsizlik uchun hech qachon ko'rsatilmaydi — faqat yangisini belgilash mumkin.</div>`;
  },

  new() {
    const n = S.d.new; if (!n) return '';
    const sf = `<form class="card fg" data-f="addstu" style="margin-bottom:12px"><h2 style="grid-column:1/-1;margin:0">＋ Yangi o'quvchi</h2><label>F.I.Sh<input name="full_name" required></label><label>Telefon<input name="phone" type="tel" placeholder="+998901234567"></label><label>Tuman<input name="district"></label><label>Maktab sinfi<input name="class_name"></label><label>Darsni boshlagan sana<input type="date" name="started_on" value="${today()}" required></label>
    <label>Guruh<select name="group"><option value="">Keyin biriktiraman</option>${n.groups.map((g) => opt(g.id, `${g.name} (${g.student_count}/${S.set ? S.set.max_group_size : 15})`, '')).join('')}</select></label><label>Izoh<input name="note"></label><button class="btn pri">Qo'shish</button></form>`;
    const gf = can('room') >= 2 ? `<form class="card fg" data-f="addgrp"><h2 style="grid-column:1/-1;margin:0">＋ Yangi guruh</h2><label>Nomi<input name="name" required placeholder="Mat_6 / E11_A2 / Kids_uz9"></label><label>Yo'nalish<select name="subject">${subjOpts('')}</select></label><label>Daraja (English)<select name="level"><option value="">—</option>${LV.map((l) => `<option>${l}</option>`).join('')}</select></label><label>Xona<input name="room" list="rl"><datalist id="rl">${roomsOf(n.groups).map((r) => `<option>${r}</option>`).join('')}</datalist></label><label>Kunlar<select name="days"><option value="">—</option>${Object.entries(DN).map(([k, v]) => opt(k, v, '')).join('')}</select></label><label>Boshlanish<select name="start_time"><option value="">—</option>${HOURS.map((h) => `<option>${h}</option>`).join('')}</select></label><button class="btn pri">Guruh yaratish</button><div class="mu" style="grid-column:1/-1">Xona yoki o'qituvchi band bo'lsa, tizim bo'sh variantlarni taklif qiladi.</div></form>` : '';
    return sf + gf;
  },

  arch() {
    const a = S.d.arch; if (!a) return '';
    const ED = can('arch') >= 2, SL = { left: 'Ketgan', paused: "To'xtatilgan", later: 'Keyin boshlaydi' };
    return `<h2 style="margin-top:0">Arxiv</h2><div class="wrap"><table><tr><th>O'quvchi</th><th>Holat</th><th>Sabab</th><th>Boshlanish</th><th></th></tr>${a.students.map((s) => `<tr><td><b>${esc(s.full_name)}</b><div class="mu">${esc(s.phone || '')}</div></td><td>${SL[s.status] || s.status}</td><td>${esc(s.archive_reason || '—')}</td><td>${s.archive_start || '—'}</td><td>${ED ? `<form data-f="restore" data-id="${s.id}" class="row" style="margin:0"><select name="group"><option value="">Guruhsiz</option>${a.groups.map((g) => opt(g.id, g.name, '')).join('')}</select><button class="chip">Faollashtirish</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">Arxiv bo‘sh</td></tr>'}</table></div>`;
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
      const rows = accs.map((u) => `<form class="card" data-f="permsave" data-id="${u.id}" style="margin:8px 0"><div class="row" style="margin:0"><b style="flex:1">${esc(u.full_name || u.username)} <span class="tag">${ROLE[u.role]}</span> <span class="mu">${esc(u.username)}</span>${u.is_active ? '' : ' <span class="tag">arxiv</span>'}</b></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-top:8px">${SECS.map(([k, l]) => `<label class="mu">${l}<select name="perm_${k}" style="width:100%">${LV.map(([v, t]) => opt(v, t, u.perms && k in u.perms ? u.perms[k] : (DEFP[u.role] || {})[k] ?? 0)).join('')}</select></label>`).join('')}</div>
        <div class="row">${pwField('password', 'Yangi parol (ixtiyoriy)')}<button type="button" class="chip" data-a="genpw">🔑</button><button class="btn pri">Saqlash</button>${u.is_active ? `<button type="button" class="chip" data-a="starch2" data-v="${u.id}">Arxivlash</button>` : `<button type="button" class="chip" data-a="strest2" data-v="${u.id}">Qaytarish</button>`}</div></form>`).join('');
      return `${head}<p class="mu">Har bir boshqaruv akkaunti uchun qaysi bo'limni <b>ko'rishi</b> va qaysi bo'limni <b>o'zgartirishi</b> mumkinligini belgilang. Tarix va Sozlamalar faqat adminga. O'qituvchilar qat'iy qoidada: faqat o'z guruhlari, davomat va o'z oyligi.</p>${rows || '<p class="mu">Hozircha administrator/bugalter akkaunti yo‘q. Quyida yarating.</p>'}
      <form class="card fg" data-f="addstaff" style="margin-top:10px"><h2 style="grid-column:1/-1;margin:0">＋ Yangi boshqaruv akkaunti</h2><label>Lavozim<select name="role"><option value="administrator">O'quv markaz administratori</option><option value="bugalter">Bugalter</option></select></label><label>F.I.Sh<input name="full_name" required></label><label>Login<input name="username" autocapitalize="none" required></label>${pwField('password', 'Parol')}<button type="button" class="chip" data-a="genpw">🔑 Parol yaratish</button><button class="btn pri">＋ Yaratish</button><div class="mu" style="grid-column:1/-1">Standart ruxsatlar lavozimga qarab qo'yiladi, keyin yuqoridan o'zgartirasiz.</div></form>`;
    }
    const s = S.set;
    return `${head}<form class="card fg" data-f="setsave"><h2 style="grid-column:1/-1;margin:0">Umumiy sozlamalar</h2><label>Guruhdagi maksimum o'quvchi<input type="number" name="max_group_size" min="1" max="60" value="${s.max_group_size}"></label><label>Standart stavka (1 o'quvchi/1 dars), so'm<input type="number" name="default_rate" min="0" step="1000" value="${s.default_rate}"></label><label>Guruhsiz o'quvchi oylik narxi<input type="number" name="default_price" min="0" step="1000" value="${s.default_price}"></label><label>O'quv yili boshlanishi (YYYY-MM)<input name="academic_start" pattern="\\d{4}-\\d{2}" value="${esc(s.academic_start)}"></label><label>Oylar soni<input type="number" name="academic_months" min="1" max="24" value="${s.academic_months}"></label><button class="btn pri">Saqlash</button></form>`;
  },
};

/* ---------- modal ---------- */
function modalH() {
  const m = S.mo; if (!m) return '';
  const shell = (title, body, wide) => `<div class="modal" data-a="close"><div class="mb" data-a="stop" style="${wide ? 'max-width:760px' : 'max-width:460px'}" role="dialog" aria-modal="true"><div class="row" style="margin-top:0"><h2 style="margin:0;flex:1">${title}</h2>${m.force ? '' : '<button class="btn" data-a="close" aria-label="Yopish">✕</button>'}</div>${body}</div></div>`;
  if (m.t === 'pw') {
    return shell(m.force ? 'Parolni almashtiring' : 'Parolni o‘zgartirish', `${m.force ? '<p class="mu">Xavfsizlik uchun birinchi kirishda parolni yangilang.</p>' : ''}${S.msg && S.msg.t === 'err' ? `<div class="lo">${esc(S.msg.m)}</div>` : ''}<form data-f="chpw" class="fg" style="grid-template-columns:1fr">${pwField('old_password', 'Joriy parol', 'current-password')}${pwField('new_password', 'Yangi parol')}<div class="mu">Kamida 8 belgi: katta va kichik harf hamda raqam.</div><button class="btn pri">Saqlash</button></form>`);
  }
  if (m.t === 'grp') return groupModal(m, shell);
  if (m.t === 'pst') return payModal(m, shell);
  if (m.t === 'st') return staffModal(m, shell);
  if (m.t === 'sub') return shell(esc(m.x.name), `<form data-f="subsave" data-id="${m.x.id}" class="fg" style="grid-template-columns:1fr 1fr"><label>Nomi<input name="name" value="${esc(m.x.name)}" required></label><label>Guruh prefiksi<input name="prefix" value="${esc(m.x.prefix)}"></label><label>Oylik narx<input type="number" name="price" value="${m.x.price}" step="1000" min="0"></label><label>Kod<input value="${esc(m.x.slug)}" disabled></label><label><input type="checkbox" name="has_levels" ${m.x.has_levels ? 'checked' : ''}> A1–C2 darajalar bor</label><label><input type="checkbox" name="is_active" ${m.x.is_active ? 'checked' : ''}> Faol</label><button class="btn pri" style="grid-column:1/-1">Saqlash</button></form><div class="row"><button class="chip" data-a="subdel" data-v="${m.x.id}">Fanni o‘chirish</button></div>`);
  return '';
}

function groupModal(m, shell) {
  const g = m.g, st = m.students || [];
  const isKids = (S.subj || []).find((s) => s.slug === g.subject)?.is_kids;
  const hasLv = (S.subj || []).find((s) => s.slug === g.subject)?.has_levels;
  const eRoom = can('room') >= 2, eNew = can('new') >= 2, eArch = can('arch') >= 2, eStf = can('stf') >= 2;
  const sug = m.sug && m.sug.length ? `<div class="sug">${m.sug.map((x) => `<button type="button" class="chip" data-a="applysug" data-v="${esc(x.room)}|${esc(x.time)}">Xona ${esc(x.room)} · ${esc(x.time)}</button>`).join('')}</div>` : '';
  const err = m.err ? `<div class="card msg err">${m.err.map(esc).join('<br>')}</div>${sug}` : '';
  const sched = eRoom ? `<form data-f="gsched" class="fg" style="margin:8px 0"><label>Xona<input name="room" list="rl2" value="${esc(g.room)}"><datalist id="rl2">${roomsOf(m.all || [g]).map((r) => `<option>${r}</option>`).join('')}</datalist></label><label>Kunlar<select name="days"><option value="">—</option>${Object.entries(DN).map(([k, v]) => opt(k, v, g.days)).join('')}</select></label><label>Boshlanish<select name="start_time"><option value="">—</option>${HOURS.map((h) => opt(h, h, hhmm(g.start_time))).join('')}</select></label>${isKids ? `<label>Kids tartibi<select name="kids_order">${opt('M', 'Math → English', g.kids_order)}${opt('E', 'English → Math', g.kids_order)}</select></label>` : ''}${hasLv ? `<label>Daraja<select name="level"><option value="">—</option>${LV.map((l) => opt(l, l, g.level)).join('')}</select></label>` : ''}<button class="btn pri">Jadvalni saqlash</button></form>` : `<div class="mu">${g.room ? 'Xona ' + esc(g.room) : ''} · ${DN[g.days] || '—'} · ${timeOf(g)}</div>`;
  const tch = eStf && m.staff ? `<form data-f="gteach" class="fg" style="margin:8px 0"><label>${isKids ? 'English o‘qituvchisi' : 'O‘qituvchi'}<select name="t0"><option value="">—</option>${m.staff.teachers.map((u) => opt(u.id, u.full_name || u.username, g.teachers[0]?.id)).join('')}</select></label>${isKids ? `<label>Math o‘qituvchisi<select name="t1"><option value="">—</option>${m.staff.teachers.map((u) => opt(u.id, u.full_name || u.username, g.teachers[1]?.id)).join('')}</select></label>` : ''}<button class="btn pri">O‘qituvchini saqlash</button></form>
    ${isKids ? `<form data-f="gsup" class="row"><span class="mu">Support:</span>${m.staff.supports.map((u) => `<label class="mu"><input type="checkbox" name="s" value="${u.id}" ${g.supports.some((x) => x.id === u.id) ? 'checked' : ''}> ${esc(u.full_name || u.username)}</label>`).join('') || '<span class="mu">support yo‘q</span>'}<button class="chip">Saqlash</button></form>` : ''}` : `<div>${g.teachers.map((t) => esc(t.name)).join(' + ') || 'O‘qituvchi yo‘q'}</div>`;
  const rows = st.map((s) => `<tr><td>${esc(s.full_name)}<div class="mu">${esc(s.phone || '')}</div></td><td class="num">${s.absences ? `<span class="tag" style="color:var(--lo)">${s.absences}</span>` : '—'}</td><td>${eNew ? `<button class="chip" data-a="unenr" data-v="${s.id}">Guruhdan chiqarish</button>` : ''} ${eArch ? `<button class="chip" data-a="archform" data-v="${s.id}">Arxivga</button>` : ''}</td></tr>${m.arch === s.id ? `<tr><td colspan="3"><form data-f="archstu" data-id="${s.id}" class="row" style="margin:0"><select name="status"><option value="left">Ketgan</option><option value="paused">To'xtatilgan</option><option value="later">Keyin boshlaydi</option></select><input name="reason" placeholder="Sabab"><input type="date" name="start" title="'Keyin boshlaydi' uchun sana"><button class="btn pri">Arxivga o'tkazish</button></form></td></tr>` : ''}`).join('');
  const add = eNew ? `<form data-f="findstu" class="row"><input name="q" placeholder="Mavjud o‘quvchini qidirib qo‘shish…" style="flex:1"><button class="chip">Qidirish</button></form>${(m.found || []).map((s) => `<div class="row" style="margin:2px 0"><span style="flex:1">${esc(s.full_name)} <span class="mu">${s.groups.map((x) => esc(x.name)).join(', ')}</span></span><button class="chip" data-a="enr" data-v="${s.id}">＋ Qo'shish</button></div>`).join('')}` : '';
  const del = eRoom && !st.length ? '<div class="row"><button class="chip" data-a="grpdel">Guruhni o‘chirish</button></div>' : '';
  return shell(`${esc(g.name)} ${g.level ? `<span class="tag">${esc(g.level)}</span>` : ''}`, `${err}${sched}${tch}<h2>O'quvchilar (${st.length})</h2><div class="wrap"><table><tr><th>O'quvchi</th><th>Qoldirgan</th><th></th></tr>${rows || '<tr><td colspan="3" class="mu">Guruhda o‘quvchi yo‘q</td></tr>'}</table></div>${add}${del}`, true);
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
  return shell(esc(u.full_name || u.username), `<form data-f="stsave" data-id="${u.id}" class="fg" style="grid-template-columns:1fr 1fr"><label>F.I.Sh<input name="full_name" value="${esc(u.full_name)}"></label><label>Telefon<input name="phone" value="${esc(u.phone)}"></label><label>Tuman<input name="district" value="${esc(u.district)}"></label><label>Yo'nalish<select name="category"><option value="">—</option>${subjOpts(u.category)}</select></label>${sal ? `<label>${u.role === 'support' ? 'Oylik (so‘m)' : 'Stavka (so‘m)'}<input type="number" name="pay" step="1000" min="0" value="${(u.role === 'support' ? u.monthly_salary : u.rate) ?? ''}"></label>` : ''}${pwField('password', 'Yangi parol (bo‘sh = o‘zgarmaydi)')}<button type="button" class="chip" data-a="genpw">🔑 Yaratish</button>${perms}<button class="btn pri" style="grid-column:1/-1">Saqlash</button></form><div class="demo">Eski parolni ko'rib bo'lmaydi (xavfsizlik uchun faqat hash saqlanadi). Yangi parol berilsa, xodim birinchi kirishda uni almashtiradi.</div>`);
}

/* ---------- harakatlar (click) ---------- */
const DEFP = { administrator: { dash: 2, att: 2, pay: 1, sal: 0, room: 2, stf: 1, new: 2, arch: 2 }, bugalter: { dash: 1, att: 0, pay: 2, sal: 2, room: 0, stf: 0, new: 0, arch: 1 } };
const A = {
  stop() {},
  close(el, v, ev) { if (S.mo && S.mo.force) return; if (ev.target === el || el.tagName === 'BUTTON') { S.mo = null; S.msg = null; render(); } },
  eye(el) { const i = el.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; el.textContent = i.type === 'password' ? '👁' : '🙈'; },
  genpw(el) { const f = el.closest('form'), i = f.querySelector('input[name=password]'); i.value = genPw(); i.type = 'text'; const e = f.querySelector('.eye'); if (e) e.textContent = '🙈'; },
  tab: (el, v) => go(v),
  out: async () => { try { if (refresh) await post('/auth/logout/', { refresh }); } catch { /* chiqish baribir bajariladi */ } localLogout(); },
  profile() { S.mo = { t: 'pw' }; S.msg = null; render(); },
  sf(el, v) { S.d.sf = v; render(); },
  async grp(el, v) {
    const g = S.d.dash.groups.find((x) => x.id == v);
    S.mo = { t: 'grp', g, students: [], all: S.d.dash.groups }; render();
    await run(async () => { await loadGroupModal(); });
  },
  attg: (el) => run(async () => { S.d.att.group = el.value; if (el.value) await loadSheet(); else S.d.att.sheet = null; }),
  attd: (el) => run(async () => { S.d.att.date = el.value || today(); if (S.d.att.group) await loadSheet(); }),
  mk(el, v) { const [id, p] = v.split(':'); S.d.att.marks[id] = p === '1'; render(); },
  allpres() { S.d.att.sheet.students.forEach((s) => { S.d.att.marks[s.student] = true; }); render(); },
  savemk: () => run(async () => { await saveMarks(); ok('Davomat saqlandi'); }),
  finmk: () => run(async () => { await saveMarks(); await post('/attendance/finalize/', { group: +S.d.att.group, date: S.d.att.date }); await loadSheet(); ok('Davomat yakunlandi'); }),
  reopenmk: () => run(async () => { await post('/attendance/reopen/', { group: +S.d.att.group, date: S.d.att.date }); await loadSheet(); ok('Davomat qayta ochildi'); }),
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
  starchv: (el) => { S.d.stf.arch = el.checked; return go('stf'); },
  starch: (el, v) => run(async () => { if (!confirm('Xodimni arxivlaysizmi? U tizimga kira olmaydi.')) return; await post(`/staff/${v}/archive/`); await L.stf(); ok('Arxivlandi'); }),
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
  if (S.mo && S.mo.t === 'grp') { S.mo.all = gs; S.mo.g = gs.find((x) => x.id === S.mo.g.id) || S.mo.g; }
}
async function loadGroupModal() {
  const m = S.mo; await refreshGroups();
  m.students = await list(`/students/?group=${m.g.id}`);
  if (can('stf') >= 2 && !m.staff) { const [teachers, supports] = await Promise.all([list('/staff/?role=teacher'), list('/staff/?role=support')]); m.staff = { teachers, supports }; }
}
async function saveMarks() {
  const a = S.d.att, recs = Object.entries(a.marks).map(([s, p]) => ({ student: +s, present: p }));
  if (!recs.length) throw new Error('Avval davomatni belgilang');
  await post('/attendance/mark/', { group: +a.group, date: a.date, records: recs });
  await loadSheet();
}

/* ---------- formalar (submit) ---------- */
const num = (v) => (v === '' || v === undefined ? undefined : Number(v));
const F = {
  login: async (f) => { try { await login(f); } catch (e) { S.lerr = e.message; S.lu = f.username; render(); } },
  async contact(f, form) { await post(`/students/${form.dataset.id}/contacts/`, { note: f.note }); await L.att(); ok("Izoh saqlandi"); },
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
    try { S.mo.g = await patch(`/groups/${S.mo.g.id}/`, body); S.mo.err = null; S.mo.sug = null; await refreshGroups(); ok('Jadval saqlandi'); }
    catch (e) { if (e.data && e.data.schedule) { S.mo.err = e.data.schedule; S.mo.sug = e.data.suggestions || []; S.msg = null; } else throw e; }
  },
  async gteach(f) { const ids = [f.t0, f.t1].filter(Boolean).map(Number); const g = await post(`/groups/${S.mo.g.id}/teachers/`, { teachers: ids }); S.mo.g = g; await refreshGroups(); ok("O'qituvchi saqlandi"); },
  async gsup(f, form) { const ids = [...form.querySelectorAll('input[name=s]:checked')].map((i) => +i.value); S.mo.g = await post(`/groups/${S.mo.g.id}/supports/`, { supports: ids }); await refreshGroups(); ok('Support saqlandi'); },
  async findstu(f) { S.mo.found = (await list(`/students/?q=${encodeURIComponent(f.q)}`)).filter((s) => !s.groups.some((x) => x.id === S.mo.g.id)).slice(0, 8); },
  async archstu(f, form) { await post(`/students/${form.dataset.id}/archive/`, { status: f.status, reason: f.reason, start: f.start || null }); S.mo.arch = null; await loadGroupModal(); ok('Arxivga o‘tkazildi'); },
  async addstaff(f, form) {
    const body = { username: f.username.trim(), full_name: f.full_name, role: f.role, category: f.category, phone: f.phone, district: f.district, work_from: f.work_from || null, password: f.password };
    if (f.pay) body[f.role === 'support' ? 'monthly_salary' : 'rate'] = +f.pay;
    await post('/staff/', body); await (S.view === 'set' ? L.set() : L.stf()); ok(`${f.full_name} qo'shildi. Login: ${f.username}. Birinchi kirishda parolni almashtiradi.`);
  },
  async stsave(f, form) {
    const u = S.mo.u, body = { full_name: f.full_name, phone: f.phone, district: f.district, category: f.category };
    if (f.pay !== undefined && f.pay !== '') body[u.role === 'support' ? 'monthly_salary' : 'rate'] = +f.pay;
    if (f.password) body.password = f.password;
    if (u.role === 'administrator' || u.role === 'bugalter') body.perms = Object.fromEntries(SECS.map(([k]) => [k, +f['perm_' + k]]));
    await patch(`/staff/${form.dataset.id}/`, body); S.mo = null; await L.stf(); ok('Saqlandi');
  },
  async addstu(f) {
    const body = { full_name: f.full_name, phone: f.phone, district: f.district, class_name: f.class_name, note: f.note, started_on: f.started_on };
    if (f.group) body.group = +f.group; await post('/students/', body); await L.new(); ok(`${f.full_name} qo'shildi`);
  },
  async addgrp(f) {
    try { await post('/groups/', { name: f.name, subject: f.subject, level: f.level, room: f.room, days: f.days, start_time: f.start_time || null }); await L.new(); ok(`${f.name} guruhi yaratildi`); }
    catch (e) { if (e.data && e.data.schedule) throw new Error(e.data.schedule.join('; ') + (e.data.suggestions && e.data.suggestions.length ? '. Bo‘sh variantlar: ' + e.data.suggestions.slice(0, 4).map((x) => `xona ${x.room} ${x.time}`).join(', ') : '')); throw e; }
  },
  async restore(f, form) { await post(`/students/${form.dataset.id}/restore/`, f.group ? { group: +f.group } : {}); await L.arch(); ok('Faollashtirildi'); },
  async setsave(f) { S.set = await patch('/settings/', { max_group_size: +f.max_group_size, default_rate: +f.default_rate, default_price: +f.default_price, academic_start: f.academic_start, academic_months: +f.academic_months }); ok('Sozlamalar saqlandi'); },
  async subsave(f, form) { await patch(`/subjects/${form.dataset.id}/`, { name: f.name, prefix: f.prefix, price: +f.price, has_levels: !!f.has_levels, is_active: !!f.is_active }); S.mo = null; S.subj = await list('/subjects/'); ok('Fan saqlandi'); },
  async permsave(f, form) { const body = { perms: Object.fromEntries(SECS.map(([k]) => [k, +f['perm_' + k]])) }; if (f.password) body.password = f.password; await patch(`/staff/${form.dataset.id}/`, body); await L.set(); ok('Ruxsatlar saqlandi'); },
  async addsub(f) { await post('/subjects/', { name: f.name, slug: f.slug, prefix: f.prefix, price: +f.price, has_levels: !!f.has_levels }); S.subj = await list('/subjects/'); ok("Fan qo'shildi"); },
};

/* ---------- hodisalar ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  if (t.tagName === 'A') e.preventDefault();
  const a = t.dataset.a;
  if (['paym', 'attg', 'attd', 'salm', 'payq', 'starchv', 'rolesel'].includes(a) && (t.tagName === 'SELECT' || t.tagName === 'INPUT')) return; // 'change'/'input' da ishlaydi
  if (!A[a]) return;
  if (a !== 'close' && a !== 'stop' && a !== 'eye' && a !== 'genpw') S.msg = null;
  const r = A[a](t, t.dataset.v, e);
  if (r && r.catch) r.catch((x) => { bad(x); render(); });
});
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-a]'); if (!t || !['paym', 'attg', 'attd', 'salm', 'starchv'].includes(t.dataset.a)) return;
  A[t.dataset.a](t, t.dataset.v, e);
});
document.addEventListener('input', (e) => { const t = e.target; if (t.dataset && t.dataset.a === 'payq') A.payq(t); });
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
