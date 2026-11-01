# GiftWise AI 部署版架构图：一张文案/坐标表同时生成 drawio 与 SVG（PNG 由 render_png.mjs 从 SVG 渲染）。
# 用法：python build_diagram.py <输出目录> <文件名前缀>
import json, sys, os
from xml.sax.saxutils import escape as _esc
escape = lambda t: _esc(t, {'"': "&quot;"})

W, H = 1440, 810
FONT = "Microsoft YaHei"
STY = {  # 描边, 填充
    "user": ("#0F766E", "#FFFFFF"), "srv": ("#0F766E", "#FFFFFF"),
    "mem": ("#B45309", "#FFFBEB"), "disk": ("#4338CA", "#F5F3FF"),
    "async": ("#4338CA", "#F5F3FF"), "ext": ("#1D4ED8", "#EFF6FF"),
}
LANES = [  # id, x, y, w, h, 填充, 描边, 标题, 标题位置
    ("lane-user", 16, 44, 1408, 128, "#ECF5F2", "none", "用户交互 · 浏览器（不可信区）", (28, 30)),
    ("lane-srv", 16, 196, 1408, 400, "#F3F7F6", "#0F766E", "", None),
    ("lane-ext", 16, 616, 1408, 150, "#EEF3FB", "none", "外部服务", (34, 650)),
]
TEXTS = [  # id, x, y, 文本, 字号, 颜色, 粗体
    ("t-srv1", 190, 218, "可信服务端 · Compshare Ubuntu 22.04.4 单实例", 17, "#0F766E", True),
    ("t-srv2", 190, 240, "Nginx 公网 :80 → Node v24.16.0 · 127.0.0.1:8787 · systemd 守护", 13, "#334155", False),
    ("t-foot", 28, 790, "运维通道：OpenCLI 仅用于部署操作，不在用户请求链路　·　推荐阶段不抓取网图　·　部署 19b6819 · 证据 6e92a9e", 13, "#475569", False),
]
NODES = [  # id, 样式, x, y, w, h, 标题, [副行]
    ("input", "user", 30, 66, 250, 92, "需求输入", ["自然描述 · 排除项确认"]),
    ("compare", "user", 590, 66, 240, 92, "三方案比较", ["依据 · 估价 · 校验结果", "推荐卡不配网图"]),
    ("select", "user", 850, 66, 240, 92, "用户明确选择", ["只能选通过检查的方案"]),
    ("guide", "user", 1110, 66, 300, 92, "赠送指南与效果图", ["文字先展示 · 图片原位补入", "纯体验不强加包装章节"]),
    ("parse", "srv", 30, 256, 250, 108, "解析与可信上下文", ["自然澄清 · 保留原话", "服务端固定已确认约束"]),
    ("cand", "srv", 300, 256, 270, 108, "候选生成", ["模型按需调用检索工具", "公开文字依据 → 三方案"]),
    ("check", "srv", 590, 256, 240, 108, "独立代码校验", ["预算 · 禁忌 · 结构", "时间不影响可选性"]),
    ("post", "srv", 850, 256, 240, 108, "选择后生成与复核", ["包装 · 配色 · 贺卡 · 赠送", "全局最多一次业务修订"]),
    ("api", "srv", 1110, 256, 300, 108, "文字响应与媒体任务 API", ["立即返回文字 + task_id", "只读 GET 状态与图片 · 归属校验"]),
    ("mem", "mem", 30, 452, 250, 112, "内存状态", ["run · analysis · selection · 签名", "重启后旧流程失效"]),
    ("db", "disk", 590, 452, 240, 112, "独立数据库", ["/var/lib/giftwise/db", "独立 SQLite · 不用演示库"]),
    ("runtime", "disk", 850, 452, 240, 112, "独立落盘 runtime", ["/var/lib/giftwise/runtime", "文字缓存 · 媒体 · 审计 · 账本"]),
    ("img", "async", 1110, 452, 300, 112, "后台效果图任务", ["仅为所选方案生成 1 张", "pending → ready / failed / unknown"]),
    ("web", "ext", 300, 640, 270, 104, "公开文字检索 · 匿名 HTTP", ["真实公开文字 + 合法历史摘要", "保留观察时间"]),
    ("llm", "ext", 590, 640, 500, 104, "文字模型 API · HTTPS", ["解析 · 三方案 · 修订 · 赠送指南", "密钥只在服务端"]),
    ("seed", "ext", 1110, 640, 300, 104, "Seedream API · HTTPS", ["仅在用户明确选择后调用", "无参考图输入"]),
]
EDGES = [  # id, 路径点, 文本, 文本位置, 颜色, 虚线, 双向
    ("e-in", [(155, 158), (155, 256)], "HTTP :80 · 未配置 HTTPS", (166, 186), "#0F766E", False, False),
    ("e-p-c", [(280, 310), (300, 310)], "", None, "#0F766E", False, False),
    ("e-c-k", [(570, 310), (590, 310)], "", None, "#0F766E", False, False),
    ("e-k-cmp", [(710, 256), (710, 158)], "三个可选方案", (720, 222), "#0F766E", False, False),
    ("e-cmp-sel", [(830, 112), (850, 112)], "", None, "#0F766E", False, False),
    ("e-sel-post", [(970, 158), (970, 256)], "选择事件", (980, 222), "#0F766E", False, False),
    ("e-post-api", [(1090, 310), (1110, 310)], "", None, "#0F766E", False, False),
    ("e-api-guide", [(1200, 256), (1200, 158)], "文字先返回", (1210, 222), "#0F766E", False, False),
    ("e-guide-api", [(1380, 158), (1380, 256)], "只读 GET", (1300, 236), "#4338CA", True, False),
    ("e-api-img", [(1260, 364), (1260, 452)], "异步启动", (1270, 412), "#4338CA", False, False),
    ("e-img-rt", [(1110, 508), (1090, 508)], "", None, "#4338CA", False, False),
    ("e-c-web", [(435, 364), (435, 640)], "按需工具调用", (445, 412), "#1D4ED8", True, True),
    ("e-srv-llm", [(840, 596), (840, 640)], "模型调用 · HTTPS", (850, 620), "#1D4ED8", False, True),
    ("e-img-seed", [(1260, 564), (1260, 640)], "HTTPS", (1270, 606), "#1D4ED8", False, True),
]

