// 命令行：只读地汇总证据图与编校要点，便于馆员快速核查；不改动任何资料文件。
// 用法：
//   node src/cli.js report            人读摘要
//   node src/cli.js json              完整证据图 JSON

import { readMaterials } from '../materials.js';
import { buildArchive } from './evidence.js';
import { Editor } from './editorial.js';
import { pathToFileURL } from 'node:url';

function line(title) {
  return `\n== ${title} ${'='.repeat(Math.max(0, 40 - title.length))}`;
}

export function buildReport(archive, editor) {
  const out = [];
  out.push(`衬词（据词义札记）：${archive.fillerForms.join('、')}`);

  for (const event of archive.events.values()) {
    out.push(line(`场次：${event.event}`));
    out.push(`场册 ${event.program?.id ?? '无'}：${event.program?.text ?? '（缺场册）'}`);
    out.push(`登台唱者：${event.cast.tokens.map(t => t.token).join('、')}`);
    for (const block of event.blockedMerges) {
      out.push(`  [阻断并组] ${block.a} × ${block.b}：${block.reason}`);
    }
    for (const group of event.groups) {
      out.push(`- 唱句组 ${group.id}`);
      out.push(`  区间 ${group.spanMs[0]}–${group.spanMs[1]}ms；功能：${group.functions.map(f => f.label).join('、')}；唱法：${group.style.label}`);
      for (const reading of group.variants.recorderReadings) {
        out.push(`  异文（${reading.recorder}${reading.continuousChain ? '，连续链' : ''}）：${reading.text}  [${reading.transcriptionIds.join('+')}]`);
      }
      out.push(`  唱者竞争读法：${group.variants.singerOptions
        .map(o => `${o.token}${o.gender ? `(${o.gender})` : ''}${o.confirmed ? '·已确认' : ''}[${o.supportedBy.join('、')}]`)
        .join(' | ')}`);
    }
    for (const relation of event.relations) {
      out.push(`  关系 ${relation.from} → ${relation.to}：${relation.label}（${relation.basis.join('；')}）`);
    }
    const completeness = editor.evaluateCompleteness(event.event);
    out.push(`  完整性结论：${completeness.overall}`);
    for (const reading of completeness.readings) {
      out.push(`    · ${reading.scenario} => ${reading.status}`);
    }
  }

  out.push(line('跨场可对照（禁止合并重演）'));
  for (const pair of archive.comparablePairs) {
    out.push(`- ${pair.events.join(' / ')}：${pair.label}`);
  }

  out.push(line('补录建议（未确认不生效）'));
  for (const suggestion of editor.parseAllSupplements()) {
    if (suggestion.action === 'needs-review') {
      out.push(`- ${suggestion.supplementId}：需人工复核 —— ${suggestion.rationale}`);
    } else if (suggestion.action === 'confirm-singer') {
      out.push(`- ${suggestion.supplementId}：建议确认 ${suggestion.transcriptionId} 唱者为 ${suggestion.proposedSinger}（${suggestion.confidence}）`);
    } else {
      out.push(`- ${suggestion.supplementId}：佐证异文“${suggestion.form}”，记录 ${suggestion.transcriptionIds.join('、')}`);
    }
  }
  return out.join('\n');
}

async function main() {
  const command = process.argv[2] ?? 'report';
  const tables = await readMaterials();
  const archive = buildArchive(tables);
  const editor = new Editor(archive);
  editor.assessStyle();

  if (command === 'json') {
    process.stdout.write(`${JSON.stringify({
      fillerForms: archive.fillerForms,
      events: [...archive.events.values()].map(event => ({
        event: event.event,
        groups: event.groups,
        relations: event.relations,
        blockedMerges: event.blockedMerges
      })),
      comparablePairs: archive.comparablePairs,
      supplementSuggestions: editor.parseAllSupplements()
    }, null, 2)}\n`);
  } else if (command === 'report') {
    process.stdout.write(`${buildReport(archive, editor)}\n`);
  } else {
    process.stderr.write(`未知命令：${command}（可用 report | json）\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
