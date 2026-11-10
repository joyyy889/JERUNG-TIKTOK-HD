import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import ffprobeStatic from 'ffprobe-static';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BOT_NAME = 'JERUNG TIKTOK HD';
const COMMAND = 'jerung tiktok hd';
const AUTH_DIR = process.env.AUTH_DIR || 'auth_info';
const MAX_SIZE = 150 * 1024 * 1024;
const FFPROBE_PATH = process.env.FFPROBE_PATH || ffprobeStatic.path;
const FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpegStatic;
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const activeChats = new Set();

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

function runCommand(command, args, timeoutMs = PROCESS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      if (stderr.length < 12000) stderr += chunk;
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('Proses FFmpeg melebihi had masa 10 minit.'));
      } else if (code !== 0) {
        reject(new Error(stderr.trim() || `Process exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

function runProbe(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_PATH, [
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

function getMediaSummary(probe, sizeBytes) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  if (!video) throw new Error('FFprobe tidak menemui video stream dalam fail ini.');

  return {
    video,
    audio,
    text: [
      `Saiz: ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`,
      `Container: ${probe.format?.format_name || 'Tidak diketahui'}`,
      `Durasi: ${formatDuration(probe.format?.duration)}`,
      `Video: ${video.codec_name || 'Unknown'} (${video.profile || 'profil tidak diketahui'})`,
      `Resolusi: ${video.width && video.height ? `${video.width} × ${video.height}` : 'Tidak diketahui'}`,
      `Frame rate: ${formatRate(video.avg_frame_rate || video.r_frame_rate)}`,
      `Video bitrate: ${video.bit_rate ? `${(Number(video.bit_rate) / 1_000_000).toFixed(2)} Mbps` : 'Tidak diketahui'}`,
      `Pixel format: ${video.pix_fmt || 'Tidak diketahui'}`,
      `Audio: ${audio ? `${audio.codec_name || 'Unknown'}${audio.sample_rate ? ` / ${audio.sample_rate} Hz` : ''}` : 'Tiada audio stream'}`
    ].join('\n')
  };
}

async function sendText(socket, jid, text, quoted) {
  await socket.sendMessage(jid, { text }, quoted ? { quoted } : {});
}

function readMp4Atoms(buffer, start = 0, end = buffer.length) {
  const atoms = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const largeSize = buffer.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    atoms.push({ type, start: offset, size, headerSize, payloadStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return atoms;
}

function findMp4Atoms(buffer, wantedTypes) {
  const found = [];
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);
  function walk(start, end) {
    for (const atom of readMp4Atoms(buffer, start, end)) {
      if (wantedTypes.has(atom.type)) found.push(atom);
      if (containers.has(atom.type)) walk(atom.payloadStart, atom.end);
    }
  }
  walk(0, buffer.length);
  return found;
}

function makeExperimentalOutputs(sourceBuffer) {
  const topLevel = readMp4Atoms(sourceBuffer);
  const moov = topLevel.find(atom => atom.type === 'moov');
  const mdat = topLevel.find(atom => atom.type === 'mdat');
  if (!moov || !mdat) throw new Error('MP4 asal mesti mempunyai atom moov dan mdat yang boleh dibaca.');

  const outputA = Buffer.concat([
    sourceBuffer.subarray(0, moov.start),
    sourceBuffer.subarray(moov.end)
  ]);

  const outputB = Buffer.from(sourceBuffer);
  const sttsAtoms = findMp4Atoms(outputB, new Set(['stts']));
  if (!sttsAtoms.length) throw new Error('Atom stts tidak ditemui untuk Output B.');
  for (const atom of sttsAtoms) {
    if (atom.size < atom.headerSize + 8) throw new Error('Atom stts tidak lengkap.');
    outputB.writeUInt32BE(0, atom.payloadStart + 4);
  }

  const outputC = Buffer.from(sourceBuffer);
  const mdhdAtoms = findMp4Atoms(outputC, new Set(['mdhd']));
  if (!mdhdAtoms.length) throw new Error('Atom mdhd tidak ditemui untuk Output C.');
  for (const atom of mdhdAtoms) {
    const version = outputC[atom.payloadStart];
    const timescaleOffset = atom.payloadStart + (version === 1 ? 20 : 12);
    if (timescaleOffset + 4 > atom.end) throw new Error('Atom mdhd tidak lengkap.');
    outputC.writeUInt32BE(0, timescaleOffset);
  }

  return [
    { label: 'A', suffix: 'OUTPUT_A_NO_MOOV.mp4', buffer: outputA, method: 'Atom moov dibuang (indeks MP4 tiada)' },
    { label: 'B', suffix: 'OUTPUT_B_STTS.mp4', buffer: outputB, method: 'Entry timing stts dikosongkan' },
    { label: 'C', suffix: 'OUTPUT_C_MDHD.mp4', buffer: outputC, method: 'Timescale mdhd ditetapkan kepada 0' }
  ];
}

async function processDocument(socket, message) {
  const jid = message.key.remoteJid;
  const document = message.message?.documentMessage;
  if (!document) return;

  if (activeChats.has(jid)) {
    await sendText(socket, jid, '🦈 Video sebelum ini masih diproses. Tunggu sehingga selesai sebelum hantar video seterusnya.', message);
    return;
  }

  const declaredSize = Number(document.fileLength || 0);
  const mime = String(document.mimetype || '').toLowerCase();
  const originalName = safeFileName(document.fileName);
  const extension = path.extname(originalName).toLowerCase();
  const allowedMime = ['video/mp4', 'video/quicktime', 'application/mp4'].includes(mime);
  const allowedExtension = ['.mp4', '.mov'].includes(extension);

  if (!allowedMime && !allowedExtension) {
    await sendText(socket, jid, '🦈 Sila hantar video MP4 atau MOV dalam bentuk Document / Dokumen.', message);
    return;
  }
  if (declaredSize > MAX_SIZE) {
    await sendText(socket, jid, '🦈 Saiz video melebihi had 150 MB. Sila hantar fail yang lebih kecil.', message);
    return;
  }

  activeChats.add(jid);
  let tempDir;
  try {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'jerung-tiktok-'));
    const inputPath = path.join(tempDir, originalName);
    const baseName = path.parse(originalName).name;

    await sendText(socket, jid, '🦈 Video diterima. Sedang memuat turun dan menyediakan tiga output eksperimen MP4…', message);
    const buffer = await downloadMediaMessage(message, 'buffer', {}, {
      logger,
      reuploadRequest: socket.updateMediaMessage
    });

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Muat turun media menghasilkan fail kosong.');
    if (buffer.length > MAX_SIZE) throw new Error('Saiz video melebihi had 150 MB selepas dimuat turun.');
    await writeFile(inputPath, buffer);

    const inputProbe = await runProbe(inputPath);
    const inputStat = await stat(inputPath);
    const inputSummary = getMediaSummary(inputProbe, inputStat.size);
    const outputs = makeExperimentalOutputs(buffer);

    for (const output of outputs) {
      if (!output.buffer.length) throw new Error('Output ' + output.label + ' kosong.');
      if (output.buffer.length > MAX_SIZE) throw new Error('Output ' + output.label + ' melebihi had 150 MB.');
      const outputPath = path.join(tempDir, baseName + '_' + output.suffix);
      await writeFile(outputPath, output.buffer);
      await socket.sendMessage(jid, {
        document: output.buffer,
        mimetype: 'video/mp4',
        fileName: baseName + '_' + output.suffix,
        caption:
          '🦈 *JERUNG TIKTOK HD — OUTPUT ' + output.label + '*\n' +
          'Eksperimen: ' + output.method + '\n' +
          'Saiz: ' + (output.buffer.length / (1024 * 1024)).toFixed(2) + ' MB\n' +
          'Fail ini sengaja diubah dan mungkin tidak boleh dimainkan atau dibuka oleh Files, Gallery, WhatsApp atau Google Drive.'
      }, { quoted: message });
    }

    logger.info({
      jid,
      originalName,
      inputBytes: inputStat.size,
      outputs: outputs.map(output => ({ label: output.label, bytes: output.buffer.length, method: output.method })),
      inputCodec: inputSummary.video.codec_name
    }, 'Three experimental MP4 documents sent');
  } catch (error) {
    logger.error({ err: error, jid, originalName }, 'Experimental MP4 processing failed');
    await sendText(socket, jid, '🦈 Bot tak dapat menyediakan tiga output eksperimen. ' +
      (error.message || 'Ralat tidak diketahui.') + '\n\nFail asal tidak diubah.', message);
  } finally {
    activeChats.delete(jid);
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(error => {
        logger.warn({ err: error }, 'Could not remove temporary upload directory');
      });
    }
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
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info('WhatsApp QR diterima. Imbas QR di bawah menggunakan Linked Devices.');
      qrcode.generate(qr, { small: true });
    }

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
          await sendText(
            socket,
            message.key.remoteJid,
            '🦈 *SELAMAT DATANG KE JERUNG TIKTOK HD*\n\n' +
              'Sila hantar video MP4 atau MOV dalam bentuk *Document / Dokumen*.\n\n' +
              'Had saiz: 150 MB. Bot menghasilkan tiga fail eksperimen MP4 (A, B dan C) dan menghantarnya sebagai Document. Fail sengaja diubah; tiada jaminan ia boleh dimainkan di Google Drive atau mana-mana pemain.',
            message
          );
          logger.info({ jid: message.key.remoteJid }, 'Welcome message sent');
        } catch (error) {
          logger.error({ err: error }, 'Failed to send welcome message');
        }
        continue;
      }

      if (message.message.documentMessage) {
        await processDocument(socket, message).catch(error => {
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
