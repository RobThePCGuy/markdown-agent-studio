#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const MAX_PORT_ATTEMPTS = 20;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function usage() {
  console.log('Usage: npx markdown-agent-studio [--port <number>] [--host <host>] [--no-open]');
  console.log('  --port     Server port (default: 4173)');
  console.log('  --host     Bind host (default: 127.0.0.1)');
  console.log('  --no-open  Do not auto-open browser');
  console.log('  -h, --help Show this help');
}

function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    openBrowser: true,
    port: DEFAULT_PORT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }

    if (arg === '--no-open') {
      options.openBrowser = false;
      continue;
    }

    if (arg === '--port') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --port');
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid --port value: ${value}`);
      }
      options.port = parsed;
      index += 1;
      continue;
    }

    if (arg === '--host') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --host');
      }
      options.host = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function safeResolveDistPath(distPath, requestPath) {
  const relativePath = requestPath.replace(/^\/+/, '');
  const resolvedPath = normalize(join(distPath, relativePath));
  const inDistRoot = resolvedPath === distPath;
  const inDistTree = resolvedPath.startsWith(`${distPath}${sep}`);
  if (!inDistRoot && !inDistTree) {
    return null;
  }
  return resolvedPath;
}

function getContentType(filePath) {
  const extension = extname(filePath).toLowerCase();
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

function serveFile(filePath, response, method) {
  try {
    const fileStat = statSync(filePath);
    if (!fileStat.isFile()) {
      return false;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': fileStat.size,
      'Content-Type': getContentType(filePath),
    });

    if (method === 'HEAD') {
      response.end();
      return true;
    }

    const stream = createReadStream(filePath);
    stream.on('error', () => {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Internal server error');
    });
    stream.pipe(response);
    return true;
  } catch {
    return false;
  }
}

function browserCommands(url) {
  if (platform() === 'darwin') {
    return [['open', [url]]];
  }

  if (platform() === 'win32') {
    return [['cmd', ['/c', 'start', '', url]]];
  }

  const candidates = [];
  if (/microsoft/i.test(release())) {
    candidates.push(['wslview', [url]]);
  }
  candidates.push(['xdg-open', [url]]);
  return candidates;
}

function openInBrowser(url) {
  for (const [command, args] of browserCommands(url)) {
    const result = spawnSync(command, args, { stdio: 'ignore' });
    if (!result.error && result.status === 0) {
      return true;
    }
  }
  return false;
}

async function start() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    usage();
    process.exit(1);
  }

  const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const distPath = join(packageDir, 'dist');

  if (!existsSync(distPath)) {
    console.error('Error: dist/ not found. Reinstall package or run a fresh publish build.');
    process.exit(1);
  }

  const indexHtmlPath = join(distPath, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    console.error('Error: dist/index.html not found. Package appears incomplete.');
    process.exit(1);
  }

  const server = createServer((request, response) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Method not allowed');
      return;
    }

    let pathname = '/';
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      pathname = decodeURIComponent(url.pathname || '/');
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }

    if (pathname.endsWith('/')) {
      pathname = `${pathname}index.html`;
    }

    const assetPath = safeResolveDistPath(distPath, pathname);
    if (!assetPath) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }

    const requestHasExtension = extname(pathname).length > 0;
    const servedAsset = serveFile(assetPath, response, method);
    if (servedAsset) {
      return;
    }

    if (!requestHasExtension) {
      const servedIndex = serveFile(indexHtmlPath, response, method);
      if (servedIndex) {
        return;
      }
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  let listeningPort = options.port;
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(listeningPort, options.host);
      });
      break;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'EADDRINUSE' || listeningPort >= options.port + MAX_PORT_ATTEMPTS) {
        console.error(
          `Failed to start server on ${options.host}:${listeningPort}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exit(1);
      }
      listeningPort += 1;
    }
  }

  const browserHost = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;
  const url = `http://${browserHost}:${listeningPort}`;

  console.log(`Markdown Agent Studio running at ${url}`);
  if (options.openBrowser) {
    const opened = openInBrowser(url);
    if (opened) {
      console.log('Opened browser.');
    } else {
      console.log('Could not auto-open browser on this system. Open the URL manually.');
    }
  }
  console.log('Press Ctrl+C to stop.');

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
