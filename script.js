// Mobile hamburger menu
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('menuToggle');
  const navRight = document.getElementById('navRight');
  if (!toggle || !navRight) return;

  toggle.addEventListener('click', () => {
    const isOpen = navRight.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  navRight.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navRight.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 719) {
      navRight.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
});

// Highlight the nav tab matching the current page
(function(){
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('#navTabs a').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === path);
  });
})();

// Reveal-on-scroll
document.addEventListener('DOMContentLoaded', () => {
  const revealEls = document.querySelectorAll('.reveal');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    revealEls.forEach(el => el.classList.add('in'));
    return;
  }
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        revealIO.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealEls.forEach(el => revealIO.observe(el));
});

// Hero URL bar cycling (only present on home.html)
const PROJECT_URLS = [
  'jon.dev',
  'solsticegoods.com',
  'marrowandash.com',
  'fieldnote.app',
  'kindredstudio.co',
  'northlinerealty.com',
  'brambleandco.com'
];
document.addEventListener('DOMContentLoaded', () => {
  const heroUrl = document.getElementById('heroUrl');
  if (!heroUrl) return;
  let idx = 0;
  function typeUrl(text, cb){
    let i = 0;
    heroUrl.innerHTML = '';
    const span = document.createElement('span');
    heroUrl.appendChild(span);
    const caret = document.createElement('span');
    caret.className = 'caret';
    heroUrl.appendChild(caret);
    const iv = setInterval(() => {
      span.textContent = text.slice(0, i+1);
      i++;
      if(i > text.length){ clearInterval(iv); if(cb) setTimeout(cb, 1400); }
    }, 55);
  }
  function cycle(){
    idx = (idx + 1) % PROJECT_URLS.length;
    typeUrl(PROJECT_URLS[idx], cycle);
  }
  setTimeout(cycle, 1800);
});

// Contact form submission (Netlify Forms)
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contactForm');
  if (!form) return;

  const btn = form.querySelector('.submit-btn');
  const status = document.getElementById('formStatus');
  const btnDefaultText = btn ? btn.textContent : '';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    if (status) { status.textContent = ''; status.className = 'form-status'; }

    const data = new FormData(form);

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString()
    })
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        if (btn) btn.textContent = 'Sent ✓';
        if (status) {
          status.textContent = "Thanks — I'll get back to you within 1–2 business days.";
          status.className = 'form-status form-status-ok';
        }
        form.reset();
        setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = btnDefaultText; } }, 3000);
      })
      .catch(() => {
        if (btn) { btn.disabled = false; btn.textContent = btnDefaultText; }
        if (status) {
          status.textContent = "Something went wrong — please email hello@jon.dev directly.";
          status.className = 'form-status form-status-error';
        }
      });
  });
});
