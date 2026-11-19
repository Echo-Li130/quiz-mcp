/** DeepSeek 兼容接口求解：POST /chat/completions，纯文本答案键。 */
import { buildPrompt } from './prompt.mjs';
import { SolverError } from './errors.mjs';

export async function solveViaApi(questions, cfg) {
  const { baseUrl, model, keyEnv } = cfg.solver.api;
  const key = process.env[keyEnv];
  if (!key) throw new SolverError('no-api-key', `环境变量 ${keyEnv} 未设置`);

  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: '你是严格答题器，只输出答案键，不解释。' },
      { role: 'user', content: buildPrompt(questions) },
    ],
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.solver.timeoutMs),
    });
  } catch (error) {
    throw new SolverError('api-unreachable', `请求 ${endpoint} 失败：${error.message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new SolverError('api-http', `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new SolverError('api-empty', 'API 返回空内容');
  return String(text);
}
