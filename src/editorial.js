// 编校层：管理员确认、补录处理、对答完整性评估、唱法判定。
// 关键纪律：
// - 确认只收窄竞争读法，永不删除未选中的档案异文；
// - 补录只产生“建议”，须管理员确认后才生效；
// - 归属争议会改变完整性结论，补录生效后必须重判，并保留各读法下的结论。

import { findGroup, findTranscription } from './evidence.js';
import { parseOffsetMs, textSimilarity } from './text.js';

export class Editor {
  constructor(archive) {
    this.archive = archive;
    /** transcriptionId -> 已确认唱者 */
    this.singerConfirmations = new Map();
    /** transcriptionId -> 已确认词文（取自该记录自身或同组异文，不新造文本） */
    this.textConfirmations = new Map();
    /** 已处理的补录 id -> 处理结果 */
    this.supplementLog = new Map();
    /** 触发完整性重判的补录轨迹 */
    this.revisionTrail = [];
  }

  /**
   * 管理员确认某条听写记录的唱者。唱者必须是该记录已有的竞争读法之一，
   * 未选中的读法仍保留在 variants 中。
   */
  confirmSinger(transcriptionId, singer, note = '管理员确认') {
    const row = findTranscription(this.archive, transcriptionId);
    if (!row) throw new RangeError(`未找到听写记录 ${transcriptionId}`);
    const options = row.singerClaims.map(claim => claim.token);
    if (!options.includes(singer)) {
      throw new RangeError(`唱者“${singer}”不在 ${transcriptionId} 的竞争读法中：${options.join('、')}`);
    }
    const previous = this.singerConfirmations.get(transcriptionId) ?? null;
    this.singerConfirmations.set(transcriptionId, { singer, note, at: new Date().toISOString() });
    this.syncGroupSingerOptions(transcriptionId, singer);
    if (previous?.singer !== singer) {
      this.revisionTrail.push({
        kind: 'singer-confirmation',
        transcriptionId,
        from: previous?.singer ?? null,
        to: singer,
        note
      });
    }
    return this.singerConfirmations.get(transcriptionId);
  }

  confirmText(transcriptionId, text, note = '管理员确认词文') {
    const row = findTranscription(this.archive, transcriptionId);
    if (!row) throw new RangeError(`未找到听写记录 ${transcriptionId}`);
    const lookup = findGroup(this.archive, this.groupIdOf(transcriptionId));
    const allowed = lookup.group.variants.texts.map(item => item.text);
    if (!allowed.includes(text)) {
      throw new RangeError(`确认词文必须取自 ${transcriptionId} 所在组的既有异文，不得新造`);
    }
    this.textConfirmations.set(transcriptionId, { text, note, at: new Date().toISOString() });
    return this.textConfirmations.get(transcriptionId);
  }

  /** 撤回某份记录的某条读法（补录证明其不成立时使用）；记录本身与异文仍可查。 */
  withdrawReading(transcriptionId, reason) {
    const row = findTranscription(this.archive, transcriptionId);
    if (!row) throw new RangeError(`未找到听写记录 ${transcriptionId}`);
    row.status = 'withdrawn';
    this.revisionTrail.push({ kind: 'withdraw', transcriptionId, reason });
    return row;
  }

  groupIdOf(transcriptionId) {
    for (const event of this.archive.events.values()) {
      const group = event.groups.find(item => item.members.includes(transcriptionId));
      if (group) return group.id;
    }
    throw new RangeError(`记录 ${transcriptionId} 不属于任何唱句组`);
  }

  syncGroupSingerOptions(transcriptionId, singer) {
    const groupId = this.groupIdOf(transcriptionId);
    const lookup = findGroup(this.archive, groupId);
    for (const option of lookup.group.variants.singerOptions) {
      option.confirmed = option.token === singer ? true : option.confirmed;
    }
  }

