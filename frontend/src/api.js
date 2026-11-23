const API_BASE = import.meta.env.DEV ? "http://localhost:5080" : "";

export async function api(path, token, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.error || payload.detail || payload.title || message;
    } catch (error) {
      if (!(error instanceof SyntaxError))
        throw error;
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

export function isNetworkError(error) {
  return !navigator.onLine || error instanceof TypeError;
}
