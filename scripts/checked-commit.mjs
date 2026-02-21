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

const PUBLISH_SCOPE_FILES = [
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'index.js',
  'index.d.ts',
  '.github/workflows/ci.yml',
  '.github/workflows/publish.yml',
  'scripts/checked-commit.mjs',
];

const PUBLISH_SCOPE_SET = new Set(PUBLISH_SCOPE_FILES.map(normalizePath));

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

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

function runBestEffort(command, args) {
  spawnSync(command, args, {
    stdio: 'ignore',
    encoding: 'utf8',
  });
}

function printUsageAndExit(code = 0) {
  const usage = [
    'Usage:',
    '  npm run commit:checked -- --message "commit message" [--bump patch] [--stage-publish] [--dry-run]',
    '',
    'Options:',
    '  -m, --message   Commit message (required)',
    '  --bump          Optional npm version bump type',
    '  --stage-publish Stage only publish-scope files (safe default for release commits)',
    '  --stage-all     Stage all changes (requires --allow-stage-all)',
    '  --allow-stage-all Required safety flag for --stage-all',
    '  --dry-run       Run checks and rollback version bump instead of committing',
    '  -h, --help      Show this message',
    '',
    'Examples:',
    '  npm run commit:checked -- --message "feat: add inspector filters"',
    '  npm run commit:checked -- --message "chore(release): v0.1.1" --bump patch --stage-publish',
  ].join('\n');

  process.stdout.write(`${usage}\n`);
  process.exit(code);
}

function hasStagedChanges() {
  const result = spawnSync('git', ['diff', '--cached', '--quiet']);
  return result.status === 1;
}

function isPathTracked(path) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { stdio: 'ignore' });
  return result.status === 0;
}

function isPathStaged(path) {
  const result = spawnSync('git', ['diff', '--cached', '--quiet', '--', path], { stdio: 'ignore' });
  return result.status === 1;
}

function getStagedFiles() {
  const output = run('git', ['diff', '--cached', '--name-only'], true);
  if (!output) return [];
  return output.split('\n').map((file) => normalizePath(file.trim())).filter(Boolean);
}

function stagePublishScopeFiles() {
  const filesToStage = PUBLISH_SCOPE_FILES.filter((file) => existsSync(resolve(file)) || isPathTracked(file));
  if (filesToStage.length > 0) {
    run('git', ['add', '--', ...filesToStage]);
  }
}

function assertPublishScopeOnly(stagedFiles) {
  const disallowed = stagedFiles.filter((file) => !PUBLISH_SCOPE_SET.has(file));
  if (disallowed.length > 0) {
    throw new Error(
      [
        'Publish-scope mode only allows these files:',
        ...PUBLISH_SCOPE_FILES.map((file) => `  - ${file}`),
        'Disallowed staged files:',
        ...disallowed.map((file) => `  - ${file}`),
        'Unstage those files and retry, or use --stage-all --allow-stage-all if intentional.',
      ].join('\n'),
    );
  }
}

let message = '';
let bumpType = '';
let stagePublish = false;
let stageAll = false;
let allowStageAll = false;
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
    case '--stage-publish':
      stagePublish = true;
      break;
    case '--stage-all':
      stageAll = true;
      break;
    case '--allow-stage-all':
      allowStageAll = true;
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

if (stagePublish && stageAll) {
  process.stderr.write('Use either --stage-publish or --stage-all, not both.\n');
  process.exit(1);
}

if (stageAll && !allowStageAll) {
  process.stderr.write('--stage-all requires --allow-stage-all. Use --stage-publish for safe release commits.\n');
  process.exit(1);
}

run('git', ['rev-parse', '--is-inside-work-tree'], true);

const packageJsonPath = resolve('package.json');
const packageLockPath = resolve('package-lock.json');

const originalPackageJson = readFileSync(packageJsonPath, 'utf8');
const hadPackageLock = existsSync(packageLockPath);
const originalPackageLock = hadPackageLock ? readFileSync(packageLockPath, 'utf8') : '';
const packageJsonWasStaged = isPathStaged('package.json');
const packageLockWasStaged = hadPackageLock ? isPathStaged('package-lock.json') : false;

let bumped = false;

function restoreVersionFiles() {
  writeFileSync(packageJsonPath, originalPackageJson);

  if (hadPackageLock) {
    writeFileSync(packageLockPath, originalPackageLock);
  } else if (existsSync(packageLockPath)) {
    rmSync(packageLockPath);
  }

  if (packageJsonWasStaged) {
    runBestEffort('git', ['add', '--', 'package.json']);
  } else {
    runBestEffort('git', ['restore', '--staged', '--', 'package.json']);
  }

  if (hadPackageLock) {
    if (packageLockWasStaged) {
      runBestEffort('git', ['add', '--', 'package-lock.json']);
    } else {
      runBestEffort('git', ['restore', '--staged', '--', 'package-lock.json']);
    }
  } else {
    runBestEffort('git', ['restore', '--staged', '--', 'package-lock.json']);
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

  if (stagePublish) {
    process.stdout.write('Staging publish-scope files only...\n');
    stagePublishScopeFiles();
  }

  if (stageAll) {
    process.stdout.write('Staging all changes...\n');
    run('git', ['add', '-A']);
  }

  if (bumped) {
    const addArgs = ['add', '--', 'package.json'];
    if (hadPackageLock || existsSync(packageLockPath)) {
      addArgs.push('package-lock.json');
    }
    run('git', addArgs);
  }

  if (!hasStagedChanges()) {
    throw new Error('No staged changes found. Stage files first, or rerun with --stage-publish.');
  }

  if (stagePublish) {
    assertPublishScopeOnly(getStagedFiles());
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
