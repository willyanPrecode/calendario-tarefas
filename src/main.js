import './style.css';
import { sb } from './supabaseClient.js';

const COLORS = { 'baixa':'#10B981','media':'#3B82F6','alta':'#F59E0B','muito-alta':'#EF4444' };
const PLABEL = { 'baixa':'Baixa','media':'Média','alta':'Alta','muito-alta':'Muito Alta' };

let allTasks = [];
let tasks    = [];
let viewYear = new Date().getFullYear();
let viewMon  = new Date().getMonth();
let editId   = null;
let popId    = null;
let searchQuery       = '';
let priorityFilter    = '';
let responsibleFilter = '';

/* persistence */
async function loadTasks() {
  const { data, error } = await sb.from('tasks').select('*').order('start_date');
  if (error) { console.error(error); return; }
  allTasks = data.map(t => ({
    id: t.id, title: t.title, s: t.start_date, e: t.end_date,
    p: t.priority, responsible: t.responsible || ''
  }));
  populateResponsibleFilter();
  applyFilters();
  maybeShowDeadlineReport();
}

/* filters */
function populateResponsibleFilter() {
  const sel = document.getElementById('responsibleFilter');
  const current = sel.value;
  const names = [...new Set(allTasks.map(t => t.responsible).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = '<option value="">Todos os responsáveis</option>' +
    names.map(n => `<option value="${n}">${n}</option>`).join('');
  if (names.includes(current)) sel.value = current;
}

function applyFilters() {
  tasks = allTasks.filter(t => {
    const matchesSearch = !searchQuery || t.title.toLowerCase().includes(searchQuery);
    const matchesPriority = !priorityFilter || t.p === priorityFilter;
    const matchesResponsible = !responsibleFilter || t.responsible === responsibleFilter;
    return matchesSearch && matchesPriority && matchesResponsible;
  });
  render();
}

function updateCount() {
  const n = tasks.length;
  const total = allTasks.length;
  const label = `${n} tarefa${n !== 1 ? 's' : ''} cadastrada${n !== 1 ? 's' : ''}`;
  document.getElementById('taskCount').textContent =
    (n !== total) ? `${label} (de ${total})` : label;
}

/* date helpers */
function ld(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d);
}
function toInput(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function fmt(str) {
  return ld(str).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function sod(dt) { const d=new Date(dt); d.setHours(0,0,0,0); return d; }

/* weeks */
function getWeeks(y, m) {
  const first = new Date(y, m, 1);
  const last  = new Date(y, m+1, 0);
  const cur   = new Date(first);
  cur.setDate(cur.getDate() - cur.getDay());
  const end   = new Date(last);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const weeks = [];
  while (cur <= end) {
    const wk = [];
    for (let i = 0; i < 7; i++) { wk.push(new Date(cur)); cur.setDate(cur.getDate()+1); }
    weeks.push(wk);
  }
  return weeks;
}

function weekTasks(week) {
  const ws = sod(week[0]);
  const we = new Date(week[6]); we.setHours(23,59,59,999);
  return tasks.filter(t => ld(t.s) <= we && ld(t.e) >= ws);
}

function assignLanes(wt, week) {
  const ws = sod(week[0]);
  const we = new Date(week[6]); we.setHours(23,59,59,999);
  const res = {};
  const occ = [];
  const sorted = [...wt].sort((a,b) => Math.max(ld(a.s),ws) - Math.max(ld(b.s),ws));
  sorted.forEach(t => {
    const cs = new Date(Math.max(ld(t.s), ws));
    const ce = new Date(Math.min(ld(t.e), we));
    const sc = cs.getDay(), ec = ce.getDay();
    let lane = -1;
    for (let i = 0; i < occ.length; i++) {
      if (occ[i] < sc) { lane = i; occ[i] = ec; break; }
    }
    if (lane < 0) { lane = occ.length; occ.push(ec); }
    res[t.id] = lane;
  });
  return res;
}

/* render */
function render() {
  const today = sod(new Date());
  const grid  = document.getElementById('calGrid');
  grid.innerHTML = '';

  document.getElementById('monthLabel').textContent =
    new Date(viewYear, viewMon, 1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});

  const weeks  = getWeeks(viewYear, viewMon);
  const BAR_H  = 22, GAP = 3, PAD = 4;

  weeks.forEach(week => {
    const weekEl = document.createElement('div');
    weekEl.className = 'cal-week';

    /* cells */
    const cells = document.createElement('div');
    cells.className = 'cal-cells';
    week.forEach(day => {
      const c = document.createElement('div');
      c.className = 'cal-cell' +
        (day.getMonth()!==viewMon ? ' other-month':'') +
        (day.getTime()===today.getTime() ? ' today':'');
      const n = document.createElement('div');
      n.className = 'day-num';
      n.textContent = day.getDate();
      c.appendChild(n);
      c.addEventListener('click', () => openModal(null, day));
      cells.appendChild(c);
    });
    weekEl.appendChild(cells);

    /* bars */
    const wt = weekTasks(week);
    if (wt.length > 0) {
      const ws    = sod(week[0]);
      const we    = new Date(week[6]); we.setHours(23,59,59,999);
      const lanes = assignLanes(wt, week);
      const maxL  = Math.max(...Object.values(lanes));
      const barsEl = document.createElement('div');
      barsEl.className = 'cal-bars';
      barsEl.style.height = `${PAD*2 + (maxL+1)*(BAR_H+GAP)}px`;

      wt.forEach(t => {
        const ts = ld(t.s), te = ld(t.e);
        const cs = new Date(Math.max(ts, ws));
        const ce = new Date(Math.min(te, we));
        const sc = cs.getDay(), ec = ce.getDay();
        const cL = ts < ws, cR = te > we;
        const lane = lanes[t.id];

        const lp = sc/7*100;
        const wp = (ec-sc+1)/7*100;

        const bar = document.createElement('div');
        bar.className = 'task-bar';
        bar.dataset.id = t.id;
        bar.title = t.title;
        bar.style.cssText = [
          `left:calc(${lp}% + 2px)`,
          `width:calc(${wp}% - 4px)`,
          `top:${PAD + lane*(BAR_H+GAP)}px`,
          `background:${COLORS[t.p]}`,
          `border-radius:${cL?'0':'6px'} ${cR?'0':'6px'} ${cR?'0':'6px'} ${cL?'0':'6px'}`,
          `z-index:${lane+1}`
        ].join(';');
        bar.textContent = (cL ? '◂ ' : '') + t.title;
        bar.addEventListener('click', e => { e.stopPropagation(); showPopup(t.id, e); });
        barsEl.appendChild(bar);
      });
      weekEl.appendChild(barsEl);
    } else {
      const sp = document.createElement('div');
      sp.style.height = '10px';
      weekEl.appendChild(sp);
    }

    grid.appendChild(weekEl);
  });
  updateCount();
}

/* modal */
function openModal(id, date) {
  editId = id || null;
  document.getElementById('modalTitle').textContent = id ? 'Editar Tarefa' : 'Nova Tarefa';
  if (id) {
    const t = tasks.find(x=>x.id===id);
    document.getElementById('fTitle').value = t.title;
    document.getElementById('fResponsible').value = t.responsible || '';
    document.getElementById('fStart').value = t.s;
    document.getElementById('fEnd').value   = t.e;
    document.querySelector(`input[name="fp"][value="${t.p}"]`).checked = true;
  } else {
    document.getElementById('fTitle').value = '';
    document.getElementById('fResponsible').value = '';
    const ds = date ? toInput(date) : toInput(new Date());
    document.getElementById('fStart').value = ds;
    document.getElementById('fEnd').value   = ds;
    document.getElementById('pBaixa').checked = true;
  }
  document.getElementById('overlay').classList.remove('hidden');
  setTimeout(()=>document.getElementById('fTitle').focus(), 40);
}

function closeModal() {
  document.getElementById('overlay').classList.add('hidden');
  editId = null;
}

function flash(el) {
  el.style.borderColor = '#EF4444';
  setTimeout(()=>el.style.borderColor='', 1400);
}

async function saveTask() {
  const title       = document.getElementById('fTitle').value.trim();
  const responsible = document.getElementById('fResponsible').value.trim();
  const s           = document.getElementById('fStart').value;
  const e           = document.getElementById('fEnd').value;
  const p           = document.querySelector('input[name="fp"]:checked').value;
  if (!title) { flash(document.getElementById('fTitle')); document.getElementById('fTitle').focus(); return; }
  if (!s || !e) return;
  if (s > e) { flash(document.getElementById('fEnd')); return; }

  const row = { title, responsible: responsible || null, start_date: s, end_date: e, priority: p };

  if (editId) {
    const { error } = await sb.from('tasks').update(row).eq('id', editId);
    if (error) { console.error(error); return; }
  } else {
    const { error } = await sb.from('tasks').insert(row);
    if (error) { console.error(error); return; }
  }
  closeModal();
  await loadTasks();
}

/* popup */
function showPopup(id, evt) {
  const t = tasks.find(x=>x.id===id);
  if (!t) return;
  popId = id;
  document.getElementById('popName').textContent = t.title;
  document.getElementById('popDates').textContent = `${fmt(t.s)} → ${fmt(t.e)}`;
  document.getElementById('popResponsible').textContent = t.responsible ? `Responsável: ${t.responsible}` : 'Sem responsável';
  const badge = document.getElementById('popBadge');
  badge.innerHTML = `<div class="badge-dot" style="background:${COLORS[t.p]}"></div>${PLABEL[t.p]}`;
  badge.style.cssText = `background:${COLORS[t.p]}1a;color:${COLORS[t.p]}`;
  const pop = document.getElementById('popup');
  pop.classList.remove('hidden');
  const r = evt.target.getBoundingClientRect();
  let top  = r.bottom + window.scrollY + 8;
  let left = r.left   + window.scrollX;
  if (top + 190 > window.innerHeight + window.scrollY) top = r.top + window.scrollY - 198;
  if (left + 280 > window.innerWidth) left = window.innerWidth - 284;
  if (left < 4) left = 4;
  pop.style.top  = top  + 'px';
  pop.style.left = left + 'px';
}

function hidePopup() {
  document.getElementById('popup').classList.add('hidden');
  popId = null;
}

/* relatório de prazos da semana */
const REPORT_STORAGE_KEY = 'ct_last_report_date';

function maybeShowDeadlineReport() {
  const today = toInput(new Date());
  if (localStorage.getItem(REPORT_STORAGE_KEY) === today) return;
  localStorage.setItem(REPORT_STORAGE_KEY, today);
  showDeadlineReport();
}

function showDeadlineReport() {
  const todayDt = sod(new Date());
  const weekEnd = new Date(todayDt);
  weekEnd.setDate(weekEnd.getDate() + (6 - weekEnd.getDay()));
  weekEnd.setHours(23,59,59,999);

  const dueSoon = allTasks
    .filter(t => { const e = ld(t.e); return e >= todayDt && e <= weekEnd; })
    .sort((a,b) => ld(a.e) - ld(b.e));

  const list = document.getElementById('reportList');
  if (dueSoon.length === 0) {
    list.innerHTML = '<div class="report-empty">Nenhuma tarefa com prazo para esta semana. 🎉</div>';
  } else {
    list.innerHTML = dueSoon.map(t => `
      <div class="report-item">
        <div class="report-info">
          <div class="report-title">${t.title}</div>
          <div class="report-meta">Prazo: ${fmt(t.e)}${t.responsible ? ' · ' + t.responsible : ''}</div>
        </div>
        <div class="report-prio" style="background:${COLORS[t.p]}1a;color:${COLORS[t.p]}">
          <div class="badge-dot" style="background:${COLORS[t.p]}"></div>${PLABEL[t.p]}
        </div>
      </div>
    `).join('');
  }
  document.getElementById('reportOverlay').classList.remove('hidden');
}

function hideReport() {
  document.getElementById('reportOverlay').classList.add('hidden');
}

/* events */
document.getElementById('fabBtn')  .addEventListener('click', ()=>openModal());
document.getElementById('closeBtn').addEventListener('click', closeModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('saveBtn') .addEventListener('click', saveTask);

document.getElementById('prevBtn').addEventListener('click', ()=>{
  if(--viewMon<0){viewMon=11;viewYear--;} render();
});
document.getElementById('nextBtn').addEventListener('click', ()=>{
  if(++viewMon>11){viewMon=0;viewYear++;} render();
});
document.getElementById('todayBtn').addEventListener('click', ()=>{
  viewYear=new Date().getFullYear(); viewMon=new Date().getMonth(); render();
});

document.getElementById('searchInput').addEventListener('input', e=>{
  searchQuery = e.target.value.trim().toLowerCase();
  applyFilters();
});
document.getElementById('priorityFilter').addEventListener('change', e=>{
  priorityFilter = e.target.value;
  applyFilters();
});
document.getElementById('responsibleFilter').addEventListener('change', e=>{
  responsibleFilter = e.target.value;
  applyFilters();
});

document.getElementById('overlay').addEventListener('click', e=>{
  if(e.target===document.getElementById('overlay')) closeModal();
});

document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    if(!document.getElementById('overlay').classList.contains('hidden')) closeModal();
    else if(!document.getElementById('reportOverlay').classList.contains('hidden')) hideReport();
    else hidePopup();
  }
});
document.getElementById('fTitle').addEventListener('keydown', e=>{
  if(e.key==='Enter') saveTask();
});

document.addEventListener('click', e=>{
  const p = document.getElementById('popup');
  if(!p.classList.contains('hidden') && !p.contains(e.target)) hidePopup();
});

document.getElementById('fStart').addEventListener('change', ()=>{
  const s = document.getElementById('fStart').value;
  const e = document.getElementById('fEnd').value;
  if(s && e && s > e) document.getElementById('fEnd').value = s;
});

document.getElementById('popEditBtn').addEventListener('click', ()=>{
  const id=popId; hidePopup(); openModal(id);
});
document.getElementById('reportCloseBtn').addEventListener('click', hideReport);
document.getElementById('reportOkBtn').addEventListener('click', hideReport);
document.getElementById('reportOverlay').addEventListener('click', e=>{
  if(e.target===document.getElementById('reportOverlay')) hideReport();
});

document.getElementById('popDelBtn').addEventListener('click', async ()=>{
  if(!popId) return;
  const name = tasks.find(t=>t.id===popId)?.title;
  if(confirm(`Excluir "${name}"?`)){
    const { error } = await sb.from('tasks').delete().eq('id', popId);
    if (error) { console.error(error); return; }
    hidePopup();
    await loadTasks();
  }
});

loadTasks();
