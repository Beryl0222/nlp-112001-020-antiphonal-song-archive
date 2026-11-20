// 节目层：教员选段配解说，馆方发布版本并保留勘误链路。
// 三种卡：现场实录（单场证据内重演）、跨场比较（并列不合并）、单句档案。
// 共同纪律：不抹掉档案异文；证据不足只保留能成立的部分，绝不拼造演唱。

import { findGroup, findTranscription } from './evidence.js';
import { parseLimitMs } from './text.js';

function baseCard({ kind, title, plan, sources }) {
  return {
    cardType: kind,
    title,
    session: plan?.session ?? null,
    performanceMode: plan?.performanceMode ?? kind,
    cast: plan?.cast ?? '',
    explanations: [],
    sources,
    warnings: [],
    erratumFor: null,
    publishedAt: null,
    version: null
  };
}

function castTokens(plan) {
  return new Set(
    (plan?.cast ?? '')
      .split(/[、,，\s]+/)
      .map(token => token.trim())
      .filter(Boolean)
  );
}

function groupSingers(group) {
  return new Set(group.variants.singerOptions.map(option => option.token));
}

/**
 * 实录重演卡：只能取自同一场证据，保持角色、顺序、原词。
 * 争议组原样带上竞争读法；时长超出安排上限给出警告。
 */
export function buildReenactmentCard(archive, editor, { event, planId, title }) {
  const eventNode = archive.events.get(event);
  if (!eventNode) throw new RangeError(`未找到场次 ${event}`);
  const plan = archive.lecturePlans.find(item => item.id === planId);
  if (!plan) throw new RangeError(`未找到讲演安排 ${planId}`);
  if (plan.performanceMode !== '实录重演') {
    throw new RangeError(`安排 ${planId} 的模式是 ${plan.performanceMode}，不能出实录重演卡`);
  }

  const card = baseCard({
    kind: '现场实录',
    title: title ?? `${event}·实录重演`,
    plan,
    sources: [{ kind: 'event', event }, { kind: 'plan', id: planId }]
  });
  const allowed = castTokens(plan);

  card.entries = eventNode.groups
    .sort((a, b) => a.spanMs[0] - b.spanMs[0] || a.spanMs[1] - b.spanMs[1])
    .map(group => {
      const singers = groupSingers(group);
      const offCast = [...singers].filter(singer => !allowed.has(singer));
      const eligible = offCast.length === 0;
      if (offCast.length > 0) {
        card.warnings.push({
          groupId: group.id,
          warning: `唱者 ${offCast.join('、')} 不在本场登台名单 ${plan.cast} 内，相关异文列档但该唱者不登台`
        });
      }
      return {
        groupId: group.id,
        order: group.spanMs,
        eligible,
        functions: group.functions.map(item => item.label),
        style: group.style.label,
        // 档案异文全量保留，编排选择不得抹掉
        variants: group.variants.recorderReadings.map(reading => ({
          recorder: reading.recorder,
          text: reading.text,
          transcriptionIds: reading.transcriptionIds,
          continuousChain: reading.continuousChain
        })),
        competingSingers: group.variants.singerOptions.map(option => ({
          singer: option.token,
          gender: option.gender,
          confirmed: option.confirmed,
          supportedBy: option.supportedBy
        })),
        confirmedText: pickConfirmedText(editor, group)
      };
    });

  card.totalSpanMs = eventNode.groups.reduce(
    (max, group) => Math.max(max, group.spanMs[1]), 0) -
    eventNode.groups.reduce((min, group) => Math.min(min, group.spanMs[0]), Number.POSITIVE_INFINITY);
  const limitMs = parseLimitMs(plan.text);
  card.timeLimitMs = limitMs;
  if (limitMs !== null && card.totalSpanMs > limitMs) {
    card.warnings.push({
      warning: `选段总时长 ${card.totalSpanMs}ms 超出安排上限 ${limitMs}ms`
    });
  }

  const completeness = editor.evaluateCompleteness(event);
  card.completeness = completeness.overall;
  card.completenessReadings = completeness.readings.map(reading => ({
    scenario: reading.scenario,
    status: reading.status,
    orderProblems: reading.orderProblems,
    structuralGaps: reading.structuralGaps
  }));
  if (completeness.overall.includes('争议') || completeness.overall.includes('部分') ||
      completeness.overall.includes('不足')) {
    card.warnings.push({
      warning: '证据不足以串成完整对答，只保留能成立的部分，不得跨场拼造',
      completeness: completeness.overall
    });
  }
  card.explanations.push({
    text: eventNode.program?.text ?? '',
    sourceId: eventNode.program?.id ?? null
  });
  return card;
}

