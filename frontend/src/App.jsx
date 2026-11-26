import { useCallback, useEffect, useRef, useState } from "react";
import { api, isNetworkError } from "./api.js";
import Badge from "./components/ui/Badge.jsx";
import Button from "./components/ui/Button.jsx";
import Card from "./components/ui/Card.jsx";
import Input from "./components/ui/Input.jsx";
import useSubmission from "./hooks/useSubmission.js";
import {
  getMovementDateRangeErrors,
  MOVEMENT_DATE_MAX,
  MOVEMENT_DATE_MIN
} from "./utils/movementDateRange.js";
import {
  isValidCpf,
  isValidNumeric12_3,
  isValidPassword,
  isValidProductDescription,
  isValidUnit,
  trimmedLength
} from "./utils/validators.js";

const PASSWORD_ERROR = "A senha deve ter 6 caracteres alfanuméricos";
const EMPTY_PRODUCTS = { status: "loading", data: [], error: null };
const EMPTY_MOVEMENTS = { status: "idle", data: [], error: null };
const EMPTY_USERS = { status: "idle", data: [], error: null };
const pendingKey = userId => `despensa-pending:${userId}`;
const productCacheKey = userId => `despensa-products:${userId}`;
let synchronizationPromise = null;

function preventManualDateEntry(event) {
  if (!["Tab", "Shift", "Escape", "Enter"].includes(event.key)) event.preventDefault();
}

function withSynchronizationLock(action) {
  if (synchronizationPromise) return synchronizationPromise;
  synchronizationPromise = (async () => {
    try {
      if (navigator.locks?.request)
        await navigator.locks.request("despensa-offline-sync", action);
      else
        await action();
    } finally {
      synchronizationPromise = null;
    }
  })();
  return synchronizationPromise;
}

function readProductCache(userId) {
  const cached = localStorage.getItem(productCacheKey(userId));
  if (!cached) return [];
  try {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed)) return parsed;
    throw new Error("O cache local de produtos está em formato inválido.");
  } catch (error) {
    console.error("Não foi possível ler o cache local de produtos.", error);
    return [];
  }
}

function readPending(userId) {
  const pending = localStorage.getItem(pendingKey(userId));
  if (!pending) return [];
  try {
    const parsed = JSON.parse(pending);
    if (Array.isArray(parsed)) return parsed;
    throw new Error("A fila de sincronização está em formato inválido.");
  } catch (error) {
    console.error("Não foi possível ler a fila local de sincronização.", error);
    return [];
  }
}

function savePending(userId, pending) {
  localStorage.setItem(pendingKey(userId), JSON.stringify(pending));
}

function isLow(product) {
  return Number(product.current_stock) <= Number(product.minimum_stock);
}

function formatQuantity(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value) || 0);
}

function formatDate(value, options = { dateStyle: "short", timeStyle: "short" }) {
  return new Intl.DateTimeFormat("pt-BR", options).format(new Date(value));
}

function localDayBoundary(value, nextDay = false) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day + Number(nextDay)).toISOString();
}

