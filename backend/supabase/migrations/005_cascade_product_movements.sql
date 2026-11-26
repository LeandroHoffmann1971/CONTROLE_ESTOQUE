do $$
declare
    product_id_attnum smallint;
    constraint_record record;
begin
    select attnum into product_id_attnum
      from pg_attribute
     where attrelid = 'public.stock_movements'::regclass
       and attname = 'product_id'
       and not attisdropped;

    for constraint_record in
        select conname
          from pg_constraint
         where conrelid = 'public.stock_movements'::regclass
           and confrelid = 'public.products'::regclass
           and contype = 'f'
           and array_length(conkey, 1) = 1
           and product_id_attnum = any(conkey)
    loop
        execute format(
            'alter table public.stock_movements drop constraint %I',
            constraint_record.conname
        );
    end loop;

    alter table public.stock_movements
        add constraint stock_movements_product_id_fkey
        foreign key (product_id)
        references public.products(id)
        on delete cascade;
end;
$$;
