const sharp = require('sharp');
const { slicePlan, exactCrops } = require('./layout');

function clamp(box, width, height) {
  const left = Math.max(0, Math.min(width - 1, box.left));
  const top = Math.max(0, Math.min(height - 1, box.top));
  const cropW = Math.max(1, Math.min(box.width, width - left));
  const cropH = Math.max(1, Math.min(box.height, height - top));
  return { left, top, width: cropW, height: cropH };
}

async function toJpeg(buffer) {
  let out = await sharp(buffer).rotate().jpeg({ quality: 85 }).toBuffer();
  if (out.length > 1.5 * 1024 * 1024) {
    out = await sharp(buffer).rotate().resize(2048, 2048, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  }
  return out;
}

async function slices(buffer, count) {
  const meta = await sharp(buffer).metadata();
  const parts = slicePlan(meta.width, meta.height, count);
  const out = [];
  for (const part of parts) {
    out.push(await sharp(buffer).extract(clamp(part, meta.width, meta.height)).png().toBuffer());
  }
  return out;
}

async function exact(buffer, spec) {
  const meta = await sharp(buffer).metadata();
  const parts = exactCrops(meta.width, meta.height, spec);
  const out = [];
  for (const part of parts) {
    out.push(await sharp(buffer)
      .extract(clamp(part, meta.width, meta.height))
      .resize(part.outW, part.outH, { fit: 'fill' })
      .jpeg({ quality: 90 })
      .toBuffer());
  }
  return out;
}

async function circle(buffer) {
  const meta = await sharp(buffer).rotate().metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.floor((meta.width - side) / 2);
  const top = Math.floor((meta.height - side) / 2);
  const size = Math.min(1024, side);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(buffer)
    .rotate()
    .extract({ left, top, width: side, height: side })
    .resize(size, size)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

module.exports = { toJpeg, slices, exact, circle };
