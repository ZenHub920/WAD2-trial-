import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Use the server's .env even when Node is launched from the repository root.
// dotenv does not override values already provided by the process environment.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
