import { z } from 'zod';
import { getSession, closeSession } from './session.mjs';
import { openAnalysis } from './core/analysis.mjs';
import { applyAnswers } from './core/fill.mjs';
import { collectQuestions, readQuestion, readStatus } from './core/extract.mjs';
import { probePage } from './core/probe.mjs';
import { clickRedo } from './core/redo.mjs';
import { submitPaper } from './core/submit.mjs';

const json = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

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
        return json({ ok: true, count: questions.length, questions });
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
    'quiz_submit',
    {
      title: 'Submit paper',
      description: '提交试卷并返回掌握度。必须显式 confirm=true 才会真正提交。',
      inputSchema: { confirm: z.boolean().optional().describe('必须为 true 才提交') },
    },
    async ({ confirm }) => {
      try {
        const page = await session().ensure();
        return json(await submitPaper(page, cfg.selectors, cfg.behavior, { confirm: confirm === true }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'quiz_analysis',
    {
      title: 'Read answer analysis',
      description: '打开「查看作答记录与解析」，返回错题与参考答案，供下一轮修正。',
      inputSchema: {},
    },
    async () => {
      try {
        const page = await session().ensure();
        return json(await openAnalysis(page, cfg.selectors, cfg.behavior));
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
