// معالج القائمة المنسدلة للموبايل
document.addEventListener('DOMContentLoaded', function() {
  if (window.innerWidth > 900) return;

  // التحقق من أن المحتوى قد تم تحميله
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.querySelector('.mobile-menu');

  if (mobileMenuBtn && mobileMenu) {
    // فتح/إغلاق القائمة
    mobileMenuBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      mobileMenu.style.display = mobileMenu.style.display === 'flex' ? 'none' : 'flex';
    });

    // إغلاق القائمة عند النقر على عنصر
    const menuItems = mobileMenu.querySelectorAll('a');
    menuItems.forEach(item => {
      item.addEventListener('click', function() {
        mobileMenu.style.display = 'none';
      });
    });

    // إغلاق القائمة عند النقر خارجها
    document.addEventListener('click', function(e) {
      if (!mobileMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mobileMenu.style.display = 'none';
      }
    });
  }
});
