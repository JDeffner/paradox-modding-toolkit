/**
 * Where a zip-packed save keeps its script.
 *
 * A Crusader Kings III save is a short text header plus a plain-text
 * `meta_data` block, and then a zip archive holding ONE entry, `gamestate`,
 * deflated. Reading it needs nothing more than that entry's byte offset and
 * compression method: `zlib.createInflateRaw()` over the rest of the file
 * stops itself at the end of the deflate stream, so the compressed size only
 * matters for a stored (uncompressed) entry.
 *
 * This is the whole zip support the toolkit needs — one local file header,
 * no central directory, no npm dependency. Pure: bytes in, offsets out.
 */

/** How much of a save's head is searched for the archive. CK3 packs it within ~32 KB. */
export const ZIP_HEAD_BYTES = 1 << 20;

/** Local file header signature, `PK\x03\x04`. */
const SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Field offsets inside a local file header (APPNOTE 4.3.7). */
const LOCAL_HEADER_BYTES = 30;

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. Nothing else is supported. */
  method: number;
  /** Byte offset of the entry's data in the file. */
  dataStart: number;
  /**
   * Compressed byte length, or undefined when the header does not carry it
   * (general-purpose bit 3: the sizes trail the data in a data descriptor).
   */
  compressedSize?: number;
}

/**
 * The first zip entry in `head`, or undefined when the bytes are not a zip.
 * `head` is the start of the file; an entry whose header does not fit inside
 * it counts as absent rather than as a truncated answer.
 */
export function findZipEntry(head: Buffer): ZipEntry | undefined {
  const at = head.indexOf(SIGNATURE);
  if (at < 0 || at + LOCAL_HEADER_BYTES > head.length) return undefined;

  const flags = head.readUInt16LE(at + 6);
  const method = head.readUInt16LE(at + 8);
  const compressed = head.readUInt32LE(at + 18);
  const nameLength = head.readUInt16LE(at + 26);
  const extraLength = head.readUInt16LE(at + 28);
  const nameAt = at + LOCAL_HEADER_BYTES;
  if (nameAt + nameLength > head.length) return undefined;

  const streamed = (flags & 0x08) !== 0;
  return {
    name: head.toString("latin1", nameAt, nameAt + nameLength),
    method,
    dataStart: nameAt + nameLength + extraLength,
    compressedSize: streamed || compressed === 0 ? undefined : compressed,
  };
}
