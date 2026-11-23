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
  users: [],
  accessToken: null,
  user: null,
  filter: "all",
  query: ""
};
const API_BASE = window.location.port === "5500" ? "http://localhost:5080" : "";
const productDialog = document.querySelector("#product-dialog");
const movementDialog = document.querySelector("#movement-dialog");
const userDialog = document.querySelector("#user-dialog");
const productForm = document.querySelector("#product-form");
const movementForm = document.querySelector("#movement-form");
const userEditForm = document.querySelector("#user-edit-form");
const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const PASSWORD_ERROR = "A senha deve ter 6 caracteres alfanuméricos";

const currentDate = new Date();
const currentDateLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }).format(currentDate);
document.querySelector("#today-label").textContent = currentDateLabel;
document.querySelector("#movement-report-date").textContent = `Estoque atual na data de hoje: ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(currentDate)}.`;
document.querySelector("#movement-current-date").textContent = `Posição consultada em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(currentDate)}.`;

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
  const canSyncPending = state.user?.status === "GERENTE" ||
    pending.every(operation => ["updateProduct", "movement"].includes(operation.kind));
  if (!canSyncPending) {
    showToast("Algumas alterações pendentes só podem ser sincronizadas por um gerente.");
    return;
  }
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
  if (!state.user) return;
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
  document.querySelector("#products-cards").innerHTML = filtered.length ? filtered.map(productCard).join("") : `<p class="empty-state">${state.products.length ? "Nenhum produto encontrado." : "Seu catálogo ainda está vazio."}</p>`;
}

function renderMovements() {
  const sorted = [...state.movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  document.querySelector("#movement-count").textContent = `${sorted.length} ${sorted.length === 1 ? "movimentação" : "movimentações"}`;
  document.querySelector("#movements-cards").innerHTML = sorted.length ? sorted.map(movement => {
    const isEntry = movement.type === "entry";
    const label = isEntry ? "Entrada" : "Saída";
    const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(movement.createdAt));
    return `<article class="data-card movement-card">
      <div class="card-title-row"><div class="product-cell"><span class="product-avatar">${escapeHtml(movement.productName.trim().slice(0, 1).toLocaleUpperCase("pt-BR"))}</span><span class="product-name">${escapeHtml(movement.productName)}</span></div><span class="movement-type ${isEntry ? "entry" : "exit"}">${label}</span></div>
      <dl class="card-details">
        <div><dt>Quantidade</dt><dd class="movement-quantity ${isEntry ? "entry" : "exit"}">${isEntry ? "+" : "−"}${numberFormat.format(movement.quantity)}</dd></div>
        <div><dt>Data</dt><dd>${escapeHtml(date)}</dd></div>
        <div><dt>Estoque atual</dt><dd>${numberFormat.format(movement.currentStock)}</dd></div>
        <div><dt>Motivo</dt><dd>${escapeHtml(movement.reason || "—")}</dd></div>
        <div><dt>Operador</dt><dd>${escapeHtml(movement.operatorName || "—")}</dd></div>
      </dl>
    </article>`;
  }).join("") : `<p class="empty-state">Nenhuma movimentação registrada.</p>`;
}

async function loadMovements() {
  const body = document.querySelector("#movements-cards");
  body.innerHTML = `<p class="empty-state">Carregando movimentações...</p>`;
  try {
    state.movements = await api("/api/movements");
    renderMovements();
  } catch (error) {
    body.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    showToast(`Não foi possível carregar as movimentações: ${error.message}`);
  }
}

