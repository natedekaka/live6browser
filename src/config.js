'use strict';

const path = require('path');

function int(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const ROOT = path.resolve(__dirname, '..');

const cfg = {
  title: process.env.LIVE6BROWSER_TITLE || 'Live6Browser',
  teacherPassword: process.env.LIVE6BROWSER_TEACHER_PASSWORD || 'rahasinate',
  studentPassword: process.env.LIVE6BROWSER_STUDENT_PASSWORD || '',
  teacherPort: int('LIVE6BROWSER_TEACHER_PORT', 9334),
  studentPort: int('LIVE6BROWSER_STUDENT_PORT', 9335),
  host: process.env.LIVE6BROWSER_HOST || '0.0.0.0',
  dataDir: path.resolve(ROOT, process.env.LIVE6BROWSER_DATA_DIR || './data'),
  sessionHours: int('LIVE6BROWSER_SESSION_HOURS', 12),
  maxUploadMb: int('LIVE6BROWSER_MAX_UPLOAD_MB', 12),
  maxBlocks: int('LIVE6BROWSER_MAX_BLOCKS', 400),
  maxBlockChars: int('LIVE6BROWSER_MAX_BLOCK_CHARS', 8000),
  maxImagePx: int('LIVE6BROWSER_MAX_IMAGE_PX', 1920),
  maxChatChars: int('LIVE6BROWSER_MAX_CHAT_CHARS', 500),
  maxStudents: int('LIVE6BROWSER_MAX_STUDENTS', 150),
  defaultRoom: process.env.LIVE6BROWSER_ROOM || '',
  logLevel: process.env.LIVE6BROWSER_LOG_LEVEL || 'info',
  root: ROOT,
};

cfg.roomsDir = path.join(cfg.dataDir, 'rooms');
cfg.mediaDir = path.join(cfg.dataDir, 'media');

module.exports = cfg;
