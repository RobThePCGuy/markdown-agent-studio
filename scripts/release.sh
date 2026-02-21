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
AUTO_PULL=0
NPM_PROVENANCE_MODE="${NPM_PROVENANCE:-auto}"

TEMP_NPMRC=""
BUMPED=0
COMMITTED=0
TAGGED=0
NEW_VERSION=""
TAG=""
VERSION_CHANGED_FILES=()

usage() {
  echo -e "${YELLOW}Usage: ./scripts/release.sh <bump-type> [--dry-run] [--pull] [--no-gh-release] [--provenance|--no-provenance]${NC}"
  echo "  bump-type: patch | minor | major | prepatch | preminor | premajor | prerelease"
  echo "  --dry-run: run checks + simulate publish, then restore version files"
  echo "  --pull: if behind origin/main, offer a fast-forward pull (or do it in CI/non-interactive)"
  echo "  --no-gh-release: skip gh release creation"
  echo "  --provenance: force npm provenance flag"
  echo "  --no-provenance: disable npm provenance flag"
}

restore_version_files() {
  if [ "${#VERSION_CHANGED_FILES[@]}" -gt 0 ]; then
    git restore -- "${VERSION_CHANGED_FILES[@]}" || true
  fi
}

cleanup_npm_auth() {
  if [ -n "${TEMP_NPMRC:-}" ] && [ -f "$TEMP_NPMRC" ]; then
    rm -f "$TEMP_NPMRC"
  fi
}

cleanup_on_error() {
  echo -e "${RED}Release failed.${NC}"
  if [ "$BUMPED" -eq 1 ] && [ "$COMMITTED" -eq 0 ]; then
    echo -e "${YELLOW}Restoring version files...${NC}"
    restore_version_files
  fi
  if [ "$TAGGED" -eq 1 ] && [ -n "${TAG:-}" ]; then
    echo -e "${YELLOW}Removing local tag $TAG...${NC}"
    git tag -d "$TAG" >/dev/null 2>&1 || true
  fi
}

trap cleanup_npm_auth EXIT

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --pull)
      AUTO_PULL=1
      ;;
    --no-gh-release)
      NO_GH_RELEASE=1
      ;;
    --provenance)
      NPM_PROVENANCE_MODE="on"
      ;;
    --no-provenance)
      NPM_PROVENANCE_MODE="off"
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

for cmd in git node npm mktemp; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo -e "${RED}Missing required command: $cmd${NC}"
    exit 1
  fi
done

if [ -n "${NPM_TOKEN:-}" ]; then
  TEMP_NPMRC="$(mktemp)"
  chmod 600 "$TEMP_NPMRC"
  printf '%s\n' "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "$TEMP_NPMRC"
  export NPM_CONFIG_USERCONFIG="$TEMP_NPMRC"
  echo -e "${GREEN}Using NPM_TOKEN for npm authentication.${NC}"
else
  echo -e "${YELLOW}NPM_TOKEN not set. npm publish will use your existing npm auth config.${NC}"
fi

PUBLISH_ARGS=(--access public --ignore-scripts)
case "$NPM_PROVENANCE_MODE" in
  on)
    PUBLISH_ARGS+=(--provenance)
    ;;
  off)
    ;;
  auto)
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
      PUBLISH_ARGS+=(--provenance)
    fi
    ;;
  *)
    echo -e "${RED}Invalid NPM_PROVENANCE mode: $NPM_PROVENANCE_MODE (expected auto|on|off)${NC}"
    exit 1
    ;;
esac

if [[ " ${PUBLISH_ARGS[*]} " == *" --provenance "* ]]; then
  echo -e "${GREEN}npm provenance: enabled${NC}"
else
  echo -e "${YELLOW}npm provenance: disabled (set --provenance or NPM_PROVENANCE=on to force)${NC}"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}Working tree is not clean. Pulling/releasing could overwrite uncommitted or staged changes.${NC}"
  git status --short
  echo -e "${YELLOW}Commit or stash your changes first.${NC}"
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
    echo -e "${YELLOW}Local branch is behind origin/main.${NC}"

    if [ "$AUTO_PULL" -eq 1 ]; then
      if [ "$BRANCH" != "main" ]; then
        echo -e "${RED}Refusing --pull while not on main. Switch to main first or pull manually.${NC}"
        exit 1
      fi

      if [ -n "${CI:-}" ] || [ "${NONINTERACTIVE:-0}" = "1" ]; then
        echo -e "${GREEN}Auto-pulling with --ff-only...${NC}"
        git pull --ff-only origin main
      else
        echo -e "${YELLOW}About to run: git pull --ff-only origin main${NC}"
        echo -e "${YELLOW}Your working tree is clean, so no uncommitted data will be overwritten.${NC}"
        read -r -p "Continue with pull? (y/N) " -n 1 REPLY
        echo
        if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
          exit 1
        fi
        git pull --ff-only origin main
      fi
    else
      echo -e "${RED}Pull first (or rerun with --pull for a fast-forward pull).${NC}"
      exit 1
    fi
  elif [ "$REMOTE" = "$BASE" ]; then
    echo -e "${YELLOW}Local branch is ahead of origin/main.${NC}"
  else
    echo -e "${RED}Local branch and origin/main have diverged. Resolve first.${NC}"
    exit 1
  fi
fi

trap cleanup_on_error ERR

echo -e "${GREEN}Running full checks...${NC}"
npm run check:all

echo -e "${GREEN}Bumping version (${VERSION_TYPE})...${NC}"
npm version "$VERSION_TYPE" --no-git-tag-version --ignore-scripts
BUMPED=1

mapfile -t VERSION_CHANGED_FILES < <(git diff --name-only)

if [ "${#VERSION_CHANGED_FILES[@]}" -eq 0 ]; then
  echo -e "${RED}Version bump did not modify any files.${NC}"
  exit 1
fi

NEW_VERSION="$(node -p "require('./package.json').version")"
TAG="v$NEW_VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Tag already exists: $TAG${NC}"
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo -e "${GREEN}Running npm publish dry-run...${NC}"
  npm publish --dry-run "${PUBLISH_ARGS[@]}"
  echo -e "${YELLOW}Restoring version files after dry-run...${NC}"
  restore_version_files
  echo -e "${GREEN}Dry-run complete for ${TAG}.${NC}"
  trap - ERR
  exit 0
fi

echo -e "${GREEN}Committing release files...${NC}"
git add -- "${VERSION_CHANGED_FILES[@]}"
git commit -m "chore(release): ${TAG}"
COMMITTED=1

echo -e "${GREEN}Creating tag ${TAG}...${NC}"
git tag -a "$TAG" -m "$TAG"
TAGGED=1

echo -e "${GREEN}Publishing to npm...${NC}"
npm publish "${PUBLISH_ARGS[@]}"

echo -e "${GREEN}Pushing branch and tag...${NC}"
git push origin "$BRANCH"
git push origin "$TAG"

if [ "$NO_GH_RELEASE" -eq 0 ] && command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    echo -e "${GREEN}Creating GitHub release ${TAG}...${NC}"
    if ! gh release create "$TAG" --generate-notes; then
      echo -e "${YELLOW}GitHub release creation failed, but npm publish and git push already succeeded.${NC}"
    fi
  else
    echo -e "${YELLOW}gh is installed but not authenticated; skipping GitHub release.${NC}"
  fi
elif [ "$NO_GH_RELEASE" -eq 0 ]; then
  echo -e "${YELLOW}gh CLI not installed; skipping GitHub release.${NC}"
fi

trap - ERR
echo -e "${GREEN}Release complete: ${TAG}${NC}"