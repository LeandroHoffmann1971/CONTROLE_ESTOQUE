const API_BASE = "";

export async function api(path, token, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const slowNotice = window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("api:slow", { detail: { path } }));
  }, 10000);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("A solicitação excedeu o tempo limite de 15 segundos.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    window.clearTimeout(slowNotice);
    options.signal?.removeEventListener("abort", forwardAbort);
  }

  if (response.status === 401 && token) {
    window.dispatchEvent(new CustomEvent("api:unauthorized"));
    throw new Error("Sessão expirada. Entre novamente.");
  }
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
