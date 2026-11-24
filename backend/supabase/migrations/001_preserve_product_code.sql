do $$
declare
    code_type text;
    code_identity text;
begin
    select data_type, is_identity
      into code_type, code_identity
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'code';

    if not found then
        alter table public.products
            add column code bigint generated always as identity;
    else
        if code_type <> 'bigint' then
            alter table public.products
                alter column code type bigint using code::bigint;
        end if;

        if code_identity <> 'YES' then
            create sequence if not exists public.products_code_seq;
            alter sequence public.products_code_seq owned by public.products.code;
            alter table public.products
                alter column code set default nextval('public.products_code_seq');
            perform setval(
                'public.products_code_seq',
                greatest(coalesce((select max(code) from public.products), 0), 1),
                exists(select 1 from public.products)
            );
        end if;
    end if;
end;
$$;

create unique index if not exists products_code_key on public.products (code);
