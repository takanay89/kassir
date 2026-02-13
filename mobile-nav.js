// ============================================
// MOBILE NAVIGATION SYNC FIX
// ============================================

// Store original showSection if it exists
const originalShowSection = window.showSection;

// Override showSection to update mobile nav
window.showSection = function(section) {
  // Call original showSection
  if (typeof originalShowSection === 'function') {
    originalShowSection(section);
  }
  
  // Update mobile navigation immediately
  updateMobileNavigation(section);
};

function updateMobileNavigation(section) {
  // Update mobile menu
  const mobileItems = document.querySelectorAll('.mobile-nav-item');
  mobileItems.forEach(item => {
    if (item.dataset.section === section) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// Export for inline usage
window.updateMobileNavigation = updateMobileNavigation;
