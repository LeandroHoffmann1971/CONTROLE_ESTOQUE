alter table public.products add column if not exists is_active boolean not null default true;
alter table public.products add column if not exists client_operation_id uuid;
alter table public.stock_movements add column if not exists is_active boolean not null default true;
alter table public.stock_movements add column if not exists balance_after numeric(12, 3);
alter table public.stock_movements add column if not exists client_operation_id uuid;
alter table public.stock_movements add column if not exists created_by bigint references public.users(id) on delete set null;
alter table public.products add column if not exists created_by bigint references public.users(id) on delete set null;
alter table public.users add column if not exists is_active boolean not null default true;

create unique index if not exists uq_products_client_operation_id
    on public.products (client_operation_id) where client_operation_id is not null;
create unique index if not exists uq_movements_client_operation_id
    on public.stock_movements (client_operation_id) where client_operation_id is not null;

create table if not exists public.login_audit (
    id bigint generated always as identity primary key,
    user_id bigint references public.users(id) on delete set null,
    cpf_hash text not null,
    success boolean not null,
    ip inet,
    user_agent text,
    created_at timestamptz not null default now()
);
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

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'products_current_stock_nonnegative'
          and conrelid = 'public.products'::regclass
    ) then
        alter table public.products
            add constraint products_current_stock_nonnegative
            check (current_stock >= 0) not valid;
    end if;
end;
$$;

with movement_totals as (
    select product_id,
           sum(case when type = 'entry' then quantity else -quantity end) as total_delta
    from public.stock_movements
    group by product_id
), movement_balances as (
    select m.id,
           p.current_stock - coalesce(t.total_delta, 0)
             + sum(case when m.type = 'entry' then m.quantity else -m.quantity end)
               over (partition by m.product_id order by m.created_at, m.id) as balance_after
    from public.stock_movements m
    join public.products p on p.id = m.product_id
    left join movement_totals t on t.product_id = m.product_id
    where m.balance_after is null
)
update public.stock_movements m
   set balance_after = b.balance_after
  from movement_balances b
 where m.id = b.id;
alter table public.stock_movements alter column balance_after set not null;

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
    resulting_stock numeric(12, 3);
begin
    update public.products
       set current_stock = current_stock + case when new.type = 'entry' then new.quantity else -new.quantity end,
           updated_at = now()
     where id = new.product_id
       and is_active
       and (new.type = 'entry' or current_stock >= new.quantity)
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

alter table public.login_audit enable row level security;
alter table public.products validate constraint products_current_stock_nonnegative;
