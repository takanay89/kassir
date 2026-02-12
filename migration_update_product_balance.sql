-- =============================================
-- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ ОСТАТКОВ
-- =============================================
-- Эту миграцию нужно выполнить в Supabase SQL Editor

CREATE OR REPLACE FUNCTION update_product_balance(
  p_product_id UUID,
  p_warehouse_id UUID,
  p_store_location_id UUID,
  p_quantity_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Обновить остатки (UPSERT)
  INSERT INTO product_balances (
    product_id,
    warehouse_id,
    store_location_id,
    quantity
  ) VALUES (
    p_product_id,
    p_warehouse_id,
    p_store_location_id,
    p_quantity_delta
  )
  ON CONFLICT (product_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::UUID), COALESCE(store_location_id, '00000000-0000-0000-0000-000000000000'::UUID))
  DO UPDATE SET
    quantity = product_balances.quantity + EXCLUDED.quantity,
    updated_at = NOW();
    
  -- Проверка на отрицательные остатки
  IF (SELECT quantity FROM product_balances 
      WHERE product_id = p_product_id 
      AND COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::UUID) = COALESCE(p_warehouse_id, '00000000-0000-0000-0000-000000000000'::UUID)
      AND COALESCE(store_location_id, '00000000-0000-0000-0000-000000000000'::UUID) = COALESCE(p_store_location_id, '00000000-0000-0000-0000-000000000000'::UUID)
     ) < 0 THEN
    RAISE EXCEPTION 'Недостаточно товара на складе (product_id: %)', p_product_id;
  END IF;
END;
$$;

-- Права доступа
GRANT EXECUTE ON FUNCTION update_product_balance TO authenticated;

COMMENT ON FUNCTION update_product_balance IS 'Обновляет остатки товара с проверкой на отрицательные значения';