def drawio():
    cells = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />']
    for lid, x, y, w, h, fill, stroke, title, tpos in LANES:
        st = f"rounded=1;arcSize=4;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};" + ("dashed=1;" if lid == "lane-srv" else "")
        cells.append(f'<mxCell id="{lid}" value="" style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry" /></mxCell>')
        if title:
            tx, ty = tpos
            cells.append(f'<mxCell id="{lid}-t" value="{escape(title)}" style="text;html=1;fontFamily={FONT};fontSize=17;fontStyle=1;fontColor=#0F766E;align=left;verticalAlign=middle;" vertex="1" parent="1"><mxGeometry x="{tx}" y="{ty - 14}" width="420" height="24" as="geometry" /></mxCell>')
    for tid, x, y, text, size, color, bold in TEXTS:
        cells.append(f'<mxCell id="{tid}" value="{escape(text)}" style="text;html=1;fontFamily={FONT};fontSize={size};fontColor={color};align=left;verticalAlign=middle;{"fontStyle=1;" if bold else ""}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y - size}" width="1200" height="{size + 8}" as="geometry" /></mxCell>')
    for nid, kind, x, y, w, h, title, subs in NODES:
        stroke, fill = STY[kind]
        val = f"<b>{escape(title)}</b>" + "".join(f"<br><font style=\"font-size:14px\">{escape(s)}</font>" for s in subs)
        st = f"rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};strokeWidth=1.5;fontColor=#0F172A;fontFamily={FONT};fontSize=18;align=left;verticalAlign=middle;spacingLeft=14;spacingRight=10;"
        cells.append(f'<mxCell id="{nid}" value="{escape(val)}" style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry" /></mxCell>')
    for eid, pts, text, tpos, color, dashed, both in EDGES:
        (sx, sy), (tx, ty) = pts[0], pts[-1]
        mids = "".join(f'<mxPoint x="{px}" y="{py}" />' for px, py in pts[1:-1])
        st = f"endArrow=block;endFill=1;html=1;strokeColor={color};strokeWidth=2;" + ("dashed=1;" if dashed else "") + ("startArrow=block;startFill=1;" if both else "")
        arr = f"<Array as=\"points\">{mids}</Array>" if mids else ""
        cells.append(f'<mxCell id="{eid}" value="" style="{st}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="{sx}" y="{sy}" as="sourcePoint" /><mxPoint x="{tx}" y="{ty}" as="targetPoint" />{arr}</mxGeometry></mxCell>')
        if text:
            lx, ly = tpos
            cells.append(f'<mxCell id="{eid}-t" value="{escape(text)}" style="text;html=1;fontFamily={FONT};fontSize=14;fontColor={color};align=left;verticalAlign=middle;" vertex="1" parent="1"><mxGeometry x="{lx}" y="{ly - 11}" width="220" height="22" as="geometry" /></mxCell>')
    return ('<?xml version="1.0" encoding="utf-8"?>\n<mxfile host="app.diagrams.net" version="24.7.17"><diagram id="giftwise-deploy-19b6819" name="GiftWise 部署架构 19b6819">'
            f'<mxGraphModel dx="{W}" dy="{H}" pageWidth="{W}" pageHeight="{H}" page="1" grid="1" gridSize="10"><root>' + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>\n")

def svg():
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}, PingFang SC, sans-serif">',
         '<defs>' + "".join(f'<marker id="a{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="{c}"/></marker>' for c in {e[4] for e in EDGES}) + '</defs>',
         f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>']
    for lid, x, y, w, h, fill, stroke, title, tpos in LANES:
        o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}"' + (f' stroke="{stroke}" stroke-width="1.5" stroke-dasharray="7 5"' if stroke != "none" else "") + "/>")
        if title:
            o.append(f'<text x="{tpos[0]}" y="{tpos[1] + 6}" font-size="17" font-weight="700" fill="#0F766E">{escape(title)}</text>')
    for tid, x, y, text, size, color, bold in TEXTS:
        o.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}"' + (' font-weight="700"' if bold else "") + f">{escape(text)}</text>")
    for eid, pts, text, tpos, color, dashed, both in EDGES:
        d = " ".join(f"{px},{py}" for px, py in pts)
        o.append(f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="2"' + (' stroke-dasharray="6 5"' if dashed else "") + f' marker-end="url(#a{color[1:]})"' + (f' marker-start="url(#a{color[1:]})"' if both else "") + "/>")
        if text:
            o.append(f'<text x="{tpos[0]}" y="{tpos[1] + 5}" font-size="14" fill="{color}">{escape(text)}</text>')
    for nid, kind, x, y, w, h, title, subs in NODES:
        stroke, fill = STY[kind]
        o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
        lines = 1 + len(subs); top = y + h / 2 - (22 + 20 * (lines - 1)) / 2 + 17
        o.append(f'<text x="{x + 14}" y="{top:.0f}" font-size="18" font-weight="700" fill="#0F172A">{escape(title)}</text>')
        for i, s in enumerate(subs):
            o.append(f'<text x="{x + 14}" y="{top + 22 + 20 * i:.0f}" font-size="14" fill="#334155">{escape(s)}</text>')
    o.append("</svg>\n")
    return "\n".join(o)

if __name__ == "__main__":
    out, prefix = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, prefix + ".drawio"), "w", encoding="utf-8").write(drawio())
    open(os.path.join(out, prefix + ".svg"), "w", encoding="utf-8").write(svg())
    labels = [{"id": n[0], "title": n[6], "lines": n[7]} for n in NODES] + [{"id": e[0], "edge_label": e[2]} for e in EDGES if e[2]] + [{"id": t[0], "text": t[3]} for t in TEXTS] + [{"id": l[0], "text": l[7]} for l in LANES if l[7]]
    open(os.path.join(out, prefix + "-labels.json"), "w", encoding="utf-8").write(json.dumps(labels, ensure_ascii=False, indent=1))
    print("ok", out, prefix)
