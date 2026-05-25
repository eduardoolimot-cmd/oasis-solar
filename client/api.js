// =================================================
// OASIS SOLAR — camada cliente da API
// =================================================
// Wrappers fetch com cookie httpOnly automático (credentials: include).
// Em caso de 401, redireciona pro login.

const BASE = '/api'; // mesma origem (servidor serve o frontend)

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body, opts = {}) {
  const init = {
    method,
    credentials: 'include',
    headers: {
      ...(opts.headers || {}),
    },
  };

  if (body !== undefined && !(body instanceof FormData)) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    init.body = body;
  }

  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* texto puro */
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.skipRedirect) {
      // Salva path atual para voltar depois do login
      if (!location.pathname.endsWith('login.html')) {
        location.href = './login.html';
      }
    }
    throw new ApiError(
      res.status,
      json?.error || `HTTP ${res.status}`,
      json?.details,
    );
  }
  return json;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  delete: (path, opts) => request('DELETE', path, undefined, opts),

  // Upload helper (FormData)
  upload: (path, formData, opts) => request('POST', path, formData, opts),
};
