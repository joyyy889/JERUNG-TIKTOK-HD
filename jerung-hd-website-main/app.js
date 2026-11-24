/* JERUNG HD: client-side behaviour.
   Plain ES2020, no frameworks, no network calls. */
(function () {
  'use strict';

  var I18N = {
    en: {
      pageTitleSuffix: 'JERUNG HD',
      skip: 'Skip to content',
      langLabel: 'Language',
      navHome: 'Home',
      navUpload: 'Upload',
      navLifetime: 'Lifetime',
      navAccount: 'Account',
      heroTitle: 'Upload HD and 4K video without quality loss.',
      heroText: 'Keep the detail your video was shot with. Drag the handle to compare.',
      heroCta: 'Upload a video',
      compareLabel: 'Compare before and after',
      before: 'Before',
      after: 'After',
      compareNote: 'Simulated preview. Real before and after clips can be added later.',
      howTitle: 'How it works',
      stepUpload: 'Upload',
      stepCheck: 'Check details',
      stepProcess: 'Process',
      stepVerify: 'Verify',
      stepDownload: 'Download MP4',
      methodsTitle: 'Two processing methods',
      methodJerung: 'JERUNG method',
      methodJerungText: 'Preserve the original video quality.',
      methodHdr: 'HDR',
      methodHdrText: 'Convert SDR to HDR10.',
      sendFileTitle: 'Send as a file, not a gallery video',
      sendFileText: 'Send the video as a File or Document to keep full quality. Sending it as a Video or Gallery item can lower its quality.',
      useLabel: 'Use',
      avoidLabel: 'Avoid',
      fileOption: 'File or Document',
      galleryOption: 'Video or Gallery',
      needHelp: 'Need help?',
      whatsapp: 'Message us on WhatsApp',
      uploadTitle: 'Upload a video',
      uploadIntro: 'Choose an MP4 or MOV file, then check the details.',
      dropTitle: 'Choose a video',
      dropHint: 'MP4 or MOV',
      fileName: 'File name',
      fileSize: 'Size',
      fileType: 'Type',
      chooseMethod: 'Processing method',
      continue: 'Continue',
      remove: 'Remove video',
      statusTitle: 'Processing status',
      statusIdle: 'Select a video to begin.',
      statusReady: 'Ready to continue. Processing is not connected yet.',
      statusSubmitted: 'Processing is not connected yet. Your file was not uploaded.',
      lifetimeTitle: 'Lifetime access',
      lifetimeIntro: 'Pay once, then send your receipt for review.',
      amount: 'Amount',
      priceNote: 'The final price and payment QR are provided by the project team.',
      qrAlt: 'Payment QR code placeholder',
      senderName: 'Sender name',
      senderPlaceholder: 'Enter the sender name',
      receipt: 'Payment receipt',
      receiptHint: 'Image or PDF',
      submitPayment: 'Submit payment',
      paymentBackend: 'Payments are not sent yet. Payment review is not connected.',
      paymentHistory: 'Payment history',
      noPayment: 'No payment records yet.',
      accountTitle: 'Account',
      accountIntro: 'Sign in to see your usage and payment status.',
      notSignedIn: 'Not signed in',
      continueGoogle: 'Continue with Google',
      oauthNote: 'Google sign-in will be enabled after backend integration.',
      usage: 'Usage',
      trialLeft: 'Free trial left',
      paidCredits: 'Paid credits',
      videosProcessed: 'Videos processed',
      notAvailable: 'Available after sign-in',
      footer: 'JERUNG HD. Backend services are not connected in this preview.',
      toastGoogle: 'Google sign-in is not connected yet.',
      toastPayment: 'Payment is not sent yet. Payment review is not connected.',
      unknownType: 'Unknown'
    },
    bm: {
      pageTitleSuffix: 'JERUNG HD',
      skip: 'Langkau ke kandungan',
      langLabel: 'Bahasa',
      navHome: 'Laman Utama',
      navUpload: 'Muat naik',
      navLifetime: 'Lifetime',
      navAccount: 'Akaun',
      heroTitle: 'Muat naik video HD dan 4K tanpa kehilangan kualiti.',
      heroText: 'Kekalkan perincian video asal anda. Seret pemegang untuk membandingkan.',
      heroCta: 'Muat naik video',
      compareLabel: 'Bandingkan sebelum dan selepas',
      before: 'Sebelum',
      after: 'Selepas',
      compareNote: 'Pratonton simulasi. Klip sebenar sebelum dan selepas boleh ditambah kemudian.',
      howTitle: 'Cara ia berfungsi',
      stepUpload: 'Muat naik',
      stepCheck: 'Semak butiran',
      stepProcess: 'Proses',
      stepVerify: 'Sahkan',
      stepDownload: 'Muat turun MP4',
      methodsTitle: 'Dua kaedah pemprosesan',
      methodJerung: 'Kaedah JERUNG',
      methodJerungText: 'Kekalkan kualiti asal video.',
      methodHdr: 'HDR',
      methodHdrText: 'Tukar SDR kepada HDR10.',
      sendFileTitle: 'Hantar sebagai fail, bukan video galeri',
      sendFileText: 'Hantar video sebagai File atau Document untuk kekalkan kualiti penuh. Menghantarnya sebagai item Video atau Galeri boleh menurunkan kualitinya.',
      useLabel: 'Guna',
      avoidLabel: 'Elak',
      fileOption: 'File atau Document',
      galleryOption: 'Video atau Galeri',
      needHelp: 'Perlukan bantuan?',
      whatsapp: 'Hantar mesej di WhatsApp',
      uploadTitle: 'Muat naik video',
      uploadIntro: 'Pilih fail MP4 atau MOV, kemudian semak butirannya.',
      dropTitle: 'Pilih video',
      dropHint: 'MP4 atau MOV',
      fileName: 'Nama fail',
      fileSize: 'Saiz',
      fileType: 'Jenis',
      chooseMethod: 'Kaedah pemprosesan',
      continue: 'Teruskan',
      remove: 'Buang video',
      statusTitle: 'Status pemprosesan',
      statusIdle: 'Pilih video untuk bermula.',
      statusReady: 'Sedia untuk diteruskan. Pemprosesan belum disambungkan.',
      statusSubmitted: 'Pemprosesan belum disambungkan. Fail anda tidak dimuat naik.',
      lifetimeTitle: 'Akses Lifetime',
      lifetimeIntro: 'Bayar sekali, kemudian hantar resit untuk semakan.',
      amount: 'Jumlah',
      priceNote: 'Harga akhir dan QR pembayaran diberikan oleh pasukan projek.',
      qrAlt: 'Placeholder kod QR pembayaran',
      senderName: 'Nama pengirim',
      senderPlaceholder: 'Masukkan nama pengirim',
      receipt: 'Resit pembayaran',
      receiptHint: 'Imej atau PDF',
      submitPayment: 'Hantar pembayaran',
      paymentBackend: 'Pembayaran belum dihantar. Semakan pembayaran belum disambungkan.',
      paymentHistory: 'Sejarah pembayaran',
      noPayment: 'Belum ada rekod pembayaran.',
      accountTitle: 'Akaun',
      accountIntro: 'Log masuk untuk melihat penggunaan dan status pembayaran.',
      notSignedIn: 'Belum log masuk',
      continueGoogle: 'Teruskan dengan Google',
      oauthNote: 'Log masuk Google akan diaktifkan selepas integrasi backend.',
      usage: 'Penggunaan',
      trialLeft: 'Baki percubaan percuma',
      paidCredits: 'Kredit berbayar',
      videosProcessed: 'Video diproses',
      notAvailable: 'Tersedia selepas log masuk',
      footer: 'JERUNG HD. Perkhidmatan backend belum disambungkan dalam pratonton ini.',
      toastGoogle: 'Log masuk Google belum disambungkan.',
      toastPayment: 'Pembayaran belum dihantar. Semakan pembayaran belum disambungkan.',
      unknownType: 'Tidak diketahui'
    }
  };

  var STORAGE_KEY = 'jerung-lang';
  var ROUTES = ['home', 'upload', 'lifetime', 'account'];
  var TOAST_MS = 4000;
  var INTRO_MS = 1600;

  var currentLang = 'en';
  var currentRoute = 'home';
  var statusKey = 'statusIdle';
  var selectedFile = null;
  var introPlayed = false;
  var introFrame = null;
  var toastTimer = null;
  var receiptUrl = null;

  var el = {};

  function byId(id) {
    return document.getElementById(id);
  }

  /* ---------- i18n ---------- */

  function t(key) {
    if (!key) { return ''; }
    var dict = I18N[currentLang] || I18N.en;
    if (typeof dict[key] === 'string') { return dict[key]; }
    if (typeof I18N.en[key] === 'string') { return I18N.en[key]; }
    return key;
  }

  function lookup(lang, key) {
    var dict = I18N[lang] || {};
    if (typeof dict[key] === 'string') { return dict[key]; }
    if (typeof I18N.en[key] === 'string') { return I18N.en[key]; }
    return null;
  }

  function readStoredLang() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'bm') { return stored; }
    } catch (err) {
      /* storage unavailable */
    }
    return null;
  }

  function storeLang(lang) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function detectLang() {
    var stored = readStoredLang();
    if (stored) { return stored; }
    var nav = (window.navigator && navigator.language ? navigator.language : '').toLowerCase();
    return nav.indexOf('ms') === 0 ? 'bm' : 'en';
  }

  function applyLang(lang) {
    if (!I18N[lang]) { lang = 'en'; }
    currentLang = lang;

    document.documentElement.setAttribute('lang', lang);

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (node) {
      var value = lookup(lang, node.getAttribute('data-i18n'));
      if (value !== null) { node.textContent = value; }
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (node) {
      var value = lookup(lang, node.getAttribute('data-i18n-placeholder'));
      if (value !== null) { node.setAttribute('placeholder', value); }
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (node) {
      var value = lookup(lang, node.getAttribute('data-i18n-aria'));
      if (value !== null) { node.setAttribute('aria-label', value); }
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-lang]'), function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === lang ? 'true' : 'false');
    });

    renderStatus();
    renderFileDetails();
    renderReceiptAlt();
    updateTitle();

    storeLang(lang);
  }

  /* ---------- routing ---------- */

  function routeFromHash() {
    var raw = (window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
    return ROUTES.indexOf(raw) === -1 ? 'home' : raw;
  }

  function viewHeading(route) {
    var view = byId('view-' + route);
    if (!view) { return ''; }
    var heading = view.querySelector('h1');
    return heading ? heading.textContent.trim() : '';
  }

  function updateTitle() {
    var heading = viewHeading(currentRoute);
    document.title = heading ? heading + ' | ' + t('pageTitleSuffix') : t('pageTitleSuffix');
  }

  function setRoute(route, moveFocus) {
    if (ROUTES.indexOf(route) === -1) { route = 'home'; }
    currentRoute = route;

    ROUTES.forEach(function (name) {
      var view = byId('view-' + name);
      if (!view) { return; }
      if (name === route) {
        view.removeAttribute('hidden');
      } else {
        view.setAttribute('hidden', '');
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.site-nav a[data-route], .tabbar a[data-route]'), function (link) {
      if (link.getAttribute('data-route') === route) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    updateTitle();

    var heading = byId('view-' + route) ? byId('view-' + route).querySelector('h1') : null;
    if (heading && moveFocus) {
      heading.setAttribute('tabindex', '-1');
      try {
        heading.focus({ preventScroll: true });
      } catch (err) {
        heading.focus();
      }
    }

    window.scrollTo(0, 0);

    if (route === 'home') { playIntro(); }
  }

  /* ---------- comparison ---------- */

  function setSplit(percent) {
    var value = Math.min(100, Math.max(0, percent));
    if (el.compare) {
      el.compare.style.setProperty('--split', value.toFixed(2) + '%');
    }
    if (el.compareRange) {
      el.compareRange.value = String(Math.round(value));
    }
  }

  function cancelIntro() {
    if (introFrame !== null) {
      window.cancelAnimationFrame(introFrame);
      introFrame = null;
    }
  }

  function easeOut(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  function playIntro() {
    if (introPlayed) { return; }
    introPlayed = true;
    if (!el.compare || !el.compareRange) { return; }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSplit(50);
      return;
    }

    var start = null;

    function frame(now) {
      if (start === null) { start = now; }
      var progress = (now - start) / INTRO_MS;
      if (progress >= 1) {
        setSplit(50);
        introFrame = null;
        return;
      }
      if (progress < 0.5) {
        setSplit(50 + 12 * easeOut(progress / 0.5));
      } else {
        setSplit(62 - 12 * easeOut((progress - 0.5) / 0.5));
      }
      introFrame = window.requestAnimationFrame(frame);
    }

    introFrame = window.requestAnimationFrame(frame);
  }

  /* ---------- upload ---------- */

  function setStatus(key) {
    statusKey = key;
    renderStatus();
  }

  function renderStatus() {
    if (el.statusText) { el.statusText.textContent = t(statusKey); }
  }

  function formatSize(bytes) {
    var megabytes = bytes / (1024 * 1024);
    if (megabytes > 1024) {
      return (megabytes / 1024).toFixed(2) + ' GB';
    }
    return megabytes.toFixed(2) + ' MB';
  }

  function renderFileDetails() {
    if (!el.fileName || !el.fileSize || !el.fileType) { return; }
    if (!selectedFile) {
      el.fileName.textContent = '';
      el.fileSize.textContent = '';
      el.fileType.textContent = '';
      return;
    }
    el.fileName.textContent = selectedFile.name;
    el.fileSize.textContent = formatSize(selectedFile.size);
    el.fileType.textContent = selectedFile.type || t('unknownType');
  }

  function setFileEnabled(enabled) {
    if (el.continueBtn) { el.continueBtn.disabled = !enabled; }
    if (el.removeBtn) { el.removeBtn.disabled = !enabled; }
  }

  function clearFile() {
    selectedFile = null;
    if (el.fileInput) { el.fileInput.value = ''; }
    if (el.fileDetails) { el.fileDetails.setAttribute('hidden', ''); }
    renderFileDetails();
    setFileEnabled(false);
    setStatus('statusIdle');
  }

  function markStep(step, state) {
    if (!el.steps) { return; }
    Array.prototype.forEach.call(el.steps.querySelectorAll('li[data-step="' + step + '"]'), function (li) {
      li.setAttribute('data-state', state);
    });
  }

  /* ---------- payment ---------- */

  function clearReceiptPreview() {
    if (!el.receiptPreview) { return; }
    el.receiptPreview.textContent = '';
    if (receiptUrl) {
      window.URL.revokeObjectURL(receiptUrl);
      receiptUrl = null;
    }
  }

  function renderReceiptAlt() {
    if (!el.receiptPreview) { return; }
    var img = el.receiptPreview.querySelector('img.preview');
    if (img) { img.alt = t('receipt'); }
  }

  function showReceiptPreview(file) {
    if (!el.receiptPreview) { return; }
    clearReceiptPreview();
    if (!file) {
      el.receiptPreview.setAttribute('hidden', '');
      return;
    }
    el.receiptPreview.removeAttribute('hidden');
    if (file.type && file.type.indexOf('image/') === 0) {
      receiptUrl = window.URL.createObjectURL(file);
      var img = document.createElement('img');
      img.className = 'preview';
      img.alt = t('receipt');
      img.src = receiptUrl;
      el.receiptPreview.appendChild(img);
    } else {
      el.receiptPreview.textContent = file.name;
    }
  }

  /* ---------- toast ---------- */

  function showToast(message) {
    if (!el.toast) { return; }
    el.toast.textContent = message;
    el.toast.removeAttribute('hidden');
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastTimer = window.setTimeout(function () {
      if (el.toast) { el.toast.setAttribute('hidden', ''); }
      toastTimer = null;
    }, TOAST_MS);
  }

  /* ---------- init ---------- */

  function cacheElements() {
    el.compare = byId('compare');
    el.compareRange = byId('compare-range');
    el.fileInput = byId('video-file');
    el.fileDetails = byId('file-details');
    el.fileName = byId('file-name');
    el.fileSize = byId('file-size');
    el.fileType = byId('file-type');
    el.continueBtn = byId('continue-btn');
    el.removeBtn = byId('remove-btn');
    el.statusText = byId('status-text');
    el.steps = byId('view-upload') ? byId('view-upload').querySelector('.steps-process') : null;
    el.receipt = byId('receipt');
    el.receiptPreview = byId('receipt-preview');
    el.toast = byId('toast');
    el.googleBtn = byId('google-btn');
    el.paymentForm = byId('payment-form');
  }

  function bindEvents() {
    window.addEventListener('hashchange', function () {
      setRoute(routeFromHash(), true);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-lang]'), function (btn) {
      btn.addEventListener('click', function () {
        applyLang(btn.getAttribute('data-lang'));
      });
    });

    if (el.compareRange) {
      el.compareRange.addEventListener('input', function () {
        cancelIntro();
        setSplit(Number(el.compareRange.value));
      });
    }

    if (el.fileInput) {
      el.fileInput.addEventListener('change', function () {
        var file = el.fileInput.files && el.fileInput.files[0];
        if (!file) {
          clearFile();
          return;
        }
        selectedFile = file;
        if (el.fileDetails) { el.fileDetails.removeAttribute('hidden'); }
        renderFileDetails();
        setFileEnabled(true);
        setStatus('statusReady');
      });
    }

    if (el.removeBtn) {
      el.removeBtn.addEventListener('click', function () {
        clearFile();
      });
    }

    if (el.continueBtn) {
      el.continueBtn.addEventListener('click', function () {
        if (!selectedFile) { return; }
        setStatus('statusSubmitted');
        markStep('upload', 'done');
      });
    }

    if (el.receipt) {
      el.receipt.addEventListener('change', function () {
        var file = el.receipt.files && el.receipt.files[0];
        showReceiptPreview(file || null);
      });
    }

    if (el.paymentForm) {
      el.paymentForm.addEventListener('submit', function (event) {
        event.preventDefault();
        showToast(t('toastPayment'));
      });
    }

    if (el.googleBtn) {
      el.googleBtn.addEventListener('click', function () {
        showToast(t('toastGoogle'));
      });
    }
  }

  function init() {
    cacheElements();
    bindEvents();
    setSplit(50);
    setRoute(routeFromHash());
    applyLang(detectLang());
    renderStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
