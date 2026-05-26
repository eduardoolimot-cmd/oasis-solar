// =================================================
// OASIS SOLAR — Frontend principal
// =================================================
import { api } from './api.js';
import {
  $, $$, MO, MOF, COLS,
  toast, fmtNum, fmtBRL, fmtDate, fmtPeriodo, debounce,
  aplicarRoleUI, preencherSelectAno, preencherSelectUsinas,
  openM, closeM,
} from './utils.js';

// ---------- Estado global do cliente ----------
const state = {
  user: null,
  usinas: [],
  lancamentos: [],
  manutencoes: [],
  financeiro: [],
  notificacoes: [],
  socket: null,
  charts: { main: null, pie: null, fin: null, finCat: null, irrad: null, yieldCh: null, comp: null },
  finCatTipo: 'des', // 'des' = despesas (default), 'rec' = receitas
  dragManutId: null,
};

// =====================================================
// BOOT
// =====================================================
(async function boot() {
  try {
    const me = await api.get('/auth/me');
    state.user = me.user;
  } catch {
    // não autenticado → /api redireciona pra login
    return;
  }
  prepararUI();
  setupNav();
  setupEventos();
  await carregarUsinas();
  preencherSelectAno('fAno', false);
  preencherSelectAno('lFA', true);
  preencherSelectAno('finFA', false);
  preencherSelectAno('mFA', true);
  preencherSelectAno('cAno', false);
  preencherSelectAno('relGerAno', false);
  preencherSelectAno('relFinAno', false);
  $('lPer').value = new Date().toISOString().slice(0, 7);
  const mesAtual = String(new Date().getMonth() + 1).padStart(2, '0');
  if ($('relGerMes')) $('relGerMes').value = mesAtual;
  await abrirSecao('dashboard');
  await carregarNotificacoes();
  conectarSocket();
})();

function prepararUI() {
  const u = state.user;
  $('userName').textContent = u.nome;
  $('userRole').textContent = u.role;
  $('userAv').textContent = u.nome.slice(0, 2).toUpperCase();
  aplicarRoleUI(u.role);

  // Clicar no badge desloga
  $('userBadge').addEventListener('click', async () => {
    if (!confirm('Sair do sistema?')) return;
    await api.post('/auth/logout').catch(() => {});
    location.href = './login.html';
  });
}

// =====================================================
// NAVEGAÇÃO
// =====================================================
const SECTIONS = {
  dashboard: { t: 'Painel Principal', d: 'Visão geral do parque' },
  cadastro: { t: 'Cadastro de Usinas', d: 'Gerenciar usinas' },
  lancamento: { t: 'Lançamento de Dados', d: 'Registrar geração mensal' },
  importar: { t: 'Importar Planilha', d: 'Inserir dados via CSV' },
  manutencao: { t: 'Manutenção', d: 'Kanban de OS' },
  financeiro: { t: 'Financeiro', d: 'Receitas e despesas' },
  comparativo: { t: 'Comparativo', d: 'Comparação entre usinas' },
  relatorio: { t: 'Relatório', d: 'Geração de PDFs' },
  usuarios: { t: 'Gerenciamento de Usuários', d: 'Acesso administrativo' },
};

function setupNav() {
  $$('.nav-item').forEach((el) => {
    el.addEventListener('click', () => abrirSecao(el.dataset.section));
  });
}

async function abrirSecao(name) {
  $$('.section').forEach((s) => s.classList.remove('active'));
  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  $(`sec-${name}`)?.classList.add('active');
  $$(`.nav-item[data-section="${name}"]`).forEach((n) => n.classList.add('active'));
  $('pgTitle').textContent = SECTIONS[name].t;
  $('pgBread').textContent = SECTIONS[name].d;
  $('notifPanel').classList.remove('open');

  if (name === 'dashboard') await renderDashboard();
  if (name === 'cadastro') await renderCadastro();
  if (name === 'lancamento') await renderLancamento();
  if (name === 'importar') await renderImportar();
  if (name === 'manutencao') await renderKanban();
  if (name === 'financeiro') await renderFinanceiro();
  if (name === 'comparativo') await renderComparativo();
  if (name === 'relatorio') await renderRelatorio();
  if (name === 'usuarios') await renderUsuarios();
}

// =====================================================
// CARREGAMENTO DE USINAS (cache compartilhado)
// =====================================================
async function carregarUsinas() {
  state.usinas = await api.get('/usinas');
  // popula TODOS os selects de usina espalhados pela página
  preencherSelectUsinas('fUsina', state.usinas, { prefix: 'Todas as Usinas' });
  preencherSelectUsinas('lUsina', state.usinas, { prefix: '— Selecionar —' });
  preencherSelectUsinas('lFU', state.usinas);
  preencherSelectUsinas('mFU', state.usinas);
  preencherSelectUsinas('finFU', state.usinas);
  preencherSelectUsinas('muUsina', state.usinas, { prefix: '— Selecionar —' });
  preencherSelectUsinas('finUsina', state.usinas, { prefix: '— Selecionar —' });
  preencherSelectUsinas('impUsina', state.usinas, { prefix: '— Selecionar —' });
  preencherSelectUsinas('relGerUsina', state.usinas, { prefix: '— Selecionar —' });
  preencherSelectUsinas('relFinUsina', state.usinas, { prefix: 'Todas as usinas' });
  atualizarSkidSelect();
}

