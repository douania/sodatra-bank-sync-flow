import { Inflate } from 'fflate';

const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_ARCHIVE_ENTRIES = 2_048;

export interface SafeStructuredXlsxArchive {
  error?: string;
  sanitizedBytes?: Uint8Array;
}

/**
 * Verifies actual ZIP expansion and CRCs before SheetJS sees an XLSX archive.
 * Data-descriptor entries are normalized in a private copy so SheetJS never
 * inflates from zero or attacker-controlled local sizes.
 */
export function prepareSafeStructuredXlsxArchive(bytes: Uint8Array): SafeStructuredXlsxArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sanitizedBytes = bytes.slice();
  const sanitizedView = new DataView(sanitizedBytes.buffer);
  const minimumEocdSize = 22;
  const firstPossibleEocd = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let candidate = bytes.byteLength - minimumEocdSize; candidate >= firstPossibleEocd; candidate -= 1) {
    if (view.getUint32(candidate, true) === 0x06054b50) {
      eocd = candidate;
      break;
    }
  }
  if (eocd < 0) return fail('XLSX archive has no valid end-of-central-directory record.');

  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    return fail('Multi-disk XLSX archives are refused.');
  }
  if (entryCount === 0 || entryCount > MAX_XLSX_ARCHIVE_ENTRIES) {
    return fail(`XLSX archive entry count exceeds the ${MAX_XLSX_ARCHIVE_ENTRIES}-entry safety limit.`);
  }
  if (eocd + minimumEocdSize + commentLength !== bytes.byteLength) {
    return fail('XLSX archive comment length is inconsistent.');
  }
  if (centralOffset + centralSize !== eocd) {
    return fail('XLSX central directory is outside the archive bounds.');
  }

  let offset = centralOffset;
  let totalUncompressed = 0;
  const localRanges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      return fail('XLSX central directory contains an invalid entry.');
    }
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const entryCommentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    if ((flags & 0x1) !== 0) return fail('Encrypted XLSX archive entries are refused.');
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      return fail('XLSX archive uses an unsupported compression method.');
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      return fail('ZIP64 XLSX entries are refused.');
    }
    if (compressionMethod === 0 && compressedSize !== uncompressedSize) {
      return fail('Stored XLSX entry sizes are inconsistent.');
    }
    if (totalUncompressed + uncompressedSize > MAX_XLSX_UNCOMPRESSED_BYTES) {
      return fail(`XLSX archive exceeds the ${MAX_XLSX_UNCOMPRESSED_BYTES / 1024 / 1024} MB uncompressed safety limit.`);
    }

    const centralEntryEnd = offset + 46 + fileNameLength + extraLength + entryCommentLength;
    if (centralEntryEnd > centralOffset + centralSize) {
      return fail('XLSX central directory contains an out-of-bounds entry.');
    }
    const centralExtraError = validateZipExtraFields(view, offset + 46 + fileNameLength, extraLength);
    if (centralExtraError) return fail(centralExtraError);
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      return fail('XLSX archive contains an invalid local file header.');
    }

    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCrc32 = view.getUint32(localOffset + 14, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localUncompressedSize = view.getUint32(localOffset + 22, true);
    const localFileNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const usesDataDescriptor = (flags & 0x8) !== 0;
    if (localFlags !== flags || localMethod !== compressionMethod || localFileNameLength !== fileNameLength) {
      return fail('XLSX local and central directory metadata do not match.');
    }
    if (
      !usesDataDescriptor &&
      (localCrc32 !== crc32 ||
        localCompressedSize !== compressedSize ||
        localUncompressedSize !== uncompressedSize)
    ) {
      return fail('XLSX local and central directory metadata do not match.');
    }
    if (
      usesDataDescriptor &&
      ((localCrc32 !== 0 && localCrc32 !== crc32) ||
        (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize))
    ) {
      return fail('XLSX data-descriptor metadata is inconsistent.');
    }

    const localHeaderEnd = localOffset + 30 + localFileNameLength + localExtraLength;
    const localDataEnd = localHeaderEnd + compressedSize;
    if (localHeaderEnd > centralOffset || localDataEnd > centralOffset) {
      return fail('XLSX local entry exceeds archive data bounds.');
    }
    for (let nameIndex = 0; nameIndex < fileNameLength; nameIndex += 1) {
      if (bytes[localOffset + 30 + nameIndex] !== bytes[offset + 46 + nameIndex]) {
        return fail('XLSX local and central entry names do not match.');
      }
    }
    const localExtraError = validateZipExtraFields(
      view,
      localOffset + 30 + localFileNameLength,
      localExtraLength,
    );
    if (localExtraError) return fail(localExtraError);

    let localEntryEnd = localDataEnd;
    if (usesDataDescriptor) {
      let descriptorOffset = localDataEnd;
      if (descriptorOffset + 4 <= centralOffset && view.getUint32(descriptorOffset, true) === 0x08074b50) {
        descriptorOffset += 4;
      }
      if (descriptorOffset + 12 > centralOffset) {
        return fail('XLSX data descriptor exceeds archive data bounds.');
      }
      if (
        view.getUint32(descriptorOffset, true) !== crc32 ||
        view.getUint32(descriptorOffset + 4, true) !== compressedSize ||
        view.getUint32(descriptorOffset + 8, true) !== uncompressedSize
      ) {
        return fail('XLSX data descriptor does not match the central directory.');
      }
      localEntryEnd = descriptorOffset + 12;
      sanitizedView.setUint16(offset + 8, flags & ~0x8, true);
      sanitizedView.setUint16(localOffset + 6, localFlags & ~0x8, true);
      sanitizedView.setUint32(localOffset + 14, crc32, true);
      sanitizedView.setUint32(localOffset + 18, compressedSize, true);
      sanitizedView.setUint32(localOffset + 22, uncompressedSize, true);
    }

    const payloadError = verifyZipEntryPayload(
      bytes.subarray(localHeaderEnd, localDataEnd),
      compressionMethod,
      uncompressedSize,
      crc32,
    );
    if (payloadError) return fail(payloadError);
    localRanges.push({ start: localOffset, end: localEntryEnd });
    totalUncompressed += uncompressedSize;
    offset = centralEntryEnd;
  }
  if (offset !== centralOffset + centralSize) {
    return fail('XLSX central directory size is inconsistent.');
  }
  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index].start < localRanges[index - 1].end) {
      return fail('XLSX local entries overlap.');
    }
  }
  return { sanitizedBytes };
}

