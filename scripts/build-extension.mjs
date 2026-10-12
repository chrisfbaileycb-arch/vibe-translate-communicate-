/**
 * Builds the Terminal Voice Companion into dist-extension/ (load it via chrome://extensions → Load unpacked).
 * Each entry becomes a self-contained IIFE: MV3 content scripts cannot be ES modules.
 */
import { build } from 'vite';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const outDir = 'dist-extension';
const entries = ['background', 'overlay', 'options', 'offscreen'];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const name of entries) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      target: 'chrome120',
      lib: { entry: `extension/src/${name}.ts`, formats: ['iife'], name: `lc_${name}`, fileName: () => `${name}.js` },
    },
  });
}

for (const file of ['manifest.json', 'options.html', 'offscreen.html']) {
  await copyFile(`extension/${file}`, `${outDir}/${file}`);
}
console.log(`Extension built → ${outDir}/ (${entries.length} scripts)`);