  /**
   * 把补录意见解析为可执行建议。补录是自然语言，这里只提取资料本身
   * 能支撑的要素（场名、时间、原词），匹配不上就返回 needs-review。
   */
  parseSupplement(supplement) {
    const text = supplement.text;
    const eventMatch = this.archive.programs
      .map(program => program.event)
      .find(event => text.includes(event));

    // a1 式：“X 从二点三六秒起接唱，那个远字很可能是男声应答”
    const offsetMatch = text.match(/([零一二两三四五六七八九十百千]+点[零一二三四五六七八九十]+)秒起接唱/);
    if (offsetMatch && eventMatch) {
      const offsetMs = parseOffsetMs(offsetMatch[1]);
      // 补录说的是“从某时刻起接唱”，找覆盖该时刻的未定唱者记录，而非要求起点相等。
      const candidate = this.archive.transcriptions.find(row =>
        row.event === eventMatch &&
        row.fromMs <= offsetMs && offsetMs <= row.toMs &&
        row.singerClaims.some(claim => claim.gender === '男') &&
        row.singerClaims.length > 1);
      if (candidate) {
        const maleClaim = candidate.singerClaims.find(claim => claim.gender === '男');
        return {
          supplementId: supplement.id,
          action: 'confirm-singer',
          transcriptionId: candidate.id,
          proposedSinger: maleClaim.token,
          confidence: text.includes('很可能') ? 'likely' : 'asserted',
          rationale: text,
          evidence: { kind: 'supplement', source: supplement.source, addedAt: supplement.addedAt }
        };
      }
    }

    // a2 式：“我听到的是山门”——为既有异文提供佐证，不新增文本。
    // 场名可能在句中别处，按“哪个场次的记录真出现了该词形”定位。
    const heardMatch = text.match(/我听到的是(.+?)[。！]/);
    if (heardMatch) {
      const heard = heardMatch[1];
      const supporting = this.archive.transcriptions
        .filter(row => row.raw.text.includes(heard))
        .map(row => row.id);
      if (supporting.length > 0) {
        const supportingEvents = new Set(supporting.map(id =>
          findTranscription(this.archive, id).event));
        return {
          supplementId: supplement.id,
          action: 'corroborate-variant',
          form: heard,
          transcriptionIds: supporting,
          events: [...supportingEvents],
          confidence: 'asserted',
          rationale: text,
          evidence: { kind: 'supplement', source: supplement.source, addedAt: supplement.addedAt }
        };
      }
    }

    return {
      supplementId: supplement.id,
      action: 'needs-review',
      rationale: text,
      evidence: { kind: 'supplement', source: supplement.source, addedAt: supplement.addedAt }
    };
  }

  parseAllSupplements() {
    return this.archive.supplements.map(supplement => this.parseSupplement(supplement));
  }

  /** 应用建议仍需显式调用；未确认前档案维持竞争读法。 */
  applySuggestion(suggestion, note) {
    if (suggestion.action === 'confirm-singer') {
      const result = this.confirmSinger(
        suggestion.transcriptionId,
        suggestion.proposedSinger,
        note ?? `补录 ${suggestion.supplementId}（${suggestion.evidence.source}）`
      );
      this.supplementLog.set(suggestion.supplementId, {
        status: 'applied',
        action: suggestion.action,
        detail: result
      });
      this.revisionTrail.push({
        kind: 'supplement-applied',
        supplementId: suggestion.supplementId,
        transcriptionId: suggestion.transcriptionId,
        event: findTranscription(this.archive, suggestion.transcriptionId)?.event ?? null,
        effect: `确认 ${suggestion.transcriptionId} 唱者为 ${suggestion.proposedSinger}`
      });
      return result;
    }
    if (suggestion.action === 'corroborate-variant') {
      this.supplementLog.set(suggestion.supplementId, {
        status: 'noted',
        action: suggestion.action,
        detail: { form: suggestion.form, transcriptionIds: suggestion.transcriptionIds }
      });
      return this.supplementLog.get(suggestion.supplementId);
    }
    throw new RangeError(`建议 ${suggestion.supplementId} 需要人工复核，不能自动应用`);
  }

