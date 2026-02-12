-- ============================================
-- ИСПРАВЛЕНИЕ ОШИБОК БЕЗ ИЗМЕНЕНИЯ ДАННЫХ
-- Только исправляет политики RLS и создает VIEW
-- НЕ ТРОГАЕТ ваши существующие данные!
-- ============================================

-- ┌─────────────────────────────────────────┐
-- │ 1. ИСПРАВЛЕНИЕ ПОЛИТИК RLS              │
-- │    (убираем infinite recursion)         │
-- └─────────────────────────────────────────┘

-- Удаляем проблемные политики
DROP POLICY IF EXISTS "Users can view their company users" ON company_users;
DROP POLICY IF EXISTS "Users can insert company users" ON company_users;
DROP POLICY IF EXISTS "Users can update their company users" ON company_users;
DROP POLICY IF EXISTS "Users can delete company users" ON company_users;

-- Создаем исправленные политики БЕЗ рекурсии
CREATE POLICY "Users can view their company users"
ON company_users FOR SELECT
USING (
  company_id IN (
    SELECT company_id 
    FROM companies 
    WHERE id = company_users.company_id
  )
  OR
  auth.uid() = user_id
);

CREATE POLICY "Users can insert company users"
ON company_users FOR INSERT
WITH CHECK (
  company_id IN (
    SELECT company_id 
    FROM companies 
    WHERE id = company_id
  )
);

CREATE POLICY "Users can update their company users"
ON company_users FOR UPDATE
USING (
  company_id IN (
    SELECT company_id 
    FROM companies 
    WHERE id = company_users.company_id
  )
  OR
  auth.uid() = user_id
)
WITH CHECK (
  company_id IN (
    SELECT company_id 
    FROM companies 
    WHERE id = company_id
  )
);

CREATE POLICY "Users can delete company users"
ON company_users FOR DELETE
USING (
  company_id IN (
    SELECT company_id 
    FROM companies 
    WHERE id = company_users.company_id
  )
);

-- ┌─────────────────────────────────────────┐
-- │ 2. СОЗДАНИЕ VIEW products_with_stock    │
-- │    (для отображения товаров с остатками)│
-- └─────────────────────────────────────────┘

-- Удаляем старый VIEW если есть
DROP VIEW IF EXISTS products_with_stock;

-- Создаем VIEW для автоматического подсчета остатков
CREATE OR REPLACE VIEW products_with_stock AS
SELECT 
  p.id,
  p.company_id,
  p.name,
  p.sku,
  p.category,
  p.cost_price,
  p.sell_price,
  p.active,
  p.created_at,
  p.updated_at,
  p.deleted_at,
  COALESCE(
    (SELECT SUM(
      CASE 
        WHEN sm.type IN ('in', 'initial', 'return') THEN sm.quantity
        WHEN sm.type IN ('out', 'writeoff', 'supplier_return') THEN -sm.quantity
        ELSE 0
      END
    )
    FROM stock_movements sm
    WHERE sm.product_id = p.id
      AND sm.deleted_at IS NULL
    ), 0
  ) as available_qty
FROM products p
WHERE p.deleted_at IS NULL;

-- Даем права на чтение
GRANT SELECT ON products_with_stock TO authenticated;
GRANT SELECT ON products_with_stock TO anon;

-- ┌─────────────────────────────────────────┐
-- │ 3. СОЗДАНИЕ ИНДЕКСОВ                    │
-- │    (для быстрой работы)                 │
-- └─────────────────────────────────────────┘

-- Индексы для stock_movements
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id 
  ON stock_movements(product_id) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_company_id 
  ON stock_movements(company_id) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_type 
  ON stock_movements(type);

-- Индексы для products
CREATE INDEX IF NOT EXISTS idx_products_company_id 
  ON products(company_id) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_active 
  ON products(active) 
  WHERE deleted_at IS NULL AND active = true;

-- Индексы для transactions
CREATE INDEX IF NOT EXISTS idx_transactions_company_id 
  ON transactions(company_id) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_created_at 
  ON transactions(created_at DESC);

-- Индексы для company_users
CREATE INDEX IF NOT EXISTS idx_company_users_company_id 
  ON company_users(company_id);

CREATE INDEX IF NOT EXISTS idx_company_users_user_id 
  ON company_users(user_id);

-- ┌─────────────────────────────────────────┐
-- │ 4. ПРОВЕРКА РЕЗУЛЬТАТА                  │
-- └─────────────────────────────────────────┘

-- Проверяем VIEW (покажет ВАШИ товары)
SELECT 
  id,
  name,
  sku,
  category,
  sell_price,
  available_qty
FROM products_with_stock 
LIMIT 10;

-- ============================================
-- ГОТОВО! 
-- Ваши данные НЕ изменены
-- Исправлены только ошибки
-- ============================================
