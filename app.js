const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Math.round(n || 0).toLocaleString('en-US') + ' RWF';
const compact = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayName = (d) => t('d_' + DAY_KEYS[d]);
const CATS = ['Food', 'Transport', 'Data/Airtime', 'School', 'Savings', 'Other', 'Income'];
const TYPES = ['sent', 'received', 'paid', 'withdrawn', 'other'];
const SPEND = ['sent', 'paid', 'withdrawn', 'other'];
const catLabel = (c) => t('cat_' + c);
const COLORS = ['#2F6BFF', '#3DDBA6', '#F5B942', '#8B7CF6', '#F0709B', '#5BC0EB', '#94A3B8'];

let sb = null;          // Supabase client (null = demo mode)
let uid = null;         // current user id
let txns = [], tt = [], settings = { budget: 0, cash: 0, savings: 0, debts: 0 };
let quickCat = 'Food';

// ---------- storage (separate per user, on this device) ----------
const key = (k) => `${uid}:${k}`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(key(k))) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) {} };

// ---------- theme and language ----------
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) {}
}

function setLang(l) {
  lang = l;
  try { localStorage.setItem('lang', l); } catch (e) {}
  applyI18n();
  fillSelects();
  buildChips();
  if (uid) render();
}

function fillSelects() {
  const keep = (sel, html) => { const v = $(sel).value; $(sel).innerHTML = html; if (v) $(sel).value = v; };
  keep('#f_cat', CATS.map((c) => `<option value="${c}">${esc(catLabel(c))}</option>`).join(''));
  keep('#f_type', TYPES.map((x) => `<option value="${x}">${esc(t('ty_' + x))}</option>`).join(''));
  keep('#c_day', [1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}">${esc(dayName(d))}</option>`).join(''));
}

// ---------- auth ----------
const BUILD = 'v5';

// Returns a message key describing what is wrong with a URL + key pair, or null if both look fine.
function checkCfg(u, k) {
  const url = String(u || '').trim(), key = String(k || '').trim();
  if (!url || url.startsWith('YOUR_')) return 'cfg_url_ph';
  if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(url) || /\/\/(www\.)?supabase\.com/i.test(url)) return 'cfg_url_bad';
  if (!key || key.startsWith('YOUR_')) return 'cfg_key_ph';
  if (key.startsWith('sb_secret_')) return 'cfg_key_secret';
  if (key.startsWith('sb_publishable_')) return null;
  if (key.startsWith('eyJ')) {
    try {
      const body = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (body.role === 'service_role') return 'cfg_key_secret';
      return null;
    } catch (e) { return 'cfg_key_bad'; }
  }
  return 'cfg_key_bad';
}
// Settings come from config.js, or (if that is missing/wrong) from the box on the login screen.
let activeCfg = null, memCfg = null;
function configProblem() {
  const fu = window.SUPABASE_URL, fk = window.SUPABASE_ANON_KEY;
  const fileProblem = (fu === undefined && fk === undefined) ? 'cfg_nofile' : checkCfg(fu, fk);
  if (!fileProblem) { activeCfg = { url: fu, key: fk }; return null; }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('sbcfg')); } catch (e) {}
  for (const c of [memCfg, saved]) {
    if (c && c.url && c.key && !checkCfg(c.url, c.key)) { activeCfg = c; return null; }
  }
  return fileProblem;
}
const hasConfig = () => configProblem() === null;

async function saveCfg() {
  const url = $('#cfg_url').value.trim().replace(/\/$/, ''), key = $('#cfg_key').value.trim();
  const p = checkCfg(url, key);
  if (p) return authMsg(p);
  memCfg = { url, key };
  try { localStorage.setItem('sbcfg', JSON.stringify(memCfg)); } catch (e) {}
  sb = null;
  if (!(await needSb())) return;
  $('#setup').hidden = true;
  authMsg('setup_saved', 'ok');
  const { data } = await sb.auth.getSession();
  if (data.session) enter(data.session.user);
}