  /**
   * 唱法判定：
   * - 固定传统句候选：同一起句被两场/两份以上独立记录共同支持；
   * - 即兴唱法：仅单场出现，且补录明确说明是后来“改唱”；
   * - 证据不足一律待考，避免把较晚即兴误标为传统句。
   */
  assessStyle() {
    const groups = [...this.archive.events.values()].flatMap(event => event.groups);
    for (const group of groups) {
      const groupEvent = group.event;
      const fragmentLabels = [];
      const groupRows = group.members.map(id => findTranscription(this.archive, id));
      const groupText = groupRows.map(row => row.raw.text).join('');
      for (const fragment of groupRows.flatMap(row => row.fragments)) {
        if (!fragment.core) continue;
        const supportingRows = this.archive.transcriptions
          .filter(row => row.status !== 'withdrawn')
          .filter(row => row.fragments.some(part => part.core && (
            part.core.includes(fragment.core) || fragment.core.includes(part.core) ||
            textSimilarity(part.core, fragment.core) >= 0.6)));
        const supportingEvents = [...new Set(supportingRows.map(row => row.event))];

        // 即兴判定须有补录原话：点明本场、且改唱之词确实出现在本组。
        const improvisedNote = this.archive.supplements.find(supplement =>
          supplement.text.includes('改唱') &&
          supplement.text.includes(groupEvent) &&
          this.formsMentioned(supplement.text).some(form => groupText.includes(form)) &&
          this.formsMentioned(supplement.text).some(form => fragment.text.includes(form) || form.includes(fragment.text)));

        let label;
        const evidence = [];
        if (improvisedNote) {
          label = '即兴唱法';
          evidence.push({ kind: 'supplement', supplementId: improvisedNote.id, quote: improvisedNote.text });
        } else if (supportingEvents.length >= 2) {
          label = '固定传统句候选';
          evidence.push({
            kind: 'multi-event',
            events: supportingEvents,
            rows: [...new Set(supportingRows.map(row => row.id))]
          });
        } else {
          label = '待考';
          evidence.push({
            kind: 'insufficient-evidence',
            rows: [...new Set(supportingRows.map(row => row.id))],
            note: '仅单场依据，不得径标为固定传统句'
          });
        }
        fragmentLabels.push({ fragment: fragment.text, label, evidence });
      }
      const labels = new Set(fragmentLabels.map(item => item.label));
      let groupLabel;
      if (labels.has('即兴唱法')) {
        groupLabel = '含即兴唱法';
      } else if (labels.has('固定传统句候选')) {
        groupLabel = labels.size === 1 ? '固定传统句候选' : '含固定传统句候选（其余待考）';
      } else {
        groupLabel = '待考';
      }
      group.style = {
        label: groupLabel,
        fragmentLabels,
        evidence: fragmentLabels.flatMap(item => item.evidence)
      };
    }
  }

  formsMentioned(text) {
    const match = text.match(/改唱(.+?)[。！]/);
    return match ? [match[1]] : [];
  }

  /**
   * 对答完整性评估。按角色把同场唱句组排成对答轮次，
   * 对每条归属争议分别给出读法，绝不把各处“最可信”片段拼成不存在的演唱。
   */
  evaluateCompleteness(eventName) {
    const event = this.archive.events.get(eventName);
    if (!event) throw new RangeError(`未找到场次 ${eventName}`);
    const rowById = new Map(event.transcriptions.map(row => [row.id, row]));
    const readings = [];

    // 找出存在归属争议的记录（多唱者读法），逐读法构造轮次。
    const disputed = event.transcriptions
      .filter(row => row.singerClaims.length > 1 || this.singerConfirmations.has(row.id));
    const scenarios = this.buildScenarios(disputed);

    for (const scenario of scenarios) {
      const turns = event.groups
        .map(group => {
          const genders = new Set();
          const singers = new Set();
          const memberAssignments = [];
          let disputedWithinTurn = false;
          for (const id of group.members) {
            const row = rowById.get(id);
            if (row.status === 'withdrawn') continue;
            const assigned = this.singerConfirmations.get(id)?.singer ?? scenario.assignments[id] ?? null;
            if (row.singerClaims.length > 1 && !this.singerConfirmations.has(id)) {
              disputedWithinTurn = true;
            }
            if (assigned) {
              singers.add(assigned);
              const claim = row.singerClaims.find(c => c.token === assigned);
              if (claim?.gender) genders.add(claim.gender);
              memberAssignments.push({ transcriptionId: id, singer: assigned, gender: claim?.gender ?? null });
            } else {
              row.singerClaims.forEach(claim => {
                singers.add(claim.token);
                if (claim.gender) genders.add(claim.gender);
              });
              memberAssignments.push({ transcriptionId: id, singer: null, gender: null });
            }
          }
          return {
            groupId: group.id,
            spanMs: group.spanMs,
            genders: [...genders],
            singers: [...singers],
            functions: group.functions.map(f => f.label),
            memberAssignments,
            disputedWithinTurn
          };
        })
        .sort((a, b) => a.spanMs[0] - b.spanMs[0]);

      const orderProblems = this.detectOrderProblems(turns);
      const structuralGaps = this.detectStructuralGaps(turns);
      const hasOpening = turns.some(turn => turn.functions.includes('起兴'));
      const hasQuestion = turns.some(turn => turn.functions.includes('发问') || turn.functions.includes('起兴'));
      const hasAnswer = turns.some(turn => turn.functions.includes('应答'));

      let status;
      if (orderProblems.length > 0) {
        status = '不成立（次序倒置）';
      } else if (structuralGaps.length > 0) {
        status = '仅部分成立（归属改变后对答角色缺一）';
      } else if (hasOpening && hasQuestion && hasAnswer) {
        status = '可成立完整对答';
      } else if (hasOpening || hasAnswer) {
        status = '仅部分成立';
      } else {
        status = '证据不足';
      }
      readings.push({
        scenario: scenario.label,
        assignments: scenario.assignments,
        turns,
        orderProblems,
        structuralGaps,
        status,
        note: this.explainScenario(scenario)
      });
    }

    const statuses = new Set(readings.map(reading => reading.status));
    const overall = statuses.size === 1
      ? [...statuses][0]
      : '归属争议导致结论不一，各读法均保留';
    return {
      event: eventName,
      readings,
      overall,
      revisionTrail: this.revisionTrail.filter(item => {
        if (item.event && item.event !== eventName) return false;
        if (item.transcriptionId &&
            !event.transcriptions.some(row => row.id === item.transcriptionId)) {
          return false;
        }
        return true;
      })
    };
  }

