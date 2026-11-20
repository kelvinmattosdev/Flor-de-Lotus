import { bytes, fail, invalid, limited, unavailable } from './http.js';

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_PIXELS = 4_000_000;
const MIME = ['image/jpeg', 'image/png'];
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG = Buffer.from([255, 216, 255]);
const hasMagic = (value, mime) => {
  const signature = mime === 'image/png' ? PNG : JPEG;
  return value.subarray(0, signature.length).equals(signature);
};
function singlePng(bytes) {
  let offset = PNG.length;
  for (let count = 0; count < 8192 && offset + 12 <= bytes.length; count++) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + size + 12 > bytes.length || ['acTL', 'fcTL', 'fdAT'].includes(type)) return false;
    if (type === 'IEND') return size === 0 && offset + 12 === bytes.length;
    offset += size + 12;
  }
  return false;
}

let decoder;
export async function warmupImageDecoder() {
  if (!decoder) decoder = import('sharp').then(module => module.default);
  return decoder;
}

async function decodeImage(buffer, mime) {
  let sharp;
  try { sharp = await warmupImageDecoder(); }
  catch { unavailable(); }
  try {
    const input = sharp(buffer, {limitInputPixels: MAX_PIXELS, limitInputChannels: 4, failOn: 'warning', pages: 1});
    const meta = await input.metadata();
    if (meta.format !== (mime === 'image/png' ? 'png' : 'jpeg') || (meta.pages ?? 1) !== 1 ||
        !validDimensions(meta.width, meta.height)) invalid('image', 'Imagem inválida ou maior que o permitido.');
    const reencode = input.autoOrient().resize({width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true})
      .timeout({seconds: 4});
    const encoded = mime === 'image/png' ? reencode.png() : reencode.jpeg({quality: 85});
    const {data, info} = await encoded.toBuffer({resolveWithObject: true});
    return {bytes: data, width: info.width, height: info.height, mime};
  } catch {
    invalid('image', 'Não foi possível decodificar a imagem ou ela excede os limites.');
  }
}

const validDimensions = (width, height) => Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
  width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= MAX_PIXELS;

let processing = false;
export async function readImage(req, decode = decodeImage) {
  if (processing) limited(2);
  processing = true;
  try {
    const input = await bytes(req, MAX_BYTES, MIME);
    const mime = req.headers['content-type'];
    if (!hasMagic(input, mime)) fail(415, 'UNSUPPORTED_MEDIA', 'O conteúdo não é um JPEG ou PNG aceito.');
    if (mime === 'image/png' && !singlePng(input)) invalid('image', 'O PNG precisa ser estático e válido.');
    const image = await decode(input, mime);
    if (!image || image.mime !== mime || !Buffer.isBuffer(image.bytes) || !image.bytes.length ||
        image.bytes.length > MAX_BYTES || !hasMagic(image.bytes, mime) || !validDimensions(image.width, image.height)) {
      invalid('image', 'Imagem inválida ou maior que o permitido.');
    }
    return image;
  } finally {
    processing = false;
  }
}

export function sendMedia(req, res, row) {
  if (!MIME.includes(row.mime)) unavailable();
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Length', row.bytes.length);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Disposition', 'inline');
  res.end(req.method === 'HEAD' ? undefined : row.bytes);
}