// The Supabase library is loaded in the background, so a slow or blocked
// network can never freeze the page (buttons keep working without it).
let libPromise = null;
function loadLib() {
  if (window.supabase) return Promise.resolve(true);
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    const timer = setTimeout(() => { libPromise = null; resolve(false); }, 8000);
    s.onload = () => { clearTimeout(timer); resolve(!!window.supabase); };
    s.onerror = () => { clearTimeout(timer); libPromise = null; resolve(false); };
    document.head.appendChild(s);
  });
  return libPromise;
}

async function ensureSb() {
  if (sb) return true;
  if (!hasConfig() || !(await loadLib())) return false;
  sb = window.supabase.createClient(String(activeCfg.url).trim().replace(/\/$/, ''), String(activeCfg.key).trim());
  return true;
}

// returns true if Supabase is ready, otherwise shows the right message
async function needSb() {
  const problem = configProblem();
  if (problem) { authMsg(problem, 'info'); $('#demo_wrap').hidden = false; $('#setup').hidden = false; return false; }
  if (!(await ensureSb())) { authMsg('m_nolib', 'info'); $('#demo_wrap').hidden = false; return false; }
  return true;
}

function authMsg(text, kind = 'err') {
  const m = $('#auth_msg');
  if (!text) { m.hidden = true; return; }
  m.textContent = I18N.en[text] !== undefined ? t(text) : text;
  m.className = 'msg ' + kind;
  m.hidden = false;
}

function authTab(which) {
  $('#form_login').hidden = which !== 'login';
  $('#form_signup').hidden = which !== 'signup';
  $('#tab_login').classList.toggle('on', which === 'login');
  $('#tab_signup').classList.toggle('on', which === 'signup');
  authMsg('');
}

function showAuth() {
  uid = null;
  $('#app').hidden = true;
  $('#fab').hidden = true;
  $('#auth').hidden = false;
}

function enter(user, name) {
  uid = user.id;
  txns = load('txns', []);
  tt = load('tt', []);
  settings = load('set', { budget: 0, cash: 0, savings: 0, debts: 0 });
  $('#hello').textContent = name || user.user_metadata?.name || (user.email || 'there').split('@')[0];
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#fab').hidden = false;
  showTab('dash');
}

// Phone login: the phone number becomes a hidden login name (number@ALIAS_DOMAIN)
// stored in Supabase's email field, so no SMS provider is needed.
const ALIAS_DOMAIN = 'phone.moneyapp.rw';

function normalizePhone(v) {
  const d = String(v).replace(/\D/g, '');
  let n = null;
  if (d.length === 12 && d.startsWith('250')) n = d;
  else if (d.length === 10 && d.startsWith('0')) n = '250' + d.slice(1);
  else if (d.length === 9 && d.startsWith('7')) n = '250' + d;
  return n && /^2507\d{8}$/.test(n) ? n : null;
}

// Accepts a phone number or a normal email; returns the email Supabase should use.
function loginEmail(input) {
  const v = String(input).trim();
  if (v.includes('@')) return v;
  const p = normalizePhone(v);
  return p ? `${p}@${ALIAS_DOMAIN}` : null;
}

async function doLogin(e) {
  e.preventDefault();
  authMsg('');
  if (!(await needSb())) return;
  const email = loginEmail($('#l_email').value);
  if (!email) return authMsg('m_badphone');
  const { data, error } = await sb.auth.signInWithPassword({ email, password: $('#l_pass').value });
  if (error) return authMsg(error.message);
  enter(data.user);
}

async function doSignup(e) {
  e.preventDefault();
  authMsg('');
  if ($('#s_pass').value !== $('#s_pass2').value) return authMsg('m_mismatch');
  if (!(await needSb())) return;
  const phone = normalizePhone($('#s_phone').value);
  if (!phone) return authMsg('m_badphone');
  const { data, error } = await sb.auth.signUp({
    email: `${phone}@${ALIAS_DOMAIN}`, password: $('#s_pass').value,
    options: { data: { name: $('#s_name').value.trim(), phone } },
  });
  if (error) return authMsg(error.message);
  if (data.session) return enter(data.user, $('#s_name').value.trim());
  authTab('login');
  authMsg('m_created', 'ok');
}

async function doForgot() {
  const email = $('#l_email').value.trim();
  if (!(await needSb())) return;
  if (!email) return authMsg('m_typeemail', 'info');
  if (!email.includes('@')) return authMsg('m_phone_reset', 'info');
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) authMsg(error.message); else authMsg('m_reset', 'ok');
}