  buildScenarios(disputed) {
    if (disputed.length === 0) {
      return [{ label: '无争议读法', assignments: {} }];
    }
    const scenarios = [];
    const walk = (index, assignments, labelParts) => {
      if (index === disputed.length) {
        scenarios.push({
          label: labelParts.join('；') || '无争议读法',
          assignments: { ...assignments }
        });
        return;
      }
      const row = disputed[index];
      const confirmed = this.singerConfirmations.get(row.id)?.singer;
      if (confirmed) {
        assignments[row.id] = confirmed;
        walk(index + 1, assignments, [...labelParts, `${row.id}=${confirmed}（已确认）`]);
        delete assignments[row.id];
        return;
      }
      for (const claim of row.singerClaims) {
        assignments[row.id] = claim.token;
        walk(index + 1, assignments, [...labelParts, `${row.id}=${claim.token}`]);
        delete assignments[row.id];
      }
    };
    walk(0, {}, []);
    return scenarios;
  }

  detectOrderProblems(turns) {
    const problems = [];
    for (let i = 1; i < turns.length; i += 1) {
      const prev = turns[i - 1];
      const current = turns[i];
      // 答句整段排在问/起句之前即为倒置；接唱允许区间重合。
      if (current.functions.includes('应答') &&
          !current.functions.includes('接唱') &&
          current.spanMs[1] <= prev.spanMs[0]) {
        problems.push({
          problem: '回答排在问题之前',
          groups: [prev.groupId, current.groupId]
        });
      }
    }
    return problems;
  }

  /**
   * 结构性缺口：归属争议落到某一读法后，若相邻轮次只剩同一性别角色，
   * 对答就缺了另一方——这正是“补录改归属后须重判完整性”的落点。
   */
  detectStructuralGaps(turns) {
    const gaps = [];
    for (let i = 1; i < turns.length; i += 1) {
      const prev = turns[i - 1];
      const current = turns[i];
      if (prev.genders.length === 1 && current.genders.length === 1 &&
          prev.genders[0] === current.genders[0]) {
        gaps.push({
          problem: `相邻轮次都只剩${prev.genders[0]}声角色，对答缺另一角色`,
          groups: [prev.groupId, current.groupId],
          assignments: [...prev.memberAssignments, ...current.memberAssignments]
        });
      }
    }
    // 组内若有成员（无论是否已确认）的归属与下一轮同性别，
    // 说明该读法下对答缺角色；确认后这成为确定结论，未确认时随竞争读法保留。
    for (const turn of turns) {
      for (const assignment of turn.memberAssignments) {
        if (assignment.singer === null) continue;
        const next = turns.find(other => other.spanMs[0] >= turn.spanMs[0] && other !== turn);
        if (next && next.genders.length === 1 && next.genders[0] === assignment.gender) {
          const confirmed = this.singerConfirmations.has(assignment.transcriptionId);
          gaps.push({
            problem: confirmed
              ? `已确认 ${assignment.transcriptionId} 为${assignment.gender}声，与下一轮同性别，对答缺另一角色`
              : `若争议记录 ${assignment.transcriptionId} 归为${assignment.gender}声，则与下一轮同性别，对答缺另一角色`,
            groups: [turn.groupId, next.groupId],
            assignments: [assignment]
          });
        }
      }
    }
    return gaps;
  }

  explainScenario(scenario) {
    const confirmed = Object.entries(scenario.assignments)
      .filter(([id]) => this.singerConfirmations.has(id))
      .map(([id, singer]) => `${id} 已确认为 ${singer}`);
    return confirmed.length > 0
      ? `基于管理员确认：${confirmed.join('，')}`
      : '未确认归属的假设读法，仅供对照';
  }
}
