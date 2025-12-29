import path from 'node:path';
import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { Session, SessionConfig, SpecEntry, ToolName } from '../types';
import { ensureDir, pathExists, readTextFile, writeTextFile } from '../utils/fs';
import { getSessionsDir, PROJECT_LINK_FILE, SPECS_DIR } from '../config/paths';

export interface CreateSessionOptions {
  cwd: string;
  specs: SpecEntry[];
  lead: ToolName;
  validators: ToolName[];
  config: SessionConfig;
  env?: NodeJS.ProcessEnv;
}

export async function createSession(options: CreateSessionOptions): Promise<Session> {
  const now = new Date().toISOString();
  const session: Session = {
    id: uuidv4(),
    workingDirectory: options.cwd,
    specsDirectory: path.join(options.cwd, SPECS_DIR),
    specs: options.specs,
    lead: options.lead,
    validators: options.validators,
    config: options.config,
    status: 'in_progress',
    currentSpecIndex: 0,
    createdAt: now,
    updatedAt: now
  };
  await persistSession(session, options.env);
  await fs.writeFile(path.join(options.cwd, PROJECT_LINK_FILE), session.id, 'utf8');
  return session;
}

export async function persistSession(session: Session, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const sessionsDir = getSessionsDir(env);
  await ensureDir(sessionsDir);
  session.updatedAt = new Date().toISOString();
  const sessionPath = path.join(sessionsDir, `${session.id}.json`);
  await writeTextFile(sessionPath, JSON.stringify(session, null, 2));
}

export async function loadSession(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<Session | null> {
  const linkPath = path.join(cwd, PROJECT_LINK_FILE);
  if (!(await pathExists(linkPath))) {
    return null;
  }
  const sessionId = (await readTextFile(linkPath)).trim();
  if (!sessionId) {
    return null;
  }
  return loadSessionById(sessionId, env);
}

export async function loadSessionById(sessionId: string, env: NodeJS.ProcessEnv = process.env): Promise<Session | null> {
  const sessionPath = path.join(getSessionsDir(env), `${sessionId}.json`);
  if (!(await pathExists(sessionPath))) {
    return null;
  }
  const content = await readTextFile(sessionPath);
  return JSON.parse(content) as Session;
}

export async function completeSession(session: Session, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  session.status = 'completed';
  await persistSession(session, env);
  const linkPath = path.join(session.workingDirectory, PROJECT_LINK_FILE);
  await fs.rm(linkPath, { force: true });
}
