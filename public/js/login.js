/* Halaman masuk */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);

  function showErr(el, msg) {
    el.textContent = msg;
    el.hidden = false;
  }

  function post(url, body, errEl) {
    errEl.hidden = true;
    const btn = errEl.parentElement.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false, err: 'Respons tidak valid.' }; }); })
      .then(function (data) {
        if (btn) btn.disabled = false;
        if (!data.ok) { showErr(errEl, data.err || 'Gagal.'); return null; }
        return data;
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        showErr(errEl, 'Tidak bisa terhubung ke server. Coba lagi.');
        return null;
      });
  }

  const teacherTab = document.getElementById('teacher-tab');
  const studentTab = document.getElementById('student-tab');
  const teacherPanel = document.getElementById('teacher-panel');
  const studentPanel = document.getElementById('student-panel');

  function showPanel(which) {
    const isTeacher = which === 'teacher';
    teacherPanel.hidden = !isTeacher;
    studentPanel.hidden = isTeacher;
    teacherTab.setAttribute('aria-selected', isTeacher ? 'true' : 'false');
    studentTab.setAttribute('aria-selected', isTeacher ? 'false' : 'true');
    const inp = isTeacher
      ? document.querySelector('#formTeacher input[name=password]')
      : document.querySelector('#formStudent input[name=code]');
    if (inp) try { inp.focus(); } catch (e) { /* */ }
  }

  if (teacherTab && studentTab) {
    teacherTab.addEventListener('click', function () { showPanel('teacher'); });
    studentTab.addEventListener('click', function () { showPanel('student'); });
  }

  const teacherForm = document.getElementById('formTeacher');
  if (teacherForm) {
    const err = document.getElementById('errTeacher');
    const resultBox = document.getElementById('teacher-result');
    const codeDisplay = document.getElementById('room-code-display');
    const copyBtn = document.getElementById('copy-code');
    const enterBtn = document.getElementById('enter-room');

    teacherForm.addEventListener('submit', function (e) {
      e.preventDefault();
      post('/api/login', {
        password: (teacherForm.elements.password.value || '').trim(),
      }, err).then(function (data) {
        if (!data) return;
        if (codeDisplay) codeDisplay.textContent = data.room;
        if (resultBox) resultBox.hidden = false;
        teacherForm.hidden = true;
        if (enterBtn) enterBtn.dataset.room = data.room;
        try { if (navigator.clipboard) navigator.clipboard.writeText(data.room); } catch (e) { /* */ }
      });
    });

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        const code = codeDisplay ? codeDisplay.textContent : '';
        if (window.u && window.u.copyText) {
          window.u.copyText(code).then(function (ok) {
            copyBtn.textContent = ok ? 'Tersalin!' : 'Kode: ' + code;
            setTimeout(function () { copyBtn.textContent = 'Salin kode'; }, 1500);
          });
        } else {
          try { navigator.clipboard.writeText(code); copyBtn.textContent = 'Tersalin!'; }
          catch (e) { /* */ }
          setTimeout(function () { copyBtn.textContent = 'Salin kode'; }, 1500);
        }
      });
    }
    if (enterBtn) {
      enterBtn.addEventListener('click', function () {
        location.href = '/app';
      });
    }
  }

  const studentForm = document.getElementById('formStudent');
  if (studentForm) {
    const err = document.getElementById('errStudent');
    const codeInput = studentForm.elements.code;
    const preset = (params.get('code') || '').toUpperCase();
    if (preset) {
      codeInput.value = preset;
      try { studentForm.elements.name.focus(); } catch (e) { /* */ }
    }
    const pwField = studentForm.querySelector('[data-need="pw"]');
    if (pwField && document.body.dataset.studentpw !== '1') pwField.hidden = true;

    studentForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const code = (codeInput.value || '').trim().toUpperCase().replace(/\s+/g, '');
      codeInput.value = code;
      post('/api/join', {
        code: code,
        name: studentForm.elements.name.value,
        password: studentForm.elements.password ? studentForm.elements.password.value : '',
      }, err).then(function (data) {
        if (!data) return;
        location.href = '/app';
      });
    });
  }

  const role = document.body.dataset.role;
  // tampilkan/sembunyikan kata sandi guru
  const showPw = document.getElementById('show-pw');
  if (showPw) {
    showPw.addEventListener('change', function () {
      const inp = document.querySelector('#formTeacher input[name=password]');
      if (inp) inp.type = showPw.checked ? 'text' : 'password';
    });
  }
  const hasCode = params.has('code');
  showPanel(hasCode ? 'student' : (role === 'student' ? 'student' : 'teacher'));
})();