function pickConfirmedText(editor, group) {
  const confirmed = [];
  for (const id of group.members) {
    const text = editor.textConfirmations.get(id)?.text;
    const singer = editor.singerConfirmations.get(id)?.singer;
    if (text || singer) {
      confirmed.push({ transcriptionId: id, confirmedText: text ?? null, confirmedSinger: singer ?? null });
    }
  }
  return confirmed;
}

/**
 * 跨场对照卡：并列同一问句的不同回答，明确标注不是一场重演。
 */
export function buildCrossEventCard(archive, editor, { planId, title }) {
  const plan = archive.lecturePlans.find(item => item.id === planId);
  if (!plan) throw new RangeError(`未找到讲演安排 ${planId}`);
  if (plan.performanceMode !== '跨场对照') {
    throw new RangeError(`安排 ${planId} 的模式是 ${plan.performanceMode}，不能出跨场对照卡`);
  }
  const card = baseCard({
    kind: '跨场比较',
    title: title ?? '同句异答·跨场对照',
    plan,
    sources: [{ kind: 'plan', id: planId }, ...archive.comparablePairs.flatMap(pair =>
      pair.events.map(event => ({ kind: 'event', event })))]
  });
  const allowed = castTokens(plan);

  card.columns = archive.comparablePairs.map(pair => ({
    relation: pair.label,
    events: pair.events,
    perEvent: pair.events.map(event => {
      const eventNode = archive.events.get(event);
      const singersOnEvent = new Set();
      const perGroup = eventNode.groups
        .slice()
        .sort((a, b) => a.spanMs[0] - b.spanMs[0] || a.spanMs[1] - b.spanMs[1])
        .map(group => {
          const singers = groupSingers(group);
          singers.forEach(singer => singersOnEvent.add(singer));
          const offCast = [...singers].filter(singer => !allowed.has(singer));
          return {
            event,
            groupId: group.id,
            comparableOpening: pair.groupIds.includes(group.id),
            eligible: offCast.length === 0,
            offCast,
            order: group.spanMs,
            functions: group.functions.map(item => item.label),
            style: group.style.label,
            variants: group.variants.recorderReadings.map(reading => ({
              recorder: reading.recorder,
              text: reading.text,
              transcriptionIds: reading.transcriptionIds
            })),
            competingSingers: group.variants.singerOptions
          };
        });
      const offCast = [...singersOnEvent].filter(singer => !allowed.has(singer));
      if (offCast.length > 0) {
        card.warnings.push({
          event,
          warning: `对照唱者 ${offCast.join('、')} 不在晚场登台名单 ${plan.cast} 内，列档但不登台`
        });
      }
      return {
        event,
        glossary: eventNode.glossary.map(item => ({
          form: item.form,
          gloss: item.gloss,
          condition: item.condition,
          sourceId: item.id
        })),
        groups: perGroup
      };
    })
  }));
  card.notARecreation = true;
  card.explanations.push({
    text: '两个答句回应可比较的开头；并列展示，讲解按舞台实际听见的顺序，禁止合并为一场重演',
    sourceId: planId
  });
  return card;
}

/** 单句档案卡：围绕一条听写记录给出全部异文、争议与札记，不强行编入对答。 */
export function buildSingleUtteranceCard(archive, editor, { transcriptionId, title }) {
  const row = findTranscription(archive, transcriptionId);
  if (!row) throw new RangeError(`未找到听写记录 ${transcriptionId}`);
  const groupId = editor.groupIdOf(transcriptionId);
  const lookup = findGroup(archive, groupId);
  const { event, group } = lookup;

  const card = baseCard({
    kind: '单句档案',
    title: title ?? `单句档案·${transcriptionId}`,
    plan: null,
    sources: [
      { kind: 'transcription', id: transcriptionId },
      { kind: 'event', event: event.event },
      { kind: 'program', id: event.program?.id ?? null }
    ]
  });
  card.transcriptionId = transcriptionId;
  card.groupId = groupId;
  card.raw = row.raw;
  card.status = row.status;
  card.timeRange = { fromMs: row.fromMs, toMs: row.toMs };
  card.competingSingers = row.singerClaims.map(claim => ({
    ...claim,
    confirmed: editor.singerConfirmations.get(transcriptionId)?.singer === claim.token
  }));
  card.groupVariants = group.variants;
  card.functions = group.functions;
  card.style = group.style;
  card.glossary = event.glossary;
  card.blockedMerges = event.blockedMerges.filter(block =>
    block.a === transcriptionId || block.b === transcriptionId);
  card.explanations.push({
    text: '单句证据独立成卡；归属未定前保留全部竞争读法，不替读者选定唱者或词文',
    sourceId: null
  });
  return card;
}

