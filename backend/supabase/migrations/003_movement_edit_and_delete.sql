create index if not exists idx_stock_movements_created_active
    on public.stock_movements (created_at desc)
    where is_active;

create or replace function public.update_stock_movement(
    p_movement_id uuid,
    p_type text,
    p_quantity numeric,
    p_reason text
)
returns setof public.stock_movements
language plpgsql
set search_path = public, pg_temp
as $$
declare
    movement_product_id uuid;
    movement_record public.stock_movements%rowtype;
    resulting_stock numeric(12, 3);
    opening_stock numeric;
begin
    if p_type is null or p_type not in ('entry', 'exit') then
        raise exception 'Tipo de movimentação inválido.' using errcode = '22023';
    end if;
    if p_quantity is null or p_quantity <= 0 or p_quantity > 999999999.999 or round(p_quantity, 3) <> p_quantity then
        raise exception 'A quantidade deve ser maior que zero e respeitar numeric(12,3).' using errcode = '22023';
    end if;
    if length(p_reason) > 250 then
        raise exception 'O motivo deve ter no máximo 250 caracteres.' using errcode = '22023';
    end if;

    select product_id into movement_product_id
      from public.stock_movements
     where id = p_movement_id and is_active;
    if not found then
        raise exception 'Movimentação não encontrada.' using errcode = 'P0002';
    end if;

    perform 1 from public.products where id = movement_product_id and is_active for update;
    if not found then
        raise exception 'Produto da movimentação não encontrado ou inativo.' using errcode = 'P0002';
    end if;

    select * into movement_record
      from public.stock_movements
     where id = p_movement_id and is_active
     for update;
    if not found then
        raise exception 'Movimentação não encontrada.' using errcode = 'P0002';
    end if;

    update public.products
       set current_stock = current_stock
             + case when p_type = 'entry' then p_quantity else -p_quantity end
             - case when movement_record.type = 'entry' then movement_record.quantity else -movement_record.quantity end,
           updated_at = now()
     where id = movement_product_id
       and current_stock
             + case when p_type = 'entry' then p_quantity else -p_quantity end
             - case when movement_record.type = 'entry' then movement_record.quantity else -movement_record.quantity end >= 0
     returning current_stock into resulting_stock;
    if not found then
        raise exception 'A alteração deixaria o estoque negativo.' using errcode = '22023';
    end if;

    update public.stock_movements
       set type = p_type,
           quantity = p_quantity,
           reason = nullif(btrim(p_reason), '')
     where id = p_movement_id;

    select resulting_stock - coalesce(sum(
               case when type = 'entry' then quantity else -quantity end
           ), 0)
      into opening_stock
      from public.stock_movements
     where product_id = movement_product_id and is_active;

    if exists (
        select 1
          from (
              select opening_stock + sum(
                         case when type = 'entry' then quantity else -quantity end
                     ) over (order by created_at, id) as balance
                from public.stock_movements
               where product_id = movement_product_id and is_active
          ) balances
         where balance < 0
    ) then
        raise exception 'A alteração faria o estoque histórico ficar negativo.' using errcode = '22023';
    end if;

    with balances as (
        select id,
               opening_stock + sum(
                   case when type = 'entry' then quantity else -quantity end
               ) over (order by created_at, id) as balance_after
          from public.stock_movements
         where product_id = movement_product_id and is_active
    )
    update public.stock_movements movement
       set balance_after = balances.balance_after
      from balances
     where movement.id = balances.id;

    return query select * from public.stock_movements where id = p_movement_id;
end;
$$;

create or replace function public.delete_stock_movement(p_movement_id uuid)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
    movement_product_id uuid;
    movement_record public.stock_movements%rowtype;
    resulting_stock numeric(12, 3);
    opening_stock numeric;
begin
    select product_id into movement_product_id
      from public.stock_movements
     where id = p_movement_id and is_active;
    if not found then
        raise exception 'Movimentação não encontrada.' using errcode = 'P0002';
    end if;

    perform 1 from public.products where id = movement_product_id and is_active for update;
    if not found then
        raise exception 'Produto da movimentação não encontrado ou inativo.' using errcode = 'P0002';
    end if;

    select * into movement_record
      from public.stock_movements
     where id = p_movement_id and is_active
     for update;
    if not found then
        raise exception 'Movimentação não encontrada.' using errcode = 'P0002';
    end if;

    update public.products
       set current_stock = current_stock
             - case when movement_record.type = 'entry' then movement_record.quantity else -movement_record.quantity end,
           updated_at = now()
     where id = movement_product_id
       and current_stock
             - case when movement_record.type = 'entry' then movement_record.quantity else -movement_record.quantity end >= 0
     returning current_stock into resulting_stock;
    if not found then
        raise exception 'A exclusão deixaria o estoque negativo.' using errcode = '22023';
    end if;

    update public.stock_movements set is_active = false where id = p_movement_id;

    select resulting_stock - coalesce(sum(
               case when type = 'entry' then quantity else -quantity end
           ), 0)
      into opening_stock
      from public.stock_movements
     where product_id = movement_product_id and is_active;

    if exists (
        select 1
          from (
              select opening_stock + sum(
                         case when type = 'entry' then quantity else -quantity end
                     ) over (order by created_at, id) as balance
                from public.stock_movements
               where product_id = movement_product_id and is_active
          ) balances
         where balance < 0
    ) then
        raise exception 'A exclusão faria o estoque histórico ficar negativo.' using errcode = '22023';
    end if;

    with balances as (
        select id,
               opening_stock + sum(
                   case when type = 'entry' then quantity else -quantity end
               ) over (order by created_at, id) as balance_after
          from public.stock_movements
         where product_id = movement_product_id and is_active
    )
    update public.stock_movements movement
       set balance_after = balances.balance_after
      from balances
     where movement.id = balances.id;

    return true;
end;
$$;

revoke all on function public.update_stock_movement(uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.delete_stock_movement(uuid) from public, anon, authenticated;
grant execute on function public.update_stock_movement(uuid, text, numeric, text) to service_role;
grant execute on function public.delete_stock_movement(uuid) to service_role;
