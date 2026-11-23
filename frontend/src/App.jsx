import { useCallback, useEffect, useRef, useState } from "react";
import { api, isNetworkError } from "./api.js";

const PASSWORD_ERROR = "A senha deve ter 6 caracteres alfanuméricos";
const EMPTY_PRODUCTS = { status: "loading", data: [], error: null };
const EMPTY_MOVEMENTS = { status: "idle", data: [], error: null };
const EMPTY_USERS = { status: "idle", data: [], error: null };
const PENDING_KEY = "despensa-pending";
const PRODUCT_CACHE_KEY = "despensa-products";

function readProductCache() {
  const cached = localStorage.getItem(PRODUCT_CACHE_KEY);
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

function readPending() {
  const pending = localStorage.getItem(PENDING_KEY);
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

function savePending(pending) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
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

function formatCpf(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function useSubmission() {
  const [state, setState] = useState({ status: "idle", error: "", success: "" });
  const retryRef = useRef(null);

  const run = useCallback(async (action, successMessage, afterSuccess) => {
    const execute = async () => {
      setState({ status: "loading", error: "", success: "" });
      try {
        const result = await action();
        setState({ status: "success", error: "", success: successMessage });
        if (afterSuccess) afterSuccess(result);
        return { ok: true, result };
      } catch (error) {
        setState({ status: "error", error: error.message, success: "" });
        return { ok: false, error };
      }
    };
    retryRef.current = execute;
    return execute();
  }, []);

  const retry = useCallback(() => retryRef.current?.(), []);
  const clear = useCallback(() => setState({ status: "idle", error: "", success: "" }), []);
  return { ...state, run, retry, clear };
}

function Spinner({ small = false }) {
  return <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${small ? "size-4" : "size-5"}`} />;
}

function ActionButton({ children, loading, loadingLabel = "Salvando...", variant = "primary", ...props }) {
  const style = variant === "primary"
    ? "bg-[#59643a] text-white hover:bg-[#46512d]"
    : "border border-[#e1e4dc] bg-white text-[#454b3f] hover:bg-[#f7f8f3]";
  return (
    <button
      {...props}
      type={props.type || "submit"}
      disabled={loading || props.disabled}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${style} ${props.className || ""}`}
    >
      {loading && <Spinner small />}
      {loading ? loadingLabel : children}
    </button>
  );
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
            <input
              autoComplete="username"
              className="mt-1.5 min-h-12 w-full rounded-lg border border-[#dfe2d7] px-3 text-base outline-none focus:border-[#75804c]"
              inputMode="numeric"
              maxLength={14}
              onChange={event => setCpf(formatCpf(event.target.value))}
              placeholder="000.000.000-00"
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
                maxLength={6}
                onChange={event => setPassword(event.target.value)}
                placeholder="6 caracteres"
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="min-h-11 shrink-0 px-3 text-xs font-semibold text-[#59643a] underline underline-offset-2"
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
    <article className="min-w-0 rounded-xl border border-[#e5e7df] bg-white p-4 shadow-sm sm:p-5">
      <p className="break-words text-xs font-semibold text-[#62685c] sm:text-sm">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      <p className="mt-1 break-words text-xs text-[#777d70]">{note}</p>
    </article>
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

function InventoryPage({ resource, onRetry, onRefresh, user, onCreateProduct, onEditProduct, onDeleteProduct, onMovement }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const products = resource.data;
  const lowCount = products.filter(isLow).length;
  const filtered = products.filter(product => {
    const matchesText = `${product.name} ${product.code ?? ""}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"));
    return matchesText && (filter === "all" || isLow(product));
  });
  const managers = user.status === "GERENTE";

  return (
    <>
      <PageHeading
        action={(
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#59643a] px-4 text-sm font-semibold text-white hover:bg-[#46512d] disabled:cursor-not-allowed disabled:opacity-55"
            disabled={!managers}
            onClick={onCreateProduct}
            title={managers ? "" : "Apenas gerentes podem cadastrar produtos"}
            type="button"
          >
            <span aria-hidden="true">＋</span> Novo produto
          </button>
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
                      onDelete={() => onDeleteProduct(product)}
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

function ProductCard({ product, manager, onMovement, onEdit, onDelete }) {
  const low = isLow(product);
  return (
    <article className="min-w-0 rounded-xl border border-[#e5e7df] bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#f0f1e8] font-bold text-[#59643a]">{product.name.trim().slice(0, 1).toLocaleUpperCase("pt-BR")}</span>
          <h3 className="min-w-0 break-words font-semibold text-[#30352b]">{product.name}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${low ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{low ? "Repor estoque" : "Saudável"}</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="min-w-0"><dt className="text-xs text-[#777d70]">Código</dt><dd className="mt-0.5 break-all font-mono text-[#62685c]">{product.code ?? "—"}</dd></div>
        <div><dt className="text-xs text-[#777d70]">Estoque atual</dt><dd className={`mt-0.5 font-bold ${low ? "text-red-700" : "text-[#3e4438]"}`}>{formatQuantity(product.current_stock)}</dd></div>
        <div><dt className="text-xs text-[#777d70]">Estoque mínimo</dt><dd className="mt-0.5 text-[#454b3f]">{formatQuantity(product.minimum_stock)}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-[#777d70]">Status</dt><dd className="mt-0.5 break-words text-[#454b3f]">{low ? "Abaixo do mínimo" : "Acima do mínimo"}</dd></div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#f0f1ec] pt-3">
        <button className="min-h-10 flex-1 rounded-lg border border-[#dfe2d7] px-2 text-sm font-semibold text-[#46512d] hover:bg-[#f7f8f3]" onClick={() => onMovement(product, "entry")} type="button">＋ Entrada</button>
        <button className="min-h-10 flex-1 rounded-lg border border-[#dfe2d7] px-2 text-sm font-semibold text-[#46512d] hover:bg-[#f7f8f3]" onClick={() => onMovement(product, "exit")} type="button">− Saída</button>
        <button className="min-h-10 rounded-lg border border-[#dfe2d7] px-3 text-sm font-semibold text-[#454b3f] hover:bg-[#f7f8f3]" onClick={onEdit} type="button">Editar</button>
        {manager && <button className="min-h-10 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={onDelete} type="button">Excluir</button>}
      </div>
    </article>
  );
}

function MovementPage({ resource, onRetry }) {
  return (
    <>
      <PageHeading description="Registros ordenados do mais recente para o mais antigo." eyebrow="CONSULTA" title="Movimentações" />
      <section className="border-t border-[#dfe2d7] pt-5">
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
                      <Detail label="Quantidade"><span className={`font-bold ${entry ? "text-green-700" : "text-red-700"}`}>{entry ? "+" : "−"}{formatQuantity(movement.quantity)}</span></Detail>
                      <Detail label="Data">{formatDate(movement.createdAt)}</Detail>
                      <Detail label="Estoque atual">{formatQuantity(movement.currentStock)}</Detail>
                      <Detail label="Motivo">{movement.reason || "—"}</Detail>
                      <Detail label="Operador">{movement.operatorName || "—"}</Detail>
                    </dl>
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

function UsersPage({ resource, onRetry, onCreate, onEdit, onDelete, currentUserId }) {
  const [form, setForm] = useState({ name: "", cpf: "", status: "COLABORADOR", password: "" });
  const submission = useSubmission();

  const submit = async event => {
    event.preventDefault();
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
          <Field label="Nome"><input autoComplete="name" className={inputClass} maxLength={150} minLength={3} onChange={event => { setForm({ ...form, name: event.target.value }); submission.clear(); }} required value={form.name} /></Field>
          <Field label="CPF"><input autoComplete="off" className={inputClass} inputMode="numeric" maxLength={14} onChange={event => { setForm({ ...form, cpf: formatCpf(event.target.value) }); submission.clear(); }} placeholder="000.000.000-00" required value={form.cpf} /></Field>
          <Field label="Status">
            <select className={inputClass} onChange={event => { setForm({ ...form, status: event.target.value }); submission.clear(); }} value={form.status}>
              <option value="GERENTE">Gerente</option><option value="COLABORADOR">Colaborador</option>
            </select>
          </Field>
          <Field label="Senha"><PasswordInput autoComplete="new-password" className={inputClass} onChange={event => { setForm({ ...form, password: event.target.value }); submission.clear(); }} required value={form.password} /></Field>
          <div className="space-y-3 sm:col-span-2">
            <FormFeedback state={submission} onRetry={submission.retry} />
            <ActionButton loading={submission.status === "loading"} loadingLabel="Cadastrando...">Cadastrar usuário</ActionButton>
          </div>
        </form>
      </section>

      <section className="mt-8 border-t border-[#dfe2d7] pt-5">
        <h2 className="text-lg font-bold text-[#282d24]">Usuários cadastrados</h2>
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
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${user.status === "GERENTE" ? "bg-green-50 text-green-700" : "bg-[#f0f2e7] text-[#59643a]"}`}>{user.status === "GERENTE" ? "Gerente" : "Colaborador"}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <Detail label="ID">{user.id}</Detail>
                      <Detail label="CPF">{user.cpf}</Detail>
                      <Detail label="Data de cadastro">{formatDate(`${user.createdAt}T00:00:00Z`, { dateStyle: "short", timeZone: "UTC" })}</Detail>
                      <Detail label="Perfil">{user.status}</Detail>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-[#f0f1ec] pt-3">
                      <button className="min-h-10 rounded-lg border border-[#dfe2d7] px-4 text-sm font-semibold hover:bg-[#f7f8f3]" onClick={() => onEdit(user)} type="button">Editar</button>
                      <button className="min-h-10 rounded-lg px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={user.id === currentUserId} onClick={() => onDelete(user)} title={user.id === currentUserId ? "Não é possível excluir sua própria conta" : ""} type="button">Excluir</button>
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

function PasswordPage({ onChangePassword }) {
  const submission = useSubmission();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  const submit = async event => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      submission.clear();
      event.currentTarget.elements.confirmPassword.setCustomValidity("A confirmação da senha não confere.");
      event.currentTarget.reportValidity();
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
        <form className="grid max-w-lg grid-cols-1 gap-4 rounded-xl border border-[#e5e7df] bg-white p-4 shadow-sm sm:p-5" onSubmit={submit}>
          <Field label="Senha atual"><input autoComplete="current-password" className={inputClass} name="currentPassword" onChange={event => { setForm({ ...form, currentPassword: event.target.value }); submission.clear(); }} required type="password" value={form.currentPassword} /></Field>
          <Field label="Nova senha"><PasswordInput autoComplete="new-password" className={inputClass} onChange={event => { setForm(current => ({ ...current, newPassword: event.target.value })); submission.clear(); }} required value={form.newPassword} /></Field>
          <Field label="Confirmar nova senha"><input autoComplete="new-password" className={inputClass} name="confirmPassword" onChange={event => { setForm({ ...form, confirmPassword: event.target.value }); event.currentTarget.setCustomValidity(""); submission.clear(); }} required type="password" value={form.confirmPassword} /></Field>
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
    const valid = /^[A-Za-z0-9]{6}$/.test(input.value);
    input.setCustomValidity(input.value && !valid ? PASSWORD_ERROR : "");
    if (onChange) onChange(event);
  };
  return <input {...props} className={className} onChange={validate} onInvalid={validate} pattern="[A-Za-z0-9]{6}" type="password" />;
}

function Modal({ title, description, onClose, children }) {
  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1d241e]/55 p-3 sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="modal-title" aria-modal="true" className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6" role="dialog">
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
    minimumStock: product?.minimum_stock ?? "0",
    initialStock: "0"
  });
  const editing = Boolean(product);

  const submit = async event => {
    event.preventDefault();
    await submission.run(
      () => onSave({ ...form, id: product?.id }),
      editing ? "Produto atualizado." : "Produto cadastrado.",
      onClose
    );
  };

  return (
    <Modal title={editing ? "Editar produto" : "Novo produto"} description="Preencha os dados do produto." onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Descrição"><input className={inputClass} maxLength={250} minLength={3} onChange={event => { setForm({ ...form, name: event.target.value }); submission.clear(); }} required value={form.name} /></Field>
        <Field label="Estoque mínimo"><input className={inputClass} min="0" onChange={event => { setForm({ ...form, minimumStock: event.target.value }); submission.clear(); }} required step="0.001" type="number" value={form.minimumStock} /></Field>
        {!editing && <Field label="Estoque inicial"><input className={inputClass} min="0" onChange={event => { setForm({ ...form, initialStock: event.target.value }); submission.clear(); }} required step="0.001" type="number" value={form.initialStock} /></Field>}
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
    if (!entry && Number(quantity) > Number(product.current_stock) &&
        !window.confirm("A saída é maior que o saldo registrado. Deseja continuar?"))
      return;
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
        <Field label="Quantidade"><input className={inputClass} min="0.001" onChange={event => { setQuantity(event.target.value); submission.clear(); }} placeholder="0,00" required step="0.001" type="number" value={quantity} /></Field>
        <Field label="Motivo"><input className={inputClass} maxLength={250} onChange={event => { setReason(event.target.value); submission.clear(); }} placeholder="Ex.: compra, consumo, perda" value={reason} /></Field>
        <FormFeedback state={submission} onRetry={submission.retry} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <ActionButton onClick={onClose} type="button" variant="secondary">Cancelar</ActionButton>
          <ActionButton loading={submission.status === "loading"} loadingLabel="Registrando...">Confirmar</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function UserEditDialog({ user, onSave, onClose }) {
  const submission = useSubmission();
  const [form, setForm] = useState({ name: user.name, cpf: user.cpf, status: user.status, password: "" });
  const submit = async event => {
    event.preventDefault();
    await submission.run(
      () => onSave({ ...form, cpf: form.cpf.replace(/\D/g, ""), id: user.id }),
      "Cadastro de usuário atualizado.",
      onClose
    );
  };

  return (
    <Modal title="Editar usuário" description="Atualize os dados da conta." onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Nome"><input autoComplete="name" className={inputClass} maxLength={150} minLength={3} onChange={event => { setForm({ ...form, name: event.target.value }); submission.clear(); }} required value={form.name} /></Field>
        <Field label="CPF"><input className={inputClass} inputMode="numeric" maxLength={14} onChange={event => { setForm({ ...form, cpf: formatCpf(event.target.value) }); submission.clear(); }} required value={form.cpf} /></Field>
        <Field label="Status">
          <select className={inputClass} onChange={event => { setForm({ ...form, status: event.target.value }); submission.clear(); }} value={form.status}>
            <option value="GERENTE">Gerente</option><option value="COLABORADOR">Colaborador</option>
          </select>
        </Field>
        <Field label="Nova senha (opcional)"><PasswordInput autoComplete="new-password" className={inputClass} onChange={event => { setForm({ ...form, password: event.target.value }); submission.clear(); }} placeholder="Deixe vazio para manter a senha" value={form.password} /></Field>
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
  const style = toast.type === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-green-300 bg-green-50 text-green-900";
  return <div className={`fixed right-4 top-4 z-[60] flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg sm:right-6 ${style}`} role={toast.type === "error" ? "alert" : "status"}><span className="break-words">{toast.message}</span>{toast.onRetry && <button className="shrink-0 font-semibold underline underline-offset-2" onClick={toast.onRetry} type="button">Tentar novamente</button>}<button aria-label="Fechar aviso" className="shrink-0 font-bold" onClick={onClose} type="button">×</button></div>;
}

export default function App() {
  const [auth, setAuth] = useState({ token: null, user: null });
  const [page, setPage] = useState(() => window.location.hash.slice(1) || "estoque");
  const [products, setProducts] = useState(() => ({ ...EMPTY_PRODUCTS, data: readProductCache() }));
  const [movements, setMovements] = useState(EMPTY_MOVEMENTS);
  const [users, setUsers] = useState(EMPTY_USERS);
  const [connection, setConnection] = useState("offline");
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const [loginNotice, setLoginNotice] = useState("");

  const notify = useCallback((message, type = "success", onRetry) => setToast({ message, type, onRetry, id: Date.now() }), []);

  useEffect(() => {
    const onHashChange = () => setPage(window.location.hash.slice(1) || "estoque");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
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

  const syncPending = useCallback(async () => {
    const pending = readPending();
    if (!pending.length) return;
    const isManager = auth.user?.status === "GERENTE";
    if (!isManager && pending.some(operation => !["updateProduct", "movement"].includes(operation.kind))) {
      notify("Algumas alterações pendentes só podem ser sincronizadas por um gerente.", "error");
      return;
    }

    while (pending.length) {
      const operation = pending[0];
      if (operation.kind === "createProduct") {
        const created = await api("/api/products", auth.token, { method: "POST", body: JSON.stringify(operation.payload) });
        const cached = readProductCache();
        const localProduct = cached.find(product => product.id === operation.localId);
        if (localProduct) Object.assign(localProduct, created);
        for (const queued of pending.slice(1)) {
          if (queued.productId === operation.localId) queued.productId = created.id;
          if (queued.id === operation.localId) queued.id = created.id;
        }
        localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(cached));
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
      savePending(pending);
    }
    notify("Alterações offline sincronizadas.");
  }, [auth.token, auth.user, notify]);

  const loadProducts = useCallback(async () => {
    if (!auth.token) return;
    setProducts(current => ({ ...current, status: "loading", error: null }));
    try {
      await syncPending();
      const data = await api("/api/products", auth.token);
      localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(data));
      setProducts({ status: "success", data, error: null });
      setConnection("online");
    } catch (error) {
      setProducts(current => ({ status: "error", data: current.data, error: error.message }));
      setConnection("offline");
    }
  }, [auth.token, syncPending]);

  const loadMovements = useCallback(async () => {
    if (!auth.token) return;
    setMovements(current => ({ ...current, status: "loading", error: null }));
    try {
      const data = await api("/api/movements", auth.token);
      setMovements({ status: "success", data, error: null });
      setConnection("online");
    } catch (error) {
      setMovements(current => ({ status: "error", data: current.data, error: error.message }));
      setConnection("offline");
    }
  }, [auth.token]);

  const loadUsers = useCallback(async () => {
    if (!auth.token) return;
    setUsers(current => ({ ...current, status: "loading", error: null }));
    try {
      const data = await api("/api/users", auth.token);
      setUsers({ status: "success", data, error: null });
      setConnection("online");
    } catch (error) {
      setUsers(current => ({ status: "error", data: current.data, error: error.message }));
      setConnection("offline");
    }
  }, [auth.token]);

  useEffect(() => {
    if (!auth.user) return;
    if (page === "estoque") void loadProducts();
    if (page === "movimentacoes") void loadMovements();
    if (page === "usuarios") void loadUsers();
  }, [auth.user, page, loadProducts, loadMovements, loadUsers]);

  useEffect(() => {
    if (!auth.token) return undefined;
    const onOnline = () => { if (page === "estoque") void loadProducts(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
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
    const allowed = result.user.status === "GERENTE"
      ? ["estoque", "movimentacoes", "usuarios", "senha"]
      : ["estoque", "senha"];
    const destination = allowed.includes(page) ? page : "estoque";
    window.history.replaceState(null, "", `${window.location.pathname}#${destination}`);
    setPage(destination);
    setLoginNotice("");
    setAuth({ token: result.accessToken, user: result.user });
  };

  const logout = async notice => {
    if (auth.token) {
      try {
        await api("/api/auth/logout", auth.token, { method: "POST" });
      } catch (error) {
        console.error("Não foi possível encerrar a sessão no servidor.", error);
      }
    }
    clearSession(notice);
  };

  const clearSession = notice => {
    setAuth({ token: null, user: null });
    setProducts({ ...EMPTY_PRODUCTS, data: [] });
    setMovements(EMPTY_MOVEMENTS);
    setUsers(EMPTY_USERS);
    setDialog(null);
    setLoginNotice(notice || "");
    window.history.replaceState(null, "", window.location.pathname);
    setPage("estoque");
  };

  const saveProduct = async data => {
    const editing = Boolean(data.id);
    const payload = { name: data.name, minimumStock: Number(data.minimumStock) };
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
          ? { ...product, name: data.name, minimum_stock: Number(data.minimumStock) }
          : product);
        localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(cached));
        setProducts({ status: "success", data: cached, error: null });
        const pending = readPending();
        pending.push({ kind: "updateProduct", id: data.id, payload });
        savePending(pending);
      } else {
        if (auth.user.status !== "GERENTE") throw new Error("É necessário estar conectado para cadastrar produtos.");
        const localId = crypto.randomUUID();
        const cached = [...products.data, {
          id: localId,
          name: data.name,
          code: null,
          minimum_stock: Number(data.minimumStock),
          current_stock: Number(data.initialStock),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }];
        localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(cached));
        setProducts({ status: "success", data: cached, error: null });
        const pending = readPending();
        pending.push({ kind: "createProduct", localId, payload });
        savePending(pending);
      }
      notify("Salvo neste dispositivo. Será sincronizado quando a conexão voltar.");
    }
  };

  const registerMovement = async ({ product, type, quantity, reason }) => {
    const payload = { type, quantity, reason };
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
      localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(cached));
      setProducts({ status: "success", data: cached, error: null });
      const pending = readPending();
      pending.push({ kind: "movement", productId: product.id, payload });
      savePending(pending);
      notify("Movimentação salva neste dispositivo e pendente de sincronização.");
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
      body: JSON.stringify({ name: data.name, cpf: data.cpf, status: data.status, password: data.password })
    });
    if (updatedUser.id === auth.user.id) {
      clearSession("Cadastro atualizado. Entre novamente com suas novas credenciais.");
      return;
    }
    await loadUsers();
    notify("Cadastro de usuário atualizado.");
  };

  const deleteUser = async (user, confirm = true) => {
    if (confirm && !window.confirm(`Excluir o usuário "${user.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api(`/api/users/${user.id}`, auth.token, { method: "DELETE" });
      notify("Usuário excluído.");
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
    if (confirm && !window.confirm(`Excluir "${product.name}"? Produtos com histórico de movimentações não podem ser removidos.`)) return;
    try {
      await api(`/api/products/${product.id}`, auth.token, { method: "DELETE" });
      notify("Produto excluído.");
      await loadProducts();
    } catch (error) {
      if (!isNetworkError(error)) {
        notify(`Não foi possível excluir o produto: ${error.message}`, "error", () => void deleteProduct(product, false));
        return;
      }
      try {
        const cached = products.data.filter(item => item.id !== product.id);
        localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(cached));
        setProducts({ status: "success", data: cached, error: null });
        const pending = readPending();
        pending.push({ kind: "deleteProduct", id: product.id });
        savePending(pending);
        notify("Exclusão salva neste dispositivo. Será sincronizada quando a conexão voltar.");
      } catch (queueError) {
        notify(`Não foi possível excluir o produto: ${queueError.message}`, "error", () => void deleteProduct(product, false));
      }
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
            onEditProduct={product => setDialog({ type: "product", product })}
            onMovement={(product, type) => setDialog({ type: "movement", product, movementType: type })}
            onRefresh={loadProducts}
            onRetry={loadProducts}
            resource={products}
            user={auth.user}
          />
        )}
        {page === "movimentacoes" && <MovementPage onRetry={loadMovements} resource={movements} />}
        {page === "usuarios" && (
          <UsersPage
            currentUserId={auth.user.id}
            onCreate={createUser}
            onDelete={deleteUser}
            onEdit={user => setDialog({ type: "user", user })}
            onRetry={loadUsers}
            resource={users}
          />
        )}
        {page === "senha" && <PasswordPage onChangePassword={changePassword} />}
      </AppLayout>

      {dialog?.type === "product" && <ProductDialog key={dialog.product?.id || "new"} onClose={() => setDialog(null)} onSave={saveProduct} product={dialog.product} />}
      {dialog?.type === "movement" && <MovementDialog key={`${dialog.product.id}-${dialog.movementType}`} onClose={() => setDialog(null)} onSave={registerMovement} product={dialog.product} type={dialog.movementType} user={auth.user} />}
      {dialog?.type === "user" && <UserEditDialog key={dialog.user.id} onClose={() => setDialog(null)} onSave={saveUser} user={dialog.user} />}
      <Toast onClose={() => setToast(null)} toast={toast} />
    </>
  );
}
