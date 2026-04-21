/**
 * Minimal ZIP file builder using Node.js built-in zlib.
 *
 * Produces a valid ZIP archive with DEFLATE compression.
 * This is a self-contained implementation — no external zip library needed.
 *
 * Supports:
 *   - UTF-8 text files
 *   - DEFLATE compression (level 6)
 *   - Standard ZIP local file headers and central directory
 *
 * Does NOT support:
 *   - ZIP64 extensions (files > 4 GB — not needed for Context Store exports)
 *   - Encryption
 *   - Directories as entries (files implicitly create directory structure via paths)
 */

import { deflateRawSync } from "node:zlib";
import { CRC32 } from "./crc32";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function writeUint16LE(buf: Buffer, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(buf: Buffer, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

// ─── ZIP entry ────────────────────────────────────────────────────────────────

interface ZipEntry {
  filename: Buffer; // UTF-8 encoded
  compressed: Buffer;
  uncompressed: Buffer;
  crc32: number;
  localHeaderOffset: number;
}

// ─── Local file header ────────────────────────────────────────────────────────

function buildLocalHeader(entry: ZipEntry): Buffer {
  const filenameLen = entry.filename.length;
  const buf = Buffer.alloc(30 + filenameLen);
  let o = 0;

  // Local file header signature
  writeUint32LE(buf, o, 0x04034b50); o += 4;
  // Version needed to extract (2.0 = DEFLATE)
  writeUint16LE(buf, o, 20); o += 2;
  // General purpose bit flag — bit 11 = UTF-8 filename
  writeUint16LE(buf, o, 0x0800); o += 2;
  // Compression method: DEFLATE = 8
  writeUint16LE(buf, o, 8); o += 2;
  // Last mod time, last mod date (use 0 for deterministic output)
  writeUint16LE(buf, o, 0); o += 2;
  writeUint16LE(buf, o, 0); o += 2;
  // CRC-32
  writeUint32LE(buf, o, entry.crc32); o += 4;
  // Compressed size
  writeUint32LE(buf, o, entry.compressed.length); o += 4;
  // Uncompressed size
  writeUint32LE(buf, o, entry.uncompressed.length); o += 4;
  // Filename length
  writeUint16LE(buf, o, filenameLen); o += 2;
  // Extra field length
  writeUint16LE(buf, o, 0); o += 2;
  // Filename
  entry.filename.copy(buf, o);

  return buf;
}

// ─── Central directory entry ──────────────────────────────────────────────────

function buildCentralEntry(entry: ZipEntry): Buffer {
  const filenameLen = entry.filename.length;
  const buf = Buffer.alloc(46 + filenameLen);
  let o = 0;

  // Central directory file header signature
  writeUint32LE(buf, o, 0x02014b50); o += 4;
  // Version made by (2.0, Unix = 0x031e)
  writeUint16LE(buf, o, 0x031e); o += 2;
  // Version needed to extract
  writeUint16LE(buf, o, 20); o += 2;
  // General purpose bit flag
  writeUint16LE(buf, o, 0x0800); o += 2;
  // Compression method
  writeUint16LE(buf, o, 8); o += 2;
  // Last mod time, date
  writeUint16LE(buf, o, 0); o += 2;
  writeUint16LE(buf, o, 0); o += 2;
  // CRC-32
  writeUint32LE(buf, o, entry.crc32); o += 4;
  // Compressed size
  writeUint32LE(buf, o, entry.compressed.length); o += 4;
  // Uncompressed size
  writeUint32LE(buf, o, entry.uncompressed.length); o += 4;
  // Filename length
  writeUint16LE(buf, o, filenameLen); o += 2;
  // Extra field length
  writeUint16LE(buf, o, 0); o += 2;
  // File comment length
  writeUint16LE(buf, o, 0); o += 2;
  // Disk number start
  writeUint16LE(buf, o, 0); o += 2;
  // Internal file attributes
  writeUint16LE(buf, o, 0); o += 2;
  // External file attributes
  writeUint32LE(buf, o, 0); o += 4;
  // Relative offset of local header
  writeUint32LE(buf, o, entry.localHeaderOffset); o += 4;
  // Filename
  entry.filename.copy(buf, o);

  return buf;
}

// ─── End of central directory ─────────────────────────────────────────────────

function buildEndOfCentralDirectory(
  entryCount: number,
  centralDirSize: number,
  centralDirOffset: number
): Buffer {
  const buf = Buffer.alloc(22);
  let o = 0;

  writeUint32LE(buf, o, 0x06054b50); o += 4; // signature
  writeUint16LE(buf, o, 0); o += 2; // disk number
  writeUint16LE(buf, o, 0); o += 2; // disk with central directory
  writeUint16LE(buf, o, entryCount); o += 2; // entries on disk
  writeUint16LE(buf, o, entryCount); o += 2; // total entries
  writeUint32LE(buf, o, centralDirSize); o += 4;
  writeUint32LE(buf, o, centralDirOffset); o += 4;
  writeUint16LE(buf, o, 0); // comment length

  return buf;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a ZIP buffer from a map of { path → utf-8 content } entries.
 *
 * All paths use forward slashes. Compression level 6 (balanced).
 * Output is deterministic for the same input.
 */
export function buildZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const [path, content] of Object.entries(files)) {
    const uncompressed = Buffer.from(content, "utf-8");
    const compressed = deflateRawSync(uncompressed, { level: 6 });
    const crc32 = CRC32.compute(uncompressed);
    const filename = Buffer.from(path, "utf-8");

    const entry: ZipEntry = {
      filename,
      compressed,
      uncompressed,
      crc32,
      localHeaderOffset: offset,
    };
    entries.push(entry);

    const localHeader = buildLocalHeader(entry);
    parts.push(localHeader);
    parts.push(compressed);
    offset += localHeader.length + compressed.length;
  }

  // Central directory
  const centralDirOffset = offset;
  const centralParts: Buffer[] = [];
  for (const entry of entries) {
    centralParts.push(buildCentralEntry(entry));
  }

  const centralDirSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = buildEndOfCentralDirectory(entries.length, centralDirSize, centralDirOffset);

  return Buffer.concat([...parts, ...centralParts, eocd]);
}

// ─── Zip reader ───────────────────────────────────────────────────────────────

import { inflateRawSync } from "node:zlib";

// ─── Security limits ──────────────────────────────────────────────────────────
// These guard against zip-bomb and malformed-ZIP denial-of-service attacks.

/** Maximum decompressed size allowed for any single entry (100 MB). */
const MAX_ENTRY_DECOMPRESSED_BYTES = 100 * 1024 * 1024;
/** Maximum total decompressed size across all entries (500 MB). */
const MAX_TOTAL_DECOMPRESSED_BYTES = 500 * 1024 * 1024;
/** Reject any entry whose decompressed:compressed ratio exceeds this. */
const MAX_COMPRESSION_RATIO = 1000;
/** Maximum number of entries declared in the central directory. */
const MAX_ENTRY_COUNT = 10000;

/**
 * Parse a ZIP buffer and return a map of { path → utf-8 content }.
 *
 * Supports DEFLATE (method=8) and stored (method=0) entries.
 * Throws on malformed zip.
 *
 * Security: enforces per-entry and total decompressed-size limits, an entry
 * count cap, bounds checks on every header read, and a compression ratio
 * guard against zip bombs. Because Node's `inflateRawSync` does not support
 * mid-stream aborts, size enforcement uses the declared `uncompressedSize`
 * field as a pre-inflate gate plus a post-inflate length assertion.
 */
export function parseZip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();

  // Find end of central directory by scanning backward for EOCD signature
  const sig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === sig) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Malformed ZIP: end of central directory not found.");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 8);
  if (entryCount > MAX_ENTRY_COUNT) {
    throw new Error(
      `Malformed ZIP: too many entries (> ${MAX_ENTRY_COUNT})`
    );
  }
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  let totalDecompressed = 0;

  let pos = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    // Bounds: central directory entry is at least 46 bytes
    if (pos + 46 > buffer.length) {
      throw new Error("Malformed ZIP: central directory entry out of bounds.");
    }
    if (buffer.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error("Malformed ZIP: invalid central directory entry.");
    }

    const compressionMethod = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const filenameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);

    // Bounds: the filename + extra + comment region must lie within the buffer
    if (pos + 46 + filenameLen > buffer.length) {
      throw new Error("Malformed ZIP: central directory filename out of bounds.");
    }
    const filename = buffer.slice(pos + 46, pos + 46 + filenameLen).toString("utf-8");
    pos += 46 + filenameLen + extraLen + commentLen;

    // Bounds: local file header is 30 bytes minimum
    if (localHeaderOffset + 30 > buffer.length) {
      throw new Error(
        `Malformed ZIP: local header for entry "${filename}" out of bounds.`
      );
    }

    // Read local file header to find actual data offset
    const lfhExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + filenameLen + lfhExtraLen;

    // Bounds: the compressed data region must lie within the buffer
    if (dataOffset + compressedSize > buffer.length) {
      throw new Error(
        `Malformed ZIP: compressed data for entry "${filename}" out of bounds.`
      );
    }

    // Zip-bomb guards — validate declared uncompressed size against limits
    // before paying the CPU cost of inflation. `inflateRawSync` cannot be
    // aborted mid-stream, so we rely on the declared field plus a
    // post-inflate length assertion below.
    if (uncompressedSize > MAX_ENTRY_DECOMPRESSED_BYTES) {
      throw new Error(
        `Malformed ZIP: decompressed size exceeds limit (${MAX_ENTRY_DECOMPRESSED_BYTES} bytes)`
      );
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
      throw new Error(
        `Malformed ZIP: compression ratio exceeds limit (${MAX_COMPRESSION_RATIO}x) for entry "${filename}"`
      );
    }
    if (totalDecompressed + uncompressedSize > MAX_TOTAL_DECOMPRESSED_BYTES) {
      throw new Error(
        `Malformed ZIP: decompressed size exceeds limit (${MAX_TOTAL_DECOMPRESSED_BYTES} bytes)`
      );
    }

    const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);

    let content: Buffer;
    if (compressionMethod === 0) {
      content = compressedData;
    } else if (compressionMethod === 8) {
      try {
        content = inflateRawSync(compressedData);
      } catch {
        throw new Error(`Malformed ZIP: failed to inflate entry "${filename}".`);
      }
    } else {
      // Unsupported method — skip
      continue;
    }

    // Post-inflate assertion: actual length must not exceed per-entry limit,
    // and must not push running total over the total limit. This catches
    // mismatched/forged central-directory declarations.
    if (content.length > MAX_ENTRY_DECOMPRESSED_BYTES) {
      throw new Error(
        `Malformed ZIP: decompressed size exceeds limit (${MAX_ENTRY_DECOMPRESSED_BYTES} bytes)`
      );
    }
    totalDecompressed += content.length;
    if (totalDecompressed > MAX_TOTAL_DECOMPRESSED_BYTES) {
      throw new Error(
        `Malformed ZIP: decompressed size exceeds limit (${MAX_TOTAL_DECOMPRESSED_BYTES} bytes)`
      );
    }

    // Skip directories
    if (!filename.endsWith("/")) {
      files.set(filename, content.toString("utf-8"));
    }
  }

  return files;
}
