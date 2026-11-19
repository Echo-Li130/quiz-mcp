/**
 * 求解器编排：分批 → 缓存 → 求解 → 解析校验 → 重试一次 → 汇总。
 *
 * 对外只回答案与未解决清单；题目内容不离开本进程。
 */
import { parseAnswerText, jsonAnswersToText, renderKey } from './parse.mjs';
import { solveViaApi } from './api.mjs';
import { openSolverPage, solveViaWeb } from './web.mjs';
import { loadCache, getCached, putCached, saveCache } from './cache.mjs';

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** 缓存命中也要过一遍规则：旧规则写进去的长填空答案不能继续用。 */
function usableAnswer(answer, question) {
  if (!answer) return false;
  if (question.kind === 'blank') {
    return typeof answer.text === 'string' && answer.text.length > 0 && answer.text.length <= 12;
  }
  return Array.isArray(answer.labels) && answer.labels.length > 0;
}

export async function solveQuestions({
  session,
  cfg,
  questions,
  mode,
  batchSize,
  refresh = false,
  provider = null,
}) {
  const selected = mode || cfg.solver.mode;
  if (selected === 'off') {
    return { ok: false, code: 'solver-disabled', mode: 'off', answers: [], unresolved: [], key: '', cached: 0 };
  }

  // refresh 只忽略已有答案，仍要写回真实缓存文件（否则下一次又得重算）。
  const cache = loadCache(cfg);
  if (refresh) cache.entries = {};
  const answers = [];
  const unresolved = [];
  let cachedCount = 0;

  const solveFn = provider?.solve
    || (selected === 'api' ? (qs) => solveViaApi(qs, cfg) : null);
  let webPage = null;
  let loginRequired = false;

  const call = async (qs) => {
    if (solveFn) return solveFn(qs);
    if (!webPage) webPage = await openSolverPage(session, cfg);
    return solveViaWeb(webPage, qs, cfg);
  };

  try {
    const size = Math.max(1, Math.min(20, batchSize || cfg.solver.batchSize));
    for (const batch of chunk(questions, size)) {
      const pending = [];
      for (const question of batch) {
        const hit = getCached(cache, question);
        if (hit && usableAnswer(hit, question)) {
          answers.push({ index: question.index, ...(hit.labels ? { labels: hit.labels } : { text: hit.text }) });
          cachedCount += 1;
        } else {
          pending.push(question);
        }
      }
      if (!pending.length) continue;

      const raw = await call(pending);
      let { answers: got, unresolved: missing } = parseAnswerText(jsonAnswersToText(raw) || raw, pending);

      const retryQuestions = missing.length
        ? pending.filter((q) => missing.some((m) => m.index === q.index))
        : [];
      if (retryQuestions.length) {
        try {
          const rawRetry = await call(retryQuestions);
          const second = parseAnswerText(jsonAnswersToText(rawRetry) || rawRetry, retryQuestions);
          got = got.concat(second.answers);
          missing = second.unresolved;
        } catch {
          /* 重试失败就保留第一次的解析结果 */
        }
      }

      // 仍然缺的题逐题再问一次：整批被截断/限流时，单题请求更容易成功。
      if (missing.length) {
        for (const question of retryQuestions.slice(0, 3)) {
          if (!missing.some((m) => m.index === question.index)) continue;
          try {
            const rawOne = await call([question]);
            const one = parseAnswerText(jsonAnswersToText(rawOne) || rawOne, [question]);
            if (one.answers.length) {
              got = got.concat(one.answers);
              missing = missing.filter((m) => m.index !== question.index);
            }
          } catch {
            /* 单题重试失败：保留在 unresolved */
          }
        }
      }

      for (const answer of got) {
        const question = pending.find((q) => q.index === answer.index);
        if (!question) continue;
        putCached(cache, question, answer);
        answers.push(answer);
      }
      unresolved.push(...missing);
    }
  } catch (error) {
    if (error?.code === 'login-required') loginRequired = true;
    if (!answers.length) throw error;
    unresolved.push({ index: 0, reason: error?.code || 'solver-error' });
  } finally {
    if (webPage && !loginRequired) await webPage.close().catch(() => {});
  }

  answers.sort((a, b) => a.index - b.index);
  saveCache(cache);
  return { ok: true, mode: selected, answers, unresolved, cached: cachedCount, key: renderKey(answers) };
}
