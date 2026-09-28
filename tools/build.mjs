// Bundles the game into single HTML files (no dependencies):
//   dist/cogworks.html  – standalone page you can open from disk or host anywhere
//   dist/artifact.html  – the same page without the document wrapper, for hosts that add their own
// Usage: node tools/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const inlined = html
  .replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, p) => '<style>\n' + readFileSync(join(root, p), 'utf8') + '</style>')
  .replace(/<script src="(js\/[^"]+)"><\/script>\n?/g, (_, p) => '<script>\n' + readFileSync(join(root, p), 'utf8').replace(/<\/script/gi, '<\\/script') + '</script>\n');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'cogworks.html'), inlined);

// Artifact variant: keep head content (title, fonts, styles) and body content, drop the wrappers.
const head = inlined.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset="utf-8">\n?/, '')
  .replace(/<meta name="viewport"[^>]*>\n?/, '');
const body = inlined.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(join(root, 'dist', 'artifact.html'), head.trim() + '\n' + body.trim() + '\n');

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log('dist/cogworks.html', kb(inlined));
console.log('dist/artifact.html', kb(head + body));
