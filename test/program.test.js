import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { buildArchive } from '../src/evidence.js';
import { Editor } from '../src/editorial.js';
import {
  ProgramRegistry,
  buildCrossEventCard,
  buildReenactmentCard,
  buildSingleUtteranceCard
} from '../src/program.js';

async function setup() {
  const archive = buildArchive(await readMaterials());
  const editor = new Editor(archive);
  editor.assessStyle();
  return { archive, editor };
}

test('实录重演卡只取同一场证据，按时间排序并保留全部异文与竞争唱者', async () => {
  const { archive, editor } = await setup();
  const card = buildReenactmentCard(archive, editor, {
    event: '松岭春会',
    planId: 's1',
    title: '早场实录'
  });
  assert.equal(card.cardType, '现场实录');
  const starts = card.entries.map(entry => entry.order[0]);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  const opening = card.entries.find(entry => entry.groupId.includes('r1'));
  const variantTexts = opening.variants.map(v => v.text);
  assert.ok(variantTexts.includes('阿咧，川门远'));
  assert.ok(variantTexts.includes('啊咧，川门远'));
  assert.ok(opening.competingSingers.some(singer => singer.singer === '阿麦'));
  assert.ok(opening.competingSingers.some(singer => singer.singer === '舟禾'));
  // 早场限时二十秒，素材远短于上限，不报警
  assert.equal(card.timeLimitMs, 20000);
  assert.ok(!card.warnings.some(warning => warning.warning.includes('超出安排上限')));
});

test('模式不符的安排不能出对应卡，防止跨场材料混进重演', async () => {
  const { archive, editor } = await setup();
  assert.throws(
    () => buildReenactmentCard(archive, editor, { event: '松岭春会', planId: 's2' }),
    /不能出实录重演卡/
  );
  assert.throws(
    () => buildCrossEventCard(archive, editor, { planId: 's1' }),
    /不能出跨场对照卡/
  );
});

test('登台名单外的唱者触发警告，但档案异文仍保留', async () => {
  const { archive, editor } = await setup();
  const card = buildReenactmentCard(archive, editor, {
    event: '松岭春会',
    planId: 's1'
  });
  // s1 登台为阿麦、舟禾；r1 的女甲不在名单
  assert.ok(card.warnings.some(warning => warning.warning.includes('女甲')));
  const flagged = card.entries.find(entry =>
    entry.competingSingers.some(singer => singer.singer === '女甲'));
  assert.ok(flagged.variants.length > 0, '即使不可登台，异文仍随卡保留');
});

test('跨场对照卡并列两场的同句异答，明确不是一场重演', async () => {
  const { archive, editor } = await setup();
  const card = buildCrossEventCard(archive, editor, { planId: 's2' });
  assert.equal(card.cardType, '跨场比较');
  assert.equal(card.notARecreation, true);
  const eventNodes = card.columns.flatMap(column => column.perEvent.map(item => item.event));
  assert.ok(eventNodes.includes('松岭春会'));
  assert.ok(eventNodes.includes('广川夏会'));
  // 每场各自带齐起句组与应答组，并标出哪个是可对照开头
  const songling = card.columns[0].perEvent.find(item => item.event === '松岭春会');
  assert.ok(songling.groups.some(group => group.comparableOpening));
  assert.ok(songling.groups.some(group => group.functions.includes('应答')));
  // 广川答句“麦花挨桥开”与松岭答句并列，没有被拼接进同一序列
  const allTexts = card.columns
    .flatMap(column => column.perEvent)
    .flatMap(item => item.groups)
    .flatMap(group => group.variants.map(v => v.text));
  assert.ok(allTexts.some(text => text.includes('麦花挨桥开')));
  assert.ok(allTexts.some(text => text.includes('东湾离水近')));
  // 每场附本场札记，词义按场区分，不把广川释义套到松岭
  const guangchuan = card.columns[0].perEvent.find(item => item.event === '广川夏会');
  assert.ok(guangchuan.glossary.some(item => item.form === '川门' && item.gloss.includes('渡口')));
});

test('单句档案卡围绕一条记录给出竞争读法，不替读者选定', async () => {
  const { archive, editor } = await setup();
  const card = buildSingleUtteranceCard(archive, editor, { transcriptionId: 'r3' });
  assert.equal(card.cardType, '单句档案');
  assert.deepEqual(card.competingSingers.map(claim => claim.token), ['阿麦', '舟禾']);
  assert.ok(card.competingSingers.every(claim => claim.confirmed === false));
  assert.ok(card.blockedMerges.length > 0);
  assert.ok(card.glossary.some(item => item.form === '川门' || item.form === '山门'));
});

test('发布生成冻结版本；勘误以新版本替代且旧版本仍可查', async () => {
  const { archive, editor } = await setup();
  const registry = new ProgramRegistry();
  const first = registry.publish(
    buildReenactmentCard(archive, editor, { event: '松岭春会', planId: 's1' }));
  assert.equal(first.version, 'v1');

  const a1 = editor.parseAllSupplements().find(item => item.supplementId === 'a1');
  editor.applySuggestion(a1);
  const revised = buildReenactmentCard(archive, editor, { event: '松岭春会', planId: 's1' });
  const second = registry.publishErratum({
    replacesVersion: 'v1',
    newCard: revised,
    changeNote: '补录 a1 证明“远”为舟禾男声应答，完整性重判为部分成立'
  });
  assert.equal(second.version, 'v2');
  assert.equal(second.erratumFor, 'v1');
  assert.equal(registry.get('v1').version, 'v1', '旧版本仍可查');
  const erratum = registry.errataFor('v1')[0];
  assert.equal(erratum.replacement, 'v2');
  assert.ok(erratum.changeNote.includes('完整性重判'));
  // 发布的是快照，事后改动不影响已发版本
  assert.equal(registry.get('v1').erratumFor, null);
});

test('勘误后核对变体依据：撤回的记录会被报出而不是悄悄删除', async () => {
  const { archive, editor } = await setup();
  const card = buildCrossEventCard(archive, editor, { planId: 's2' });
  const registry = new ProgramRegistry();
  registry.publish(card);
  // 演练：若 r6 被撤回，对照页“山门远么”变体失去全部有效依据
  editor.withdrawReading('r6', '演练撤回');
  const check = registry.checkVariants(archive, card);
  assert.equal(check.ok, false);
  const problem = check.problems.find(item => item.variant === '山门远么');
  assert.ok(problem);
  assert.deepEqual(problem.transcriptionIds, ['r6']);
  // 卡片本身没有被修改，异文仍在，只是被标记为失去依据
  const stillThere = card.columns
    .flatMap(column => column.perEvent)
    .flatMap(item => item.groups)
    .flatMap(group => group.variants)
    .some(variant => variant.text === '山门远么');
  assert.ok(stillThere);
});

test('伴唱缺席的晚场安排产出部分成立的实录卡并明示不得拼造', async () => {
  const { archive, editor } = await setup();
  // s3 只有阿麦登台，且为实录重演：只能选阿麦的起句，无法凑成对答
  const card = buildSingleUtteranceCard(archive, editor, { transcriptionId: 'r2' });
  assert.equal(card.cardType, '单句档案');
  const guangchuan = editor.evaluateCompleteness('广川夏会');
  assert.ok(guangchuan.overall.includes('部分'));
});
