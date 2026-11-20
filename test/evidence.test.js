import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import {
  buildArchive,
  collectFillerForms,
  findTranscription,
  parseCast,
  parseSingerClaim
} from '../src/evidence.js';

async function load() {
  return buildArchive(await readMaterials());
}

test('衬词取自词义札记并包含“也记为”的异写', () => {
  const fillers = collectFillerForms([
    { id: 'g4', event: '松岭春会', form: '阿咧', gloss: '衬词', condition: '也记为啊咧，无实义' }
  ]);
  assert.deepEqual(fillers.sort(), ['啊咧', '阿咧']);
});

test('场册角色映射给出唱者性别，未定唱者保留竞争读法', () => {
  const { genderByName } = parseCast('女甲 阿麦、男乙 舟禾');
  assert.equal(genderByName.get('阿麦'), '女');
  assert.equal(genderByName.get('舟禾'), '男');
  assert.deepEqual(parseSingerClaim('阿麦或舟禾').map(claim => claim.token), ['阿麦', '舟禾']);
});

test('同一场的多份听写按时间与唱词并组，跨场同词绝不并组', async () => {
  const archive = await load();
  const songling = archive.events.get('松岭春会');
  const groups = songling.groups.map(group => group.members);
  assert.ok(groups.some(members => members.includes('r1') && members.includes('r2') && members.includes('r3')));
  assert.ok(groups.some(members => members.includes('r4') && members.includes('r6')));
  // 广川的 r5 自成一组，没有被吸进松岭的组
  const guangchuan = archive.events.get('广川夏会');
  assert.deepEqual(guangchuan.groups.flatMap(group => group.members), ['r5']);
  assert.ok(archive.comparablePairs.some(pair =>
    pair.events.includes('松岭春会') && pair.events.includes('广川夏会')));
});

test('女声起句与男声应答即使时间重合也禁止并组，并留下阻断说明', async () => {
  const archive = await load();
  const songling = archive.events.get('松岭春会');
  const blockedPairs = songling.blockedMerges.map(block => [block.a, block.b].sort().join('|'));
  assert.ok(blockedPairs.includes('r1|r4'));
  assert.ok(blockedPairs.includes('r3|r6'));
  const disputeRelations = songling.relations.filter(relation =>
    relation.label.includes('竞争归属'));
  assert.ok(disputeRelations.length >= 2);
  for (const relation of disputeRelations) {
    assert.equal(relation.timingClueOnly, true);
    assert.ok(relation.basis.some(text => text.includes('时间重合只作线索')));
  }
});

test('r3 同时是女声起句与男声接唱的竞争归属，两种读法都保留', async () => {
  const archive = await load();
  const r3 = findTranscription(archive, 'r3');
  assert.deepEqual(r3.singerClaims.map(claim => claim.token), ['阿麦', '舟禾']);
  assert.deepEqual(r3.genderHints.sort(), ['女', '男']);
  const songling = archive.events.get('松岭春会');
  const opening = songling.groups.find(group => group.members.includes('r3'));
  const singers = opening.variants.singerOptions.map(option => option.token);
  assert.ok(singers.includes('阿麦'));
  assert.ok(singers.includes('舟禾'));
});

test('不同记录员的转写互为异文，同一记录员首尾相接可拼连续链', async () => {
  const archive = await load();
  const songling = archive.events.get('松岭春会');
  const opening = songling.groups.find(group => group.members.includes('r2'));
  const readings = opening.variants.recorderReadings;
  const wenshan = readings.find(reading => reading.recorder === '闻山');
  assert.deepEqual(wenshan.transcriptionIds, ['r2', 'r3']);
  assert.equal(wenshan.text, '啊咧，川门远');
  assert.equal(wenshan.continuousChain, true);
  const linqing = readings.find(reading => reading.recorder === '林晴');
  assert.equal(linqing.text, '阿咧，川门远');
  // 原始词文一字不改
  assert.equal(findTranscription(archive, 'r1').raw.text, '阿咧，川门远');
});

test('句间功能标注覆盖起兴、复述、应答、接唱，且各自带出处', async () => {
  const archive = await load();
  const songling = archive.events.get('松岭春会');
  const labels = songling.groups.flatMap(group => group.functions.map(item => item.label));
  for (const expected of ['起兴', '应答', '接唱', '复述']) {
    assert.ok(labels.includes(expected), `缺少功能标注 ${expected}`);
  }
  const answer = songling.groups.find(group => group.functions.some(f => f.label === '应答'));
  for (const fn of answer.functions) {
    assert.ok(fn.evidence && fn.evidence.kind);
  }
});

test('衬词被标记为诗行外成分，不写入核心唱词', async () => {
  const archive = await load();
  const r1 = findTranscription(archive, 'r1');
  assert.equal(r1.core, '川门远');
  const fillerFragment = r1.fragments.find(part => part.text === '阿咧');
  assert.equal(fillerFragment.hasFiller, true);
  assert.equal(fillerFragment.core, '');
});