async function doLogout() {
  if (sb) await sb.auth.signOut();
  showAuth();
}

// ---------- helpers ----------
function weekStart() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function showTab(name) {
  document.querySelectorAll('main section').forEach((s) => (s.hidden = s.id !== name));
  document.querySelectorAll('nav.bottom button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  render();
}

function render() {
  if (!uid) return;
  renderDashboard();
  renderTxns();
  renderTimetable();
  $('#budget').value = settings.budget || '';
  $('#cash').value = settings.cash || '';
  $('#savings').value = settings.savings || '';
  $('#debts').value = settings.debts || '';
}

// ---------- charts (plain SVG, no libraries) ----------
function barChart(vals, labels, todayIdx) {
  const W = 320, H = 160, top = 18, bottom = 22, bw = 28;
  const gap = (W - 7 * bw) / 8;
  const max = Math.max(...vals, 1);
  const plotH = H - top - bottom;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
  s += `<line class="axis" x1="0" y1="${H - bottom}" x2="${W}" y2="${H - bottom}"/>`;
  vals.forEach((v, i) => {
    const h = (v / max) * plotH;
    const x = gap + i * (bw + gap);
    const y = H - bottom - h;
    s += `<rect class="bar${i === todayIdx ? ' today' : ''}" x="${x}" y="${y}" width="${bw}" height="${v > 0 ? Math.max(h, 2) : 0}" rx="5"/>`;
    if (v > 0) s += `<text class="val" x="${x + bw / 2}" y="${y - 4}" text-anchor="middle">${compact(v)}</text>`;
    s += `<text class="lbl" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  return s + '</svg>';
}

function donut(entries, total) {
  const r = 42, C = 2 * Math.PI * r;
  let off = 0;
  let s = `<svg viewBox="0 0 120 120" class="donut" role="img"><circle class="ring" cx="60" cy="60" r="${r}"/>`;
  if (total > 0) {
    entries.forEach(([, v], i) => {
      const len = (v / total) * C;
      s += `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
      off += len;
    });
  }
  s += `<text class="dtot" x="60" y="65" text-anchor="middle">${compact(total)}</text></svg>`;
  return s;
}

