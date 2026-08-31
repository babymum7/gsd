import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

function ioError(message) {
  const error = new Error(message);
  error.contractFailure = "io-error";
  return error;
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
function readBoundedRegularText(filePath, maxBytes, label, expectedRoot = null) {
  let fd;
  let opened;
  try {
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
    try {
      return UTF8_DECODER.decode(buffer.subarray(0, total));
    } catch {
      // The decoder's own sentence is engine-specific (Node and Bun word it differently, and
      // Bun changed it in 1.4), so own the message here: callers and tests pin this contract,
      // never a runtime's phrasing.
      throw ioError(`${label}: file must be valid UTF-8`);
    }
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
const DIR_FLAGS = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | (fs.constants.O_NOFOLLOW ?? 0);

function withPinnedDirectoryChain(hops, callback) {
  if (!Array.isArray(hops)) {
    throw new Error('hops must be an array');
  }
  if (typeof callback !== 'function') {
    throw new Error('callback must be a function');
  }
  for (const hop of hops) {
    if (
      !hop ||
      typeof hop !== 'object' ||
      typeof hop.name !== 'string' ||
      !hop.identity ||
      hop.identity.dev == null ||
      hop.identity.ino == null
    ) {
      throw new Error('each hop must be an object with name and identity (dev, ino)');
    }
  }

  const originalCwd = process.cwd();
  try {
    for (const hop of hops) {
      process.chdir(hop.name);
      let fd;
      let stat;
      try {
        fd = fs.openSync('.', DIR_FLAGS);
        stat = fs.fstatSync(fd);
      } finally {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch { /* ignore */ }
        }
      }
      if (!stat.isDirectory() || stat.dev !== hop.identity.dev || stat.ino !== hop.identity.ino) {
        throw new Error(`${hop.name}: identity changed during pinning`);
      }
    }
    return callback();
  } finally {
    process.chdir(originalCwd);
  }
}


export {
  isInside,
  readBoundedRegularText,
  readDirectoryEntriesBounded,
  withPinnedDirectoryChain,
};
