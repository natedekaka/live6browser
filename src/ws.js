'use strict';

const { WebSocketServer } = require('ws');

const { verify } = require('./auth');
const { parseCookies, COOKIE, logger, id } = require('./util');

const HEARTBEAT_MS = 30000;
const MAX_FRAME = 6 * 1024 * 1024; // batas satu frame JPEG
const SLOW_CLIENT = 1_500_000; // lewat dari ini, frame untuk siswa itu dibuang

function safeSend(ws, data, opts) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(data, opts);
    return true;
  } catch (err) {
    logger.debug('kirim pesan gagal: %s', err.message);
    return false;
  }
}

function socketsOf(room) {
  const list = [...room.teachers];
  for (const s of room.students.values()) list.push(s.ws);
  return list;
}

function broadcast(room, obj, except) {
  const msg = JSON.stringify(obj);
  for (const ws of socketsOf(room)) {
    if (ws === except) continue;
    safeSend(ws, msg);
  }
}

function broadcastFrame(room, buf) {
  for (const s of room.students.values()) {
    const ws = s.ws;
    if (ws.readyState !== 1) continue;
    if (ws.bufferedAmount > SLOW_CLIENT) {
      room.stream.dropped = (room.stream.dropped || 0) + 1;
      continue;
    }
    try {
      ws.send(buf, { binary: true });
    } catch (err) {
      logger.debug('kirim frame gagal: %s', err.message);
    }
  }
}

function presence(room) {
  const names = [...new Set([...room.students.values()].map((s) => s.name))].sort();
  broadcast(room, { t: 'presence', students: names, teachers: room.teachers.size });
}

function streamState(room) {
  const s = room.stream;
  return { t: 'stream.state', on: s.on, w: s.w, h: s.h, fps: s.fps, q: s.q };
}

/* ------------------------------------------------------------- streaming */

function stopStream(room, reason) {
  const s = room.stream;
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
  const was = s.on;
  s.on = false;
  s.ws = null;
  if (was) {
    logger.info(
      'siaran ruang %s berhenti%s — %d frame terkirim, %d dibuang%s',
      room.code,
      reason ? ` (${reason})` : '',
      s.frames || 0,
      s.dropped || 0,
      s.dropped ? ' (koneksi siswa lambat)' : ''
    );
    s.frames = 0;
    s.dropped = 0;
    broadcast(room, streamState(room));
  }
}

function startPull(room) {
  const s = room.stream;
  if (s.timer) clearInterval(s.timer);
  const tick = () => {
    const ws = s.ws;
    if (!s.on || !ws || ws.readyState !== 1) return stopStream(room, 'penyiar terputus');
    if (ws.bufferedAmount > 4_000_000) return; // guru sedang berat, lewati tick ini
    safeSend(ws, JSON.stringify({ t: 'pull' }));
  };
  s.timer = setInterval(tick, Math.max(50, Math.round(1000 / s.fps)));
  if (s.timer.unref) s.timer.unref();
  tick();
}

function startStream(room, ws, msg) {
  const s = room.stream;
  if (s.ws && s.ws !== ws && s.ws.readyState === 1) {
    // guru lain mengambil alih
    safeSend(s.ws, JSON.stringify({ t: 'stream.state', on: false, reason: 'diambil guru lain' }));
  }
  s.on = true;
  s.ws = ws;
  s.w = clamp(msg.w, 16, 4096, 1280);
  s.h = clamp(msg.h, 16, 4096, 720);
  s.fps = clamp(msg.fps, 1, 20, 8);
  s.q = clamp(msg.q, 0.2, 0.9, 0.65);
  s.dropped = 0;
  startPull(room);
  logger.info('siaran ruang %s dimulai (%dx%d @%dfps q%s)', room.code, s.w, s.h, s.fps, s.q);
  broadcast(room, streamState(room));
}

function updateStream(room, ws, msg) {
  const s = room.stream;
  if (!s.on || s.ws !== ws) return false;
  if (msg.fps !== undefined) s.fps = clamp(msg.fps, 1, 20, s.fps);
  if (msg.q !== undefined) s.q = clamp(msg.q, 0.2, 0.9, s.q);
  if (msg.w !== undefined) s.w = clamp(msg.w, 16, 4096, s.w);
  if (msg.h !== undefined) s.h = clamp(msg.h, 16, 4096, s.h);
  startPull(room);
  broadcast(room, streamState(room));
  return true;
}

function clamp(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/* ------------------------------------------------------------ koneksi ws */

function attachWs(ctx, server) {
  const { cfg, rooms } = ctx;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const sess = verify(token);
    if (!sess || (sess.r !== 'teacher' && sess.r !== 'student')) return deny(socket, 401, 'Unauthorized');
    if (!rooms.get(sess.room)) return deny(socket, 404, 'Room gone');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, sess));
  });

  wss.on('connection', (ws, req, sess) => onConnection(ctx, ws, sess));

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch { /* abaikan */ }
    }
  }, HEARTBEAT_MS);
  if (hb.unref) hb.unref();

  server.on('close', () => clearInterval(hb));
  return wss;
}

