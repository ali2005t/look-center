// معالج القائمة الجانبية للموبايل
document.addEventListener('DOMContentLoaded', function() {
  // إخفاء الـ sidebar على الموبايل
  const sidebar = document.querySelector('.sidebar');
  
  if (sidebar) {
    // تطبيق إخفاء الـ sidebar على الشاشات الصغيرة
    const checkSidebarVisibility = () => {
      if (window.innerWidth <= 900) {
        sidebar.style.display = 'none';
      } else {
        sidebar.style.display = 'flex';
      }
    };

    // تحقق عند التحميل
    checkSidebarVisibility();

    // تحقق عند تغيير حجم النافذة
    window.addEventListener('resize', checkSidebarVisibility);
  }
});
