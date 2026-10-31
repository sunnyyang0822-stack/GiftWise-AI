// 仅读栅格文件头尺寸，不执行SVG/HTML，不把供应商size字段当图像字节证据。
//
// 支持范围（**实测**，2026-10-31）：PNG、JPEG、WebP。
//   - 为什么必须支持 WebP：`y.zdmimg.com` / `img.alicdn.com` / `gw.alicdn.com` / `cbu01.alicdn.com`
//     会按 `Accept` 头**内容协商**返回 WebP —— 同一个 `.jpg` URL 带 `Accept: image/webp` 时
//     返回 `image/webp`（139,372 B / RIFF-WEBP），不带时返回 JPEG（210,001 B / ffd8ffe0）。
//     真实参考图 URL 的扩展名**不能**决定格式。
//   - 为什么明确拒绝 AVIF/HEIC/GIF 等：这些是本层无法解码的格式，必须在**发出供应商请求之前**
//     以明确错误码 `IMAGE_FORMAT_UNSUPPORTED` 失败，而不是把无法验证的字节送出去。

/** 本层能解出尺寸、可作参考图提交的栅格类型。 */
export const SUPPORTED_RASTER_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

/** 已识别但本层不解码的栅格类型 → 明确错误码（不是「空引用」也不是「网络失败」）。 */
export const UNSUPPORTED_RASTER_TYPES = Object.freeze([
  'image/avif', 'image/heic', 'image/heif', 'image/gif', 'image/bmp', 'image/tiff', 'image/svg+xml',
]);

function unsupported(message = 'IMAGE_FORMAT_UNSUPPORTED') {
  const error = new Error(message);
  error.code = 'IMAGE_FORMAT_UNSUPPORTED';
  return error;
}

/** 按**字节**判断栅格类型（不信 content-type、不信扩展名）。返回 null 表示不是已识别的栅格。 */
export function sniffRasterType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42) return 'image/tiff';
  if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42) return 'image/tiff';
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = bytes.toString('ascii', 8, 12).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx' || brand === 'mif1' || brand === 'msf1') return 'image/heic';
    return 'image/iso-bmff';
  }
  return null;
}

/** WebP 三种封装（VP8 有损 / VP8L 无损 / VP8X 扩展）的画布尺寸。 */
function webpSize(bytes) {
  const fourcc = bytes.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') {
    // 有损：3 字节 frame tag + 3 字节同步码 0x9d 0x01 0x2a + 2 字节宽 + 2 字节高（各 14 位，LE）
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) throw unsupported();
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    // 无损：1 字节签名 0x2f + 28 位（14 位宽-1 | 14 位高-1）
    if (bytes.length < 25 || bytes[20] !== 0x2f) throw unsupported();
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    // 扩展：flags(1)+reserved(3)+canvasWidth-1(3,LE)+canvasHeight-1(3,LE)
    if (bytes.length < 30) throw unsupported();
    return { width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1, height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1 };
  }
  throw unsupported();
}

/** 只读栅格文件头，得到解码后的真实宽高与类型。不解码像素、不执行任何脚本。 */
export function inspectRaster(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > 16000000) throw new Error('IMAGE_BYTES_INVALID');
  let width, height, type, extension;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); type = 'image/png'; extension = 'png';
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 217 || marker === 218) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break;
      }
      offset += length + 2;
    }
    type = 'image/jpeg'; extension = 'jpg';
  } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const size = webpSize(bytes);
    width = size.width; height = size.height; type = 'image/webp'; extension = 'webp';
  } else {
    // 已识别但本层不解码（AVIF/HEIC/GIF/BMP/TIFF/ISO-BMFF）→ 明确错误码，绝不伪装成「尺寸非法」。
    const sniffed = sniffRasterType(bytes);
    if (sniffed && UNSUPPORTED_RASTER_TYPES.includes(sniffed)) throw unsupported();
    throw new Error('IMAGE_DIMENSIONS_INVALID');
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 20000000) throw new Error('IMAGE_DIMENSIONS_INVALID');
  return { width, height, type, extension };
}
