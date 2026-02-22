function splitPath(path: string): { dir: string; base: string; ext: string } {
  const normalized = path.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  const dir = slashIndex === -1 ? '' : normalized.slice(0, slashIndex + 1);
  const filename = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
  const dotIndex = filename.lastIndexOf('.');

  if (dotIndex > 0) {
    return {
      dir,
      base: filename.slice(0, dotIndex),
      ext: filename.slice(dotIndex),
    };
  }

  return { dir, base: filename, ext: '' };
}

export function ensureUniquePath(path: string, existingPaths: Iterable<string>): string {
  const existing = new Set(existingPaths);
  if (!existing.has(path)) return path;

  const { dir, base, ext } = splitPath(path);
  let suffix = 2;
  let candidate = `${dir}${base}-${suffix}${ext}`;
  while (existing.has(candidate)) {
    suffix++;
    candidate = `${dir}${base}-${suffix}${ext}`;
  }
  return candidate;
}

export function nextSequentialPath(
  prefix: string,
  ext: string,
  existingPaths: Iterable<string>,
): string {
  const existing = new Set(existingPaths);
  let n = 1;
  let candidate = `${prefix}-${n}${ext}`;
  while (existing.has(candidate)) {
    n++;
    candidate = `${prefix}-${n}${ext}`;
  }
  return candidate;
}

export function duplicatePath(path: string, existingPaths: Iterable<string>): string {
  const { dir, base, ext } = splitPath(path);
  return ensureUniquePath(`${dir}${base}-copy${ext}`, existingPaths);
}
