-- =============================================
-- ФУНКЦИЯ ПРИХОДА ТОВАРА
-- =============================================
-- Эту миграцию нужно выполнить в Supabase SQL Editor

CREATE OR REPLACE FUNCTION create_purchase_document(
  p_company_id UUID,
  p_warehouse_id UUID,
  p_store_location_id UUID,
  p_payment_method UUID,
  p_supplier_name TEXT,
  p_comment TEXT,
  p_items JSONB -- [{"product_id": "...", "quantity": 10, "cost_price": 1000}]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_document_id UUID;
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_cost_price NUMERIC;
  v_total NUMERIC;
BEGIN
  -- Шаг 1: Создать документ прихода
  INSERT INTO purchase_documents (
    company_id,
    warehouse_id,
    payment_method,
    supplier_name,
    comment,
    document_date,
    document_time
  ) VALUES (
    p_company_id,
    p_warehouse_id,
    p_payment_method,
    p_supplier_name,
    p_comment,
    CURRENT_DATE,
    CURRENT_TIME
  )
  RETURNING id INTO v_document_id;

  -- Шаг 2: Обработать каждую позицию
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_cost_price := (v_item->>'cost_price')::NUMERIC;
    v_total := v_quantity * v_cost_price;

    -- 2a: Создать строку в purchase_document_items
    INSERT INTO purchase_document_items (
      document_id,
      product_id,
      quantity,
      cost_price,
      total
    ) VALUES (
      v_document_id,
      v_product_id,
      v_quantity,
      v_cost_price,
      v_total
    );

    -- 2b: Создать движение склада
    INSERT INTO stock_movements (
      company_id,
      product_id,
      type,
      reason,
      quantity,
      price,
      total,
      warehouse_id,
      store_location_id,
      purchase_document_id,
      operation_at,
      comment
    ) VALUES (
      p_company_id,
      v_product_id,
      'in',
      'purchase',
      v_quantity,
      v_cost_price,
      v_total,
      p_warehouse_id,
      p_store_location_id,
      v_document_id,
      NOW(),
      p_comment
    );

    -- 2c: Обновить остатки (UPSERT)
    -- Используем COALESCE для NULL-значений в уникальном ключе
    INSERT INTO product_balances (
      product_id,
      warehouse_id,
      store_location_id,
      quantity
    ) VALUES (
      v_product_id,
      p_warehouse_id,
      p_store_location_id,
      v_quantity
    )
    ON CONFLICT (product_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::UUID), COALESCE(store_location_id, '00000000-0000-0000-0000-000000000000'::UUID))
    DO UPDATE SET
      quantity = product_balances.quantity + EXCLUDED.quantity,
      updated_at = NOW();
  END LOOP;

  RETURN v_document_id;
END;
$$;

-- Права доступа
GRANT EXECUTE ON FUNCTION create_purchase_document TO authenticated;

COMMENT ON FUNCTION create_purchase_document IS 'Создает документ прихода, обновляет stock_movements и product_balances в транзакции';
