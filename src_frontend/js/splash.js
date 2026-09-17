document.addEventListener("DOMContentLoaded", () => {
  const steps = [
    { id: 'step-1', label: 'جاري تهيئة الواجهة' },
    { id: 'step-2', label: 'جاري تحميل البيانات' },
    { id: 'step-3', label: 'جاري فتح الكاشير' }
  ];
  const progressBar = document.getElementById('progress-bar');
  const progressPercent = document.getElementById('progress-percent');
  const loadingStatus = document.getElementById('loading-status');
  const progressTrack = document.querySelector('.progress-track');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stepDuration = prefersReducedMotion ? 250 : 800;

  const storedName = localStorage.getItem('centerName');
  const storedLogo = localStorage.getItem('centerLogo');
  const title = document.getElementById('splash-center-name');
  const logo = document.getElementById('center-logo');

  if (storedName && storedName.trim()) {
    title.textContent = storedName.trim();
  }

  if (storedLogo && storedLogo.trim()) {
    logo.src = storedLogo;
  }

  logo.addEventListener('error', () => {
    logo.src = 'img/placeholder-logo.png';
  }, { once: true });

  const updateProgress = (value) => {
    progressBar.style.width = `${value}%`;
    progressPercent.textContent = `${value}%`;
    progressTrack.setAttribute('aria-valuenow', value);
  };

  const completeStep = (step, index) => {
    const stepElement = document.getElementById(step.id);
    stepElement.classList.remove('active');
    stepElement.classList.add('completed');
    stepElement.querySelector('i').className = 'fas fa-check-circle';
    updateProgress(Math.round(((index + 1) / steps.length) * 100));
  };

  const runStep = (index) => {
    if (index >= steps.length) {
      loadingStatus.textContent = 'تم تجهيز النظام، لحظة واحدة...';
      document.body.classList.add('is-exiting');
      window.setTimeout(() => {
        window.location.href = 'login.html';
      }, prefersReducedMotion ? 0 : 600);
      return;
    }

    const step = steps[index];
    const stepElement = document.getElementById(step.id);
    loadingStatus.textContent = step.label;
    stepElement.classList.add('active');

    window.setTimeout(() => {
      completeStep(step, index);
      runStep(index + 1);
    }, stepDuration);
  };

  runStep(0);
});