/**
 * 节目版本登记处：发布后冻结快照，勘误以新版本替代并保留可查链路。
 */
export class ProgramRegistry {
  constructor() {
    this.published = new Map();
    this.errata = [];
    this.sequence = 0;
  }

  publish(card) {
    this.sequence += 1;
    const version = `v${this.sequence}`;
    const frozen = structuredClone({
      ...card,
      version,
      publishedAt: new Date().toISOString()
    });
    this.published.set(version, frozen);
    return frozen;
  }

  get(version) {
    const card = this.published.get(version);
    return card ? structuredClone(card) : null;
  }

  list() {
    return [...this.published.values()].map(card => ({
      version: card.version,
      cardType: card.cardType,
      title: card.title,
      publishedAt: card.publishedAt,
      erratumFor: card.erratumFor
    }));
  }

  /** 勘误：以新卡替代旧版本，旧版本仍可查，并登记差异说明。 */
  publishErratum({ replacesVersion, newCard, changeNote }) {
    const previous = this.published.get(replacesVersion);
    if (!previous) throw new RangeError(`待勘误版本 ${replacesVersion} 不存在`);
    this.sequence += 1;
    const version = `v${this.sequence}`;
    const frozen = structuredClone({
      ...newCard,
      version,
      publishedAt: new Date().toISOString(),
      erratumFor: replacesVersion
    });
    this.published.set(version, frozen);
    this.errata.push({
      replaces: replacesVersion,
      replacement: version,
      changeNote,
      at: frozen.publishedAt
    });
    return frozen;
  }

  errataFor(version) {
    return this.errata.filter(item => item.replaces === version || item.replacement === version);
  }

  /**
   * 勘误后核对：卡片所举变体是否仍有“有效（未撤回）”记录支持。
   * 补录若使某变体失去依据，这里必须报出，而不是悄悄删掉。
   */
  checkVariants(archive, card) {
    const problems = [];
    const activeIds = new Set(
      archive.transcriptions.filter(row => row.status === 'active').map(row => row.id));
    const groups = collectCardGroupIds(card);
    for (const reference of groups) {
      const lookup = findGroup(archive, reference.groupId);
      if (!lookup) {
        problems.push({ groupId: reference.groupId, problem: '唱句组已不存在' });
        continue;
      }
      for (const reading of reference.variantRefs) {
        const unsupported = reading.transcriptionIds.filter(id => !activeIds.has(id));
        if (unsupported.length === reading.transcriptionIds.length) {
          problems.push({
            groupId: reference.groupId,
            variant: reading.text,
            problem: '该变体的全部记录均已撤回，对照页不再有有效依据',
            transcriptionIds: reading.transcriptionIds
          });
        } else if (unsupported.length > 0) {
          problems.push({
            groupId: reference.groupId,
            variant: reading.text,
            problem: '部分依据记录已撤回，异文降级存查',
            withdrawn: unsupported
          });
        }
      }
    }
    return { ok: problems.length === 0, problems };
  }
}

function collectCardGroupIds(card) {
  const refs = [];
  if (card.cardType === '现场实录') {
    for (const entry of card.entries ?? []) {
      refs.push({
        groupId: entry.groupId,
        variantRefs: entry.variants.map(v => ({ text: v.text, transcriptionIds: v.transcriptionIds }))
      });
    }
  } else if (card.cardType === '跨场比较') {
    for (const column of card.columns ?? []) {
      for (const item of column.perEvent ?? []) {
        for (const group of item.groups ?? []) {
          refs.push({
            groupId: group.groupId,
            variantRefs: group.variants.map(v => ({ text: v.text, transcriptionIds: v.transcriptionIds }))
          });
        }
      }
    }
  } else if (card.cardType === '单句档案') {
    if (card.groupId) {
      refs.push({
        groupId: card.groupId,
        variantRefs: card.groupVariants.recorderReadings.map(v => ({
          text: v.text,
          transcriptionIds: v.transcriptionIds
        }))
      });
    }
  }
  return refs.filter(ref => ref.groupId);
}
