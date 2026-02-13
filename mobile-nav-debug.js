/* ==============================================
   MOBILE NAVIGATION SCRIPT - ДИАГНОСТИЧЕСКАЯ ВЕРСИЯ
   Безопасный скрипт для нижнего меню и drawer
   НЕ ТРОГАЕТ бизнес-логику
   ============================================== */

// ✅ ЛОГ #1 - Файл начал парситься
console.log('🟢 [mobile-nav] #1 Файл загрузился и парсится');

(function() {
  'use strict';

  // ✅ ЛОГ #2 - IIFE запустилась
  console.log('🟢 [mobile-nav] #2 IIFE запустилась');

  // Проверяем что мы на мобильном
  function isMobile() {
    return window.innerWidth <= 768;
  }

  // Инициализация мобильной навигации
  function initMobileNav() {
    // ✅ ЛОГ #3 - initMobileNav вызвана
    console.log('🟢 [mobile-nav] #3 initMobileNav() вызвана');
    console.log('📊 window.innerWidth:', window.innerWidth);
    console.log('📊 isMobile():', isMobile());
    
    if (!isMobile()) {
      // ✅ ЛОГ #4 - Остановка по условию desktop
      console.log('🔴 [mobile-nav] #4 Остановка: не mobile (innerWidth > 768)');
      return;
    }

    // ✅ ЛОГ #5 - Прошли проверку isMobile
    console.log('🟢 [mobile-nav] #5 Проверка isMobile пройдена');

    try {
      // ✅ ЛОГ #6 - Начинаем добавлять класс
      console.log('🟢 [mobile-nav] #6 Добавляем класс mobile-nav-loaded');
      console.log('📊 document.body:', document.body);
      
      document.body.classList.add('mobile-nav-loaded');
      
      // ✅ ЛОГ #7 - Класс добавлен
      console.log('🟢 [mobile-nav] #7 Класс mobile-nav-loaded добавлен успешно');
    } catch (e) {
      // ✅ ЛОГ #ERROR-1 - Ошибка при добавлении класса
      console.error('🔥 [mobile-nav] ERROR-1 Ошибка при добавлении класса:', e);
      return;
    }

    // ✅ ЛОГ #8 - Вызываем createBottomNav
    console.log('🟢 [mobile-nav] #8 Вызываем createBottomNav()');
    
    try {
      createBottomNav();
      // ✅ ЛОГ #9 - createBottomNav завершена
      console.log('🟢 [mobile-nav] #9 createBottomNav() завершена');
    } catch (e) {
      // ✅ ЛОГ #ERROR-2 - Ошибка в createBottomNav
      console.error('🔥 [mobile-nav] ERROR-2 Ошибка в createBottomNav:', e);
    }
    
    // ✅ ЛОГ #10 - Вызываем createHamburgerButton
    console.log('🟢 [mobile-nav] #10 Вызываем createHamburgerButton()');
    
    try {
      createHamburgerButton();
      // ✅ ЛОГ #11 - createHamburgerButton завершена
      console.log('🟢 [mobile-nav] #11 createHamburgerButton() завершена');
    } catch (e) {
      // ✅ ЛОГ #ERROR-3 - Ошибка в createHamburgerButton
      console.error('🔥 [mobile-nav] ERROR-3 Ошибка в createHamburgerButton:', e);
    }
    
    // ✅ ЛОГ #12 - Вызываем createDrawer
    console.log('🟢 [mobile-nav] #12 Вызываем createDrawer()');
    
    try {
      createDrawer();
      // ✅ ЛОГ #13 - createDrawer завершена
      console.log('🟢 [mobile-nav] #13 createDrawer() завершена');
    } catch (e) {
      // ✅ ЛОГ #ERROR-4 - Ошибка в createDrawer
      console.error('🔥 [mobile-nav] ERROR-4 Ошибка в createDrawer:', e);
    }
    
    // ✅ ЛОГ #14 - Вызываем setupEventListeners
    console.log('🟢 [mobile-nav] #14 Вызываем setupEventListeners()');
    
    try {
      setupEventListeners();
      // ✅ ЛОГ #15 - setupEventListeners завершена
      console.log('🟢 [mobile-nav] #15 setupEventListeners() завершена');
    } catch (e) {
      // ✅ ЛОГ #ERROR-5 - Ошибка в setupEventListeners
      console.error('🔥 [mobile-nav] ERROR-5 Ошибка в setupEventListeners:', e);
    }

    // ✅ ЛОГ #16 - initMobileNav полностью завершена
    console.log('✅ [mobile-nav] #16 initMobileNav() ПОЛНОСТЬЮ ЗАВЕРШЕНА');
    
    // Визуальная индикация на экране
    setTimeout(function() {
      const indicator = document.createElement('div');
      indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#10b981;color:white;padding:10px;z-index:99999;font-size:12px;text-align:center;';
      indicator.textContent = '✅ Mobile Nav загружена успешно!';
      document.body.appendChild(indicator);
      setTimeout(() => indicator.remove(), 3000);
    }, 500);
  }

  // Создание нижнего меню (5 основных разделов)
  function createBottomNav() {
    // ✅ ЛОГ #17 - Начало createBottomNav
    console.log('🟢 [mobile-nav] #17 createBottomNav: начало');
    
    // Проверяем что ещё не создано
    if (document.querySelector('.mobile-bottom-nav')) {
      // ✅ ЛОГ #18 - Уже существует
      console.log('⚠️ [mobile-nav] #18 createBottomNav: уже существует, выход');
      return;
    }

    // ✅ ЛОГ #19 - Проверяем роли
    console.log('🟢 [mobile-nav] #19 createBottomNav: проверяем роли');
    console.log('📊 window.USER_ROLE:', window.USER_ROLE);

    // Проверяем роли пользователя
    const userRole = window.USER_ROLE || 'cashier';
    const ROLE_PERMISSIONS = {
      owner:      ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money', 'settings'],
      admin:      ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money', 'settings'],
      manager:    ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money'],
      cashier:    ['trading', 'clients'],
      warehouse:  ['products', 'suppliers'],
      accountant: ['expenses', 'reports', 'money'],
      seller:     ['trading', 'clients'],
    };
    const allowedSections = ROLE_PERMISSIONS[userRole] || ROLE_PERMISSIONS['cashier'];
    
    console.log('📊 userRole:', userRole);
    console.log('📊 allowedSections:', allowedSections);

    // ✅ ЛОГ #20 - Формируем кнопки
    console.log('🟢 [mobile-nav] #20 createBottomNav: формируем кнопки');

    // Формируем кнопки только для разрешённых разделов
    const buttons = [];
    
    if (allowedSections.includes('trading')) {
      buttons.push(`
        <button class="mobile-nav-item ${buttons.length === 0 ? 'active' : ''}" data-section="trading">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          <span>Касса</span>
        </button>
      `);
    }
    
    if (allowedSections.includes('products')) {
      buttons.push(`
        <button class="mobile-nav-item ${buttons.length === 0 ? 'active' : ''}" data-section="products">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
          <span>Склад</span>
        </button>
      `);
    }
    
    if (allowedSections.includes('expenses')) {
      buttons.push(`
        <button class="mobile-nav-item ${buttons.length === 0 ? 'active' : ''}" data-section="expenses">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span>Расходы</span>
        </button>
      `);
    }
    
    if (allowedSections.includes('money')) {
      buttons.push(`
        <button class="mobile-nav-item ${buttons.length === 0 ? 'active' : ''}" data-section="money">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          <span>Деньги</span>
        </button>
      `);
    }
    
    if (allowedSections.includes('reports')) {
      buttons.push(`
        <button class="mobile-nav-item ${buttons.length === 0 ? 'active' : ''}" data-section="reports">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <span>Отчёты</span>
        </button>
      `);
    }

    console.log('📊 buttons.length:', buttons.length);

    // ✅ ЛОГ #21 - Создаём nav элемент
    console.log('🟢 [mobile-nav] #21 createBottomNav: создаём nav элемент');

    const nav = document.createElement('div');
    nav.className = 'mobile-bottom-nav';
    nav.innerHTML = buttons.join('');

    // ✅ ЛОГ #22 - Добавляем в body
    console.log('🟢 [mobile-nav] #22 createBottomNav: добавляем в body');

    document.body.appendChild(nav);

    // ✅ ЛОГ #23 - Проверяем что добавилось
    console.log('🟢 [mobile-nav] #23 createBottomNav: проверяем DOM');
    console.log('📊 document.querySelector(".mobile-bottom-nav"):', document.querySelector('.mobile-bottom-nav'));

    // ✅ ЛОГ #24 - Добавляем listeners
    console.log('🟢 [mobile-nav] #24 createBottomNav: добавляем listeners');

    // Обработчики кликов на кнопки нижнего меню
    nav.querySelectorAll('.mobile-nav-item').forEach(btn => {
      btn.addEventListener('click', function() {
        const section = this.dataset.section;
        
        // Убираем active со всех кнопок
        nav.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
        
        // Добавляем active на текущую
        this.classList.add('active');
        
        // Вызываем существующую функцию showSection
        if (typeof window.showSection === 'function') {
          window.showSection(section);
        }
      });
    });

    // ✅ ЛОГ #25 - createBottomNav завершена
    console.log('🟢 [mobile-nav] #25 createBottomNav: завершена');
  }

  // Создание hamburger кнопки
  function createHamburgerButton() {
    // ✅ ЛОГ #26 - Начало createHamburgerButton
    console.log('🟢 [mobile-nav] #26 createHamburgerButton: начало');
    
    if (document.querySelector('.mobile-hamburger-btn')) {
      console.log('⚠️ [mobile-nav] #27 createHamburgerButton: уже существует');
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'mobile-hamburger-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    `;

    btn.addEventListener('click', toggleDrawer);
    document.body.appendChild(btn);

    console.log('🟢 [mobile-nav] #28 createHamburgerButton: завершена');
  }

  // Создание drawer меню
  function createDrawer() {
    // ✅ ЛОГ #29 - Начало createDrawer
    console.log('🟢 [mobile-nav] #29 createDrawer: начало');
    
    if (document.querySelector('.mobile-drawer-overlay')) {
      console.log('⚠️ [mobile-nav] #30 createDrawer: уже существует');
      return;
    }

    // Проверяем роли для drawer
    const userRole = window.USER_ROLE || 'cashier';
    const ROLE_PERMISSIONS = {
      owner:      ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money', 'settings'],
      admin:      ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money', 'settings'],
      manager:    ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money'],
      cashier:    ['trading', 'clients'],
      warehouse:  ['products', 'suppliers'],
      accountant: ['expenses', 'reports', 'money'],
      seller:     ['trading', 'clients'],
    };
    const allowedSections = ROLE_PERMISSIONS[userRole] || ROLE_PERMISSIONS['cashier'];

    // Формируем пункты меню
    const menuItems = [];
    
    if (allowedSections.includes('clients')) {
      menuItems.push(`
        <button class="mobile-drawer-item" data-section="clients">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span>Клиенты</span>
        </button>
      `);
    }
    
    if (allowedSections.includes('suppliers')) {
      menuItems.push(`
        <button class="mobile-drawer-item" data-section="suppliers">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
            <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
          </svg>
          <span>Поставщики</span>
        </button>
      `);
    }
    
    if (allowedSections.includes('settings')) {
      if (menuItems.length > 0) {
        menuItems.push(`<div class="mobile-drawer-divider"></div>`);
      }
      menuItems.push(`
        <button class="mobile-drawer-item" data-section="settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
          </svg>
          <span>Настройки</span>
        </button>
      `);
    }

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'mobile-drawer-overlay';
    overlay.addEventListener('click', closeDrawer);

    // Drawer
    const drawer = document.createElement('div');
    drawer.className = 'mobile-drawer';
    drawer.innerHTML = `
      <div class="mobile-drawer-header">
        <div class="mobile-drawer-logo">Kassir</div>
        <div class="mobile-drawer-subtitle">POS система</div>
      </div>
      
      <div class="mobile-drawer-menu">
        ${menuItems.join('')}
      </div>
    `;

    // Обработчики для drawer пунктов
    drawer.querySelectorAll('.mobile-drawer-item').forEach(btn => {
      btn.addEventListener('click', function() {
        const section = this.dataset.section;
        
        // Вызываем существующую функцию showSection
        if (typeof window.showSection === 'function') {
          window.showSection(section);
        }
        
        // Закрываем drawer
        closeDrawer();
        
        // Обновляем active состояние в нижнем меню (если нужно)
        updateBottomNavActive(section);
      });
    });

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    console.log('🟢 [mobile-nav] #31 createDrawer: завершена');
  }

  // Открыть/закрыть drawer
  function toggleDrawer() {
    const overlay = document.querySelector('.mobile-drawer-overlay');
    const drawer = document.querySelector('.mobile-drawer');
    
    if (overlay && drawer) {
      const isActive = overlay.classList.contains('active');
      
      if (isActive) {
        closeDrawer();
      } else {
        openDrawer();
      }
    }
  }

  function openDrawer() {
    const overlay = document.querySelector('.mobile-drawer-overlay');
    const drawer = document.querySelector('.mobile-drawer');
    
    if (overlay && drawer) {
      overlay.classList.add('active');
      drawer.classList.add('active');
      
      // Блокируем скролл body ТОЛЬКО если нет активных модалок
      const hasActiveModal = document.querySelector('.modal.active');
      if (!hasActiveModal) {
        document.body.style.overflow = 'hidden';
      }
    }
  }

  function closeDrawer() {
    const overlay = document.querySelector('.mobile-drawer-overlay');
    const drawer = document.querySelector('.mobile-drawer');
    
    if (overlay && drawer) {
      overlay.classList.remove('active');
      drawer.classList.remove('active');
      
      // Разблокируем скролл body ТОЛЬКО если нет активных модалок
      const hasActiveModal = document.querySelector('.modal.active');
      if (!hasActiveModal) {
        document.body.style.overflow = '';
      }
    }
  }

  // Обновить active состояние в нижнем меню
  function updateBottomNavActive(section) {
    const bottomNav = document.querySelector('.mobile-bottom-nav');
    if (!bottomNav) return;

    // Убираем active со всех
    bottomNav.querySelectorAll('.mobile-nav-item').forEach(btn => {
      btn.classList.remove('active');
    });

    // Добавляем active если раздел есть в нижнем меню
    const activeBtn = bottomNav.querySelector(`[data-section="${section}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }
  }

  // Установка обработчиков событий
  function setupEventListeners() {
    console.log('🟢 [mobile-nav] #32 setupEventListeners: начало');
    
    // При изменении размера окна
    window.addEventListener('resize', function() {
      if (!isMobile()) {
        // Если вернулись на desktop - удаляем мобильную навигацию
        removeMobileNav();
      } else {
        // Если перешли на mobile - создаём навигацию
        initMobileNav();
      }
    });

    // Закрытие drawer при нажатии ESC
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeDrawer();
      }
    });
    
    console.log('🟢 [mobile-nav] #33 setupEventListeners: завершена');
  }

  // Удаление мобильной навигации (при переходе на desktop)
  function removeMobileNav() {
    const bottomNav = document.querySelector('.mobile-bottom-nav');
    const hamburger = document.querySelector('.mobile-hamburger-btn');
    const overlay = document.querySelector('.mobile-drawer-overlay');
    const drawer = document.querySelector('.mobile-drawer');

    if (bottomNav) bottomNav.remove();
    if (hamburger) hamburger.remove();
    if (overlay) overlay.remove();
    if (drawer) drawer.remove();

    // Разблокируем скролл
    document.body.style.overflow = '';
    
    // Убираем класс
    document.body.classList.remove('mobile-nav-loaded');
  }

  // Экспортируем функции в window для возможного использования
  window.MobileNav = {
    init: initMobileNav,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    toggleDrawer: toggleDrawer,
    isMobile: isMobile
  };

  // ✅ ЛОГ #34 - Перед запуском инициализации
  console.log('🟢 [mobile-nav] #34 Проверяем document.readyState');
  console.log('📊 document.readyState:', document.readyState);

  // Инициализация при загрузке
  if (document.readyState === 'loading') {
    // ✅ ЛОГ #35 - Ждём DOMContentLoaded
    console.log('🟢 [mobile-nav] #35 Ждём DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', function() {
      console.log('🟢 [mobile-nav] #36 DOMContentLoaded fired, вызываем init');
      initMobileNav();
    });
  } else {
    // ✅ ЛОГ #37 - DOM готов, запускаем сразу
    console.log('🟢 [mobile-nav] #37 DOM готов, запускаем init сразу');
    initMobileNav();
  }

  // ✅ ЛОГ #38 - IIFE завершена
  console.log('🟢 [mobile-nav] #38 IIFE завершена');
})();

// ✅ ЛОГ #39 - Файл полностью выполнен
console.log('🟢 [mobile-nav] #39 Файл полностью выполнен');

// Визуальная индикация на экране (для телефона)
setTimeout(function() {
  const hasNav = !!document.querySelector('.mobile-bottom-nav');
  const hasClass = document.body && document.body.classList.contains('mobile-nav-loaded');
  const width = window.innerWidth;
  
  const indicator = document.createElement('div');
  indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;background:' + (hasNav ? '#10b981' : '#ef4444') + ';color:white;padding:10px;z-index:99999;font-size:11px;text-align:center;font-family:monospace;';
  indicator.innerHTML = `
    Mobile Nav Debug:<br>
    nav=${hasNav} | class=${hasClass} | width=${width}
  `;
  
  if (document.body) {
    document.body.appendChild(indicator);
    setTimeout(() => indicator.remove(), 5000);
  }
}, 1000);
