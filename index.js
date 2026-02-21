import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));
const distPath = join(packageDir, 'dist');

export { distPath };
export default distPath;
