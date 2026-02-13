/* ==============================================
   MOBILE NAVIGATION SCRIPT
   Безопасный скрипт для нижнего меню и drawer
   НЕ ТРОГАЕТ бизнес-логику
   ============================================== */

(function() {
  'use strict';

  // Проверяем что мы на мобильном
  function isMobile() {
    return window.innerWidth <= 768;
  }

  // Инициализация мобильной навигации
  function initMobileNav() {
    if (!isMobile()) return;

    // Помечаем что JS загрузился - теперь можно скрыть старый sidebar
    document.body.classList.add('mobile-nav-loaded');

    // Создаём нижнее меню
    createBottomNav();
    
    // Создаём hamburger кнопку
    createHamburgerButton();
    
    // Создаём drawer меню
    createDrawer();
    
    // Устанавливаем обработчики
    setupEventListeners();
  }

  // Создание нижнего меню (5 основных разделов)
  function createBottomNav() {
    // Проверяем что ещё не создано
    if (document.querySelector('.mobile-bottom-nav')) return;

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

    const nav = document.createElement('div');
    nav.className = 'mobile-bottom-nav';
    nav.innerHTML = buttons.join('');

    document.body.appendChild(nav);

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
  }

  // Создание hamburger кнопки
  function createHamburgerButton() {
    if (document.querySelector('.mobile-hamburger-btn')) return;

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
  }

  // Создание drawer меню
  function createDrawer() {
    if (document.querySelector('.mobile-drawer-overlay')) return;

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

  // Инициализация при загрузке
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNav);
  } else {
    initMobileNav();
  }
})();