function atualizarSkidSelect() {
  const usinaId = $('fUsina')?.value || '';
  const sel = $('fSkid');
  if (!sel) return;
  const cur = sel.value;
  let html = '<option value="">Todos os SKIDs</option>';
  if (usinaId) {
    const u = state.usinas.find((x) => x.id === usinaId);
    if (u?.skids?.length) {
      html += u.skids.map((s) => `<option value="${s.id}">${s.nome}</option>`).join('');
    }
  }
  sel.innerHTML = html;
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function atualizarLSkidSelect() {
  const usinaId = $('lUsina')?.value || '';
  const sel = $('lSkid');
  if (!sel) return;
  let html = '<option value="">Geral (sem SKID)</option>';
  if (usinaId) {
    const u = state.usinas.find((x) => x.id === usinaId);
    if (u?.skids?.length) {
      html += u.skids.map((s) => `<option value="${s.id}">${s.nome}</option>`).join('');
    }
  }
  sel.innerHTML = html;
}

// =====================================================
// DASHBOARD
// =====================================================
async function renderDashboard() {
  const ano = $('fAno').value;
  const mes = $('fMes').value;
  const usinaId = $('fUsina').value;
  const skidId = $('fSkid').value;

  const qs = new URLSearchParams();
  if (ano) qs.set('ano', ano);
  if (mes) qs.set('mes', mes);
  if (usinaId) qs.set('usinaId', usinaId);
  if (skidId) qs.set('skidId', skidId);

  let data;
  try {
    data = await api.get('/dashboard/kpis?' + qs);
  } catch (e) {
    toast(e.message, 'er');
    return;
  }
  const u = state.usinas.find((x) => x.id === usinaId);
  $('chartSub').textContent = `${ano || 'todos'} — ${u?.nome || 'todas as usinas'}`;
  if ($('yieldSub')) {
    $('yieldSub').textContent = `Comparativo por usina — ${data.kwpTotal ? data.kwpTotal.toLocaleString('pt-BR') + ' kWp total' : '—'}`;
  }
  renderKPIs(data.kpis);
  renderMonthTable(data.mesesData, mes);
  renderDashTable(data.porUsina);
  renderMainChart(data.mesesData);
  renderPieChart(data.distribuicao);
  renderIrradChart(data.mesesData);
  renderYieldChart(data.porUsina);
}

function renderKPIs(k) {
  const variacao = k.geracao.variacao;
  const corVar = variacao >= 0 ? 'up' : 'dn';
  const arrowVar = variacao >= 0 ? 'up' : 'down';
  $('kpiGrid').innerHTML = `
    <div class="kpi c-b"><div class="kpi-h"><div class="kpi-ic c-b"><i class="fas fa-bolt"></i></div>
      <span class="kbdg ${corVar}"><i class="fas fa-arrow-${arrowVar}"></i> ${variacao}%</span></div>
      <div><span class="kval">${(k.geracao.valor / 1000000).toFixed(3)}</span><span class="kunit">GWh</span></div>
      <div class="klbl">Geração Total</div>
      <div style="font-size:11px;color:var(--t3);margin-top:3px">Prev: ${(k.geracao.previsto / 1000000).toFixed(2)} GWh</div>
      <div class="kbar"><div class="kbar-f" style="width:${Math.min(k.geracao.previsto ? (k.geracao.valor / k.geracao.previsto) * 100 : 0, 100)}%;background:${variacao >= 0 ? 'var(--ok)' : 'var(--er)'}"></div></div>
    </div>
    <div class="kpi c-c"><div class="kpi-h"><div class="kpi-ic c-c"><i class="fas fa-check-circle"></i></div>
      <span class="kbdg ${k.disponibilidade.valor >= 96 ? 'up' : 'dn'}"><i class="fas fa-arrow-${k.disponibilidade.valor >= 96 ? 'up' : 'down'}"></i></span></div>
      <div><span class="kval">${k.disponibilidade.valor.toFixed(1)}</span><span class="kunit">%</span></div>
      <div class="klbl">Disponibilidade</div>
      <div style="font-size:11px;color:var(--t3);margin-top:3px">Meta: ${k.disponibilidade.meta}%</div>
      <div class="kbar"><div class="kbar-f" style="width:${k.disponibilidade.valor}%"></div></div>
    </div>
    <div class="kpi c-g"><div class="kpi-h"><div class="kpi-ic c-g"><i class="fas fa-clock"></i></div>
      <span class="kbdg up">Ativo</span></div>
      <div><span class="kval" style="font-size:19px">${k.operacao.val}</span></div>
      <div class="klbl">Tempo de Operação</div>
      <div style="font-size:11px;color:var(--t3);margin-top:3px">${k.operacao.sub}</div>
    </div>
    <div class="kpi c-a"><div class="kpi-h"><div class="kpi-ic c-a"><i class="fas fa-chart-pie"></i></div>
      <span class="kbdg ${k.pr.valor >= 81 ? 'up' : 'dn'}"><i class="fas fa-arrow-${k.pr.valor >= 81 ? 'up' : 'down'}"></i></span></div>
      <div><span class="kval">${k.pr.valor.toFixed(1)}</span><span class="kunit">%</span></div>
      <div class="klbl">Performance Ratio</div>
      <div style="font-size:11px;color:var(--t3);margin-top:3px">Ref: ${k.pr.referencia}% · Meta: ${k.pr.meta}%</div>
      <div class="kbar"><div class="kbar-f" style="width:${k.pr.valor}%;background:var(--wn)"></div></div>
    </div>
    <div class="kpi c-b"><div class="kpi-h"><div class="kpi-ic c-b"><i class="fas fa-tachometer-alt"></i></div>
      <span class="kbdg up">Yield</span></div>
      <div><span class="kval">${(k.produtividade?.valor || 0).toFixed(1)}</span><span class="kunit">kWh/kWp</span></div>
      <div class="klbl">Produtividade</div>
      <div style="font-size:11px;color:var(--t3);margin-top:3px">Específico do período</div>
      <div class="kbar"><div class="kbar-f" style="width:${Math.min((k.produtividade?.valor || 0) / 2.5, 100)}%;background:var(--p)"></div></div>
    </div>`;
}

function renderMonthTable(meses, mesFiltro) {
  const rows = meses.map((m) => {
    const up = m.variacao >= 0;
    const mm = String(m.mes).padStart(2, '0');
    const hl = mesFiltro && mm === mesFiltro ? 'background:var(--pxl);' : '';
    return `<tr style="${hl}">
      <td><strong>${MO[m.mes - 1]}</strong></td>
      <td><strong>${fmtNum(m.gerReal)}</strong> kWh</td>
      <td class="td2">${fmtNum(m.gerPrev)} kWh</td>
      <td style="color:${up ? 'var(--ok)' : 'var(--er)'};font-weight:700">${up ? '+' : ''}${m.variacao}%</td>
      <td class="td2">${m.irrad.toFixed(1)} kWh/m²</td>
      <td><span class="pill ${m.pr >= 81 ? 'p-ok' : 'p-wn'}">${m.pr.toFixed(1)}%</span></td>
      <td><span class="pill ${m.disp >= 96 ? 'p-ok' : 'p-wn'}">${m.disp.toFixed(1)}%</span></td>
    </tr>`;
  });
  $('monthTblBody').innerHTML = rows.join('');
}

function renderDashTable(porUsina) {
  $('dashTblBody').innerHTML = porUsina.map((u) => `
    <tr>
      <td><strong>${u.nome}</strong></td>
      <td class="td2">${fmtNum(u.kwp)} kWp</td>
      <td><strong>${fmtNum(u.gerReal)}</strong> kWh</td>
      <td class="td2" title="${u.degradacao ? '−' + u.degradacao + '% por degradação' : 'Sem degradação'}">${fmtNum(u.gerPrev)} kWh${u.degradacao > 0 ? ` <span style="color:var(--er);font-size:10px">↓${u.degradacao}%</span>` : ''}</td>
      <td><strong>${fmtNum(u.yieldReal, 1)}</strong> <span class="td2" style="font-size:10px">kWh/kWp</span></td>
      <td><span class="pill ${u.pr >= 81 ? 'p-ok' : 'p-wn'}">${u.pr.toFixed(1)}%</span></td>
      <td><span class="pill ${u.disp >= 96 ? 'p-ok' : 'p-wn'}">${u.disp.toFixed(1)}%</span></td>
      <td><span class="pill ${u.status === 'Ativo' ? 'p-ok' : 'p-wn'}">${u.status}</span></td>
    </tr>
  `).join('');
}

function renderMainChart(meses) {
  const ctx = $('mainChart').getContext('2d');
  if (state.charts.main) state.charts.main.destroy();
  state.charts.main = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MO,
      datasets: [
        {
          label: 'Geração Real (MWh)',
          data: meses.map((m) => m.gerReal / 1000),
          backgroundColor: 'rgba(0,87,184,.72)',
          borderColor: '#0057B8',
          borderWidth: 1.5,
          borderRadius: 5,
          yAxisID: 'y',
          order: 2,
        },
        {
          label: 'Previsto (MWh)',
          data: meses.map((m) => m.gerPrev / 1000),
          type: 'line',
          borderColor: '#00B4D8',
          borderWidth: 2,
          pointBackgroundColor: '#00B4D8',
          pointRadius: 3,
          fill: false,
          tension: 0.4,
          yAxisID: 'y',
          order: 1,
        },
        {
          label: 'Irradiação Realizada (kWh/m²)',
          data: meses.map((m) => m.irrad),
          type: 'line',
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245,158,11,.15)',
          borderWidth: 2,
          borderDash: [4, 4],
          pointBackgroundColor: '#F59E0B',
          pointRadius: 3,
          fill: false,
          tension: 0.4,
          yAxisID: 'y1',
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 12 } } },
      scales: {
        y: {
          type: 'linear', position: 'left', beginAtZero: true,
          grid: { color: 'rgba(0,0,0,.04)' },
          title: { display: true, text: 'MWh', font: { size: 10 } },
        },
        y1: {
          type: 'linear', position: 'right', beginAtZero: true,
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'kWh/m²', font: { size: 10 } },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderPieChart(distrib) {
  const ctx = $('pieChart').getContext('2d');
  if (state.charts.pie) state.charts.pie.destroy();
  state.charts.pie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: distrib.map((d) => d.nome),
      datasets: [
        {
          data: distrib.map((d) => d.geracao || d.kwp),
          backgroundColor: COLS,
          borderWidth: 2,
          borderColor: '#fff',
        },
      ],
    },
    options: {
      responsive: true,
      cutout: '64%',
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 11, padding: 11 } } },
    },
  });
}

