/* Chat / tanya jawab */
const Chat = (function () {
  'use strict';
  const role = window.L6B ? L6B.role : 'student';

  let sock = null;
  let msgs = [];
  let unread = 0;

  const list = u.$('#chatList');
  const emptyEl = u.$('#chatEmpty');
  const form = u.$('#chatForm');
  const input = u.$('#chatInput');
  const badge = u.$('#chatBadge');
  const count = u.$('#chatCount');

  function msgEl(m) {
    const el = document.createElement('div');
    el.className = 'msg' + (m.role === role ? ' me' : '');

    const who = document.createElement('div');
    who.className = 'who';
    const name = document.createElement('span');
    name.textContent = m.who;
    who.appendChild(name);
    if (m.role === 'teacher') {
      const tag = document.createElement('span');
      tag.className = 'role';
      tag.textContent = 'Guru';
      who.appendChild(tag);
    }
    el.appendChild(who);

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = m.text;
    el.appendChild(text);

    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = u.fmtTime(m.ts);
    el.appendChild(time);
    return el;
  }

  function nearBottom() {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  }

  function renderAll() {
    list.innerHTML = '';
    if (!msgs.length) {
      list.appendChild(emptyEl);
    } else {
      for (const m of msgs) list.appendChild(msgEl(m));
      list.scrollTop = list.scrollHeight;
    }
    count.textContent = msgs.length ? msgs.length + ' pesan' : '';
  }

  function append(m) {
    if (!m || !m.text) return;
    msgs.push(m);
    if (msgs.length > 200) msgs.shift();
    const stick = nearBottom();
    if (emptyEl.parentNode) emptyEl.remove();
    list.appendChild(msgEl(m));
    if (stick) list.scrollTop = list.scrollHeight;
    count.textContent = msgs.length + ' pesan';

    const chatVisible = document.body.dataset.tab === 'chat' || !u.isNarrow();
    if (!chatVisible) {
      unread = Math.min(99, unread + 1);
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = false;
    }
  }

  function setMessages(list2) {
    msgs = Array.isArray(list2) ? list2.slice(-200) : [];
    renderAll();
  }

  function clearUnread() {
    unread = 0;
    badge.hidden = true;
    badge.textContent = '0';
  }

  function init(socket) {
    sock = socket;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      sock.send({ t: 'chat', text: text });
      input.value = '';
      input.focus();
    });
    renderAll();
  }

  return { init, append, setMessages, clearUnread };
})();
