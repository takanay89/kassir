// ============================================
// MOBILE NAVIGATION SYNC FIX
// ============================================

function updateMobileNavigation(section) {
  const mobileItems = document.querySelectorAll('.mobile-nav-item');
  mobileItems.forEach(item => {
    if (item.dataset.section === section) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// Ждём пока script.js загрузится и создаст showSection
// Затем оборачиваем его чтобы добавить обновление мобильной навигации
function patchShowSection() {
  const original = window.showSection;
  if (typeof original !== 'function') {
    // script.js ещё не загрузился, ждём
    setTimeout(patchShowSection, 50);
    return;
  }

  // Проверяем что ещё не патчили
  if (original._mobilePatched) return;

  window.showSection = function(section) {
    original(section);
    updateMobileNavigation(section);
  };
  window.showSection._mobilePatched = true;

  console.log('✅ Mobile nav patched');
}

// Запускаем патч
patchShowSection();

// Экспорт
window.updateMobileNavigation = updateMobileNavigation;
