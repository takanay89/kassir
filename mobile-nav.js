// ============================================
// MOBILE NAVIGATION SYNC FIX (SAFE VERSION)
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

// НЕ переопределяем showSection!
// Просто слушаем клики и обновляем меню
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-section]');
  if (!btn) return;

  const section = btn.getAttribute('data-section');
  if (section) {
    setTimeout(() => updateMobileNavigation(section), 0);
  }
});

window.updateMobileNavigation = updateMobileNavigation;
