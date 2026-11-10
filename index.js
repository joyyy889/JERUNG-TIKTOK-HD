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
    const output1Path = path.join(tempDir, baseName + '_OUTPUT_1.mp4');
    const output2Path = path.join(tempDir, baseName + '_OUTPUT_2.mp4');

    await sendText(socket, jid, '🦈 Video diterima. Sedang memuat turun dan memeriksa fail asal…', message);
    const buffer = await downloadMediaMessage(message, 'buffer', {}, {
      logger,
      reuploadRequest: socket.updateMediaMessage
    });

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Muat turun media menghasilkan fail kosong.');
    }
    if (buffer.length > MAX_SIZE) {
      throw new Error('Saiz video melebihi had 150 MB selepas dimuat turun.');
    }

    await writeFile(inputPath, buffer);
    const inputStat = await stat(inputPath);
    const inputProbe = await runProbe(inputPath);
    const inputSummary = getMediaSummary(inputProbe, inputStat.size);
    const sourceDuration = Number(inputProbe.format?.duration);

    await sendText(
      socket,
      jid,
      '🦈 Video asal berjaya dibaca.\n' + inputSummary.text +
      '\n\nSedang menghasilkan dua output C-Copy tanpa re-encode…',
      message
    );

    // OUTPUT 1: stream-copy remux. No video/audio re-encoding.
    // The WhatsApp message duration hint is set to 0; MP4 internal duration is not falsified.
    await runCommand(FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-map', '0',
      '-map_metadata', '0',
      '-c', 'copy',
      '-movflags', '+faststart',
      '-f', 'mp4',
      output1Path
    ]);

    const output1Stat = await stat(output1Path);
    if (!output1Stat.size) throw new Error('Output 1 kosong.');
    if (output1Stat.size > MAX_SIZE) throw new Error('Output 1 melebihi had penghantaran 150 MB.');
    const output1Probe = await runProbe(output1Path);
    const output1Summary = getMediaSummary(output1Probe, output1Stat.size);

    // OUTPUT 2: stream-copy remux with generated timestamps where absent.
    // FFmpeg writes fresh, internally consistent MP4 sample tables, including stts/stsc.
    // No arbitrary atom edits and no stream re-encoding are performed.
    await runCommand(FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-fflags', '+genpts',
      '-i', inputPath,
      '-map', '0',
      '-map_metadata', '0',
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      '-f', 'mp4',
      output2Path
    ]);

    const output2Stat = await stat(output2Path);
    if (!output2Stat.size) throw new Error('Output 2 kosong.');
    if (output2Stat.size > MAX_SIZE) throw new Error('Output 2 melebihi had penghantaran 150 MB.');
    const output2Probe = await runProbe(output2Path);
    const output2Summary = getMediaSummary(output2Probe, output2Stat.size);

    const output1Video = output1Probe.streams.find(stream => stream.codec_type === 'video');
    const output2Video = output2Probe.streams.find(stream => stream.codec_type === 'video');
    if (output1Video?.codec_name !== inputSummary.video.codec_name ||
        output2Video?.codec_name !== inputSummary.video.codec_name) {
      throw new Error('Codec video berubah ketika C-Copy. Output tidak akan dihantar.');
    }

    await socket.sendMessage(jid, {
      video: await readFile(output1Path),
      mimetype: 'video/mp4',
      fileName: path.basename(output1Path),
      seconds: 0,
      caption:
        '🦈 *JERUNG TIKTOK HD — OUTPUT 1*\n' +
        'Kaedah: C-Copy / stream copy (tiada re-encode)\n' +
        'Saiz: ' + (output1Stat.size / (1024 * 1024)).toFixed(2) + ' MB\n' +
        'Codec video: ' + output1Video.codec_name + '\n' +
        'Petunjuk durasi mesej WhatsApp: 0:00. Durasi dalaman MP4 tidak dipalsukan.\n' +
        'Keserasian pemain dan Google Drive perlu diuji.'
    }, { quoted: message });

    await socket.sendMessage(jid, {
      video: await readFile(output2Path),
      mimetype: 'video/mp4',
      fileName: path.basename(output2Path),
      ...(Number.isFinite(sourceDuration) && sourceDuration >= 0
        ? { seconds: Math.floor(sourceDuration) }
        : {}),
      caption:
        '🦈 *JERUNG TIKTOK HD — OUTPUT 2*\n' +
        'Kaedah: C-Copy / stream copy (tiada re-encode)\n' +
        'MP4 di-remux; timestamp dijana jika tiada dan sample tables stts/stsc ditulis semula secara konsisten.\n' +
        'Durasi sumber: ' + formatDuration(sourceDuration) + '\n' +
        'Saiz: ' + (output2Stat.size / (1024 * 1024)).toFixed(2) + ' MB\n' +
        'Ini bukan manipulasi atom secara rawak. Keserasian Google Drive dan pemain lain perlu diuji.'
    }, { quoted: message });

    logger.info({
      jid,
      originalName,
      inputBytes: inputStat.size,
      output1Bytes: output1Stat.size,
      output2Bytes: output2Stat.size,
      inputCodec: inputSummary.video.codec_name,
      output1Codec: output1Video.codec_name,
      output2Codec: output2Video.codec_name,
      output1Duration: output1Probe.format?.duration,
      output2Duration: output2Probe.format?.duration
    }, 'Both copy-only MP4 outputs sent as WhatsApp video messages');
  } catch (error) {
    logger.error({ err: error, jid, originalName }, 'Video processing failed');
    let detail = 'Fail ini tidak dapat di-remux sebagai MP4 tanpa re-encode. Codec atau struktur sumber mungkin tidak serasi.';
    if (/melebihi had/.test(error.message)) detail = error.message;
    if (/melebihi had masa/.test(error.message)) detail = error.message;
    await sendText(
      socket,
      jid,
      '🦈 Bot tak dapat menghasilkan kedua-dua output C-Copy. ' + detail +
      '\n\nTiada fallback re-encode dibuat. Fail asal tidak diubah.',
      message
    );
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
              'Sila hantar video anda dalam bentuk *Document / Dokumen*, bukan sebagai video biasa.\n\n' +
              'Format diterima: MP4 dan MOV. Had saiz: 150 MB.\n' +
              'Bot menghasilkan dua MP4 eksperimen: Output 1 H.264 video-only; Output 2 H.264 dengan satu dummy audio AAC senyap. Status unplayable dan penerimaan TikTok Studio perlu diuji.',
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
