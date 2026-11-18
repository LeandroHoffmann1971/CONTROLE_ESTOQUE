const LOCAL_DATA_VERSION = "3";
if (localStorage.getItem("despensa-data-version") !== LOCAL_DATA_VERSION) {
  localStorage.removeItem("despensa-products");
  localStorage.removeItem("despensa-movements");
  localStorage.removeItem("despensa-pending");
  localStorage.setItem("despensa-data-version", LOCAL_DATA_VERSION);
}

const state = {
  products: JSON.parse(localStorage.getItem("despensa-products") || "[]"),
  movements: [],
  filter: "all",
  query: ""
};
const API_BASE = window.location.port === "5500" ? "http://localhost:5080" : "";
const productDialog = document.querySelector("#product-dialog");
const movementDialog = document.querySelector("#movement-dialog");
const productForm = document.querySelector("#product-form");
const movementForm = document.querySelector("#movement-form");
const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

const currentDate = new Date();
const currentDateLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }).format(currentDate);
document.querySelector("#today-label").textContent = currentDateLabel;
document.querySelector("#movement-report-date").textContent = `Estoque atual na data de hoje: ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(currentDate)}.`;
document.querySelector("#movement-current-date").textContent = `Posição consultada em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(currentDate)}.`;

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try { const payload = await response.json(); message = payload.error || payload.detail || message; } catch { /* resposta sem JSON */ }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function saveCache() {
  localStorage.setItem("despensa-products", JSON.stringify(state.products));
}

function getPending() {
  return JSON.parse(localStorage.getItem("despensa-pending") || "[]");
}

function setPending(pending) {
  localStorage.setItem("despensa-pending", JSON.stringify(pending));
}

function isNetworkError(error) {
  return !navigator.onLine || error instanceof TypeError;
}

async function syncPending() {
  const pending = getPending();
  while (pending.length) {
    const operation = pending[0];
    try {
      if (operation.kind === "createProduct") {
        const created = await api("/api/products", { method: "POST", body: JSON.stringify(operation.payload) });
        const localProduct = state.products.find(product => product.id === operation.localId);
        if (localProduct) Object.assign(localProduct, created);
        for (const queued of pending.slice(1)) {
          if (queued.productId === operation.localId) queued.productId = created.id;
          if (queued.id === operation.localId) queued.id = created.id;
        }
      } else if (operation.kind === "updateProduct") {
        await api(`/api/products/${operation.id}`, { method: "PUT", body: JSON.stringify(operation.payload) });
      } else if (operation.kind === "movement") {
        await api(`/api/products/${operation.productId}/movements`, { method: "POST", body: JSON.stringify(operation.payload) });
      } else if (operation.kind === "deleteProduct") {
        await api(`/api/products/${operation.id}`, { method: "DELETE" });
      }
      pending.shift();
      setPending(pending);
      saveCache();
    } catch (error) {
      if (!isNetworkError(error)) showToast(`Sincronização pausada: ${error.message}`);
      throw error;
    }
  }
  showToast("Alterações offline sincronizadas.");
}

