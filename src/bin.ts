#!/usr/bin/env node
/** The installed executable. Everything it does lives in `cli.ts`. */

import process from 'node:process';
import { main } from './cli.ts';

process.exitCode = main(process.argv.slice(2));
