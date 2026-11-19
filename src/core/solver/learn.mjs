/**
 * 从解析页的「参考答案」学习错题，写回答案缓存。
 *
 * 解析页只给题干与标准答案，没有选项，所以用题干相似度把条目对回本轮采集的题目，
 * 再按题目自身的题型校验后落缓存。下次重做同一套卷子就能直接命中。
 */
import { loadCache, putCached, saveCache } from './cache.mjs';
import { normalizeAnswer } from './parse.mjs';

const norm = (text) => String(text || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/** 相似度：相等最高；其次是包含关系；否则看公共前缀长度。 */
function score(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 10000;
  if (a.includes(b) || b.includes(a)) return 5000 + Math.min(a.length, b.length);
  return commonPrefix(a, b);
}

export function matchQuestions(items, questions) {
  const pairs = [];
  for (const item of items) {
    const stem = norm(item.stem);
    if (!stem) continue;
    // 同一知识点里题干前缀常常相同（“加强和促进…大团结，必须依托…”），
    // 取相似度最高的那一题，而不是第一个前缀命中的题。
    let best = null;
    let bestScore = 0;
    for (const question of questions) {
      const s = score(stem, norm(question.stem));
      if (s > bestScore) {
        bestScore = s;
        best = question;
      }
    }
    if (best && bestScore >= 10) pairs.push({ question: best, correctAnswer: item.correctAnswer });
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