function renderIrradChart(meses) {
  const ctx = $('irradChart')?.getContext('2d');
  if (!ctx) return;
  if (state.charts.irrad) state.charts.irrad.destroy();
  state.charts.irrad = new Chart(ctx, {
    type: 'line',
    data: {
      labels: MO,
      datasets: [
        {
          label: 'Irradiação Prevista (kWh/m²)',
          data: meses.map((m) => m.irradPrev),
          borderColor: '#00B4D8',
          backgroundColor: 'rgba(0,180,216,.15)',
          borderWidth: 2,
          borderDash: [6, 4],
          fill: false,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: '#00B4D8',
        },
        {
          label: 'Irradiação Realizada (kWh/m²)',
          data: meses.map((m) => m.irrad),
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245,158,11,.25)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: '#F59E0B',
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 14 } } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { callback: (v) => v + ' kWh/m²' } },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderYieldChart(porUsina) {
  const ctx = $('yieldChart')?.getContext('2d');
  if (!ctx) return;
  if (state.charts.yieldCh) state.charts.yieldCh.destroy();
  // Ordena por yield real desc (melhor no topo)
  const dados = [...porUsina].sort((a, b) => b.yieldReal - a.yieldReal);
  state.charts.yieldCh = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dados.map((u) => u.nome),
      datasets: [
        {
          label: 'Yield Real (kWh/kWp)',
          data: dados.map((u) => u.yieldReal),
          backgroundColor: 'rgba(16,185,129,.78)',
          borderColor: '#10B981',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Yield Previsto (kWh/kWp)',
          data: dados.map((u) => u.yieldPrev),
          backgroundColor: 'rgba(0,87,184,.55)',
          borderColor: '#0057B8',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)} kWh/kWp` } },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,.04)' },
          ticks: { callback: (v) => v.toFixed(0) + ' kWh/kWp' },
        },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// =====================================================
// CADASTRO DE USINAS
// =====================================================
async function renderCadastro() {
  await carregarUsinas();
  const l = $('cadList');
  if (!state.usinas.length) {
    l.innerHTML = '<div class="empty"><i class="fas fa-solar-panel"></i><div class="et">Nenhuma usina cadastrada</div><div class="ed">Clique em "Nova Usina" para começar</div></div>';
    return;
  }
  const canEdit = ['ADMIN', 'TECNICO'].includes(state.user.role);
  const canDelete = state.user.role === 'ADMIN';

  l.innerHTML = state.usinas.map((u) => `
    <div class="u-card">
      <div class="u-card-h">
        <div>
          <div class="u-card-t">${u.nome}</div>
          <div class="u-card-s">
            <span><i class="fas fa-bolt"></i> ${fmtNum(u.kwp)} kWp</span>
            ${u.local ? `<span><i class="fas fa-map-marker-alt"></i> ${u.local}</span>` : ''}
            <span><i class="fas fa-calendar"></i> ${fmtDate(u.inicio)}</span>
            ${u.skids?.length ? `<span><i class="fas fa-layer-group"></i> ${u.skids.length} SKID(s)</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:7px">
          ${canEdit ? `<button class="btn btn-o btn-sm" data-edit="${u.id}"><i class="fas fa-edit"></i> Editar</button>` : ''}
          ${canDelete ? `<button class="btn btn-er btn-sm" data-del="${u.id}"><i class="fas fa-trash"></i> Excluir</button>` : ''}
        </div>
      </div>
      <div class="u-card-b">
        <div class="u-stats">
          <div class="u-stat"><label>Módulos</label><span>${u.modulos.qtd ? u.modulos.qtd + '×' + u.modulos.w + 'W' : 'N/D'}</span></div>
          <div class="u-stat"><label>Modelo Mód.</label><span style="font-size:12px">${u.modulos.modelo || 'N/D'}</span></div>
          <div class="u-stat"><label>Inversores</label><span>${u.inversores.qtd ? u.inversores.qtd + '×' + u.inversores.kw + 'kW' : 'N/D'}</span></div>
          <div class="u-stat"><label>Fabric. Inv.</label><span style="font-size:12px">${u.inversores.fab || 'N/D'}</span></div>
        </div>
      </div>
    </div>
  `).join('');

  // listeners
  $$('[data-edit]', l).forEach((b) => b.addEventListener('click', () => abrirEditUsina(b.dataset.edit)));
  $$('[data-del]', l).forEach((b) => b.addEventListener('click', () => deletarUsina(b.dataset.del)));
}

function abrirNovaUsina() {
  resetUsinaForm();
  $('mUsinaTitle').innerHTML = '<i class="fas fa-solar-panel" style="color:var(--p);margin-right:7px"></i>Cadastrar Usina';
  renderPrevTable(null);
  openM('mUsina');
}
function abrirEditUsina(id) {
  const u = state.usinas.find((x) => x.id === id);
  if (!u) return;
  resetUsinaForm();
  $('mUsinaTitle').innerHTML = '<i class="fas fa-edit" style="color:var(--p);margin-right:7px"></i>Editar Usina';
  $('cEditId').value = u.id;
  $('cNome').value = u.nome;
  $('cKwp').value = u.kwp;
  $('cInicio').value = u.inicio ? u.inicio.slice(0, 10) : '';
  $('cLocal').value = u.local || '';
  $('cObs').value = u.obs || '';
  $('cModM').value = u.modulos.modelo || '';
  $('cModQ').value = u.modulos.qtd || '';
  $('cModW').value = u.modulos.w || '';
  $('cModF').value = u.modulos.fab || '';
  $('cInvM').value = u.inversores.modelo || '';
  $('cInvQ').value = u.inversores.qtd || '';
  $('cInvKw').value = u.inversores.kw || '';
  $('cInvF').value = u.inversores.fab || '';
  renderPrevTable(u.previsoes);
  $('skidList').innerHTML = '';
  (u.skids || []).forEach((s) => addSkidBlock(s));
  openM('mUsina');
}
function resetUsinaForm() {
  ['cNome', 'cKwp', 'cInicio', 'cLocal', 'cObs', 'cModM', 'cModQ', 'cModW', 'cModF', 'cInvM', 'cInvQ', 'cInvKw', 'cInvF'].forEach((id) => ($(id).value = ''));
  $('cEditId').value = '';
  $('skidList').innerHTML = '';
  $$('.tabbtn').forEach((b) => b.classList.remove('active'));
  $$('.tabbtn[data-tab="tGeral"]')[0]?.classList.add('active');
  $$('.tabcontent').forEach((t) => (t.style.display = 'none'));
  $('tGeral').style.display = 'block';
}
function renderPrevTable(data) {
  $('prevBody').innerHTML = MO.map((m, i) => {
    const d = data?.find((x) => x.mes === i + 1) || null;
    return `<tr>
      <td style="font-weight:600;padding:5px 7px">${m}</td>
      <td><input type="number" step="100" value="${d ? d.gen : ''}" placeholder="0" data-prev="gen" data-mes="${i + 1}" style="width:100%;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;font-size:11px;background:#fff"></td>
      <td><input type="number" step="0.1" value="${d ? d.irrad : ''}" placeholder="0" data-prev="irrad" data-mes="${i + 1}" style="width:100%;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;font-size:11px;background:#fff"></td>
      <td><input type="number" step="0.1" value="${d ? d.pr : ''}" placeholder="81" data-prev="pr" data-mes="${i + 1}" style="width:100%;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;font-size:11px;background:#fff"></td>
    </tr>`;
  }).join('');
}
function lerPrevTable() {
  const arr = [];
  for (let m = 1; m <= 12; m++) {
    // ATENÇÃO: $ é getElementById; para atributos uso document.querySelector
    const gen = parseFloat(document.querySelector(`#prevBody [data-prev="gen"][data-mes="${m}"]`)?.value) || 0;
    const irrad = parseFloat(document.querySelector(`#prevBody [data-prev="irrad"][data-mes="${m}"]`)?.value) || 0;
    const pr = parseFloat(document.querySelector(`#prevBody [data-prev="pr"][data-mes="${m}"]`)?.value) || 0;
    if (gen || irrad || pr) arr.push({ mes: m, gen, irrad, pr });
  }
  return arr;
}
let _skidCounter = 0;
function addSkidBlock(data) {
  _skidCounter++;
  const idx = _skidCounter;
  const div = document.createElement('div');
  div.className = 'tcard';
  div.style.padding = '13px';
  div.style.background = 'var(--pxl)';
  div.style.borderColor = 'var(--p)';
  div.dataset.skid = idx;
  div.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
      <div style="font-size:12px;font-weight:700;color:var(--p)"><i class="fas fa-layer-group"></i> SKID ${idx}</div>
      <button class="btn btn-er btn-sm" data-rm="${idx}"><i class="fas fa-trash"></i></button>
    </div>
    <div class="fg" style="margin-bottom:10px">
      <div class="fgrp"><label class="flabel">Identificação</label><input class="finput skidNome" value="${data?.nome || `SKID-0${idx}`}"></div>
      <div class="fgrp"><label class="flabel">Potência (kWp)</label><input class="finput skidKwp" type="number" value="${data?.kwp || ''}"></div>
    </div>
    <table style="width:100%;font-size:11px"><thead><tr><th>Mês</th><th>Ger.</th><th>Irrad.</th><th>PR</th></tr></thead>
    <tbody>${MO.map((m, i) => {
      const p = data?.previsoes?.find((x) => x.mes === i + 1) || null;
      return `<tr>
        <td style="padding:3px 6px">${m}</td>
        <td><input class="sg" type="number" step="100" value="${p ? p.gen : ''}" style="width:100%;padding:2px 5px;border:1px solid var(--bd);border-radius:4px;font-size:11px"></td>
        <td><input class="si" type="number" step="0.1" value="${p ? p.irrad : ''}" style="width:100%;padding:2px 5px;border:1px solid var(--bd);border-radius:4px;font-size:11px"></td>
        <td><input class="sp" type="number" step="0.1" value="${p ? p.pr : ''}" style="width:100%;padding:2px 5px;border:1px solid var(--bd);border-radius:4px;font-size:11px"></td>
      </tr>`;
    }).join('')}</tbody></table>
  `;
  $('skidList').appendChild(div);
  div.querySelector('[data-rm]').addEventListener('click', () => div.remove());
}
function lerSkids() {
  const arr = [];
  $$('[data-skid]').forEach((bl) => {
    const nome = bl.querySelector('.skidNome').value.trim();
    if (!nome) return;
    const kwp = parseFloat(bl.querySelector('.skidKwp').value) || 0;
    const sgs = bl.querySelectorAll('.sg');
    const sis = bl.querySelectorAll('.si');
    const sps = bl.querySelectorAll('.sp');
    const previsoes = [];
    for (let i = 0; i < 12; i++) {
      const gen = parseFloat(sgs[i]?.value) || 0;
      const irrad = parseFloat(sis[i]?.value) || 0;
      const pr = parseFloat(sps[i]?.value) || 0;
      if (gen || irrad || pr) previsoes.push({ mes: i + 1, gen, irrad, pr });
    }
    arr.push({ nome, kwp, previsoes });
  });
  return arr;
}

async function salvarUsina() {
  const payload = {
    nome: $('cNome').value.trim(),
    kwp: parseFloat($('cKwp').value),
    inicio: $('cInicio').value || null,
    local: $('cLocal').value || null,
    obs: $('cObs').value || null,
    moduloModelo: $('cModM').value || null,
    moduloQtd: parseInt($('cModQ').value) || 0,
    moduloW: parseInt($('cModW').value) || 400,
    moduloFab: $('cModF').value || null,
    inversorModelo: $('cInvM').value || null,
    inversorQtd: parseInt($('cInvQ').value) || 0,
    inversorKw: parseInt($('cInvKw').value) || 110,
    inversorFab: $('cInvF').value || null,
    previsoes: lerPrevTable(),
    skids: lerSkids(),
  };
  if (!payload.nome || !payload.kwp) {
    toast('Preencha Nome e Potência (kWp)', 'er');
    return;
  }
  try {
    const id = $('cEditId').value;
    if (id) {
      await api.put('/usinas/' + id, payload);
      toast('Usina atualizada!', 'ok');
    } else {
      await api.post('/usinas', payload);
      toast('Usina cadastrada!', 'ok');
    }
    closeM('mUsina');
    await carregarUsinas();
    await renderCadastro();
  } catch (e) {
    toast(e.message, 'er');
  }
}

async function deletarUsina(id) {
  const u = state.usinas.find((x) => x.id === id);
  if (!u) return;
  if (!confirm(`Excluir "${u.nome}"?\nEsta ação não pode ser desfeita.`)) return;
  try {
    await api.delete('/usinas/' + id);
    toast('Usina excluída', 'wn');
    await carregarUsinas();
    await renderCadastro();
  } catch (e) {
    toast(e.message, 'er');
  }
}

// =====================================================
// LANÇAMENTOS
// =====================================================
async function renderLancamento() {
  const fu = $('lFU').value;
  const fa = $('lFA').value;
  const fm = $('lFM').value;
  const qs = new URLSearchParams();
  if (fu) qs.set('usinaId', fu);
  if (fa) qs.set('ano', fa);
  if (fm) qs.set('mes', fm);
  state.lancamentos = await api.get('/lancamentos?' + qs);

  const canEdit = ['ADMIN', 'TECNICO'].includes(state.user.role);
  $('lancHist').innerHTML = state.lancamentos.length
    ? state.lancamentos.map((l) => `
      <tr>
        <td><strong>${l.usinaNome}</strong></td>
        <td class="td2">${l.skidNome || '—'}</td>
        <td>${fmtPeriodo(l.periodo)}</td>
        <td><strong>${fmtNum(l.geracao)}</strong></td>
        <td>${l.irrad ? l.irrad.toFixed(1) : '—'} kWh/m²</td>
        <td><span class="pill ${l.pr >= 81 ? 'p-ok' : 'p-wn'}">${l.pr?.toFixed(1) || '0'}%</span></td>
        <td><span class="pill ${!l.disp || l.disp >= 96 ? 'p-ok' : 'p-wn'}">${l.disp ? l.disp.toFixed(1) + '%' : '—'}</span></td>
        <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.obs || '—'}</td>
        <td>${canEdit ? `<button class="bico er" data-del-lanc="${l.id}"><i class="fas fa-trash"></i></button>` : ''}</td>
      </tr>`).join('')
    : '<tr><td colspan="9" style="text-align:center;color:var(--t3);padding:22px">Nenhum registro</td></tr>';
  $$('[data-del-lanc]').forEach((b) => b.addEventListener('click', () => deletarLanc(b.dataset.delLanc)));
}

async function salvarLanc() {
  const usinaId = $('lUsina').value;
  if (!usinaId) return toast('Selecione uma usina', 'er');
  const payload = {
    usinaId,
    skidId: $('lSkid').value || null,
    periodo: $('lPer').value,
    geracao: parseFloat($('lGen').value),
    irrad: parseFloat($('lIrr').value) || 0,
    pr: parseFloat($('lPR').value) || 0,
    disp: parseFloat($('lDisp').value) || 0,
    obs: $('lObs').value || null,
  };
  if (!payload.geracao && payload.geracao !== 0) return toast('Informe a geração', 'er');
  try {
    await api.post('/lancamentos', payload);
    toast('Lançamento salvo!', 'ok');
    limparLancForm();
    await renderLancamento();
    if ($('sec-dashboard').classList.contains('active')) await renderDashboard();
  } catch (e) {
    toast(e.message, 'er');
  }
}
function limparLancForm() {
  ['lGen', 'lIrr', 'lPR', 'lDisp', 'lObs'].forEach((id) => ($(id).value = ''));
}
async function deletarLanc(id) {
  if (!confirm('Excluir lançamento?')) return;
  try {
    await api.delete('/lancamentos/' + id);
    toast('Lançamento excluído', 'wn');
    await renderLancamento();
    if ($('sec-dashboard').classList.contains('active')) await renderDashboard();
  } catch (e) {
    toast(e.message, 'er');
  }
}

// =====================================================
// IMPORTAR CSV
// =====================================================
function renderImportar() {
  // nada a renderizar — UI é estática
}

function setupImportar() {
  const zone = $('importZone');
  const inp = $('csvFile');
  zone.addEventListener('click', () => inp.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) processarCSV(f);
  });
  inp.addEventListener('change', (e) => {
    if (e.target.files[0]) processarCSV(e.target.files[0]);
    e.target.value = '';
  });
  $('btnDownloadModelo').addEventListener('click', baixarModelo);
}

function baixarModelo() {
  const csv = 'Usina:;UFV Central;;;\nSKID:;;;;\nAno:;2025;;;\n;;;;\n' +
    'Mês;Geração Real (kWh);Irradiação (kWh/m²);PR (%);Disponibilidade (%)\n' +
    MOF.map(m => `${m.toUpperCase()};1000;150;80;98`).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'MODELO_OASIS_SOLAR.csv';
  a.click();
  toast('Modelo baixado', 'ok');
}

let _importDados = null;
async function processarCSV(file) {
  const usinaId = $('impUsina').value;
  if (!usinaId) {
    toast('Selecione a usina destino antes de enviar', 'er');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await api.upload('/lancamentos/importar/preview', fd);
    _importDados = { ...r, usinaId };
    renderImportPreview(r);
  } catch (e) {
    toast(e.message, 'er');
  }
}

function renderImportPreview(r) {
  const ano = $('impAno').value || r.ano || '';
  $('importPreview').innerHTML = `
    <div class="alert alert-ok"><i class="fas fa-check-circle"></i>
      <div><strong>Lido!</strong> Usina no CSV: ${r.usina || '—'} · SKID: ${r.skid || 'Geral'} · Ano: ${r.ano || '?'} · ${r.total} meses. <em>Edite os valores e confirme:</em></div>
    </div>
    <div style="background:var(--bg);border:1px solid var(--bd);border-radius:var(--r2);overflow:hidden;margin-bottom:13px">
      <table>
        <thead><tr><th>Mês</th><th>Geração</th><th>Irradiação</th><th>PR (%)</th><th>Disp. (%)</th></tr></thead>
        <tbody>${r.dados.map((d, i) => `
          <tr>
            <td><strong>${MO[d.mes - 1]}</strong></td>
            <td><input class="finput" id="ig${i}" type="number" value="${d.gen}" style="padding:3px 6px;font-size:12px"></td>
            <td><input class="finput" id="ii${i}" type="number" step="0.1" value="${d.irr}" style="padding:3px 6px;font-size:12px"></td>
            <td><input class="finput" id="ip${i}" type="number" step="0.1" value="${d.pr}" style="padding:3px 6px;font-size:12px"></td>
            <td><input class="finput" id="id${i}" type="number" step="0.1" value="${d.dsp}" style="padding:3px 6px;font-size:12px"></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:9px">
      <button class="btn btn-p" id="btnConfirmImport"><i class="fas fa-check"></i> Confirmar Importação</button>
      <button class="btn btn-o" id="btnCancelImport"><i class="fas fa-times"></i> Cancelar</button>
    </div>`;
  $('btnConfirmImport').addEventListener('click', confirmarImport);
  $('btnCancelImport').addEventListener('click', () => { $('importPreview').innerHTML = ''; _importDados = null; });
}

async function confirmarImport() {
  if (!_importDados) return;
  // Construir CSV ajustado a partir dos inputs editados
  const ano = $('impAno').value || _importDados.ano;
  if (!ano || !/^\d{4}$/.test(ano)) {
    toast('Informe o ano (4 dígitos)', 'er');
    return;
  }
  const linhas = [
    `Usina:;${_importDados.usina};;;`,
    `SKID:;${_importDados.skid || ''};;;`,
    `Ano:;${ano};;;`,
    `;;;;`,
    `Mês;Geração;Irradiação;PR;Disp`,
  ];
  _importDados.dados.forEach((d, i) => {
    const gen = $(`ig${i}`).value;
    const irr = $(`ii${i}`).value;
    const pr = $(`ip${i}`).value;
    const dsp = $(`id${i}`).value;
    linhas.push(`${MOF[d.mes - 1].toUpperCase()};${gen};${irr};${pr};${dsp}`);
  });
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
  const fd = new FormData();
  fd.append('file', blob, 'editado.csv');
  fd.append('usinaId', _importDados.usinaId);
  fd.append('ano', ano);
  try {
    const r = await api.upload('/lancamentos/importar', fd);
    toast(`Importação OK: ${r.added} novos, ${r.updated} atualizados`, 'ok');
    $('importPreview').innerHTML = `<div class="alert alert-ok"><i class="fas fa-check-circle"></i><div><strong>${r.processados} registros</strong> processados para ${r.usina} — ${r.added} novos · ${r.updated} atualizados.</div></div>`;
    _importDados = null;
  } catch (e) {
    toast(e.message, 'er');
  }
}

// =====================================================
// MANUTENÇÃO (KANBAN)
// =====================================================
async function renderKanban() {
  const fu = $('mFU').value;
  const ft = $('mFT').value;
  const fa = $('mFA').value;
  const qs = new URLSearchParams();
  if (fu) qs.set('usinaId', fu);
  if (ft) qs.set('tipo', ft);
  if (fa) qs.set('ano', fa);
  state.manutencoes = await api.get('/manutencoes?' + qs);

  const cols = [
    { k: 'plan', lbl: 'Planejadas', color: '#1E40AF', bg: '#DBEAFE', icon: 'fa-calendar-alt' },
    { k: 'exec', lbl: 'Em Execução', color: '#92400E', bg: '#FEF3C7', icon: 'fa-wrench' },
    { k: 'ok',   lbl: 'Concluídas', color: '#065F46', bg: '#D1FAE5', icon: 'fa-check-circle' },
  ];
  const tl = { prev: 'Preventiva', corr: 'Corretiva', pred: 'Preditiva', plan: 'Planejada' };
  const tc = { prev: 'maint-prev', corr: 'maint-corr', pred: 'maint-pred', plan: 'maint-plan' };

  $('kanbanBoard').innerHTML = cols.map((col) => {
    const cards = state.manutencoes.filter((m) => m.status === col.k);
    return `
      <div class="kb-col" data-status="${col.k}">
        <div class="kb-col-h">
          <div class="kb-col-t" style="color:${col.color}">
            <i class="fas ${col.icon}"></i>${col.lbl}
            <span class="kb-cnt" style="background:${col.bg};color:${col.color}">${cards.length}</span>
          </div>
        </div>
        <div class="kb-body">
          ${cards.length ? cards.map((m) => `
            <div class="kb-card" draggable="true" data-id="${m.id}">
              <div style="display:flex;justify-content:space-between;gap:6px">
                <div class="kb-card-t">${m.titulo}</div>
                <span class="${tc[m.tipo]}">${tl[m.tipo]}</span>
              </div>
              <div class="kb-card-m">
                <span><i class="fas fa-solar-panel"></i> ${m.usinaNome}</span>
                ${m.data ? `<span><i class="fas fa-calendar"></i> ${fmtDate(m.data)}</span>` : ''}
                ${m.resp ? `<span><i class="fas fa-user"></i> ${m.resp}</span>` : ''}
              </div>
            </div>`).join('') : `<div style="text-align:center;padding:26px 10px;color:var(--t3);font-size:12px"><i class="fas fa-inbox" style="font-size:22px;opacity:.3;display:block;margin-bottom:7px"></i>Nenhuma O.S.</div>`}
          <div class="kb-drop-zone"></div>
        </div>
      </div>`;
  }).join('');

  setupKanbanDrag();
}

function setupKanbanDrag() {
  const canMove = ['ADMIN', 'TECNICO'].includes(state.user.role);
  $$('.kb-card').forEach((c) => {
    if (canMove) {
      c.addEventListener('dragstart', (e) => {
        state.dragManutId = c.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => c.classList.add('dragging'), 0);
      });
      c.addEventListener('dragend', () => {
        c.classList.remove('dragging');
        $$('.kb-col').forEach((col) => col.classList.remove('drag-over'));
        state.dragManutId = null;
      });
    } else {
      c.draggable = false;
    }
    c.addEventListener('click', (e) => {
      if (!state.dragManutId) abrirEditManut(c.dataset.id);
    });
  });
  $$('.kb-col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!state.dragManutId) return;
      const novoStatus = col.dataset.status;
      try {
        await api.patch(`/manutencoes/${state.dragManutId}/status`, { status: novoStatus });
        toast('O.S. movida', 'ok');
        state.dragManutId = null;
        await renderKanban();
      } catch (err) {
        toast(err.message, 'er');
      }
    });
  });
}

