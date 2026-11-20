/* מכינת נהריה — מערכת ניהול חניכים, הורים, נוכחות והודעות.
   עמוד אחד, ניתוב לפי # (#/students, #/s/<id>, #/attendance ...). הנתונים ב-Supabase,
   ורק הצוות (טבלת staff) רואה אותם — זה נאכף במסד (RLS), לא כאן. */
(function () {
  'use strict';
  var L = window.Logic;
  var cfg = window.APP_CONFIG || {};
  var ATT_DAYS = 60;          // כמה ימי נוכחות אחורה נטענים
  var STREAK_ALERT = 3;       // מכמה חיסורים ברצף מתריעים
  var BIRTHDAY_DAYS = 7;      // כמה ימים קדימה מראים ימי הולדת
  var STATUS = { present: 'נוכח', late: 'איחור', absent: 'חיסור', excused: 'מאושר' };
  var STATUS_LONG = { present: 'נוכח/ת', late: 'איחר/ה', absent: 'חיסר/ה', excused: 'היעדרות מאושרת' };

  var $view, $nav, sb;
  var S = { me: null, email: '', staff: [], groups: [], students: [], att: {}, days: [], templates: [], loadedAt: 0, errors24: 0 };
  var ui = { q: '', sent: {}, msg: null };

  // ---------- עזרים ----------
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function today() { return L.israelToday(); }
  function fullName(s) { return (s.first_name + ' ' + (s.last_name || '')).trim(); }
  function initial(s) { return esc((s.first_name || '?').trim().charAt(0)); }
  function groupName(id) { var g = S.groups.filter(function (x) { return x.id === id; })[0]; return g ? g.name : ''; }
  function staffName(id) { var p = S.staff.filter(function (x) { return x.user_id === id; })[0]; return p ? (p.name || p.email || 'איש צוות') : ''; }
  function byName(a, b) { return fullName(a).localeCompare(fullName(b), 'he'); }
  function active() { return S.students.filter(function (s) { return s.active; }).sort(byName); }
  function stamp(v) {
    if (!v) return '—';
    var d = new Date(v);
    return d.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function isAdmin() { return S.me && S.me.role === 'admin'; }
  function route() {
    var h = location.hash.replace(/^#/, '') || '/';
    var i = h.indexOf('?');
    return { path: i < 0 ? h : h.slice(0, i), q: new URLSearchParams(i < 0 ? '' : h.slice(i + 1)) };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function friendly(err) {
    var m = String((err && err.message) || err || '');
    if (/fetch|network|Load failed/i.test(m)) return 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.';
    if (/not authorized|permission denied|row-level security/i.test(m)) return 'אין הרשאה לפעולה הזאת.';
    if (/duplicate key|unique/i.test(m)) return 'כבר קיים פריט בשם הזה.';
    if (/Invalid login credentials/i.test(m)) return 'המייל או הסיסמה לא נכונים.';
    if (/Email not confirmed/i.test(m)) return 'המייל עוד לא אושר. בקשו מהמנהל לאשר את המשתמש.';
    if (/rate limit|too many/i.test(m)) return 'יותר מדי ניסיונות. חכו כמה דקות ונסו שוב.';
    return 'משהו השתבש: ' + m;
  }
  // כל קריאה לשרת עוברת כאן: שגיאה נרשמת בניטור ונזרקת הלאה עם הודעה ברורה
  async function q(promise, what) {
    var r = await promise;
    if (r.error) {
      if (window.logIssue) window.logIssue((what || 'פעולה') + ' נכשלה: ' + r.error.message);
      throw r.error;
    }
    return r.data;
  }
  // PostgREST מחזיר עד 1000 שורות בכל פעם — טוענים בדפים
  async function fetchAll(make, what) {
    var out = [], size = 1000;
    for (var from = 0; ; from += size) {
      var rows = await q(make().range(from, from + size - 1), what);
      out = out.concat(rows);
      if (rows.length < size) return out;
    }
  }

  // ---------- אייקונים (סגנון Lucide, קו 2) ----------
  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    msg: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
    gear: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    back: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    prev: '<path d="m9 18 6-6-6-6"/>',
    next: '<path d="m15 18-6-6 6-6"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>'; }
  var LOGO = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#0b5d8f"/><path d="M20 7.5l2.1 4.4 4.8.6-3.5 3.3.9 4.8-4.3-2.4-4.3 2.4.9-4.8-3.5-3.3 4.8-.6z" fill="#fff"/><path d="M8 26c3-3 5-3 8 0s5 3 8 0 5-3 8 0" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M8 32c3-3 5-3 8 0s5 3 8 0 5-3 8 0" stroke="#8cc3e3" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>';

  // ---------- הודעות קופצות ודיאלוגים ----------
  var toastTimer;
  function toast(text, bad) {
    var t = $('#toast');
    t.textContent = text;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (bad ? ' bad' : ''); }, bad ? 5000 : 2600);
  }
  function dialog(html, onOpen) {
    return new Promise(function (resolve) {
      var d = document.createElement('dialog');
      d.innerHTML = html;
      document.body.appendChild(d);
      var done = false;
      function close(v) { if (done) return; done = true; d.close(); d.remove(); resolve(v); }
      d.addEventListener('cancel', function (e) { e.preventDefault(); close(null); });
      d.addEventListener('click', function (e) {
        if (e.target === d) {  // לחיצה על הרקע הכהה מחוץ לחלון בלבד
          var r = d.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return close(null);
          return;
        }
        var b = e.target.closest('[data-v]');
        if (b) { e.preventDefault(); close(b.getAttribute('data-v') === 'ok' ? (onOpen ? onOpen.value(d) : true) : null); }
      });
      d.addEventListener('submit', function (e) { e.preventDefault(); close(onOpen ? onOpen.value(d) : true); });
      d.showModal();
      if (onOpen && onOpen.focus) onOpen.focus(d);
    });
  }
  function confirmBox(title, text, okLabel, danger) {
    return dialog('<h2>' + esc(title) + '</h2><p class="muted">' + esc(text) + '</p><div class="btns"><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-v="ok">' + esc(okLabel || 'אישור') + '</button><button class="btn" data-v="no">ביטול</button></div>')
      .then(function (v) { return !!v; });
  }
  function promptBox(title, label, value) {
    return dialog('<form><h2>' + esc(title) + '</h2><div class="field"><label for="pb">' + esc(label) + '</label><input id="pb" maxlength="60" value="' + esc(value || '') + '" /></div><div class="btns"><button class="btn primary" type="submit">שמירה</button><button class="btn" data-v="no" type="button">ביטול</button></div></form>',
      { value: function (d) { return $('#pb', d).value.trim(); }, focus: function (d) { $('#pb', d).focus(); $('#pb', d).select(); } })
      .then(function (v) { return v || null; });
  }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (x) { ok = false; }
      t.remove(); return ok;
    }
  }

  // ---------- מבנה העמוד ----------
  var TABS = [
    { href: '#/', path: '/', label: 'בית', icon: 'home' },
    { href: '#/students', path: '/students', label: 'חניכים', icon: 'users' },
    { href: '#/attendance', path: '/attendance', label: 'נוכחות', icon: 'check' },
    { href: '#/messages', path: '/messages', label: 'הודעות', icon: 'msg' },
    { href: '#/settings', path: '/settings', label: 'הגדרות', icon: 'gear' },
  ];
  function shell() {
    var links = TABS.map(function (t) { return '<a href="' + t.href + '" data-path="' + t.path + '">' + icon(t.icon) + '<span>' + t.label + '</span></a>'; }).join('');
    document.getElementById('app').innerHTML =
      '<div id="offline" class="offline hide" role="status">אין חיבור לאינטרנט — השינויים לא יישמרו עד שהחיבור יחזור</div>' +
      '<header class="top"><div class="top-in"><a class="brand" href="#/">' + LOGO + '<span><b>מכינת נהריה</b><small id="who"></small></span></a><span class="grow"></span><nav class="nav" aria-label="ניווט ראשי">' + links + '</nav></div></header>' +
      '<main id="view"></main>' +
      '<nav class="bottom-nav" aria-label="ניווט ראשי">' + links + '</nav>';
    $view = $('#view');
    $nav = $$('[data-path]');
    $('#who').textContent = S.me.name ? 'שלום, ' + S.me.name : S.email;
    setOnline();
  }
  function markNav(path) {
    var top = path === '/' ? '/' : '/' + path.split('/')[1];
    if (top === '/s' || top === '/new' || top === '/edit') top = '/students';
    $nav.forEach(function (a) {
      var on = a.getAttribute('data-path') === top;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function setOnline() { var o = $('#offline'); if (o) o.classList.toggle('hide', navigator.onLine !== false); }

  // ---------- טעינת נתונים ----------
  async function loadAll() {
    var from = L.shiftDay(today(), -ATT_DAYS);
    var r = await Promise.all([
      q(sb.rpc('staff_list'), 'טעינת צוות'),
      q(sb.from('groups').select('*').order('sort').order('name'), 'טעינת קבוצות'),
      fetchAll(function () { return sb.from('students').select('*').order('created_at'); }, 'טעינת חניכים'),
      fetchAll(function () { return sb.from('attendance').select('student_id,day,status,updated_by,updated_at').gte('day', from).order('day', { ascending: false }).order('student_id'); }, 'טעינת נוכחות'),
      q(sb.from('templates').select('*').order('sort').order('id'), 'טעינת תבניות'),
    ]);
    S.staff = r[0] || []; S.groups = r[1] || []; S.students = r[2] || []; S.templates = r[4] || [];
    setAttendance(r[3] || []);
    var me = S.staff.filter(function (p) { return p.user_id === S.me.user_id; })[0];
    if (me) { S.me.name = me.name; S.me.role = me.role; }
    S.loadedAt = Date.now();
    if (isAdmin()) {
      var e = await sb.from('app_errors').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString());
      S.errors24 = e.count || 0;
    }
  }
  function setAttendance(rows) {
    S.att = {}; S.attMeta = {};
    var days = {};
    rows.forEach(function (a) {
      (S.att[a.student_id] = S.att[a.student_id] || {})[a.day] = a.status;
      S.attMeta[a.student_id + '|' + a.day] = a;
      days[a.day] = 1;
    });
    S.days = Object.keys(days).sort().reverse();
  }
  function putMark(sid, day, status) {
    var m = S.att[sid] = S.att[sid] || {};
    if (status) m[day] = status; else delete m[day];
    var days = {};
    Object.keys(S.att).forEach(function (k) { Object.keys(S.att[k]).forEach(function (d) { days[d] = 1; }); });
    S.days = Object.keys(days).sort().reverse();
  }

  // עדכון חי: שינוי שעשה איש צוות אחר מגיע לכאן בלי לרענן
  var liveTimer;
  function live() {
    sb.channel('db')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, function (p) {
        if (p.eventType === 'DELETE') S.students = S.students.filter(function (s) { return s.id !== p.old.id; });
        else {
          var i = S.students.findIndex(function (s) { return s.id === p.new.id; });
          if (i < 0) S.students.push(p.new); else S.students[i] = p.new;
        }
        soon();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, function (p) {
        if (p.eventType === 'DELETE') { if (p.old && p.old.student_id) putMark(p.old.student_id, p.old.day, null); else return refresh(); }
        else { putMark(p.new.student_id, p.new.day, p.new.status); S.attMeta[p.new.student_id + '|' + p.new.day] = p.new; }
        soon();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, function () { refresh(); })
      .subscribe();
  }
  // לא מציירים מחדש טופס שמישהו באמצע למלא
  function soon() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () {
      var p = route().path;
      if (p === '/new' || p.indexOf('/edit/') === 0 || p === '/settings' || document.querySelector('dialog')) return;
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $view.contains(a)) { soon(); return; } // מחכים שיסיים להקליד
      render();
    }, 250);
  }
  var refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try { await loadAll(); soon(); }
    catch (e) { /* פס "אין חיבור" כבר מוצג; ננסה שוב בפעם הבאה */ }
    finally { refreshing = false; }
  }

  // ---------- ניתוב ----------
  function render() {
    if (!$view) return;
    var r = route();
    markNav(r.path);
    var p = r.path.split('/');
    var html;
    try {
      if (r.path === '/') html = homeView();
      else if (r.path === '/students') html = studentsView(r.q);
      else if (p[1] === 's' && p[2]) html = studentView(p[2]);
      else if (r.path === '/new') html = formView(null, r.q);
      else if (p[1] === 'edit' && p[2]) html = formView(p[2], r.q);
      else if (r.path === '/attendance') html = attendanceView(r.q);
      else if (r.path === '/messages') html = messagesView(r.q);
      else if (r.path === '/settings') { settingsView(); return; }
      else html = '<div class="card empty"><b>העמוד לא נמצא</b><a class="btn" href="#/">לדף הבית</a></div>';
    } catch (e) {
      if (window.logIssue) window.logIssue('תצוגה ' + r.path + ': ' + e.message, e.stack);
      html = '<div class="card empty"><b>משהו השתבש בתצוגה</b><p>התקלה נרשמה. נסו לרענן את העמוד.</p><button class="btn primary" onclick="location.reload()">רענון</button></div>';
    }
    var keepScroll = render.lastPath === location.hash;
    var y = window.scrollY;
    $view.innerHTML = html;
    render.lastPath = location.hash;
    window.scrollTo(0, keepScroll ? y : 0);
    var after = render.after; render.after = null;
    if (after) after();
  }

  // ---------- בית ----------
  function streaks() {
    return active().map(function (s) { return { s: s, n: L.absenceStreak(S.att[s.id] || {}, S.days) }; })
      .filter(function (x) { return x.n >= STREAK_ALERT; }).sort(function (a, b) { return b.n - a.n; });
  }
  function birthdays() {
    var t = today();
    return active().map(function (s) { return { s: s, b: L.upcomingBirthday(s.birth_date, t) }; })
      .filter(function (x) { return x.b && x.b.days <= BIRTHDAY_DAYS; }).sort(function (a, b) { return a.b.days - b.b.days; });
  }
  function tpl(title, audience) {
    return S.templates.filter(function (t) { return t.title === title; })[0] || S.templates.filter(function (t) { return t.audience === audience; })[0];
  }
  function firstParent(s) {
    if (L.normPhone(s.parent1_phone)) return { name: s.parent1_name, phone: s.parent1_phone };
    if (L.normPhone(s.parent2_phone)) return { name: s.parent2_name, phone: s.parent2_phone };
    return null;
  }
  function vars(s, parentName) { return { first: s.first_name, full: fullName(s), parent: parentName, date: L.fmtDay(today()) }; }

  function homeView() {
    var t = today(), act = active();
    if (!S.students.length) {
      return '<div class="page-h"><h1>' + (S.me.name ? 'שלום ' + esc(S.me.name) : 'ברוכים הבאים') + '</h1></div>' +
        '<div class="card empty">' + icon('users') + '<b>עוד אין חניכים במערכת</b><p>מתחילים בהוספת החניך הראשון. אם יש למכינה קבוצות (צוותים, מחזורים), אפשר ליצור אותן קודם בהגדרות.</p>' +
        '<div class="btns" style="justify-content:center"><a class="btn primary" href="#/new">' + icon('plus') + 'הוספת חניך</a><a class="btn" href="#/settings">יצירת קבוצות</a></div></div>';
    }
    var marked = act.filter(function (s) { return (S.att[s.id] || {})[t]; }).length;
    var came = act.filter(function (s) { var m = (S.att[s.id] || {})[t]; return m === 'present' || m === 'late'; }).length;
    var week = [];
    act.forEach(function (s) { var m = S.att[s.id] || {}; Object.keys(m).forEach(function (d) { if (d > L.shiftDay(t, -7)) week.push(m[d]); }); });
    var wr = L.attendanceRate(week);
    var st = streaks(), bd = birthdays();
    var missing = act.filter(function (s) { return !firstParent(s); });

    var alerts = [];
    if (S.errors24 && isAdmin()) alerts.push('<div class="alert bad"><span class="dot"></span><span class="txt"><b>' + (S.errors24 === 1 ? 'תקלה טכנית אחת' : S.errors24 + ' תקלות טכניות') + '</b> ב-24 השעות האחרונות</span><a class="btn small" href="#/settings?tab=errors">לפרטים</a></div>');
    if (!L.isWeekend(t) && act.length && marked < act.length) {
      alerts.push('<div class="alert warn"><span class="dot"></span><span class="txt"><b>נוכחות היום</b> — סומנו ' + marked + ' מתוך ' + act.length + '</span><a class="btn small primary" href="#/attendance">לסמן נוכחות</a></div>');
    }
    st.forEach(function (x) {
      var par = firstParent(x.s), tt = tpl('כמה חיסורים ברצף', 'parents');
      var wa = par && tt ? L.waLink(par.phone, L.fillTemplate(tt.body, vars(x.s, par.name))) : null;
      alerts.push('<div class="alert bad"><span class="dot"></span><span class="txt"><b>' + esc(fullName(x.s)) + '</b> חיסר/ה ' + x.n + ' ימים ברצף</span>' +
        (wa ? '<a class="btn small wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon('msg') + 'הודעה להורה</a>' : '<span class="pill bad">אין טלפון הורה</span>') +
        '<a class="btn small" href="#/s/' + x.s.id + '">לכרטיס</a></div>');
    });
    bd.forEach(function (x) {
      var tt = tpl('יום הולדת', 'students');
      var wa = L.normPhone(x.s.phone) && tt ? L.waLink(x.s.phone, L.fillTemplate(tt.body, vars(x.s))) : null;
      var when = x.b.days === 0 ? 'היום!' : x.b.days === 1 ? 'מחר' : 'בעוד ' + x.b.days + ' ימים';
      alerts.push('<div class="alert ok"><span class="dot"></span><span class="txt">יום הולדת ' + x.b.age + ' ל<b>' + esc(fullName(x.s)) + '</b> — ' + when + '</span>' +
        (wa ? '<a class="btn small wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon('msg') + 'לשלוח מזל טוב</a>' : '') + '</div>');
    });
    if (missing.length) alerts.push('<div class="alert warn"><span class="dot"></span><span class="txt">ל-<b>' + missing.length + ' חניכים</b> אין טלפון תקין של הורה</span><a class="btn small" href="#/students?f=missing">להשלים</a></div>');
    if (!alerts.length) alerts.push('<div class="alert ok"><span class="dot"></span><span class="txt"><b>הכול מסודר.</b> אין משהו שדורש טיפול כרגע.</span></div>');

    var hello = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false });
    var hr = parseInt(hello, 10);
    var greet = hr < 5 ? 'לילה טוב' : hr < 12 ? 'בוקר טוב' : hr < 17 ? 'צהריים טובים' : hr < 21 ? 'ערב טוב' : 'לילה טוב';
    return '<div class="page-h"><h1>' + greet + (S.me.name ? ', ' + esc(S.me.name) : '') + '</h1><span class="muted">יום ' + L.weekday(t) + ', ' + L.fmtDay(t) + '</span></div>' +
      '<div class="kpis">' +
      '<a class="kpi" href="#/students"><div class="l">חניכים פעילים</div><div class="n">' + act.length + '</div><div class="s">' + S.groups.length + ' קבוצות</div></a>' +
      '<a class="kpi" href="#/attendance"><div class="l">הגיעו היום</div><div class="n">' + (marked ? came + '<span class="muted" style="font-size:18px"> / ' + act.length + '</span>' : '—') + '</div><div class="s">' + (marked ? 'סומנו ' + marked : 'עוד לא סומנה נוכחות') + '</div></a>' +
      '<div class="kpi"><div class="l">נוכחות השבוע</div><div class="n">' + (wr == null ? '—' : wr + '%') + '</div><div class="s">7 הימים האחרונים</div></div>' +
      '<div class="kpi"><div class="l">ימי הולדת השבוע</div><div class="n">' + bd.length + '</div><div class="s">ב-' + BIRTHDAY_DAYS + ' הימים הקרובים</div></div>' +
      '</div>' +
      '<h2 class="sr">מה דורש טיפול</h2><div class="alerts">' + alerts.join('') + '</div>' +
      '<div class="btns"><a class="btn primary" href="#/new">' + icon('plus') + 'הוספת חניך</a><a class="btn" href="#/attendance">' + icon('check') + 'נוכחות</a><a class="btn" href="#/messages">' + icon('msg') + 'הודעה להורים</a></div>';
  }

  // ---------- רשימת חניכים ----------
  function listFilter(params) {
    var g = params.get('g'), f = params.get('f');
    return S.students.filter(function (s) {
      if (f === 'left') return !s.active;
      if (!s.active) return false;
      if (f === 'missing') return L.missingInfo(s).length > 0;
      if (g === 'none') return !s.group_id;
      if (g) return String(s.group_id) === g;
      return true;
    }).sort(byName);
  }
  function chip(label, href, on) { return '<a class="chip' + (on ? ' on' : '') + '" href="' + href + '"' + (on ? ' aria-current="true"' : '') + '>' + esc(label) + '</a>'; }
  function groupChips(base, params, extra) {
    var g = params.get('g'), f = params.get('f');
    var hasNone = S.students.some(function (s) { return s.active && !s.group_id; }) && S.groups.length;
    var out = chip('הכול', base, !g && !f);
    S.groups.forEach(function (x) { out += chip(x.name, base + '?g=' + x.id, g === String(x.id)); });
    if (hasNone) out += chip('בלי קבוצה', base + '?g=none', g === 'none');
    return '<div class="chips" role="navigation" aria-label="סינון">' + out + (extra || '') + '</div>';
  }
  function studentRows(list) {
    if (!list.length) return '<div class="empty"><b>לא נמצאו חניכים</b>נסו חיפוש אחר או סינון אחר.</div>';
    return list.map(function (s) {
      var me = L.normPhone(s.phone), miss = L.missingInfo(s);
      var meta = [me ? me.local : '', groupName(s.group_id), s.city].filter(Boolean).join(' · ') || 'אין פרטים נוספים';
      return '<div class="row"><a class="who" href="#/s/' + s.id + '"><span class="avatar' + (s.active ? '' : ' left') + '">' + initial(s) + '</span><span class="txtcol"><div class="nm">' + esc(fullName(s)) + '</div><div class="meta">' + esc(meta) + (miss.length ? ' · <span class="pill warn">' + esc(miss[0]) + '</span>' : '') + '</div></span></a>' +
        (me ? '<a class="btn icon" href="' + L.telLink(s.phone) + '" aria-label="להתקשר ל' + esc(s.first_name) + '">' + icon('phone') + '</a><a class="btn icon wa" href="' + L.waLink(s.phone) + '" target="_blank" rel="noopener" aria-label="וואטסאפ ל' + esc(s.first_name) + '">' + icon('msg') + '</a>' : '') + '</div>';
    }).join('');
  }
  function studentsView(params) {
    var list = listFilter(params), f = params.get('f');
    var left = S.students.filter(function (s) { return !s.active; }).length;
    var missing = S.students.filter(function (s) { return s.active && L.missingInfo(s).length; }).length;
    var extra = (missing ? chip('חסרים פרטים (' + missing + ')', '#/students?f=missing', f === 'missing') : '') + (left ? chip('עזבו (' + left + ')', '#/students?f=left', f === 'left') : '');
    render.after = function () {
      var inp = $('#q');
      inp.value = ui.q;
      var paint = function () {
        var shown = list.filter(function (s) { return L.matches(s, ui.q); });
        $('#list').innerHTML = studentRows(shown);
        $('#cnt').textContent = shown.length;
      };
      inp.addEventListener('input', function () { ui.q = inp.value; paint(); });
      paint();
    };
    return '<div class="page-h"><h1>חניכים <span class="muted" id="cnt"></span></h1><span class="grow"></span><button class="btn" data-act="export-students">' + icon('down') + 'ייצוא לאקסל</button><a class="btn primary" href="#/new">' + icon('plus') + 'הוספת חניך</a></div>' +
      '<div class="search"><label class="sr" for="q">חיפוש</label><input id="q" type="search" placeholder="חיפוש לפי שם, טלפון, עיר או הורה" autocomplete="off" enterkeyhint="search" />' + icon('search') + '</div>' +
      groupChips('#/students', params, extra) +
      '<div class="card"><div class="rows" id="list"></div></div>';
  }

  // ---------- כרטיס חניך ----------
  function contactRow(label, name, phone, waText) {
    var p = L.normPhone(phone);
    return '<div class="contact"><div class="grow"><div class="muted">' + esc(label) + '</div><div><b>' + esc(name || '—') + '</b> ' + (p ? '<span class="ltr">' + esc(p.local) + '</span>' : (phone ? '<span class="pill bad">' + esc(phone) + ' — לא תקין</span>' : '<span class="muted">אין מספר</span>')) + '</div></div>' +
      (p ? '<a class="btn small" href="' + L.telLink(phone) + '">' + icon('phone') + 'חיוג</a><a class="btn small wa" href="' + esc(L.waLink(phone, waText)) + '" target="_blank" rel="noopener">' + icon('msg') + 'וואטסאפ</a><button class="btn small icon" data-act="copy" data-text="' + esc(p.local) + '" aria-label="העתקת המספר">' + icon('copy') + '</button>' : '') + '</div>';
  }
  function studentView(id) {
    var s = S.students.filter(function (x) { return x.id === id; })[0];
    if (!s) return '<div class="card empty"><b>החניך לא נמצא</b>אולי הוא נמחק.<div class="btns" style="justify-content:center;margin-top:12px"><a class="btn" href="#/students">לרשימת החניכים</a></div></div>';
    var t = today(), m = S.att[s.id] || {};
    var age = L.ageOn(s.birth_date, t), bd = L.upcomingBirthday(s.birth_date, t);
    var recentDays = S.days.slice(0, 30);
    var rate = L.attendanceRate(recentDays.map(function (d) { return m[d]; }).filter(Boolean));
    var streak = L.absenceStreak(m, S.days);
    var absences = S.days.filter(function (d) { return m[d] === 'absent' || m[d] === 'late' || m[d] === 'excused'; }).slice(0, 8);
    var miss = L.missingInfo(s);
    var pills = (s.group_id ? '<span class="pill">' + esc(groupName(s.group_id)) + '</span> ' : '') + (age != null ? '<span class="pill ex">בן/בת ' + age + '</span> ' : '') +
      (!s.active ? '<span class="pill ex">עזב/ה</span> ' : '') + (streak >= STREAK_ALERT ? '<span class="pill bad">' + streak + ' חיסורים ברצף</span> ' : '') +
      miss.map(function (x) { return '<span class="pill warn">' + esc(x) + '</span>'; }).join(' ');
    var dots = recentDays.slice().reverse().map(function (d) { return '<span class="' + (m[d] || '') + '" title="' + esc(L.fmtDay(d) + ' — ' + (STATUS_LONG[m[d]] || 'לא סומן')) + '"></span>'; }).join('');
    return '<div class="page-h"><a class="btn icon" href="#/students" aria-label="חזרה לרשימה">' + icon('back') + '</a><div class="person-h grow"><span class="avatar' + (s.active ? '' : ' left') + '">' + initial(s) + '</span><div><h1>' + esc(fullName(s)) + '</h1><div>' + pills + '</div></div></div>' +
      '<a class="btn" href="#/edit/' + s.id + '">' + icon('edit') + 'עריכה</a></div>' +
      '<div class="grid cols2"><div>' +
      '<div class="card"><h2>טלפונים</h2>' +
      contactRow('החניך/ה', s.first_name, s.phone, '') +
      contactRow('הורה 1', s.parent1_name, s.parent1_phone, L.fillTemplate('שלום {הורה}, כאן צוות מכינת נהריה. ', vars(s, s.parent1_name))) +
      contactRow('הורה 2', s.parent2_name, s.parent2_phone, L.fillTemplate('שלום {הורה}, כאן צוות מכינת נהריה. ', vars(s, s.parent2_name))) +
      '</div>' +
      '<div class="card"><h2>פרטים</h2><div class="facts">' +
      '<div><div class="l">עיר</div>' + esc(s.city || '—') + '</div>' +
      '<div><div class="l">תאריך לידה</div>' + (s.birth_date ? L.fmtDay(s.birth_date) + (bd && bd.days <= 30 ? ' <span class="pill ok">יום הולדת ' + (bd.days === 0 ? 'היום' : 'בעוד ' + bd.days + ' ימים') + '</span>' : '') : '—') + '</div>' +
      '<div><div class="l">קבוצה</div>' + esc(groupName(s.group_id) || '—') + '</div>' +
      '<div><div class="l">נוסף/ה</div>' + esc(stamp(s.created_at)) + '</div>' +
      '<div><div class="l">עודכן/ה</div>' + esc(stamp(s.updated_at)) + (staffName(s.updated_by) ? '<div class="muted">על ידי ' + esc(staffName(s.updated_by)) + '</div>' : '') + '</div>' +
      '</div>' + (s.notes ? '<h2 style="margin-top:16px">הערות</h2><div class="notes">' + esc(s.notes) + '</div>' : '') + '</div>' +
      '</div><div>' +
      '<div class="card"><h2>נוכחות <span class="count">' + recentDays.length + ' ימי פעילות אחרונים</span></h2>' +
      '<div class="facts" style="margin-bottom:12px"><div><div class="l">אחוז נוכחות</div><b style="font-size:22px">' + (rate == null ? '—' : rate + '%') + '</b></div><div><div class="l">חיסורים ברצף עכשיו</div><b style="font-size:22px">' + streak + '</b></div></div>' +
      (dots ? '<div class="dots" aria-label="נוכחות לפי ימים, מהישן לחדש">' + dots + '</div><div class="muted" style="margin-top:6px">ירוק נוכח · צהוב איחור · אדום חיסור · אפור מאושר</div>' : '<div class="muted">עוד לא נרשמה נוכחות.</div>') +
      (absences.length ? '<h2 style="margin-top:16px">חיסורים ואיחורים אחרונים</h2>' + absences.map(function (d) { return '<div class="list-it"><span class="grow">יום ' + L.weekday(d) + ' ' + L.fmtDay(d) + '</span><span class="pill ' + (m[d] === 'absent' ? 'bad' : m[d] === 'late' ? 'warn' : 'ex') + '">' + STATUS_LONG[m[d]] + '</span></div>'; }).join('') : '') +
      '</div>' +
      '<div class="card"><h2>פעולות</h2><div class="btns">' +
      (s.active ? '<button class="btn" data-act="toggle-active" data-id="' + s.id + '">סימון כעזב/ה את המכינה</button>' : '<button class="btn" data-act="toggle-active" data-id="' + s.id + '">החזרה לחניכים פעילים</button>') +
      '<a class="btn" href="#/messages?s=' + s.id + '">' + icon('msg') + 'הודעה מתבנית</a>' +
      '<button class="btn danger" data-act="delete-student" data-id="' + s.id + '">מחיקה לצמיתות</button></div></div>' +
      '</div></div>';
  }

  // ---------- טופס הוספה / עריכה ----------
  function field(name, label, value, attrs, full) {
    return '<div class="field' + (full ? ' full' : '') + '"><label for="f-' + name + '">' + label + '</label><input id="f-' + name + '" name="' + name + '" value="' + esc(value || '') + '" ' + (attrs || '') + ' /><div class="err" id="e-' + name + '"></div></div>';
  }
  function formView(id, params) {
    var s = id ? S.students.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !s) return '<div class="card empty"><b>החניך לא נמצא</b></div>';
    s = s || { group_id: params && params.get('g') ? Number(params.get('g')) : null };
    var opts = '<option value="">בלי קבוצה</option>' + S.groups.map(function (g) { return '<option value="' + g.id + '"' + (s.group_id === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join('') + '<option value="__new">+ קבוצה חדשה…</option>';
    var tel = 'type="tel" inputmode="tel" autocomplete="off" maxlength="20" dir="ltr" placeholder="050-0000000"';
    render.after = function () { $('#f-first_name').focus(); };
    return '<div class="page-h"><a class="btn icon" href="' + (id ? '#/s/' + id : '#/students') + '" aria-label="חזרה">' + icon('back') + '</a><h1>' + (id ? 'עריכת ' + esc(fullName(s)) : 'הוספת חניך') + '</h1></div>' +
      '<form class="card" id="student-form" data-id="' + (id || '') + '" novalidate><div class="form">' +
      '<h3>החניך/ה</h3>' +
      field('first_name', 'שם פרטי *', s.first_name, 'maxlength="40" autocomplete="off" required') +
      field('last_name', 'שם משפחה', s.last_name, 'maxlength="40" autocomplete="off"') +
      field('phone', 'טלפון', s.phone, tel) +
      field('city', 'עיר', s.city, 'maxlength="40" autocomplete="off"') +
      field('birth_date', 'תאריך לידה', s.birth_date, 'type="date" max="' + today() + '"') +
      '<div class="field"><label for="f-group_id">קבוצה</label><select id="f-group_id" name="group_id">' + opts + '</select></div>' +
      '<h3>הורים</h3>' +
      field('parent1_name', 'שם הורה 1', s.parent1_name, 'maxlength="40" autocomplete="off"') +
      field('parent1_phone', 'טלפון הורה 1', s.parent1_phone, tel) +
      field('parent2_name', 'שם הורה 2', s.parent2_name, 'maxlength="40" autocomplete="off"') +
      field('parent2_phone', 'טלפון הורה 2', s.parent2_phone, tel) +
      '<div class="field full"><label for="f-notes">הערות</label><textarea id="f-notes" name="notes" maxlength="2000">' + esc(s.notes || '') + '</textarea></div>' +
      '</div><div class="form-err" id="form-err" role="alert"></div><div class="form-actions">' +
      '<button class="btn primary" type="submit" name="go" value="view">' + (id ? 'שמירה' : 'הוספה') + '</button>' +
      (id ? '' : '<button class="btn" type="submit" name="go" value="more">הוספה והוספת עוד אחד</button>') +
      '<a class="btn" href="' + (id ? '#/s/' + id : '#/students') + '">ביטול</a></div></form>';
  }
  async function saveStudent(form, goMore) {
    var id = form.getAttribute('data-id');
    var data = {};
    ['first_name', 'last_name', 'phone', 'city', 'parent1_name', 'parent1_phone', 'parent2_name', 'parent2_phone', 'notes'].forEach(function (k) { data[k] = form.elements[k].value.trim(); });
    data.birth_date = form.elements.birth_date.value || null;
    var g = form.elements.group_id.value;
    data.group_id = g && g !== '__new' ? Number(g) : null;
    // שומרים את המספרים בפורמט אחיד
    ['phone', 'parent1_phone', 'parent2_phone'].forEach(function (k) { var p = L.normPhone(data[k]); if (p) data[k] = p.local; });
    var errs = L.validateStudent(data, today());
    $$('.field .err', form).forEach(function (e) { e.textContent = ''; });
    $$('input', form).forEach(function (i) { i.removeAttribute('aria-invalid'); });
    var keys = Object.keys(errs);
    if (keys.length) {
      keys.forEach(function (k) { var e = $('#e-' + k); if (e) e.textContent = errs[k]; var i = $('#f-' + k); if (i) i.setAttribute('aria-invalid', 'true'); });
      $('#f-' + keys[0]).focus();
      return;
    }
    if (!id) {
      var dupe = S.students.filter(function (s) { return fullName(s) === (data.first_name + ' ' + data.last_name).trim(); })[0];
      if (dupe && !(await confirmBox('כבר יש חניך בשם הזה', fullName(dupe) + ' כבר נמצא ברשימה. להוסיף בכל זאת?', 'להוסיף בכל זאת'))) return;
    }
    var btns = $$('button[type=submit]', form);
    btns.forEach(function (b) { b.disabled = true; });
    $('#form-err').textContent = '';
    try {
      var row;
      if (id) row = (await q(sb.from('students').update(data).eq('id', id).select(), 'עדכון חניך'))[0];
      else row = (await q(sb.from('students').insert(data).select(), 'הוספת חניך'))[0];
      if (!row) throw new Error('not authorized');
      var i = S.students.findIndex(function (s) { return s.id === row.id; });
      if (i < 0) S.students.push(row); else S.students[i] = row;
      toast(id ? 'נשמר' : fullName(row) + ' נוסף/ה');
      if (goMore) { var gq = data.group_id ? '?g=' + data.group_id : ''; if (location.hash === '#/new' + gq) render(); else location.hash = '#/new' + gq; }
      else go('#/s/' + row.id);
    } catch (e) {
      $('#form-err').textContent = friendly(e);
      btns.forEach(function (b) { b.disabled = false; });
    }
  }

  // ---------- נוכחות ----------
  function attendanceView(params) {
    var t = today(), day = params.get('d') || t;
    if (!L.parseDay(day)) day = t;
    var g = params.get('g');
    var list = active().filter(function (s) { return g === 'none' ? !s.group_id : g ? String(s.group_id) === g : true; });
    var cnt = { present: 0, late: 0, absent: 0, excused: 0, none: 0 };
    list.forEach(function (s) { var m = (S.att[s.id] || {})[day]; cnt[m || 'none']++; });
    var qs = function (d, gg) { var p = []; if (d && d !== t) p.push('d=' + d); if (gg) p.push('g=' + gg); return '#/attendance' + (p.length ? '?' + p.join('&') : ''); };
    var chips = '<div class="chips" aria-label="קבוצה">' + chip('הכול', qs(day, ''), !g) + S.groups.map(function (x) { return chip(x.name, qs(day, String(x.id)), g === String(x.id)); }).join('') +
      (S.groups.length && S.students.some(function (s) { return s.active && !s.group_id; }) ? chip('בלי קבוצה', qs(day, 'none'), g === 'none') : '') + '</div>';
    var rows = list.map(function (s) {
      var m = (S.att[s.id] || {})[day];
      var meta = S.attMeta && S.attMeta[s.id + '|' + day];
      return '<div class="att-row' + (m ? '' : ' unmarked') + '"><div class="who"><span class="avatar">' + initial(s) + '</span><div><div class="nm">' + esc(fullName(s)) + '</div>' +
        (meta && meta.updated_by && meta.updated_by !== S.me.user_id && staffName(meta.updated_by) ? '<div class="muted">סומן על ידי ' + esc(staffName(meta.updated_by)) + '</div>' : '') + '</div></div>' +
        '<div class="seg" role="group" aria-label="נוכחות של ' + esc(fullName(s)) + '">' +
        ['present', 'late', 'absent', 'excused'].map(function (k) { return '<button type="button" class="' + k + (m === k ? ' on' : '') + '" aria-pressed="' + (m === k) + '" data-act="mark" data-id="' + s.id + '" data-day="' + day + '" data-st="' + k + '">' + STATUS[k] + '</button>'; }).join('') +
        '</div></div>';
    }).join('');
    return '<div class="page-h"><h1>נוכחות</h1><span class="muted">יום ' + L.weekday(day) + ' ' + L.fmtDay(day) + (day === t ? ' · היום' : '') + '</span></div>' +
      '<div class="att-head"><a class="btn icon" href="' + qs(L.shiftDay(day, -1), g) + '" aria-label="יום קודם">' + icon('prev') + '</a>' +
      '<label class="sr" for="att-day">תאריך</label><input type="date" id="att-day" value="' + day + '" max="' + t + '" />' +
      '<a class="btn icon" href="' + qs(L.shiftDay(day, 1), g) + '" aria-label="יום הבא"' + (day >= t ? ' style="visibility:hidden"' : '') + '>' + icon('next') + '</a>' +
      (day !== t ? '<a class="btn" href="' + qs(t, g) + '">להיום</a>' : '') + '</div>' +
      chips +
      (list.length ? '<div class="att-sum"><span class="pill ok">נוכחים ' + cnt.present + '</span><span class="pill warn">איחור ' + cnt.late + '</span><span class="pill bad">חיסור ' + cnt.absent + '</span><span class="pill ex">מאושר ' + cnt.excused + '</span>' + (cnt.none ? '<span class="pill">לא סומנו ' + cnt.none + '</span>' : '') + '</div>' +
        (cnt.none ? '<div class="btns" style="margin-bottom:12px"><button class="btn primary" data-act="mark-rest" data-day="' + day + '" data-g="' + esc(g || '') + '">' + icon('check') + 'לסמן את כל ' + cnt.none + ' הנותרים כנוכחים</button></div>' : '<div class="muted" style="margin-bottom:12px">כולם סומנו ✓ · לחיצה על סימון קיים מבטלת אותו</div>') +
        '<div class="card">' + rows + '</div>'
        : '<div class="card empty"><b>אין חניכים פעילים' + (g ? ' בקבוצה הזאת' : '') + '</b><a class="btn primary" href="#/new">' + icon('plus') + 'הוספת חניך</a></div>');
  }
  async function mark(btn) {
    var sid = btn.getAttribute('data-id'), day = btn.getAttribute('data-day'), st = btn.getAttribute('data-st');
    var prev = (S.att[sid] || {})[day] || null;
    var next = prev === st ? null : st;   // לחיצה שנייה על אותו כפתור מבטלת
    var seg = btn.parentNode;
    putMark(sid, day, next);
    $$('button', seg).forEach(function (b) { var on = b.getAttribute('data-st') === next; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    seg.closest('.att-row').classList.toggle('unmarked', !next);
    seg.classList.add('saving');
    try {
      if (next) await q(sb.from('attendance').upsert({ student_id: sid, day: day, status: next, updated_by: S.me.user_id, updated_at: new Date().toISOString() }), 'שמירת נוכחות');
      else await q(sb.from('attendance').delete().eq('student_id', sid).eq('day', day), 'ביטול נוכחות');
      S.attMeta[sid + '|' + day] = next ? { updated_by: S.me.user_id } : null;
      seg.classList.remove('saving');
      clearTimeout(mark.t); mark.t = setTimeout(function () { if (route().path === '/attendance' && !document.activeElement.closest('.seg')) render(); }, 1200);
    } catch (e) {
      putMark(sid, day, prev);
      toast('הסימון לא נשמר — ' + friendly(e), true);
      render();
    }
  }
  async function markRest(btn) {
    var day = btn.getAttribute('data-day'), g = btn.getAttribute('data-g');
    var list = active().filter(function (s) { return g === 'none' ? !s.group_id : g ? String(s.group_id) === g : true; })
      .filter(function (s) { return !(S.att[s.id] || {})[day]; });
    if (!list.length) return;
    btn.disabled = true;
    var rows = list.map(function (s) { return { student_id: s.id, day: day, status: 'present', updated_by: S.me.user_id }; });
    try {
      // ignoreDuplicates: אם מישהו אחר סימן בינתיים — לא דורסים את הסימון שלו
      await q(sb.from('attendance').upsert(rows, { onConflict: 'student_id,day', ignoreDuplicates: true }), 'סימון כולם נוכחים');
      list.forEach(function (s) { if (!(S.att[s.id] || {})[day]) putMark(s.id, day, 'present'); });
      toast(list.length + ' סומנו כנוכחים');
      render();
    } catch (e) { btn.disabled = false; toast(friendly(e), true); }
  }

  // ---------- הודעות ----------
  function recipients(audience, list) {
    var out = [], skipped = 0;
    list.forEach(function (s) {
      if (audience === 'students') {
        if (L.normPhone(s.phone)) out.push({ key: s.id, s: s, name: fullName(s), sub: groupName(s.group_id), phone: s.phone, parent: '' });
        else skipped++;
      } else {
        var any = false;
        [['parent1_name', 'parent1_phone'], ['parent2_name', 'parent2_phone']].forEach(function (k) {
          if (L.normPhone(s[k[1]])) { any = true; out.push({ key: s.id + k[1], s: s, name: s[k[0]] || 'הורה', sub: 'הורה של ' + fullName(s), phone: s[k[1]], parent: s[k[0]] }); }
        });
        if (!any) skipped++;
      }
    });
    return { list: out, skipped: skipped };
  }
  function messagesView(params) {
    var st = ui.msg = ui.msg || { audience: 'parents', tplId: null, body: null };
    var only = params.get('s') ? S.students.filter(function (s) { return s.id === params.get('s'); })[0] : null;
    if (params.get('a')) st.audience = params.get('a') === 'students' ? 'students' : 'parents';
    var g = params.get('g');
    var tpls = S.templates.filter(function (t) { return t.audience === st.audience; });
    if (!tpls.some(function (t) { return t.id === st.tplId; })) { st.tplId = tpls[0] ? tpls[0].id : null; st.body = null; }
    var cur = tpls.filter(function (t) { return t.id === st.tplId; })[0];
    if (st.body == null) st.body = cur ? cur.body : '';
    var base = function (a, gg) { var p = ['a=' + a]; if (gg) p.push('g=' + gg); if (only) p.push('s=' + only.id); return '#/messages?' + p.join('&'); };
    var list = only ? [only] : active().filter(function (s) { return g === 'none' ? !s.group_id : g ? String(s.group_id) === g : true; });
    var rec = recipients(st.audience, list);
    var sentKey = function (r) { return r.key + '|' + st.body; };
    var nSent = rec.list.filter(function (r) { return ui.sent[sentKey(r)]; }).length;
    var first = rec.list[0];
    render.after = function () {
      var ta = $('#msg-body');
      ta.addEventListener('input', function () { st.body = ta.value; clearTimeout(ta.t); ta.t = setTimeout(function () { var pos = ta.selectionStart; render(); var n = $('#msg-body'); n.focus(); n.setSelectionRange(pos, pos); }, 500); });
      var sel = $('#msg-tpl');
      if (sel) sel.addEventListener('change', function () { st.tplId = Number(sel.value); st.body = null; render(); });
    };
    return '<div class="page-h"><h1>הודעות</h1>' + (only ? '<span class="pill">רק ' + esc(fullName(only)) + '</span><a class="btn small" href="#/messages">לכולם</a>' : '') + '</div>' +
      '<div class="grid cols2"><div class="card"><h2>1. למי</h2>' +
      '<div class="chips">' + chip('להורים', base('parents', g), st.audience === 'parents') + chip('לחניכים', base('students', g), st.audience === 'students') + '</div>' +
      (only ? '' : '<div class="muted" style="margin-bottom:6px">קבוצה</div><div class="chips">' + chip('כל המכינה', base(st.audience, ''), !g) + S.groups.map(function (x) { return chip(x.name, base(st.audience, String(x.id)), g === String(x.id)); }).join('') + '</div>') +
      '<h2 style="margin-top:12px">2. מה לכתוב</h2>' +
      (tpls.length ? '<div class="field" style="margin-bottom:10px"><label for="msg-tpl">תבנית</label><select id="msg-tpl">' + tpls.map(function (t) { return '<option value="' + t.id + '"' + (t.id === st.tplId ? ' selected' : '') + '>' + esc(t.title) + '</option>'; }).join('') + '</select></div>' : '') +
      '<div class="field"><label for="msg-body">ההודעה (אפשר לערוך)</label><textarea id="msg-body" maxlength="1000">' + esc(st.body) + '</textarea></div>' +
      '<div class="muted" style="margin-top:6px">המערכת מחליפה לבד: <b>{חניך}</b> שם החניך · <b>{הורה}</b> שם ההורה · <b>{שם_מלא}</b> · <b>{תאריך}</b> היום. תבניות עורכים בהגדרות.</div>' +
      (first ? '<h2 style="margin-top:14px">איך זה ייראה אצל ' + esc(first.name) + '</h2><div class="preview">' + esc(L.fillTemplate(st.body, vars(first.s, first.parent))) + '</div>' : '') +
      '</div>' +
      '<div class="card"><h2>3. שליחה <span class="count">נשלחו ' + nSent + ' מתוך ' + rec.list.length + '</span></h2>' +
      '<p class="muted" style="margin-top:0">כל לחיצה פותחת וואטסאפ עם ההודעה מוכנה — רק ללחוץ "שלח" שם ולחזור לכאן. ההודעה יוצאת מהמספר שלכם.</p>' +
      (rec.list.length ? '<div class="btns" style="margin-bottom:8px"><button class="btn small" data-act="copy-numbers">' + icon('copy') + 'העתקת כל ' + rec.list.length + ' המספרים</button>' + (nSent ? '<button class="btn small" data-act="reset-sent">איפוס הסימונים</button>' : '') + '</div>' : '') +
      (rec.skipped ? '<div class="alert warn" style="margin-bottom:8px"><span class="dot"></span><span class="txt">ל-' + rec.skipped + ' חניכים אין מספר תקין ' + (st.audience === 'parents' ? 'של הורה' : '') + '</span><a class="btn small" href="#/students?f=missing">להשלים</a></div>' : '') +
      (rec.list.map(function (r) {
        var done = ui.sent[sentKey(r)];
        return '<div class="msg-row' + (done ? ' sent' : '') + '"><div class="grow"><b>' + esc(r.name) + '</b><div class="muted">' + esc(r.sub) + ' · <span class="ltr">' + esc(L.normPhone(r.phone).local) + '</span></div></div>' +
          '<a class="btn small ' + (done ? '' : 'wa') + '" href="' + esc(L.waLink(r.phone, L.fillTemplate(st.body, vars(r.s, r.parent)))) + '" target="_blank" rel="noopener" data-act="sent" data-key="' + esc(sentKey(r)) + '">' + icon('send') + (done ? 'נשלח ✓' : 'שליחה') + '</a></div>';
      }).join('') || '<div class="empty"><b>אין למי לשלוח</b>אין מספרים תקינים בבחירה הזאת.</div>') +
      '</div></div>';
  }

  // ---------- הגדרות ----------
  async function settingsView() {
    var tab = route().q.get('tab');
    var html = '<div class="page-h"><h1>הגדרות</h1></div><div class="grid cols2"><div>';
    html += '<div class="card"><h2>החשבון שלי</h2><div class="list-it"><div class="grow"><b>' + esc(S.me.name || 'בלי שם') + '</b><div class="muted ltr">' + esc(S.email) + '</div></div><span class="pill' + (isAdmin() ? '' : ' ex') + '">' + (isAdmin() ? 'מנהל' : 'צוות') + '</span></div>' +
      '<div class="btns" style="margin-top:10px"><button class="btn" data-act="my-name">' + icon('edit') + 'שינוי השם שלי</button><button class="btn" data-act="logout">' + icon('out') + 'יציאה</button></div></div>';
    html += '<div class="card"><h2>קבוצות <span class="count">' + S.groups.length + '</span></h2>' +
      (S.groups.length ? S.groups.map(function (g) {
        var n = S.students.filter(function (s) { return s.active && s.group_id === g.id; }).length;
        return '<div class="list-it"><span class="grow"><b>' + esc(g.name) + '</b> <span class="muted">' + n + ' חניכים</span></span><button class="btn small" data-act="rename-group" data-id="' + g.id + '">שינוי שם</button><button class="btn small danger" data-act="delete-group" data-id="' + g.id + '">מחיקה</button></div>';
      }).join('') : '<div class="muted">אין עדיין קבוצות. קבוצה = צוות / מחזור / חדר — מה שנוח לכם לסנן לפיו.</div>') +
      '<form class="inline-form" data-form="add-group"><label class="sr" for="g-name">שם קבוצה</label><input id="g-name" placeholder="שם קבוצה חדשה" maxlength="40" required /><button class="btn primary">' + icon('plus') + 'הוספה</button></form></div>';
    html += '<div class="card"><h2>תבניות הודעה <span class="count">' + S.templates.length + '</span></h2>' +
      S.templates.map(function (t) {
        return '<div class="list-it"><div class="grow"><b>' + esc(t.title) + '</b> <span class="pill ex">' + (t.audience === 'students' ? 'לחניכים' : 'להורים') + '</span><div class="muted">' + esc(t.body.length > 90 ? t.body.slice(0, 90) + '…' : t.body) + '</div></div><button class="btn small" data-act="edit-tpl" data-id="' + t.id + '">עריכה</button><button class="btn small danger" data-act="delete-tpl" data-id="' + t.id + '">מחיקה</button></div>';
      }).join('') +
      '<div class="btns" style="margin-top:10px"><button class="btn" data-act="edit-tpl" data-id="">' + icon('plus') + 'תבנית חדשה</button></div></div>';
    html += '<div class="card"><h2>ייצוא לאקסל</h2><p class="muted" style="margin-top:0">קובץ שנפתח באקסל עם עברית תקינה. טוב גם כגיבוי.</p><div class="btns"><button class="btn" data-act="export-students">' + icon('down') + 'כל החניכים וההורים</button><button class="btn" data-act="export-attendance">' + icon('down') + 'נוכחות ' + ATT_DAYS + ' ימים אחרונים</button></div></div>';
    html += '<div class="card"><h2>התקנה בטלפון</h2><p class="muted" style="margin-top:0">כדי שהמערכת תיפתח מאייקון כמו אפליקציה:</p><div><b>אייפון:</b> לפתוח ב-Safari → כפתור השיתוף (ריבוע עם חץ) → "הוסף למסך הבית".</div><div style="margin-top:6px"><b>אנדרואיד:</b> לפתוח ב-Chrome → שלוש הנקודות → "התקנת אפליקציה" / "הוספה למסך הבית".</div></div>';
    html += '</div><div>';
    html += '<div class="card" id="staff-card"><h2>צוות <span class="count">' + S.staff.length + '</span></h2>' +
      S.staff.map(function (p) {
        return '<div class="list-it"><div class="grow"><b>' + esc(p.name || 'בלי שם') + '</b> <span class="pill' + (p.role === 'admin' ? '' : ' ex') + '">' + (p.role === 'admin' ? 'מנהל' : 'צוות') + '</span><div class="muted"><span class="ltr">' + esc(p.email) + '</span> · כניסה אחרונה: ' + esc(stamp(p.last_sign_in)) + '</div></div>' +
          (isAdmin() && p.user_id !== S.me.user_id ? '<button class="btn small danger" data-act="remove-staff" data-id="' + p.user_id + '" data-name="' + esc(p.name || p.email) + '">הסרה</button>' : '') + '</div>';
      }).join('') +
      (isAdmin() ? '<form class="inline-form" data-form="add-staff"><label class="sr" for="st-email">מייל</label><input id="st-email" type="email" placeholder="המייל של איש הצוות" required dir="ltr" autocomplete="off" /><label class="sr" for="st-name">שם</label><input id="st-name" placeholder="שם" maxlength="60" required /><label class="sr" for="st-role">תפקיד</label><select id="st-role"><option value="staff">צוות</option><option value="admin">מנהל</option></select><button class="btn primary">' + icon('plus') + 'הוספה לצוות</button></form>' +
        '<p class="muted">קודם יוצרים לו משתמש ב-Supabase (Authentication → Add user), ואז מוסיפים כאן לפי המייל. מנהל יכול גם להוסיף ולהסיר צוות ולראות תקלות.</p>' : '') + '</div>';
    html += '<div class="card"><h2>פעילות אחרונה</h2><div id="activity" class="muted">טוען…</div></div>';
    if (isAdmin()) html += '<div class="card" id="errors"><h2>תקלות טכניות</h2><div id="errlist" class="muted">טוען…</div></div>';
    html += '</div></div>';
    $view.innerHTML = html;
    window.scrollTo(0, 0);
    if (tab === 'errors' && $('#errors')) $('#errors').scrollIntoView();
    try {
      var acts = await q(sb.from('activity').select('*').order('at', { ascending: false }).limit(40), 'טעינת פעילות');
      var el = $('#activity'); if (!el) return;
      el.className = '';
      el.innerHTML = acts.length ? acts.map(function (a) { return '<div class="list-it"><span class="grow"><b>' + esc(a.action) + '</b> ' + esc(a.detail) + '<div class="muted">' + esc(stamp(a.at)) + (staffName(a.user_id) ? ' · ' + esc(staffName(a.user_id)) : '') + '</div></span></div>'; }).join('') : '<div class="muted">עוד אין פעילות.</div>';
    } catch (e) { var a2 = $('#activity'); if (a2) a2.textContent = friendly(e); }
    if (isAdmin()) loadErrors();
  }
  async function loadErrors() {
    var el = $('#errlist'); if (!el) return;
    try {
      var rows = await q(sb.from('app_errors').select('*').order('created_at', { ascending: false }).limit(300), 'טעינת תקלות');
      var groups = {};
      rows.forEach(function (r) {
        var k = r.message;
        var g = groups[k] = groups[k] || { message: r.message, n: 0, last: r.created_at, first: r.created_at, stack: r.stack, page: r.page, users: {} };
        g.n++; g.first = r.created_at; if (r.user_id) g.users[r.user_id] = 1;
      });
      var list = Object.keys(groups).map(function (k) { return groups[k]; });
      el.className = '';
      el.innerHTML = list.length ? list.map(function (g, i) {
        return '<div class="list-it"><div class="grow"><b>' + esc(g.message) + '</b><div class="muted">' + g.n + ' פעמים · אחרונה ' + esc(stamp(g.last)) + ' · ' + Object.keys(g.users).length + ' משתמשים</div></div><button class="btn small" data-act="toggle-stack" data-i="' + i + '">פרטים</button>' +
          '<div class="stack hide" id="stack-' + i + '">' + esc((g.page || '') + '\n' + (g.stack || 'אין stack')) + '</div></div>';
      }).join('') + '<div class="btns" style="margin-top:10px"><button class="btn small danger" data-act="clear-errors">ניקוי כל התקלות</button></div>' : '<div class="muted">אין תקלות. 👍</div>';
    } catch (e) { el.textContent = friendly(e); }
  }
  async function editTemplate(id) {
    var t = id ? S.templates.filter(function (x) { return String(x.id) === String(id); })[0] : { title: '', body: '', audience: 'parents' };
    var v = await dialog('<form><h2>' + (id ? 'עריכת תבנית' : 'תבנית חדשה') + '</h2>' +
      '<div class="field"><label for="t-title">שם התבנית</label><input id="t-title" maxlength="60" required value="' + esc(t.title) + '" /></div>' +
      '<div class="field" style="margin-top:10px"><label for="t-aud">נשלחת אל</label><select id="t-aud"><option value="parents"' + (t.audience === 'parents' ? ' selected' : '') + '>הורים</option><option value="students"' + (t.audience === 'students' ? ' selected' : '') + '>חניכים</option></select></div>' +
      '<div class="field" style="margin-top:10px"><label for="t-body">ההודעה</label><textarea id="t-body" maxlength="1000" required>' + esc(t.body) + '</textarea></div>' +
      '<div class="muted">אפשר להשתמש ב: {חניך} {הורה} {שם_מלא} {תאריך}</div>' +
      '<div class="btns"><button class="btn primary" type="submit">שמירה</button><button class="btn" type="button" data-v="no">ביטול</button></div></form>',
      { value: function (d) { return { title: $('#t-title', d).value.trim(), audience: $('#t-aud', d).value, body: $('#t-body', d).value.trim() }; }, focus: function (d) { $('#t-title', d).focus(); } });
    if (!v) return;
    if (!v.title || !v.body) return toast('צריך שם וגם תוכן', true);
    try {
      if (id) await q(sb.from('templates').update(v).eq('id', id), 'עדכון תבנית');
      else await q(sb.from('templates').insert(Object.assign({ sort: S.templates.length + 1 }, v)), 'הוספת תבנית');
      S.templates = await q(sb.from('templates').select('*').order('sort').order('id'), 'טעינת תבניות');
      toast('התבנית נשמרה'); render();
    } catch (e) { toast(friendly(e), true); }
  }

  // ---------- ייצוא ----------
  function exportStudents() {
    var rows = S.students.slice().sort(byName).map(function (s) {
      return [s.first_name, s.last_name, s.phone, s.city, s.birth_date ? L.fmtDay(s.birth_date) : '', groupName(s.group_id), s.active ? 'פעיל' : 'עזב', s.parent1_name, s.parent1_phone, s.parent2_name, s.parent2_phone, s.notes];
    });
    download('mechina-students-' + today() + '.csv', L.csv(['שם פרטי', 'שם משפחה', 'טלפון', 'עיר', 'תאריך לידה', 'קבוצה', 'סטטוס', 'הורה 1', 'טלפון הורה 1', 'הורה 2', 'טלפון הורה 2', 'הערות'], rows));
  }
  function exportAttendance() {
    var days = S.days.slice().reverse();
    var rows = S.students.slice().sort(byName).map(function (s) {
      var m = S.att[s.id] || {};
      return [fullName(s), groupName(s.group_id), (L.attendanceRate(days.map(function (d) { return m[d]; }).filter(Boolean)) == null ? '' : L.attendanceRate(days.map(function (d) { return m[d]; }).filter(Boolean)) + '%')]
        .concat(days.map(function (d) { return STATUS[m[d]] || ''; }));
    });
    download('mechina-attendance-' + today() + '.csv', L.csv(['שם', 'קבוצה', 'אחוז נוכחות'].concat(days.map(L.fmtDay)), rows));
  }

  // ---------- פעולות (לחיצות וטפסים) ----------
  async function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'sent') { ui.sent[b.getAttribute('data-key')] = 1; setTimeout(render, 300); return; }
    e.preventDefault();
    try {
      if (act === 'mark') return mark(b);
      if (act === 'mark-rest') return markRest(b);
      if (act === 'copy') { toast((await copy(b.getAttribute('data-text'))) ? 'המספר הועתק' : 'ההעתקה לא הצליחה', false); return; }
      if (act === 'copy-numbers') {
        var nums = $$('.msg-row .ltr').map(function (x) { return x.textContent; });
        toast((await copy(nums.join(', '))) ? nums.length + ' מספרים הועתקו' : 'ההעתקה לא הצליחה'); return;
      }
      if (act === 'reset-sent') { ui.sent = {}; render(); return; }
      if (act === 'export-students') return exportStudents();
      if (act === 'export-attendance') return exportAttendance();
      if (act === 'toggle-stack') { $('#stack-' + b.getAttribute('data-i')).classList.toggle('hide'); return; }
      if (act === 'toggle-active') {
        var s = S.students.filter(function (x) { return x.id === id; })[0];
        if (s.active && !(await confirmBox('לסמן ש' + fullName(s) + ' עזב/ה?', 'הכרטיס והנוכחות נשמרים, אבל החניך לא יופיע ברשימות, בנוכחות ובהודעות. אפשר להחזיר בכל רגע.', 'סימון כעזב/ה'))) return;
        var row = (await q(sb.from('students').update({ active: !s.active }).eq('id', id).select(), 'שינוי סטטוס'))[0];
        Object.assign(s, row); toast(row.active ? 'הוחזר/ה לפעילים' : 'סומן/ה כעזב/ה'); render(); return;
      }
      if (act === 'delete-student') {
        var s2 = S.students.filter(function (x) { return x.id === id; })[0];
        if (!(await confirmBox('למחוק את ' + fullName(s2) + ' לצמיתות?', 'כל הפרטים וכל הנוכחות שלו יימחקו ואי אפשר לשחזר. אם החניך עזב — עדיף "סימון כעזב/ה".', 'מחיקה לצמיתות', true))) return;
        await q(sb.from('students').delete().eq('id', id), 'מחיקת חניך');
        S.students = S.students.filter(function (x) { return x.id !== id; });
        delete S.att[id];
        toast('נמחק'); go('#/students'); return;
      }
      if (act === 'my-name') {
        var nm = await promptBox('השם שלך', 'השם שיופיע לשאר הצוות', S.me.name);
        if (!nm) return;
        await q(sb.rpc('set_my_name', { p_name: nm }), 'שינוי שם');
        S.me.name = nm; S.staff.forEach(function (p) { if (p.user_id === S.me.user_id) p.name = nm; });
        $('#who').textContent = 'שלום, ' + nm; toast('נשמר'); render(); return;
      }
      if (act === 'logout') { await sb.auth.signOut(); location.hash = ''; location.reload(); return; }
      if (act === 'rename-group') {
        var g = S.groups.filter(function (x) { return String(x.id) === id; })[0];
        var nn = await promptBox('שינוי שם קבוצה', 'שם חדש', g.name);
        if (!nn || nn === g.name) return;
        await q(sb.from('groups').update({ name: nn }).eq('id', id), 'שינוי שם קבוצה');
        g.name = nn; toast('נשמר'); render(); return;
      }
      if (act === 'delete-group') {
        var g2 = S.groups.filter(function (x) { return String(x.id) === id; })[0];
        var n = S.students.filter(function (s) { return s.group_id === g2.id; }).length;
        if (!(await confirmBox('למחוק את הקבוצה ' + g2.name + '?', n ? n + ' החניכים שבה יישארו במערכת, בלי קבוצה.' : 'אין בה חניכים.', 'מחיקה', true))) return;
        await q(sb.from('groups').delete().eq('id', id), 'מחיקת קבוצה');
        S.groups = S.groups.filter(function (x) { return x !== g2; });
        S.students.forEach(function (s) { if (s.group_id === g2.id) s.group_id = null; });
        toast('נמחקה'); render(); return;
      }
      if (act === 'edit-tpl') return editTemplate(id);
      if (act === 'delete-tpl') {
        var t = S.templates.filter(function (x) { return String(x.id) === id; })[0];
        if (!(await confirmBox('למחוק את התבנית "' + t.title + '"?', 'אפשר ליצור אותה שוב בכל רגע.', 'מחיקה', true))) return;
        await q(sb.from('templates').delete().eq('id', id), 'מחיקת תבנית');
        S.templates = S.templates.filter(function (x) { return x !== t; });
        toast('נמחקה'); render(); return;
      }
      if (act === 'remove-staff') {
        if (!(await confirmBox('להסיר את ' + b.getAttribute('data-name') + ' מהצוות?', 'הוא לא יוכל יותר לראות את הנתונים. המשתמש עצמו נשאר ב-Supabase.', 'הסרה', true))) return;
        await q(sb.rpc('admin_remove_staff', { p_user: id }), 'הסרת איש צוות');
        S.staff = S.staff.filter(function (p) { return p.user_id !== id; });
        toast('הוסר'); render(); return;
      }
      if (act === 'clear-errors') {
        if (!(await confirmBox('לנקות את כל התקלות?', 'הרשימה תתרוקן. תקלות חדשות ימשיכו להירשם.', 'ניקוי', true))) return;
        await q(sb.from('app_errors').delete().gte('id', 0), 'ניקוי תקלות');
        S.errors24 = 0; loadErrors(); return;
      }
    } catch (err) { toast(friendly(err), true); }
  }
  async function onSubmit(e) {
    var f = e.target;
    if (f.id === 'student-form') { e.preventDefault(); return saveStudent(f, e.submitter && e.submitter.value === 'more'); }
    var kind = f.getAttribute('data-form');
    if (!kind) return;
    e.preventDefault();
    var btn = $('button', f); btn.disabled = true;
    try {
      if (kind === 'add-group') {
        var name = $('#g-name').value.trim(); if (!name) return;
        var row = (await q(sb.from('groups').insert({ name: name, sort: S.groups.length + 1 }).select(), 'הוספת קבוצה'))[0];
        S.groups.push(row); toast('הקבוצה נוספה'); render();
      }
      if (kind === 'add-staff') {
        var r = await q(sb.rpc('admin_add_staff', { p_email: $('#st-email').value.trim(), p_name: $('#st-name').value.trim(), p_role: $('#st-role').value }), 'הוספת איש צוות');
        if (r === 'no_user') {
          await dialog('<h2>עוד אין משתמש עם המייל הזה</h2><p>קודם צריך ליצור לו משתמש ב-Supabase:</p><ol><li>Authentication → Users</li><li>Add user → Create new user</li><li>למלא מייל וסיסמה, לסמן Auto Confirm User</li><li>לחזור לכאן ולהוסיף שוב</li></ol><div class="btns"><button class="btn primary" data-v="ok">הבנתי</button></div>');
        } else { S.staff = await q(sb.rpc('staff_list'), 'טעינת צוות'); toast('נוסף לצוות'); render(); }
      }
    } catch (err) { toast(friendly(err), true); }
    finally { if (document.body.contains(btn)) btn.disabled = false; }
  }
  async function onChange(e) {
    if (e.target.id === 'att-day' && e.target.value) {
      var g = route().q.get('g');
      var p = []; if (e.target.value !== today()) p.push('d=' + e.target.value); if (g) p.push('g=' + g);
      go('#/attendance' + (p.length ? '?' + p.join('&') : ''));
    }
    if (e.target.id === 'f-group_id' && e.target.value === '__new') {
      var name = await promptBox('קבוצה חדשה', 'שם הקבוצה', '');
      if (!name) { e.target.value = ''; return; }
      try {
        var row = (await q(sb.from('groups').insert({ name: name, sort: S.groups.length + 1 }).select(), 'הוספת קבוצה'))[0];
        S.groups.push(row);
        var opt = document.createElement('option'); opt.value = row.id; opt.textContent = row.name;
        e.target.insertBefore(opt, e.target.lastElementChild); e.target.value = row.id;
      } catch (err) { e.target.value = ''; toast(friendly(err), true); }
    }
  }

  // ---------- כניסה ----------
  function loginView(msg) {
    document.getElementById('app').innerHTML = '<div class="center"><form class="card login" id="login" novalidate>' +
      '<div class="brand">' + LOGO + '<span><b>מכינת נהריה</b><small>מערכת ניהול</small></span></div>' +
      '<div class="field"><label for="l-email">מייל</label><input id="l-email" type="email" autocomplete="username" dir="ltr" required /></div>' +
      '<div class="field"><label for="l-pass">סיסמה</label><input id="l-pass" type="password" autocomplete="current-password" dir="ltr" required /></div>' +
      '<div class="form-err" id="l-err" role="alert">' + esc(msg || '') + '</div>' +
      '<button class="btn primary" type="submit">כניסה</button>' +
      '<div class="btns" style="justify-content:center;margin-top:10px"><button class="btn small" type="button" id="forgot">שכחתי סיסמה</button></div></form></div>';
    $('#l-email').focus();
    $('#login').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = $('button[type=submit]', this), err = $('#l-err');
      var email = $('#l-email').value.trim(), pass = $('#l-pass').value;
      if (!email || !pass) { err.textContent = 'צריך למלא מייל וסיסמה'; return; }
      btn.disabled = true; err.textContent = '';
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) { btn.disabled = false; err.textContent = friendly(r.error); return; }
      start(r.data.session);
    });
    $('#forgot').addEventListener('click', async function () {
      var email = $('#l-email').value.trim(), err = $('#l-err');
      if (!email) { err.textContent = 'קודם כותבים את המייל, ואז לוחצים "שכחתי סיסמה"'; $('#l-email').focus(); return; }
      this.disabled = true;
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      this.disabled = false;
      err.textContent = r.error ? friendly(r.error) : 'אם המייל רשום — נשלח אליו קישור לאיפוס סיסמה. בדקו גם בספאם.';
    });
  }
  function newPasswordView() {
    document.getElementById('app').innerHTML = '<div class="center"><form class="card login" id="np"><div class="brand">' + LOGO + '<span><b>סיסמה חדשה</b><small>מכינת נהריה</small></span></div>' +
      '<div class="field"><label for="np-1">סיסמה חדשה (לפחות 8 תווים)</label><input id="np-1" type="password" autocomplete="new-password" dir="ltr" minlength="8" required /></div>' +
      '<div class="form-err" id="np-err" role="alert"></div><button class="btn primary" type="submit">שמירה</button></form></div>';
    $('#np').addEventListener('submit', async function (e) {
      e.preventDefault();
      var p = $('#np-1').value, err = $('#np-err');
      if (p.length < 8) { err.textContent = 'לפחות 8 תווים'; return; }
      var r = await sb.auth.updateUser({ password: p });
      if (r.error) { err.textContent = friendly(r.error); return; }
      location.hash = ''; start((await sb.auth.getSession()).data.session);
    });
  }
  function messageView(title, text, buttons) {
    document.getElementById('app').innerHTML = '<div class="center"><div class="card login"><div class="brand">' + LOGO + '<span><b>מכינת נהריה</b><small>מערכת ניהול</small></span></div><h2 style="font-size:19px;margin-bottom:8px">' + esc(title) + '</h2><p class="muted">' + text + '</p><div class="btns">' + (buttons || '') + '</div></div></div>';
  }

  var started = false;
  async function start(session) {
    if (!session) return loginView();
    S.me = { user_id: session.user.id, name: '', role: 'staff' };
    S.email = session.user.email || '';
    document.getElementById('app').innerHTML = '<div class="loading">טוען…</div>';
    try {
      var mine = await q(sb.from('staff').select('*').eq('user_id', S.me.user_id), 'בדיקת הרשאה');
      if (!mine.length) {
        var claimed = await q(sb.rpc('claim_first_admin'), 'הגדרת מנהל ראשון');
        if (!claimed) {
          messageView('החשבון עוד לא בצוות', 'נכנסת כ-<span class="ltr">' + esc(S.email) + '</span>, אבל החשבון הזה עוד לא נוסף לצוות המכינה. בקשו מהמנהל להוסיף אתכם בהגדרות → צוות.', '<button class="btn" id="out">יציאה</button>');
          $('#out').onclick = async function () { await sb.auth.signOut(); loginView(); };
          return;
        }
      }
      await loadAll();
    } catch (e) {
      messageView('הטעינה נכשלה', esc(friendly(e)), '<button class="btn primary" onclick="location.reload()">לנסות שוב</button><button class="btn" id="out">יציאה</button>');
      $('#out').onclick = async function () { await sb.auth.signOut(); loginView(); };
      return;
    }
    shell();
    if (!started) {
      started = true;
      document.addEventListener('click', onClick);
      document.addEventListener('submit', onSubmit);
      document.addEventListener('change', onChange);
      window.addEventListener('hashchange', render);
      window.addEventListener('online', function () { setOnline(); refresh(); });
      window.addEventListener('offline', setOnline);
      // חוזרים לאפליקציה אחרי זמן → מרעננים נתונים
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - S.loadedAt > 30000) refresh(); });
      setInterval(function () { if (document.visibilityState === 'visible') refresh(); }, 5 * 60000);
      live();
    }
    render();
    if (!S.me.name) {
      var nm = await promptBox('ברוכים הבאים!', 'איך קוראים לך? (השם יופיע לשאר הצוות)', '');
      if (nm) { try { await q(sb.rpc('set_my_name', { p_name: nm }), 'שינוי שם'); S.me.name = nm; $('#who').textContent = 'שלום, ' + nm; render(); } catch (e) { toast(friendly(e), true); } }
    }
  }

  function boot() {
    if (!cfg.url || cfg.url.indexOf('YOUR-') !== -1) {
      return messageView('המערכת עוד לא מחוברת', 'צריך למלא את פרטי Supabase בקובץ <span class="ltr">config.js</span>.');
    }
    sb = window.sb = supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    var recovering = /type=recovery/.test(location.hash);
    sb.auth.onAuthStateChange(function (ev) {
      if (ev === 'PASSWORD_RECOVERY') { recovering = true; newPasswordView(); }
      if (ev === 'SIGNED_OUT' && started) location.reload();
    });
    sb.auth.getSession().then(function (r) {
      if (recovering) return newPasswordView();
      start(r.data.session);
    }, function (e) { messageView('אין חיבור', esc(friendly(e)), '<button class="btn primary" onclick="location.reload()">לנסות שוב</button>'); });
  }
  boot();
})();
