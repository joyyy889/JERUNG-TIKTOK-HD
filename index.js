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
    await sendText(socket, jid, '🦈 Sila hantar fail video MP4 atau MOV sahaja dalam bentuk Document / Dokumen.', message);
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
    const outputPath = path.join(tempDir, `${path.parse(originalName).name}_JERUNG.mp4`);
    const experimentalPath = path.join(tempDir, `${path.parse(originalName).name}_JERUNG_2AUDIO_TEST.mp4`);
    await sendText(socket, jid, '🦈 Video diterima. Sedang memuat turun dan memeriksa metadata…', message);
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

    await sendText(socket, jid, '🦈 Metadata berjaya dibaca. Sedang menyediakan MP4 standard H.264/AAC…', message);

    // OUTPUT 1: H.264 MP4, video-only, fragmented MP4 layout (compatibility experiment).
    // Fragmentation/video-only does NOT guarantee that ordinary players cannot play it.
    await runCommand(FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-an',
      '-map_metadata', '-1',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+empty_moov+frag_keyframe+default_base_moof',
      '-f', 'mp4',
      outputPath
    ]);

    const outputStat = await stat(outputPath);
    if (outputStat.size === 0) throw new Error('FFmpeg menghasilkan Output 1 kosong.');
    if (outputStat.size > MAX_SIZE) throw new Error('Output 1 melebihi had penghantaran 150 MB.');

    const outputProbe = await runProbe(outputPath);
    const outputSummary = getMediaSummary(outputProbe, outputStat.size);
    const outputAudioStreams = outputProbe.streams.filter(stream => stream.codec_type === 'audio');
    if (String(outputSummary.video.codec_name).toLowerCase() !== 'h264') {
      throw new Error('Output 1 gagal disahkan sebagai video H.264.');
    }
    if (outputAudioStreams.length !== 0) {
      throw new Error('Output 1 sepatutnya tidak mempunyai audio stream.');
    }

    await socket.sendMessage(jid, {
      document: await readFile(outputPath),
      mimetype: 'video/mp4',
      fileName: path.basename(outputPath),
      caption:
        '🦈 *JERUNG TIKTOK HD — OUTPUT 1 (H.264 MP4 / VIDEO ONLY)*\\n\\n' +
        `Saiz asal: ${(inputStat.size / (1024 * 1024)).toFixed(2)} MB\\n` +
        `Saiz output: ${(outputStat.size / (1024 * 1024)).toFixed(2)} MB\\n` +
        `Video: ${outputSummary.video.codec_name || 'Unknown'}\\n` +
        `Resolusi: ${outputSummary.video.width || '?'} × ${outputSummary.video.height || '?'}\\n` +
        'Audio: tiada. Layout fragmented MP4 digunakan sebagai eksperimen; status unplayable belum dijamin.'
    }, { quoted: message });

    // OUTPUT 2: same H.264 video plus a generated silent AAC dummy audio track.
    const duration = Number(inputProbe.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Durasi sumber tidak sah; Output 2 dummy audio tidak dapat dijana.');
    }

    await runCommand(FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', outputPath,
      '-f', 'lavfi',
      '-t', String(duration),
      '-i', 'anullsrc=r=48000:cl=stereo',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-shortest',
      '-map_metadata', '-1',
      '-movflags', '+empty_moov+frag_keyframe+default_base_moof',
      '-f', 'mp4',
      experimentalPath
    ]);

    const experimentalStat = await stat(experimentalPath);
    if (experimentalStat.size === 0 || experimentalStat.size > MAX_SIZE) {
      throw new Error('Output 2 melebihi had 150 MB atau fail kosong.');
    }

    const experimentalProbe = await runProbe(experimentalPath);
    const experimentalSummary = getMediaSummary(experimentalProbe, experimentalStat.size);
    const experimentalAudioStreams = experimentalProbe.streams.filter(stream => stream.codec_type === 'audio');
    if (String(experimentalSummary.video.codec_name).toLowerCase() !== 'h264' ||
        experimentalAudioStreams.length !== 1 ||
        String(experimentalAudioStreams[0].codec_name).toLowerCase() !== 'aac') {
      throw new Error('Output 2 gagal disahkan sebagai H.264 dengan satu dummy AAC audio track.');
    }

    await socket.sendMessage(jid, {
      document: await readFile(experimentalPath),
      mimetype: 'video/mp4',
      fileName: path.basename(experimentalPath),
      caption:
        '🦈 *JERUNG TIKTOK HD — OUTPUT 2 (H.264 + DUMMY AUDIO)*\\n\\n' +
        `Saiz: ${(experimentalStat.size / (1024 * 1024)).toFixed(2)} MB\\n` +
        `Video: ${experimentalSummary.video.codec_name || 'Unknown'}\\n` +
        'Audio: 1 track AAC senyap (dummy audio)\\n' +
        'Layout fragmented MP4 digunakan sebagai eksperimen; status unplayable dan penerimaan TikTok Studio perlu diuji.'
    }, { quoted: message });

    logger.info({
      jid,
      originalName,
      output1Bytes: outputStat.size,
      output2Bytes: experimentalStat.size,
      output1AudioStreams: outputAudioStreams.length,
      output2AudioStreams: experimentalAudioStreams.length
    }, 'Both experimental outputs sent');
    logger.info({
      jid,
      originalName,
      inputBytes: inputStat.size,
      outputBytes: outputStat.size,
      codec: outputSummary.video.codec_name
    }, 'Baseline video repackaged and sent');
  } catch (error) {
    logger.error({ err: error, jid, originalName }, 'Video processing failed');
    const detail = /melebihi had|melebihi had masa/.test(error.message)
      ? error.message
      : 'Format/codec video ini tidak dapat ditukar kepada MP4 H.264/AAC.';
    await sendText(
      socket,
      jid,
      `🦈 Bot tak dapat hasilkan MP4 untuk video ini. ${detail}\n\nFail asal tidak diubah. Cuba fail MP4/MOV lain.`,
      message
    );
  } finally {
    activeChats.delete(jid);
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(error => {
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
