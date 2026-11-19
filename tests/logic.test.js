// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../site/logic.js');

test('normPhone: Israeli mobile in every common format', () => {
  for (const raw of ['050-1234567', '0501234567', '050 123 4567', '+972-50-123-4567', '972501234567', '501234567', '(050)1234567']) {
    assert.deepEqual(L.normPhone(raw), { intl: '972501234567', local: '050-1234567' }, raw);
  }
});

test('normPhone: landline and invalid numbers', () => {
  assert.deepEqual(L.normPhone('04-9921234'), { intl: '97249921234', local: '04-9921234' });
  assert.equal(L.normPhone(''), null);
  assert.equal(L.normPhone(null), null);
  assert.equal(L.normPhone('12345'), null);
  assert.equal(L.normPhone('abc'), null);
  assert.equal(L.normPhone('0501234567890'), null);
});

test('waLink and telLink', () => {
  assert.equal(L.waLink('050-1234567', 'שלום דנה'), 'https://wa.me/972501234567?text=' + encodeURIComponent('שלום דנה'));
  assert.equal(L.waLink('050-1234567', ''), 'https://wa.me/972501234567');
  assert.equal(L.waLink('bad', 'x'), null);
  assert.equal(L.telLink('050-1234567'), 'tel:+972501234567');
});

test('fillTemplate replaces every placeholder, keeps unknown text', () => {
  const out = L.fillTemplate('שלום {הורה}, {חניך} ({שם_מלא}) — {תאריך} {אחר}', {
    parent: 'רונית', first: 'דנה', full: 'דנה כהן', date: '20.11.2026',
  });
  assert.equal(out, 'שלום רונית, דנה (דנה כהן) — 20.11.2026 {אחר}');
  assert.equal(L.fillTemplate('שלום {הורה}', { first: 'דנה' }), 'שלום הורה יקר/ה');
});

test('absenceStreak counts consecutive absences on recent session days', () => {
  const days = ['2026-11-19', '2026-11-18', '2026-11-17', '2026-11-16', '2026-11-15'];
  assert.equal(L.absenceStreak({ '2026-11-19': 'absent', '2026-11-18': 'absent', '2026-11-17': 'absent', '2026-11-16': 'present' }, days), 3);
  // excused is skipped, not a break
  assert.equal(L.absenceStreak({ '2026-11-19': 'absent', '2026-11-18': 'excused', '2026-11-17': 'absent', '2026-11-16': 'late' }, days), 2);
  // a day with no mark for this student ends the streak
  assert.equal(L.absenceStreak({ '2026-11-19': 'absent', '2026-11-17': 'absent' }, days), 1);
  assert.equal(L.absenceStreak({}, days), 0);
  assert.equal(L.absenceStreak({ '2026-11-19': 'present' }, days), 0);
});

test('attendanceRate ignores excused days', () => {
  assert.equal(L.attendanceRate(['present', 'late', 'absent', 'excused']), 67);
  assert.equal(L.attendanceRate(['excused']), null);
  assert.equal(L.attendanceRate([]), null);
  assert.equal(L.attendanceRate(['present', 'present']), 100);
});

test('upcomingBirthday: days until, age turning, year wrap, Feb 29', () => {
  assert.deepEqual(L.upcomingBirthday('2008-11-20', '2026-11-20'), { days: 0, age: 18 });
  assert.deepEqual(L.upcomingBirthday('2008-11-25', '2026-11-20'), { days: 5, age: 18 });
  assert.deepEqual(L.upcomingBirthday('2008-01-02', '2026-12-30'), { days: 3, age: 19 });
  assert.deepEqual(L.upcomingBirthday('2008-11-19', '2026-11-20'), { days: 364, age: 19 });
  assert.deepEqual(L.upcomingBirthday('2008-02-29', '2027-02-27'), { days: 1, age: 19 }); // celebrated Feb 28 in non-leap years
  assert.equal(L.upcomingBirthday(null, '2026-11-20'), null);
  assert.equal(L.upcomingBirthday('garbage', '2026-11-20'), null);
});

test('ageOn', () => {
  assert.equal(L.ageOn('2008-11-20', '2026-11-20'), 18);
  assert.equal(L.ageOn('2008-11-21', '2026-11-20'), 17);
  assert.equal(L.ageOn('', '2026-11-20'), null);
});

test('missingInfo flags missing or broken phones', () => {
  assert.deepEqual(L.missingInfo({ phone: '050-1234567', parent1_phone: '052-7654321', parent2_phone: '' }), []);
  assert.deepEqual(L.missingInfo({ phone: '', parent1_phone: '', parent2_phone: '' }), ['אין טלפון של הורה', 'אין טלפון של החניך']);
  assert.deepEqual(L.missingInfo({ phone: '050-1234567', parent1_phone: '123', parent2_phone: '' }), ['טלפון הורה 1 לא תקין', 'אין טלפון של הורה']);
});

test('matches: name, phone digits, city, parents; Hebrew final letters and spaces', () => {
  const s = { first_name: 'דנה', last_name: 'כהן', phone: '050-1234567', city: 'נהריה', parent1_name: 'רונית', parent2_name: '' };
  assert.ok(L.matches(s, ''));
  assert.ok(L.matches(s, 'דנה כ'));
  assert.ok(L.matches(s, '1234567'));
  assert.ok(L.matches(s, '0501234'));
  assert.ok(L.matches(s, 'נהר'));
  assert.ok(L.matches(s, 'רונית'));
  assert.ok(!L.matches(s, 'יוסי'));
});

test('csv: BOM, quoting, newlines', () => {
  const out = L.csv(['שם', 'הערה'], [['דנה', 'אמרה "שלום", והלכה'], ['יוסי', 'שורה\nשנייה']]);
  assert.equal(out, '﻿שם,הערה\r\nדנה,"אמרה ""שלום"", והלכה"\r\nיוסי,"שורה\nשנייה"');
  assert.equal(L.csv(['a'], [['=1+1']]), '﻿a\r\n\'=1+1'); // no formula injection in Excel
});

test('dates: shiftDay, fmtDay, weekday name', () => {
  assert.equal(L.shiftDay('2026-11-20', -1), '2026-11-19');
  assert.equal(L.shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(L.shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(L.fmtDay('2026-11-20'), '20.11.2026');
  assert.equal(L.weekday('2026-11-20'), 'שישי');
  assert.equal(L.isWeekend('2026-11-21'), true);
  assert.equal(L.isWeekend('2026-11-22'), false);
});

test('validateStudent', () => {
  assert.deepEqual(L.validateStudent({ first_name: 'דנה', phone: '', parent1_phone: '050-1234567' }), {});
  assert.deepEqual(L.validateStudent({ first_name: '  ', phone: '12', parent1_phone: '', birth_date: '2030-01-01' }, '2026-11-20'), {
    first_name: 'חובה למלא שם פרטי',
    phone: 'מספר לא תקין',
    birth_date: 'תאריך לידה בעתיד',
  });
});
