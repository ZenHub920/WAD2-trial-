import { createRequire } from 'node:module';

// Resolve server-owned packages without duplicating their installation in test/.
const require = createRequire(new URL('../../server/package.json', import.meta.url));

export const express = require('express');
export const Database = require('better-sqlite3');
export const parseEnv = require('dotenv').parse;