function abrirNovaManut() {
  ['muTit', 'muDet', 'muResp', 'muComp'].forEach((id) => ($(id).value = ''));
  $('muTipo').value = 'prev';
  $('muStatus').value = 'plan';
  $('muData').value = '';
  $('muEditId').value = '';
  $('mManutTitle').innerHTML = '<i class="fas fa-tools" style="color:var(--p);margin-right:7px"></i>Nova O.S.';
  openM('mManut');
}
function abrirEditManut(id) {
  const m = state.manutencoes.find((x) => x.id === id);
  if (!m) return;
  $('muUsina').value = m.usinaId;
  $('muTipo').value = m.tipo;
  $('muStatus').value = m.status;
  $('muData').value = m.data ? m.data.slice(0, 10) : '';
  $('muResp').value = m.resp || '';
  $('muComp').value = m.comp || '';
  $('muTit').value = m.titulo;
  $('muDet').value = m.detalhe || '';
  $('muEditId').value = m.id;
  $('mManutTitle').innerHTML = '<i class="fas fa-edit" style="color:var(--p);margin-right:7px"></i>Editar O.S.';
  openM('mManut');
}
async function salvarManut() {
  const payload = {
    usinaId: $('muUsina').value,
    tipo: $('muTipo').value,
    status: $('muStatus').value,
    data: $('muData').value || null,
    resp: $('muResp').value || null,
    comp: $('muComp').value || null,
    titulo: $('muTit').value.trim(),
    detalhe: $('muDet').value || null,
  };
  if (!payload.usinaId || !payload.titulo) return toast('Preencha Usina e Título', 'er');
  try {
    const id = $('muEditId').value;
    if (id) {
      await api.put('/manutencoes/' + id, payload);
      toast('O.S. atualizada', 'ok');
    } else {
      await api.post('/manutencoes', payload);
      toast('O.S. criada', 'ok');
    }
    closeM('mManut');
    await renderKanban();
  } catch (e) {
    toast(e.message, 'er');
  }
}

