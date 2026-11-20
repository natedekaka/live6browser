/* Utilitas bersama Live6Browser */
(function () {
  'use strict';

  window.L6B = window.__L6B__ || null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------ markdown ringan */

  function inline(raw) {
    const codes = [];
    let s = String(raw).replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s.replace(/\[([^\]]{1,160})\]\((https?:\/\/[^\s"'<>]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
    return s;
  }

  function markdown(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null;

    function flushPara() {
      if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; }
    }
    function closeList() {
      if (list) { out.push('</' + list + '>'); list = null; }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      let m;

      if (!t) { flushPara(); closeList(); continue; }

      if ((m = t.match(/^(#{1,3})\s+(.*)$/))) {
        flushPara(); closeList();
        const lvl = m[1].length;
        out.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>');
        continue;
      }
      if (/^(---|___|\*\*\*)$/.test(t)) { flushPara(); closeList(); out.push('<hr>'); continue; }
      if ((m = t.match(/^(?:&gt;|\u201c)\s?(.*)$/))) {
        flushPara(); closeList();
        out.push('<blockquote>' + inline(m[1]) + '</blockquote>');
        continue;
      }
      if ((m = t.match(/^[-*]\s+(.*)$/))) {
        flushPara();
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + inline(m[1]) + '</li>');
        continue;
      }
      if ((m = t.match(/^(\d+)[.)]\s+(.*)$/))) {
        flushPara();
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + inline(m[2]) + '</li>');
        continue;
      }
      closeList();
      para.push(line);
    }
    flushPara();
    closeList();
    return out.join('');
  }

  /* --------------------------------------------------------------- toast */

  function toast(msg, kind, ms) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    const life = ms || (kind === 'err' ? 4200 : 2600);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 260);
    }, life);
    while (host.children.length > 4) host.firstChild.remove();
  }

  /* ------------------------------------------------------------- lainnya */

  function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return hm;
    return d.toLocaleDateString('id', { day: 'numeric', month: 'short' }) + ' ' + hm;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return fallback(); });
    }
    return Promise.resolve(fallback());

    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e) { return false; }
    }
  }

  function isNarrow() { return window.matchMedia('(max-width: 899px)').matches; }

  window.u = { $, $$, esc, markdown, toast, fmtTime, copyText, isNarrow };
})();
