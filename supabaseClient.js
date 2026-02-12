import { createClient } from '@supabase/supabase-js';

// Получаем переменные окружения из .env файла
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Проверка наличия переменных окружения
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('❌ Отсутствуют переменные окружения VITE_SUPABASE_URL или VITE_SUPABASE_ANON_KEY. Проверьте файл .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);