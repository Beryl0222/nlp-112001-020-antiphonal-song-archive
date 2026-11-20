# 花儿对唱校录中的唱段变体识别

对唱实录与词义档案采用 UTF-8 编码，人物、单位和记录均为合成内容。

| 资料 | 字段 |
| --- | --- |
| `资料/听写.json` | `id`、`event`、`fromMs`、`toMs`、`recorder`、`singer`、`text` |
| `资料/场册.json` | `id`、`event`、`melody`、`cast`、`text` |
| `资料/词义札记.json` | `id`、`event`、`form`、`gloss`、`condition` |
| `资料/讲演安排.json` | `id`、`session`、`performanceMode`、`cast`、`text` |
| `资料/补录意见.json` | `id`、`source`、`addedAt`、`text` |

每份资料是 JSON 数组。记录中的字段值按来源原样保留为字符串，逗号和顿号可以属于字段内容。资料中可能有转述、不同的拼写以及较晚录入的更正。数字及日期在这些文件中沿用各资料自身的含义；原文位置以记录编号及文本范围定位。

Node.js 22 环境下运行以下命令可安装锁定的项目环境、检查素材格式并读取各类资料的数量。

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run materials
```

`readMaterials` 只读取资料，不解析其中的正文含义。

## 编校工具

`src/` 在不改写资料原值的前提下，把五份资料组织成带出处的证据图，供实录重演、跨场对照与单句档案三类编校使用。

| 模块 | 职责 |
| --- | --- |
| `src/text.js` | 标点切分（保留偏移）、衬词剥离、LCS 相似度、中文时间与“限二十秒”解析 |
| `src/evidence.js` | 场册角色映射、同场唱句分组、异文与连续转写链、句间关系、跨场可对照索引 |
| `src/editorial.js` | 管理员确认、补录建议与生效、唱法判定、对答完整性逐读法评估 |
| `src/program.js` | 三类演出卡、登台名单校验、版本发布与勘误、变体依据核对 |
| `src/cli.js` | `report` 人读摘要、`json` 完整证据图；只读，不写资料文件 |

```sh
npm test           # 32 项编校规则测试
npm run report     # 证据图人读摘要
npm run archive:json
```

### 工具所固化的编校纪律

1. **时间重合只是线索。** 任何句间关系都另有唱词、场册角色或补录原话作依据；女声起句与男声应答即使时间重合也禁止并组，阻断原因写入 `blockedMerges`。
2. **分组不跨场。** 同句的多份转写只在同一场内并组；跨场同词只登记为“可对照”，跨场卡并列展示且标注 `notARecreation`，不能当成一场重演。
3. **竞争读法不收敛为单一答案。** “阿麦或舟禾”式未定唱者、`川门/山门` 式异文、`阿咧/啊咧` 式衬词异写全部保留；管理员确认只能收窄、不能删除未选中的读法，且确认值必须取自既有记录。
4. **衬词不进诗行。** 衬词表来自词义札记（含“也记为”异写），核心唱词单独保存，原文字段原样不动。
5. **补录只产生建议。** 自然语言补录解析为带出处的 `suggestion`，须管理员显式确认才生效；生效后完整性自动重判，重判轨迹进入 `revisionTrail`。
6. **完整性按读法分别给结论。** 归属争议下逐种假设构造轮次；证据不足时保留“能成立的部分”，不把各场最可信片段拼成不存在的演唱。次序守卫会拦截“回答排在问题前”的编排，接唱的区间重合不误报。
7. **唱法不冒标。** 跨两场独立共见的片段才列“固定传统句候选”；补录原话点明“改唱”的才标“即兴唱法”；其余一律“待考”。
8. **节目卡可溯源、可勘误。** 发布即冻结快照并编号版本；勘误以新版本替代、旧版本仍可查；撤回记录后用 `checkVariants` 核对对照页变体是否仍有有效依据，失去依据的异文报出而非删除。
9. **登台约束前置。** 教员按演出时段与可登台唱者选段，名单外唱者触发警告并标 `eligible:false`，相关异文仍随卡列档。

### 关键数据入口

- `buildArchive(tables)`：证据图，含 `events[].groups`（异文、唱者竞争读法、功能、唱法）、`events[].relations`、`blockedMerges`、`comparablePairs`。
- `Editor`：`confirmSinger` / `confirmText` / `withdrawReading` / `parseAllSupplements` / `applySuggestion` / `assessStyle` / `evaluateCompleteness(event)`。
- `buildReenactmentCard` / `buildCrossEventCard` / `buildSingleUtteranceCard` 与 `ProgramRegistry`（`publish` / `publishErratum` / `checkVariants`）。
