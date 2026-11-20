/* Papan kelas (teks + gambar) */
const Board = (function () {
  'use strict';
  const role = window.L6B ? L6B.role : 'student';
  const isTeacher = role === 'teacher';

  let sock = null;
  let blocks = [];
  let editingId = null;

  const list = u.$('#boardList');
  const emptyEl = u.$('#boardEmpty');
  const composer = u.$('#composer');
  const composerText = u.$('#composerText');
  const fileInput = u.$('#fileImage');

  /* ------------------------------------------------------------- render */

  function findEl(id) {
    const all = u.$$('.block', list);
    for (const el of all) if (el.dataset.id === id) return el;
    return null;
  }

  function actionsEl(b) {
    const bar = document.createElement('div');
    bar.className = 'block-actions';
    const defs = [
      ['up', '↑', 'Naikkan'],
      ['down', '↓', 'Turunkan'],
    ];
    if (b.kind === 'text') defs.push(['edit', '✎', 'Edit']);
    defs.push(['del', '🗑', 'Hapus']);
    for (const [act, label, title] of defs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.act = act;
      btn.textContent = label;
      btn.title = title;
      if (act === 'del') btn.classList.add('del');
      bar.appendChild(btn);
    }
    return bar;
  }

  function blockEl(b) {
    const div = document.createElement('div');
    div.className = 'block' + (b.kind === 'image' ? ' image-block' : '');
    div.dataset.id = b.id;

    if (b.kind === 'image') {
      const img = document.createElement('img');
      img.src = b.url;
      img.alt = b.caption || 'Gambar kelas';
      img.loading = 'lazy';
      if (b.w) img.width = b.w;
      if (b.h) img.height = b.h;
      div.appendChild(img);
      if (b.caption) {
        const cap = document.createElement('div');
        cap.className = 'caption';
        cap.textContent = b.caption;
        div.appendChild(cap);
      }
    } else {
      const md = document.createElement('div');
      md.className = 'md';
      md.innerHTML = u.markdown(b.text);
      div.appendChild(md);
    }

    if (isTeacher) div.appendChild(actionsEl(b));
    return div;
  }

  function nearBottom() {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  }

  function render() {
    const stick = nearBottom();
    list.innerHTML = '';
    if (!blocks.length) {
      list.appendChild(emptyEl);
      return;
    }
    for (const b of blocks) list.appendChild(blockEl(b));
    if (stick) list.scrollTop = list.scrollHeight;
  }

  function setState(next) {
    blocks = Array.isArray(next) ? next : [];
    editingId = null;
    render();
  }

  /* ------------------------------------------------------- aksi guru */

  function findBlock(id) {
    for (const b of blocks) if (b.id === id) return b;
    return null;
  }

  function startEdit(id) {
    const b = findBlock(id);
    const el = findEl(id);
    if (!b || !el || b.kind !== 'text') return;
    editingId = id;
    el.innerHTML = '';

    const ta = document.createElement('textarea');
    ta.value = b.text;
    ta.rows = 4;
    el.appendChild(ta);

    const bar = document.createElement('div');
    bar.className = 'composer-bar';
    bar.style.marginTop = '8px';
    bar.innerHTML = '<span class="muted tiny">Enter simpan · Shift+Enter baris baru · Esc batal</span><span class="spacer"></span>';
    const cancel = document.createElement('button');
    cancel.className = 'btn small ghost';
    cancel.type = 'button';
    cancel.textContent = 'Batal';
    const save = document.createElement('button');
    save.className = 'btn small primary';
    save.type = 'button';
    save.textContent = 'Simpan';
    bar.appendChild(cancel);
    bar.appendChild(save);
    el.appendChild(bar);

    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    function doSave() {
      const text = ta.value;
      editingId = null;
      if (!text.trim()) { render(); return; }
      sock.send({ t: 'block.update', id: id, text: text });
      render();
    }
    function doCancel() { editingId = null; render(); }

    save.addEventListener('click', doSave);
    cancel.addEventListener('click', doCancel);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSave(); }
      else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    });
  }

  function openComposer() {
    composer.hidden = false;
    composerText.focus();
    composerText.setSelectionRange(composerText.value.length, composerText.value.length);
  }
  function closeComposer() {
    composer.hidden = true;
    composerText.value = '';
  }
  function saveComposer() {
    const text = composerText.value;
    if (!text.trim()) { closeComposer(); return; }
    sock.send({ t: 'block.add', kind: 'text', text: text });
    composerText.value = '';
    composerText.focus();
  }

  /* ---------------------------------------------------------- gambar */

  async function compress(file, maxPx) {
    let src;
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      try { src = await createImageBitmap(file); } catch (e2) { src = await loadImageEl(file); }
    }
    const sw = src.naturalWidth || src.width;
    const sh = src.naturalHeight || src.height;
    if (!sw || !sh) throw new Error('Gambar tidak bisa dibaca.');
    const scale = Math.min(1, maxPx / Math.max(sw, sh));
    const cw = Math.max(1, Math.round(sw * scale));
    const ch = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, cw, ch);
    if (src.close) src.close();
    let blob = await new Promise(function (r) { c.toBlob(r, 'image/webp', 0.85); });
    if (!blob) blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.85); });
    if (!blob) throw new Error('Gagal mengompres gambar.');
    return { blob: blob, w: cw, h: ch };
  }

  function loadImageEl(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Gambar tidak valid.')); };
      img.src = url;
    });
  }

  async function handleFiles(files) {
    if (!isTeacher || !files || !files.length) return;
    const maxPx = (L6B.limits && L6B.limits.maxImagePx) || 1920;
    let count = 0;
    for (const file of files) {
      if (!file.type || !file.type.startsWith('image/')) continue;
      try {
        const res = await compress(file, maxPx);
        const up = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': res.blob.type || 'image/webp' },
          body: res.blob,
        });
        const data = await up.json().catch(function () { return { ok: false }; });
        if (!data.ok) throw new Error(data.err || 'Unggahan gagal.');
        sock.send({ t: 'block.add', kind: 'image', url: data.url, w: res.w, h: res.h });
        count++;
      } catch (err) {
        u.toast(err.message || 'Gagal memproses gambar.', 'err');
      }
    }
    if (count) u.toast(count + ' gambar ditambahkan.', 'ok');
  }

  /* ------------------------------------------------------------- init */

  function init(socket) {
    sock = socket;

    if (isTeacher) {
      u.$('#btnAddText').addEventListener('click', openComposer);
      u.$('#btnAddImage').addEventListener('click', function () { fileInput.click(); });
      u.$('#btnClear').addEventListener('click', function () {
        if (!blocks.length) return u.toast('Papan sudah kosong.');
        if (confirm('Hapus SEMUA catatan di papan?')) sock.send({ t: 'board.clear' });
      });
      u.$('#composerSave').addEventListener('click', saveComposer);
      u.$('#composerCancel').addEventListener('click', closeComposer);
      composerText.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveComposer(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeComposer(); }
      });
      fileInput.addEventListener('change', function () {
        handleFiles(fileInput.files);
        fileInput.value = '';
      });

      list.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const wrap = btn.closest('.block');
        if (!wrap) return;
        const id = wrap.dataset.id;
        const act = btn.dataset.act;
        if (act === 'up') sock.send({ t: 'block.move', id: id, dir: -1 });
        else if (act === 'down') sock.send({ t: 'block.move', id: id, dir: 1 });
        else if (act === 'edit') startEdit(id);
        else if (act === 'del') {
          const b = findBlock(id);
          if (b && b.kind === 'image' && !confirm('Hapus gambar ini dari papan?')) return;
          sock.send({ t: 'block.delete', id: id });
        }
      });

      // seret-lepas & tempel gambar
      list.addEventListener('dragover', function (e) {
        if (!e.dataTransfer || !Array.prototype.some.call(e.dataTransfer.types, function (t) { return t === 'Files'; })) return;
        e.preventDefault();
        list.classList.add('drag-over');
      });
      list.addEventListener('dragleave', function () { list.classList.remove('drag-over'); });
      list.addEventListener('drop', function (e) {
        if (!e.dataTransfer || !e.dataTransfer.files.length) return;
        e.preventDefault();
        list.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
      });
      document.addEventListener('paste', function (e) {
        if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const files = [];
        for (const it of items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
        if (files.length) { e.preventDefault(); handleFiles(files); }
      });
    }

    render();
  }

  return { init, setState, get blocks() { return blocks; } };
})();
