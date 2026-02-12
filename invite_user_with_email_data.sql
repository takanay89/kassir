-- Обновляем функцию invite_user для отправки email через Supabase Edge Function
DROP FUNCTION IF EXISTS invite_user(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION invite_user(
  p_company_id UUID,
  p_email TEXT,
  p_role TEXT,
  p_invited_by UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token TEXT;
  v_company_name TEXT;
  v_inviter_name TEXT;
  v_invitation_id UUID;
BEGIN
  -- Проверяем, что роль валидна
  IF p_role NOT IN ('admin', 'manager', 'cashier', 'accountant', 'warehouse', 'seller') THEN
    RAISE EXCEPTION 'Недопустимая роль: %', p_role;
  END IF;

  -- Проверяем, что пользователь имеет право приглашать
  IF NOT EXISTS (
    SELECT 1 
    FROM company_users 
    WHERE company_id = p_company_id 
      AND user_id = p_invited_by 
      AND role IN ('owner', 'admin')
      AND active = true
  ) THEN
    RAISE EXCEPTION 'У вас нет прав для приглашения пользователей';
  END IF;

  -- Получаем название компании
  SELECT name INTO v_company_name
  FROM companies
  WHERE id = p_company_id;

  -- Получаем имя пригласившего
  SELECT COALESCE(full_name, email, 'Администратор') INTO v_inviter_name
  FROM user_profiles
  WHERE id = p_invited_by;

  -- Проверяем, нет ли активного приглашения
  IF EXISTS (
    SELECT 1 
    FROM user_invitations 
    WHERE company_id = p_company_id 
      AND email = p_email 
      AND accepted_at IS NULL 
      AND expires_at > NOW()
  ) THEN
    RAISE EXCEPTION 'Для этого email уже существует активное приглашение';
  END IF;

  -- Генерируем токен
  v_token := encode(gen_random_bytes(32), 'hex');

  -- Создаём приглашение
  INSERT INTO user_invitations (
    company_id,
    email,
    role,
    invited_by,
    token,
    expires_at,
    created_at
  )
  VALUES (
    p_company_id,
    p_email,
    p_role,
    p_invited_by,
    v_token,
    NOW() + INTERVAL '7 days',
    NOW()
  )
  RETURNING id INTO v_invitation_id;

  -- Возвращаем данные для отправки email на фронтенде
  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', v_invitation_id,
    'token', v_token,
    'email', p_email,
    'company_name', v_company_name,
    'inviter_name', v_inviter_name,
    'role', p_role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION invite_user(UUID, TEXT, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION invite_user IS 'Создаёт приглашение и возвращает данные для отправки email';
