create extension if not exists pgcrypto;

create or replace function public.is_valid_cpf(cpf_input text)
returns boolean
language plpgsql
immutable
as $$
declare
    digits text := regexp_replace(coalesce(cpf_input, ''), '[^0-9]', '', 'g');
    total integer;
    remainder integer;
    expected integer;
    digit_position integer;
    index_value integer;
begin
    if digits !~ '^[0-9]{11}$' or digits = repeat(substring(digits from 1 for 1), 11) then
        return false;
    end if;

    for digit_position in 9..10 loop
        total := 0;
        for index_value in 0..(digit_position - 1) loop
            total := total + substring(digits from index_value + 1 for 1)::integer * (digit_position + 1 - index_value);
        end loop;
        remainder := total % 11;
        expected := case when remainder < 2 then 0 else 11 - remainder end;
        if substring(digits from digit_position + 1 for 1)::integer <> expected then
            return false;
        end if;
    end loop;
    return true;
end;
$$;

create table if not exists public.users (
    id bigint generated always as identity primary key,
    name varchar(150) not null check (char_length(btrim(name)) between 3 and 150),
    cpf varchar(14) not null unique check (
        cpf ~ '^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$'
        and public.is_valid_cpf(cpf)
    ),
    created_at date not null default current_date,
    status varchar(12) not null check (status in ('GERENTE', 'COLABORADOR')),
    password_hash text not null,
    is_active boolean not null default true
);

create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),
    code bigint generated always as identity unique,
    name varchar(250) not null unique check (char_length(btrim(name)) between 3 and 250),
    minimum_stock numeric(12, 3) not null default 0 check (minimum_stock >= 0),
    current_stock numeric(12, 3) not null default 0 check (current_stock >= 0),
    is_active boolean not null default true,
    client_operation_id uuid unique,
    created_by bigint references public.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.products(id) on delete cascade,
    type varchar(10) not null check (type in ('entry', 'exit')),
    quantity numeric(12, 3) not null check (quantity > 0),
    reason varchar(250),
    operator_name varchar(150),
    created_by bigint references public.users(id) on delete set null,
    balance_after numeric(12, 3) not null,
    is_active boolean not null default true,
    client_operation_id uuid unique,
    created_at timestamptz not null default now()
);

create table if not exists public.login_audit (
    id bigint generated always as identity primary key,
    user_id bigint references public.users(id) on delete set null,
    cpf_hash text not null,
    success boolean not null,
    ip inet,
    user_agent text,
    created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_product_created
    on public.stock_movements (product_id, created_at desc);
create index if not exists idx_login_audit_rate_limit
    on public.login_audit (cpf_hash, ip, created_at desc) where success = false;

create or replace function public.record_login_attempt(
    p_user_id bigint,
    p_cpf_hash text,
    p_success boolean,
    p_ip text,
    p_user_agent text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    allowed boolean;
    remote_ip inet := nullif(p_ip, '')::inet;
begin
    perform pg_advisory_xact_lock(hashtextextended(p_cpf_hash || ':' || coalesce(p_ip, ''), 0));
    select count(*) < 5 into allowed
      from public.login_audit
     where cpf_hash = p_cpf_hash
       and ip is not distinct from remote_ip
       and success = false
       and created_at >= now() - interval '15 minutes';

    insert into public.login_audit (user_id, cpf_hash, success, ip, user_agent)
    values (p_user_id, p_cpf_hash, p_success and allowed, remote_ip, left(p_user_agent, 1000));

    return allowed;
end;
$$;
revoke all on function public.record_login_attempt(bigint, text, boolean, text, text) from public;
grant execute on function public.record_login_attempt(bigint, text, boolean, text, text) to service_role;

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
    locked_stock numeric(12, 3);
    resulting_stock numeric(12, 3);
begin
    select current_stock into locked_stock
      from public.products
     where id = new.product_id and is_active
     for update;

    if not found or (new.type = 'exit' and locked_stock < new.quantity) then
        raise exception 'Produto inativo, não encontrado ou saldo insuficiente';
    end if;

    update public.products
       set current_stock = locked_stock + case when new.type = 'entry' then new.quantity else -new.quantity end,
           updated_at = now()
     where id = new.product_id
       and is_active
     returning current_stock into resulting_stock;

    if not found then
        raise exception 'Produto inativo, não encontrado ou saldo insuficiente';
    end if;

    new.balance_after := resulting_stock;
    return new;
end;
$$;

create or replace function public.prevent_last_active_manager_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if old.status = 'GERENTE' and old.is_active and
       (tg_op = 'DELETE' or new.status <> 'GERENTE' or not new.is_active) then
        perform pg_advisory_xact_lock(hashtext('prevent_last_active_manager_change'));
        if (select count(*) from public.users
             where status = 'GERENTE' and is_active and id <> old.id) = 0 then
            raise exception 'O sistema precisa manter pelo menos um gerente ativo';
        end if;
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1 from pg_trigger
        where tgname = 'trg_apply_stock_movement'
          and tgrelid = 'public.stock_movements'::regclass
          and not tgisinternal
    ) then
        create trigger trg_apply_stock_movement
            before insert on public.stock_movements
            for each row execute function public.apply_stock_movement();
    end if;
    if not exists (
        select 1 from pg_trigger
        where tgname = 'trg_prevent_last_active_manager'
          and tgrelid = 'public.users'::regclass
          and not tgisinternal
    ) then
        create trigger trg_prevent_last_active_manager
            before update or delete on public.users
            for each row execute function public.prevent_last_active_manager_change();
    end if;
end;
$$;

alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.users enable row level security;
alter table public.login_audit enable row level security;

comment on table public.products is 'Acesso realizado pela API usando service role mantida somente no servidor.';
comment on table public.users is 'Senhas armazenadas como hashes PBKDF2; acesso somente pela API usando service role no servidor.';