// =====================================================
// FINANCEIRO
// =====================================================
async function renderFinanceiro() {
  const fu = $('finFU').value;
  const fa = $('finFA').value;
  const ft = $('finFT').value;
  const qs = new URLSearchParams();
  if (fu) qs.set('usinaId', fu);
  if (fa) qs.set('ano', fa);
  if (ft) qs.set('tipo', ft);

  state.financeiro = await api.get('/financeiro?' + qs);
  const sum = await api.get('/financeiro/sumario?' + qs);

  const t = sum.totais;
  $('finKpi').innerHTML = `
    <div class="fin-card"><div class="fin-lbl">Receitas</div><div class="fin-val" style="color:var(--ok)">${fmtBRL(t.receitas)}</div><div class="fin-sub">${t.qtdReceitas} lançamentos</div></div>
    <div class="fin-card"><div class="fin-lbl">Despesas</div><div class="fin-val" style="color:var(--er)">${fmtBRL(t.despesas)}</div><div class="fin-sub">${t.qtdDespesas} lançamentos</div></div>
    <div class="fin-card ${t.liquido >= 0 ? 'hl' : ''}"><div class="fin-lbl">Resultado Líquido</div><div class="fin-val" style="color:${t.liquido >= 0 ? 'var(--p)' : 'var(--er)'}">${fmtBRL(t.liquido)}</div><div class="fin-sub">${t.liquido >= 0 ? 'Superávit' : 'Déficit'}</div></div>
    <div class="fin-card"><div class="fin-lbl">Margem</div><div class="fin-val">${t.margem}%</div><div class="fin-sub">Sobre receita</div></div>
  `;
  $('finChartSub').textContent = fa || 'Todos';
  renderFinChart(sum.mensal);
  renderFinCatChart(sum.porCategoria, state.finCatTipo);

  const canEdit = ['ADMIN', 'TECNICO'].includes(state.user.role);
  $('finTbl').innerHTML = state.financeiro.length
    ? state.financeiro.map((f) => `
      <tr>
        <td>${fmtDate(f.data)}</td>
        <td><strong>${f.usinaNome}</strong></td>
        <td><span class="pill ${f.tipo === 'rec' ? 'p-ok' : 'p-er'}">${f.tipo === 'rec' ? 'Receita' : 'Despesa'}</span></td>
        <td>${f.cat}</td>
        <td>${f.desc || '—'}</td>
        <td style="font-weight:700;color:${f.tipo === 'rec' ? 'var(--ok)' : 'var(--er)'}">${fmtBRL(f.val)}</td>
        <td><span class="pill ${{ pg: 'p-ok', pend: 'p-wn', prev: 'p-gy' }[f.st] || 'p-gy'}">${{ pg: 'Pago', pend: 'Pendente', prev: 'Previsto' }[f.st] || f.st}</span></td>
        <td>${canEdit ? `<button class="bico er" data-del-fin="${f.id}"><i class="fas fa-trash"></i></button>` : ''}</td>
      </tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:22px">Nenhum lançamento</td></tr>';
  $$('[data-del-fin]').forEach((b) => b.addEventListener('click', () => deletarFin(b.dataset.delFin)));
}

function renderFinChart(mensal) {
  const ctx = $('finChart').getContext('2d');
  if (state.charts.fin) state.charts.fin.destroy();
  state.charts.fin = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MO,
      datasets: [
        { label: 'Receitas', data: mensal.receitas, backgroundColor: 'rgba(16,185,129,.72)', borderRadius: 5 },
        { label: 'Despesas', data: mensal.despesas, backgroundColor: 'rgba(239,68,68,.72)', borderRadius: 5 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 11, padding: 12 } } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { callback: (v) => 'R$ ' + v.toLocaleString('pt-BR') } } },
    },
  });
}

const FIN_CAT_COLORS = [
  '#0057B8', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#00B4D8',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#A855F7',
];

function renderFinCatChart(porCategoria, tipo = 'des') {
  const ctx = $('finCatChart');
  if (!ctx) return;
  if (state.charts.finCat) state.charts.finCat.destroy();

  const dados = (porCategoria?.[tipo === 'rec' ? 'receitas' : 'despesas']) || [];
  const subEl = $('finCatSub');
  if (subEl) {
    const totalSum = dados.reduce((s, x) => s + x.total, 0);
    subEl.textContent = `${tipo === 'rec' ? 'Receitas' : 'Despesas'} — Total ${fmtBRL(totalSum)} em ${dados.length} categoria${dados.length === 1 ? '' : 's'}`;
  }

  if (!dados.length) {
    // Desenha um gráfico vazio com mensagem
    state.charts.finCat = new Chart(ctx.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Sem dados'], datasets: [{ data: [1], backgroundColor: ['#EBF2FC'], borderWidth: 0 }] },
      options: {
        responsive: true,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });
    return;
  }

  const total = dados.reduce((s, x) => s + x.total, 0);
  state.charts.finCat = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: dados.map((c) => c.categoria),
      datasets: [
        {
          data: dados.map((c) => c.total),
          backgroundColor: dados.map((_, i) => FIN_CAT_COLORS[i % FIN_CAT_COLORS.length]),
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { size: 10 },
            boxWidth: 10,
            padding: 6,
            generateLabels: (chart) => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((label, i) => {
                const val = ds.data[i];
                const pct = total ? ((val / total) * 100).toFixed(1) : 0;
                return {
                  text: `${label} — ${pct}%`,
                  fillStyle: ds.backgroundColor[i],
                  strokeStyle: ds.backgroundColor[i],
                  index: i,
                };
              });
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const val = item.parsed;
              const pct = total ? ((val / total) * 100).toFixed(1) : 0;
              const qtd = dados[item.dataIndex]?.qtd || 0;
              return ` ${fmtBRL(val)} (${pct}%) · ${qtd} lançamento${qtd === 1 ? '' : 's'}`;
            },
          },
        },
      },
    },
  });
}

async function carregarCategoriasFinanceiro() {
  try {
    const r = await api.get('/financeiro/categorias');
    state.finCategorias = r.categorias || [];
  } catch {
    state.finCategorias = ['Energia Gerada', 'Manutenção', 'Outros'];
  }
  renderFinCatSelect();
}

function renderFinCatSelect(selecionada) {
  const sel = $('finCat');
  if (!sel) return;
  const cats = state.finCategorias || [];
  sel.innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join('');
  if (selecionada) {
    // se não existe ainda, adiciona
    if (!cats.includes(selecionada)) {
      const opt = document.createElement('option');
      opt.value = selecionada;
      opt.textContent = selecionada;
      sel.appendChild(opt);
      state.finCategorias = [...cats, selecionada];
    }
    sel.value = selecionada;
  }
}

async function abrirNovoFin() {
  await carregarCategoriasFinanceiro();
  ['finVal', 'finDesc'].forEach((id) => ($(id).value = ''));
  $('finTipo').value = 'rec';
  renderFinCatSelect('Energia Gerada');
  $('finData').value = new Date().toISOString().slice(0, 10);
  $('finSt').value = 'pg';
  $('finEditId').value = '';
  openM('mFin');
}

function adicionarNovaCategoriaFin() {
  const nome = prompt('Nome da nova categoria:');
  if (!nome) return;
  const trimmed = nome.trim();
  if (!trimmed) return;
  if (trimmed.length > 50) {
    toast('Nome muito longo (máx 50 caracteres)', 'er');
    return;
  }
  // Se já existe, só seleciona
  if (state.finCategorias?.includes(trimmed)) {
    $('finCat').value = trimmed;
    toast('Categoria já existe — selecionada', 'info');
    return;
  }
  renderFinCatSelect(trimmed);
  toast(`Categoria "${trimmed}" pronta para uso`, 'ok');
}
async function salvarFin() {
  const payload = {
    usinaId: $('finUsina').value,
    tipo: $('finTipo').value,
    data: $('finData').value,
    cat: $('finCat').value,
    desc: $('finDesc').value || null,
    val: parseFloat($('finVal').value),
    st: $('finSt').value,
  };
  if (!payload.usinaId || !payload.val || !payload.data) return toast('Preencha usina, data e valor', 'er');
  try {
    await api.post('/financeiro', payload);
    toast('Lançamento salvo', 'ok');
    closeM('mFin');
    await renderFinanceiro();
  } catch (e) {
    toast(e.message, 'er');
  }
}
async function deletarFin(id) {
  if (!confirm('Excluir lançamento?')) return;
  try {
    await api.delete('/financeiro/' + id);
    toast('Excluído', 'wn');
    await renderFinanceiro();
  } catch (e) {
    toast(e.message, 'er');
  }
}

// =====================================================
// COMPARATIVO
// =====================================================
async function renderComparativo() {
  // Inicializa state na primeira render
  if (!state.comparativo) {
    state.comparativo = {
      selecionadas: state.usinas.map((u) => u.id),
      conhecidas: state.usinas.map((u) => u.id),
      chartType: 'line', // 'line' | 'bar'
    };
  }
  if (!state.comparativo.chartType) state.comparativo.chartType = 'line';
  const idsAtuais = new Set(state.usinas.map((u) => u.id));
  // 1. Remove IDs órfãos (usinas excluídas)
  state.comparativo.selecionadas = state.comparativo.selecionadas.filter((id) => idsAtuais.has(id));
  state.comparativo.conhecidas = state.comparativo.conhecidas.filter((id) => idsAtuais.has(id));
  // 2. Inclui SOMENTE usinas novas (ainda não vistas) — não re-inclui as que o usuário desmarcou
  for (const u of state.usinas) {
    if (!state.comparativo.conhecidas.includes(u.id)) {
      state.comparativo.selecionadas.push(u.id);
      state.comparativo.conhecidas.push(u.id);
    }
  }
  // monta os chips de seleção
  $('compChips').innerHTML = state.usinas
    .map((u, i) => {
      const cor = COLS[i % COLS.length];
      const sel = state.comparativo.selecionadas.includes(u.id);
      return `<div class="cu-chip ${sel ? 'sel' : ''}" data-comp-toggle="${u.id}"
        style="display:flex;align-items:center;gap:7px;padding:6px 13px;border-radius:17px;border:2px solid ${sel ? 'var(--p)' : 'var(--bd)'};background:${sel ? 'var(--pxl)' : '#fff'};cursor:pointer;font-size:13px;font-weight:600;color:${sel ? 'var(--p)' : 'var(--t2)'};transition:all .2s">
        <span style="width:7px;height:7px;border-radius:50%;background:${cor}"></span>${u.nome}
      </div>`;
    })
    .join('');
  $$('[data-comp-toggle]').forEach((c) =>
    c.addEventListener('click', () => {
      const id = c.dataset.compToggle;
      if (state.comparativo.selecionadas.includes(id)) {
        state.comparativo.selecionadas = state.comparativo.selecionadas.filter((x) => x !== id);
      } else {
        state.comparativo.selecionadas.push(id);
      }
      renderComparativo();
    }),
  );

  const ano = $('cAno').value;
  const mes = $('cMes').value;

  // Busca KPIs de cada usina selecionada
  const dadosPorUsina = await Promise.all(
    state.comparativo.selecionadas.map(async (id) => {
      const u = state.usinas.find((x) => x.id === id);
      const qs = new URLSearchParams();
      if (ano) qs.set('ano', ano);
      if (mes) qs.set('mes', mes);
      qs.set('usinaId', id);
      const k = await api.get('/dashboard/kpis?' + qs).catch(() => null);
      return { usina: u, kpis: k };
    }),
  );

  const valid = dadosPorUsina.filter((d) => d.kpis);
  const maxGer = Math.max(...valid.map((d) => d.kpis.kpis.geracao.valor), 0);
  const maxPR = Math.max(...valid.map((d) => d.kpis.kpis.pr.valor), 0);

  $('compGrid').innerHTML = valid.length
    ? valid.map((d, i) => {
        const k = d.kpis.kpis;
        const cor = COLS[state.usinas.findIndex((x) => x.id === d.usina.id) % COLS.length];

        // Previsão proporcional aos meses com lançamento (do porUsina, já vem assim agora)
        const porU = d.kpis.porUsina?.[0];
        const gerPrevComparavel = porU ? porU.gerPrev : k.geracao.previsto;
        const diff = gerPrevComparavel
          ? ((k.geracao.valor - gerPrevComparavel) / gerPrevComparavel) * 100
          : 0;
        const mesesUsados = porU?.mesesComDados ?? '?';

        return `
        <div class="tcard" style="padding:15px">
          <div style="font-size:13px;font-weight:700;margin-bottom:11px;display:flex;align-items:center;gap:7px">
            <span style="width:9px;height:9px;border-radius:50%;background:${cor}"></span>${d.usina.nome}
          </div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdl);font-size:12px"><span style="color:var(--t3)">Potência</span><span style="font-weight:700">${fmtNum(d.usina.kwp)} kWp</span></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdl);font-size:12px"><span style="color:var(--t3)">Geração</span><span style="font-weight:700;color:${k.geracao.valor === maxGer && maxGer > 0 ? 'var(--ok)' : ''}">${fmtNum(k.geracao.valor)} kWh</span></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdl);font-size:12px" title="Previsão somada apenas dos meses com lançamento (${mesesUsados} ${mesesUsados === 1 ? 'mês' : 'meses'})"><span style="color:var(--t3)">Previsto (${mesesUsados}m)</span><span style="font-weight:700">${fmtNum(gerPrevComparavel)} kWh</span></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdl);font-size:12px"><span style="color:var(--t3)">PR Médio</span><span style="font-weight:700;color:${k.pr.valor === maxPR && maxPR > 0 ? 'var(--ok)' : ''}">${k.pr.valor.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdl);font-size:12px"><span style="color:var(--t3)">Disponibilidade</span><span style="font-weight:700;color:${k.disponibilidade.valor >= 96 ? 'var(--ok)' : 'var(--er)'}">${k.disponibilidade.valor.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px"><span style="color:var(--t3)">vs Previsto</span><span style="font-weight:700;color:${diff >= 0 ? 'var(--ok)' : 'var(--er)'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%</span></div>
        </div>`;
      }).join('')
    : '<div class="empty" style="grid-column:1/-1"><i class="fas fa-balance-scale"></i><div class="et">Selecione ao menos uma usina</div></div>';

  // Gráfico do comparativo — tipo linha OU barra
  setTimeout(() => {
    const ctx = $('compChart');
    if (!ctx) return;
    if (state.charts.comp) state.charts.comp.destroy();
    const tipo = state.comparativo.chartType;
    state.charts.comp = new Chart(ctx.getContext('2d'), {
      type: tipo,
      data: {
        labels: MO,
        datasets: valid.map((d) => {
          const cor = COLS[state.usinas.findIndex((x) => x.id === d.usina.id) % COLS.length];
          if (tipo === 'bar') {
            return {
              label: d.usina.nome,
              data: d.kpis.mesesData.map((m) => m.gerReal / 1000),
              backgroundColor: cor + 'CC',
              borderColor: cor,
              borderWidth: 1,
              borderRadius: 3,
            };
          }
          return {
            label: d.usina.nome,
            data: d.kpis.mesesData.map((m) => m.gerReal / 1000),
            borderColor: cor,
            backgroundColor: cor + '22',
            borderWidth: 2,
            fill: false,
            tension: 0.4,
            pointBackgroundColor: cor,
            pointRadius: 3,
          };
        }),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 11, padding: 13 } } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { callback: (v) => v + ' MWh' } },
          x: tipo === 'bar' ? { grid: { display: false } } : { grid: { color: 'rgba(0,0,0,.04)' } },
        },
      },
    });
  }, 80);
}

function exportarCompPNG() {
  const canvas = $('compChart');
  if (!canvas || !state.charts.comp) return toast('Gere o gráfico primeiro', 'wn');
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'comparativo.png';
  a.click();
  toast('PNG exportado', 'ok');
}

// =====================================================
// RELATÓRIO
// =====================================================
async function renderRelatorio() {
  // Inicializa abas
  const cur = document.querySelector('.tabbtn.active[data-reltab]')?.dataset.reltab || 'rGer';
  await atualizarPreviewRelatorio(cur);
}

async function atualizarPreviewRelatorio(qual) {
  if (qual === 'rGer') {
    const usinaId = $('relGerUsina').value;
    const ano = $('relGerAno').value;
    const mes = $('relGerMes').value;
    if (!usinaId || !ano || !mes) {
      $('relGerPreview').innerHTML = '<div class="loading"><i class="fas fa-info-circle"></i> Selecione usina, ano e mês</div>';
      return;
    }
    try {
      const k = await api.get(`/dashboard/kpis?usinaId=${usinaId}&ano=${ano}&mes=${mes}`);
      const u = state.usinas.find((x) => x.id === usinaId);
      const dados = k.mesesData.find((m) => m.mes === parseInt(mes));
      $('relGerPreview').innerHTML = `
        <div style="font-size:13px;margin-bottom:10px"><strong>${u.nome}</strong> · ${MOF[parseInt(mes) - 1]} / ${ano}</div>
        <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
          <div class="kpi c-b"><div class="kpi-h"><div class="kpi-ic c-b"><i class="fas fa-bolt"></i></div></div>
            <div><span class="kval" style="font-size:18px">${fmtNum(dados?.gerReal || 0)}</span><span class="kunit">kWh</span></div>
            <div class="klbl">Geração Real</div><div style="font-size:11px;color:var(--t3);margin-top:3px">Prev: ${fmtNum(dados?.gerPrev || 0)} kWh</div></div>
          <div class="kpi c-c"><div class="kpi-h"><div class="kpi-ic c-c"><i class="fas fa-chart-pie"></i></div></div>
            <div><span class="kval" style="font-size:18px">${dados?.pr?.toFixed(1) || 0}</span><span class="kunit">%</span></div>
            <div class="klbl">PR Médio</div></div>
          <div class="kpi c-g"><div class="kpi-h"><div class="kpi-ic c-g"><i class="fas fa-check-circle"></i></div></div>
            <div><span class="kval" style="font-size:18px">${dados?.disp?.toFixed(1) || 0}</span><span class="kunit">%</span></div>
            <div class="klbl">Disponibilidade</div></div>
        </div>`;
    } catch (e) {
      $('relGerPreview').innerHTML = `<div class="alert alert-er">${e.message}</div>`;
    }
  } else if (qual === 'rFin') {
    const usinaId = $('relFinUsina').value;
    const ano = $('relFinAno').value;
    const mes = $('relFinMes').value;
    if (!ano) {
      $('relFinPreview').innerHTML = '<div class="loading"><i class="fas fa-info-circle"></i> Selecione ao menos o ano</div>';
      return;
    }
    try {
      const qs = new URLSearchParams();
      qs.set('ano', ano);
      if (usinaId) qs.set('usinaId', usinaId);
      const s = await api.get('/financeiro/sumario?' + qs);
      const t = s.totais;
      const u = usinaId ? state.usinas.find((x) => x.id === usinaId)?.nome : 'Todas as usinas';
      $('relFinPreview').innerHTML = `
        <div style="font-size:13px;margin-bottom:10px"><strong>${u}</strong> · ${mes ? MOF[parseInt(mes) - 1] + '/' : ''}${ano}</div>
        <div class="fin-kpi" style="grid-template-columns:repeat(4,1fr)">
          <div class="fin-card"><div class="fin-lbl">Receitas</div><div class="fin-val" style="color:var(--ok);font-size:17px">${fmtBRL(t.receitas)}</div><div class="fin-sub">${t.qtdReceitas} lançamentos</div></div>
          <div class="fin-card"><div class="fin-lbl">Despesas</div><div class="fin-val" style="color:var(--er);font-size:17px">${fmtBRL(t.despesas)}</div><div class="fin-sub">${t.qtdDespesas} lançamentos</div></div>
          <div class="fin-card ${t.liquido >= 0 ? 'hl' : ''}"><div class="fin-lbl">Líquido</div><div class="fin-val" style="color:${t.liquido >= 0 ? 'var(--p)' : 'var(--er)'};font-size:17px">${fmtBRL(t.liquido)}</div><div class="fin-sub">${t.liquido >= 0 ? 'Superávit' : 'Déficit'}</div></div>
          <div class="fin-card"><div class="fin-lbl">Margem</div><div class="fin-val" style="font-size:17px">${t.margem}%</div></div>
        </div>`;
    } catch (e) {
      $('relFinPreview').innerHTML = `<div class="alert alert-er">${e.message}</div>`;
    }
  }
}

function abrirRelTab(tab) {
  document.querySelectorAll('[data-reltab]').forEach((b) => b.classList.toggle('active', b.dataset.reltab === tab));
  $$('.reltabcontent').forEach((el) => (el.style.display = el.id === tab ? 'block' : 'none'));
  atualizarPreviewRelatorio(tab);
}

function gerarPDFGeracao() {
  const usinaId = $('relGerUsina').value;
  const ano = $('relGerAno').value;
  const mes = $('relGerMes').value;
  if (!usinaId || !ano || !mes) return toast('Selecione usina, ano e mês', 'wn');
  window.open(`/api/relatorio/pdf?usinaId=${usinaId}&ano=${ano}&mes=${mes}`, '_blank');
}

function gerarPDFFinanceiro() {
  const usinaId = $('relFinUsina').value;
  const ano = $('relFinAno').value;
  const mes = $('relFinMes').value;
  if (!ano) return toast('Selecione o ano', 'wn');
  const qs = new URLSearchParams();
  qs.set('ano', ano);
  if (usinaId) qs.set('usinaId', usinaId);
  if (mes) qs.set('mes', mes);
  window.open('/api/relatorio/financeiro.pdf?' + qs, '_blank');
}

function exportarFinCSV() {
  const usinaId = $('relFinUsina').value;
  const ano = $('relFinAno').value;
  const qs = new URLSearchParams();
  if (usinaId) qs.set('usinaId', usinaId);
  if (ano) qs.set('ano', ano);
  window.open('/api/admin/exportar/financeiro.csv?' + qs, '_blank');
}

// =====================================================
// USUÁRIOS (admin)
// =====================================================
async function renderUsuarios() {
  if (state.user.role !== 'ADMIN') {
    $('userTbl').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--er);padding:30px">Acesso restrito a administradores</td></tr>';
    return;
  }
  let users;
  try {
    users = await api.get('/admin/usuarios');
  } catch (e) {
    toast(e.message, 'er');
    return;
  }
  state.users = users;
  const roleLbl = { ADMIN: 'Administrador', TECNICO: 'Técnico', VISUALIZADOR: 'Visualizador' };
  const rolePill = { ADMIN: 'p-bl', TECNICO: 'p-ok', VISUALIZADOR: 'p-gy' };

  $('userTbl').innerHTML = users.length
    ? users.map((u) => `
      <tr>
        <td><strong>${u.nome}</strong></td>
        <td class="td2">${u.email}</td>
        <td><span class="pill ${rolePill[u.role]}">${roleLbl[u.role]}</span></td>
        <td><span class="pill ${u.ativo ? 'p-ok' : 'p-er'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td class="td2">${u.ultimoLogin ? new Date(u.ultimoLogin).toLocaleString('pt-BR') : 'Nunca'}</td>
        <td class="td2">${fmtDate(u.createdAt)}</td>
        <td>
          <button class="bico" data-edit-user="${u.id}" title="Editar"><i class="fas fa-edit"></i></button>
          ${u.id !== state.user.id ? `<button class="bico er" data-del-user="${u.id}" title="Excluir"><i class="fas fa-trash"></i></button>` : ''}
        </td>
      </tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:22px">Nenhum usuário</td></tr>';

  $$('[data-edit-user]').forEach((b) => b.addEventListener('click', () => abrirEditarUser(b.dataset.editUser)));
  $$('[data-del-user]').forEach((b) => b.addEventListener('click', () => deletarUser(b.dataset.delUser)));
}

