'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const cfg = require('./src/config');
const auth = require('./src/auth');
const { Rooms } = require('./src/rooms');
const { createHandler } = require('./src/http');
const { attachWs } = require('./src/ws');
const { setLevel, logger, lanAddresses } = require('./src/util');

function isHttps() {
  try {
    const dir = process.env.LIVE6BROWSER_CERT_DIR || path.join(cfg.dataDir, '..', 'certs');
    return fs.existsSync(path.join(dir, 'cert.pem')) && fs.existsSync(path.join(dir, 'key.pem'));
  } catch { return false; }
}

function scheme() { return isHttps() ? 'https' : 'http'; }

function lanUrls() {
  const addrs = lanAddresses();
  const s = scheme();
  const urls = { teacher: [], student: [], ips: [] };
  for (const a of addrs) {
    urls.ips.push(a.ip);
    urls.teacher.push(`${s}://${a.ip}:${cfg.teacherPort}`);
    urls.student.push(`${s}://${a.ip}:${cfg.teacherPort}`); // satu port untuk guru & siswa
  }
  if (!urls.teacher.length) {
    urls.teacher.push(`${s}://localhost:${cfg.teacherPort}`);
    urls.student.push(`${s}://localhost:${cfg.teacherPort}`);
  }
  return urls;
}

function listen(server, port, label) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => reject(Object.assign(err, { label })));
    server.listen(port, cfg.host, () => resolve());
  });
}

async function main() {
  setLevel(cfg.logLevel);

  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    fs.mkdirSync(cfg.roomsDir, { recursive: true });
    fs.mkdirSync(cfg.mediaDir, { recursive: true });
  } catch (err) {
    logger.error('gagal menyiapkan %s: %s', cfg.dataDir, err.message);
    process.exit(1);
  }

  auth.initSecret(cfg.dataDir);

  const rooms = new Rooms(cfg);
  rooms.load();

  const ctx = { cfg, rooms, auth, lanUrls: lanUrls() };

  const httpsMode = isHttps();
  const certDir = process.env.LIVE6BROWSER_CERT_DIR || path.join(cfg.dataDir, '..', 'certs');
  const handler = createHandler(ctx, 'teacher');
  const server = httpsMode
    ? https.createServer({
        key: fs.readFileSync(path.join(certDir, 'key.pem')),
        cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
      }, handler)
    : http.createServer(handler);
  attachWs(ctx, server);
  if (httpsMode) logger.info(' HTTPS aktif (sertifikat self-signed di %s)', certDir);

  try {
    await listen(server, cfg.teacherPort, 'live6browser');
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      logger.error('Port %s sudah dipakai proses lain.', err.port || cfg.teacherPort);
    } else {
      logger.error('Gagal menjalankan server: %s', err.message);
    }
    process.exit(1);
  }

  logger.info('==========================================================');
  logger.info(' %s berjalan', cfg.title);
  logger.info(' URL    : %s://localhost:%d  (guru & siswa, satu port)', scheme(), cfg.teacherPort);
  for (const url of ctx.lanUrls.teacher) logger.info('          %s', url);
  logger.info(' Ruang awal: %s', cfg.defaultRoom || '(dibuat saat guru masuk)');
  logger.info(' Data     : %s', cfg.dataDir);
  logger.info('==========================================================');

  const sweepTimer = setInterval(() => rooms.sweep(cfg.sessionHours * 3600 * 1000), 10 * 60 * 1000);
  if (sweepTimer.unref) sweepTimer.unref();

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('mematikan (%s)...', signal);
    clearInterval(sweepTimer);
    try {
      rooms.flushAll();
    } catch (err) {
      logger.warn('gagal menyimpan: %s', err.message);
    }
    server.close();
    setTimeout(() => process.exit(0), 300).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => logger.error('uncaught: %s', err.stack || err));
  process.on('unhandledRejection', (err) => logger.error('unhandled: %s', err && err.stack ? err.stack : err));
}

main();
