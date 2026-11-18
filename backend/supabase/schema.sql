create extension if not exists pgcrypto;

create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),
    code bigint generated always as identity unique,
    name varchar(250) not null unique check (char_length(name) >= 3),
    minimum_stock numeric(12, 3) not null default 0 check (minimum_stock >= 0),
    current_stock numeric(12, 3) not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.products drop column if exists unit;

create table if not exists public.stock_movements (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.products(id) on delete restrict,
    type varchar(10) not null check (type in ('entry', 'exit')),
    quantity numeric(12, 3) not null check (quantity > 0),
    reason varchar(250),
    operator_name varchar(100),
    created_at timestamptz not null default now()
);

alter table public.stock_movements
    alter column created_at set default now();

do $$
declare
    code_data_type text;
    code_is_identity text;
begin
    select data_type, is_identity
      into code_data_type, code_is_identity
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'code';

    if code_data_type is distinct from 'bigint' or code_is_identity is distinct from 'YES' then
        truncate table public.stock_movements, public.products restart identity;
        alter table public.products drop column if exists code;
        alter table public.products add column code bigint generated always as identity unique;
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'products_name_key'
           and conrelid = 'public.products'::regclass
    ) then
        alter table public.products
            add constraint products_name_key unique (name);
    end if;
end;
$$;

create index if not exists idx_stock_movements_product_created
    on public.stock_movements (product_id, created_at desc);

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
begin
    update public.products
       set current_stock = current_stock + case when new.type = 'entry' then new.quantity else -new.quantity end,
           updated_at = now()
     where id = new.product_id;

    if not found then
        raise exception 'Produto não encontrado';
    end if;

    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1
          from pg_trigger
         where tgname = 'trg_apply_stock_movement'
           and tgrelid = 'public.stock_movements'::regclass
           and not tgisinternal
    ) then
        execute 'create trigger trg_apply_stock_movement
            before insert on public.stock_movements
            for each row execute function public.apply_stock_movement()';
    end if;
end;
$$;

alter table public.products enable row level security;
alter table public.stock_movements enable row level security;

comment on table public.products is 'Acesso realizado pela API usando service role mantida somente no servidor.';