function queueOffline(operation) {
  const pending = getPending();
  pending.push(operation);
  setPending(pending);
  saveCache();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function setConnection(online, text) {
  const dot = document.querySelector(".connection-dot");
  dot.classList.toggle("online", online);
  dot.classList.toggle("offline", !online);
  document.querySelector("#connection-label").textContent = text;
}

async function refreshData() {
  try {
    if (getPending().length) await syncPending();
    state.products = await api("/api/products");
    saveCache();
    setConnection(true, "Supabase conectado");
    render();
  } catch (error) {
    setConnection(false, "Banco indisponível");
    render();
    if (!isNetworkError(error)) showToast(error.message);
  }
}

function isLow(product) { return Number(product.current_stock) <= Number(product.minimum_stock); }

function render() {
  const lowCount = state.products.filter(isLow).length;
  document.querySelector("#metric-total").textContent = state.products.length;
  document.querySelector("#metric-healthy").textContent = state.products.length - lowCount;
  document.querySelector("#metric-low").textContent = lowCount;
  document.querySelector("#count-all").textContent = state.products.length;
  document.querySelector("#count-low").textContent = lowCount;

  const filtered = state.products.filter(product => {
    const matchesQuery = `${product.name} ${product.code ?? ""}`.toLocaleLowerCase("pt-BR").includes(state.query.toLocaleLowerCase("pt-BR"));
    return matchesQuery && (state.filter === "all" || isLow(product));
  });
  document.querySelector("#result-count").textContent = `${filtered.length} ${filtered.length === 1 ? "produto" : "produtos"}`;
  document.querySelector("#products-body").innerHTML = filtered.length ? filtered.map(productRow).join("") : `<tr><td class="empty-state" colspan="6">${state.products.length ? "Nenhum produto encontrado." : "Seu catálogo ainda está vazio."}</td></tr>`;
}

function renderMovements() {
  const sorted = [...state.movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  document.querySelector("#movement-count").textContent = `${sorted.length} ${sorted.length === 1 ? "movimentação" : "movimentações"}`;
  document.querySelector("#movements-body").innerHTML = sorted.length ? sorted.map(movement => {
    const isEntry = movement.type === "entry";
    const label = isEntry ? "Entrada" : "Saída";
    const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(movement.createdAt));
    return `<tr>
      <td><div class="product-cell"><span class="product-avatar">${escapeHtml(movement.productName.trim().slice(0, 1).toLocaleUpperCase("pt-BR"))}</span><span class="product-name">${escapeHtml(movement.productName)}</span></div></td>
      <td><span class="movement-type ${isEntry ? "entry" : "exit"}">${label}</span></td>
      <td class="movement-quantity ${isEntry ? "entry" : "exit"}">${isEntry ? "+" : "−"}${numberFormat.format(movement.quantity)}</td>
      <td>${escapeHtml(date)}</td>
      <td class="stock-cell">${numberFormat.format(movement.currentStock)}</td>
    </tr>`;
  }).join("") : `<tr><td class="empty-state" colspan="5">Nenhuma movimentação registrada.</td></tr>`;
}

async function loadMovements() {
  const body = document.querySelector("#movements-body");
  body.innerHTML = `<tr><td class="empty-state" colspan="5">Carregando movimentações...</td></tr>`;
  try {
    state.movements = await api("/api/movements");
    renderMovements();
  } catch (error) {
    body.innerHTML = `<tr><td class="empty-state" colspan="5">${escapeHtml(error.message)}</td></tr>`;
    showToast(`Não foi possível carregar as movimentações: ${error.message}`);
  }
}

function setPage() {
  const page = window.location.hash === "#movimentacoes" ? "movimentacoes" : "estoque";
  const isMovements = page === "movimentacoes";
  document.querySelector("#inventory-view").hidden = isMovements;
  document.querySelector("#movement-report-view").hidden = !isMovements;
  document.querySelector("#breadcrumb-current").textContent = isMovements ? "Movimentações" : "Estoque";
  document.querySelectorAll(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.page === page));
  if (isMovements) loadMovements();
}

