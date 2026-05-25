// Tela de login — submete credenciais e redireciona para o dashboard.
import { api, ApiError } from './api.js';

const form = document.getElementById('loginForm');
const msgEl = document.getElementById('msg');
const btn = document.getElementById('btn');

function showMsg(text, ok = false) {
  msgEl.textContent = text;
  msgEl.className = 'lg-msg show' + (ok ? ' ok' : '');
}

// Se já está logado, redireciona
api
  .get('/auth/me')
  .then(() => (location.href = './index.html'))
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value;
  if (!email || !senha) return;

  msgEl.className = 'lg-msg';
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Entrando…';

  try {
    await api.post('/auth/login', { email, senha });
    showMsg('Sucesso! Redirecionando…', true);
    setTimeout(() => (location.href = './index.html'), 400);
  } catch (err) {
    const text = err instanceof ApiError ? err.message : 'Erro de conexão';
    showMsg(text);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar';
  }
});
