#!/usr/bin/env bash

set -Eeuo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

VALID_BUMPS=(patch minor major prepatch preminor premajor prerelease)

VERSION_TYPE=""
DRY_RUN=0
NO_GH_RELEASE=0

usage() {
  echo -e "${YELLOW}Usage: ./scripts/release.sh <bump-type> [--dry-run] [--no-gh-release]${NC}"
  echo "  bump-type: patch | minor | major | prepatch | preminor | premajor | prerelease"
  echo "  --dry-run: run checks + simulate publish, then restore version files"
  echo "  --no-gh-release: skip gh release creation"
}

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --no-gh-release)
      NO_GH_RELEASE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo -e "${RED}Unknown option: $arg${NC}"
      usage
      exit 1
      ;;
    *)
      if [ -n "$VERSION_TYPE" ]; then
        echo -e "${RED}Only one bump-type argument is allowed.${NC}"
        usage
        exit 1
      fi
      VERSION_TYPE="$arg"
      ;;
  esac
done

if [ -z "$VERSION_TYPE" ]; then
  usage
  exit 1
fi

is_valid_bump=0
for bump in "${VALID_BUMPS[@]}"; do
  if [ "$VERSION_TYPE" = "$bump" ]; then
    is_valid_bump=1
    break
  fi
done
if [ "$is_valid_bump" -ne 1 ]; then
  echo -e "${RED}Invalid bump-type: $VERSION_TYPE${NC}"
  usage
  exit 1
fi

for cmd in git node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo -e "${RED}Missing required command: $cmd${NC}"
    exit 1
  fi
done

if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}Working tree is not clean. Commit/stash first.${NC}"
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "main" ]; then
  echo -e "${YELLOW}Not on main (current: $BRANCH).${NC}"
  if [ -n "${CI:-}" ] || [ "${NONINTERACTIVE:-0}" = "1" ]; then
    echo -e "${RED}Refusing release off main in non-interactive mode.${NC}"
    exit 1
  fi
  read -r -p "Continue anyway? (y/N) " -n 1 REPLY
  echo
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo -e "${GREEN}Fetching origin/main and tags...${NC}"
git fetch origin main --tags

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
BASE="$(git merge-base HEAD origin/main)"

if [ "$LOCAL" != "$REMOTE" ]; then
  if [ "$LOCAL" = "$BASE" ]; then
    echo -e "${RED}Local branch is behind origin/main. Pull first.${NC}"
    exit 1
  elif [ "$REMOTE" = "$BASE" ]; then
    echo -e "${YELLOW}Local branch is ahead of origin/main.${NC}"
  else
    echo -e "${RED}Local branch and origin/main have diverged. Resolve first.${NC}"
    exit 1
  fi
fi

BUMPED=0
COMMITTED=0
TAGGED=0
NEW_VERSION=""
TAG=""

cleanup_on_error() {
  echo -e "${RED}Release failed.${NC}"
  if [ "$BUMPED" -eq 1 ] && [ "$COMMITTED" -eq 0 ]; then
    echo -e "${YELLOW}Restoring version files...${NC}"
    git restore -- package.json package-lock.json || true
  fi
  if [ "$TAGGED" -eq 1 ]; then
    echo -e "${YELLOW}Removing local tag $TAG...${NC}"
    git tag -d "$TAG" >/dev/null 2>&1 || true
  fi
}
trap cleanup_on_error ERR

echo -e "${GREEN}Running full checks...${NC}"
npm run check:all

echo -e "${GREEN}Bumping version (${VERSION_TYPE})...${NC}"
npm version "$VERSION_TYPE" --no-git-tag-version --ignore-scripts
BUMPED=1

NEW_VERSION="$(node -p "require('./package.json').version")"
TAG="v$NEW_VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Tag already exists: $TAG${NC}"
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo -e "${GREEN}Running npm publish dry-run...${NC}"
  npm publish --dry-run --access public --provenance --ignore-scripts
  echo -e "${YELLOW}Restoring version files after dry-run...${NC}"
  git restore -- package.json package-lock.json
  echo -e "${GREEN}Dry-run complete for ${TAG}.${NC}"
  trap - ERR
  exit 0
fi

echo -e "${GREEN}Committing release files...${NC}"
git add -- package.json package-lock.json
git commit -m "chore(release): ${TAG}"
COMMITTED=1

echo -e "${GREEN}Creating tag ${TAG}...${NC}"
git tag -a "$TAG" -m "$TAG"
TAGGED=1

echo -e "${GREEN}Publishing to npm...${NC}"
npm publish --access public --provenance --ignore-scripts

echo -e "${GREEN}Pushing branch and tag...${NC}"
git push origin "$BRANCH"
git push origin "$TAG"

if [ "$NO_GH_RELEASE" -eq 0 ] && command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    echo -e "${GREEN}Creating GitHub release ${TAG}...${NC}"
    gh release create "$TAG" --generate-notes
  else
    echo -e "${YELLOW}gh is installed but not authenticated; skipping GitHub release.${NC}"
  fi
elif [ "$NO_GH_RELEASE" -eq 0 ]; then
  echo -e "${YELLOW}gh CLI not installed; skipping GitHub release.${NC}"
fi

trap - ERR
echo -e "${GREEN}Release complete: ${TAG}${NC}"
