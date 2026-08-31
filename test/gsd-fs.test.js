import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readBoundedRegularText,
  withPinnedDirectoryChain,
} from '../lib/gsd-fs.mjs';

function makeTmpDir(prefix = 'gsd-fs-test-') {
  return fs.mkdtempSync(path.join(tmpdir(), prefix));
}

test('T1: withPinnedDirectoryChain executes callback at pinned destination and returns result', () => {
  const base = makeTmpDir();
  const originalCwd = process.cwd();
  try {
    const hop1Path = path.join(base, 'hop1');
    const hop2Path = path.join(hop1Path, 'hop2');
    fs.mkdirSync(hop2Path, { recursive: true });

    const hop1Stat = fs.statSync(hop1Path);
    const hop2Stat = fs.statSync(hop2Path);

    const hops = [
      { name: hop1Path, identity: { dev: hop1Stat.dev, ino: hop1Stat.ino } },
      { name: 'hop2', identity: { dev: hop2Stat.dev, ino: hop2Stat.ino } },
    ];

    const result = withPinnedDirectoryChain(hops, () => {
      assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(hop2Path));
      fs.writeFileSync('test.txt', 'hello from pinned hop2');
      return 'success-value';
    });

    assert.equal(result, 'success-value');
    assert.equal(process.cwd(), originalCwd);
    assert.equal(fs.readFileSync(path.join(hop2Path, 'test.txt'), 'utf8'), 'hello from pinned hop2');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('T1: withPinnedDirectoryChain rejects hop identity mismatch', () => {
  const base = makeTmpDir();
  const originalCwd = process.cwd();
  try {
    const hop1Path = path.join(base, 'hop1');
    fs.mkdirSync(hop1Path, { recursive: true });
    const hop1Stat = fs.statSync(hop1Path);

    const hops = [
      { name: hop1Path, identity: { dev: hop1Stat.dev, ino: hop1Stat.ino + 999999 } },
    ];

    assert.throws(
      () => {
        withPinnedDirectoryChain(hops, () => {
          assert.fail('callback must not run when hop identity mismatches');
        });
      },
      (err) => {
        assert.equal(err.contractFailure, undefined);
        assert.match(err.message, /hop1/);
        assert.match(err.message, /identity changed during pinning/);
        return true;
      }
    );

    assert.equal(process.cwd(), originalCwd);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('T1: withPinnedDirectoryChain detects symlink swap before chdir (probe-D pattern)', () => {
  const base = makeTmpDir();
  const originalCwd = process.cwd();
  try {
    const targetPath = path.join(base, 'target');
    const targetMovedPath = path.join(base, 'target-moved');
    const escapePath = path.join(base, 'escape');
    fs.mkdirSync(targetPath, { recursive: true });
    fs.mkdirSync(escapePath, { recursive: true });

    const targetStat = fs.statSync(targetPath);

    // Swap target directory with symlink to escape before chdir
    fs.renameSync(targetPath, targetMovedPath);
    fs.symlinkSync(escapePath, targetPath);

    const hops = [
      { name: targetPath, identity: { dev: targetStat.dev, ino: targetStat.ino } },
    ];

    assert.throws(
      () => {
        withPinnedDirectoryChain(hops, () => {
          assert.fail('callback must not run after symlink swap');
        });
      },
      (err) => {
        assert.equal(err.contractFailure, undefined);
        assert.match(err.message, /target/);
        assert.match(err.message, /identity changed during pinning/);
        return true;
      }
    );

    assert.equal(process.cwd(), originalCwd);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('T1: withPinnedDirectoryChain restores cwd on callback throw and intermediate failure', () => {
  const base = makeTmpDir();
  const originalCwd = process.cwd();
  try {
    const hop1Path = path.join(base, 'hop1');
    fs.mkdirSync(hop1Path, { recursive: true });
    const hop1Stat = fs.statSync(hop1Path);

    const hops = [
      { name: hop1Path, identity: { dev: hop1Stat.dev, ino: hop1Stat.ino } },
    ];

    // Case 1: callback throws
    assert.throws(
      () => {
        withPinnedDirectoryChain(hops, () => {
          throw new Error('boom-in-callback');
        });
      },
      /boom-in-callback/
    );
    assert.equal(process.cwd(), originalCwd);

    // Case 2: non-existent hop directory throws
    const invalidHops = [
      { name: path.join(base, 'non-existent'), identity: { dev: hop1Stat.dev, ino: hop1Stat.ino } },
    ];
    assert.throws(
      () => {
        withPinnedDirectoryChain(invalidHops, () => {});
      }
    );
    assert.equal(process.cwd(), originalCwd);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('T1: withPinnedDirectoryChain rejects malformed arguments defensively', () => {
  const originalCwd = process.cwd();
  try {
    assert.throws(() => withPinnedDirectoryChain(null, () => {}), /hops must be an array/);
    assert.throws(() => withPinnedDirectoryChain('not-an-array', () => {}), /hops must be an array/);
    assert.throws(() => withPinnedDirectoryChain([], 'not-a-function'), /callback must be a function/);
    assert.throws(() => withPinnedDirectoryChain([null], () => {}), /each hop must/);
    assert.throws(() => withPinnedDirectoryChain([{ name: 'dir' }], () => {}), /each hop must/);
    assert.throws(() => withPinnedDirectoryChain([{ name: 123, identity: { dev: 1, ino: 1 } }], () => {}), /each hop must/);
    assert.throws(() => withPinnedDirectoryChain([{ name: 'dir', identity: { dev: null, ino: 1 } }], () => {}), /each hop must/);
    assert.equal(process.cwd(), originalCwd);
  } finally {
    process.chdir(originalCwd);
  }
});

test('T1: readBoundedRegularText expectedRoot containment regression', () => {
  const base = makeTmpDir();
  try {
    const rootDir = path.join(base, 'root');
    const outsideDir = path.join(base, 'outside');
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    const insideFile = path.join(rootDir, 'inside.txt');
    const outsideFile = path.join(outsideDir, 'outside.txt');
    const symlinkToOutside = path.join(rootDir, 'symlink-outside.txt');

    fs.writeFileSync(insideFile, 'inside content');
    fs.writeFileSync(outsideFile, 'outside content');
    fs.symlinkSync(outsideFile, symlinkToOutside);

    // Inside expectedRoot: success
    const content = readBoundedRegularText(insideFile, 1024, 'inside file', rootDir);
    assert.equal(content, 'inside content');

    // Plain outside expectedRoot: rejected
    assert.throws(
      () => {
        readBoundedRegularText(outsideFile, 1024, 'outside file', rootDir);
      },
      /outside/
    );

    // Symlink pointing outside: rejected (either symlink rejected or resolved outside)
    assert.throws(
      () => {
        readBoundedRegularText(symlinkToOutside, 1024, 'symlink outside', rootDir);
      },
      /symlink rejected|outside/
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
