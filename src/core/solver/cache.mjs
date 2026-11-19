/**
 * 答案缓存：题干 + 选项文本的哈希 → 答案。
 *
 * 只落盘答案（不含题目原文以外的东西），用于重做同一套卷子时免二次求解。
 * 选项变了（同题干不同选项）视为未命中，避免旧答案套新题。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cacheFilePath } from '../config.mjs';

const MAX_ENTRIES = 2000;

export function questionKey(question) {
  const stem = String(question.stem || '').replace(/\s+/g, ' ').trim();
  const kind = question.kind || '';
  const options = (question.options || [])
    .map((o) => String(o.text || '').replace(/\s+/g, ' ').trim())
    .sort()
    .join('\u0001');
  return crypto.createHash('sha256').update(`${kind}\n${stem}\n${options}`).digest('hex');
}

export function loadCache(cfg) {
  const file = cacheFilePath(cfg);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') {
      return { file, entries: raw.entries };
    }
  } catch {
    /* 文件不存在或损坏：从空缓存开始 */
  }
  return { file, entries: {} };
}

export function getCached(cache, question) {
  return cache.entries[questionKey(question)] || null;
}

export function putCached(cache, question, answer) {
  cache.entries[questionKey(question)] = {
    ...(answer.labels ? { labels: answer.labels } : {}),
    ...(answer.text ? { text: answer.text } : {}),
    at: Date.now(),
  };
}

function trim(cache) {
  const entries = Object.entries(cache.entries);
  if (entries.length <= MAX_ENTRIES) return entries;
  return entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_ENTRIES);
}

export function saveCache(cache) {
  if (!cache.file) return 0;
  const kept = Object.fromEntries(trim(cache));
  const dir = path.dirname(cache.file);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${cache.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: Date.now(), entries: kept }), 'utf8');
    fs.renameSync(tmp, cache.file);
  } catch {
    /* 缓存写失败不影响本次作答 */
  }
  cache.entries = kept;
  return Object.keys(kept).length;
}
