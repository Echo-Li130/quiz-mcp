#!/usr/bin/env node
/** 解析层自测：提示词、行式解析、JSON 归一化、校验与未解决清单。 */
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/core/solver/prompt.mjs';
import {
  parseAnswerText,
  normalizeAnswer,
  jsonAnswersToText,
  renderKey,
} from '../src/core/solver/parse.mjs';

const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`  ✗ ${name} — ${error.message}`);
  }
}

const questions = [
  { index: 1, kind: 'radio', stem: '中国的首都是', options: [{ label: 'A', text: '北京' }, { label: 'B', text: '上海' }] },
  { index: 2, kind: 'multi', stem: '下列属于水果的是', options: [{ label: 'A', text: '苹果' }, { label: 'B', text: '白菜' }, { label: 'C', text: '香蕉' }] },
  { index: 3, kind: 'blank', stem: '1+1 =', options: [] },
];

check('提示词带题号与题型', () => {
  const prompt = buildPrompt(questions);
  assert.match(prompt, /1\|\[单选\] 中国的首都是 A\. 北京 B\. 上海/);
  assert.match(prompt, /2\|\[多选\]/);
  assert.match(prompt, /3\|\[填空\]/);
});

check('标准行式解析', () => {
  const { answers, unresolved } = parseAnswerText('1|A\n2|A,C\n3|2', questions);
  assert.equal(unresolved.length, 0);
  assert.deepEqual(answers, [
    { index: 1, labels: ['A'] },
    { index: 2, labels: ['A', 'C'] },
    { index: 3, text: '2' },
  ]);
});

check('容忍常见变体', () => {
  const { answers } = parseAnswerText('第1题：A。\n2. A、C\n3、 2', questions);
  assert.deepEqual(answers.map((a) => a.index), [1, 2, 3]);
  assert.deepEqual(answers[1].labels, ['A', 'C']);
});

check('多选去重并升序', () => {
  const { answers } = parseAnswerText('2|C,A,A', questions);
  assert.deepEqual(answers[0].labels, ['A', 'C']);
});

check('越界字母不猜答案', () => {
  const { answers, unresolved } = parseAnswerText('1|Z', questions);
  assert.equal(answers.length, 0);
  assert.equal(unresolved[0].reason, 'invalid-answer');
});

check('缺答进 unresolved', () => {
  const { unresolved } = parseAnswerText('1|A', questions);
  assert.deepEqual(unresolved.map((u) => u.index), [2, 3]);
  assert.equal(unresolved[0].reason, 'no-answer');
});

check('JSON 答案折成行式文本', () => {
  const text = jsonAnswersToText('```json\n{"answers":[{"index":1,"labels":["A"]},{"index":3,"text":"2"}]}\n```');
  assert.equal(text, '1|A\n3|2');
});

check('非 JSON 返回 null', () => {
  assert.equal(jsonAnswersToText('1|A'), null);
});

check('单选只取第一个合法字母', () => {
  assert.deepEqual(normalizeAnswer('B、A', questions[0]), { labels: ['B'] });
});

check('填空短答案可用', () => {
  assert.deepEqual(normalizeAnswer('增强民族认同和团结', questions[2]), { text: '增强民族认同和团结' });
});

check('填空答案超过 12 字判为无效', () => {
  const value = normalizeAnswer('答'.repeat(80), questions[2]);
  assert.equal(value, null);
});

check('渲染紧凑答案键', () => {
  const key = renderKey([
    { index: 1, labels: ['A'] },
    { index: 2, labels: ['A', 'C'] },
    { index: 3, text: '2' },
  ]);
  assert.equal(key, '1:A 2:A,C 3:2');
});

if (failures.length) {
  console.error(`\nSOLVER PARSE FAIL (${failures.length})`);
  process.exit(1);
}
console.log(`\nSOLVER PARSE PASS ${passed}/${passed}`);
