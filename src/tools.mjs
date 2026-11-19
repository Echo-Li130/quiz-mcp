import { z } from 'zod';
import { getSession, closeSession } from './session.mjs';
import { openAnalysis } from './core/analysis.mjs';
import { applyAnswers } from './core/fill.mjs';
import { collectQuestions, readQuestion, readStatus } from './core/extract.mjs';
import { probePage } from './core/probe.mjs';
import { clickRedo } from './core/redo.mjs';
import { submitPaper } from './core/submit.mjs';
import { solveQuestions } from './core/solver/index.mjs';
import { clearQuestions } from './core/solver/cache.mjs';

// 紧凑序列化：工具结果是给模型读的，两空格缩进纯属浪费 token。
const json = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

/** 进程内缓存上一次采集结果，避免 quiz_answer/quiz_solve 重复翻页。 */
const COLLECT_TTL_MS = 5 * 60 * 1000;
const recent = { at: 0, questions: [] };

function rememberQuestions(questions) {
  recent.at = Date.now();
  recent.questions = questions;
}

function freshQuestions() {
  return Date.now() - recent.at < COLLECT_TTL_MS ? recent.questions : [];
}

const fail = (error) => json({ ok: false, error: String(error && error.message ? error.message : error) });

export function registerTools(server, cfg) {
  const session = () => getSession(cfg);

  server.registerTool(
    'quiz_open',
    {
      title: 'Open quiz page',
      description: '启动/复用浏览器并打开目标页；loginRequired=true 时需要人类在弹出的窗口里手动登录。',
      inputSchema: { url: z.string().url().optional().describe('目标地址；不填则用 config.json 里的 site.host') },
    },
    async ({ url }) => {
      try {
        const s = session();
        const page = await s.open(url);
        await page.waitForTimeout(1500);
        return json({ ok: true, ...(await readStatus(page, cfg.selectors)) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_status',
    {
      title: 'Quiz page status',
      description: '轻量探针：当前地址、试卷标题、答题进度、是否在登录页。',
      inputSchema: {},
    },
    async () => {
      try {
        const page = await session().ensure();
        return json({ ok: true, ...(await readStatus(page, cfg.selectors)) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_probe',
    {
      title: 'Probe page structure',
      description: '输出页面结构摘要（元素计数 + 候选区块），用于编写自己的 adapter 选择器。',
      inputSchema: {},
    },
    async () => {
      try {
        const page = await session().ensure();
        return json({ ok: true, ...(await probePage(page)) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_collect',
    {
      title: 'Collect questions',
      description: '从当前试卷逐题翻页采集题干与选项，返回 questions 数组。',
      inputSchema: { max: z.number().int().min(1).max(50).optional().describe('最多采集多少题，默认 15') },
    },
    async ({ max }) => {
      try {
        const page = await session().ensure();
        const questions = await collectQuestions(page, cfg.selectors, { max: max || 15 });
        // 题号统一成 1 起（与 quiz_answer 的 index 一致），并省略空字段省 token。
        const compact = questions.map((q, i) => ({
          index: i + 1,
          kind: q.kind,
          stem: q.stem,
          ...(q.type ? { type: q.type } : {}),
          ...(Array.isArray(q.options) && q.options.length ? { options: q.options } : {}),
          ...(q.blanks ? { blanks: q.blanks } : {}),
        }));
        rememberQuestions(compact);
        return json({ ok: true, count: compact.length, questions: compact });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_answer',
    {
      title: 'Answer questions',
      description: '按题号作答。默认 dryRun=true 只回显不点击；dryRun=false 才真正操作页面。',
      inputSchema: {
        answers: z.array(z.object({
          index: z.number().int().min(1),
          labels: z.array(z.string()).optional().describe('选项字母，如 ["A","C"]'),
          text: z.string().optional().describe('填空题答案'),
        })).min(1),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ answers, dryRun }) => {
      try {
        const page = await session().ensure();
        const applied = await applyAnswers(page, answers, cfg.selectors, cfg.behavior, {
          dryRun: dryRun !== false,
        });
        return json({ ok: true, dryRun: dryRun !== false, applied });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_solve',
    {
      title: 'Solve paper (low token)',
      description: '低 token 模式：内部采集题目并交给求解器（网页版 DeepSeek / API），只返回紧凑答案键，题目内容不进入对话上下文。默认只回显，apply=true 才真正回填。',
      inputSchema: {
        max: z.number().int().min(1).max(50).optional().describe('最多处理多少题，默认 15'),
        mode: z.enum(['web', 'api']).optional().describe('覆盖 solver.mode：web=网页版 DeepSeek，api=DeepSeek 接口'),
        apply: z.boolean().optional().describe('默认 false 只回答案键；true 才真正点选/填写'),
        batchSize: z.number().int().min(1).max(20).optional().describe('每次发给求解器的题数，默认取配置'),
        refresh: z.boolean().optional().describe('忽略缓存重新求解'),
      },
    },
    async ({ max, mode, apply, batchSize, refresh }) => {
      try {
        if (cfg.solver.mode === 'off' && !mode) {
          return json({
            ok: false,
            code: 'solver-disabled',
            message: '先在 adapter/config.json 里把 solver.mode 设为 "web" 或 "api"',
          });
        }

        const page = await session().ensure();
        let questions = max ? freshQuestions().slice(0, max) : freshQuestions();
        if (!questions.length) {
          questions = (await collectQuestions(page, cfg.selectors, { max: max || 15 }))
            .map((q, i) => ({ ...q, index: i + 1 }));
          rememberQuestions(questions);
        }

        const result = await solveQuestions({
          session: session(),
          cfg,
          questions,
          mode,
          batchSize,
          refresh: refresh === true,
        });

        let applied = null;
        if (apply === true && result.answers.length) {
          applied = await applyAnswers(page, result.answers, cfg.selectors, cfg.behavior, { dryRun: false });
        }

        return json({
          ok: true,
          mode: result.mode,
          total: questions.length,
          resolved: result.answers.length,
          cached: result.cached,
          key: result.key,
          unresolved: result.unresolved,
          ...(applied ? { applied: applied.map((a) => ({ index: a.index, verified: a.verified })) } : {}),
        });
      } catch (e) {
        return json({
          ok: false,
          ...(e && e.code ? { code: e.code } : {}),
          error: String(e && e.message ? e.message : e),
        });
      }
    },
  );

  server.registerTool(
    'quiz_submit',
    {
      title: 'Submit paper',
      description: '提交试卷并返回掌握度。必须显式 confirm=true 才会真正提交。',
      inputSchema: {
        confirm: z.boolean().optional().describe('必须为 true 才提交'),
        clearCacheOnPass: z.boolean().optional().describe('掌握度达阈值后清掉本轮题目的答案缓存'),
        threshold: z.number().min(0).max(100).optional().describe('达标阈值，默认 90'),
      },
    },
    async ({ confirm, clearCacheOnPass, threshold }) => {
      try {
        const page = await session().ensure();
        const result = await submitPaper(page, cfg.selectors, cfg.behavior, { confirm: confirm === true });
        let cleared = null;
        if (clearCacheOnPass === true && result.ok && typeof result.mastery === 'number') {
          if (result.mastery >= (threshold ?? 90)) {
            cleared = clearQuestions(cfg, freshQuestions());
          }
        }
        return json(cleared === null ? result : { ...result, cleared });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_analysis',
    {
      title: 'Read answer analysis',
      description: '打开「查看作答记录与解析」，返回错题与参考答案，供下一轮修正。默认只回错题条目，detail=true 才回原始文本。',
      inputSchema: {
        detail: z.boolean().optional().describe('是否附带整页解析原文（默认 false，省 token）'),
        all: z.boolean().optional().describe('返回全部题目（含答对的），默认只回错题'),
      },
    },
    async ({ detail, all }) => {
      try {
        const page = await session().ensure();
        return json(await openAnalysis(page, cfg.selectors, cfg.behavior, {
          detail: detail === true,
          all: all === true,
        }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_redo',
    {
      title: 'Redo paper',
      description: '点击「重新答题」开启新一轮（题库可能重新抽题，需重新 collect）。',
      inputSchema: {},
    },
    async () => {
      try {
        const page = await session().ensure();
        return json(await clickRedo(page, cfg.selectors, cfg.behavior));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_close',
    {
      title: 'Close browser',
      description: '关闭本进程打开的浏览器并释放 profile。',
      inputSchema: {},
    },
    async () => json({ ok: true, closed: await closeSession() }),
  );

  return server;
}

export { readQuestion };
