// 证据层：把五份资料组织为带出处的证据图。
// 规则要点：
// - 时间重合只作为线索，任何关系都必须另有唱词、角色或原话依据；
// - 分组（同一唱句的多份记录）只限同一场；跨场同词只建“可对照”，绝不合并；
// - 资料原值全部保留，派生判断带 evidence 出处。

import {
  containsText,
  normalizeText,
  splitFragments,
  textSimilarity
} from './text.js';

const GENDER_BY_ROLE = { 女: '女', 男: '男' };
const SIMILAR_THRESHOLD = 0.5;

/** 解析“女甲 阿麦、男乙 舟禾”式场册唱者串，并建立唱者→性别映射。 */
export function parseCast(castText) {
  const tokens = [];
  const genderByName = new Map();
  for (const chunk of castText.split(/[、,，]/)) {
    const parts = chunk.trim().split(/\s+/).filter(Boolean);
    let chunkGender = null;
    for (const part of parts) {
      const gender = resolveGenderFromToken(part);
      if (gender) chunkGender = gender;
    }
    for (const part of parts) {
      const gender = resolveGenderFromToken(part);
      tokens.push({ token: part, gender });
      if (!gender && chunkGender) genderByName.set(part, chunkGender);
    }
  }
  return { tokens, genderByName };
}

export function resolveGenderFromToken(token) {
  return GENDER_BY_ROLE[token[0]] ?? null;
}

/** “阿麦或舟禾”式未定唱者拆成竞争读法。 */
export function parseSingerClaim(singerText) {
  return singerText
    .split(/或|\/|、|,/)
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => ({ token, gender: resolveGenderFromToken(token) }));
}

/** 衬词表来自词义札记（含“也记为X”的异写），不硬编码判断。 */
export function collectFillerForms(glossary) {
  const forms = new Set();
  for (const row of glossary) {
    if (!row.gloss.includes('衬词') && !row.gloss.includes('无实义')) continue;
    forms.add(row.form);
    const also = row.condition.match(/也记为([^，。、\s]+)/);
    if (also) forms.add(also[1]);
  }
  return [...forms];
}

function overlapsOrTouches(a, b) {
  return a.fromMs <= b.toMs && b.fromMs <= a.toMs;
}

export function overlapDuration(a, b) {
  return Math.max(0, Math.min(a.toMs, b.toMs) - Math.max(a.fromMs, b.fromMs));
}

function buildTranscriptions(rows, fillerForms) {
  return rows.map(row => {
    const fragments = splitFragments(row.text).map(part => {
      const core = normalizeText(part.text, fillerForms);
      return {
        ...part,
        core,
        hasFiller: core.length < part.text.length
      };
    });
    return {
      id: row.id,
      event: row.event,
      fromMs: Number(row.fromMs),
      toMs: Number(row.toMs),
      recorder: row.recorder,
      raw: row,
      singerClaims: parseSingerClaim(row.singer),
      genderHints: [], // 在场册映射后填充
      fragments,
      core: normalizeText(row.text, fillerForms),
      status: 'active' // active | withdrawn；补录可撤回某份记录的读法
    };
  });
}

/** 札记同场异文（如川门/山门）可解释两份转写的用字差异。 */
function glossarySwapForms(glossary, event) {
  const forms = glossary
    .filter(row => row.event === event)
    .map(row => row.form)
    .filter(form => form.length >= 2);
  return forms;
}

function explainedByGlossarySwap(a, b, forms) {
  const usedByA = forms.filter(form => a.raw.text.includes(form));
  const usedByB = forms.filter(form => b.raw.text.includes(form));
  return usedByA.some(form => usedByB.some(other => other !== form)) &&
    (usedByA.length > 0 || usedByB.length > 0);
}

function compatibleText(a, b, forms) {
  return containsText(a.core, b.core) ||
    containsText(b.core, a.core) ||
    textSimilarity(a.core, b.core) >= SIMILAR_THRESHOLD ||
    explainedByGlossarySwap(a, b, forms);
}

/**
 * 同场分组：时间相邻/重合（线索）+ 唱词相容（包含、高相似或札记异文）。
 * 组件级性别冲突阻断：未定唱者（r3）不能充当桥，把女声起句与男声应答并成一组。
 */
function clusterSameEvent(utterances, forms) {
  const parent = utterances.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const blocked = [];

  const confidentGenders = (index) => {
    const row = utterances[index];
    const genders = new Set(row.singerClaims.map(claim => claim.gender).filter(Boolean));
    return genders.size === 1 ? [...genders] : [];
  };
  const componentGenders = (root) => {
    const set = new Set();
    utterances.forEach((_, index) => {
      if (find(index) === root) confidentGenders(index).forEach(g => set.add(g));
    });
    return [...set];
  };

  for (let i = 0; i < utterances.length; i += 1) {
    for (let j = i + 1; j < utterances.length; j += 1) {
      const a = utterances[i];
      const b = utterances[j];
      if (!overlapsOrTouches(a, b)) continue;
      if (!compatibleText(a, b, forms)) continue;
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI === rootJ) continue;
      const gi = componentGenders(rootI);
      const gj = componentGenders(rootJ);
      if (gi.length === 1 && gj.length === 1 && gi[0] !== gj[0]) {
        blocked.push({
          a: a.id,
          b: b.id,
          reason: '两组分别有明确的女声/男声角色，时间重合只作线索，禁止并组'
        });
        continue;
      }
      parent[rootI] = rootJ;
    }
  }

  const buckets = new Map();
  utterances.forEach((row, index) => {
    const root = find(index);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(row);
  });
  return { groups: [...buckets.values()], blocked };
}

