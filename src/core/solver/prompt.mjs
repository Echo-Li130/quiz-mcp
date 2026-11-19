/**
 * 提示词构造：把题目压成「题号|题型 题干 选项」，要求严格输出答案键。
 * 题目编号一律用 1 起的题号（与 quiz_answer 的 index 一致）。
 */

const KIND_LABEL = { radio: '单选', multi: '多选', blank: '填空' };

export function formatQuestion(question, no) {
  const kind = KIND_LABEL[question.kind] || '单选';
  const options = Array.isArray(question.options) && question.options.length
    ? ' ' + question.options
      .map((o) => `${String(o.label || '').replace(/\W/g, '')}. ${String(o.text || '').trim()}`)
      .join(' ')
    : '';
  return `${no}|[${kind}] ${String(question.stem || '').trim()}${options}`;
}

const RULES = [
  '你是严格答题器。只输出答案，每行格式：题号|答案',
  '规则：单选写一个字母；多选按字母升序、用逗号分隔（如 A,C）；填空只写 4–10 个汉字的短语，不要引号、标点或解释。',
  '不要解释、不要复述题干、不要输出题目以外的内容。',
  '示例：1|A  2|A,C  3|增强民族认同和团结',
  '---',
];

export function buildPrompt(questions) {
  const lines = questions.map((q, i) => formatQuestion(q, q.index || i + 1));
  return [...RULES, ...lines].join('\n');
}

/** 只补解析失败的那几题：重发子集，附带一句更严格的约束。 */
export function buildRepairPrompt(questions) {
  return [
    '下面几题上次没有按格式给出答案。请只输出这几题，每行「题号|答案」。',
    '多选按字母升序、逗号分隔；填空必须是 4–10 个汉字的短语，禁止引号、标点和整句解释。',
    '---',
    ...questions.map((q, i) => formatQuestion(q, q.index || i + 1)),
  ].join('\n');
}
