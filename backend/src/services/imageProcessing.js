const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs/promises');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');
const WORKER_PATH  = path.join(__dirname, '../workers/bgRemovalWorker.js');

// On Linux/WSL2: use rembg CLI (Python) — ONNX native binaries in @imgly crash
// On Windows: use @imgly/background-removal-node in an isolated child process
async function removeBackground(pngBuffer) {
  if (process.platform === 'linux') {
    return removeBackgroundRembg(pngBuffer);
  }
  return removeBackgroundImgly(pngBuffer);
}

// rembg i <in> <out>  — writes transparent PNG, we then flatten to white
async function removeBackgroundRembg(pngBuffer) {
  const tmpIn  = path.join('/tmp', `${uuidv4()}-in.png`);
  const tmpOut = path.join('/tmp', `${uuidv4()}-out.png`);
  try {
    await fs.writeFile(tmpIn, pngBuffer);
    // Use PATH augmented with common pip install locations so Node's child
    // process can find rembg even when spawned without an interactive shell.
    const rembgEnv = {
      ...process.env,
      PATH: [
        process.env.PATH,
        '/home/cedrick/.local/bin',
        '/usr/local/bin',
        '/usr/bin',
      ].filter(Boolean).join(':'),
    };
    await new Promise((resolve, reject) => {
      const child = spawn('rembg', ['i', tmpIn, tmpOut], { stdio: 'pipe', env: rembgEnv });
      const outChunks = [];
      const errChunks = [];
      child.stdout.on('data', (d) => outChunks.push(d));
      child.stderr.on('data', (d) => errChunks.push(d));
      child.on('close', (code) => {
        if (code === 0) return resolve();
        const out = Buffer.concat(outChunks).toString().slice(0, 300);
        const err = Buffer.concat(errChunks).toString().slice(0, 300);
        reject(new Error(`rembg exited ${code} | stdout: ${out} | stderr: ${err}`));
      });
      child.on('error', reject);
    });
    const result = await fs.readFile(tmpOut);
    return await sharp(result)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer();
  } finally {
    await fs.unlink(tmpIn).catch(() => {});
    await fs.unlink(tmpOut).catch(() => {});
  }
}

// Runs @imgly in a child process so a native crash never kills the main server
function removeBackgroundImgly(pngBuffer) {
  return new Promise((resolve, reject) => {
    const child  = spawn(process.execPath, [WORKER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('close', (code) => {
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error(`bgRemovalWorker exited with code ${code}`));
    });
    child.on('error', reject);
    child.stdin.write(pngBuffer);
    child.stdin.end();
  });
}

// ── Crop + background removal for applicant photos ──────────────────────────
async function processPhoto(inputBuffer) {
  const pngBuffer = await sharp(inputBuffer).png().toBuffer();

  let finalBuffer;
  try {
    finalBuffer = await removeBackground(pngBuffer);
    console.log('[imageProcessing] Background removed and composited on white.');
  } catch (err) {
    console.error('[imageProcessing] Background removal FAILED — saving without BG removal:', err.message);
    finalBuffer = await sharp(pngBuffer)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer();
  }

  const filename   = `${uuidv4()}.png`;
  const outputPath = path.join(UPLOADS_ROOT, 'photos', filename);
  await fs.writeFile(outputPath, finalBuffer);

  return { filename, relPath: `photos/${filename}` };
}

// ── Save drawn signature (from canvas base64) — preserve transparency ──────────
async function processSignature(inputBuffer) {
  const pngBuffer = await sharp(inputBuffer).png().toBuffer();
  const filename   = `${uuidv4()}.png`;
  const outputPath = path.join(UPLOADS_ROOT, 'signatures', filename);
  await fs.writeFile(outputPath, pngBuffer);
  return { filename, relPath: `signatures/${filename}` };
}

// ── Clean up an uploaded signature photo: grayscale → normalize → threshold,
//    then make white pixels transparent so it composites cleanly on the ID card.
async function processSignatureUpload(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .grayscale()
    .normalise()
    .threshold(160)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Build RGBA: stroke pixels (near-black, gray≈0) → opaque black; background (white, gray=255) → transparent
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const gray = data[i];
    rgba[i * 4]     = 0;
    rgba[i * 4 + 1] = 0;
    rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = 255 - gray; // white→0 (transparent), black→255 (opaque)
  }

  const cleanBuffer = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  const filename   = `${uuidv4()}.png`;
  const outputPath = path.join(UPLOADS_ROOT, 'signatures', filename);
  await fs.writeFile(outputPath, cleanBuffer);
  return { filename, relPath: `signatures/${filename}` };
}

// ── Save signature drawn on canvas (base64 data URL) ────────────────────────
async function saveBase64Signature(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  return processSignature(buffer);
}

// ── Resize + crop avatar to 256×256 JPEG ────────────────────────────────────
async function processAvatar(inputBuffer) {
  const jpgBuffer = await sharp(inputBuffer)
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88 })
    .toBuffer();
  await fs.mkdir(path.join(UPLOADS_ROOT, 'avatars'), { recursive: true });
  const filename   = `${uuidv4()}.jpg`;
  const outputPath = path.join(UPLOADS_ROOT, 'avatars', filename);
  await fs.writeFile(outputPath, jpgBuffer);
  return { filename, relPath: `avatars/${filename}` };
}

// ── Delete a file from uploads (for cleanup on replace) ──────────────────────
async function deleteUploadFile(relPath) {
  if (!relPath) return;
  try {
    await fs.unlink(path.join(UPLOADS_ROOT, relPath));
  } catch { /* ignore */ }
}

module.exports = { processPhoto, processSignature, processSignatureUpload, saveBase64Signature, deleteUploadFile, processAvatar };