function buildVariants(members) {
  // 同一记录员的多条记录可按时间首尾拼成连续转写；不同记录员互为异文。
  const byRecorder = new Map();
  for (const member of members) {
    if (!byRecorder.has(member.recorder)) byRecorder.set(member.recorder, []);
    byRecorder.get(member.recorder).push(member);
  }
  const recorderReadings = [];
  for (const [recorder, rows] of byRecorder) {
    const ordered = [...rows].sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);
    const continuous = ordered.slice(1).every((row, index) =>
      row.fromMs <= ordered[index].toMs &&
      ordered.slice(0, index + 1).every(prev => overlapDuration(prev, row) === 0));
    recorderReadings.push({
      recorder,
      transcriptionIds: ordered.map(row => row.id),
      text: ordered.map(row => row.raw.text).join(''),
      continuousChain: continuous,
      spanMs: [
        Math.min(...ordered.map(row => row.fromMs)),
        Math.max(...ordered.map(row => row.toMs))
      ]
    });
  }
  const singerOptions = new Map();
  for (const member of members) {
    for (const claim of member.singerClaims) {
      if (!singerOptions.has(claim.token)) {
        singerOptions.set(claim.token, {
          token: claim.token,
          gender: claim.gender,
          supportedBy: [],
          confirmed: false
        });
      }
      singerOptions.get(claim.token).supportedBy.push(member.id);
    }
  }
  return {
    recorderReadings,
    singerOptions: [...singerOptions.values()],
    texts: members.map(member => ({
      transcriptionId: member.id,
      text: member.raw.text,
      core: member.core,
      status: member.status
    }))
  };
}

/**
 * @param {object} tables readMaterials 的返回值
 */
export function buildArchive(tables) {
  const glossary = tables['词义札记.json'];
  const fillerForms = collectFillerForms(glossary);
  const transcriptions = buildTranscriptions(tables['听写.json'], fillerForms);

  const events = new Map();
  for (const row of tables['场册.json']) {
    const cast = parseCast(row.cast);
    events.set(row.event, {
      event: row.event,
      program: row,
      cast,
      transcriptions: [],
      groups: [],
      blockedMerges: [],
      relations: [],
      glossary: glossary.filter(item => item.event === row.event)
    });
  }
  for (const utterance of transcriptions) {
    if (!events.has(utterance.event)) {
      events.set(utterance.event, {
        event: utterance.event,
        program: null,
        cast: parseCast(''),
        transcriptions: [],
        groups: [],
        blockedMerges: [],
        relations: [],
        glossary: glossary.filter(item => item.event === utterance.event)
      });
    }
    events.get(utterance.event).transcriptions.push(utterance);
  }

  // 用场册唱者→性别映射补全听写记录的性别线索。
  for (const event of events.values()) {
    for (const utterance of event.transcriptions) {
      utterance.singerClaims = utterance.singerClaims.map(claim => ({
        ...claim,
        gender: claim.gender ?? event.cast.genderByName.get(claim.token) ?? null
      }));
      utterance.genderHints = [...new Set(
        utterance.singerClaims.map(claim => claim.gender).filter(Boolean)
      )];
    }
  }

  for (const event of events.values()) {
    const forms = glossarySwapForms(glossary, event.event);
    const { groups, blocked } = clusterSameEvent(event.transcriptions, forms);
    event.blockedMerges = blocked;
    event.groups = groups
      .map(members => ({
        id: `G:${event.event}:${Math.min(...members.map(m => m.fromMs))}:${members.map(m => m.id).sort().join('+')}`,
        event: event.event,
        spanMs: [
          Math.min(...members.map(m => m.fromMs)),
          Math.max(...members.map(m => m.toMs))
        ],
        members: members.map(m => m.id),
        variants: buildVariants(members),
        functions: [],
        style: { label: '待考', fragmentLabels: [], evidence: [] }
      }))
      .sort((a, b) => a.spanMs[0] - b.spanMs[0] || a.spanMs[1] - b.spanMs[1]);

    annotateFunctions(event);
    buildRelations(event);
  }

  const comparablePairs = buildComparablePairs(events);

  return {
    fillerForms,
    transcriptions,
    events,
    glossary,
    programs: tables['场册.json'],
    lecturePlans: tables['讲演安排.json'],
    supplements: tables['补录意见.json'],
    comparablePairs
  };
}