// ---------- screens ----------
function renderDashboard() {
  const wk = txns.filter((tx) => new Date(tx.date) >= weekStart());
  const spendTx = wk.filter((tx) => SPEND.includes(tx.type));
  const spent = spendTx.reduce((a, tx) => a + tx.amount + (tx.fee || 0), 0);
  const income = wk.filter((tx) => tx.type === 'received').reduce((a, tx) => a + tx.amount, 0);
  const left = settings.budget - spent;
  const pct = settings.budget ? Math.min(100, (spent / settings.budget) * 100) : 0;
  const todayIdx = (new Date().getDay() + 6) % 7;
  const daysLeft = 7 - todayIdx;

  const byCat = {};
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  spendTx.forEach((tx) => {
    const v = tx.amount + (tx.fee || 0);
    byCat[tx.category] = (byCat[tx.category] || 0) + v;
    perDay[(new Date(tx.date).getDay() + 6) % 7] += v;
  });
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const advice = [];
  if (!settings.budget) advice.push(t('a_setbudget'));
  else if (left < 0) advice.push(t('a_over', fmt(-left)));
  else {
    advice.push(t('a_used', pct.toFixed(0), fmt(left / daysLeft), daysLeft));
    if (pct > 60 && daysLeft > 3) advice.push(t('a_slow'));
  }
  if (entries[0] && spent > 0 && entries[0][1] / spent > 0.4) advice.push(t('a_top', catLabel(entries[0][0]), ((entries[0][1] / spent) * 100).toFixed(0)));

  const lastBal = txns.filter((tx) => tx.balance != null).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const mobile = lastBal ? lastBal.balance : 0;
  const assets = mobile + settings.cash + settings.savings;
  const net = assets - settings.debts;

  const today = new Date().getDay();
  const classes = tt.filter((c) => c.day === today).sort((a, b) => a.start.localeCompare(b.start));
  const labels = [1, 2, 3, 4, 5, 6, 0].map(dayName);

  $('#dash').innerHTML = `
    <div class="hero">
      <div class="hero-label">${t('left_week')}</div>
      <div class="hero-amt">${fmt(left)}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="hero-row"><span>${t('spent')} ${fmt(spent)}</span><span>${t('budget')} ${fmt(settings.budget)}</span></div>
      ${settings.budget && left > 0 ? `<div class="safe">${t('safe_today')}: <b>${fmt(left / daysLeft)}</b></div>` : ''}
    </div>
    <div class="card"><h3>${t('todays_plan')} (${dayName(today)})</h3>
      ${classes.length ? classes.map((c) => `<div class="cls"><time>${esc(c.start)}-${esc(c.end)}</time><span>${esc(c.course)} ${esc(c.room)}</span></div>`).join('') : `<div class="empty">${t('no_class')}</div>`}
    </div>
    <div class="card advice"><h3>${t('advice')}</h3>${advice.map((a) => `<p>${esc(a)}</p>`).join('')}</div>
    <div class="card"><h3>${t('daily_chart')}</h3>${barChart(perDay, labels, todayIdx)}</div>
    <div class="card"><h3>${t('by_cat')}</h3>
      <div class="donut-wrap">${donut(entries, spent)}
        <ul class="legend">${entries.map(([c, v], i) =>
          `<li><i style="background:${COLORS[i % COLORS.length]}"></i><span>${esc(catLabel(c))}</span><b>${fmt(v)}</b><small>${((v / spent) * 100).toFixed(0)}%</small></li>`).join('') || `<li class="empty">${t('no_data')}</li>`}
        </ul></div></div>
    <div class="card"><h3>${t('income_vs')}</h3><table>
      <tr><td>${t('income')}</td><td>${fmt(income)}</td></tr><tr><td>${t('spending')}</td><td>${fmt(spent)}</td></tr>
      <tr><td><b>${t('net')}</b></td><td><b>${fmt(income - spent)}</b></td></tr></table></div>
    <div class="card"><h3>${t('balance_sheet')}</h3><table>
      <tr><th colspan="2">${t('assets')}</th></tr>
      <tr><td>${t('mobile_money')}</td><td>${fmt(mobile)}</td></tr>
      <tr><td>${t('cash')}</td><td>${fmt(settings.cash)}</td></tr>
      <tr><td>${t('savings')}</td><td>${fmt(settings.savings)}</td></tr>
      <tr><td><b>${t('total_assets')}</b></td><td><b>${fmt(assets)}</b></td></tr>
      <tr><th colspan="2">${t('liabilities')}</th></tr>
      <tr><td>${t('debts')}</td><td>${fmt(settings.debts)}</td></tr>
      <tr><td><b>${t('net_worth')}</b></td><td><b>${fmt(net)}</b></td></tr></table></div>`;
}

function renderTxns() {
  const rows = [...txns].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 50);
  $('#txlist').innerHTML = rows.map((tx) =>
    `<tr><td>${esc(tx.date.slice(0, 10))}</td><td>${esc(t('ty_' + tx.type))}</td><td>${esc(catLabel(tx.category))}</td><td>${fmt(tx.amount)}</td>
     <td><button class="btn small navy" onclick="delTx('${tx.id}')">x</button></td></tr>`).join('') || `<tr><td class="empty">${t('no_tx')}</td></tr>`;
}

function renderTimetable() {
  const order = (d) => (d + 6) % 7;
  const rows = [...tt].sort((a, b) => order(a.day) - order(b.day) || a.start.localeCompare(b.start));
  $('#ttlist').innerHTML = rows.map((c) =>
    `<tr><td>${esc(dayName(c.day))}</td><td>${esc(c.start)}-${esc(c.end)}</td><td>${esc(c.course)}</td><td>${esc(c.room)}</td>
     <td><button class="btn small navy" onclick="delClass('${c.id}')">x</button></td></tr>`).join('') || `<tr><td class="empty">${t('no_class_yet')}</td></tr>`;
}

// ---------- actions ----------
function parseNow() {
  const p = parseSms($('#sms').value);
  $('#f_amount').value = p.amount ?? '';
  $('#f_fee').value = p.fee ?? 0;
  $('#f_balance').value = p.balance ?? '';
  $('#f_type').value = p.type;
  $('#f_cat').value = p.category;
  $('#f_date').value = p.date;
  $('#f_who').value = p.who;
  $('#parsed').hidden = false;
}

