#!/usr/bin/env node

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const VALID_BUMPS = new Set([
  'patch',
  'minor',
  'major',
  'prepatch',
  'preminor',
  'premajor',
  'prerelease',
]);

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const extra = capture ? (result.stderr || result.stdout || '').trim() : '';
    const message = `Command failed: ${command} ${args.join(' ')}`;
    throw new Error(extra ? `${message}\n${extra}` : message);
  }

  return capture ? result.stdout.trim() : '';
}

function printUsageAndExit(code = 0) {
  const usage = [
    'Usage:',
    '  npm run commit:checked -- --message "commit message" [--bump patch] [--stage-all] [--dry-run]',
    '',
    'Options:',
    '  -m, --message   Commit message (required)',
    '  --bump          Optional npm version bump type',
    '  --stage-all     Stage all changes before commit',
    '  --dry-run       Run checks and rollback version bump instead of committing',
    '  -h, --help      Show this message',
    '',
    'Examples:',
    '  npm run commit:checked -- --message "feat: add inspector filters"',
    '  npm run commit:checked -- --message "chore(release): v0.1.1" --bump patch --stage-all',
  ].join('\n');

  process.stdout.write(`${usage}\n`);
  process.exit(code);
}

function hasStagedChanges() {
  const result = spawnSync('git', ['diff', '--cached', '--quiet']);
  return result.status === 1;
}

let message = '';
let bumpType = '';
let stageAll = false;
let dryRun = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  switch (arg) {
    case '-m':
    case '--message': {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        process.stderr.write('Missing value for --message\n');
        printUsageAndExit(1);
      }
      message = value.trim();
      i += 1;
      break;
    }
    case '--bump': {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        process.stderr.write('Missing value for --bump\n');
        printUsageAndExit(1);
      }
      if (!VALID_BUMPS.has(value)) {
        process.stderr.write(`Invalid bump type: ${value}\n`);
        printUsageAndExit(1);
      }
      bumpType = value;
      i += 1;
      break;
    }
    case '--stage-all':
      stageAll = true;
      break;
    case '--dry-run':
      dryRun = true;
      break;
    case '-h':
    case '--help':
      printUsageAndExit(0);
      break;
    default:
      process.stderr.write(`Unknown argument: ${arg}\n`);
      printUsageAndExit(1);
      break;
  }
}

if (!message) {
  process.stderr.write('A commit message is required.\n');
  printUsageAndExit(1);
}

run('git', ['rev-parse', '--is-inside-work-tree'], true);

const packageJsonPath = resolve('package.json');
const packageLockPath = resolve('package-lock.json');

const originalPackageJson = readFileSync(packageJsonPath, 'utf8');
const hadPackageLock = existsSync(packageLockPath);
const originalPackageLock = hadPackageLock ? readFileSync(packageLockPath, 'utf8') : '';

let bumped = false;
let stagedVersionFiles = false;

function restoreVersionFiles() {
  writeFileSync(packageJsonPath, originalPackageJson);
  if (hadPackageLock) {
    writeFileSync(packageLockPath, originalPackageLock);
  } else if (existsSync(packageLockPath)) {
    rmSync(packageLockPath);
  }

  if (stagedVersionFiles) {
    const addArgs = ['add', 'package.json'];
    if (hadPackageLock || existsSync(packageLockPath)) {
      addArgs.push('package-lock.json');
    }
    run('git', addArgs);
  }
}

try {
  if (bumpType) {
    process.stdout.write(`Bumping version (${bumpType})...\n`);
    run('npm', ['version', bumpType, '--no-git-tag-version']);
    bumped = true;
  }

  process.stdout.write('Running checks (lint, test, build)...\n');
  run('npm', ['run', 'lint']);
  run('npm', ['test']);
  run('npm', ['run', 'build']);

  if (dryRun) {
    if (bumped) {
      restoreVersionFiles();
    }
    process.stdout.write('Dry run complete. No commit created.\n');
    process.exit(0);
  }

  if (stageAll) {
    run('git', ['add', '-A']);
  }

  if (bumped) {
    const addArgs = ['add', 'package.json'];
    if (hadPackageLock || existsSync(packageLockPath)) {
      addArgs.push('package-lock.json');
    }
    run('git', addArgs);
    stagedVersionFiles = true;
  }

  if (!hasStagedChanges()) {
    throw new Error('No staged changes found. Stage files first, or rerun with --stage-all.');
  }

  run('git', ['commit', '-m', message]);

  if (bumpType) {
    const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    process.stdout.write(`Commit created successfully at version ${version}.\n`);
  } else {
    process.stdout.write('Commit created successfully.\n');
  }
} catch (error) {
  if (bumped) {
    restoreVersionFiles();
    process.stderr.write('Version files were restored after failure.\n');
  }

  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