function formatCpf(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function Spinner({ small = false }) {
  return <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${small ? "size-4" : "size-5"}`} />;
}

function ActionButton({ children, loading, loadingLabel = "Salvando...", variant = "primary", ...props }) {
  return <Button {...props} type={props.type || "submit"} variant={variant} loading={loading}>{loading ? loadingLabel : children}</Button>;
}

function FormFeedback({ state, onRetry }) {
  if (state.status === "loading")
    return <p className="flex items-center gap-2 text-sm text-[#62685c]" role="status"><Spinner small /> Processando...</p>;
  if (state.status === "error")
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
        <span>{state.error}</span>
        <button className="min-h-10 rounded-md px-2 font-semibold underline underline-offset-2" type="button" onClick={onRetry}>Tentar novamente</button>
      </div>
    );
  if (state.status === "success")
    return <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">{state.success}</p>;
  return null;
}

function ResourceView({ resource, onRetry, emptyTitle, emptyText, children }) {
  const hasData = Array.isArray(resource.data) && resource.data.length > 0;
  if ((resource.status === "loading" || resource.status === "idle") && !hasData)
    return <LoadingState label="Carregando dados..." />;
  if (resource.status === "error")
    return (
      <div className="space-y-4">
        <ErrorState message={resource.error} onRetry={onRetry} />
        {hasData && children(resource.data)}
      </div>
    );
  if (resource.status === "loading")
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 rounded-lg border border-[#e1e4dc] bg-white px-4 py-3 text-sm text-[#62685c]" role="status">
          <Spinner small /> Atualizando dados...
        </p>
        {children(resource.data)}
      </div>
    );
  if (!hasData)
    return <EmptyState title={emptyTitle} text={emptyText} />;
  return children(resource.data);
}

function LoadingState({ label }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-[#e5e7df] bg-white p-6 text-center text-sm text-[#62685c]" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-[#cfd3c5] bg-white/70 p-6 text-center">
      <span className="mb-2 grid size-11 place-items-center rounded-full bg-[#f0f2e7] text-xl text-[#59643a]" aria-hidden="true">⌕</span>
      <h3 className="font-semibold text-[#30352b]">{title}</h3>
      {text && <p className="mt-1 max-w-md text-sm text-[#62685c]">{text}</p>}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900" role="alert">
      <div className="min-w-0">
        <p className="font-semibold">Não foi possível carregar os dados.</p>
        <p className="mt-1 break-words text-sm">{message}</p>
      </div>
      <button className="min-h-11 shrink-0 rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold hover:bg-red-100" type="button" onClick={onRetry}>Tentar novamente</button>
    </div>
  );
}

function Brand({ compact = false }) {
  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight text-[#20251d] ${compact ? "text-lg" : "text-xl"}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-[#59643a] text-base text-white">D</span>
      <span>despensa<span className="text-[#9ba36c]">.</span></span>
    </span>
  );
}

const NAV_ITEMS = [
  { id: "estoque", label: "Estoque", icon: "▦", roles: ["GERENTE", "COLABORADOR"] },
  { id: "movimentacoes", label: "Movimentações", icon: "↕", roles: ["GERENTE"] },
  { id: "usuarios", label: "Usuários", icon: "♙", roles: ["GERENTE"] },
  { id: "senha", label: "Alterar senha", icon: "⌑", roles: ["GERENTE", "COLABORADOR"] }
];

function LoginScreen({ onLogin, notice }) {
  const submission = useSubmission();
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = async event => {
    event.preventDefault();
    if (!isValidCpf(cpf) || !isValidPassword(password)) {
      await submission.run(
        () => { throw new Error(!isValidCpf(cpf) ? "Informe um CPF válido." : PASSWORD_ERROR); },
        ""
      );
      return;
    }
    await submission.run(() => onLogin({ cpf: cpf.replace(/\D/g, ""), password }), "Acesso autorizado.");
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#f2f3ec] px-4 py-8">
      <form className="w-full max-w-md rounded-2xl border border-[#e5e7df] bg-white p-6 shadow-[0_18px_50px_rgba(32,37,29,0.08)] sm:p-9" onSubmit={submit}>
        <Brand />
        <p className="mt-8 text-xs font-bold tracking-[0.18em] text-[#777d70]">ACESSO AO SISTEMA</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#252a21]">Entrar</h1>
        <p className="mt-2 text-sm leading-6 text-[#62685c]">Informe seu CPF e sua senha para continuar.</p>

        {notice && <p className="mt-5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">{notice}</p>}

        <div className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-[#454b3f]">
            CPF
            <Input
              autoComplete="username"
              className="mt-1.5 min-h-12 w-full rounded-lg border border-[#dfe2d7] px-3 text-base outline-none focus:border-[#75804c]"
              disabled={submission.status === "loading"}
              inputMode="numeric"
              maxLength={14}
              onChange={event => setCpf(formatCpf(event.target.value))}
              placeholder="000.000.000-00"
              aria-invalid={cpf.length > 0 && !isValidCpf(cpf)}
              required
              value={cpf}
            />
          </label>
          <label className="block text-sm font-semibold text-[#454b3f]">
            Senha
            <span className="mt-1.5 flex min-h-12 overflow-hidden rounded-lg border border-[#dfe2d7] focus-within:border-[#75804c]">
              <input
                autoComplete="current-password"
                className="min-w-0 flex-1 border-0 px-3 text-base outline-none"
                disabled={submission.status === "loading"}
                maxLength={6}
                onChange={event => setPassword(event.target.value)}
                placeholder="6 caracteres"
                aria-invalid={password.length > 0 && !isValidPassword(password)}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="min-h-11 shrink-0 px-3 text-xs font-semibold text-[#59643a] underline underline-offset-2"
                disabled={submission.status === "loading"}
                onClick={() => setShowPassword(value => !value)}
                type="button"
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </span>
          </label>
        </div>

        <div className="mt-4"><FormFeedback state={submission} onRetry={submission.retry} /></div>
        <ActionButton className="mt-5 w-full" loading={submission.status === "loading"} loadingLabel="Entrando...">Entrar</ActionButton>
      </form>
    </main>
  );
}

function AppLayout({ user, page, connection, onLogout, children }) {
  const navItems = NAV_ITEMS.filter(item => item.roles.includes(user.status));
  const pageTitle = NAV_ITEMS.find(item => item.id === page)?.label || "Estoque";
  const online = connection === "online";

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f2f3ec] text-[#20251d]">
      <aside className="fixed inset-x-0 bottom-0 z-30 border-t border-[#e2e4dc] bg-white px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(32,37,29,0.08)] lg:inset-y-0 lg:left-0 lg:right-auto lg:flex lg:w-60 lg:flex-col lg:border-t-0 lg:border-r lg:px-5 lg:py-7 lg:shadow-none">
        <a className="hidden lg:inline-flex" href="#estoque" aria-label="Despensa, início"><Brand /></a>
        <nav className="mx-auto grid w-full max-w-xl grid-cols-2 gap-2 md:max-w-4xl lg:mt-12 lg:max-w-none lg:grid-cols-1 lg:gap-1" aria-label="Navegação principal">
          {navItems.map(item => (
            <a
              aria-current={page === item.id ? "page" : undefined}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-xs font-semibold leading-tight transition-colors md:min-h-12 md:flex-row md:gap-2 md:text-sm lg:min-h-11 lg:justify-start lg:rounded-lg lg:px-3 ${page === item.id ? "bg-[#f0f2e7] text-[#46512d]" : "text-[#62685c] hover:bg-[#f7f8f3]"}`}
              href={`#${item.id}`}
              key={item.id}
            >
              <span className="shrink-0 text-base leading-none" aria-hidden="true">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="hidden lg:mt-auto lg:block">
          <div className="flex items-center gap-2 border-t border-[#e5e7df] pt-5 text-xs text-[#62685c]">
            <span className={`size-2 rounded-full ${online ? "bg-green-600" : "bg-red-500"}`} aria-hidden="true" />
            {online ? "Supabase conectado" : "Banco indisponível"}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-[#62685c]" title={`${user.name} · ${user.status}`}>{user.name} · {user.status}</span>
            <button className="min-h-10 rounded-md px-2 text-xs font-semibold text-[#59643a] underline underline-offset-2" onClick={onLogout} type="button">Sair</button>
          </div>
        </div>
      </aside>

      <div className="min-h-screen pb-[calc(6rem+env(safe-area-inset-bottom))] lg:ml-60 lg:pb-0">
        <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-[#e2e4dc] bg-[#f2f3ec]/95 px-4 backdrop-blur sm:px-6 lg:hidden">
          <Brand compact />
          <div className="flex min-w-0 items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${online ? "bg-green-600" : "bg-red-500"}`} aria-label={online ? "Conectado" : "Desconectado"} />
            <button className="min-h-10 shrink-0 rounded-md px-2 text-sm font-semibold text-[#59643a] underline underline-offset-2" onClick={onLogout} type="button">Sair</button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 pt-4 sm:px-6 sm:pt-6 lg:px-10 lg:pt-0">
          <div className="hidden min-h-16 items-center justify-between border-b border-[#e2e4dc] text-xs text-[#62685c] lg:flex">
            <p>Operação <span className="mx-2 text-[#a2a698]">/</span><strong className="font-semibold text-[#454b3f]">{pageTitle}</strong></p>
            <p>{new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }).format(new Date())}</p>
          </div>
          <div className="flex min-h-10 items-center justify-between gap-3 lg:hidden">
            <h1 className="truncate text-lg font-bold text-[#252a21]">{pageTitle}</h1>
            <span className="text-right text-xs text-[#62685c]">{online ? "Conectado" : "Offline"}</span>
          </div>
          <div className="py-4 sm:py-7">{children}</div>
        </main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-[0.16em] text-[#777d70]">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#252a21] sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-[#62685c]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Metric({ label, value, note, tone }) {
  const color = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : "text-[#59643a]";
  return (
    <Card>
      <p className="break-words text-xs font-semibold text-[#62685c] sm:text-sm">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      <p className="mt-1 break-words text-xs text-[#777d70]">{note}</p>
    </Card>
  );
}

function SearchBox({ value, onChange, label = "Buscar produto ou código" }) {
  return (
    <label className="flex min-h-11 min-w-0 w-full max-w-md items-center gap-2 rounded-lg border border-[#dfe2d7] bg-white px-3 text-[#62685c] focus-within:border-[#75804c]">
      <span className="text-lg" aria-hidden="true">⌕</span>
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        className="min-w-0 flex-1 border-0 bg-transparent text-base text-[#20251d] outline-none placeholder:text-[#8b9084]"
        onChange={event => onChange(event.target.value)}
        placeholder="Produto ou código"
        type="search"
        value={value}
      />
    </label>
  );
}

function InventoryPage({ resource, onRetry, onRefresh, user, onCreateProduct, onEditProduct, onDeleteProduct, onMovement, showInactive, onToggleInactive }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [deletingProductId, setDeletingProductId] = useState(null);
  const products = resource.data;
  const lowCount = products.filter(isLow).length;
  const filtered = products.filter(product => {
    const matchesText = `${product.name} ${product.code ?? ""}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"));
    return matchesText && (filter === "all" || isLow(product));
  });
  const managers = user.status === "GERENTE";
  const deleteProduct = async product => {
    if (deletingProductId) return;
    setDeletingProductId(product.id);
    try {
      await onDeleteProduct(product);
    } finally {
      setDeletingProductId(null);
    }
  };

  return (
    <>
      <PageHeading
        action={(
          <Button
            className="gap-2"
            disabled={!managers}
            onClick={onCreateProduct}
            title={managers ? "" : "Apenas gerentes podem cadastrar produtos"}
            type="button"
          >
            <span aria-hidden="true">＋</span> Novo produto
          </Button>
        )}
        description="Acompanhe seus insumos e mantenha a operação em dia."
        eyebrow="VISÃO GERAL"
        title="Estoque"
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Resumo do estoque">
        <Metric label="Itens cadastrados" value={products.length} note="produtos no catálogo" tone="olive" />
        <Metric label="Estoque saudável" value={products.length - lowCount} note="acima do mínimo" tone="green" />
        <Metric label="Abaixo do mínimo" value={lowCount} note="precisam de atenção" tone="red" />
      </section>

      <section className="mt-7 border-t border-[#dfe2d7] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#282d24]">Seus produtos</h2>
            <p className="mt-1 text-sm text-[#62685c]">Saldo atualizado em tempo real.</p>
          </div>
          <button className="grid size-11 shrink-0 place-items-center rounded-lg border border-[#e1e4dc] bg-white text-xl text-[#59643a] hover:bg-[#f7f8f3]" onClick={onRefresh} title="Atualizar estoque" aria-label="Atualizar estoque" type="button">↻</button>
          {user.status === "GERENTE" && <label className="flex items-center gap-2 text-sm"><input checked={showInactive} onChange={event => onToggleInactive(event.target.checked)} type="checkbox" /> Mostrar inativos</label>}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <SearchBox value={query} onChange={setQuery} />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar produtos">
            <button className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${filter === "all" ? "border-[#cfd3c5] bg-white text-[#454b3f]" : "border-transparent text-[#62685c] hover:bg-white"}`} onClick={() => setFilter("all")} type="button">
              Todos <span className="ml-1 rounded-full bg-[#eff0eb] px-1.5 py-0.5 text-xs">{products.length}</span>
            </button>
            <button className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${filter === "low" ? "border-[#cfd3c5] bg-white text-[#454b3f]" : "border-transparent text-[#62685c] hover:bg-white"}`} onClick={() => setFilter("low")} type="button">
              Abaixo do mínimo <span className="ml-1 rounded-full bg-[#eff0eb] px-1.5 py-0.5 text-xs">{lowCount}</span>
            </button>
          </div>
        </div>

        <div className="mt-4">
          <ResourceView resource={resource} onRetry={onRetry} emptyTitle="Seu catálogo ainda está vazio." emptyText="Cadastre um produto para começar a controlar o estoque.">
            {data => filtered.length ? (
              <>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map(product => (
                    <ProductCard
                      key={product.id}
                      manager={managers}
                      onDelete={() => void deleteProduct(product)}
                      deleting={deletingProductId === product.id}
                      onEdit={() => onEditProduct(product)}
                      onMovement={onMovement}
                      product={product}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-[#777d70]">
                  <span>{filtered.length} {filtered.length === 1 ? "produto" : "produtos"}</span>
                  <span>Dados sincronizados com Supabase</span>
                </div>
              </>
            ) : (
              <EmptyState title="Nenhum produto encontrado." text="Altere a busca ou os filtros e tente novamente." />
            )}
          </ResourceView>
        </div>
      </section>
    </>
  );
}

function ProductCard({ product, manager, onMovement, onEdit, onDelete, deleting }) {
  const low = isLow(product);
  return (
    <Card className="sm:p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#f0f1e8] font-bold text-[#59643a]">{product.name.trim().slice(0, 1).toLocaleUpperCase("pt-BR")}</span>
          <h3 className="min-w-0 break-words font-semibold text-[#30352b]">{product.name}</h3>
        </div>
        <Badge variant={product.is_active === false ? "muted" : low ? "danger" : "success"}>{product.is_active === false ? "Inativo" : low ? "Repor estoque" : "Saudável"}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="min-w-0"><dt className="text-xs text-[#777d70]">Código</dt><dd className="mt-0.5 break-all font-mono text-[#62685c]">{product.code ?? "—"}</dd></div>
        <div><dt className="text-xs text-[#777d70]">Estoque atual</dt><dd className={`mt-0.5 font-bold ${low ? "text-red-700" : "text-[#3e4438]"}`}>{formatQuantity(product.current_stock)} {product.unit || "un"}</dd></div>
        <div><dt className="text-xs text-[#777d70]">Estoque mínimo</dt><dd className="mt-0.5 text-[#454b3f]">{formatQuantity(product.minimum_stock)} {product.unit || "un"}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-[#777d70]">Status</dt><dd className="mt-0.5 break-words text-[#454b3f]">{low ? "Abaixo do mínimo" : "Acima do mínimo"}</dd></div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#f0f1ec] pt-3">
        {product.is_active !== false && <button className="min-h-10 flex-1 rounded-lg border border-[#dfe2d7] px-2 text-sm font-semibold text-[#46512d] hover:bg-[#f7f8f3]" onClick={() => onMovement(product, "entry")} type="button">＋ Entrada</button>}
        {product.is_active !== false && <button className="min-h-10 flex-1 rounded-lg border border-[#dfe2d7] px-2 text-sm font-semibold text-[#46512d] hover:bg-[#f7f8f3]" onClick={() => onMovement(product, "exit")} type="button">− Saída</button>}
        {manager && <button className="min-h-10 rounded-lg border border-[#dfe2d7] px-3 text-sm font-semibold text-[#454b3f] hover:bg-[#f7f8f3]" onClick={onEdit} type="button">Editar</button>}
        {manager && <button className="min-h-10 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={deleting} onClick={onDelete} type="button">{deleting ? "Excluindo..." : "Excluir"}</button>}
      </div>
    </Card>
  );
}

function MovementPage({ resource, onRetry, onSearch, manager, onEdit, onDelete }) {
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [touchedDateFields, setTouchedDateFields] = useState({});
  const [hasSubmittedSearch, setHasSubmittedSearch] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const requiredDateFields = hasSubmittedSearch
    ? ["startDate", "endDate"]
    : Object.keys(touchedDateFields).filter(field => touchedDateFields[field]);
  const dateErrors = getMovementDateRangeErrors(dateRange, requiredDateFields);
  const updateDateRange = (field, value) => {
    const updatedDateRange = { ...dateRange, [field]: value };
    setDateRange(updatedDateRange);
  };
  const touchDateField = field => {
    setTouchedDateFields(current => ({ ...current, [field]: true }));
  };
  const search = event => {
    event.preventDefault();
    const errors = getMovementDateRangeErrors(dateRange, ["startDate", "endDate"]);
    setHasSubmittedSearch(true);
    setTouchedDateFields({ startDate: true, endDate: true });
    if (Object.keys(errors).length) return;
    onSearch(dateRange);
  };
  const clearSearch = () => {
    setDateRange({ startDate: "", endDate: "" });
    setTouchedDateFields({});
    setHasSubmittedSearch(false);
    onSearch({ startDate: "", endDate: "" });
  };
  const deleteMovement = async movement => {
    if (deletingId) return;
    if (!window.confirm(`Excluir a movimentação de ${movement.productName}? O saldo do estoque também será ajustado.`)) return;
    setDeletingId(movement.id);
    try {
      await onDelete(movement);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <PageHeading description="Registros ordenados do mais recente para o mais antigo." eyebrow="CONSULTA" title="Movimentações" />
      <section className="border-t border-[#dfe2d7] pt-5">
        <form className="mb-5 rounded-xl border border-[#e5e7df] bg-white p-4" noValidate onSubmit={search}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
            <div className="min-w-0 text-sm font-semibold text-[#454b3f]">
              <label className="block" htmlFor="movement-start-date">Data de Início</label>
              <input
                className={`${inputClass} mt-1.5`}
                max={dateRange.endDate && dateRange.endDate < MOVEMENT_DATE_MAX ? dateRange.endDate : MOVEMENT_DATE_MAX}
                aria-describedby={touchedDateFields.startDate || hasSubmittedSearch ? (dateErrors.startDate ? "movement-start-date-error" : undefined) : undefined}
                aria-invalid={Boolean((touchedDateFields.startDate || hasSubmittedSearch) && dateErrors.startDate)}
                id="movement-start-date"
                min={MOVEMENT_DATE_MIN}
                onChange={event => updateDateRange("startDate", event.target.value)}
                onBeforeInput={event => event.preventDefault()}
                onBlur={() => touchDateField("startDate")}
                onDrop={event => event.preventDefault()}
                onKeyDown={preventManualDateEntry}
                onPaste={event => event.preventDefault()}
                required
                type="date"
                value={dateRange.startDate}
              />
              {(touchedDateFields.startDate || hasSubmittedSearch) && dateErrors.startDate && <p className="mt-1 text-sm font-normal text-red-700" id="movement-start-date-error" role="alert">{dateErrors.startDate}</p>}
            </div>
            <div className="min-w-0 text-sm font-semibold text-[#454b3f]">
              <label className="block" htmlFor="movement-end-date">Data de Término</label>
              <input
                className={`${inputClass} mt-1.5`}
                max={MOVEMENT_DATE_MAX}
                aria-describedby={touchedDateFields.endDate || hasSubmittedSearch ? (dateErrors.endDate ? "movement-end-date-error" : undefined) : undefined}
                aria-invalid={Boolean((touchedDateFields.endDate || hasSubmittedSearch) && dateErrors.endDate)}
                id="movement-end-date"
                min={dateRange.startDate && dateRange.startDate > MOVEMENT_DATE_MIN ? dateRange.startDate : MOVEMENT_DATE_MIN}
                onChange={event => updateDateRange("endDate", event.target.value)}
                onBeforeInput={event => event.preventDefault()}
                onBlur={() => touchDateField("endDate")}
                onDrop={event => event.preventDefault()}
                onKeyDown={preventManualDateEntry}
                onPaste={event => event.preventDefault()}
                required
                type="date"
                value={dateRange.endDate}
              />
              {(touchedDateFields.endDate || hasSubmittedSearch) && dateErrors.endDate && <p className="mt-1 text-sm font-normal text-red-700" id="movement-end-date-error" role="alert">{dateErrors.endDate}</p>}
            </div>
            <Button className="w-full lg:w-auto" type="submit">Pesquisar</Button>
            <Button className="w-full lg:w-auto" onClick={clearSearch} type="button" variant="secondary">Limpar</Button>
          </div>
        </form>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-[#282d24]">Histórico de movimentações</h2>
            <p className="mt-1 text-sm text-[#62685c]">Entradas e saídas registradas no estoque.</p>
          </div>
          <span className="text-xs text-[#777d70]">Hoje, {formatDate(new Date(), { dateStyle: "short" })}</span>
        </div>
        <ResourceView resource={resource} onRetry={onRetry} emptyTitle="Nenhuma movimentação registrada." emptyText="Os registros aparecerão aqui após uma entrada ou saída.">
          {movements => (
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[...movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(movement => {
                const entry = movement.type === "entry";
                return (
                  <article className="min-w-0 rounded-xl border border-[#e5e7df] bg-white p-4 shadow-sm" key={movement.id}>
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f0f1e8] text-[#59643a]">{movement.productName.trim().slice(0, 1).toLocaleUpperCase("pt-BR")}</span>
                        <h3 className="min-w-0 break-words font-semibold text-[#30352b]">{movement.productName}</h3>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${entry ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{entry ? "Entrada" : "Saída"}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <Detail label="Quantidade"><span className={`font-bold ${entry ? "text-green-700" : "text-red-700"}`}>{entry ? "+" : "−"}{formatQuantity(movement.quantity)} {movement.productUnit || "un"}</span></Detail>
                      <Detail label="Data">{formatDate(movement.createdAt)}</Detail>
                      <Detail label="Saldo após movimento">{formatQuantity(movement.balanceAfter)}</Detail>
                      <Detail label="Motivo">{movement.reason || "—"}</Detail>
                      <Detail label="Operador">{movement.operatorName || "—"}</Detail>
                    </dl>
                    {manager && (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#f0f1ec] pt-3">
                        <Button className="flex-1" disabled={deletingId !== null} onClick={() => onEdit(movement)} type="button" variant="secondary">Editar Movimentação</Button>
                        <Button
                          className="flex-1"
                          disabled={deletingId !== null}
                          onClick={() => void deleteMovement(movement)}
                          type="button"
                          variant="danger"
                        >
                          {deletingId === movement.id ? "Excluindo..." : "Excluir Movimentação"}
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </ResourceView>
      </section>
    </>
  );
}

function Detail({ label, children }) {
  return <div className="min-w-0"><dt className="text-xs text-[#777d70]">{label}</dt><dd className="mt-0.5 break-words text-[#454b3f]">{children}</dd></div>;
}

function UsersPage({ resource, onRetry, onCreate, onEdit, onDelete, onReactivate, currentUserId, showInactive, onToggleInactive }) {
  const [form, setForm] = useState({ name: "", cpf: "", status: "COLABORADOR", password: "" });
  const [deletingUserId, setDeletingUserId] = useState(null);
  const submission = useSubmission();
  const deleteUser = async user => {
    if (deletingUserId) return;
    setDeletingUserId(user.id);
    try {
      await onDelete(user);
    } finally {
      setDeletingUserId(null);
    }
  };

  const submit = async event => {
    event.preventDefault();
    const error = trimmedLength(form.name) < 3 || trimmedLength(form.name) > 150
      ? "O nome deve ter entre 3 e 150 caracteres, desconsiderando espaços externos."
      : !isValidCpf(form.cpf) ? "Informe um CPF válido."
        : !isValidPassword(form.password) ? PASSWORD_ERROR : "";
    if (error) {
      await submission.run(() => { throw new Error(error); }, "");
      return;
    }
    await submission.run(
      () => onCreate({ ...form, cpf: form.cpf.replace(/\D/g, "") }),
      "Usuário cadastrado.",
      () => setForm({ name: "", cpf: "", status: "COLABORADOR", password: "" })
    );
  };

  return (
    <>
      <PageHeading description="Cadastre gerentes e colaboradores do estoque." eyebrow="ACESSOS" title="Usuários" />
      <section className="border-t border-[#dfe2d7] pt-5">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-[#282d24]">Novo usuário</h2>
          <p className="mt-1 text-sm text-[#62685c]">CPF válido e senha alfanumérica de 6 caracteres.</p>
        </div>
        <form className="grid max-w-3xl grid-cols-1 gap-4 rounded-xl border border-[#e5e7df] bg-white p-4 shadow-sm sm:grid-cols-2 sm:p-5" onSubmit={submit}>
          <Field label="Nome"><input autoComplete="name" className={inputClass} disabled={submission.status === "loading"} maxLength={150} minLength={3} onChange={event => { setForm({ ...form, name: event.target.value }); submission.clear(); }} required value={form.name} /></Field>
          <Field label="CPF"><input autoComplete="off" className={inputClass} disabled={submission.status === "loading"} inputMode="numeric" maxLength={14} onChange={event => { setForm({ ...form, cpf: formatCpf(event.target.value) }); submission.clear(); }} placeholder="000.000.000-00" required value={form.cpf} /></Field>
          <Field label="Status">
            <select className={inputClass} disabled={submission.status === "loading"} onChange={event => { setForm({ ...form, status: event.target.value }); submission.clear(); }} value={form.status}>
              <option value="GERENTE">Gerente</option><option value="COLABORADOR">Colaborador</option>
            </select>
          </Field>
          <Field label="Senha"><PasswordInput autoComplete="new-password" className={inputClass} disabled={submission.status === "loading"} onChange={event => { setForm({ ...form, password: event.target.value }); submission.clear(); }} required value={form.password} /></Field>
          <div className="space-y-3 sm:col-span-2">
            <FormFeedback state={submission} onRetry={submission.retry} />
            <ActionButton loading={submission.status === "loading"} loadingLabel="Cadastrando...">Cadastrar usuário</ActionButton>
          </div>
        </form>
      </section>

      <section className="mt-8 border-t border-[#dfe2d7] pt-5">
        <h2 className="text-lg font-bold text-[#282d24]">Usuários cadastrados</h2>
        <label className="mt-2 flex items-center gap-2 text-sm"><input checked={showInactive} onChange={event => onToggleInactive(event.target.checked)} type="checkbox" /> Mostrar inativos</label>
        <div className="mt-4">
          <ResourceView resource={resource} onRetry={onRetry} emptyTitle="Nenhum usuário cadastrado." emptyText="Cadastre o primeiro usuário usando o formulário acima.">
            {users => (
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {users.map(user => (
                  <article className="min-w-0 rounded-xl border border-[#e5e7df] bg-white p-4 shadow-sm" key={user.id}>
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#f0f1e8] font-bold text-[#59643a]">{user.name.trim().slice(0, 1).toLocaleUpperCase("pt-BR")}</span>
                        <h3 className="min-w-0 break-words font-semibold text-[#30352b]">{user.name}</h3>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${!user.isActive ? "bg-gray-100 text-gray-700" : user.status === "GERENTE" ? "bg-green-50 text-green-700" : "bg-[#f0f2e7] text-[#59643a]"}`}>{!user.isActive ? "Inativo" : user.status === "GERENTE" ? "Gerente" : "Colaborador"}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <Detail label="ID">{user.id}</Detail>
                      <Detail label="CPF">{user.cpf}</Detail>
                      <Detail label="Data de cadastro">{formatDate(`${user.createdAt}T00:00:00Z`, { dateStyle: "short", timeZone: "UTC" })}</Detail>
                      <Detail label="Perfil">{user.status}</Detail>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-[#f0f1ec] pt-3">
                      <button className="min-h-10 rounded-lg border border-[#dfe2d7] px-4 text-sm font-semibold hover:bg-[#f7f8f3]" onClick={() => onEdit(user)} type="button">Editar</button>
                      {!user.isActive && <button className="min-h-10 rounded-lg border border-green-200 px-4 text-sm font-semibold text-green-800 hover:bg-green-50" onClick={() => onReactivate(user)} type="button">Reativar</button>}
                      <button className="min-h-10 rounded-lg px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={user.id === currentUserId || deletingUserId !== null} onClick={() => void deleteUser(user)} title={user.id === currentUserId ? "Não é possível excluir sua própria conta" : ""} type="button">{deletingUserId === user.id ? "Excluindo..." : "Excluir"}</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </ResourceView>
        </div>
      </section>
    </>
  );
}

function PasswordPage({ onChangePassword, onLoadUser }) {
  const submission = useSubmission();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [userResource, setUserResource] = useState({ status: "loading", user: null, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    onLoadUser(controller.signal).then(user => {
      if (!controller.signal.aborted) setUserResource({ status: "success", user, error: "" });
    }).catch(error => {
      if (!controller.signal.aborted && error.name !== "AbortError")
        setUserResource({ status: "error", user: null, error: error.message });
    });
    return () => controller.abort();
  }, [onLoadUser]);

  const submit = async event => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      await submission.run(() => { throw new Error("A confirmação da senha não confere."); }, "");
      return;
    }
    if (!isValidPassword(form.newPassword) || form.newPassword === form.currentPassword) {
      await submission.run(
        () => { throw new Error(form.newPassword === form.currentPassword
          ? "A nova senha deve ser diferente da senha atual."
          : PASSWORD_ERROR); },
        ""
      );
      return;
    }
    await submission.run(
      () => onChangePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      "Senha alterada."
    );
  };

  return (
    <>
      <PageHeading description="Atualize a senha da sua conta." eyebrow="SEGURANÇA" title="Alterar senha" />
      <section className="border-t border-[#dfe2d7] pt-5">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-[#282d24]">Nova senha</h2>
          <p className="mt-1 text-sm text-[#62685c]">Use 6 caracteres alfanuméricos.</p>
        </div>
        {userResource.status === "loading" && <p role="status">Carregando conta...</p>}
        {userResource.status === "error" && <p role="alert" className="mb-3 text-sm text-red-800">{userResource.error}</p>}
        {userResource.status === "success" && <p className="mb-3 text-sm text-[#62685c]">Conta: {userResource.user.name}</p>}
        <form className="grid max-w-lg grid-cols-1 gap-4 rounded-xl border border-[#e5e7df] bg-white p-4 shadow-sm sm:p-5" onSubmit={submit}>
          <Field label="Senha atual"><input autoComplete="current-password" className={inputClass} disabled={submission.status === "loading"} name="currentPassword" onChange={event => { setForm({ ...form, currentPassword: event.target.value }); submission.clear(); }} required type="password" value={form.currentPassword} /></Field>
          <Field label="Nova senha"><PasswordInput autoComplete="new-password" className={inputClass} disabled={submission.status === "loading"} onChange={event => { setForm(current => ({ ...current, newPassword: event.target.value })); submission.clear(); }} required value={form.newPassword} /></Field>
          <Field label="Confirmar nova senha"><input autoComplete="new-password" className={inputClass} disabled={submission.status === "loading"} name="confirmPassword" onChange={event => { setForm({ ...form, confirmPassword: event.target.value }); event.currentTarget.setCustomValidity(""); submission.clear(); }} required type="password" value={form.confirmPassword} /></Field>
          <FormFeedback state={submission} onRetry={submission.retry} />
          <ActionButton loading={submission.status === "loading"} loadingLabel="Alterando senha...">Alterar senha</ActionButton>
        </form>
      </section>
    </>
  );
}

