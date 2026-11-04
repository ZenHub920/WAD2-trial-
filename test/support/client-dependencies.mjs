import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Reuse the client's installed tools; moving tests must not require a second
// installation or a machine-specific node_modules link in this folder.
export const clientRequire = createRequire(new URL('../../client/package.json', import.meta.url));
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const clientModule = name => import(pathToFileURL(clientRequire.resolve(name)).href);
