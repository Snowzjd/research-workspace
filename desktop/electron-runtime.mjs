import fs from 'node:fs';
import path from 'node:path';

export const runtimeFiles = [
  'chrome_100_percent.pak', 'chrome_200_percent.pak', 'd3dcompiler_47.dll',
  'ffmpeg.dll', 'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll',
  'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'version',
  'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll', 'locales/en-US.pak'
];

export function verifyRuntimeFiles(directory, executable) {
  for (const relative of [...runtimeFiles, executable]) {
    const stat = fs.lstatSync(path.join(directory, relative), { throwIfNoEntry: false });
    if (!stat?.isFile() || !stat.size) throw new Error('Missing or invalid Electron runtime file: ' + relative);
  }

  const fd = fs.openSync(path.join(directory, executable), 'r');
  try {
    const dos = Buffer.alloc(64);
    const pe = Buffer.alloc(6);
    if (fs.readSync(fd, dos, 0, dos.length, 0) !== dos.length || dos.toString('ascii', 0, 2) !== 'MZ' ||
        fs.readSync(fd, pe, 0, pe.length, dos.readUInt32LE(60)) !== pe.length ||
        pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) {
      throw new Error('Portable build requires the Windows x64 Electron executable');
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function verifyElectronDistribution(packageDir, declaredVersion, lockedVersion) {
  const installed = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
  const dist = path.join(packageDir, 'dist');
  verifyRuntimeFiles(dist, 'electron.exe');
  const binaryVersion = fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, '');
  if (!declaredVersion || [lockedVersion, installed, binaryVersion].some(version => version !== declaredVersion)) {
    throw new Error('Declared, locked, installed and runtime Electron versions must match');
  }
  return dist;
}
