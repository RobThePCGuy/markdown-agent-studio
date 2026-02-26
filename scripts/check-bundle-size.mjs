#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, 'dist', 'assets');
const MAX_INDEX_KB = Number(process.env.MAS_MAX_INDEX_KB ?? 2500);
const MAX_VENDOR_MARKDOWN_KB = Number(process.env.MAS_MAX_VENDOR_MARKDOWN_KB ?? 900);

function fail(message) {
  console.error(`[bundle-check] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(ASSETS_DIR)) {
  fail(`Missing assets directory: ${ASSETS_DIR}. Run build first.`);
}

const files = fs.readdirSync(ASSETS_DIR);
const jsFiles = files.filter((f) => f.endsWith('.js'));

function sizeKb(file) {
  const full = path.join(ASSETS_DIR, file);
  const bytes = fs.statSync(full).size;
  return Math.round(bytes / 1024);
}

function findLargest(prefix) {
  const candidates = jsFiles.filter((f) => f.startsWith(prefix));
  if (candidates.length === 0) return null;
  const withSizes = candidates.map((f) => ({ file: f, kb: sizeKb(f) }));
  withSizes.sort((a, b) => b.kb - a.kb);
  return withSizes[0];
}

const indexChunk = findLargest('index-');
const markdownChunk = findLargest('vendor-markdown-');

if (!indexChunk) {
  fail('No index-* chunk found in dist/assets.');
}
if (!markdownChunk) {
  fail('No vendor-markdown-* chunk found in dist/assets.');
}

const problems = [];
if (indexChunk.kb > MAX_INDEX_KB) {
  problems.push(`index chunk ${indexChunk.file} is ${indexChunk.kb}KB (limit ${MAX_INDEX_KB}KB)`);
}
if (markdownChunk.kb > MAX_VENDOR_MARKDOWN_KB) {
  problems.push(`vendor-markdown chunk ${markdownChunk.file} is ${markdownChunk.kb}KB (limit ${MAX_VENDOR_MARKDOWN_KB}KB)`);
}

if (problems.length > 0) {
  fail(problems.join('; '));
}

console.log(
  `[bundle-check] OK index=${indexChunk.file}(${indexChunk.kb}KB <= ${MAX_INDEX_KB}KB), ` +
  `vendor-markdown=${markdownChunk.file}(${markdownChunk.kb}KB <= ${MAX_VENDOR_MARKDOWN_KB}KB)`,
);
