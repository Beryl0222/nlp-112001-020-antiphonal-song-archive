import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { buildArchive } from '../src/evidence.js';
import { Editor } from '../src/editorial.js';
import { buildReport } from '../src/cli.js';

test('报告含场次、阻断并组、竞争读法与补录建议，且不改动资料', async () => {
  const archive = buildArchive(await readMaterials());
  const editor = new Editor(archive);
  editor.assessStyle();
  const report = buildReport(archive, editor);
  assert.ok(report.includes('松岭春会'));
  assert.ok(report.includes('阻断并组'));
  assert.ok(report.includes('竞争归属'));
  assert.ok(report.includes('a1'));
  assert.ok(report.includes('跨场可对照'));
});

test('次序守卫：答句整段排在问/起句之前即判倒置', async () => {
  const archive = buildArchive(await readMaterials());
  const editor = new Editor(archive);
  const problems = editor.detectOrderProblems([
    {
      groupId: 'G-question',
      spanMs: [3000, 4000],
      functions: ['起兴', '发问'],
      memberAssignments: []
    },
    {
      groupId: 'G-answer',
      spanMs: [1000, 2000],
      functions: ['应答'],
      memberAssignments: []
    }
  ]);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].problem.includes('回答排在问题之前'));

  // 接唱允许区间重合，不误报
  const overlap = editor.detectOrderProblems([
    { groupId: 'G1', spanMs: [1000, 2600], functions: ['起兴'], memberAssignments: [] },
    { groupId: 'G2', spanMs: [2360, 3450], functions: ['应答', '接唱'], memberAssignments: [] }
  ]);
  assert.equal(overlap.length, 0);
});

test('补录建议在报告中标注置信度，未确认不改变竞争读法', async () => {
  const archive = buildArchive(await readMaterials());
  const editor = new Editor(archive);
  const reportBefore = buildReport(archive, editor);
  assert.ok(reportBefore.includes('likely'));
  const r3Before = archive.transcriptions.find(row => row.id === 'r3');
  assert.equal(r3Before.singerClaims.length, 2);

  const a1 = editor.parseAllSupplements().find(item => item.supplementId === 'a1');
  editor.applySuggestion(a1);
  const reportAfter = buildReport(archive, editor);
  assert.ok(reportAfter.includes('已确认'));
});
