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
let workspaces         = [];
let currentWorkspaceId = null;
let currentUserEmail   = null;

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* persistence */
async function loadTasks() {
  if (!currentWorkspaceId) {
    allTasks = [];
    populateResponsibleFilter();
    applyFilters();
    return;
  }
  const { data, error } = await sb.from('tasks').select('*').eq('workspace_id', currentWorkspaceId).order('start_date');
  if (error) { console.error(error); return; }
  allTasks = data.map(t => ({
    id: t.id, title: t.title, s: t.start_date, e: t.end_date,
    p: t.priority, responsible: t.responsible || '',
    createdBy: t.created_by || '', updatedBy: t.updated_by || '', updatedAt: t.updated_at
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
    const { error } = await sb.from('tasks').insert({ ...row, workspace_id: currentWorkspaceId });
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
  const auditEl = document.getElementById('popAudit');
  const auditLines = [];
  if (t.createdBy) auditLines.push(`Criado por: ${t.createdBy}`);
  if (t.updatedBy && t.updatedBy !== t.createdBy) auditLines.push(`Editado por: ${t.updatedBy}`);
  auditEl.innerHTML = auditLines.join('<br>');
  auditEl.style.display = auditLines.length ? '' : 'none';
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
  if (allTasks.length === 0) return;
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

/* workspaces */
const WORKSPACE_STORAGE_PREFIX = 'ct_current_workspace_';

async function loadWorkspaces(username) {
  const { data, error } = await sb.from('workspaces')
    .select('id,name,invite_token,workspace_members(role)')
    .order('created_at');
  if (error) { console.error(error); return; }

  workspaces = (data || []).map(w => ({
    id: w.id, name: w.name, inviteToken: w.invite_token,
    role: w.workspace_members?.[0]?.role || 'member'
  }));

  if (workspaces.length === 0) {
    currentWorkspaceId = null;
    populateWorkspaceSelect();
    openWorkspaceModal(true);
    return;
  }

  const stored = localStorage.getItem(WORKSPACE_STORAGE_PREFIX + username);
  currentWorkspaceId = workspaces.find(w => w.id === stored)?.id || workspaces[0].id;
  localStorage.setItem(WORKSPACE_STORAGE_PREFIX + username, currentWorkspaceId);
  populateWorkspaceSelect();
  updateManagementVisibility();
}

function updateManagementVisibility() {
  const w = workspaces.find(x => x.id === currentWorkspaceId);
  document.getElementById('managementBtn').classList.toggle('hidden', w?.role !== 'owner');
}

async function openManagementModal() {
  const { data, error } = await sb.from('workspace_members')
    .select('username,role')
    .eq('workspace_id', currentWorkspaceId)
    .order('joined_at');
  if (error) { console.error(error); return; }

  const usersEl = document.getElementById('mgmtUsers');
  usersEl.innerHTML = data.map(m => `
    <div class="report-item">
      <div class="report-info">
        <div class="report-title">${esc(m.username)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="report-prio" style="background:#3B82F61a;color:#3B82F6">${m.role === 'owner' ? 'Proprietário' : 'Membro'}</div>
        ${m.username !== currentUserEmail ? `<button class="mgmt-remove-btn" data-username="${esc(m.username)}">Remover</button>` : ''}
      </div>
    </div>
  `).join('');

  usersEl.querySelectorAll('.mgmt-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeMember(btn.dataset.username));
  });

  const statsEl = document.getElementById('mgmtTaskStats');
  const counts = { 'baixa':0, 'media':0, 'alta':0, 'muito-alta':0 };
  allTasks.forEach(t => { if (counts[t.p] !== undefined) counts[t.p]++; });
  statsEl.innerHTML = `
    <div class="report-item">
      <div class="report-info"><div class="report-title">Total de tarefas</div></div>
      <div class="report-prio" style="background:#3B82F61a;color:#3B82F6">${allTasks.length}</div>
    </div>
  ` + Object.keys(PLABEL).map(p => `
    <div class="report-item">
      <div class="report-info"><div class="report-title">${PLABEL[p]}</div></div>
      <div class="report-prio" style="background:${COLORS[p]}1a;color:${COLORS[p]}">
        <div class="badge-dot" style="background:${COLORS[p]}"></div>${counts[p]}
      </div>
    </div>
  `).join('');

  document.getElementById('managementOverlay').classList.remove('hidden');
}

function closeManagementModal() {
  document.getElementById('managementOverlay').classList.add('hidden');
}

async function removeMember(username) {
  if (!confirm(`Remover ${username} desta área de trabalho?`)) return;

  const { error } = await sb.from('workspace_members')
    .delete()
    .eq('workspace_id', currentWorkspaceId)
    .eq('username', username);
  if (error) { console.error(error); return; }

  await openManagementModal();
}

async function leaveWorkspace() {
  const w = workspaces.find(x => x.id === currentWorkspaceId);
  if (!w) return;
  if (!confirm(`Tem certeza que deseja sair da área "${w.name}"?`)) return;

  const { error } = await sb.from('workspace_members')
    .delete()
    .eq('workspace_id', currentWorkspaceId)
    .eq('username', currentUserEmail);
  if (error) { console.error(error); return; }

  await loadWorkspaces(currentUserEmail);
  await loadTasks();
}

function populateWorkspaceSelect() {
  const sel = document.getElementById('workspaceSelect');
  sel.innerHTML = workspaces.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  sel.value = currentWorkspaceId || '';
}

function openWorkspaceModal(forced) {
  document.getElementById('workspaceName').value = '';
  document.getElementById('workspaceError').textContent = '';
  document.getElementById('workspaceOverlay').dataset.forced = forced ? '1' : '';
  document.getElementById('workspaceCancelBtn').style.display = forced ? 'none' : '';
  document.getElementById('workspaceCloseBtn').style.display = forced ? 'none' : '';
  document.getElementById('workspaceOverlay').classList.remove('hidden');
  setTimeout(()=>document.getElementById('workspaceName').focus(), 40);
}

function closeWorkspaceModal() {
  if (document.getElementById('workspaceOverlay').dataset.forced === '1') return;
  document.getElementById('workspaceOverlay').classList.add('hidden');
}

async function createWorkspace() {
  const name = document.getElementById('workspaceName').value.trim();
  const errEl = document.getElementById('workspaceError');
  if (!name) { errEl.textContent = 'Informe um nome.'; return; }

  const { data, error } = await sb.rpc('create_workspace', { p_name: name });
  if (error) { console.error(error); errEl.textContent = 'Não foi possível criar a área de trabalho.'; return; }

  const w = data[0];
  workspaces.push({ id: w.id, name: w.name, inviteToken: w.invite_token, role: w.role });
  currentWorkspaceId = w.id;
  localStorage.setItem(WORKSPACE_STORAGE_PREFIX + currentUserEmail, currentWorkspaceId);
  populateWorkspaceSelect();
  updateManagementVisibility();
  document.getElementById('workspaceOverlay').dataset.forced = '';
  closeWorkspaceModal();
  await loadTasks();
}

function openInviteModal() {
  const w = workspaces.find(x => x.id === currentWorkspaceId);
  if (!w) return;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('invite', w.inviteToken);
  document.getElementById('inviteLink').value = url.toString();
  document.getElementById('inviteOverlay').classList.remove('hidden');
}

function closeInviteModal() {
  document.getElementById('inviteOverlay').classList.add('hidden');
}

async function acceptPendingInvite() {
  const token = new URLSearchParams(location.search).get('invite');
  if (!token) return;

  const { error } = await sb.rpc('accept_invite', { p_token: token });
  if (error) console.error(error);

  const url = new URL(location.href);
  url.searchParams.delete('invite');
  history.replaceState({}, '', url);
}

document.getElementById('newWorkspaceBtn').addEventListener('click', ()=>openWorkspaceModal(false));
document.getElementById('workspaceCloseBtn').addEventListener('click', closeWorkspaceModal);
document.getElementById('workspaceCancelBtn').addEventListener('click', closeWorkspaceModal);
document.getElementById('workspaceSaveBtn').addEventListener('click', createWorkspace);
document.getElementById('workspaceName').addEventListener('keydown', e=>{
  if(e.key==='Enter') createWorkspace();
});
document.getElementById('workspaceOverlay').addEventListener('click', e=>{
  if(e.target===document.getElementById('workspaceOverlay')) closeWorkspaceModal();
});

document.getElementById('inviteBtn').addEventListener('click', openInviteModal);
document.getElementById('inviteCloseBtn').addEventListener('click', closeInviteModal);
document.getElementById('inviteOverlay').addEventListener('click', e=>{
  if(e.target===document.getElementById('inviteOverlay')) closeInviteModal();
});
document.getElementById('inviteCopyBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('inviteLink');
  await navigator.clipboard.writeText(input.value);
  const btn = document.getElementById('inviteCopyBtn');
  const original = btn.textContent;
  btn.textContent = 'Copiado!';
  setTimeout(()=>btn.textContent = original, 1500);
});

document.getElementById('workspaceSelect').addEventListener('change', async e=>{
  currentWorkspaceId = e.target.value;
  localStorage.setItem(WORKSPACE_STORAGE_PREFIX + currentUserEmail, currentWorkspaceId);
  updateManagementVisibility();
  await loadTasks();
});

document.getElementById('leaveWorkspaceBtn').addEventListener('click', leaveWorkspace);

document.getElementById('managementBtn').addEventListener('click', openManagementModal);
document.getElementById('managementCloseBtn').addEventListener('click', closeManagementModal);
document.getElementById('managementOkBtn').addEventListener('click', closeManagementModal);
document.getElementById('managementOverlay').addEventListener('click', e=>{
  if(e.target===document.getElementById('managementOverlay')) closeManagementModal();
});

/* auth */
function showAuthOverlay() {
  document.getElementById('authOverlay').classList.remove('hidden');
  document.getElementById('appRoot').classList.add('hidden');
}

function hideAuthOverlay() {
  document.getElementById('authOverlay').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');
}

function showLoginForm() {
  document.getElementById('authTitle').textContent = 'Entrar';
  document.getElementById('signupForm').classList.add('hidden');
  document.getElementById('authForm').classList.remove('hidden');
  document.getElementById('showLoginLink').classList.add('hidden');
  document.getElementById('showSignupLink').classList.remove('hidden');
}

function showSignupForm() {
  document.getElementById('authTitle').textContent = 'Criar conta';
  document.getElementById('authForm').classList.add('hidden');
  document.getElementById('signupForm').classList.remove('hidden');
  document.getElementById('showSignupLink').classList.add('hidden');
  document.getElementById('showLoginLink').classList.remove('hidden');
}

async function afterLogin(email) {
  currentUserEmail = email;
  document.getElementById('loggedUser').textContent = email;
  hideAuthOverlay();
  await acceptPendingInvite();
  await loadWorkspaces(email);
  await loadTasks();
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('authUser').value.trim();
  const password = document.getElementById('authPass').value;
  const errEl = document.getElementById('authError');
  const btn = document.getElementById('authSubmitBtn');
  errEl.textContent = '';
  if (!email || !password) return;

  btn.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;

  if (error) {
    errEl.textContent = 'E-mail ou senha inválidos.';
    return;
  }

  document.getElementById('authPass').value = '';
  await afterLogin(data.user.email);
}

async function handleSignup(e) {
  e.preventDefault();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPass').value;
  const passwordConfirm = document.getElementById('signupPassConfirm').value;
  const errEl = document.getElementById('signupError');
  const infoEl = document.getElementById('signupInfoMsg');
  const btn = document.getElementById('signupSubmitBtn');
  errEl.textContent = '';
  infoEl.classList.add('hidden');
  if (!email || !password) return;
  if (password !== passwordConfirm) { errEl.textContent = 'As senhas não coincidem.'; return; }

  btn.disabled = true;
  const { data, error } = await sb.auth.signUp({ email, password });
  btn.disabled = false;

  if (error) {
    errEl.textContent = error.message.includes('already registered')
      ? 'Este e-mail já está cadastrado.'
      : 'Não foi possível criar a conta.';
    return;
  }

  if (data.session) {
    await afterLogin(data.user.email);
    return;
  }

  document.getElementById('signupForm').reset();
  infoEl.textContent = 'Conta criada! Verifique seu e-mail para confirmar o cadastro antes de entrar.';
  infoEl.classList.remove('hidden');
}

async function handleLogout() {
  currentUserEmail = null;
  await sb.auth.signOut();
  location.reload();
}

document.getElementById('authForm').addEventListener('submit', handleLogin);
document.getElementById('signupForm').addEventListener('submit', handleSignup);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
document.getElementById('showSignupLink').addEventListener('click', e => { e.preventDefault(); showSignupForm(); });
document.getElementById('showLoginLink').addEventListener('click', e => { e.preventDefault(); showLoginForm(); });

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    currentUserEmail = null;
    showAuthOverlay();
  }
});

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await afterLogin(session.user.email);
  } else {
    showAuthOverlay();
    setTimeout(()=>document.getElementById('authUser').focus(), 40);
  }
}

init();
