// 文本层：只做可机械核验的处理，不解释唱句含义。
// 所有原始字符串都在证据层原样保留，这里的规范化仅用于比较。

const PUNCTUATION = /[，。、；：？！,.!?;:"“”‘’「」『』（）()\s]/g;
const FRAGMENT_RE = /[^，。、；：？！,.!?;:"“”‘’「」『』（）()\s]+/g;

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/**
 * 按标点切分原文片段，保留字符偏移，便于以“记录编号 + 文本范围”定位。
 * @param {string} text
 * @returns {{text:string,start:number,end:number}[]}
 */
export function splitFragments(text) {
  const parts = [];
  FRAGMENT_RE.lastIndex = 0;
  let match;
  while ((match = FRAGMENT_RE.exec(text)) !== null) {
    parts.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return parts;
}

export function stripPunctuation(text) {
  return text.replace(PUNCTUATION, '');
}

/**
 * 去掉衬词与标点后的核心唱词。衬词表来自词义札记，而不是硬编码判断。
 * @param {string} text
 * @param {string[]} fillerForms
 */
export function normalizeText(text, fillerForms = []) {
  let out = text;
  for (const filler of fillerForms) {
    out = out.split(filler).join('');
  }
  return stripPunctuation(out);
}

/** 最长公共子序列长度（唱词都很短，无需复杂算法）。 */
export function lcsLength(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** 基于 LCS 的相似度，0–1。 */
export function textSimilarity(a, b) {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return lcsLength(a, b) / max;
}

export function containsText(haystack, needle) {
  return needle.length > 0 && haystack.includes(needle);
}

/** 解析“二十秒”“二点三六秒”“30秒”这类资料内写法，返回毫秒。 */
export function parseOffsetMs(token) {
  if (/^\d+(\.\d+)?$/.test(token)) return Math.round(Number(token) * 1000);
  const [integerPart, decimalPart = ''] = token.split('点');
  let integer = 0;
  let section = 0;
  for (const ch of integerPart) {
    if (ch === '十') {
      section = (section || 1) * 10;
      integer += section;
      section = 0;
    } else if (ch === '百') {
      section = (section || 1) * 100;
      integer += section;
      section = 0;
    } else {
      section = CN_DIGITS[ch] ?? 0;
    }
  }
  integer += section;
  let fraction = 0;
  for (const ch of decimalPart) {
    fraction = fraction * 10 + (CN_DIGITS[ch] ?? 0);
  }
  const decimal = decimalPart ? fraction / 10 ** decimalPart.length : 0;
  return Math.round((integer + decimal) * 1000);
}

/** 解析“限二十秒”之类的时长限制，返回毫秒；找不到返回 null。 */
export function parseLimitMs(text) {
  const match = text.match(/限([零一二两三四五六七八九十百千\d]+(?:点[零一二三四五六七八九十\d]+)?)秒/);
  return match ? parseOffsetMs(match[1]) : null;
}
