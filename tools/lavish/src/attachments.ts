import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  projectRoot,
  readJson,
  sessionDir,
  sessionFile,
  type SessionRecord,
} from "./paths.ts";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const JPEG_START_OF_FRAME: Record<number, true> = {
  0xc0: true,
  0xc1: true,
  0xc2: true,
  0xc3: true,
  0xc5: true,
  0xc6: true,
  0xc7: true,
  0xc9: true,
  0xca: true,
  0xcb: true,
  0xcd: true,
  0xce: true,
  0xcf: true,
};

export type AttachmentSource = "upload" | "paste" | "viewport" | "region";

export interface Attachment {
  id: string;
  path: string;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  source: AttachmentSource;
}

export function imageDimensions(mime: string, bytes: Buffer): { width: number; height: number } {
  let width = 0;
  let height = 0;
  if (mime === "image/png") {
    const signature = "89504e470d0a1a0a";
    if (bytes.length >= 24 && bytes.subarray(0, 8).toString("hex") === signature) {
      width = bytes.readUInt32BE(16);
      height = bytes.readUInt32BE(20);
    }
  } else if (mime === "image/gif") {
    const header = bytes.subarray(0, 6).toString("ascii");
    if (bytes.length >= 10 && (header === "GIF87a" || header === "GIF89a")) {
      width = bytes.readUInt16LE(6);
      height = bytes.readUInt16LE(8);
    }
  } else if (mime === "image/jpeg" && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (JPEG_START_OF_FRAME[marker]) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  } else if (
    mime === "image/webp" &&
    bytes.length >= 30 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const packed = bytes.readUInt32LE(21);
      width = (packed & 0x3fff) + 1;
      height = ((packed >>> 14) & 0x3fff) + 1;
    } else if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  }
  if (width < 1 || height < 1) throw new Error(`invalid ${mime} attachment`);
  return { width, height };
}

export function saveDataUrl(
  id: string,
  dataUrl: string,
  source: AttachmentSource,
  name: string,
  root = projectRoot(),
): Attachment {
  const session = readJson<SessionRecord>(sessionFile(id, root));
  if (!session) throw new Error(`unknown session: ${id}`);

  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match) throw new Error("attachment must be a base64 image data URL");
  const mime = match[1].toLowerCase();
  if (!MIME_EXTENSIONS[mime]) throw new Error(`unsupported attachment MIME type: ${mime}`);
  const encoded = match[2];
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const estimatedBytes = Math.floor(encoded.length * 3 / 4) - padding;
  if (estimatedBytes < 1 || estimatedBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment must contain at most ${MAX_ATTACHMENT_BYTES} bytes`);
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== estimatedBytes) throw new Error("attachment base64 is malformed");
  const dimensions = imageDimensions(mime, bytes);
  const idValue = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const attachmentDir = join(sessionDir(id, root), "attachments");
  mkdirSync(attachmentDir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(attachmentDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("attachment path is not a real directory");
  const fallback = `${idValue}${MIME_EXTENSIONS[mime]}`;
  const safeName = basename(name).replace(/[^A-Za-z0-9._-]+/g, "-") || fallback;
  const path = join(attachmentDir, `${idValue}-${safeName}`);
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    id: idValue,
    path,
    name: safeName,
    mime,
    bytes: bytes.byteLength,
    width: dimensions.width,
    height: dimensions.height,
    sha256,
    source,
  };
}
