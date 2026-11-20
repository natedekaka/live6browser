/* Sisi guru: menangkap tab/jendela/layar lalu mengirim frame ke server */
const StreamTeacher = (function () {
  'use strict';

  let sock = null;
  let stream = null;
  let track = null;
  let video = null;
  let canvas = null;
  let ctx = null;
  let ic = null;
  let sharing = false;
  let busy = false;
  let metaW = 0;
  let metaH = 0;

  const settings = { w: 1280, fps: 8, q: 0.65 };
  const PRESETS = {
    hemat: { w: 960, fps: 6, q: 0.5 },
    normal: { w: 1280, fps: 8, q: 0.65 },
    jernih: { w: 1600, fps: 12, q: 0.8 },
  };

  const btnShare = u.$('#btnShare');
  const btnStop = u.$('#btnStop');
  const stageEmpty = u.$('#stageEmpty');
  const stageEmptyText = u.$('#stageEmptyText');
  const livePill = u.$('#livePill');
  const liveText = u.$('#liveText');
  const streamMeta = u.$('#streamMeta');
  const selWidth = u.$('#selWidth');
  const selFps = u.$('#selFps');
  const selQuality = u.$('#selQuality');
  const presets = u.$('#presets');

  function canShare() {
    return !!(
      window.isSecureContext &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getDisplayMedia
    );
  }

  /* ------------------------------------------------------------- bagikan */

  async function share() {
    if (sharing) return;
    if (!canShare()) {
      u.toast(
        'Browser memblokir fitur ini di koneksi HTTP. Buka halaman guru lewat http://localhost:' +
          ((L6B && L6B.ports && L6B.ports.teacher) || 9334) +
          ' (di laptop ini).',
        'err',
        6000
      );
      return;
    }

    btnShare.disabled = true;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 30 },
          cursor: 'always',
        },
        audio: false,
        selfBrowserSurface: 'exclude',
      });
    } catch (err) {
      btnShare.disabled = false;
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        u.toast('Pembagian layar dibatalkan.');
      } else {
        u.toast('Tidak bisa membagikan layar: ' + (err && err.message ? err.message : err), 'err');
      }
      return;
    }

    track = stream.getVideoTracks()[0];
    if (!track) {
      u.toast('Sumber tayangan tidak ditemukan.', 'err');
      btnShare.disabled = false;
      return;
    }

    video.srcObject = stream;
    video.hidden = false;
    try { await video.play(); } catch (e) { /* autoplay dicegah, abaikan */ }

    try {
      if (window.ImageCapture) ic = new ImageCapture(track);
    } catch (e) {
      ic = null;
    }

    track.addEventListener('ended', function () { stop(true); });

    const st = track.getSettings ? track.getSettings() : {};
    sharing = true;
    metaW = 0;
    metaH = 0;
    sock.send({
      t: 'stream.start',
      w: st.width || settings.w,
      h: st.height || 0,
      fps: settings.fps,
      q: settings.q,
    });
    btnShare.disabled = false;
    updateUI();
    u.toast('Browser sedang ditayangkan ke siswa.', 'ok');
  }

  function stop(fromTrack) {
    if (!sharing && !stream) return;
    sharing = false;
    if (stream) {
      for (const t of stream.getTracks()) {
        try { t.stop(); } catch (e) { /* abaikan */ }
      }
    }
    stream = null;
    track = null;
    ic = null;
    video.srcObject = null;
    video.hidden = true;
    sock.send({ t: 'stream.stop' });
    metaW = 0;
    metaH = 0;
    updateUI();
    u.toast('Tayangan dihentikan.');
  }

  /* ------------------------------------------------------------- tangkap */

  async function grab() {
    if (!sharing) return;

    let source = null;
    let sw = 0;
    let sh = 0;

    if (ic) {
      try {
        const bmp = await ic.grabFrame();
        if (bmp) {
          source = bmp;
          sw = bmp.width;
          sh = bmp.height;
        }
      } catch (e) {
        ic = null; // pakai elemen video sebagai cadangan
      }
    }
    if (!source && video && video.readyState >= 2 && video.videoWidth) {
      source = video;
      sw = video.videoWidth;
      sh = video.videoHeight;
    }
    if (!source || !sw || !sh) return;

    const scale = Math.min(1, settings.w / sw);
    const cw = Math.max(2, Math.round(sw * scale));
    const ch = Math.max(2, Math.round(sh * scale));

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.drawImage(source, 0, 0, cw, ch);
    if (source !== video && source.close) source.close();

    const blob = await new Promise(function (res) {
      canvas.toBlob(res, 'image/jpeg', settings.q);
    });
    if (!blob || !sharing) return;

    if (cw !== metaW || ch !== metaH) {
      metaW = cw;
      metaH = ch;
      sock.send({ t: 'stream.settings', w: cw, h: ch, fps: settings.fps, q: settings.q });
      streamMeta.textContent = cw + '×' + ch + ' · ' + settings.fps + ' fps';
    }
    sock.sendRaw(blob);
  }

  function onPull() {
    if (!sharing || busy) return;
    busy = true;
    grab()
      .catch(function (e) { console.debug('grab gagal', e); })
      .finally(function () { busy = false; });
  }

  /* ------------------------------------------------------------- status */

  function onState(m) {
    if (!m.on && sharing) {
      // diambil alih atau server menghentikan
      sharing = false;
      if (stream) for (const t of stream.getTracks()) { try { t.stop(); } catch (e) { /* */ } }
      stream = null;
      track = null;
      ic = null;
      video.srcObject = null;
      video.hidden = true;
      u.toast(m.reason || 'Tayangan dihentikan server.', 'err');
    }
    updateUI(m);
  }

  function updateUI(state) {
    const on = sharing;
    btnShare.hidden = on;
    btnStop.hidden = !on;
    livePill.dataset.on = on ? '1' : '0';
    liveText.textContent = on ? 'Menyiarkan' : 'Offline';
    if (on) {
      stageEmpty.hidden = true;
      video.hidden = false;
      if (!metaW) streamMeta.textContent = 'menyiapkan…';
    } else {
      video.hidden = true;
      stageEmpty.hidden = false;
      stageEmptyText.textContent =
        'Klik «Bagikan Browser» lalu pilih tab, jendela, atau layar yang ingin ditayangkan ke siswa.';
      streamMeta.textContent = state && state.on ? 'diamkan…' : 'belum ada tayangan';
    }
  }

  /* -------------------------------------------------------- pengaturan */

  function savePrefs() {
    try { localStorage.setItem('l6b-stream', JSON.stringify(settings)); } catch (e) { /* */ }
  }
  function loadPrefs() {
    try {
      const raw = localStorage.getItem('l6b-stream');
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.w) settings.w = Number(p.w) || settings.w;
        if (p && p.fps) settings.fps = Number(p.fps) || settings.fps;
        if (p && p.q) settings.q = Number(p.q) || settings.q;
      }
    } catch (e) { /* */ }
  }

  function syncSelects() {
    selWidth.value = String(settings.w);
    selFps.value = String(settings.fps);
    selQuality.value = String(settings.q);
    for (const b of u.$$('.btn', presets)) {
      const p = PRESETS[b.dataset.preset];
      const active = p && p.w === settings.w && p.fps === settings.fps && p.q === settings.q;
      b.classList.toggle('active', !!active);
    }
  }

  function applySettings(send) {
    syncSelects();
    savePrefs();
    if (send && sharing) {
      sock.send({ t: 'stream.settings', w: metaW || settings.w, h: metaH, fps: settings.fps, q: settings.q });
      streamMeta.textContent = (metaW || settings.w) + '×' + (metaH || '?') + ' · ' + settings.fps + ' fps';
    }
  }

  function init(socket) {
    sock = socket;
    video = u.$('#preview');
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { alpha: false });

    loadPrefs();
    syncSelects();

    btnShare.addEventListener('click', share);
    btnStop.addEventListener('click', function () { stop(false); });

    selWidth.addEventListener('change', function () { settings.w = Number(selWidth.value); applySettings(true); });
    selFps.addEventListener('change', function () { settings.fps = Number(selFps.value); applySettings(true); });
    selQuality.addEventListener('change', function () { settings.q = Number(selQuality.value); applySettings(true); });

    presets.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-preset]');
      if (!b) return;
      const p = PRESETS[b.dataset.preset];
      if (!p) return;
      settings.w = p.w;
      settings.fps = p.fps;
      settings.q = p.q;
      applySettings(true);
      u.toast('Preset ' + b.textContent + ' dipakai.');
    });

    updateUI();
  }

  return { init, onPull, onState, stop, get sharing() { return sharing; }, canShare };
})();
