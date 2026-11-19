/**
 * 从解析页的「参考答案」学习错题，写回答案缓存。
 *
 * 解析页只给题干与标准答案，没有选项，所以用题干相似度把条目对回本轮采集的题目，
 * 再按题目自身的题型校验后落缓存。下次重做同一套卷子就能直接命中。
 */
import { loadCache, putCached, saveCache } from './cache.mjs';
import { normalizeAnswer } from './parse.mjs';

const norm = (text) => String(text || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');

function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const width = Math.min(12, a.length, b.length);
  if (width < 6) return false;
  return a.slice(0, width) === b.slice(0, width) || a.includes(b) || b.includes(a);
}

export function matchQuestions(items, questions) {
  const pairs = [];
  for (const item of items) {
    const stem = norm(item.stem);
    if (!stem) continue;
    const hit = questions.find((q) => similar(stem, norm(q.stem)));
    if (hit) pairs.push({ question: hit, correctAnswer: item.correctAnswer });
  }
  return pairs;
}

export function learnCorrections(cfg, items, questions) {
  const cache = loadCache(cfg);
  let learned = 0;
  for (const { question, correctAnswer } of matchQuestions(items, questions)) {
    const answer = normalizeAnswer(correctAnswer, question);
    if (!answer) continue;
    putCached(cache, question, answer);
    learned += 1;
  }
  saveCache(cache);
  return learned;
}
