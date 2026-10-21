document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('sidebarStateVersion') !== 'v2') {
    localStorage.removeItem('sidebarCollapsed');
    localStorage.setItem('sidebarStateVersion', 'v2');
  }

  const toggleButton = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');

  if (!toggleButton || !sidebar) return;

  toggleButton.setAttribute('aria-controls', 'main-sidebar');
  sidebar.id = 'main-sidebar';

  const updateButtonState = (isOpen) => {
    toggleButton.setAttribute('aria-expanded', String(isOpen));
    toggleButton.classList.toggle('is-active', isOpen);
    toggleButton.setAttribute('title', isOpen ? 'إخفاء القائمة الجانبية' : 'إظهار القائمة الجانبية');
    const icon = toggleButton.querySelector('i');
    if (icon && window.innerWidth > 900) {
      icon.className = isOpen ? 'fas fa-bars' : 'fas fa-arrow-left';
    }
  };

  if (window.innerWidth > 900) {
    const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    updateButtonState(!collapsed);
  } else {
    updateButtonState(false);
  }

  toggleButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const isMobile = window.innerWidth <= 900;
    const isOpen = isMobile
      ? sidebar.classList.toggle('is-open')
      : !document.body.classList.toggle('sidebar-collapsed');

    if (!isMobile) {
      localStorage.setItem('sidebarCollapsed', String(!isOpen));
    }

    if (isMobile) {
      document.body.classList.toggle('sidebar-open', isOpen);
    }

    updateButtonState(isOpen);
  });

  sidebar.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      sidebar.classList.remove('is-open');
      document.body.classList.remove('sidebar-open');
      toggleButton.classList.remove('is-active');
      toggleButton.setAttribute('aria-expanded', 'false');
    });
  });
});
