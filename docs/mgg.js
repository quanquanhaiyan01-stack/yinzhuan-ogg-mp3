// Browser port of the offline QM Unlock QMC2 decoder.
// Upstream: https://github.com/mary20050520/qmunlock/blob/9ce1c282ee2eea511324666457b17cac45db4702/qmunlock/qmc2.py
// Copyright (c) 2026 QM Unlock contributors. See QM-UNLOCK-LICENSE.txt.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const oggMagic = encoder.encode("OggS");
const musicExMagic = encoder.encode("musicex\0");
const qTag = encoder.encode("QTag");
const sTag = encoder.encode("STag");
const encV2 = encoder.encode("QQMusic EncV2,Key:");
const mixKey1 = encoder.encode("386ZJY!@#*$%^&)(");
const mixKey2 = encoder.encode("**#!(#$%&^a1cZ,T");
const simpleKey = Uint8Array.of(0x69, 0x56, 0x46, 0x38, 0x2b, 0x20, 0x15, 0x0b);

function matches(bytes, signature, offset = 0) {
  return offset >= 0 && signature.every((value, i) => value === bytes[offset + i]);
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value.trim()), char => char.charCodeAt(0));
}

function decryptTeaBlock(block, key) {
  const view = dataView(block);
  let left = view.getUint32(0);
  let right = view.getUint32(4);
  let sum = 0xe3779b90;
  for (let round = 0; round < 16; round++) {
    right = (right - (((left << 4) + key[2]) ^ (left + sum) ^ ((left >>> 5) + key[3]))) >>> 0;
    left = (left - (((right << 4) + key[0]) ^ (right + sum) ^ ((right >>> 5) + key[1]))) >>> 0;
    sum = (sum - 0x9e3779b9) >>> 0;
  }
  view.setUint32(0, left);
  view.setUint32(4, right);
}

function decryptTencentTea(input, key) {
  if (input.length < 16 || input.length % 8 !== 0) throw new Error("Invalid TEA length");
  const view = dataView(key);
  const words = [0, 4, 8, 12].map(offset => view.getUint32(offset));
  const block = new Uint8Array(8);
  const decoded = new Uint8Array(input.length);
  for (let offset = 0; offset < input.length; offset += 8) {
    for (let i = 0; i < 8; i++) block[i] ^= input[offset + i];
    decryptTeaBlock(block, words);
    for (let i = 0; i < 8; i++) {
      decoded[offset + i] = block[i] ^ (offset ? input[offset - 8 + i] : 0);
    }
  }
  const start = (decoded[0] & 7) + 3;
  const end = decoded.length - 7;
  if (start > end || decoded.subarray(end).some(value => value !== 0)) {
    throw new Error("Invalid TEA padding");
  }
  return decoded.subarray(start, end);
}

function deriveKey(value) {
  let key = decodeBase64(value);
  if (matches(key, encV2)) {
    const first = decryptTencentTea(key.subarray(encV2.length), mixKey1);
    key = decodeBase64(decoder.decode(decryptTencentTea(first, mixKey2)));
  }
  if (key.length < 16) throw new Error("Key too short");
  const teaKey = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    teaKey[i * 2] = simpleKey[i];
    teaKey[i * 2 + 1] = key[i];
  }
  let body;
  try {
    body = decryptTencentTea(key.subarray(8), teaKey);
  } catch {
    // Some EKeys already contain raw key bytes.
    return key;
  }
  const result = new Uint8Array(8 + body.length);
  result.set(key.subarray(0, 8));
  result.set(body, 8);
  return result;
}

function applyMap(audio, key) {
  const mask = Uint8Array.from({ length: 0x8000 }, (_, offset) => {
    const index = (offset * offset + 71214) % key.length;
    const shift = ((index & 7) + 4) % 8;
    const byte = key[index];
    return (byte << shift) | (byte >>> shift);
  });
  for (let i = 0; i < audio.length; i++) {
    audio[i] ^= mask[i <= 0x7fff ? i : i % 0x7fff];
  }
}

