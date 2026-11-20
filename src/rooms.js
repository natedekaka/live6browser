'use strict';

const fs = require('fs');
const path = require('path');

const { id, randomCode, normalizeRoom, logger } = require('./util');

const MEDIA_RE = /^[A-Za-z0-9._-]{1,80}$/;

class Rooms {
  constructor(cfg) {
    this.cfg = cfg;
    this.map = new Map();
  }

  /* ------------------------------------------------------------ storage */

  load() {
    fs.mkdirSync(this.cfg.roomsDir, { recursive: true });
    fs.mkdirSync(this.cfg.mediaDir, { recursive: true });
    let n = 0;
    for (const file of fs.readdirSync(this.cfg.roomsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.cfg.roomsDir, file), 'utf8'));
        const code = normalizeRoom(data.code);
        if (!code) continue;
        const room = this.blank(code);
        room.createdAt = Number(data.createdAt) || Date.now();
        room.updatedAt = Number(data.updatedAt) || room.createdAt;
        room.blocks = Array.isArray(data.blocks) ? data.blocks.slice(0, this.cfg.maxBlocks) : [];
        room.chat = Array.isArray(data.chat) ? data.chat.slice(-200) : [];
        this.map.set(code, room);
        n++;
      } catch (err) {
        logger.warn('gagal membaca %s: %s', file, err.message);
      }
    }
    logger.info('%d ruang dimuat dari %s', n, this.cfg.roomsDir);
  }

  blank(code) {
    return {
      code,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blocks: [],
      chat: [],
      teachers: new Set(), // ws guru
      students: new Map(), // connId -> {name, ws}
      stream: { on: false, w: 0, h: 0, fps: 8, q: 0.65, ws: null, timer: null },
      saveTimer: null,
      dirty: false,
    };
  }

  persist(room, delay = 600) {
    room.dirty = true;
    room.updatedAt = Date.now();
    if (room.saveTimer) return;
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null;
      this.saveNow(room);
    }, delay);
    if (room.saveTimer.unref) room.saveTimer.unref();
  }

  saveNow(room) {
    if (!room.dirty) return;
    room.dirty = false;
    const file = path.join(this.cfg.roomsDir, `${room.code}.json`);
    const tmp = `${file}.tmp`;
    const data = {
      v: 1,
      code: room.code,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      blocks: room.blocks,
      chat: room.chat.slice(-200),
    };
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch (err) {
      logger.warn('gagal menyimpan ruang %s: %s', room.code, err.message);
    }
  }

  flushAll() {
    for (const room of this.map.values()) {
      if (room.saveTimer) clearTimeout(room.saveTimer);
      room.saveTimer = null;
      this.saveNow(room);
    }
  }

  /* --------------------------------------------------------------- room */

  get(code) {
    return this.map.get(code) || null;
  }

  create(code) {
    let room = this.map.get(code);
    if (room) return room;
    room = this.blank(code);
    this.map.set(code, room);
    this.persist(room, 0);
    return room;
  }

  /** Buat kode ruang baru yang belum terpakai. */
  createFresh() {
    for (let i = 0; i < 50; i++) {
      const code = randomCode();
      if (!this.map.has(code)) return this.create(code);
    }
    return this.create(randomCode(8));
  }

  remove(code) {
    const room = this.map.get(code);
    if (!room) return;
    if (room.saveTimer) clearTimeout(room.saveTimer);
    if (room.stream.timer) clearInterval(room.stream.timer);
    this.map.delete(code);
    try {
      fs.unlinkSync(path.join(this.cfg.roomsDir, `${code}.json`));
    } catch { /* sudah tidak ada */ }
    // hapus media milik ruang
    try {
      for (const f of fs.readdirSync(this.cfg.mediaDir)) {
        if (f.startsWith(`${code}-`)) fs.unlinkSync(path.join(this.cfg.mediaDir, f));
      }
    } catch { /* abaikan */ }
    logger.info('ruang %s dibersihkan', code);
  }

  /** Ruang tanpa koneksi dan sudah lama tidak aktif. */
  sweep(maxIdleMs) {
    const now = Date.now();
    for (const room of [...this.map.values()]) {
      const busy = room.teachers.size > 0 || room.students.size > 0 || room.stream.on;
      if (!busy && now - room.updatedAt > maxIdleMs) this.remove(room.code);
    }
  }

  /* --------------------------------------------------------- operasi papan */

  validateText(raw) {
    if (typeof raw !== 'string') return { err: 'Teks tidak valid.' };
    const text = raw.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (!text) return { err: 'Teks kosong.' };
    if (text.length > this.cfg.maxBlockChars) {
      return { err: `Teks terlalu panjang (maks ${this.cfg.maxBlockChars} karakter).` };
    }
    return { text };
  }

  addBlock(room, raw) {
    if (room.blocks.length >= this.cfg.maxBlocks) {
      return { err: `Blok penuh (maks ${this.cfg.maxBlocks}).` };
    }
    const kind = raw && raw.kind === 'image' ? 'image' : 'text';
    let block;
    if (kind === 'image') {
      const url = typeof raw.url === 'string' ? raw.url : '';
      const name = path.basename(url);
      if (!/^\/media\//.test(url) || !MEDIA_RE.test(name)) return { err: 'Gambar tidak valid.' };
      if (!fs.existsSync(path.join(this.cfg.mediaDir, name))) return { err: 'Gambar tidak ditemukan.' };
      const w = clampInt(raw.w, 1, 8000);
      const h = clampInt(raw.h, 1, 8000);
      const caption = typeof raw.caption === 'string' ? raw.caption.trim().slice(0, 300) : '';
      block = { id: id(), kind: 'image', url, w, h, caption };
    } else {
      const v = this.validateText(raw && raw.text);
      if (v.err) return { err: v.err };
      block = { id: id(), kind: 'text', text: v.text };
    }
    room.blocks.push(block);
    this.persist(room);
    return { block };
  }

  updateBlock(room, raw) {
    const block = room.blocks.find((b) => b.id === (raw && raw.id));
    if (!block) return { err: 'Blok tidak ditemukan.' };
    if (block.kind !== 'text') return { err: 'Gambar tidak bisa diedit.' };
    const v = this.validateText(raw.text);
    if (v.err) return { err: v.err };
    block.text = v.text;
    this.persist(room);
    return { block };
  }

  deleteBlock(room, raw) {
    const i = room.blocks.findIndex((b) => b.id === (raw && raw.id));
    if (i < 0) return { err: 'Blok tidak ditemukan.' };
    const [block] = room.blocks.splice(i, 1);
    this.persist(room);
    return { block };
  }

  moveBlock(room, raw) {
    const i = room.blocks.findIndex((b) => b.id === (raw && raw.id));
    if (i < 0) return { err: 'Blok tidak ditemukan.' };
    const dir = Number(raw.dir) < 0 ? -1 : 1;
    const j = i + dir;
    if (j < 0 || j >= room.blocks.length) return { err: 'Sudah di ujung.' };
    const [block] = room.blocks.splice(i, 1);
    room.blocks.splice(j, 0, block);
    this.persist(room);
    return { block, from: i, to: j };
  }

  clearBoard(room) {
    room.blocks = [];
    this.persist(room);
    return {};
  }

  addChat(room, { who, role, text }) {
    if (typeof text !== 'string') return { err: 'Pesan tidak valid.' };
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return { err: 'Pesan kosong.' };
    if (clean.length > this.cfg.maxChatChars) {
      return { err: `Pesan terlalu panjang (maks ${this.cfg.maxChatChars}).` };
    }
    const msg = { id: id(6), who: String(who).slice(0, 24), role: role === 'teacher' ? 'teacher' : 'student', text: clean, ts: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 200) room.chat.splice(0, room.chat.length - 200);
    this.persist(room, 1500);
    return { msg };
  }

  snapshot(room) {
    const names = new Set();
    for (const s of room.students.values()) names.add(s.name);
    return {
      blocks: room.blocks,
      chat: room.chat,
      students: [...names].sort(),
      teachers: room.teachers.size,
      stream: {
        on: room.stream.on,
        w: room.stream.w,
        h: room.stream.h,
        fps: room.stream.fps,
        q: room.stream.q,
      },
    };
  }
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

module.exports = { Rooms, MEDIA_RE };