function Field({ label, children }) {
  return <label className="block min-w-0 text-sm font-semibold text-[#454b3f]">{label}<span className="mt-1.5 block">{children}</span></label>;
}

const inputClass = "min-h-11 w-full min-w-0 rounded-lg border border-[#dfe2d7] bg-white px-3 text-base font-normal text-[#20251d] outline-none focus:border-[#75804c]";

function PasswordInput({ className = inputClass, onChange, ...props }) {
  const validate = event => {
    const input = event.currentTarget;
    const valid = isValidPassword(input.value);
    input.setCustomValidity(input.value && !valid ? PASSWORD_ERROR : "");
    if (onChange) onChange(event);
  };
  return <input {...props} className={className} onChange={validate} onInvalid={validate} pattern="[A-Za-z0-9]{6}" type="password" />;
}

function Modal({ title, description, onClose, children }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )];
    focusable()[0]?.focus();
    const keepFocusInside = event => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", keepFocusInside);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1d241e]/55 p-3 sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} aria-labelledby="modal-title" aria-modal="true" className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6" role="dialog" tabIndex={-1}>
        <header className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.16em] text-[#777d70]">DESPENSA</p>
            <h2 className="mt-1 text-xl font-bold text-[#252a21]" id="modal-title">{title}</h2>
            {description && <p className="mt-1 text-sm text-[#62685c]">{description}</p>}
          </div>
          <button className="grid size-11 shrink-0 place-items-center rounded-lg bg-[#f1f2ed] text-xl text-[#62685c] hover:bg-[#e6e8df]" onClick={onClose} type="button" aria-label="Fechar">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ProductDialog({ product, onSave, onClose }) {
  const submission = useSubmission();
  const [form, setForm] = useState({
    name: product?.name || "",
    unit: product?.unit || "un",
    minimumStock: product?.minimum_stock ?? "0",
    initialStock: "0",
    isActive: product?.is_active ?? true
  });
  const editing = Boolean(product);

  const submit = async event => {
    event.preventDefault();
    const error = !isValidProductDescription(form.name)
      ? "A descrição deve ter entre 3 e 250 caracteres."
      : !isValidUnit(form.unit)
        ? "A unidade de medida deve ter entre 1 e 10 caracteres."
        : !isValidNumeric12_3(form.minimumStock)
          ? "O estoque mínimo deve ser maior ou igual a zero, com até 3 casas decimais."
          : !editing && !isValidNumeric12_3(form.initialStock)
            ? "O estoque inicial deve ser maior ou igual a zero, com até 3 casas decimais."
            : "";
    if (error) {
      await submission.run(() => { throw new Error(error); }, "");
      return;
    }
    await submission.run(
      () => onSave({ ...form, id: product?.id }),
      editing ? "Produto atualizado." : "Produto cadastrado.",
      onClose
    );
  };

  return (
    <Modal title={editing ? "Editar produto" : "Novo produto"} description="Preencha os dados do produto." onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Descrição"><input className={inputClass} disabled={submission.status === "loading"} onChange={event => { setForm({ ...form, name: event.target.value }); submission.clear(); }} required value={form.name} /></Field>
        <Field label="Unidade de medida"><input className={inputClass} disabled={submission.status === "loading"} onChange={event => { setForm({ ...form, unit: event.target.value }); submission.clear(); }} required value={form.unit} /></Field>
        <Field label="Estoque mínimo"><input className={inputClass} disabled={submission.status === "loading"} min="0" onChange={event => { setForm({ ...form, minimumStock: event.target.value }); submission.clear(); }} required step="0.001" type="number" value={form.minimumStock} /></Field>
        {editing && <label className="flex items-center gap-2 text-sm font-medium"><input checked={form.isActive} disabled={submission.status === "loading"} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} type="checkbox" /> Produto ativo</label>}
        {!editing && <Field label="Estoque inicial"><input className={inputClass} disabled={submission.status === "loading"} min="0" onChange={event => { setForm({ ...form, initialStock: event.target.value }); submission.clear(); }} required step="0.001" type="number" value={form.initialStock} /></Field>}
        <FormFeedback state={submission} onRetry={submission.retry} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <ActionButton onClick={onClose} type="button" variant="secondary">Cancelar</ActionButton>
          <ActionButton loading={submission.status === "loading"} loadingLabel="Salvando...">Salvar produto</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function MovementDialog({ product, type, user, onSave, onClose }) {
  const submission = useSubmission();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const entry = type === "entry";
  const submit = async event => {
    event.preventDefault();
    if (!isValidNumeric12_3(quantity, false)) {
      await submission.run(() => { throw new Error("A quantidade deve ser maior que zero e ter até 3 casas decimais."); }, "");
      return;
    }
    if (!entry && Number(quantity) > Number(product.current_stock)) {
      await submission.run(() => { throw new Error("A saída não pode ser maior que o saldo disponível."); }, "");
      return;
    }
    await submission.run(
      () => onSave({ product, type, quantity: Number(quantity), reason }),
      "Movimentação registrada.",
      onClose
    );
  };

  return (
    <Modal title={entry ? "Registrar entrada" : "Registrar saída"} description="Atualização de saldo" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="rounded-lg bg-[#f7f8f3] px-3 py-2 text-sm text-[#62685c]">{product.name} · saldo atual {formatQuantity(product.current_stock)}</p>
        <p className="flex items-center justify-between gap-3 text-sm text-[#777d70]"><span>Operador</span><strong className="break-words text-right font-semibold text-[#30352b]">{user.name}</strong></p>
        <Field label="Quantidade"><input className={inputClass} disabled={submission.status === "loading"} min="0.001" onChange={event => { setQuantity(event.target.value); submission.clear(); }} placeholder="0,00" required step="0.001" type="number" value={quantity} /></Field>
        <Field label="Motivo"><input className={inputClass} disabled={submission.status === "loading"} maxLength={250} onChange={event => { setReason(event.target.value); submission.clear(); }} placeholder="Ex.: compra, consumo, perda" value={reason} /></Field>
        <FormFeedback state={submission} onRetry={submission.retry} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <ActionButton onClick={onClose} type="button" variant="secondary">Cancelar</ActionButton>
          <ActionButton loading={submission.status === "loading"} loadingLabel="Registrando...">Confirmar</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function EditMovementDialog({ movement, onSave, onClose }) {
  const submission = useSubmission();
  const [type, setType] = useState(movement.type);
  const [quantity, setQuantity] = useState(String(movement.quantity));
  const [reason, setReason] = useState(movement.reason || "");

  const submit = async event => {
    event.preventDefault();
    if (!isValidNumeric12_3(quantity, false)) {
      await submission.run(() => { throw new Error("A quantidade deve ser maior que zero e ter até 3 casas decimais."); }, "");
      return;
    }
    await submission.run(
      () => onSave({ id: movement.id, type, quantity: Number(quantity), reason }),
      "Movimentação atualizada.",
      onClose
    );
  };

  return (
    <Modal title="Editar movimentação" description="Atualize os dados da entrada ou saída." onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="rounded-lg bg-[#f7f8f3] px-3 py-2 text-sm text-[#62685c]">{movement.productName} · {formatDate(movement.createdAt)}</p>
        <Field label="Tipo">
          <select
            className={inputClass}
            disabled={submission.status === "loading"}
            onChange={event => { setType(event.target.value); submission.clear(); }}
            value={type}
          >
            <option value="entry">Entrada</option>
            <option value="exit">Saída</option>
          </select>
        </Field>
        <Field label="Quantidade">
          <input
            className={inputClass}
            disabled={submission.status === "loading"}
            min="0.001"
            onChange={event => { setQuantity(event.target.value); submission.clear(); }}
            required
            step="0.001"
            type="number"
            value={quantity}
          />
        </Field>
        <Field label="Motivo">
          <input
            className={inputClass}
            disabled={submission.status === "loading"}
            maxLength={250}
            onChange={event => { setReason(event.target.value); submission.clear(); }}
            value={reason}
          />
        </Field>
        <FormFeedback state={submission} onRetry={submission.retry} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <ActionButton onClick={onClose} type="button" variant="secondary">Cancelar</ActionButton>
          <ActionButton loading={submission.status === "loading"} loadingLabel="Salvando...">Salvar alterações</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function UserEditDialog({ user, onSave, onClose }) {
  const submission = useSubmission();
  const [form, setForm] = useState({ name: user.name, cpf: user.cpf, status: user.status, password: "", isActive: user.isActive });
  const submit = async event => {
    event.preventDefault();
    const error = trimmedLength(form.name) < 3 || trimmedLength(form.name) > 150
      ? "O nome deve ter entre 3 e 150 caracteres."
      : !isValidCpf(form.cpf) ? "Informe um CPF válido."
        : form.password && !isValidPassword(form.password) ? PASSWORD_ERROR : "";
    if (error) {
      await submission.run(() => { throw new Error(error); }, "");
      return;
    }
    await submission.run(
      () => onSave({ ...form, cpf: form.cpf.replace(/\D/g, ""), id: user.id }),
      "Cadastro de usuário atualizado.",
      onClose
    );
  };

  return (
    <Modal title="Editar usuário" description="Atualize os dados da conta." onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Nome"><input autoComplete="name" className={inputClass} disabled={submission.status === "loading"} maxLength={150} minLength={3} onChange={event => { setForm({ ...form, name: event.target.value }); submission.clear(); }} required value={form.name} /></Field>
        <Field label="CPF"><input className={inputClass} disabled={submission.status === "loading"} inputMode="numeric" maxLength={14} onChange={event => { setForm({ ...form, cpf: formatCpf(event.target.value) }); submission.clear(); }} required value={form.cpf} /></Field>
        <Field label="Status">
          <select className={inputClass} disabled={submission.status === "loading"} onChange={event => { setForm({ ...form, status: event.target.value }); submission.clear(); }} value={form.status}>
            <option value="GERENTE">Gerente</option><option value="COLABORADOR">Colaborador</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium"><input checked={form.isActive} disabled={submission.status === "loading"} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} type="checkbox" /> Usuário ativo</label>
        <Field label="Nova senha (opcional)"><PasswordInput autoComplete="new-password" className={inputClass} disabled={submission.status === "loading"} onChange={event => { setForm({ ...form, password: event.target.value }); submission.clear(); }} placeholder="Deixe vazio para manter a senha" value={form.password} /></Field>
        <FormFeedback state={submission} onRetry={submission.retry} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <ActionButton onClick={onClose} type="button" variant="secondary">Cancelar</ActionButton>
          <ActionButton loading={submission.status === "loading"} loadingLabel="Salvando...">Salvar alterações</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast || toast.type === "error") return undefined;
    const timer = window.setTimeout(onClose, 3500);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);
  if (!toast) return null;
  const style = toast.type === "error" ? "border-red-300 bg-red-50 text-red-900"
    : toast.type === "warning" ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-green-300 bg-green-50 text-green-900";
  return <div className={`fixed right-4 top-4 z-[60] flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg sm:right-6 ${style}`} role={toast.type === "error" ? "alert" : "status"}><span className="break-words">{toast.message}</span>{toast.onRetry && <button className="shrink-0 font-semibold underline underline-offset-2" onClick={toast.onRetry} type="button">Tentar novamente</button>}<button aria-label="Fechar aviso" className="shrink-0 font-bold" onClick={onClose} type="button">×</button></div>;
}

export default function App() {
  const [auth, setAuth] = useState({ token: null, user: null });
  const [page, setPage] = useState(() => window.location.hash.slice(1) || "estoque");
  const [products, setProducts] = useState(EMPTY_PRODUCTS);
  const [movements, setMovements] = useState(EMPTY_MOVEMENTS);
  const [movementFilters, setMovementFilters] = useState({ startDate: "", endDate: "" });
  const [users, setUsers] = useState(EMPTY_USERS);
  const [showInactiveProducts, setShowInactiveProducts] = useState(false);
  const [showInactiveUsers, setShowInactiveUsers] = useState(false);
  const [connection, setConnection] = useState("offline");
  const [dialog, setDialog] = useState(null);
  const dialogRequestRef = useRef(null);
  const resourceRequestsRef = useRef(new Map());
  const [toast, setToast] = useState(null);
  const [loginNotice, setLoginNotice] = useState("");

  const notify = useCallback((message, type = "success", onRetry) => setToast({ message, type, onRetry, id: Date.now() }), []);
  const closeDialog = () => {
    dialogRequestRef.current?.abort();
    dialogRequestRef.current = null;
    setDialog(null);
  };
  const createResourceRequest = useCallback((key, parentSignal) => {
    resourceRequestsRef.current.get(key)?.abort();
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    resourceRequestsRef.current.set(key, controller);
    return {
      signal: controller.signal,
      dispose: () => {
        parentSignal?.removeEventListener("abort", abortFromParent);
        if (resourceRequestsRef.current.get(key) === controller)
          resourceRequestsRef.current.delete(key);
      }
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setPage(window.location.hash.slice(1) || "estoque");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onSlowRequest = () => setToast({ message: "A solicitação está demorando mais que o esperado.", type: "warning", id: Date.now() });
    const onUnauthorized = () => clearSession("Sessão expirada. Entre novamente.");
    window.addEventListener("api:slow", onSlowRequest);
    window.addEventListener("api:unauthorized", onUnauthorized);
    return () => {
      window.removeEventListener("api:slow", onSlowRequest);
      window.removeEventListener("api:unauthorized", onUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (!auth.user) return;
    const allowed = auth.user.status === "GERENTE"
      ? ["estoque", "movimentacoes", "usuarios", "senha"]
      : ["estoque", "senha"];
    if (!allowed.includes(page)) {
      window.history.replaceState(null, "", `${window.location.pathname}#estoque`);
      setPage("estoque");
    }
  }, [auth.user, page]);

  useEffect(() => {
    const controller = dialogRequestRef.current;
    if (!controller) return;
    controller.abort();
    dialogRequestRef.current = null;
    setDialog(current => current?.loading ? null : current);
  }, [page]);

  useEffect(() => () => dialogRequestRef.current?.abort(), []);

  const syncPending = useCallback(() => withSynchronizationLock(async () => {
    const pending = readPending(auth.user.id);
    if (!pending.length) return;
    if (pending.some(operation => String(operation.created_by) !== String(auth.user.id)))
      throw new Error("A fila contém operações de outro usuário e não será sincronizada.");
    const isManager = auth.user?.status === "GERENTE";
    if (!isManager && pending.some(operation => !["updateProduct", "movement"].includes(operation.kind))) {
      notify("Algumas alterações pendentes só podem ser sincronizadas por um gerente.", "error");
      return;
    }

    while (pending.length) {
      const operation = pending[0];
      if (operation.kind === "createProduct") {
        const created = await api("/api/products", auth.token, { method: "POST", body: JSON.stringify(operation.payload) });
        const cached = readProductCache(auth.user.id);
        const localProduct = cached.find(product => product.id === operation.localId);
        if (localProduct) Object.assign(localProduct, created);
        for (const queued of pending.slice(1)) {
          if (queued.productId === operation.localId) queued.productId = created.id;
          if (queued.id === operation.localId) queued.id = created.id;
        }
        localStorage.setItem(productCacheKey(auth.user.id), JSON.stringify(cached));
      } else if (operation.kind === "updateProduct") {
        await api(`/api/products/${operation.id}`, auth.token, { method: "PUT", body: JSON.stringify(operation.payload) });
      } else if (operation.kind === "movement") {
        await api(`/api/products/${operation.productId}/movements`, auth.token, { method: "POST", body: JSON.stringify(operation.payload) });
      } else if (operation.kind === "deleteProduct") {
        await api(`/api/products/${operation.id}`, auth.token, { method: "DELETE" });
      } else {
        throw new Error(`Operação offline desconhecida: ${operation.kind}`);
      }
      pending.shift();
      savePending(auth.user.id, pending);
    }
    notify("Alterações offline sincronizadas.");
  }), [auth.token, auth.user, notify]);

  const loadProducts = useCallback(async parentSignal => {
    if (!auth.token) return;
    const request = createResourceRequest("products", parentSignal);
    const { signal } = request;
    if (signal.aborted) {
      request.dispose();
      return;
    }
    setProducts(current => ({ ...current, status: "loading", error: null }));
    try {
      await syncPending();
      if (signal?.aborted) return;
      const data = await api(
        `/api/products${showInactiveProducts ? "?includeInactive=true" : ""}`,
        auth.token,
        { signal }
      );
      if (signal?.aborted) return;
      localStorage.setItem(productCacheKey(auth.user.id), JSON.stringify(data.filter(product => product.is_active !== false)));
      setProducts({ status: "success", data, error: null });
      setConnection("online");
    } catch (error) {
      if (signal?.aborted || error.name === "AbortError") return;
      setProducts(current => ({ status: "error", data: current.data, error: error.message }));
      setConnection("offline");
    } finally {
      request.dispose();
    }
  }, [auth.token, auth.user?.id, showInactiveProducts, syncPending, createResourceRequest]);

  const loadMovements = useCallback(async (filters = movementFilters, parentSignal) => {
    if (!auth.token) return;
    const request = createResourceRequest("movements", parentSignal);
    const { signal } = request;
    if (signal.aborted) {
      request.dispose();
      return;
    }
    setMovements(current => ({ ...current, status: "loading", error: null }));
    try {
      const query = new URLSearchParams();
      if (filters.startDate) query.set("startAt", localDayBoundary(filters.startDate));
      if (filters.endDate) query.set("endBefore", localDayBoundary(filters.endDate, true));
      const suffix = query.toString();
      const data = await api(`/api/movements${suffix ? `?${suffix}` : ""}`, auth.token, { signal });
      if (signal?.aborted) return;
      setMovements({ status: "success", data, error: null });
      setConnection("online");
    } catch (error) {
      if (signal?.aborted || error.name === "AbortError") return;
      setMovements(current => ({ status: "error", data: current.data, error: error.message }));
      setConnection("offline");
    } finally {
      request.dispose();
    }
  }, [auth.token, movementFilters, createResourceRequest]);

  const loadUsers = useCallback(async parentSignal => {
    if (!auth.token) return;
    const request = createResourceRequest("users", parentSignal);
    const { signal } = request;
    if (signal.aborted) {
      request.dispose();
      return;
    }
    setUsers(current => ({ ...current, status: "loading", error: null }));
    try {
      const data = await api(
        `/api/users${showInactiveUsers ? "?includeInactive=true" : ""}`,
        auth.token,
        { signal }
      );
      if (signal?.aborted) return;
      setUsers({ status: "success", data, error: null });
      setConnection("online");
    } catch (error) {
      if (signal?.aborted || error.name === "AbortError") return;
      setUsers(current => ({ status: "error", data: current.data, error: error.message }));
      setConnection("offline");
    } finally {
      request.dispose();
    }
  }, [auth.token, showInactiveUsers, createResourceRequest]);

  const loadMe = useCallback(signal => api("/api/me", auth.token, { signal }), [auth.token]);

  useEffect(() => {
    if (!auth.user) return;
    const controller = new AbortController();
    if (page === "estoque") void loadProducts(controller.signal);
    if (page === "movimentacoes") void loadMovements(movementFilters, controller.signal);
    if (page === "usuarios") void loadUsers(controller.signal);
    return () => {
      controller.abort();
      for (const request of resourceRequestsRef.current.values())
        request.abort();
    };
  }, [auth.user, page, loadProducts, loadMovements, loadUsers, movementFilters]);

  useEffect(() => {
    if (!auth.token) return undefined;
    let controller;
    const onOnline = () => {
      if (page !== "estoque") return;
      controller?.abort();
      controller = new AbortController();
      void loadProducts(controller.signal);
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      controller?.abort();
    };
  }, [auth.token, page, loadProducts]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then(registration => registration.update())
      .catch(error => console.error("Não foi possível atualizar o app offline.", error));
    return undefined;
  }, []);

  const login = async credentials => {
    const result = await api("/api/auth/login", null, { method: "POST", body: JSON.stringify(credentials) });
    if (!result || typeof result.accessToken !== "string" || !result.accessToken ||
        !result.user || !Number.isInteger(Number(result.user.id)) ||
        typeof result.user.name !== "string" ||
        !["GERENTE", "COLABORADOR"].includes(result.user.status))
      throw new Error("O servidor retornou uma resposta de autenticação inválida.");
    const allowed = result.user.status === "GERENTE"
      ? ["estoque", "movimentacoes", "usuarios", "senha"]
      : ["estoque", "senha"];
    const destination = allowed.includes(page) ? page : "estoque";
    window.history.replaceState(null, "", `${window.location.pathname}#${destination}`);
    setPage(destination);
    setLoginNotice("");
    setAuth({ token: result.accessToken, user: result.user });
    setProducts({ ...EMPTY_PRODUCTS, data: readProductCache(result.user.id) });
  };

  const logout = async notice => {
    const pending = auth.user ? readPending(auth.user.id) : [];
    if (pending.length && !window.confirm(`Há ${pending.length} operação(ões) pendente(s). Ao sair, o catálogo local será limpo; as pendências continuarão isoladas para esta conta. Deseja continuar?`))
      return;
    if (auth.token) {
      try {
        await api("/api/auth/logout", auth.token, { method: "POST" });
      } catch (error) {
        console.error("Não foi possível encerrar a sessão no servidor.", error);
      }
    }
    if (auth.user) localStorage.removeItem(productCacheKey(auth.user.id));
    clearSession(notice);
  };

  const clearSession = notice => {
    dialogRequestRef.current?.abort();
    dialogRequestRef.current = null;
    setAuth({ token: null, user: null });
    setProducts({ ...EMPTY_PRODUCTS, data: [] });
    setMovements(EMPTY_MOVEMENTS);
    setMovementFilters({ startDate: "", endDate: "" });
    setUsers(EMPTY_USERS);
    setDialog(null);
    setLoginNotice(notice || "");
    window.history.replaceState(null, "", window.location.pathname);
    setPage("estoque");
  };

  const saveProduct = async data => {
    const editing = Boolean(data.id);
    const payload = {
      name: data.name.trim(),
      unit: data.unit.trim(),
      minimumStock: Number(data.minimumStock),
      ...(editing
        ? { isActive: data.isActive }
        : { clientOperationId: crypto.randomUUID(), createdBy: auth.user.id })
    };
    if (!editing) payload.initialStock = Number(data.initialStock);
    try {
      await api(editing ? `/api/products/${data.id}` : "/api/products", auth.token, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      await loadProducts();
      notify(editing ? "Produto atualizado." : "Produto cadastrado.");
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (editing) {
        const cached = products.data.map(product => product.id === data.id
          ? {
            ...product,
            name: payload.name,
            unit: data.unit.trim(),
            minimum_stock: Number(data.minimumStock),
            is_active: data.isActive
          }
          : product);
        localStorage.setItem(productCacheKey(auth.user.id), JSON.stringify(cached));
        setProducts({ status: "success", data: cached, error: null });
        const pending = readPending(auth.user.id);
        pending.push({ kind: "updateProduct", id: data.id, created_by: auth.user.id, payload });
        savePending(auth.user.id, pending);
      } else {
        if (auth.user.status !== "GERENTE") throw new Error("É necessário estar conectado para cadastrar produtos.");
        const localId = crypto.randomUUID();
        const cached = [...products.data, {
          id: localId,
          name: payload.name,
          unit: data.unit.trim(),
          code: null,
          minimum_stock: Number(data.minimumStock),
          current_stock: Number(data.initialStock),
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }];
        localStorage.setItem(productCacheKey(auth.user.id), JSON.stringify(cached));
        setProducts({ status: "success", data: cached, error: null });
        const pending = readPending(auth.user.id);
        pending.push({ kind: "createProduct", localId, created_by: auth.user.id, payload });
        savePending(auth.user.id, pending);
      }
      notify("Salvo neste dispositivo. Será sincronizado quando a conexão voltar.");
    }
  };

  const registerMovement = async ({ product, type, quantity, reason }) => {
    const payload = {
      type,
      quantity,
      reason,
      clientOperationId: crypto.randomUUID(),
      createdBy: auth.user.id
    };
    try {
      await api(`/api/products/${product.id}/movements`, auth.token, { method: "POST", body: JSON.stringify(payload) });
      await loadProducts();
      notify("Movimentação registrada.");
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (auth.user.status !== "GERENTE")
        throw new Error("É necessário estar conectado para registrar movimentações.");
      const cached = products.data.map(item => item.id === product.id
        ? { ...item, current_stock: Number(item.current_stock) + (type === "entry" ? quantity : -quantity) }
        : item);
      localStorage.setItem(productCacheKey(auth.user.id), JSON.stringify(cached));
      setProducts({ status: "success", data: cached, error: null });
      const pending = readPending(auth.user.id);
      pending.push({ kind: "movement", productId: product.id, created_by: auth.user.id, payload });
      savePending(auth.user.id, pending);
      notify("Movimentação salva neste dispositivo e pendente de sincronização.");
    }
  };

  const saveMovement = async ({ id, type, quantity, reason }) => {
    await api(`/api/movements/${id}`, auth.token, {
      method: "PUT",
      body: JSON.stringify({ type, quantity, reason })
    });
    await Promise.all([loadMovements(), loadProducts()]);
    notify("Movimentação atualizada e saldos recalculados.");
  };

  const deleteMovement = async movement => {
    try {
      await api(`/api/movements/${movement.id}`, auth.token, { method: "DELETE" });
      await Promise.all([loadMovements(), loadProducts()]);
      notify("Movimentação excluída e saldo atualizado.");
    } catch (error) {
      notify(`Não foi possível excluir a movimentação: ${error.message}`, "error");
    }
  };

  const createUser = async data => {
    await api("/api/users", auth.token, { method: "POST", body: JSON.stringify(data) });
    await loadUsers();
    notify("Usuário cadastrado.");
  };

  const saveUser = async data => {
    const updatedUser = await api(`/api/users/${data.id}`, auth.token, {
      method: "PUT",
      body: JSON.stringify({
        name: data.name, cpf: data.cpf, status: data.status,
        password: data.password, isActive: data.isActive
      })
    });
    if (updatedUser.id === auth.user.id) {
      clearSession("Cadastro atualizado. Entre novamente com suas novas credenciais.");
      return;
    }
    await loadUsers();
    notify("Cadastro de usuário atualizado.");
  };

  const reactivateUser = async user => {
    try {
      await api(`/api/users/${user.id}`, auth.token, {
        method: "PUT",
        body: JSON.stringify({
          name: user.name, cpf: user.cpf.replace(/\D/g, ""),
          status: user.status, password: "", isActive: true
        })
      });
      notify("Usuário reativado.");
      await loadUsers();
    } catch (error) {
      notify(`Não foi possível reativar o usuário: ${error.message}`, "error");
    }
  };

  const deleteUser = async (user, confirm = true) => {
    if (confirm && !window.confirm(`Excluir/inativar o usuário "${user.name}"? Usuários com movimentações serão inativados.`)) return;
    try {
      const result = await api(`/api/users/${user.id}`, auth.token, { method: "DELETE" });
      notify(result?.message || "Usuário excluído.");
      await loadUsers();
    } catch (error) {
      notify(`Não foi possível excluir o usuário: ${error.message}`, "error", () => void deleteUser(user, false));
    }
  };

  const changePassword = async data => {
    await api("/api/auth/password", auth.token, { method: "PUT", body: JSON.stringify(data) });
    clearSession("Senha alterada. Entre novamente com a nova senha.");
  };

  const deleteProduct = async (product, confirm = true) => {
    if (confirm && !window.confirm(`Excluir "${product.name}" e todas as suas movimentações? Esta ação não pode ser desfeita.`)) return;
    try {
      const result = await api(`/api/products/${product.id}`, auth.token, { method: "DELETE" });
      notify(result?.message || "Produto excluído.");
      await loadProducts();
    } catch (error) {
      if (!isNetworkError(error)) {
        notify(`Não foi possível excluir o produto: ${error.message}`, "error", () => void deleteProduct(product, false));
        return;
      }
      try {
        const cached = products.data.filter(item => item.id !== product.id);
        localStorage.setItem(productCacheKey(auth.user.id), JSON.stringify(cached));
        setProducts({ status: "success", data: cached, error: null });
        const pending = readPending(auth.user.id);
        pending.push({ kind: "deleteProduct", id: product.id, created_by: auth.user.id });
        savePending(auth.user.id, pending);
        notify("Exclusão salva neste dispositivo. Será sincronizada quando a conexão voltar.");
      } catch (queueError) {
        notify(`Não foi possível excluir o produto: ${queueError.message}`, "error", () => void deleteProduct(product, false));
      }
    }
  };

  const openDialog = async (type, source, extra = {}) => {
    dialogRequestRef.current?.abort();
    dialogRequestRef.current = null;
    if (!source?.id) {
      setDialog({ type, ...extra });
      return;
    }
    const controller = new AbortController();
    dialogRequestRef.current = controller;
    const request = { type, source, ...extra };
    setDialog({ ...request, loading: true });
    try {
      const path = type === "user"
        ? `/api/users/${source.id}${source.isActive === false ? "?includeInactive=true" : ""}`
        : `/api/products/${source.id}${source.is_active === false ? "?includeInactive=true" : ""}`;
      const resource = await api(path, auth.token, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setDialog({
        ...request,
        loading: false,
        ...(type === "user" ? { user: resource } : { product: resource })
      });
    } catch (error) {
      if (controller.signal.aborted || error.name === "AbortError") return;
      setDialog({ ...request, loading: false, error: error.message });
    } finally {
      if (dialogRequestRef.current === controller)
        dialogRequestRef.current = null;
    }
  };

  if (!auth.user)
    return <><LoginScreen key="login" onLogin={login} notice={loginNotice} /><Toast onClose={() => setToast(null)} toast={toast} /></>;

  return (
    <>
      <AppLayout connection={connection} onLogout={() => void logout()} page={page} user={auth.user}>
        {page === "estoque" && (
          <InventoryPage
            onCreateProduct={() => setDialog({ type: "product" })}
            onDeleteProduct={deleteProduct}
            onEditProduct={product => void openDialog("product", product)}
            onMovement={(product, type) => void openDialog("movement", product, { movementType: type })}
            onRefresh={() => void loadProducts()}
            onRetry={() => void loadProducts()}
            onToggleInactive={setShowInactiveProducts}
            resource={products}
            showInactive={showInactiveProducts}
            user={auth.user}
          />
        )}
        {page === "movimentacoes" && (
          <MovementPage
            manager={auth.user.status === "GERENTE"}
            onDelete={deleteMovement}
            onEdit={movement => setDialog({ type: "editMovement", movement })}
            onRetry={() => loadMovements()}
            onSearch={setMovementFilters}
            resource={movements}
          />
        )}
        {page === "usuarios" && (
          <UsersPage
            currentUserId={auth.user.id}
            onCreate={createUser}
            onDelete={deleteUser}
            onEdit={user => void openDialog("user", user)}
            onReactivate={reactivateUser}
            onRetry={() => void loadUsers()}
            onToggleInactive={setShowInactiveUsers}
            resource={users}
            showInactive={showInactiveUsers}
          />
        )}
        {page === "senha" && <PasswordPage onChangePassword={changePassword} onLoadUser={loadMe} />}
      </AppLayout>

      {dialog?.loading || dialog?.error ? (
        <Modal title="Carregando dados" description="Consultando o registro atualizado no servidor." onClose={closeDialog}>
          {dialog.loading
            ? <p role="status" className="py-4">Carregando...</p>
            : <div role="alert" className="space-y-3"><p>{dialog.error}</p><ActionButton onClick={() => void openDialog(dialog.type, dialog.source, { movementType: dialog.movementType })} type="button">Tentar novamente</ActionButton></div>}
        </Modal>
      ) : null}
      {dialog?.type === "product" && !dialog.loading && !dialog.error && <ProductDialog key={dialog.product?.id || "new"} onClose={closeDialog} onSave={saveProduct} product={dialog.product} />}
      {dialog?.type === "movement" && !dialog.loading && !dialog.error && <MovementDialog key={`${dialog.product.id}-${dialog.movementType}`} onClose={closeDialog} onSave={registerMovement} product={dialog.product} type={dialog.movementType} user={auth.user} />}
      {dialog?.type === "editMovement" && <EditMovementDialog key={dialog.movement.id} movement={dialog.movement} onClose={closeDialog} onSave={saveMovement} />}
      {dialog?.type === "user" && !dialog.loading && !dialog.error && <UserEditDialog key={dialog.user.id} onClose={closeDialog} onSave={saveUser} user={dialog.user} />}
      <Toast onClose={() => setToast(null)} toast={toast} />
    </>
  );
}
