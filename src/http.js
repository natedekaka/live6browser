'use strict';

const fs = require('fs');
const path = require('path');

const {
  parseCookies,
  cookieString,
  sendJson,
  redirect,
  readBody,
  sanitizeName,
  normalizeRoom,
  safeEqual,
  logger,
  id,
  COOKIE,
} = require('./util');
const { serveStatic } = require('./static');
const { MEDIA_RE } = require('./rooms');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function clientIp(req) {
  const ip = req.socket.remoteAddress || '?';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function detectImage(buf) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}

function createHandler(ctx, role) {
  const { cfg, rooms, auth } = ctx;

  function sessionOf(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    return auth.verify(token);
  }

  function requireSession(req, res, wanted, asApi = false) {
    const fail = (status, msg) => {
      if (asApi) jsonError(res, status, msg);
      else redirect(res, status === 410 ? '/?e=ruang' : '/');
      return null;
    };
    const sess = sessionOf(req);
    if (!sess || (wanted && sess.r !== wanted)) return fail(401, 'Belum masuk.');
    const room = rooms.get(sess.room);
    if (!room) return fail(410, 'Ruangan sudah ditutup.');
    return { sess, room };
  }

  function jsonError(res, status, err) {
    sendJson(res, status, { ok: false, err });
  }

  function readJson(req, limit = 16384) {
    return readBody(req, limit).then((buf) => {
      try {
        const obj = JSON.parse(buf.toString('utf8'));
        if (!obj || typeof obj !== 'object') throw new Error('bad json');
        return obj;
      } catch {
        const e = new Error('Permintaan tidak valid.');
        e.code = 'BADJSON';
        throw e;
      }
    });
  }

  function studentUrl(code) {
    const base = ctx.lanUrls.student[0] || `http://localhost:${cfg.teacherPort}`;
    return `${base}/?code=${encodeURIComponent(code)}`;
  }

  function setSession(res, token) {
    res.setHeader('Set-Cookie', cookieString(COOKIE, token, { maxAge: cfg.sessionHours * 3600 }));
  }

  function render(file, vars) {
    let tpl = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    for (const [k, v] of Object.entries(vars)) tpl = tpl.split(`{{${k}}}`).join(v);
    return tpl;
  }

  function html(res, body, status = 200) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CSP,
      ...SECURITY_HEADERS,
    });
    res.end(body);
  }

  return async function handler(req, res) {
    const started = Date.now();
    res.on('finish', () => {
      if (req.url.startsWith('/media/') || req.url.startsWith('/css/') || req.url.startsWith('/js/')) return;
      logger.debug('%s %s -> %s (%dms)', req.method, req.url, res.statusCode, Date.now() - started);
    });

    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      sendJson(res, 400, { ok: false, err: 'URL tidak valid.' });
      return;
    }
    const p = url.pathname;

    try {
      /* ------------------------------------------------------------ API */

      if (p === '/healthz') {
        sendJson(res, 200, { ok: true, role, rooms: rooms.map.size, uptime: process.uptime() });
        return;
      }

      if (p === '/api/login' && req.method === 'POST') {
        const body = await readJson(req);
        const ip = clientIp(req);
        const t = auth.throttle(`login:${ip}`);
        if (!t.ok) return jsonError(res, 429, `Terlalu banyak percobaan. Coba lagi ${t.retryAfter} detik.`);
        if (!safeEqual(String(body.password ?? ''), cfg.teacherPassword)) {
          auth.recordFailure(`login:${ip}`);
          return jsonError(res, 401, 'Kata sandi salah. Pastikan huruf kecil semua (rahasinate) dan Caps Lock tidak aktif.');
        }
        auth.recordSuccess(`login:${ip}`);

        let code = null;
        if (body.room !== undefined && String(body.room).trim() !== '') {
          code = normalizeRoom(String(body.room));
          if (!code) return jsonError(res, 400, 'Kode ruang tidak valid (huruf, angka, - atau _).');
        } else if (cfg.defaultRoom && normalizeRoom(cfg.defaultRoom)) {
          code = normalizeRoom(cfg.defaultRoom);
        }
        const room = code ? rooms.create(code) : rooms.createFresh();
        setSession(res, auth.sessionFor('teacher', room.code, 'Guru', cfg.sessionHours));
        logger.info('guru masuk ruang %s dari %s', room.code, ip);
        sendJson(res, 200, { ok: true, room: room.code, url: studentUrl(room.code) });
        return;
      }

      if (p === '/api/join' && req.method === 'POST') {
        const body = await readJson(req);
        const code = normalizeRoom(String(body.code ?? ''));
        if (!code) return jsonError(res, 400, 'Kode ruang tidak valid.');
        const room = rooms.get(code);
        if (!room) return jsonError(res, 404, `Ruangan "${code}" tidak ditemukan. Pastikan guru sudah masuk dan kode disalin dengan benar (tanpa spasi).`);
        const name = sanitizeName(String(body.name ?? ''));
        if (!name) return jsonError(res, 400, 'Nama wajib diisi.');

        if (cfg.studentPassword) {
          const ip = clientIp(req);
          const t = auth.throttle(`join:${ip}`);
          if (!t.ok) return jsonError(res, 429, `Terlalu banyak percobaan. Coba lagi ${t.retryAfter} detik.`);
          if (!safeEqual(String(body.password ?? ''), cfg.studentPassword)) {
            auth.recordFailure(`join:${ip}`);
            return jsonError(res, 401, 'Kata sandi kelas salah.');
          }
          auth.recordSuccess(`join:${ip}`);
        }

        setSession(res, auth.sessionFor('student', code, name, cfg.sessionHours));
        logger.info('siswa "%s" bergabung ke %s', name, code);
        sendJson(res, 200, { ok: true, room: code });
        return;
      }

      if (p === '/api/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', cookieString(COOKIE, '', { maxAge: 0 }));
        sendJson(res, 200, { ok: true });
        return;
      }

      if (p === '/api/upload' && req.method === 'POST') {
        const authr = requireSession(req, res, 'teacher', true);
        if (!authr) return;
        const { room } = authr;
        const type = String(req.headers['content-type'] || '').toLowerCase();
        if (!type.startsWith('image/')) return jsonError(res, 415, 'Harus berupa gambar.');

        let buf;
        try {
          buf = await readBody(req, cfg.maxUploadMb * 1024 * 1024);
        } catch (err) {
          if (err.code === 'LIMIT') return jsonError(res, 413, `Ukuran gambar maksimal ${cfg.maxUploadMb} MB.`);
          throw err;
        }
        const fmt = detectImage(buf);
        if (!fmt) return jsonError(res, 415, 'Format gambar tidak dikenal (pakai PNG/JPEG/WebP).');
        if (!buf.length) return jsonError(res, 400, 'Gambar kosong.');

        const name = `${room.code}-${id(6)}.${fmt}`;
        if (!MEDIA_RE.test(name)) return jsonError(res, 500, 'Gagal menyimpan gambar.');
        fs.mkdirSync(cfg.mediaDir, { recursive: true });
        fs.writeFileSync(path.join(cfg.mediaDir, name), buf, { mode: 0o644 });
        sendJson(res, 200, { ok: true, url: `/media/${name}`, bytes: buf.length, type: `image/${fmt}` });
        return;
      }

      if (p === '/vendor/qrcode.js' && req.method === 'GET') {
        const file = path.join(cfg.root, 'node_modules', 'qrcode-generator', 'dist', 'qrcode.js');
        try {
          const src = fs.readFileSync(file, 'utf8');
          const body = `(function(){var exports={};var module={exports:exports};\n${src}\n;window.qrcode=module.exports;})();`;
          res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'public, max-age=86400',
          });
          res.end(body);
        } catch (err) {
          logger.warn('qrcode vendor gagal: %s', err.message);
          res.writeHead(404);
          res.end();
        }
        return;
      }

      if (p.startsWith('/media/') && req.method === 'GET') {
        const sess = sessionOf(req);
        if (!sess) return jsonError(res, 401, 'Belum masuk.');
        const name = decodeURIComponent(p.slice('/media/'.length));
        if (!MEDIA_RE.test(name)) return jsonError(res, 400, 'Nama berkas tidak valid.');
        const file = path.join(cfg.mediaDir, name);
        let stat;
        try {
          stat = fs.statSync(file);
        } catch {
          return jsonError(res, 404, 'Gambar tidak ditemukan.');
        }
        const ext = path.extname(name).toLowerCase();
        const type = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
        return;
      }

      if (p === '/bootstrap.js' && req.method === 'GET') {
        const sess = sessionOf(req);
        if (!sess || (sess.r !== 'teacher' && sess.r !== 'student')) return jsonError(res, 401, 'Belum masuk.');
        const room = rooms.get(sess.room);
        if (!room) {
          res.setHeader('Set-Cookie', cookieString(COOKIE, '', { maxAge: 0 }));
          return jsonError(res, 410, 'Ruangan sudah ditutup.');
        }
        const payload = {
          role: sess.r,
          room: room.code,
          name: sess.name,
          title: cfg.title,
          exp: sess.exp,
          studentUrl: studentUrl(room.code),
          lan: ctx.lanUrls,
          ports: { teacher: cfg.teacherPort, student: cfg.teacherPort },
          limits: {
            maxBlocks: cfg.maxBlocks,
            maxBlockChars: cfg.maxBlockChars,
            maxChatChars: cfg.maxChatChars,
            maxImagePx: cfg.maxImagePx,
            maxUploadMb: cfg.maxUploadMb,
          },
          studentPasswordRequired: Boolean(cfg.studentPassword),
          studentsOnline: room.students.size,
        };
        const body = `window.__L6B__=${JSON.stringify(payload).replace(/</g, '\\u003c')};`;
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        });
        res.end(body);
        return;
      }

      /* --------------------------------------------------------- halaman */

      if (p === '/' && req.method === 'GET') {
        const sess = sessionOf(req);
        if (sess && sess.r === role && rooms.get(sess.room)) return redirect(res, '/app');
        const err = url.searchParams.get('e');
        const errorBlock = err === 'ruang'
          ? '<div class="alert">Ruangan sudah ditutup. Silakan masuk lagi.</div>'
          : '';
        const body = render('login.html', {
          ROLE: role,
          ROLE_LABEL: role === 'teacher' ? 'Guru' : 'Siswa',
          TITLE: cfg.title,
          STUDENT_PW: cfg.studentPassword ? '1' : '0',
          ERROR_BLOCK: errorBlock,
          HAS_DEFAULT_ROOM: cfg.defaultRoom && normalizeRoom(cfg.defaultRoom) ? '1' : '0',
          PORT: role === 'teacher' ? cfg.teacherPort : cfg.studentPort,
        });
        html(res, body);
        return;
      }

      if (p === '/app' && req.method === 'GET') {
        const sess = sessionOf(req);
        if (!sess || (sess.r !== 'teacher' && sess.r !== 'student')) return redirect(res, '/');
        if (!rooms.get(sess.room)) {
          res.setHeader('Set-Cookie', cookieString(COOKIE, '', { maxAge: 0 }));
          return redirect(res, '/?e=ruang');
        }
        const body = render('app.html', { TITLE: cfg.title, ROLE: sess.r });
        html(res, body);
        return;
      }

      /* ----------------------------------------------------------- statis */

      if (serveStatic(req, res, PUBLIC_DIR)) return;

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('404 Tidak ditemukan');
    } catch (err) {
      if (err && err.code === 'LIMIT') return jsonError(res, 413, 'Ukuran berkas terlalu besar.');
      if (err && err.code === 'BADJSON') return jsonError(res, 400, err.message);
      logger.error('galat %s %s: %s', req.method, p, err && err.stack ? err.stack : err);
      if (!res.headersSent) jsonError(res, 500, 'Terjadi kesalahan di server.');
      else res.destroy();
    }
  };
}

module.exports = { createHandler, COOKIE };
