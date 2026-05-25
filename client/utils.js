// Utilitários compartilhados (toast, formatação, helpers DOM)

export const MO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const MOF = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const COLS = ['#0057B8', '#00B4D8', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444'];

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => root.querySelectorAll(sel);

export function toast(msg, tipo = 'ok') {
  const ICONS = { ok: 'fa-check-circle', info: 'fa-info-circle', wn: 'fa-exclamation-triangle', er: 'fa-times-circle' };
  const COLORS = { ok: 'var(--ok)', info: 'var(--p)', wn: 'var(--wn)', er: 'var(--er)' };
  const el = $('toast');
  $('tMsg').textContent = msg;
  const icon = $('tIcon');
  icon.className = 'fas ' + (ICONS[tipo] || ICONS.ok);
  icon.style.color = COLORS[tipo] || COLORS.ok;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

export function fmtNum(v, dec = 0) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

export function fmtBRL(v) {
  return 'R$ ' + fmtNum(v, 2);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function fmtPeriodo(p) {
  if (!p) return '—';
  const [y, m] = p.split('-');
  return `${m}/${y}`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Verifica se o usuário tem role permitido para um elemento (data-role="ADMIN,TECNICO")
export function aplicarRoleUI(userRole) {
  $$('[data-role]').forEach((el) => {
    const allowed = el.dataset.role.split(',').map((s) => s.trim());
    if (!allowed.includes(userRole)) {
      el.classList.add('role-hide');
    } else {
      el.classList.remove('role-hide');
    }
  });
}

export function preencherSelectAno(selectId, comTodos = true) {
  const el = $(selectId);
  if (!el) return;
  const cur = el.value;
  const anoAtual = new Date().getFullYear();
  let html = comTodos ? '<option value="">Todos os anos</option>' : '';
  for (let y = anoAtual + 1; y >= anoAtual - 4; y--) {
    html += `<option value="${y}">${y}</option>`;
  }
  el.innerHTML = html;
  if (cur && [...el.options].some((o) => o.value === cur)) el.value = cur;
  else if (!comTodos) el.value = String(anoAtual);
}

export function preencherSelectUsinas(selectId, usinas, opts = {}) {
  const el = $(selectId);
  if (!el) return;
  const cur = el.value;
  const prefix = opts.prefix ?? 'Todas as usinas';
  const html =
    `<option value="">${prefix}</option>` +
    usinas
      .map((u) => `<option value="${u.id}">${u.nome}</option>`)
      .join('');
  el.innerHTML = html;
  if (cur && [...el.options].some((o) => o.value === cur)) el.value = cur;
}

// Modais
export function openM(id) {
  $(id).classList.add('open');
}
export function closeM(id) {
  $(id).classList.remove('open');
}

// Fechar modal ao clicar no overlay ou em qualquer botão [data-close]
document.addEventListener('click', (e) => {
  if (e.target.classList?.contains('moverlay')) e.target.classList.remove('open');
  const closeId = e.target.closest('[data-close]')?.dataset?.close;
  if (closeId) closeM(closeId);
});