async function loadUsers() {
  const cards = document.querySelector("#users-cards");
  cards.innerHTML = `<p class="empty-state">Carregando usuários...</p>`;
  try {
    state.users = await api("/api/users");
    document.querySelector("#user-count").textContent = `${state.users.length} ${state.users.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}`;
    cards.innerHTML = state.users.length ? state.users.map(user => {
      const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${user.createdAt}T00:00:00Z`));
      const isCurrentUser = user.id === state.user.id;
      return `<article class="data-card user-card">
        <div class="card-title-row"><div class="product-cell"><span class="product-avatar">${escapeHtml(user.name.trim().slice(0, 1).toLocaleUpperCase("pt-BR"))}</span><span class="product-name">${escapeHtml(user.name)}</span></div><span class="status ${user.status === "GERENTE" ? "healthy" : "low"}">${user.status === "GERENTE" ? "Gerente" : "Colaborador"}</span></div>
        <dl class="card-details"><div><dt>ID</dt><dd>${user.id}</dd></div><div><dt>CPF</dt><dd>${escapeHtml(user.cpf)}</dd></div><div><dt>Data de cadastro</dt><dd>${escapeHtml(date)}</dd></div><div><dt>Status</dt><dd>${user.status === "GERENTE" ? "GERENTE" : "COLABORADOR"}</dd></div></dl>
        <div class="card-actions">
          <button class="button button-quiet" data-user-action="edit" data-id="${user.id}">Editar</button>
          <button class="button button-quiet" data-user-action="delete" data-id="${user.id}" ${isCurrentUser ? "disabled title=\"Não é possível excluir sua própria conta\"" : ""}>Excluir</button>
        </div>
      </article>`;
    }).join("") : `<p class="empty-state">Nenhum usuário cadastrado.</p>`;
  } catch (error) {
    cards.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    showToast(`Não foi possível carregar os usuários: ${error.message}`);
  }
}

function setPage() {
  if (!state.user) return;
  const allowedPages = state.user.status === "GERENTE"
    ? ["estoque", "movimentacoes", "usuarios", "senha"]
    : ["estoque", "senha"];
  let page = window.location.hash.slice(1);
  if (!allowedPages.includes(page)) {
    page = allowedPages[0];
    window.history.replaceState(null, "", `#${page}`);
  }
  const labels = { estoque: "Estoque", movimentacoes: "Movimentações", usuarios: "Usuários", senha: "Alterar senha" };
  document.querySelector("#inventory-view").hidden = page !== "estoque";
  document.querySelector("#movement-report-view").hidden = page !== "movimentacoes";
  document.querySelector("#users-view").hidden = page !== "usuarios";
  document.querySelector("#password-view").hidden = page !== "senha";
  document.querySelector("#breadcrumb-current").textContent = labels[page];
  document.querySelectorAll(".nav-link").forEach(link => {
    const active = link.dataset.page === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (page === "movimentacoes") loadMovements();
  if (page === "usuarios") loadUsers();
}

function productCard(product) {
  const low = isLow(product);
  const initials = product.name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
  const managerActions = state.user?.status === "GERENTE"
    ? `<button class="button button-quiet" data-action="delete" data-id="${product.id}">Excluir</button>`
    : "";
  return `<article class="data-card product-card">
    <div class="card-title-row"><div class="product-cell"><span class="product-avatar">${escapeHtml(initials)}</span><span class="product-name">${escapeHtml(product.name)}</span></div><span class="status ${low ? "low" : "healthy"}">${low ? "Repor estoque" : "Saudável"}</span></div>
    <dl class="card-details">
      <div><dt>Código</dt><dd class="code-cell">${escapeHtml(product.code ?? "—")}</dd></div>
      <div><dt>Estoque atual</dt><dd class="stock-cell ${low ? "critical" : ""}">${numberFormat.format(product.current_stock)}</dd></div>
      <div><dt>Estoque mínimo</dt><dd>${numberFormat.format(product.minimum_stock)}</dd></div>
      <div><dt>Status</dt><dd>${low ? "Abaixo do mínimo" : "Acima do mínimo"}</dd></div>
    </dl>
    <div class="card-actions">
      <button class="button button-quiet" data-action="entry" data-id="${product.id}">＋ Entrada</button>
      <button class="button button-quiet" data-action="exit" data-id="${product.id}">− Saída</button>
      <button class="button button-quiet" data-action="edit" data-id="${product.id}">Editar</button>
      ${managerActions}
    </div>
  </article>`;
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
  document.querySelector("#movement-operator-name").textContent = state.user?.name || "—";
  document.querySelector("#movement-error").textContent = "";
  movementDialog.showModal();
}

function openUserEdit(user) {
  userEditForm.reset();
  userEditForm.elements.id.value = user.id;
  userEditForm.elements.name.value = user.name;
  userEditForm.elements.cpf.value = user.cpf;
  userEditForm.elements.status.value = user.status;
  document.querySelector("#user-edit-error").textContent = "";
  userDialog.showModal();
}

function formatCpf(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function bindPasswordValidation(input, optional) {
  const validate = () => {
    const emptyAllowed = optional && input.value.length === 0;
    const valid = emptyAllowed || /^[A-Za-z0-9]{6}$/.test(input.value);
    input.setCustomValidity(valid ? "" : PASSWORD_ERROR);
  };
  input.addEventListener("input", validate);
  input.addEventListener("invalid", validate);
  input.form.addEventListener("reset", () => window.setTimeout(validate, 0));
  validate();
}

bindPasswordValidation(document.querySelector('#user-form input[name="password"]'), false);
bindPasswordValidation(document.querySelector('#user-edit-form input[name="password"]'), true);
bindPasswordValidation(document.querySelector('#password-form input[name="newPassword"]'), false);

function showAuthenticatedApp(user) {
  state.user = user;
  document.querySelector("#login-view").hidden = true;
  document.querySelector("#app-shell").hidden = false;
  document.querySelector("#current-user-label").textContent = `${user.name} · ${user.status}`;
  const isManager = user.status === "GERENTE";
  const addProductButton = document.querySelector("#add-product");
  addProductButton.disabled = !isManager;
  addProductButton.title = isManager ? "" : "Apenas gerentes podem cadastrar produtos";
  document.querySelectorAll("[data-role]").forEach(element => {
    element.hidden = element.dataset.role !== user.status;
  });
  document.querySelector(".nav-list").style.setProperty("--nav-columns", isManager ? "4" : "2");
  state.products = JSON.parse(localStorage.getItem("despensa-products") || "[]");
  const allowedPages = isManager ? ["estoque", "movimentacoes", "usuarios", "senha"] : ["estoque", "senha"];
  if (!allowedPages.includes(window.location.hash.slice(1))) window.location.hash = "estoque";
  setPage();
  refreshData();
}

document.querySelector("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#login-error");
  errorElement.textContent = "";
  const data = Object.fromEntries(new FormData(form));
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ cpf: data.cpf.replace(/\D/g, ""), password: data.password })
    });
    state.accessToken = result.accessToken;
    showAuthenticatedApp(result.user);
    form.reset();
  } catch (error) {
    errorElement.textContent = error.message === "Erro 401" ? "CPF ou senha inválidos." : error.message;
  }
});

