import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { buildArchive, findTranscription } from '../src/evidence.js';
import { Editor } from '../src/editorial.js';

async function setup() {
  const archive = buildArchive(await readMaterials());
  const editor = new Editor(archive);
  editor.assessStyle();
  return { archive, editor };
}

test('补录只生成建议，未确认前档案维持竞争读法', async () => {
  const { editor } = await setup();
  const suggestions = editor.parseAllSupplements();
  const a1 = suggestions.find(item => item.supplementId === 'a1');
  assert.equal(a1.action, 'confirm-singer');
  assert.equal(a1.transcriptionId, 'r3');
  assert.equal(a1.proposedSinger, '舟禾');
  assert.equal(a1.confidence, 'likely');
  // 尚未应用：r3 仍有两个唱者读法
  const r3 = findTranscription(editor.archive, 'r3');
  assert.equal(r3.singerClaims.length, 2);
  assert.equal(editor.singerConfirmations.has('r3'), false);
});

test('a2 佐证“山门”异文但不新增词文，且能跨句定位到 r6', async () => {
  const { editor } = await setup();
  const a2 = editor.parseAllSupplements().find(item => item.supplementId === 'a2');
  assert.equal(a2.action, 'corroborate-variant');
  assert.equal(a2.form, '山门');
  assert.deepEqual(a2.transcriptionIds, ['r6']);
  const result = editor.applySuggestion(a2);
  assert.equal(result.status, 'noted');
  // r6 原词仍在，未被替换
  assert.equal(findTranscription(editor.archive, 'r6').raw.text, '山门远么');
});

test('确认唱者只能在既有竞争读法内选择，未选中的异文不删除', async () => {
  const { editor, archive } = await setup();
  editor.confirmSinger('r3', '舟禾');
  assert.equal(editor.singerConfirmations.get('r3').singer, '舟禾');
  assert.throws(() => editor.confirmSinger('r3', '阿白'), /竞争读法/);
  const songling = archive.events.get('松岭春会');
  const group = songling.groups.find(item => item.members.includes('r3'));
  const tokens = group.variants.singerOptions.map(option => option.token);
  assert.ok(tokens.includes('阿麦'), '未选中的阿麦读法仍保留');
  assert.ok(tokens.includes('舟禾'));
  assert.equal(group.variants.singerOptions.find(o => o.token === '舟禾').confirmed, true);
});

test('确认词文必须取自同组既有异文，禁止新造', async () => {
  const { editor } = await setup();
  editor.confirmText('r1', '阿咧，川门远');
  assert.throws(() => editor.confirmText('r1', '凭空捏造的句子'), /既有异文/);
});

test('归属争议给出两套完整性读法；补录确认男声后重判为部分成立', async () => {
  const { editor } = await setup();
  const before = editor.evaluateCompleteness('松岭春会');
  assert.ok(before.overall.includes('争议'));
  const scenarios = before.readings.map(reading => reading.scenario);
  assert.ok(scenarios.some(label => label.includes('r3=阿麦')));
  assert.ok(scenarios.some(label => label.includes('r3=舟禾')));
  const amai = before.readings.find(reading => reading.scenario.includes('r3=阿麦'));
  const zhouhe = before.readings.find(reading => reading.scenario.includes('r3=舟禾'));
  assert.equal(amai.status, '可成立完整对答');
  assert.ok(zhouhe.status.includes('仅部分成立'));
  assert.ok(zhouhe.structuralGaps.some(gap => gap.problem.includes('对答缺另一角色')));

  // 应用 a1：证明“远”是男声应答，必须重新判断演出是否完整
  const a1 = editor.parseAllSupplements().find(item => item.supplementId === 'a1');
  editor.applySuggestion(a1);
  const after = editor.evaluateCompleteness('松岭春会');
  assert.equal(after.readings.length, 1);
  assert.ok(after.readings[0].status.includes('仅部分成立'));
  assert.ok(after.revisionTrail.some(item => item.supplementId === 'a1'));
});

test('广川夏会只有起句没有应答，结论为部分成立且不拼造对答', async () => {
  const { editor } = await setup();
  const result = editor.evaluateCompleteness('广川夏会');
  assert.equal(result.overall, '仅部分成立');
});

test('唱法判定：跨两场共见的开头是传统句候选，补录点明“改唱”的才标即兴', async () => {
  const { archive, editor } = await setup();
  const songling = archive.events.get('松岭春会');
  const opening = songling.groups.find(group => group.members.includes('r1'));
  const openingLabels = Object.fromEntries(
    opening.style.fragmentLabels.map(item => [item.fragment, item.label]));
  assert.equal(openingLabels['川门远'], '固定传统句候选');

  const guangchuan = archive.events.get('广川夏会');
  const only = guangchuan.groups[0];
  const labels = Object.fromEntries(only.style.fragmentLabels.map(item => [item.fragment, item.label]));
  assert.equal(labels['麦花挨桥开'], '即兴唱法');
  assert.equal(labels['川门远么'], '固定传统句候选');
  // 即兴判定必须引用补录原话
  const improvised = only.style.fragmentLabels.find(item => item.label === '即兴唱法');
  assert.ok(improvised.evidence.some(item => item.kind === 'supplement' && item.supplementId === 'a2'));
});

test('撤回读法后记录保留可查，完整性评估不再把它算作有效依据', async () => {
  const { editor } = await setup();
  editor.withdrawReading('r6', '补录证明该转写不成立（演练）');
  const r6 = findTranscription(editor.archive, 'r6');
  assert.equal(r6.status, 'withdrawn');
  const result = editor.evaluateCompleteness('松岭春会');
  assert.ok(['仅部分成立', '归属争议导致结论不一，各读法均保留'].includes(result.overall) ||
    result.readings.some(reading => reading.status.includes('部分')));
});