function deny(socket, status, text) {
  const body = `${status} ${text}`;
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
  socket.destroy();
}

function onConnection(ctx, ws, sess) {
  const { cfg, rooms } = ctx;
  const role = sess.r;
  const room = rooms.get(sess.room);
  if (!room) {
    safeSend(ws, JSON.stringify({ t: 'err', msg: 'Ruangan sudah ditutup.' }));
    ws.close(4404, 'room gone');
    return;
  }

  const connId = id(8);
  ws.isAlive = true;
  ws.role = role;
  ws.l6bName = sess.name;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('error', (err) => logger.debug('ws error: %s', err.message));

  if (role === 'student') {
    if (room.students.size >= cfg.maxStudents) {
      safeSend(ws, JSON.stringify({ t: 'err', msg: 'Kelas penuh.' }));
      ws.close(4429, 'full');
      return;
    }
    room.students.set(connId, { name: sess.name, ws });
  } else {
    room.teachers.add(ws);
  }
  room.updatedAt = Date.now();

  safeSend(
    ws,
    JSON.stringify({
      t: 'hello',
      role,
      room: room.code,
      name: sess.name,
      exp: sess.exp,
      serverTime: Date.now(),
      state: rooms.snapshot(room),
    })
  );
  presence(room);

  ws.on('message', (data, isBinary) => {
    room.updatedAt = Date.now();
    if (isBinary) return onFrame(room, ws, data);
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return safeSend(ws, JSON.stringify({ t: 'err', op: '-', msg: 'Pesan tidak valid.' }));
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (role === 'teacher') onTeacher(ctx, room, ws, msg);
    else onStudent(ctx, room, ws, msg);
  });

  ws.on('close', () => {
    if (role === 'student') {
      room.students.delete(connId);
    } else {
      room.teachers.delete(ws);
      if (room.stream.ws === ws) stopStream(room, 'guru terputus');
    }
    room.updatedAt = Date.now();
    presence(room);
    if (room.teachers.size === 0 && room.students.size === 0 && !room.stream.on) {
      rooms.persist(room, 0);
    }
  });
}

function err(ws, op, msg) {
  safeSend(ws, JSON.stringify({ t: 'err', op, msg }));
}

function onTeacher(ctx, room, ws, msg) {
  const { rooms } = ctx;
  const op = msg.t;
  let r;
  switch (op) {
    case 'block.add':
      r = rooms.addBlock(room, msg);
      if (r.err) return err(ws, op, r.err);
      return broadcast(room, { t: 'board.state', blocks: room.blocks });

    case 'block.update':
      r = rooms.updateBlock(room, msg);
      if (r.err) return err(ws, op, r.err);
      return broadcast(room, { t: 'board.state', blocks: room.blocks });

    case 'block.delete':
      r = rooms.deleteBlock(room, msg);
      if (r.err) return err(ws, op, r.err);
      return broadcast(room, { t: 'board.state', blocks: room.blocks });

    case 'block.move':
      r = rooms.moveBlock(room, msg);
      if (r.err) return err(ws, op, r.err);
      return broadcast(room, { t: 'board.state', blocks: room.blocks });

    case 'board.clear':
      rooms.clearBoard(room);
      return broadcast(room, { t: 'board.state', blocks: room.blocks });

    case 'chat':
      r = rooms.addChat(room, { who: 'Guru', role: 'teacher', text: msg.text });
      if (r.err) return err(ws, op, r.err);
      return broadcast(room, { t: 'chat', msg: r.msg });

    case 'stream.start':
      return startStream(room, ws, msg);

    case 'stream.settings':
      if (!updateStream(room, ws, msg)) return err(ws, op, 'Tidak ada siaran aktif.');
      return;

    case 'stream.stop':
      if (room.stream.ws === ws) stopStream(room, 'dihentikan guru');
      return;

    default:
      return err(ws, op, 'Perintah tidak dikenal.');
  }
}

function onStudent(ctx, room, ws, msg) {
  const { rooms } = ctx;
  if (msg.t !== 'chat') return err(ws, msg.t, 'Hanya chat yang dikirim siswa.');
  const r = rooms.addChat(room, { who: ws.l6bName || 'Siswa', role: 'student', text: msg.text });
  if (r.err) return err(ws, 'chat', r.err);
  broadcast(room, { t: 'chat', msg: r.msg });
}

function onFrame(room, ws, buf) {
  if (!room.stream.on || room.stream.ws !== ws) return; // bukan penyiar sah
  if (!buf || !buf.length || buf.length > MAX_FRAME) return;
  room.stream.frames = (room.stream.frames || 0) + 1;
  broadcastFrame(room, buf);
}

module.exports = { attachWs };
