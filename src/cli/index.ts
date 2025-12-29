#!/usr/bin/env node
import { runCli } from './cli.js';

void runCli({ argv: process.argv.slice(2) });
