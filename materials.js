import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const fieldsByFile = {
  "听写.json": [
    "id",
    "event",
    "fromMs",
    "toMs",
    "recorder",
    "singer",
    "text"
  ],
  "场册.json": [
    "id",
    "event",
    "melody",
    "cast",
    "text"
  ],
  "词义札记.json": [
    "id",
    "event",
    "form",
    "gloss",
    "condition"
  ],
  "讲演安排.json": [
    "id",
    "session",
    "performanceMode",
    "cast",
    "text"
  ],
  "补录意见.json": [
    "id",
    "source",
    "addedAt",
    "text"
  ]
};
const defaultDirectory = new URL('./资料/', import.meta.url);

export async function readMaterials(directory = defaultDirectory) {
  const tables = {};
  for (const [name, fields] of Object.entries(fieldsByFile)) {
    const rows = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new TypeError(`${name} 应包含至少一条资料`);
    }
    for (const [index, row] of rows.entries()) {
      if (!row || Array.isArray(row) || typeof row !== 'object' ||
          fields.some(field => typeof row[field] !== 'string')) {
        throw new TypeError(`${name} 第 ${index + 1} 条的字段与资料约定不符`);
      }
    }
    tables[name] = rows;
  }
  return tables;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const tables = await readMaterials();
    for (const [name, rows] of Object.entries(tables)) {
      process.stdout.write(`${name} 读取 ${rows.length} 条\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
