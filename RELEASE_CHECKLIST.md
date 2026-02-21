# Release Checklist

Use this every time you publish.

## 1) Confirm npm auth

```bash
npm whoami
```

## 2) Run local quality gate

```bash
npm run check:all
```

## 3) Create a safe release commit

This runs checks, bumps version, and stages only publish-scope files.

```bash
npm run commit:publish -- --message "chore(release): vX.Y.Z" --bump patch
```

Notes:
- Use `--bump minor` or `--bump major` when needed.
- If checks fail after version bump, version files are auto-restored.

Alternative one-command release script:

```bash
npm run release -- patch
```

Optional flags:
- `--dry-run` (simulate publish and restore version files)
- `--no-gh-release` (skip GitHub release creation)

## 4) Push branch and tag

```bash
git push --follow-tags
```

## 5) Verify npm tarball contents (optional but recommended)

```bash
npm pack --dry-run --ignore-scripts
```

## 6) Publish

```bash
npm publish --access public --provenance
```

## Emergency: undo last release commit but keep changes

```bash
git reset --soft HEAD~1
```