function renderUserUsinasChecklist(usinaIdsMarcadas) {
  const list = $('uUsinasList');
  if (!list) return;
  if (!state.usinas.length) {
    list.innerHTML = '<div style="color:var(--t3);font-size:12px;text-align:center;padding:14px">Nenhuma usina cadastrada</div>';
    return;
  }
  const set = new Set(usinaIdsMarcadas || []);
  list.innerHTML = state.usinas
    .map((u) => `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:pointer;font-size:13px">
        <input type="checkbox" data-user-usina value="${u.id}" ${set.has(u.id) ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
        <span><strong>${u.nome}</strong> <span style="color:var(--t3);font-size:11px">— ${u.kwp.toLocaleString('pt-BR')} kWp</span></span>
      </label>`)
    .join('');
}

function atualizarVisibilidadeUsinasWrap() {
  // ADMIN não tem restrição
  const role = $('uRole').value;
  $('uUsinasWrap').style.display = role === 'ADMIN' ? 'none' : 'block';
}

function abrirNovoUser() {
  $('mUserTitle').innerHTML = '<i class="fas fa-user-plus" style="color:var(--p);margin-right:7px"></i>Novo Usuário';
  ['uNome', 'uEmail', 'uSenha'].forEach((id) => ($(id).value = ''));
  $('uRole').value = 'VISUALIZADOR';
  $('uEditId').value = '';
  $('uEmail').disabled = false;
  $('uSenhaHint').innerHTML = '⚠️ Se deixar a senha em branco, será criada com a senha padrão <strong>1234</strong> (peça ao usuário para trocar no 1º login).';
  $('uAtivoWrap').style.display = 'none';
  renderUserUsinasChecklist([]);
  atualizarVisibilidadeUsinasWrap();
  openM('mUser');
}

