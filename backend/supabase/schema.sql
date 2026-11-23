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
    alter column operator_name type varchar(150);

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
    name varchar(150) not null check (char_length(btrim(name)) >= 3),
    cpf varchar(14) not null unique check (cpf ~ '^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$' and public.is_valid_cpf(cpf)),
    created_at date not null default current_date,
    status varchar(12) not null check (status in ('GERENTE', 'COLABORADOR')),
    password_hash text not null
);

insert into public.users (name, cpf, created_at, status, password_hash)
values
    ('Leandro Luís Hoffmann', '833.063.909-68', date '2026-11-23', 'GERENTE',
     '$pbkdf2-sha256$100000$000102030405060708090a0b0c0d0e0f$2f5fe880ab397587fd47528ea71844d4cdb478fe80a45ad2e9a8cee4eea5f1e7'),
    ('José da Silva', '666.785.520-91', date '2026-11-23', 'COLABORADOR',
     '$pbkdf2-sha256$100000$101112131415161718191a1b1c1d1e1f$4776202a08bbe0b24e144cf05121978f220dacfb583485b5b90350c737e4719b')
on conflict (cpf) do update
set name = excluded.name,
    created_at = excluded.created_at,
    status = excluded.status,
    password_hash = excluded.password_hash;

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
alter table public.users enable row level security;

comment on table public.products is 'Acesso realizado pela API usando service role mantida somente no servidor.';
comment on table public.users is 'Senhas armazenadas como hashes PBKDF2; acesso somente pela API usando service role no servidor.';