function applySegmentedRc4(audio, key) {
  const length = key.length;
  const box = Uint8Array.from({ length }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < length; i++) {
    j = (j + box[i] + key[i]) % length;
    [box[i], box[j]] = [box[j], box[i]];
  }
  let hash = 1;
  for (const byte of key) {
    if (!byte) continue;
    const next = Math.imul(hash, byte) >>> 0;
    if (next <= hash) break;
    hash = next;
  }
  const skip = segment => {
    const seed = key[segment % length];
    return seed ? Math.floor(hash / ((segment + 1) * seed) * 100) % length : 0;
  };
  const firstLength = Math.min(audio.length, 128);
  for (let i = 0; i < firstLength; i++) audio[i] ^= key[skip(i)];
  const segmentSize = 5120;
  for (let offset = firstLength; offset < audio.length;) {
    const withinSegment = offset % segmentSize;
    const chunkLength = Math.min(segmentSize - withinSegment, audio.length - offset);
    const state = box.slice();
    const skipLength = withinSegment + skip(Math.floor(offset / segmentSize));
    let left = 0;
    let right = 0;
    for (let i = -skipLength; i < chunkLength; i++) {
      left = (left + 1) % length;
      right = (right + state[left]) % length;
      const previous = state[left];
      state[left] = state[right];
      state[right] = previous;
      if (i >= 0) audio[offset + i] ^= state[(state[left] + state[right]) % length];
    }
    offset += chunkLength;
  }
}

function parseContainer(bytes) {
  const end = bytes.length;
  const view = dataView(bytes);
  if (end >= 16 && matches(bytes, musicExMagic, end - 8)) {
    const footerSize = view.getUint32(end - 16, true);
    if (footerSize < 16 || footerSize >= end) throw new Error("MusicEx 文件尾部损坏。");
    return { audio: bytes.subarray(0, end - footerSize), embeddedKey: "" };
  }
  if (end >= 8 && matches(bytes, qTag, end - 4)) {
    const start = end - 8 - view.getUint32(end - 8);
    if (start <= 0 || start >= end - 8 || end - 8 - start > 65535) {
      throw new Error("MGG 文件尾部损坏。");
    }
    const metadata = decoder.decode(bytes.subarray(start, end - 8));
    return { audio: bytes.subarray(0, start), embeddedKey: metadata.split(",", 1)[0] };
  }
  if (end >= 24 && matches(bytes, sTag)) {
    const offset = 24 + view.getUint32(20, true);
    if (offset <= 24 || offset >= end || offset - 24 > 65535) {
      throw new Error("MGG 文件头部损坏。");
    }
    return { audio: bytes.subarray(offset), embeddedKey: decoder.decode(bytes.subarray(24, offset)) };
  }
  if (end >= 4) {
    const length = view.getUint32(end - 4, true);
    const start = end - 4 - length;
    if (start > 0 && length > 0 && length <= 65535) {
      const embeddedKey = decoder.decode(bytes.subarray(start, end - 4)).trim();
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(embeddedKey)) {
        return { audio: bytes.subarray(0, start), embeddedKey };
      }
    }
  }
  return { audio: bytes, embeddedKey: "" };
}

export function decodeMgg(bytes, ekey = "") {
  if (matches(bytes, oggMagic)) return bytes;
  const { audio, embeddedKey } = parseContainer(bytes);
  const sourceKey = ekey.trim() || embeddedKey.trim();
  if (!sourceKey) throw new Error("这个 MGG 文件没有内嵌密钥。请输入这首歌对应的 EKey 后再转换。");
  let key;
  try {
    key = deriveKey(sourceKey);
  } catch {
    throw new Error("EKey 格式有误，请检查是否复制完整。");
  }
  const header = new Uint8Array(audio.subarray(0, oggMagic.length));
  const applyKey = key.length > 300 ? applySegmentedRc4 : applyMap;
  applyKey(header, key);
  if (!matches(header, oggMagic)) throw new Error("这份 EKey 与选中的 MGG 文件不匹配。");
  applyKey(audio, key);
  // Return an exact-size view so only the decoded audio reaches FFmpeg.
  return audio.byteLength === bytes.byteLength ? audio : new Uint8Array(audio);
}
