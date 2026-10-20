'use strict';

// ---------- 저장소 ----------
const STORAGE_KEY = 'payrec.v1';

function emptyDb() {
  return { version: 1, perPerson: 20000, people: [], records: [], lastBackup: null };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDb();
    return normalizeDb(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    return emptyDb();
  }
}

function normalizeDb(d) {
  const db = Object.assign(emptyDb(), d);
  if (!Array.isArray(db.people)) db.people = [];
  if (!Array.isArray(db.records)) db.records = [];
  db.people = db.people.filter(p => p && typeof p.name === 'string')
    .map(p => ({ name: p.name, uses: p.uses || 0, isDefault: !!p.isDefault }));
  db.records = db.records.filter(r => r && r.id && r.date && (r.type === 'meal' || r.type === 'taxi'))
    .map(r => ({ ...r, amount: Number(r.amount) || 0, people: Array.isArray(r.people) ? r.people : [] }));
  db.perPerson = Number(db.perPerson) || 20000;
  return db;
}

function saveDb() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    alert('저장에 실패했습니다. 저장 공간을 확인하십시오.\n' + e.message);
  }
}

let db = loadDb();

// ---------- 유틸 ----------
const $ = sel => document.querySelector(sel);
const won = n => (Number(n) || 0).toLocaleString('ko-KR') + '원';
const parseAmount = s => Number(String(s).replace(/[^\d]/g, '')) || 0;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function dateLabel(s) {
  const [y, m, d] = s.split('-').map(Number);
  return `${m}/${d}(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2000);
}

function formatAmountInput(input) {
  const n = parseAmount(input.value);
  input.value = n ? n.toLocaleString('ko-KR') : '';
}

// ---------- 입력 화면 상태 ----------
const form = {
  type: 'meal',
  selected: new Set(),
  editingId: null,
};

// 새 기록의 기본 인원: 해당 날짜의 마지막 식대 기록 → 그 이전 가장 최근 식대 기록 → "기본" 지정 인원
function suggestPeople(date) {
  const meals = db.records.filter(r => r.type === 'meal' && r.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const last = meals[meals.length - 1];
  return last ? last.people : db.people.filter(p => p.isDefault).map(p => p.name);
}

// 추천할 인원이 없으면(첫 사용 등) 현재 선택을 유지
function selectSuggested() {
  const names = suggestPeople($('#f-date').value || today());
  if (names.length) form.selected = new Set(names);
}

function resetForm(keepDate) {
  form.editingId = null;
  if (!keepDate) $('#f-date').value = today();
  form.selected = new Set();
  selectSuggested();
  $('#f-amount').value = '';
  $('#f-memo').value = '';
  $('#save').textContent = '저장';
  $('#cancel-edit').hidden = true;
  setType('meal');
}

function setType(type) {
  form.type = type;
  document.querySelectorAll('#f-type button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
  $('#meal-fields').hidden = type !== 'meal';
  renderBalance();
}

function sortedPeople() {
  return [...db.people].sort((a, b) =>
    (b.isDefault - a.isDefault) || (b.uses - a.uses) || a.name.localeCompare(b.name, 'ko'));
}

// 당일 식대 현황. 한도는 그날 포함된 인원(중복 제외) × 1인 한도, 사용은 결제 합계.
// names: 지금 입력 중인 결제의 인원(합산 대상), excludeId: 수정 중인 기록(중복 집계 방지)
function dayStatus(date, names = [], excludeId) {
  const meals = db.records.filter(r => r.type === 'meal' && r.date === date && r.id !== excludeId);
  const people = [...new Set([...meals.flatMap(r => r.people), ...names])];
  const used = meals.reduce((s, r) => s + r.amount, 0);
  return { people, max: people.length * limitOf(meals), used, count: meals.length };
}

// 기록 당시 1인 한도(설정 변경 이후에도 과거 기록이 바뀌지 않도록 기록에 저장)
function limitOf(meals) {
  return meals.length ? Math.max(...meals.map(r => r.limit || db.perPerson)) : db.perPerson;
}

function renderChips() {
  const box = $('#people-chips');
  const people = sortedPeople();
  // 수정 중인 기록에 목록에서 삭제된 이름이 있으면 함께 표시
  const names = people.map(p => p.name);
  form.selected.forEach(n => { if (!names.includes(n)) names.push(n); });
  box.innerHTML = names.length
    ? names.map(n => `<button type="button" class="chip${form.selected.has(n) ? ' on' : ''}" data-name="${esc(n)}">${esc(n)}</button>`).join('')
    : '<p class="hint">아래에서 이름을 추가하십시오.</p>';
  $('#sel-count').textContent = form.selected.size ? `${form.selected.size}명 선택` : '';
}

function renderBalance() {
  const el = $('#balance');
  const amount = parseAmount($('#f-amount').value);
  if (form.type === 'taxi') {
    el.className = 'balance taxi';
    el.innerHTML = `택시(야근)는 식대 한도와 별도로 집계됩니다.`;
    return;
  }
  const d = dayStatus($('#f-date').value, [...form.selected], form.editingId);
  const avail = d.max - d.used;
  const remain = avail - amount;
  el.className = 'balance' + (remain < 0 ? ' over' : '');
  el.innerHTML = `
    <div><span>사용 가능</span><b>${won(avail)}</b><small>${d.people.length}명 × ${won(d.max / (d.people.length || 1))}${d.used ? `<br>− 오늘 앞선 결제 ${won(d.used)}` : ''}</small></div>
    <div><span>이번 결제</span><b>${won(amount)}</b></div>
    <div><span>${remain < 0 ? '초과' : '잔액'}</span><b>${won(Math.abs(remain))}</b></div>`;
}

function addPerson(name) {
  name = name.trim();
  if (!name) return;
  if (!db.people.some(p => p.name === name)) {
    db.people.push({ name, uses: 0, isDefault: false });
    saveDb();
  }
  form.selected.add(name);
  renderChips();
  renderBalance();
  renderPeopleAdmin();
}

function saveRecord(e) {
  e.preventDefault();
  const date = $('#f-date').value;
  const amount = parseAmount($('#f-amount').value);
  const memo = $('#f-memo').value.trim();
  if (!date) return toast('날짜를 선택하십시오.');
  if (!amount) return toast('금액을 입력하십시오.');
  const people = form.type === 'meal' ? [...form.selected] : [];
  if (form.type === 'meal' && !people.length) return toast('인원을 1명 이상 선택하십시오.');
  if (form.type === 'meal') {
    const d = dayStatus(date, people, form.editingId);
    if (amount > d.max - d.used &&
        !confirm(`당일 남은 한도(${won(d.max - d.used)})를 초과합니다. 그대로 저장하시겠습니까?`)) return;
  }

  const now = new Date().toISOString();
  if (form.editingId) {
    const r = db.records.find(x => x.id === form.editingId);
    if (r) Object.assign(r, { type: form.type, date, amount, memo, people, limit: r.limit || db.perPerson, updatedAt: now });
  } else {
    db.records.push({ id: uid(), type: form.type, date, amount, memo, people, limit: db.perPerson, createdAt: now });
    people.forEach(n => {
      const p = db.people.find(x => x.name === n);
      if (p) p.uses++;
    });
  }
  saveDb();
  toast(form.editingId ? '수정되었습니다.' : '저장되었습니다.');
  resetForm(true);
  renderAll();
}

function editRecord(id) {
  const r = db.records.find(x => x.id === id);
  if (!r) return;
  form.editingId = id;
  form.selected = new Set(r.people);
  $('#f-date').value = r.date;
  $('#f-amount').value = r.amount.toLocaleString('ko-KR');
  $('#f-memo').value = r.memo || '';
  $('#save').textContent = '수정 저장';
  $('#cancel-edit').hidden = false;
  setType(r.type);
  renderChips();
  renderDay();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteRecord(id) {
  const r = db.records.find(x => x.id === id);
  if (!r || !confirm(`${dateLabel(r.date)} ${won(r.amount)} 기록을 삭제하시겠습니까?`)) return;
  db.records = db.records.filter(x => x.id !== id);
  r.people.forEach(n => { const p = db.people.find(x => x.name === n); if (p && p.uses > 0) p.uses--; });
  saveDb();
  if (form.editingId === id) resetForm(true);
  renderAll();
  toast('삭제되었습니다.');
}

function recordItem(r) {
  const isMeal = r.type === 'meal';
  return `<li class="rec ${r.type}${form.editingId === r.id ? ' editing' : ''}">
    <div class="rec-main">
      <span class="tag ${r.type}">${isMeal ? '식대' : '택시'}</span>
      <b>${won(r.amount)}</b>
    </div>
    ${isMeal ? `<div class="rec-people">${r.people.map(esc).join(', ')} (${r.people.length}명)</div>` : ''}
    ${r.memo ? `<div class="rec-memo">${esc(r.memo)}</div>` : ''}
    <div class="rec-actions">
      <button type="button" class="link" data-edit="${r.id}">수정</button>
      <button type="button" class="link danger" data-del="${r.id}">삭제</button>
    </div>
  </li>`;
}

// ---------- 달력 ----------
const cal = { month: null, lastSel: null };

function renderCalendar() {
  const sel = $('#f-date').value || today();
  if (sel !== cal.lastSel) { cal.month = sel.slice(0, 7); cal.lastSel = sel; }
  const [y, m] = cal.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const lastDay = new Date(y, m, 0).getDate();
  const marks = {};
  db.records.forEach(r => { if (r.date.startsWith(cal.month)) (marks[r.date] = marks[r.date] || new Set()).add(r.type); });
  const t = today();
  const cells = Array(first).fill('<span></span>');
  for (let d = 1; d <= lastDay; d++) {
    const date = `${cal.month}-${pad(d)}`;
    const mk = marks[date];
    const cls = ['day', mk && 'has', date === sel && 'sel', date === t && 'today',
      (first + d - 1) % 7 === 0 && 'sun', (first + d - 1) % 7 === 6 && 'sat'].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${cls}" data-date="${date}">${d}<span class="dots">${
      mk ? (mk.has('meal') ? '<i class="dot meal"></i>' : '') + (mk.has('taxi') ? '<i class="dot taxi"></i>' : '') : ''}</span></button>`);
  }
  $('#calendar').innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1" aria-label="이전 달">‹</button>
      <b>${y}년 ${m}월</b>
      <button type="button" class="cal-nav" data-nav="1" aria-label="다음 달">›</button>
      <button type="button" class="link cal-today" data-date="${t}">오늘</button>
    </div>
    <div class="cal-grid">${WEEK.map((w, i) => `<span class="wk${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</span>`).join('')}${cells.join('')}</div>
    <div class="cal-legend"><span><i class="dot meal"></i>식대</span><span><i class="dot taxi"></i>택시</span><span><i class="swatch"></i>입력한 날</span></div>`;
  $('#sel-date').textContent = dateLabel(sel);
}

function onDateChange() {
  if (!form.editingId) selectSuggested();
  renderChips();
  renderBalance();
  renderDay();
}

function renderDay() {
  renderCalendar();
  const date = $('#f-date').value || today();
  const recs = db.records.filter(r => r.date === date).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  $('#day-title').textContent = `${dateLabel(date)} 기록`;
  const meals = recs.filter(r => r.type === 'meal');
  const taxis = recs.filter(r => r.type === 'taxi');
  const day = dayTotals(meals);
  const taxiSum = taxis.reduce((s, r) => s + r.amount, 0);

  $('#day-summary').innerHTML = recs.length ? `
    ${meals.length ? `<div>식대 <b>${won(day.sum)}</b> / 한도 ${won(day.max)} (${day.people.length}명) ·
      <span class="${day.max - day.sum < 0 ? 'neg' : ''}">${day.max - day.sum < 0 ? '초과' : '잔액'} <b>${won(Math.abs(day.max - day.sum))}</b></span></div>` : ''}
    ${taxis.length ? `<div>택시 <b>${won(taxiSum)}</b> (별도)</div>` : ''}` : '';
  $('#day-list').innerHTML = recs.length ? recs.map(recordItem).join('') : '<li class="empty">기록이 없습니다.</li>';
}

// ---------- 월별 ----------
// 하루 식대 결제들의 합계. 한도는 그날 포함된 인원(중복 제외) × 1인 한도.
function dayTotals(meals) {
  const people = [...new Set(meals.flatMap(r => r.people))];
  return { people, sum: meals.reduce((s, r) => s + r.amount, 0), max: people.length * limitOf(meals) };
}

function mealsByDate(meals) {
  const map = new Map();
  meals.forEach(r => { if (!map.has(r.date)) map.set(r.date, []); map.get(r.date).push(r); });
  return [...map.entries()];
}

function monthRecords(month) {
  return db.records.filter(r => r.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
}

function renderMonth() {
  const month = $('#m-month').value;
  if (!month) return;
  const [y, m] = month.split('-').map(Number);
  const recs = monthRecords(month);
  const meals = recs.filter(r => r.type === 'meal');
  const taxis = recs.filter(r => r.type === 'taxi');
  const byDate = mealsByDate(meals).map(([date, list]) => ({ date, list, ...dayTotals(list) }));
  const mealSum = byDate.reduce((s, d) => s + d.sum, 0);
  const mealMax = byDate.reduce((s, d) => s + d.max, 0);
  const taxiSum = taxis.reduce((s, r) => s + r.amount, 0);

  $('#report-title').textContent = `${y}년 ${m}월 법인카드 사용 내역`;
  $('#m-summary').innerHTML = `
    <div class="total"><span>${m}월 법인카드 총 사용액 <small>(식대 + 택시)</small></span><b>${won(mealSum + taxiSum)}</b></div>
    <div><span>식대</span><b>${won(mealSum)}</b></div>
    <div class="taxi"><span>택시 <small>(${taxis.length}건)</small></span><b>${won(taxiSum)}</b></div>`;

  $('#meal-table').innerHTML = meals.length ? `
    <thead><tr><th>날짜</th><th>인원</th><th>이름</th><th class="num">사용</th><th class="num">한도</th><th>결제 내역</th></tr></thead>
    <tbody>${byDate.map(d => `<tr><td>${dateLabel(d.date)}</td><td>${d.people.length}</td><td>${d.people.map(esc).join(', ')}</td>
        <td class="num${d.sum > d.max ? ' neg' : ''}">${won(d.sum)}</td><td class="num">${won(d.max)}</td>
        <td class="detail">${d.list.map(r => `${esc(r.memo || '(메모 없음)')} ${won(r.amount)}${r.people.length !== d.people.length ? ` <small>(${r.people.map(esc).join(', ')})</small>` : ''}`).join('<br>')}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3">합계</td><td class="num">${won(mealSum)}</td><td class="num">${won(mealMax)}</td><td></td></tr></tfoot>`
    : '<tbody><tr><td class="empty">기록 없음</td></tr></tbody>';

  $('#taxi-table').innerHTML = taxis.length ? `
    <thead><tr><th>날짜</th><th class="num">금액</th><th>메모</th></tr></thead>
    <tbody>${taxis.map(r => `<tr><td>${dateLabel(r.date)}</td><td class="num">${won(r.amount)}</td><td>${esc(r.memo)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>합계</td><td class="num">${won(taxiSum)}</td><td></td></tr></tfoot>`
    : '<tbody><tr><td class="empty">기록 없음</td></tr></tbody>';

  // 인원별 이용 일수
  const per = {};
  meals.forEach(r => r.people.forEach(n => {
    per[n] = per[n] || { days: new Set() };
    per[n].days.add(r.date);
  }));
  const rows = Object.entries(per).sort((a, b) => b[1].days.size - a[1].days.size || a[0].localeCompare(b[0], 'ko'));
  $('#people-table').innerHTML = rows.length ? `
    <thead><tr><th>이름</th><th class="num">이용 일수</th></tr></thead>
    <tbody>${rows.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v.days.size}일</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty">기록 없음</td></tr></tbody>';
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const month = $('#m-month').value;
  const recs = monthRecords(month);
  if (!recs.length) return toast('해당 월 기록이 없습니다.');
  const meals = recs.filter(r => r.type === 'meal');
  const lines = [['[일자별 식대 집계]'], ['날짜', '인원수', '이름', '사용금액', '한도', '결제건수']];
  mealsByDate(meals).forEach(([date, list]) => {
    const d = dayTotals(list);
    lines.push([date, d.people.length, d.people.join(', '), d.sum, d.max, list.length]);
  });
  lines.push([], ['[결제 건별 내역]'], ['구분', '날짜', '인원수', '이름', '사용금액', '메모']);
  meals.forEach(r => lines.push(['식대', r.date, r.people.length, r.people.join(', '), r.amount, r.memo]));
  recs.filter(r => r.type === 'taxi').forEach(r => lines.push(['택시', r.date, '', '', r.amount, r.memo]));
  const csv = '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n');
  download(`payrec_${month}.csv`, csv, 'text/csv;charset=utf-8');
}

// ---------- 설정 ----------
function renderPeopleAdmin() {
  const ul = $('#people-admin');
  const people = sortedPeople();
  ul.innerHTML = people.length ? people.map(p => `
    <li>
      <span class="name">${esc(p.name)}</span>
      <label class="small"><input type="checkbox" data-default="${esc(p.name)}"${p.isDefault ? ' checked' : ''}> 기본</label>
      <button type="button" class="link" data-rename="${esc(p.name)}">이름 변경</button>
      <button type="button" class="link danger" data-remove="${esc(p.name)}">삭제</button>
    </li>`).join('') : '<li class="empty">등록된 인원이 없습니다.</li>';
}

function renderBackupStatus() {
  $('#backup-status').textContent = db.lastBackup
    ? `마지막 백업: ${new Date(db.lastBackup).toLocaleString('ko-KR')} · 전체 기록 ${db.records.length}건`
    : `백업 기록 없음 · 전체 기록 ${db.records.length}건`;
}

function backup() {
  db.lastBackup = new Date().toISOString();
  saveDb();
  download(`payrec_backup_${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
  renderBackupStatus();
}

function restore(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = normalizeDb(JSON.parse(reader.result));
      if (!confirm(`백업 파일의 기록 ${data.records.length}건으로 현재 데이터(${db.records.length}건)를 교체합니다. 진행하시겠습니까?`)) return;
      db = data;
      saveDb();
      resetForm();
      renderAll();
      toast('복원되었습니다.');
    } catch (e) {
      alert('백업 파일을 읽을 수 없습니다.');
    }
  };
  reader.readAsText(file);
}

// ---------- 결제 알림 문자 인식 ----------
function parseNotification(text) {
  const out = {};
  const amt = text.match(/([\d,]+)\s*원/) || text.match(/KRW\s*([\d,]+)/i);
  if (amt) out.amount = parseAmount(amt[1]);
  const md = text.match(/(?:^|[^\d])(\d{1,2})[\/.\-](\d{1,2})(?:\s+|$|[^\d])/);
  if (md) {
    const mm = Number(md[1]), dd = Number(md[2]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const now = new Date();
      let y = now.getFullYear();
      if (mm > now.getMonth() + 1) y--; // 1월에 12월 문자를 붙여넣는 경우
      out.date = `${y}-${pad(mm)}-${pad(dd)}`;
    }
  }
  // 시각(HH:MM) 뒤 문자열을 가맹점명으로 추정
  const shop = text.match(/\d{1,2}:\d{2}\s+([^\n]+?)(?:\s*(?:누적|잔액|사용가능)|$)/m);
  if (shop) {
    // 시각 뒤에 금액·할부 표기가 오는 형식도 있어 제거
    const memo = shop[1].replace(/[\d,]+\s*원(\([^)]*\))?/g, '').replace(/일시불|할부\s*\d*개?월?/g, '').replace(/\s*(사용|승인|결제)$/, '').trim();
    if (memo) out.memo = memo;
  }
  return out;
}

function applyParsed(p) {
  if (p.date) $('#f-date').value = p.date;
  if (p.amount) $('#f-amount').value = p.amount.toLocaleString('ko-KR');
  if (p.memo && !$('#f-memo').value) $('#f-memo').value = p.memo;
  renderChips();
  renderBalance();
  renderDay();
}

// URL 파라미터로 열린 경우(자동화 연동): ?amount=64000&date=2026-10-20&memo=식당&type=taxi&text=문자전문
function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  const p = q.get('text') ? parseNotification(q.get('text')) : {};
  if (q.get('amount')) p.amount = parseAmount(q.get('amount'));
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '')) p.date = q.get('date');
  if (q.get('memo')) p.memo = q.get('memo');
  if (q.get('type') === 'taxi') setType('taxi');
  applyParsed(p);
  history.replaceState(null, '', location.pathname);
  if (p.amount) toast(`${won(p.amount)} 자동 입력됨. 인원을 선택 후 저장하십시오.`);
}

// ---------- 공통 ----------
function renderAll() {
  renderChips();
  renderBalance();
  renderDay();
  renderMonth();
  renderPeopleAdmin();
  renderBackupStatus();
  $('#s-limit').value = db.perPerson.toLocaleString('ko-KR');
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'month') renderMonth();
}

function bind() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.querySelectorAll('#f-type button').forEach(b => b.addEventListener('click', () => setType(b.dataset.type)));

  $('#people-chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const n = chip.dataset.name;
    form.selected.has(n) ? form.selected.delete(n) : form.selected.add(n);
    renderChips();
    renderBalance();
  });
  $('#add-person').addEventListener('click', () => { addPerson($('#new-person').value); $('#new-person').value = ''; });
  $('#new-person').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#add-person').click(); }
  });

  $('#f-amount').addEventListener('input', e => { formatAmountInput(e.target); renderBalance(); });
  $('#calendar').addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const [y, m] = cal.month.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(nav.dataset.nav), 1);
      cal.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return renderCalendar();
    }
    const day = e.target.closest('[data-date]');
    if (day) { $('#f-date').value = day.dataset.date; cal.month = day.dataset.date.slice(0, 7); onDateChange(); }
  });
  $('#entry-form').addEventListener('submit', saveRecord);
  $('#cancel-edit').addEventListener('click', () => { resetForm(true); renderAll(); });

  $('#day-list').addEventListener('click', e => {
    if (e.target.dataset.edit) editRecord(e.target.dataset.edit);
    if (e.target.dataset.del) deleteRecord(e.target.dataset.del);
  });

  $('#paste-apply').addEventListener('click', () => {
    const p = parseNotification($('#paste-text').value);
    applyParsed(p);
    $('#paste-result').textContent = p.amount
      ? `인식: ${won(p.amount)}${p.date ? ' · ' + p.date : ''}${p.memo ? ' · ' + p.memo : ''}`
      : '금액을 찾지 못했습니다. 직접 입력하십시오.';
  });

  $('#m-month').addEventListener('change', renderMonth);
  $('#export-csv').addEventListener('click', exportCsv);
  $('#print').addEventListener('click', () => { renderMonth(); window.print(); });

  $('#s-limit').addEventListener('change', e => {
    const n = parseAmount(e.target.value);
    if (!n) { e.target.value = db.perPerson.toLocaleString('ko-KR'); return; }
    db.perPerson = n;
    saveDb();
    renderAll();
    toast('한도가 변경되었습니다.');
  });
  $('#s-limit').addEventListener('input', e => formatAmountInput(e.target));

  $('#people-admin').addEventListener('click', e => {
    const t = e.target;
    if (t.dataset.default !== undefined) {
      const p = db.people.find(x => x.name === t.dataset.default);
      if (p) { p.isDefault = t.checked; saveDb(); renderPeopleAdmin(); }
    } else if (t.dataset.remove) {
      if (!confirm(`'${t.dataset.remove}'을(를) 선택지에서 삭제하시겠습니까? 기존 기록은 유지됩니다.`)) return;
      db.people = db.people.filter(x => x.name !== t.dataset.remove);
      form.selected.delete(t.dataset.remove);
      saveDb();
      renderAll();
    } else if (t.dataset.rename) {
      const old = t.dataset.rename;
      const name = (prompt('새 이름', old) || '').trim();
      if (!name || name === old) return;
      if (db.people.some(x => x.name === name)) return alert('이미 있는 이름입니다.');
      const applyAll = confirm('기존 기록의 이름도 함께 변경하시겠습니까?\n(취소: 선택지 이름만 변경)');
      db.people.find(x => x.name === old).name = name;
      if (applyAll) db.records.forEach(r => { r.people = r.people.map(n => n === old ? name : n); });
      if (form.selected.delete(old)) form.selected.add(name);
      saveDb();
      renderAll();
    }
  });

  $('#backup').addEventListener('click', backup);
  $('#restore').addEventListener('change', e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; });
}

async function requestPersist() {
  const el = $('#persist-status');
  if (!navigator.storage || !navigator.storage.persist) return;
  try {
    const ok = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    el.textContent = ok ? '브라우저 영구 저장소 사용 중(자동 삭제 방지).' : '영구 저장소 권한이 없습니다. 홈 화면에 추가 후 사용을 권장합니다.';
  } catch (e) { /* 지원하지 않는 브라우저 */ }
}

// 앱을 켜둔 채 날짜가 바뀐 뒤 다시 열면 입력 날짜를 오늘로 갱신
let openedOn = today();
function refreshDate() {
  if (document.visibilityState !== 'visible' || today() === openedOn) return;
  if (!form.editingId && $('#f-date').value === openedOn) {
    $('#f-date').value = today();
    selectSuggested();
    renderChips();
    renderBalance();
    renderDay();
  }
  if ($('#m-month').value === openedOn.slice(0, 7)) {
    $('#m-month').value = today().slice(0, 7);
    renderMonth();
  }
  openedOn = today();
}

function init() {
  document.addEventListener('visibilitychange', refreshDate);
  $('#m-month').value = today().slice(0, 7);
  $('#url-example').textContent = `${location.origin}${location.pathname}?amount=64000&memo=식당명`;
  bind();
  resetForm();
  renderAll();
  applyUrlParams();
  requestPersist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
