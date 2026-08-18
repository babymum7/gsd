import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

function ioError(message) {
  const error = new Error(message);
  error.contractFailure = "io-error";
  return error;
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
function readBoundedRegularText(filePath, maxBytes, label, expectedRoot = null, parentFd = null) {
  let fd;
  let opened;
  try {
    if (parentFd != null) {
      // fd-anchored open: read through pinned parent dir via /proc/self/fd.
      const basename = path.basename(filePath);
      const fdPath = process.platform === 'linux'
        ? `/proc/self/fd/${parentFd}/${basename}`
        : process.platform === 'darwin'
          ? `/dev/fd/${parentFd}/${basename}`
          : null;
      if (!fdPath) throw new Error(`${label}: fd-anchored reads unavailable on this platform`);
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK;
      try {
        fd = fs.openSync(fdPath, flags);
      } catch (error) {
        if (error.code === 'ELOOP') throw new Error(`${label}: symlink rejected`);
        if (error.code === 'ENOENT') throw ioError(`${label}: file not found`);
        throw ioError(`${label}: cannot open file (${error.message})`);
      }
      opened = fs.fstatSync(fd);
      if (!opened.isFile()) throw new Error(`${label}: expected a regular file`);
    } else {
      // Legacy pathname-based open with lstat identity check.
      let lst;
      try {
        lst = fs.lstatSync(filePath);
      } catch (error) {
        throw ioError(`${label}: cannot inspect file (${error.message})`);
      }
      if (lst.isSymbolicLink()) throw new Error(`${label}: symlink rejected`);
      if (!lst.isFile()) throw new Error(`${label}: expected a regular file`);
      if (lst.size > maxBytes) {
        throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
      }
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK;
      fd = fs.openSync(filePath, flags);
      opened = fs.fstatSync(fd);
      if (!opened.isFile()) throw new Error(`${label}: expected a regular file`);
      if (opened.dev !== lst.dev || opened.ino !== lst.ino) {
        throw new Error(`${label}: file identity changed before open`);
      }
      const realFile = fs.realpathSync(filePath);
      if (expectedRoot && !isInside(expectedRoot, realFile)) {
        throw new Error(`${label}: resolved outside ${expectedRoot}`);
      }
      const current = fs.statSync(realFile);
      if (current.dev !== opened.dev || current.ino !== opened.ino) {
        throw new Error(`${label}: file identity changed during validation`);
      }
    }
    if (opened.size > maxBytes) {
      throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
    }

    const capacity = Math.min(maxBytes + 1, opened.size + 1);
    const buffer = Buffer.allocUnsafe(Math.max(1, capacity));
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) {
      throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
    }

    const afterRead = fs.fstatSync(fd);
    if (
      afterRead.dev !== opened.dev ||
      afterRead.ino !== opened.ino ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`${label}: file changed during read`);
    }
    return UTF8_DECODER.decode(buffer.subarray(0, total));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label}:`)) throw error;
    const readError = ioError(`${label}: cannot read file (${error.message})`);
    throw readError;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}
function readDirectoryEntriesBounded(directory, limit, label) {
  let handle;
  const entries = [];
  try {
    handle = fs.opendirSync(directory);
    while (true) {
      const entry = handle.readSync();
      if (!entry) break;
      if (entries.length >= limit) {
        throw new Error(`${label}: entry limit of ${limit} entries exceeded`);
      }
      entries.push(entry);
    }
    return entries;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label}:`)) throw error;
    const listError = ioError(`${label}: cannot enumerate directory (${error.message})`);
    throw listError;
  } finally {
    if (handle) {
      try { handle.closeSync(); } catch { /* ignore */ }
    }
  }
}
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export {
  isInside,
  readBoundedRegularText,
  readDirectoryEntriesBounded,
};
