/* Aplikasi utama: tema, tab, undangan, dan penghubung WebSocket */
(function () {
  'use strict';

  const role = L6B.role;
  const $ = u.$;
  const $$ = u.$$;

  /* ------------------------------------------------------------- tema */

  try {
    const saved = localStorage.getItem('l6b-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  } catch (e) { /* abaikan */ }

  $('#btnTheme').addEventListener('click', function () {
    const cur = document.documentElement.dataset.theme === 'light' ? '' : 'light';
    if (cur) document.documentElement.dataset.theme = cur;
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('l6b-theme', cur); } catch (e) { /* abaikan */ }
  });

  /* --------------------------------------------------------------- tab */

  function setTab(name) {
    document.body.dataset.tab = name;
    for (const b of $$('.tab')) b.classList.toggle('active', b.dataset.tab === name);
    if (name === 'chat') Chat.clearUnread();
  }

  for (const b of $$('.tab')) {
    b.addEventListener('click', function () { setTab(b.dataset.tab); });
  }

  /* ------------------------------------------------------------ socket */

  let firstOpen = true;
  let wasDown = false;

  function onStatus(s) {
    if (s === 'open') {
      if (wasDown) u.toast('Terhubung kembali.', 'ok');
      wasDown = false;
      firstOpen = false;
    } else if (s === 'reconnect') {
      wasDown = true;
      u.toast('Koneksi terputus, menyambung ulang…', 'err');
    } else if (s === 'fail' && firstOpen) {
      u.toast('Tidak bisa terhubung ke server.', 'err', 6000);
    }
  }

  function onPresence(m) {
    const n = (m.students || []).length;
    const hasTeacher = (m.teachers || 0) > 0;
    const text = $('#presenceText');
    if (role === 'teacher') {
      text.textContent = n + ' siswa';
    } else {
      text.textContent = hasTeacher ? n + ' siswa online' : 'Guru belum terhubung';
    }
    $('#presence').classList.toggle('warn', role !== 'teacher' && !hasTeacher);
  }

  function onHello(m) {
    $('#roomCode').textContent = m.room;
    if (L6B) L6B.room = m.room;
    Board.setState(m.state.blocks);
    Chat.setMessages(m.state.chat);
    onPresence({ students: m.state.students, teachers: m.state.teachers });
    const st = m.state.stream || {};
    if (role === 'teacher') StreamTeacher.onState(st);
    else StreamStudent.onState(st);
  }

  function onMessage(m) {
    switch (m.t) {
      case 'hello':
        onHello(m);
        break;
      case 'board.state':
        Board.setState(m.blocks);
        break;
      case 'chat':
        Chat.append(m.msg);
        break;
      case 'presence':
        onPresence(m);
        break;
      case 'stream.state':
        if (role === 'teacher') StreamTeacher.onState(m);
        else StreamStudent.onState(m);
        break;
      case 'pull':
        if (role === 'teacher') StreamTeacher.onPull();
        break;
      case 'err':
        u.toast(m.msg || 'Permintaan ditolak.', 'err');
        break;
      case '__frame':
        if (role !== 'teacher') StreamStudent.onFrame(m.data);
        break;
      default:
        break;
    }
  }

  const sock = createSocket({ onMessage: onMessage, onStatus: onStatus });

  Board.init(sock);
  Chat.init(sock);
  if (role === 'teacher') StreamTeacher.init(sock);
  else StreamStudent.init(sock);

  /* ------------------------------------------------------------ undangan */

  function drawQR(canvas, text) {
    if (typeof window.qrcode !== 'function') { canvas.hidden = true; return; }
    canvas.hidden = false;
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const total = n + quiet * 2;
    const target = 264;
    const scale = Math.max(1, Math.floor(target / total));
    canvas.width = total * scale;
    canvas.height = total * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
  }

  const inviteModal = $('#inviteModal');

  function openInvite() {
    const url = L6B.studentUrl;
    const link = $('#inviteUrl');
    link.textContent = url;
    link.href = url;
    $('#inviteCode').textContent = L6B.room;
    drawQR($('#qrCanvas'), url);
    inviteModal.hidden = false;
  }
  function closeInvite() { inviteModal.hidden = true; }

  $('#btnInvite').addEventListener('click', openInvite);
  $('#closeInvite').addEventListener('click', closeInvite);
  inviteModal.addEventListener('click', function (e) { if (e.target === inviteModal) closeInvite(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !inviteModal.hidden) closeInvite();
  });

  $('#roomChip').addEventListener('click', function () {
    if (role === 'teacher') openInvite();
    else u.toast('Kode ruang: ' + L6B.room);
  });

  $('#btnCopyUrl').addEventListener('click', async function () {
    const ok = await u.copyText(L6B.studentUrl);
    u.toast(ok ? 'Tautan disalin.' : 'Gagal menyalin: ' + L6B.studentUrl, ok ? 'ok' : 'err', ok ? 2000 : 6000);
  });
  $('#btnCopyCode').addEventListener('click', async function () {
    const ok = await u.copyText(L6B.room);
    u.toast(ok ? 'Kode ruang disalin.' : 'Kode: ' + L6B.room, ok ? 'ok' : 'err');
  });

  /* ------------------------------------------------------------ keluar */

  $('#btnLeave').addEventListener('click', async function () {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { /* abaikan */ }
    location.href = '/';
  });

  /* ------------------------------------------- banner koneksi tidak aman */

  if (role === 'teacher') {
    const canShare = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia;
    if (!canShare) {
      const banner = $('#insecureBanner');
      banner.hidden = false;
      $('#localhostLink').href =
        'http://localhost:' + ((L6B.ports && L6B.ports.teacher) || 9334) +
        '/?room=' + encodeURIComponent(L6B.room);
    }
    $('#closeBanner').addEventListener('click', function () { $('#insecureBanner').hidden = true; });
  }

  /* ------------------------------------------------------- pemberitahuan */

  window.addEventListener('offline', function () { u.toast('Perangkat kehilangan jaringan.', 'err'); });
  window.addEventListener('online', function () { u.toast('Jaringan kembali.', 'ok'); });
})();
