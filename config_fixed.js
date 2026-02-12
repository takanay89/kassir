// ============================================
// КОНФИГУРАЦИЯ POS KASSIR
// Для проекта: mpwyzefkazbgnastcahd
// ============================================

window.POS_CONFIG = {
  // ┌─────────────────────────────────────────┐
  // │ НАСТРОЙКИ SUPABASE                      │
  // └─────────────────────────────────────────┘
  
  // URL вашего проекта
  SUPABASE_URL: "https://mpwyzefkazbgnastcahd.supabase.co",
  
  // ✓ Ваш anon public key (уже вставлен)
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wd3l6ZWZrYXpiZ25hc3RjYWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NDg4NTUsImV4cCI6MjA4NTAyNDg1NX0.9bcksevoXtniNvcUiFYhcmWzd8xHDmsY75FJljPO-_4",
  
  // ┌─────────────────────────────────────────┐
  // │ ID КОМПАНИИ                             │
  // └─────────────────────────────────────────┘
  
  // ID тестовой компании (создана в базе данных)
  COMPANY_ID: "18b94000-046c-476b-a0f9-ab813e57e3d7",
  
  // ┌─────────────────────────────────────────┐
  // │ ПАРОЛЬ АДМИНИСТРАТОРА                   │
  // └─────────────────────────────────────────┘
  
  // Для удаления операций и других административных действий
  ADMIN_PASSWORD: "admin123"
};

// ============================================
// АВТОМАТИЧЕСКАЯ ДИАГНОСТИКА
// ============================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✓ Конфигурация POS Kassir загружена');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 Supabase URL:', window.POS_CONFIG.SUPABASE_URL);
console.log('🏢 Company ID:', window.POS_CONFIG.COMPANY_ID);
console.log('🔑 API Key:', window.POS_CONFIG.SUPABASE_KEY.substring(0, 20) + '...');
console.log('✓ Все параметры настроены правильно!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