function abrirEditarUser(id) {
  const u = state.users.find((x) => x.id === id);
  if (!u) return;
  $('mUserTitle').innerHTML = '<i class="fas fa-user-edit" style="color:var(--p);margin-right:7px"></i>Editar Usuário';
  $('uNome').value = u.nome;
  $('uEmail').value = u.email;
  $('uEmail').disabled = true; // não permite trocar email
  $('uRole').value = u.role;
  $('uSenha').value = '';
  $('uSenhaHint').textContent = 'Deixe em branco para manter a senha atual.';
  $('uEditId').value = u.id;
  $('uAtivoWrap').style.display = 'block';
  $('uAtivo').value = u.ativo ? 'true' : 'false';
  renderUserUsinasChecklist(u.usinaIds || []);
  atualizarVisibilidadeUsinasWrap();
  openM('mUser');
}

async function salvarUser() {
  const id = $('uEditId').value;
  const nome = $('uNome').value.trim();
  const email = $('uEmail').value.trim();
  const senha = $('uSenha').value;
  const role = $('uRole').value;
  if (!nome) return toast('Informe o nome', 'er');
  if (!id && !email) return toast('Informe o e-mail', 'er');
  // Senha vazia na criação é aceita (servidor usa "1234" como padrão).
  // Na edição, senha vazia significa "não trocar".
  // Quando informada, validamos comprimento mínimo só por segurança básica.
  if (senha && senha.length > 0 && senha.length < 4) {
    return toast('Senha mínima de 4 caracteres', 'er');
  }
  try {
    // Lê usinas selecionadas (lista pode estar vazia se não-restringido)
    const usinaIds = [...document.querySelectorAll('[data-user-usina]:checked')].map(
      (c) => c.value,
    );
    if (id) {
      const payload = { nome, role, ativo: $('uAtivo').value === 'true', usinaIds };
      if (senha) payload.senha = senha;
      await api.put(`/admin/usuarios/${id}`, payload);
      toast('Usuário atualizado', 'ok');
    } else {
      const r = await api.post('/admin/usuarios', { email, nome, role, senha, usinaIds });
      if (r?.senhaPadrao) {
        toast(`Usuário criado com senha padrão: 1234`, 'wn');
      } else {
        toast('Usuário criado', 'ok');
      }
    }
    closeM('mUser');
    await renderUsuarios();
  } catch (e) {
    toast(e.message, 'er');
  }
}

