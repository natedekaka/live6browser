/* Sisi siswa: menerima frame JPEG dan menampilkannya */
const StreamStudent = (function () {
  'use strict';

  let sock = null;
  let canvas = null;
  let ctx = null;
  let img = null; // cadangan bila createImageBitmap tidak ada
  let chain = Promise.resolve();
  let live = false;
  let fpsCount = 0;
  let fpsWindow = 0;
  let fps = 0;
  let wakeLock = null;
  let wantWake = false;

  const stage = u.$('#stage');
  const stageEmpty = u.$('#stageEmpty');
  const stageEmptyText = u.$('#stageEmptyText');
  const stageLoading = u.$('#stageLoading');
  const livePill = u.$('#livePill');
  const liveText = u.$('#liveText');
  const streamMeta = u.$('#streamMeta');
  const btnZoom = u.$('#btnZoom');
  const btnWake = u.$('#btnWake');

  function supportsBitmap() {
    return typeof window.createImageBitmap === 'function';
  }

  function ensureCanvas() {
    if (supportsBitmap()) {
      if (!canvas) {
        canvas = u.$('#viewCanvas');
        ctx = canvas.getContext('2d', { alpha: false });
      }
      canvas.hidden = false;
      if (img) { img.remove(); img = null; }
      return canvas;
    }
    // cadangan: pakai <img>
    if (!img) {
      img = document.createElement('img');
      img.alt = 'Tayangan browser guru';
      img.id = 'viewImg';
      stage.insertBefore(img, stageEmpty);
      canvas = u.$('#viewCanvas');
      canvas.hidden = true;
    }
    return img;
  }

  async function render(buf) {
    const target = ensureCanvas();
    try {
      const blob = new Blob([buf], { type: 'image/jpeg' });
      if (target.tagName === 'IMG') {
        target.src = URL.createObjectURL(blob);
        target.onload = function () { URL.revokeObjectURL(target.src); };
      } else {
        const bmp = await createImageBitmap(blob);
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
          canvas.width = bmp.width;
          canvas.height = bmp.height;
        }
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
      }
      countFrame();
      if (!live) setLive(true);
      stageEmpty.hidden = true;
      stageLoading.hidden = true;
    } catch (e) {
      console.debug('render frame gagal', e);
    }
  }

  function onFrame(data) {
    chain = chain
      .then(function () { return render(data); })
      .catch(function () {});
  }

  function countFrame() {
    const now = performance.now();
    fpsCount++;
    if (!fpsWindow) fpsWindow = now;
    if (now - fpsWindow >= 1000) {
      fps = fpsCount;
      fpsCount = 0;
      fpsWindow = now;
      if (live) updateMeta();
    }
  }

  function setLive(on) {
    live = on;
    updateMeta();
  }

  function updateMeta() {
    livePill.dataset.on = live ? '1' : '0';
    liveText.textContent = live ? 'Live' : 'Offline';
    if (!live) {
      stageEmpty.hidden = false;
      stageLoading.hidden = true;
      streamMeta.textContent = 'belum ada tayangan';
      return;
    }
    const w = canvas && canvas.width ? canvas.width : 0;
    const h = canvas && canvas.height ? canvas.height : 0;
    streamMeta.textContent = (w ? w + '×' + h + ' · ' : '') + (fps ? fps + ' fps' : 'memuat…');
  }

  function onState(m) {
    if (m.on) {
      setLive(true);
      stageEmpty.hidden = true;
      stageLoading.hidden = false;
      stageEmptyText.textContent = 'Menunggu frame pertama…';
      if (m.w && m.h) streamMeta.textContent = m.w + '×' + m.h + ' · ' + (m.fps || '') + ' fps';
      updateMeta();
    } else {
      setLive(false);
      stageLoading.hidden = true;
      stageEmptyText.textContent = 'Menunggu guru menayangkan browser…';
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (img) img.removeAttribute('src');
      fps = 0;
      fpsCount = 0;
      updateMeta();
    }
  }

  /* --------------------------------------------------------- zoom & layar */

  function toggleZoom() {
    const on = stage.classList.toggle('zoomed');
    btnZoom.textContent = on ? 'Muat layar' : 'Perbesar';
    btnZoom.classList.toggle('active', on);
  }

  async function toggleWake() {
    if (!('wakeLock' in navigator)) return;
    try {
      if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
        wantWake = false;
        btnWake.classList.remove('active');
        u.toast('Layar boleh mati lagi.');
      } else {
        wakeLock = await navigator.wakeLock.request('screen');
        wantWake = true;
        btnWake.classList.add('active');
        u.toast('Layar akan tetap menyala.', 'ok');
        wakeLock.addEventListener('release', function () { wakeLock = null; });
      }
    } catch (e) {
      u.toast('Fitur jaga layar tidak tersedia.', 'err');
    }
  }

  document.addEventListener('visibilitychange', async function () {
    if (document.visibilityState === 'visible' && wantWake && !wakeLock && 'wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', function () { wakeLock = null; });
      } catch (e) { /* abaikan */ }
    }
  });

  function init(socket) {
    sock = socket;
    ensureCanvas();

    btnZoom.addEventListener('click', toggleZoom);

    const wakeSupported = 'wakeLock' in navigator && window.isSecureContext;
    btnWake.hidden = !wakeSupported;
    if (wakeSupported) btnWake.addEventListener('click', toggleWake);

    updateMeta();
  }

  return { init, onFrame, onState };
})();
