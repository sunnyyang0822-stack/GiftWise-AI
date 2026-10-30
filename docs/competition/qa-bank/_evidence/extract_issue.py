"""从已保存的 GitHub issue HTML 中抽取正文（stdlib，零网络、零模型）。

用法：python docs/competition/qa-bank/_evidence/extract_issue.py <issue-number>
输入：docs/competition/qa-bank/_evidence/issue-<n>.html（由 curl 保存）
输出：docs/competition/qa-bank/_evidence/issue-<n>.md

说明：此前用正则抽取 `"bodyText":"..."` 时，反斜杠被 shell 吞掉导致字符集未闭合，
故改为「提取页面内嵌 JSON 脚本块 → json.loads → 深度遍历找 bodyText」，
完全不使用含反斜杠的正则。
"""
from __future__ import annotations

import html as htmllib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent


def json_script_blocks(text: str) -> list[str]:
    """取出 <script type="application/json" ...>...</script> 的内容（不用反斜杠正则）。"""
    blocks: list[str] = []
    marker = '<script type="application/json"'
    idx = 0
    while True:
        start = text.find(marker, idx)
        if start == -1:
            break
        body_start = text.find(">", start)
        end = text.find("</script>", body_start)
        if body_start == -1 or end == -1:
            break
        blocks.append(text[body_start + 1 : end])
        idx = end + 1
    return blocks


def walk(node, out: list[str]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k in {"bodyText", "body"} and isinstance(v, str) and len(v) > 40:
                out.append(v)
            else:
                walk(v, out)
    elif isinstance(node, list):
        for item in node:
            walk(item, out)


def main() -> int:
    n = sys.argv[1] if len(sys.argv) > 1 else "28"
    src = HERE / f"issue-{n}.html"
    if not src.exists():
        print(f"缺少输入文件：{src}")
        return 1
    page = src.read_text(encoding="utf-8", errors="replace")
    texts: list[str] = []
    for blk in json_script_blocks(page):
        try:
            walk(json.loads(blk), texts)
        except json.JSONDecodeError:
            continue
    # 兜底：老版页面把正文放在 title/body 的转义字段里
    if not texts:
        for pat in ('"bodyText":"', '"body":"'):
            pos = 0
            while True:
                i = page.find(pat, pos)
                if i == -1:
                    break
                j = i + len(pat)
                buf = []
                while j < len(page):
                    c = page[j]
                    if c == "\\":
                        buf.append(page[j : j + 2])
                        j += 2
                        continue
                    if c == '"':
                        break
                    buf.append(c)
                    j += 1
                raw = "".join(buf)
                try:
                    texts.append(json.loads('"' + raw + '"'))
                except Exception:
                    texts.append(raw)
                pos = j + 1
    if not texts:
        print("未找到正文（页面结构可能已变）")
        return 2
    body = max(texts, key=len)
    # 页面内嵌 JSON 可能把 markdown 再转义一层
    if "\\n" in body and "\n" not in body:
        try:
            body = json.loads('"' + body + '"')
        except Exception:
            pass
    dst = HERE / f"issue-{n}.md"
    dst.write_text(htmllib.unescape(body), encoding="utf-8")
    print(f"已写出 {dst}（{len(body)} 字符）")
    print("---- 前 40 行 ----")
    print("\n".join(body.splitlines()[:40]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