async function deletarUser(id) {
  const u = state.users.find((x) => x.id === id);
  if (!u) return;
  if (!confirm(`Excluir o usuário "${u.nome}" (${u.email})?\nEsta ação não pode ser desfeita.`)) return;
  try {
    await api.delete(`/admin/usuarios/${id}`);
    toast('Usuário excluído', 'wn');
    await renderUsuarios();
  } catch (e) {
    toast(e.message, 'er');
  }
}

// =====================================================
// NOTIFICAÇÕES
// =====================================================
async function carregarNotificacoes() {
  try {
    const r = await api.get('/notificacoes');
    state.notificacoes = r.items;
    renderNotificacoes(r.naoLidas);
  } catch {}
}

function renderNotificacoes(naoLidas) {
  $('notifDot').classList.toggle('show', naoLidas > 0);
  const icons = { wn: 'fa-exclamation-triangle', info: 'fa-info-circle', ok: 'fa-check-circle', er: 'fa-times-circle' };
  const colors = { wn: 'color:var(--wn)', info: 'color:var(--p)', ok: 'color:var(--ok)', er: 'color:var(--er)' };
  $('notifList').innerHTML = state.notificacoes.length
    ? state.notificacoes.map((n) => `
      <div class="notif-item ${n.lida ? '' : 'unread'}" data-notif="${n.id}">
        <div class="ni-title"><i class="fas ${icons[n.tipo] || 'fa-bell'}" style="${colors[n.tipo] || ''};margin-right:5px"></i>${n.titulo}</div>
        <div class="ni-body">${n.body}</div>
        <div class="ni-time">${tempoRelativo(n.createdAt)}</div>
      </div>`).join('')
    : '<div style="text-align:center;padding:30px;color:var(--t3);font-size:13px">Nenhuma notificação</div>';

  $$('[data-notif]').forEach((el) =>
    el.addEventListener('click', async () => {
      const id = el.dataset.notif;
      try {
        await api.patch(`/notificacoes/${id}/lida`);
        await carregarNotificacoes();
      } catch {}
    }),
  );
}

function tempoRelativo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `há ${Math.floor(diff / 86400)} dia(s)`;
  return d.toLocaleDateString('pt-BR');
}

// =====================================================
// SOCKET.IO — preparação para Fase C
// =====================================================
function conectarSocket() {
  try {
    if (typeof io === 'undefined') return;
    state.socket = io({ withCredentials: true });
    state.socket.on('connect', () => {
      $('rtStatus').classList.remove('offline');
      $('rtStatus').querySelector('span').textContent = 'Online';
    });
    state.socket.on('disconnect', () => {
      $('rtStatus').classList.add('offline');
      $('rtStatus').querySelector('span').textContent = 'Offline';
    });

    // Handlers de eventos do servidor (broadcast)
    const eventos = ['usina', 'lancamento', 'manutencao', 'financeiro', 'notificacao'];
    eventos.forEach((recurso) => {
      ['created', 'updated', 'deleted'].forEach((acao) => {
        state.socket.on(`${recurso}:${acao}`, () => onRemoteChange(recurso, acao));
      });
    });
  } catch (e) {
    console.warn('Socket.IO indisponível:', e);
  }
}

const recarregarSecaoDebounced = debounce(async () => {
  const active = document.querySelector('.section.active')?.id?.replace('sec-', '');
  if (active === 'dashboard') await renderDashboard();
  if (active === 'cadastro') await renderCadastro();
  if (active === 'lancamento') await renderLancamento();
  if (active === 'manutencao') await renderKanban();
  if (active === 'financeiro') await renderFinanceiro();
  if (active === 'comparativo') await renderComparativo();
  if (active === 'usuarios') await renderUsuarios();
}, 300);

async function onRemoteChange(recurso, acao) {
  // Recarrega a lista de usinas se foi mudança de usina (afeta todos os selects)
  if (recurso === 'usina') await carregarUsinas();
  if (recurso === 'notificacao') await carregarNotificacoes();
  recarregarSecaoDebounced();
}

// =====================================================
// EVENTOS GERAIS
// =====================================================
function setupEventos() {
  // Filtros do dashboard
  $('btnApplyFilter').addEventListener('click', renderDashboard);
  $('btnClearFilter').addEventListener('click', () => {
    $('fMes').value = '';
    $('fUsina').value = '';
    $('fSkid').innerHTML = '<option value="">Todos os SKIDs</option>';
    renderDashboard();
  });
  $('fUsina').addEventListener('change', () => {
    atualizarSkidSelect();
    renderDashboard();
  });
  ['fAno', 'fMes', 'fSkid'].forEach((id) => $(id).addEventListener('change', renderDashboard));

  // Cadastro
  $('btnNovaUsina').addEventListener('click', abrirNovaUsina);
  $('btnSaveUsina').addEventListener('click', salvarUsina);
  $('btnAddSkid').addEventListener('click', () => addSkidBlock(null));
  $$('.tabbtn').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.tabbtn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $$('.tabcontent').forEach((t) => (t.style.display = 'none'));
      $(b.dataset.tab).style.display = 'block';
    }),
  );

  // Lançamentos
  $('btnSaveLanc').addEventListener('click', salvarLanc);
  $('btnClearLanc').addEventListener('click', limparLancForm);
  $('lUsina').addEventListener('change', atualizarLSkidSelect);
  ['lFU', 'lFA', 'lFM'].forEach((id) => $(id).addEventListener('change', renderLancamento));

  // Importar
  setupImportar();

  // Manutenções
  $('btnNovaManut').addEventListener('click', abrirNovaManut);
  $('btnSaveManut').addEventListener('click', salvarManut);
  ['mFU', 'mFT', 'mFA'].forEach((id) => $(id).addEventListener('change', renderKanban));

  // Financeiro
  $('btnNovoFin').addEventListener('click', abrirNovoFin);
  $('btnSaveFin').addEventListener('click', salvarFin);
  $('btnFinNovaCat').addEventListener('click', adicionarNovaCategoriaFin);
  ['finFU', 'finFA', 'finFT'].forEach((id) => $(id).addEventListener('change', renderFinanceiro));
  // Toggle Despesas ↔ Receitas no gráfico de categorias
  $$('[data-fincat]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('[data-fincat]').forEach((b) => b.classList.toggle('active', b === btn));
      state.finCatTipo = btn.dataset.fincat;
      renderFinanceiro();
    }),
  );

  // Notificações
  $('btnNotif').addEventListener('click', () => $('notifPanel').classList.toggle('open'));
  $('btnNotifClose').addEventListener('click', () => $('notifPanel').classList.remove('open'));
  $('btnNotifAllRead').addEventListener('click', async () => {
    try {
      await api.post('/notificacoes/marcar-todas-lidas');
      await carregarNotificacoes();
      toast('Todas marcadas como lidas', 'ok');
    } catch (e) {
      toast(e.message, 'er');
    }
  });

  // Comparativo
  $('btnCompUpdate').addEventListener('click', renderComparativo);
  $('btnCompPNG').addEventListener('click', exportarCompPNG);
  ['cAno', 'cMes'].forEach((id) => $(id).addEventListener('change', renderComparativo));
  $$('[data-comptype]').forEach((b) =>
    b.addEventListener('click', () => {
      $$('[data-comptype]').forEach((x) => x.classList.toggle('active', x === b));
      if (!state.comparativo) state.comparativo = { chartType: b.dataset.comptype };
      else state.comparativo.chartType = b.dataset.comptype;
      renderComparativo();
    }),
  );

  // Relatório
  $$('[data-reltab]').forEach((b) =>
    b.addEventListener('click', () => abrirRelTab(b.dataset.reltab)),
  );
  ['relGerUsina', 'relGerAno', 'relGerMes'].forEach((id) =>
    $(id).addEventListener('change', () => atualizarPreviewRelatorio('rGer')),
  );
  ['relFinUsina', 'relFinAno', 'relFinMes'].forEach((id) =>
    $(id).addEventListener('change', () => atualizarPreviewRelatorio('rFin')),
  );
  $('btnRelGerPDF').addEventListener('click', gerarPDFGeracao);
  $('btnRelFinPDF').addEventListener('click', gerarPDFFinanceiro);
  $('btnRelFinCSV').addEventListener('click', exportarFinCSV);

  // Usuários
  $('btnNovoUser').addEventListener('click', abrirNovoUser);
  $('btnSaveUser').addEventListener('click', salvarUser);
  $('uRole').addEventListener('change', atualizarVisibilidadeUsinasWrap);

  // Exportações
  $('btnExpLancCSV').addEventListener('click', () => {
    const usinaId = $('fUsina').value;
    const ano = $('fAno').value;
    const qs = new URLSearchParams();
    if (usinaId) qs.set('usinaId', usinaId);
    if (ano) qs.set('ano', ano);
    window.open('/api/admin/exportar/lancamentos.csv?' + qs, '_blank');
  });
  $('btnExpPDF').addEventListener('click', () => {
    const usinaId = $('fUsina').value;
    const ano = $('fAno').value;
    const mes = $('fMes').value || String(new Date().getMonth() + 1).padStart(2, '0');
    if (!usinaId) {
      toast('Selecione uma usina específica no filtro', 'wn');
      return;
    }
    window.open(`/api/relatorio/pdf?usinaId=${usinaId}&ano=${ano}&mes=${mes}`, '_blank');
  });

  // Refresh manual
  $('btnRefresh').addEventListener('click', async () => {
    await carregarUsinas();
    const active = document.querySelector('.section.active')?.id?.replace('sec-', '');
    await abrirSecao(active);
    toast('Dados atualizados', 'ok');
  });
}
