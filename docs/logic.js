/* מכינת נהריה — פונקציות חישוב טהורות (בלי מסך ובלי שרת), כדי שאפשר לבדוק אותן.
   עובד גם בדפדפן (window.Logic) וגם בבדיקות (node --test tests/). */
(function (root) {
  'use strict';
  var DAY = 86400000;
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // ---------- טלפונים ----------
  // מחזיר { intl: '9725XXXXXXXX', local: '05X-XXXXXXX' } או null אם המספר לא תקין
  function normPhone(raw) {
    var d = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (!d) return null;
    if (d.indexOf('972') === 0) d = d.slice(3);
    else if (d.charAt(0) === '0') d = d.slice(1);
    if (d.charAt(0) === '0') return null;
    var mobile = d.charAt(0) === '5';
    if (mobile ? d.length !== 9 : d.length !== 8) return null;
    var local = '0' + d;
    local = mobile ? local.slice(0, 3) + '-' + local.slice(3) : local.slice(0, 2) + '-' + local.slice(2);
    return { intl: '972' + d, local: local };
  }
  function waLink(phone, text) {
    var p = normPhone(phone);
    if (!p) return null;
    return 'https://wa.me/' + p.intl + (text ? '?text=' + encodeURIComponent(text) : '');
  }
  function telLink(phone) {
    var p = normPhone(phone);
    return p ? 'tel:+' + p.intl : null;
  }

  // ---------- תבניות הודעה ----------
  function fillTemplate(body, v) {
    v = v || {};
    return String(body || '')
      .replace(/\{הורה\}/g, v.parent || 'הורה יקר/ה')
      .replace(/\{חניך\}/g, v.first || '')
      .replace(/\{שם_מלא\}/g, v.full || v.first || '')
      .replace(/\{תאריך\}/g, v.date || '');
  }

  // ---------- תאריכים (מחרוזות YYYY-MM-DD, בלי בעיות של אזורי זמן) ----------
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(t);
    if (d.getUTCMonth() !== +m[2] - 1) return null;
    return d;
  }
  function dayStr(d) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function shiftDay(s, n) { return dayStr(new Date(parseDay(s).getTime() + n * DAY)); }
  function fmtDay(s) {
    var d = parseDay(s);
    return d ? d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() : '';
  }
  function weekday(s) { var d = parseDay(s); return d ? WEEKDAYS[d.getUTCDay()] : ''; }
  function isWeekend(s) { var d = parseDay(s); return !!d && (d.getUTCDay() === 5 || d.getUTCDay() === 6); }
  // היום לפי שעון ישראל, גם אם המחשב מכוון אחרת
  function israelToday(now) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now || new Date());
    var get = function (t) { return parts.filter(function (p) { return p.type === t; })[0].value; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  function ageOn(birth, today) {
    var b = parseDay(birth), t = parseDay(today);
    if (!b || !t) return null;
    var age = t.getUTCFullYear() - b.getUTCFullYear();
    if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) age--;
    return age;
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  // עוד כמה ימים יום ההולדת, ובאיזה גיל. 29 בפברואר נחגג ב-28 בשנה לא מעוברת.
  function upcomingBirthday(birth, today) {
    var b = parseDay(birth), t = parseDay(today);
    if (!b || !t) return null;
    function onYear(y) {
      var m = b.getUTCMonth(), d = b.getUTCDate();
      if (m === 1 && d === 29 && !isLeap(y)) d = 28;
      return new Date(Date.UTC(y, m, d));
    }
    var y = t.getUTCFullYear(), next = onYear(y);
    if (next < t) { y++; next = onYear(y); }
    return { days: Math.round((next - t) / DAY), age: y - b.getUTCFullYear() };
  }

  // ---------- נוכחות ----------
  // marks: { 'YYYY-MM-DD': status } של חניך אחד. days: ימי פעילות (ימים שבהם נלקחה נוכחות), מהחדש לישן.
  function absenceStreak(marks, days) {
    var n = 0;
    for (var i = 0; i < days.length; i++) {
      var st = marks[days[i]];
      if (st === 'absent') n++;
      else if (st === 'excused') continue;
      else break;
    }
    return n;
  }
  function attendanceRate(statuses) {
    var came = 0, total = 0;
    statuses.forEach(function (s) {
      if (s === 'present' || s === 'late') { came++; total++; } else if (s === 'absent') total++;
    });
    return total ? Math.round((came / total) * 100) : null;
  }

  // ---------- חניכים ----------
  function missingInfo(s) {
    var out = [];
    var p1 = normPhone(s.parent1_phone), p2 = normPhone(s.parent2_phone), me = normPhone(s.phone);
    if (s.parent1_phone && !p1) out.push('טלפון הורה 1 לא תקין');
    if (s.parent2_phone && !p2) out.push('טלפון הורה 2 לא תקין');
    if (s.phone && !me) out.push('טלפון החניך לא תקין');
    if (!p1 && !p2) out.push('אין טלפון של הורה');
    if (!s.phone) out.push('אין טלפון של החניך');
    return out;
  }
  var FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  function fold(v) { return String(v || '').toLowerCase().replace(/[ךםןףץ]/g, function (c) { return FINALS[c]; }).replace(/\s+/g, ' ').trim(); }
  function matches(s, q) {
    q = fold(q);
    if (!q) return true;
    var digits = q.replace(/\D/g, '');
    if (digits && digits.length === q.replace(/[\s-]/g, '').length) {
      return [s.phone, s.parent1_phone, s.parent2_phone].some(function (p) {
        return String(p || '').replace(/\D/g, '').indexOf(digits) !== -1;
      });
    }
    var hay = fold([s.first_name, s.last_name, s.city, s.parent1_name, s.parent2_name].join(' ') + ' ' + s.first_name + ' ' + s.last_name);
    return hay.indexOf(q) !== -1;
  }
  function validateStudent(s, today) {
    var e = {};
    if (!String(s.first_name || '').trim()) e.first_name = 'חובה למלא שם פרטי';
    ['phone', 'parent1_phone', 'parent2_phone'].forEach(function (k) {
      if (s[k] && !normPhone(s[k])) e[k] = 'מספר לא תקין';
    });
    if (s.birth_date) {
      if (!parseDay(s.birth_date)) e.birth_date = 'תאריך לא תקין';
      else if (today && s.birth_date > today) e.birth_date = 'תאריך לידה בעתיד';
    }
    return e;
  }

  // ---------- ייצוא לאקסל ----------
  function cell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // שאקסל לא יריץ נוסחה מתוך נתון
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(headers, rows) {
    return '﻿' + [headers].concat(rows).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
  }

  var api = {
    normPhone: normPhone, waLink: waLink, telLink: telLink, fillTemplate: fillTemplate,
    parseDay: parseDay, shiftDay: shiftDay, fmtDay: fmtDay, weekday: weekday, isWeekend: isWeekend,
    israelToday: israelToday, ageOn: ageOn, upcomingBirthday: upcomingBirthday,
    absenceStreak: absenceStreak, attendanceRate: attendanceRate,
    missingInfo: missingInfo, matches: matches, validateStudent: validateStudent, csv: csv,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(this);
