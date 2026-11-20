import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  lcsLength,
  normalizeText,
  parseLimitMs,
  parseOffsetMs,
  splitFragments,
  stripPunctuation,
  textSimilarity
} from '../src/text.js';

test('切分保留原文偏移，衬词识别交给札记词表而非硬编码', () => {
  const parts = splitFragments('阿咧，川门远');
  assert.deepEqual(parts.map(part => part.text), ['阿咧', '川门远']);
  assert.equal(parts[0].start, 0);
  assert.equal(parts[1].end, 6);

  const normalized = normalizeText('啊咧，川门远', ['阿咧', '啊咧']);
  assert.equal(normalized, '川门远');
  assert.equal(stripPunctuation('山门远么'), '山门远么');
});

test('相似度基于 LCS，包含关系可识别同句异文', () => {
  assert.equal(lcsLength('川门', '川门远'), 2);
  assert.ok(textSimilarity('川门', '川门远') >= 0.5);
  assert.ok(textSimilarity('川门远', '山门远么') < 0.9);
});

test('中文时间与“限二十秒”写法解析为毫秒', () => {
  assert.equal(parseOffsetMs('二点三六'), 2360);
  assert.equal(parseOffsetMs('二十'), 20000);
  assert.equal(parseOffsetMs('30'), 30000);
  assert.equal(parseLimitMs('限二十秒，节目单标明本场提问和回应'), 20000);
  assert.equal(parseLimitMs('没有时限的说明'), null);
});
