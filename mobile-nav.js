// ============================================
// MOBILE NAVIGATION SYNC FIX (STABLE)
// ============================================

// Ждём, пока оригинальная showSection появится
function waitForShowSection() {
  if (typeof window.showSection !== 'function') {
    setTimeout(waitForShowSection, 20);
    return;
  }

  const originalShowSection = window.showSection;

  window.showSection = function(section) {
    // вызываем оригинал
    originalShowSection(section);

    // синхронизация мобильной навигации
    updateMobileNavigation(section);
  };
}

function updateMobileNavigation(section) {
  const mobileItems = document.querySelectorAll('.mobile-nav-item');
  mobileItems.forEach(item => {
    item.classList.toggle('active', item.dataset.section === section);
  });
}

// Экспорт
window.updateMobileNavigation = updateMobileNavigation;

// Старт
waitForShowSection();
