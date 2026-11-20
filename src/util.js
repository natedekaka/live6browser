'use strict';

const crypto = require('crypto');

/* ------------------------------------------------------------------ log */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS.info;

function setLevel(name) {
  if (LEVELS[name] != null) threshold = LEVELS[name];
}

function log(level, ...args) {
  if ((LEVELS[level] || 20) < threshold) return;
  const t = new Date().toTimeString().slice(0, 8);
  const isFmt = typeof args[0] === 'string';
  const head = isFmt ? args[0] : '%o';
  const rest = isFmt ? args.slice(1) : args;
  const fn = level === 'debug' ? console.log : console[level] || console.log;
  fn(`[${t}] ${level.toUpperCase()} ${head}`, ...rest);
}

const logger = {
  debug: (...a) => log('debug', ...a),
  info: (...a) => log('info', ...a),
  warn: (...a) => log('warn', ...a),
  error: (...a) => log('error', ...a),
};

/* ------------------------------------------------------------------ ids */

const id = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // tanap 0/O/1/I

function randomCode(len = 6) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

const ROOM_RE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

function normalizeRoom(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return ROOM_RE.test(code) ? code : null;
}

/* --------------------------------------------------------------- strings */

function sanitizeName(raw, max = 24) {
  if (typeof raw !== 'string') return '';
  const s = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return s;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // tetap lakukan perbandingan agar waktu konstan
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/* --------------------------------------------------------------- cookies */

const COOKIE = 'l6b';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieString(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  bits.push(`Path=${opts.path || '/'}`);
  bits.push('HttpOnly');
  bits.push('SameSite=Lax');
  if (opts.secure) bits.push('Secure');
  return bits.join('; ');
}

/* ------------------------------------------------------------------ http */

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('payload too large');
      err.code = 'LIMIT';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function lanAddresses() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (/^(docker|veth|br-|virbr|tun)/.test(name)) continue;
    for (const it of list || []) {
      if (it.family !== 'IPv4' || it.internal) continue;
      // lewati IP docker 172.17.x.x
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(it.address) && name.startsWith('docker')) continue;
      out.push({ name, ip: it.address, url: null });
    }
  }
  // utamakan jaringan privat kelas
  out.sort((a, b) => rank(a.ip) - rank(b.ip));
  return out;

  function rank(ip) {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    if (ip.startsWith('100.')) return 4; // tailscale
    return 3;
  }
}

module.exports = {
  COOKIE,
  logger,
  setLevel,
  id,
  randomCode,
  normalizeRoom,
  sanitizeName,
  safeEqual,
  parseCookies,
  cookieString,
  sendJson,
  redirect,
  readBody,
  lanAddresses,
};
