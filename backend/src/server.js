import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { openDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import { getAnalyzer } from './analyzer/index.js';
import { createRouter } from './routes.js';
import { log } from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..', '..', 'web');

/**
 * アプリを組み立てる（テストからも使う）。
 * 職員が空なら架空シードを自動投入する。戻り値の close() でDBを閉じる。
 */
export function createApp({ dbPath, env = process.env, analyzer } = {}) {
  const db = openDb(dbPath || env.DB_PATH || './data/heart-relay.db');
  seedIfEmpty(db);
  const app = express();
  app.disable('x-powered-by');

  // CORS（全オリジン許可。第一段階の開発用）
  app.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Staff-Id',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  // リクエストログ（1行）
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => { if (req.path !== '/api/health') log.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`); });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createRouter({ db, analyzer: analyzer || getAnalyzer(env), env }));
  if (fs.existsSync(WEB_DIR)) app.use(express.static(WEB_DIR));

  return { app, db, close: () => db.close() };
}

// 直接実行されたときだけ待ち受け開始
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 停止原因を必ずログに残す（2026-11-07 の本番 PC での停止はログが無く原因不明だったため）
  // unhandledRejection: 記録して継続（Node 15+ の既定は終了）。uncaughtException: 記録して終了コード 1
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection（処理は継続）:', reason instanceof Error ? reason.stack : reason);
  });
  process.on('uncaughtException', (err, origin) => {
    log.error(`uncaughtException（${origin}）のため終了します:`, err instanceof Error ? err.stack : err);
    process.exit(1);
  });
  dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
  const port = Number(process.env.PORT) || 8787;
  const { app } = createApp({});
  const analyzer = getAnalyzer(process.env);
  app.listen(port, '0.0.0.0', () => {
    log.info(`HEART RELAY backend: http://0.0.0.0:${port}  analyzer=${analyzer.name}${analyzer.model ? ' model=' + analyzer.model : ''}`);
    if (analyzer.name === 'mock') log.warn('ANTHROPIC_API_KEY 未設定のためモック解析で動作します');
  });
}
