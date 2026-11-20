'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { logger } = require('./util');

let secret = null;

function initSecret(dataDir) {
  const file = path.join(dataDir, 'secret');
  try {
    secret = fs.readFileSync(file);
    if (secret.length < 16) throw new Error('too short');
  } catch {
    fs.mkdirSync(dataDir, { recursive: true });
    secret = crypto.randomBytes(32);
    try {
      fs.writeFileSync(file, secret, { mode: 0o600 });
      logger.info('kunci sesi dibuat di %s', file);
    } catch (err) {
      logger.warn('gagal menyimpan kunci sesi: %s', err.message);
    }
  }
}

function sign(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let obj;
  try {
    obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.exp !== 'number' || obj.exp < Date.now()) return null;
  if (obj.r !== 'teacher' && obj.r !== 'student') return null;
  if (typeof obj.room !== 'string') return null;
  return obj;
}

function sessionFor(role, room, name, hours) {
  const now = Date.now();
  return sign({
    r: role,
    room,
    name,
    sid: crypto.randomBytes(8).toString('base64url'),
    iat: now,
    exp: now + hours * 3600 * 1000,
  });
}

/* ------------------------------------------------------------- throttle */

const buckets = new Map();

/**
 * Batasi percobaan login yang gagal per IP.
 * @returns {{ok:boolean, retryAfter:number}}
 */
function throttle(key, { max = 8, windowMs = 15 * 60000, lockMs = 15 * 60000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs, lockedUntil: 0 };
    buckets.set(key, b);
  }
  if (b.lockedUntil > now) return { ok: false, retryAfter: Math.ceil((b.lockedUntil - now) / 1000) };
  if (b.count >= max) {
    b.lockedUntil = now + lockMs;
    return { ok: false, retryAfter: Math.ceil(lockMs / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

function recordFailure(key, { max = 8, windowMs = 15 * 60000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs, lockedUntil: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
}

function recordSuccess(key) {
  buckets.delete(key);
}

function sweep() {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.resetAt && now > b.lockedUntil) buckets.delete(k);
}

setInterval(sweep, 10 * 60000).unref();

module.exports = { initSecret, sign, verify, sessionFor, throttle, recordFailure, recordSuccess };
