/**
 * 解析求解器返回的答案键，并逐题校验。
 * 校验不通过的题进 unresolved，只回题号与原因——绝不猜答案。
 */

const LETTERS = /[A-Ha-h]/g;

function stripDecoration(raw) {
  return String(raw || '')
    .replace(/^[\s"'“”‘’【[(（]+/, '')
    .replace(/[\s"'“”‘’】\])）]+$/, '')
    .trim();
}

function optionLabels(question) {
  return (question.options || [])
    .map((o) => String(o.label || '').replace(/\W/g, '').toUpperCase())
    .filter(Boolean);
}

/** 单题答案归一化；无法判断时返回 null。 */
export function normalizeAnswer(raw, question) {
  const text = stripDecoration(raw);
  if (!text) return null;

  if (question.kind === 'blank') {
    const value = stripDecoration(text.split(/[\n;；]/)[0])
      .replace(/[。，,；;：:]+$/, '')
      .trim();
    // 平台按短标准答案精确比对：超过 12 字基本必错，判为无效让调用方重试。
    return value && value.length <= 12 ? { text: value } : null;
  }

  const available = optionLabels(question);
  if (!available.length) return null;

  const letters = [...new Set((text.toUpperCase().match(LETTERS) || []))]
    .filter((letter) => available.includes(letter));
  if (!letters.length) return null;

  // 多选题统一按字母升序；单选题保留原顺序取第一个（“B、A”应取 B）。
  return question.kind === 'multi' ? { labels: [...letters].sort() } : { labels: [letters[0]] };
}

/** 从「1|A」这种行式文本里解析出答案与未解决清单。 */
export function parseAnswerText(text, questions) {
  const wanted = new Map(questions.map((q, i) => [q.index || i + 1, q]));
  const found = new Map();

  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[|:：.、,，]\s*(.+?)\s*$/);
    if (!match) continue;
    const no = Number(match[1]);
    if (wanted.has(no)) found.set(no, match[2]);
  }

  const answers = [];
  const unresolved = [];
  for (const [no, question] of wanted) {
    if (!found.has(no)) {
      unresolved.push({ index: no, reason: 'no-answer' });
      continue;
    }
    const value = normalizeAnswer(found.get(no), question);
    if (!value) {
      unresolved.push({ index: no, reason: 'invalid-answer' });
      continue;
    }
    answers.push({ index: no, ...value });
  }

  answers.sort((a, b) => a.index - b.index);
  return { answers, unresolved };
}

/** 把 JSON 形态的答案（API 常返回这种）折成行式文本，复用同一套校验。 */
export function jsonAnswersToText(text) {
  try {
    const start = String(text || '').indexOf('{');
    const end = String(text || '').lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(String(text).slice(start, end + 1));
    if (!Array.isArray(parsed.answers)) return null;
    return parsed.answers
      .map((item) => {
        const no = Number(item.index);
        const value = Array.isArray(item.labels) ? item.labels.join(',') : String(item.text ?? item.answer ?? '');
        return Number.isFinite(no) && value ? `${no}|${value}` : '';
      })
      .filter(Boolean)
      .join('\n');
  } catch {
    return null;
  }
}

/** 紧凑答案键："1:A 2:A,C 3:人民政协" */
export function renderKey(answers) {
  return answers
    .map((a) => `${a.index}:${a.labels ? a.labels.join(',') : a.text}`)
    .join(' ');
}