function annotateFunctions(event) {
  const groups = event.groups;
  const rowById = new Map(event.transcriptions.map(row => [row.id, row]));
  groups.forEach((group, index) => {
    const add = (label, evidence) => group.functions.push({ label, evidence });
    if (index === 0) {
      add('起兴', {
        kind: 'program-note',
        sourceId: event.program?.id ?? null,
        quote: event.program?.text ?? '',
        note: '场册记为起句'
      });
    }
    const memberRows = group.members.map(id => rowById.get(id));
    if (memberRows.some(row => row.fragments.some(part => part.hasFiller))) {
      add('起兴', {
        kind: 'glossary',
        sourceIds: event.glossary
          .filter(g => g.gloss.includes('衬词') || g.gloss.includes('无实义'))
          .map(g => g.id),
        note: '句首衬词，札记注明无实义，不应写入诗行正文'
      });
    }
    const genders = new Set(memberRows.flatMap(row => row.genderHints));
    if (genders.has('男') && index > 0) {
      add('应答', {
        kind: 'program-note+cast',
        sourceId: event.program?.id ?? null,
        note: '场册载男乙于上句末开始应答，且组内有男声角色'
      });
    }
    const overlapsEarlier = groups.slice(0, index).some(earlier =>
      earlier.spanMs[1] > group.spanMs[0] && earlier.spanMs[0] < group.spanMs[1]);
    if (overlapsEarlier) {
      add('接唱', {
        kind: 'timing+program-note',
        sourceId: event.program?.id ?? null,
        note: '时间区间与上句末重合，场册明示可在上句末起接；时间仅为线索，另有角色依据'
      });
    }
    const earlierCores = groups
      .slice(0, index)
      .flatMap(g => g.members.map(id => rowById.get(id).core));
    const echoes = memberRows
      .flatMap(row => row.fragments)
      .filter(part => part.core && earlierCores.some(core =>
        containsText(core, part.core) || containsText(part.core, core)));
    if (echoes.length > 0) {
      add('复述', {
        kind: 'text-echo',
        fragments: echoes.map(part => part.text),
        note: '后句复述上句唱词；女声复述不得误作男声完整应答'
      });
    }
    if (group.functions.length === 0) {
      add('发问', { kind: 'position', note: '位于对答序列前段且无其他功能证据，按发问候选保留' });
    }
  });
}

function buildRelations(event) {
  const rows = event.transcriptions;
  const relations = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (overlapDuration(a, b) <= 0) continue;
      const sameGroup = event.groups.some(group => group.members.includes(a.id) && group.members.includes(b.id));
      if (sameGroup) continue;
      const aGenders = new Set(a.genderHints);
      const bGenders = new Set(b.genderHints);
      let label;
      const basis = ['时间区间重合（仅作线索）'];
      if (aGenders.has('女') && bGenders.has('男')) {
        label = '应答';
        basis.push('角色顺序：女声起句在前，男声应答在后');
      } else if (aGenders.has('男') && bGenders.has('女')) {
        label = '应答（顺序存疑）';
        basis.push('男声记录在前、女声记录在后，需人工复核次序');
      } else {
        label = '接唱';
        basis.push('唱者未定，按接唱候选保留');
      }
      if (containsText(a.core, b.core) || containsText(b.core, a.core) ||
          textSimilarity(a.core, b.core) >= SIMILAR_THRESHOLD) {
        basis.push('唱词存在复述/包含关系');
      }
      relations.push({
        from: a.id,
        to: b.id,
        label,
        timingClueOnly: true,
        basis,
        evidence: {
          kind: 'timing+text+cast',
          spans: [[a.fromMs, a.toMs], [b.fromMs, b.toMs]],
          programId: event.program?.id ?? null
        }
      });
    }
  }
  for (const block of event.blockedMerges) {
    relations.push({
      from: block.a,
      to: block.b,
      label: '竞争归属（禁止并组）',
      timingClueOnly: true,
      basis: [block.reason, '需管理员确认唱者，未定前保留竞争读法'],
      evidence: { kind: 'blocked-merge' }
    });
  }
  event.relations = relations;
}

/** 跨场同词只建立“可对照”，绝不当作同一场记录。 */
function buildComparablePairs(events) {
  const pairs = [];
  const list = [...events.values()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      for (const ga of a.groups) {
        for (const gb of b.groups) {
          const coresA = ga.members.map(id => a.transcriptions.find(r => r.id === id).core);
          const coresB = gb.members.map(id => b.transcriptions.find(r => r.id === id).core);
          const similar = coresA.some(ca =>
            coresB.some(cb => containsText(ca, cb) || containsText(cb, ca) ||
              textSimilarity(ca, cb) >= SIMILAR_THRESHOLD));
          if (similar) {
            pairs.push({
              events: [a.event, b.event],
              groupIds: [ga.id, gb.id],
              label: '可对照开头（跨场，禁止合并重演）',
              evidence: {
                kind: 'cross-event-text',
                note: '场册注明开头相似但记录的是另一场回应'
              }
            });
          }
        }
      }
    }
  }
  return pairs;
}

export function findTranscription(archive, id) {
  return archive.transcriptions.find(row => row.id === id) ?? null;
}

export function findGroup(archive, groupId) {
  for (const event of archive.events.values()) {
    const group = event.groups.find(candidate => candidate.id === groupId);
    if (group) return { event, group };
  }
  return null;
}
