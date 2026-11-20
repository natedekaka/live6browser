/* Klien WebSocket dengan sambung-ulang otomatis */
function createSocket(opts) {
  'use strict';
  const onMessage = opts.onMessage;
  const onStatus = opts.onStatus || function () {};
  const MAX_QUEUE = 60;

  let ws = null;
  let closedByUser = false;
  let attempts = 0;
  let queue = [];
  let everOpened = false;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    try {
      socket = new WebSocket(proto + '//' + location.host + '/ws');
    } catch (e) {
      return scheduleReconnect();
    }
    ws = socket;
    socket.binaryType = 'arraybuffer';

    socket.onopen = function () {
      if (ws !== socket) return;
      attempts = 0;
      everOpened = true;
      onStatus('open');
      const pending = queue;
      queue = [];
      for (const msg of pending) {
        try { socket.send(msg); } catch (e) { /* abaikan */ }
      }
    };

    socket.onmessage = function (ev) {
      if (ws !== socket) return;
      if (typeof ev.data === 'string') {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg && typeof msg.t === 'string') onMessage(msg);
      } else {
        onMessage({ t: '__frame', data: ev.data });
      }
    };

    socket.onerror = function () { /* biarkan onclose yang menangani */ };

    socket.onclose = function () {
      if (ws !== socket) return;
      ws = null;
      if (closedByUser) return;
      onStatus(everOpened ? 'reconnect' : 'fail');
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (closedByUser) return;
    const delay = Math.min(6000, 400 * Math.pow(1.7, attempts++));
    setTimeout(function () {
      if (!closedByUser) connect();
    }, delay);
  }

  connect();

  return {
    send(obj) {
      const text = JSON.stringify(obj);
      if (ws && ws.readyState === 1) ws.send(text);
      else if (queue.length < MAX_QUEUE) queue.push(text);
    },
    sendRaw(data) {
      if (ws && ws.readyState === 1) {
        try { ws.send(data); } catch (e) { /* abaikan */ }
      }
    },
    get open() { return !!ws && ws.readyState === 1; },
    close() {
      closedByUser = true;
      if (ws) try { ws.close(); } catch (e) { /* abaikan */ }
    },
  };
}