function productRow(product) {
  const low = isLow(product);
  const initials = product.name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
  return `<tr>
    <td><div class="product-cell"><span class="product-avatar">${escapeHtml(initials)}</span><span class="product-name">${escapeHtml(product.name)}</span></div></td>
    <td class="code-cell">${escapeHtml(product.code ?? "—")}</td>
    <td class="stock-cell ${low ? "critical" : ""}">${numberFormat.format(product.current_stock)}</td>
    <td>${numberFormat.format(product.minimum_stock)}</td>
    <td><span class="status ${low ? "low" : "healthy"}">${low ? "Repor estoque" : "Saudável"}</span></td>
    <td><div class="row-actions"><button class="row-action" data-action="entry" data-id="${product.id}" title="Registrar entrada" aria-label="Registrar entrada de ${escapeHtml(product.name)}">＋</button><button class="row-action" data-action="exit" data-id="${product.id}" title="Registrar saída" aria-label="Registrar saída de ${escapeHtml(product.name)}">−</button><button class="row-action" data-action="edit" data-id="${product.id}" title="Editar produto" aria-label="Editar ${escapeHtml(product.name)}">✎</button><button class="row-action" data-action="delete" data-id="${product.id}" title="Excluir produto" aria-label="Excluir ${escapeHtml(product.name)}">×</button></div></td>
  </tr>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function openProduct(product) {
  productForm.reset();
  productForm.elements.id.value = product?.id || "";
  productForm.elements.name.value = product?.name || "";
  productForm.elements.minimumStock.value = product?.minimum_stock ?? 0;
  productForm.elements.initialStock.value = 0;
  const editing = Boolean(product);
  document.querySelector("#product-dialog-title").textContent = editing ? "Editar produto" : "Novo produto";
  document.querySelector("#initial-stock-field").hidden = editing;
  document.querySelector("#product-error").textContent = "";
  productDialog.showModal();
}

function openMovement(product, type) {
  movementForm.reset();
  movementForm.elements.productId.value = product.id;
  movementForm.elements.type.value = type;
  document.querySelector("#movement-title").textContent = type === "entry" ? "Registrar entrada" : "Registrar saída";
  document.querySelector("#movement-product-name").textContent = `${product.name} · saldo atual ${numberFormat.format(product.current_stock)}`;
  document.querySelector("#movement-error").textContent = "";
  movementDialog.showModal();
}

document.querySelector("#add-product").addEventListener("click", () => openProduct());
document.querySelector("#refresh").addEventListener("click", refreshData);
document.querySelector("#refresh-movements").addEventListener("click", loadMovements);
window.addEventListener("hashchange", setPage);
document.querySelector("#search").addEventListener("input", event => { state.query = event.target.value.trim(); render(); });
document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll(".filter").forEach(item => item.classList.toggle("active", item === button));
  render();
}));
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));

document.querySelector("#products-body").addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const product = state.products.find(item => item.id === button.dataset.id);
  if (!product) return;
  if (button.dataset.action === "entry" || button.dataset.action === "exit") return openMovement(product, button.dataset.action);
  if (button.dataset.action === "edit") return openProduct(product);
  if (button.dataset.action === "delete" && window.confirm(`Excluir "${product.name}"? Produtos com histórico de movimentações não podem ser removidos.`)) {
    try { await api(`/api/products/${product.id}`, { method: "DELETE" }); showToast("Produto excluído."); await refreshData(); }
    catch (error) {
      if (!isNetworkError(error)) return showToast(error.message);
      state.products = state.products.filter(item => item.id !== product.id);
      queueOffline({ kind: "deleteProduct", id: product.id });
      render();
      showToast("Exclusão salva neste dispositivo. Será sincronizada quando houver conexão.");
    }
  }
});

productForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(productForm));
  const editing = Boolean(data.id);
  const payload = { name: data.name, minimumStock: Number(data.minimumStock) };
  if (!editing) payload.initialStock = Number(data.initialStock);
  try {
    await api(editing ? `/api/products/${data.id}` : "/api/products", { method: editing ? "PUT" : "POST", body: JSON.stringify(payload) });
    productDialog.close();
    showToast(editing ? "Produto atualizado." : "Produto cadastrado.");
    await refreshData();
  } catch (error) {
    if (!isNetworkError(error)) { document.querySelector("#product-error").textContent = error.message; return; }
    if (editing) {
      Object.assign(state.products.find(product => product.id === data.id), { name: data.name, minimum_stock: Number(data.minimumStock) });
      queueOffline({ kind: "updateProduct", id: data.id, payload });
    } else {
      const localId = crypto.randomUUID();
      state.products.push({ id: localId, name: data.name, code: null, minimum_stock: Number(data.minimumStock), current_stock: Number(data.initialStock), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      queueOffline({ kind: "createProduct", localId, payload });
    }
    productDialog.close();
    render();
    showToast("Salvo neste dispositivo. Será sincronizado quando houver conexão.");
  }
});

movementForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(movementForm));
  const product = state.products.find(item => item.id === data.productId);
  if (data.type === "exit" && Number(data.quantity) > Number(product?.current_stock)) {
    if (!window.confirm("A saída é maior que o saldo registrado. Deseja continuar?")) return;
  }
  try {
    await api(`/api/products/${data.productId}/movements`, { method: "POST", body: JSON.stringify({ type: data.type, quantity: Number(data.quantity), reason: data.reason, operatorName: data.operatorName }) });
    movementDialog.close();
    showToast("Movimentação registrada.");
    await refreshData();
  } catch (error) {
    if (!isNetworkError(error)) { document.querySelector("#movement-error").textContent = error.message; return; }
    const quantity = Number(data.quantity);
    const product = state.products.find(item => item.id === data.productId);
    product.current_stock = Number(product.current_stock) + (data.type === "entry" ? quantity : -quantity);
    queueOffline({ kind: "movement", productId: data.productId, payload: { type: data.type, quantity, reason: data.reason, operatorName: data.operatorName } });
    movementDialog.close();
    render();
    showToast("Movimentação salva neste dispositivo e pendente de sincronização.");
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
window.addEventListener("online", refreshData);
setPage();
refreshData();