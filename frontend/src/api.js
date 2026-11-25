const API_BASE = "";

export async function api(path, token, options = {}) {
  const { signal, ...fetchOptions } = options;
  const headers = { "Content-Type": "application/json", ...fetchOptions.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  const slowNotice = window.setTimeout(() => {
    if (!controller.signal.aborted)
      window.dispatchEvent(new CustomEvent("api:slow", { detail: { path } }));
  }, 10000);
  const forwardAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal
    });
    if (controller.signal.aborted)
      throw new DOMException("A solicitação foi cancelada.", "AbortError");

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
    if (response.status === 204) return null;
    const result = await response.json();
    if (controller.signal.aborted)
      throw new DOMException("A solicitação foi cancelada.", "AbortError");
    return result;
  } catch (error) {
    if (timedOut)
      throw new Error("A solicitação excedeu o tempo limite. Verifique a conexão e tente novamente.");
    if (signal?.aborted)
      throw error;
    if (error instanceof TypeError)
      throw new TypeError("Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    window.clearTimeout(slowNotice);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export function isNetworkError(error) {
  return !navigator.onLine || error instanceof TypeError;
}
