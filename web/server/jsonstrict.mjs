/**
 * 严格 JSON 解析与序列化（对齐 workflow/intake.py 的 strict_load 与
 * validator/rules.py 的 _parse 语义）：
 *   - 拒绝重复键（Python object_pairs_hook 抛错）；
 *   - 拒绝 NaN / Infinity / -Infinity（parse_constant 抛错）；
 *   - 拒绝尾随内容与非标准字面量；
 *   - 小数用 JsonFloat 标记，以便像 Python 一样区分 int 与 float
 *     （deadline_days 只接受整数，2.0 必须被拒）。
 */

export class JsonFloat {
  constructor(raw) {
    this.raw = raw;
  }
  toString() {
    return this.raw;
  }
}

class Scanner {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }
  fail(message) {
    const error = new Error(`${message}（位置 ${this.pos}）`);
    error.isJsonError = true;
    throw error;
  }
  peek() {
    return this.text[this.pos];
  }
  skipSpace() {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos += 1;
      } else {
        break;
      }
    }
  }
  literal(word, value) {
    if (this.text.startsWith(word, this.pos)) {
      this.pos += word.length;
      return value;
    }
    return undefined;
  }
  value() {
    this.skipSpace();
    const ch = this.peek();
    if (ch === undefined) this.fail("JSON 意外结束");
    if (ch === "{") return this.object();
    if (ch === "[") return this.array();
    if (ch === '"') return this.string();
    let got = this.literal("true", true);
    if (got !== undefined) return got;
    got = this.literal("false", false);
    if (got !== undefined) return got;
    got = this.literal("null", null);
    if (got !== undefined) return got;
    for (const bad of ["NaN", "Infinity", "-Infinity"]) {
      if (this.text.startsWith(bad, this.pos)) this.fail("非标准常量");
    }
    return this.number();
  }
  object() {
    this.pos += 1; // {
    const result = {};
    this.skipSpace();
    if (this.peek() === "}") {
      this.pos += 1;
      return result;
    }
    for (;;) {
      this.skipSpace();
      if (this.peek() !== '"') this.fail("对象的键必须是字符串");
      const key = this.string();
      if (Object.prototype.hasOwnProperty.call(result, key)) this.fail("重复键");
      this.skipSpace();
      if (this.peek() !== ":") this.fail("缺少冒号");
      this.pos += 1;
      result[key] = this.value();
      this.skipSpace();
      const ch = this.peek();
      if (ch === ",") {
        this.pos += 1;
        continue;
      }
      if (ch === "}") {
        this.pos += 1;
        return result;
      }
      this.fail("对象缺少 , 或 }");
    }
  }
  array() {
    this.pos += 1; // [
    const result = [];
    this.skipSpace();
    if (this.peek() === "]") {
      this.pos += 1;
      return result;
    }
    for (;;) {
      result.push(this.value());
      this.skipSpace();
      const ch = this.peek();
      if (ch === ",") {
        this.pos += 1;
        continue;
      }
      if (ch === "]") {
        this.pos += 1;
        return result;
      }
      this.fail("数组缺少 , 或 ]");
    }
  }
  string() {
    this.pos += 1; // opening quote
    let out = "";
    for (;;) {
      const ch = this.text[this.pos];
      if (ch === undefined) this.fail("字符串未结束");
      if (ch === '"') {
        this.pos += 1;
        return out;
      }
      if (ch === "\\") {
        this.pos += 1;
        const esc = this.text[this.pos];
        if (esc === undefined) this.fail("转义未结束");
        const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (Object.prototype.hasOwnProperty.call(simple, esc)) {
          out += simple[esc];
          this.pos += 1;
          continue;
        }
        if (esc === "u") {
          const hex = this.text.slice(this.pos + 1, this.pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("非法的 \\u 转义");
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 5;
          continue;
        }
        this.fail("非法的转义字符");
      }
      if (ch.charCodeAt(0) < 0x20) this.fail("字符串中出现未转义的控制字符");
      out += ch;
      this.pos += 1;
    }
  }
  number() {
    const start = this.pos;
    const match = /^-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(this.text.slice(this.pos));
    if (!match) this.fail("非法字面量");
    const raw = match[0];
    this.pos += raw.length;
    const next = this.text[this.pos];
    if (next !== undefined && !/[\s,\]}]/.test(next)) this.fail("数字后出现非法字符");
    if (raw.includes(".") || raw.includes("e") || raw.includes("E")) {
      if (start === this.pos) this.fail("非法数字");
      return new JsonFloat(raw);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) this.fail("整数超出安全范围");
    return value;
  }
}

/** 解析严格 JSON；超出 maxBytes 或非法输入抛错（调用方转成契约错误码）。 */
export function strictParse(raw, maxBytes = 32768) {
  if (typeof raw !== "string") throw new Error("输入必须是 JSON 字符串");
  const size = Buffer.byteLength(raw, "utf8");
  if (size > maxBytes) throw new Error(`JSON 超过 ${maxBytes} UTF-8 字节上限`);
  const scanner = new Scanner(raw);
  const value = scanner.value();
  scanner.skipSpace();
  if (scanner.pos !== raw.length) {
    const error = new Error("JSON 存在尾随内容");
    error.isJsonError = true;
    throw error;
  }
  return value;
}

/** 规范化序列化：稳定键序、无多余空格，供服务端快照与哈希使用。 */
export function dump(value) {
  if (value instanceof JsonFloat) return value.raw;
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("非法数字");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(dump).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${dump(value[k])}`).join(",")}}`;
  }
  throw new Error("不支持的值类型");
}

/** 与 Python 一致的 UTF-8 字节长度。 */
export function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

/** 码点数（用于 1000 码点上限，不能用 .length 代替）。 */
export function codePointLength(text) {
  return [...text].length;
}
