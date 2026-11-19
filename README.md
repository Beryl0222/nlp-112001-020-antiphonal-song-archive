# 花儿对唱校录中的唱段变体识别

对唱实录与词义档案采用 UTF-8 编码，人物、单位和记录均为合成内容。

| 资料 | 字段 |
| --- | --- |
| `资料/听写.json` | `id`、`event`、`fromMs`、`toMs`、`recorder`、`singer`、`text` |
| `资料/场册.json` | `id`、`event`、`melody`、`cast`、`text` |
| `资料/词义札记.json` | `id`、`event`、`form`、`gloss`、`condition` |

每份资料是 JSON 数组。记录中的字段值按来源原样保留为字符串，逗号和顿号可以属于字段内容。资料中可能有转述、不同的拼写以及较晚录入的更正。数字及日期在这些文件中沿用各资料自身的含义；原文位置以记录编号及文本范围定位。

Node.js 22 环境下运行以下命令可安装锁定的项目环境、检查素材格式并读取各类资料的数量。

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run materials
```

`readMaterials` 只读取资料，不解析其中的正文含义。
