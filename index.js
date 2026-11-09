import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import ffprobeStatic from 'ffprobe-static';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BOT_NAME = 'JERUNG TIKTOK HD';
const COMMAND = 'jerung tiktok hd';
const AUTH_DIR = process.env.AUTH_DIR || 'auth_info';
const MAX_SIZE = 150 * 1024 * 1024;
const FFMPEG_PROBE_PATH = process.env.FFPROBE_PATH || ffprobeStatic.path;
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let reconnectTimer;

function getMessageText(message) {
  const content = message?.message;
  return (
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    content?.documentMessage?.caption ||
    ''
  ).trim();
}

function isPrivateChat(message) {
  const jid = message?.key?.remoteJid || '';
  return Boolean(jid) && !jid.endsWith('@g.us') && !jid.endsWith('@broadcast');
}

function safeFileName(name, fallback = 'upload.mp4') {
  const base = path.basename(String(name || fallback)).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || fallback;
}

function runProbe(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PROBE_PATH, [
      '-v', 'error',
      '-show_entries',
      'format=format_name,duration,size,bit_rate:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate,r_frame_rate,bit_rate,sample_rate,channels',
      '-of', 'json',
      filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `FFprobe exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 'Tidak diketahui';
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(1).padStart(4, '0');
  return minutes ? `${minutes} min ${remainder} saat` : `${remainder} saat`;
}

function formatRate(value) {
  if (!value || value === '0/0') return 'Tidak diketahui';
  const [numerator, denominator] = String(value).split('/').map(Number);
  if (!denominator) return String(value);
  const rate = numerator / denominator;
  return Number.isFinite(rate) ? `${rate.toFixed(2)} fps` : 'Tidak diketahui';
}

async function analyzeDocument(socket, message) {
  const jid = message.key.remoteJid;
  const document = message.message?.documentMessage;
  if (!document) return;

  const declaredSize = Number(document.fileLength || 0);
  const mime = String(document.mimetype || '').toLowerCase();
  const originalName = safeFileName(document.fileName);
  const extension = path.extname(originalName).toLowerCase();
  const allowedMime = ['video/mp4', 'video/quicktime', 'application/mp4'].includes(mime);
  const allowedExtension = ['.mp4', '.mov'].includes(extension);

  if (!allowedMime && !allowedExtension) {
    await socket.sendMessage(jid, {
      text: '🦈 Sila hantar fail video MP4 atau MOV sahaja dalam bentuk Document.'
    }, { quoted: message });
    return;
  }

  if (declaredSize > MAX_SIZE) {
    await socket.sendMessage(jid, {
      text: '🦈 Saiz video melebihi had 150 MB. Sila hantar fail yang lebih kecil.'
    }, { quoted: message });
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jerung-tiktok-'));
  const inputPath = path.join(tempDir, originalName);

  try {
    await socket.sendMessage(jid, { text: '🦈 Video diterima. Sedang memuat turun dan memeriksa metadata…' }, { quoted: message });

    const buffer = await downloadMediaMessage(message, 'buffer', {}, {
      logger,
      reuploadRequest: socket.updateMediaMessage
    });

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Muat turun media menghasilkan fail kosong.');
    }
    if (buffer.length > MAX_SIZE) {
      await socket.sendMessage(jid, {
        text: '🦈 Saiz video melebihi had 150 MB selepas dimuat turun. Fail tidak diproses.'
      }, { quoted: message });
      return;
    }

    await writeFile(inputPath, buffer);
    const fileInfo = await stat(inputPath);
    const probe = await runProbe(inputPath);
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const video = streams.find(stream => stream.codec_type === 'video');
    const audio = streams.find(stream => stream.codec_type === 'audio');

    if (!video) {
      throw new Error('FFprobe tidak menemui video stream dalam fail ini.');
    }

    const sizeMB = (fileInfo.size / (1024 * 1024)).toFixed(2);
    const duration = formatDuration(probe.format?.duration);
    const resolution = video.width && video.height ? `${video.width} × ${video.height}` : 'Tidak diketahui';
    const fps = formatRate(video.avg_frame_rate || video.r_frame_rate);
    const bitrate = video.bit_rate ? `${(Number(video.bit_rate) / 1_000_000).toFixed(2)} Mbps` : 'Tidak diketahui';
    const audioInfo = audio
      ? `${audio.codec_name || 'Unknown'}${audio.sample_rate ? ` / ${audio.sample_rate} Hz` : ''}`
      : 'Tiada audio stream';

    await socket.sendMessage(jid, {
      text:
        '🦈 *ANALISIS VIDEO SELESAI*\n\n' +
        `Nama fail: ${originalName}\n` +
        `Saiz: ${sizeMB} MB\n` +
        `Container: ${probe.format?.format_name || 'Tidak diketahui'}\n` +
        `Durasi: ${duration}\n` +
        `Video: ${video.codec_name || 'Unknown'} (${video.profile || 'profil tidak diketahui'})\n` +
        `Resolusi: ${resolution}\n` +
        `Frame rate: ${fps}\n` +
        `Video bitrate: ${bitrate}\n` +
        `Pixel format: ${video.pix_fmt || 'Tidak diketahui'}\n` +
        `Audio: ${audioInfo}\n\n` +
        'Fail asal masih dikekalkan. Langkah ini hanya membaca metadata; belum membuat conversion atau output baharu.'
    }, { quoted: message });

    logger.info({ jid, originalName, size: fileInfo.size, format: probe.format?.format_name }, 'Document analyzed');
  } catch (error) {
    logger.error({ err: error, jid, originalName }, 'Document analysis failed');
    await socket.sendMessage(jid, {
      text: '🦈 Maaf, bot tak dapat membaca video ini. Pastikan fail MP4/MOV tidak rosak dan cuba hantar semula.'
    }, { quoted: message });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(error => {
      logger.warn({ err: error }, 'Could not remove temporary upload directory');
    });
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;

  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (error) {
    logger.warn({ err: error }, 'Could not fetch latest WhatsApp Web version');
  }

  const socket = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      logger.info({ bot: BOT_NAME }, 'WhatsApp connected');
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      logger.warn({ statusCode, loggedOut }, 'WhatsApp connection closed');

      if (!loggedOut && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined;
          startBot().catch(error => logger.error({ err: error }, 'Reconnect failed'));
        }, 5000);
      } else if (loggedOut) {
        logger.error('Session logged out. Pair WhatsApp again to continue.');
      }
    }
  });

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      if (!message?.message || message.key?.fromMe || !isPrivateChat(message)) continue;

      const text = getMessageText(message);
      if (text.toLowerCase() === COMMAND) {
        try {
          await socket.sendMessage(message.key.remoteJid, {
            text:
              '🦈 *SELAMAT DATANG KE JERUNG TIKTOK HD*\n\n' +
              'Sila hantar video anda dalam bentuk *Document / Dokumen*, bukan sebagai video biasa.\n\n' +
              'Format diterima: MP4 dan MOV. Had saiz: 150 MB.\n' +
              'Buat masa ini bot akan membaca dan memaparkan metadata video dahulu.'
          }, { quoted: message });
          logger.info({ jid: message.key.remoteJid }, 'Welcome message sent');
        } catch (error) {
          logger.error({ err: error }, 'Failed to send welcome message');
        }
        continue;
      }

      if (message.message.documentMessage) {
        await analyzeDocument(socket, message).catch(error => {
          logger.error({ err: error }, 'Unexpected document handler error');
        });
      }
    }
  });

  return socket;
}

process.on('unhandledRejection', error => {
  logger.error({ err: error }, 'Unhandled promise rejection');
});

process.on('uncaughtException', error => {
  logger.fatal({ err: error }, 'Uncaught exception');
  process.exit(1);
});

startBot().catch(error => {
  logger.fatal({ err: error }, 'Bot startup failed');
  process.exit(1);
});