document.querySelector("#password-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const error = document.querySelector("#password-error");
  error.textContent = "";
  if (data.newPassword !== data.confirmPassword) {
    error.textContent = "A confirmação da senha não confere.";
    return;
  }
  try {
    await api("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword })
    });
    form.reset();
    showLogin("Senha alterada. Entre novamente com a nova senha.");
  } catch (exception) {
    error.textContent = exception.message;
  }
});

document.querySelector("#toggle-password").addEventListener("click", event => {
  const input = document.querySelector('#login-form input[name="password"]');
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  event.currentTarget.textContent = visible ? "Ocultar" : "Mostrar";
  event.currentTarget.setAttribute("aria-label", visible ? "Ocultar senha" : "Mostrar senha");
});

document.querySelector("#logout").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* a sessão em memória também será descartada */ }
  showLogin();
});

function showLogin(message = "") {
  state.accessToken = null;
  state.user = null;
  state.products = [];
  state.movements = [];
  document.querySelector("#app-shell").hidden = true;
  document.querySelector("#login-view").hidden = false;
  document.querySelector("#login-error").textContent = message;
  window.history.replaceState(null, "", window.location.pathname);
}

document.querySelector('#login-form input[name="cpf"]').addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
});
document.querySelector('#user-form input[name="cpf"]').addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
});
document.querySelector('#user-edit-form input[name="cpf"]').addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
});
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