function saveTx() {
  const amount = parseFloat($('#f_amount').value);
  if (!amount) return alert(t('amount_req'));
  txns.push({
    id: String(Date.now()), amount, fee: parseFloat($('#f_fee').value) || 0,
    balance: $('#f_balance').value === '' ? null : parseFloat($('#f_balance').value),
    type: $('#f_type').value, category: $('#f_cat').value, date: $('#f_date').value,
    who: $('#f_who').value, raw: $('#sms').value,
  });
  save('txns', txns);
  $('#sms').value = '';
  $('#parsed').hidden = true;
  showTab('dash');
}

function delTx(id) { txns = txns.filter((tx) => tx.id !== id); save('txns', txns); render(); }
function delClass(id) { tt = tt.filter((c) => c.id !== id); save('tt', tt); render(); }

function addClass() {
  const course = $('#c_course').value.trim();
  if (!course) return;
  tt.push({ id: String(Date.now()), day: +$('#c_day').value, start: $('#c_start').value, end: $('#c_end').value, course, room: $('#c_room').value });
  save('tt', tt);
  $('#c_course').value = '';
  $('#c_room').value = '';
  render();
}

function saveSettings() {
  settings = { budget: +$('#budget').value || 0, cash: +$('#cash').value || 0, savings: +$('#savings').value || 0, debts: +$('#debts').value || 0 };
  save('set', settings);
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify({ txns, tt, settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'money-backup.json';
  a.click();
}

// ---------- quick add (floating + button) ----------
function buildChips() {
  $('#q_chips').innerHTML = CATS.filter((c) => c !== 'Income')
    .map((c) => `<button type="button" class="chip${c === quickCat ? ' on' : ''}" data-cat="${c}">${esc(catLabel(c))}</button>`).join('');
}

function openSheet() {
  $('#q_amount').value = '';
  $('#q_note').value = '';
  quickCat = 'Food';
  buildChips();
  $('#sheet').hidden = false;
  setTimeout(() => $('#q_amount').focus(), 50);
}

function closeSheet() { $('#sheet').hidden = true; }

function saveQuick() {
  const amount = parseFloat($('#q_amount').value);
  if (!amount) return $('#q_amount').focus();
  const d = new Date();
  const date = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  txns.push({ id: String(Date.now()), amount, fee: 0, balance: null, type: 'other', category: quickCat, date, who: $('#q_note').value.trim(), raw: '' });
  save('txns', txns);
  closeSheet();
  render();
}

// ---------- start ----------
window.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  fillSelects();
  buildChips();
  document.querySelectorAll('nav.bottom button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  document.querySelectorAll('.js-lang').forEach((b) => (b.onclick = () => setLang(lang === 'en' ? 'rw' : 'en')));
  document.querySelectorAll('.js-theme').forEach((b) => (b.onclick = toggleTheme));

  $('#tab_login').onclick = () => authTab('login');
  $('#tab_signup').onclick = () => authTab('signup');
  $('#form_login').addEventListener('submit', doLogin);
  $('#form_signup').addEventListener('submit', doSignup);
  $('#forgot').onclick = doForgot;
  $('#logout').onclick = doLogout;
  $('#demo').onclick = () => enter({ id: 'demo', email: 'demo' }, 'Demo');

  $('#fab').onclick = openSheet;
  $('#q_cancel').onclick = closeSheet;
  $('#q_save').onclick = saveQuick;
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  $('#q_chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    quickCat = b.dataset.cat;
    buildChips();
  });
  $('#q_amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveQuick(); });

  $('#build').textContent = 'Build ' + BUILD;
  $('#cfg_save').onclick = saveCfg;

  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}

  if (hasConfig()) {
    if (await ensureSb()) {
      const { data } = await sb.auth.getSession();
      if (data.session) enter(data.session.user);
    } else {
      authMsg('m_nolib', 'info');
      $('#demo_wrap').hidden = false;
    }
  } else {
    $('#demo_wrap').hidden = false;
    $('#setup').hidden = false;
    authMsg(configProblem(), 'info');
  }
});