function verifyZipEntryPayload(
  compressed: Uint8Array,
  compressionMethod: number,
  expectedSize: number,
  expectedCrc32: number,
): string | undefined {
  let actualSize = 0;
  let crc32 = 0xffffffff;
  const consume = (chunk: Uint8Array) => {
    actualSize += chunk.byteLength;
    if (actualSize > expectedSize || actualSize > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw new Error('XLSX entry expands beyond its declared safety bound.');
    }
    crc32 = updateCrc32(crc32, chunk);
  };

  try {
    if (compressionMethod === 0) {
      consume(compressed);
    } else {
      let completed = false;
      const inflater = new Inflate((chunk, final) => {
        consume(chunk);
        if (final) completed = true;
      });
      if (compressed.byteLength === 0) return 'Deflated XLSX entry is empty.';
      for (let offset = 0; offset < compressed.byteLength; offset += 1_024) {
        const end = Math.min(offset + 1_024, compressed.byteLength);
        inflater.push(compressed.subarray(offset, end), end === compressed.byteLength);
      }
      if (!completed) return 'Deflated XLSX entry did not terminate cleanly.';
    }
  } catch (error) {
    return error instanceof Error && error.message.includes('safety bound')
      ? error.message
      : 'XLSX entry decompression failed during bounded safety validation.';
  }

  if (actualSize !== expectedSize) return 'XLSX entry actual size does not match its directory metadata.';
  if (((crc32 ^ 0xffffffff) >>> 0) !== expectedCrc32) {
    return 'XLSX entry CRC32 does not match its directory metadata.';
  }
  return undefined;
}

function validateZipExtraFields(view: DataView, start: number, length: number): string | undefined {
  const end = start + length;
  if (end > view.byteLength) return 'XLSX ZIP extra fields exceed archive bounds.';
  let offset = start;
  while (offset < end) {
    if (offset + 4 > end) return 'XLSX ZIP extra fields are malformed.';
    const headerId = view.getUint16(offset, true);
    const fieldLength = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + fieldLength > end) return 'XLSX ZIP extra fields are malformed.';
    if (headerId === 0x0001) return 'ZIP64 XLSX entries are refused.';
    offset += fieldLength;
  }
  return undefined;
}

let crc32Table: Uint32Array | undefined;

function updateCrc32(crc: number, bytes: Uint8Array): number {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
      }
      crc32Table[index] = value >>> 0;
    }
  }
  let next = crc >>> 0;
  for (const byte of bytes) next = crc32Table[(next ^ byte) & 0xff] ^ (next >>> 8);
  return next >>> 0;
}

function fail(error: string): SafeStructuredXlsxArchive {
  return { error };
}