document.querySelector("#products-cards").addEventListener("click", async event => {
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

document.querySelector("#user-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const error = document.querySelector("#user-error");
  error.textContent = "";
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ ...data, cpf: data.cpf.replace(/\D/g, "") })
    });
    form.reset();
    showToast("Usuário cadastrado.");
    await loadUsers();
  } catch (exception) {
    error.textContent = exception.message;
  }
});

document.querySelector("#users-cards").addEventListener("click", async event => {
  const button = event.target.closest("[data-user-action]");
  if (!button) return;
  const user = state.users.find(item => item.id === Number(button.dataset.id));
  if (!user || button.disabled) return;

  if (button.dataset.userAction === "edit") {
    openUserEdit(user);
    return;
  }
  if (button.dataset.userAction !== "delete" ||
      !window.confirm(`Excluir o usuário "${user.name}"? Esta ação não pode ser desfeita.`))
    return;

  try {
    await api(`/api/users/${user.id}`, { method: "DELETE" });
    showToast("Usuário excluído.");
    await loadUsers();
  } catch (error) {
    showToast(`Não foi possível excluir o usuário: ${error.message}`);
  }
});

userEditForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(userEditForm));
  const error = document.querySelector("#user-edit-error");
  error.textContent = "";
  try {
    const updatedUser = await api(`/api/users/${data.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: data.name,
        cpf: data.cpf.replace(/\D/g, ""),
        status: data.status,
        password: data.password
      })
    });
    userDialog.close();
    if (updatedUser.id === state.user.id) {
      showLogin("Cadastro atualizado. Entre novamente com suas novas credenciais.");
      return;
    }
    showToast("Cadastro de usuário atualizado.");
    await loadUsers();
  } catch (exception) {
    error.textContent = exception.message;
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
      if (state.user.status !== "GERENTE") {
        document.querySelector("#product-error").textContent = "É necessário estar conectado para editar produtos.";
        return;
      }
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
  const currentStock = product?.current_stock;
  if (data.type === "exit" && Number(data.quantity) > Number(currentStock)) {
    if (!window.confirm("A saída é maior que o saldo registrado. Deseja continuar?")) return;
  }
  try {
    await api(`/api/products/${data.productId}/movements`, { method: "POST", body: JSON.stringify({ type: data.type, quantity: Number(data.quantity), reason: data.reason }) });
    movementDialog.close();
    showToast("Movimentação registrada.");
    await refreshData();
  } catch (error) {
    if (!isNetworkError(error)) { document.querySelector("#movement-error").textContent = error.message; return; }
    if (state.user.status !== "GERENTE") {
      document.querySelector("#movement-error").textContent = "É necessário estar conectado para registrar movimentações.";
      return;
    }
    const quantity = Number(data.quantity);
    const product = state.products.find(item => item.id === data.productId);
    if (!product) {
      document.querySelector("#movement-error").textContent = "Produto não encontrado no estoque local.";
      return;
    }
    product.current_stock = Number(product.current_stock) + (data.type === "entry" ? quantity : -quantity);
    queueOffline({ kind: "movement", productId: data.productId, payload: { type: data.type, quantity, reason: data.reason } });
    movementDialog.close();
    render();
    showToast("Movimentação salva neste dispositivo e pendente de sincronização.");
  }
});

if ("serviceWorker" in navigator) {
  const alreadyControlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (alreadyControlled) window.location.reload();
  }, { once: true });
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
    .then(registration => registration.update())
    .catch(() => {});
}
window.addEventListener("online", refreshData);