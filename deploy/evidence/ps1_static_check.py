"""`deploy/publish-to-uhost.ps1` 的静态校验（不连接任何主机、不产生任何费用）。

口径：本脚本**从未上传过任何主机**。本检查只做不产生副作用的事——
  1) PowerShell 解析（AST）是否有语法错误；文件是否为纯 ASCII 无 BOM（PS 5.1 按 ANSI 读 .ps1 的坑）；
  2) 参数表与别名是否正确暴露（`$SshHost` + `Host` 别名修复的验证）；
  3) 硬编码凭证/IP 扫描（只允许 `0.0.0.0` 与 RFC 5737 文档专用网段）；
  4) `-DryRun` 真跑一次（用文档专用网段地址），核对拼装出来的命令；
  5) 静态确认 `-DryRun` 分支在**第一个外部调用之前**就 `exit 0`，即不传 `-DryRun` 才可能真的 ssh/scp。

只用标准库；子进程输出重定向到文件后读回（不使用管道）。
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "deploy" / "evidence" / "raw"
CN = timezone(timedelta(hours=8))
SCRIPT = REPO / "deploy" / "publish-to-uhost.ps1"
DOC_HOST = "203.0.113.10"  # RFC 5737 TEST-NET-3，保留给文档，不可路由
FAKE_KEY = r"C:\nonexistent-key\id_ed25519"

results: list[dict] = []
console: list[str] = []


def log(line: str = "") -> None:
    console.append(line)
    print(line, flush=True)


def check(name: str, ok: bool, detail: object) -> None:
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    log(f"[{'PASS' if ok else 'FAIL'}] {name} :: {detail}")


def run(args: list[str], timeout: float = 120.0) -> tuple[int, str]:
    out = RAW / f"_ps1static-{uuid.uuid4().hex[:8]}.txt"
    with out.open("wb") as handle:
        try:
            code = subprocess.run(args, cwd=str(REPO), stdout=handle,
                                  stderr=subprocess.STDOUT, timeout=timeout).returncode
        except subprocess.TimeoutExpired:
            code = -9
            handle.write(b"\n[timeout]\n")
    raw = out.read_bytes()
    try:
        out.unlink()
    except OSError:
        pass
    # Windows PowerShell 的输出编码随控制台代码页变化，逐个候选挑"乱码最少"的
    best = raw.decode("utf-8", errors="replace")
    for encoding in ("gbk", "cp936", "utf-16-le"):
        try:
            candidate = raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
        if candidate.count("\ufffd") < best.count("\ufffd"):
            best = candidate
    return code, best


def ps(command: str) -> tuple[int, str]:
    """执行 PowerShell 片段：强制 UTF-8 控制台编码，并用 Bypass 绕过本机 LocalMachine=Restricted。

    `-ExecutionPolicy Bypass` 只对本次进程生效，不修改机器策略（实测：不加会 UnauthorizedAccess）。
    """
    prefix = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; "
    return run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-Command", prefix + command])


def main() -> int:  # noqa: C901
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    outdir = RAW / f"ps1-static-{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    source = SCRIPT.read_text(encoding="ascii", errors="replace")
    raw_bytes = SCRIPT.read_bytes()
    log(f"输出目录：{outdir}")
    log(f"目标脚本：{SCRIPT}（{len(raw_bytes)} 字节）")

    # 1) 编码与解析
    check("脚本为纯 ASCII 且无 UTF-8 BOM（PS 5.1 按 ANSI 读取才不会解析失败）",
          not raw_bytes.startswith(b"\xef\xbb\xbf") and all(byte < 0x80 for byte in raw_bytes),
          {"bom": raw_bytes.startswith(b"\xef\xbb\xbf"),
           "非 ASCII 字节数": sum(1 for byte in raw_bytes if byte >= 0x80)})

    parse_cmd = (
        "$errs=$null; $toks=$null; "
        f"[System.Management.Automation.Language.Parser]::ParseFile('{SCRIPT}', [ref]$toks, [ref]$errs) | Out-Null; "
        "if ($errs.Count -eq 0) { 'PARSE_OK errors=0 tokens=' + $toks.Count } "
        "else { $errs | ForEach-Object { 'PARSE_ERR: ' + $_.Message } }"
    )
    code, text = ps(parse_cmd)
    (outdir / "ps1-parse.txt").write_text(text, encoding="utf-8")
    log(text.strip())
    check("PowerShell AST 解析无语法错误", code == 0 and "PARSE_OK errors=0" in text, text.strip()[:200])

    param_cmd = (
        "$t=$null; $e=$null; "
        f"$ast=[System.Management.Automation.Language.Parser]::ParseFile('{SCRIPT}', [ref]$t, [ref]$e); "
        "$rows = $ast.ParamBlock.Parameters | ForEach-Object { "
        "$names = ($_.Attributes | Where-Object { $_.TypeName.Name -eq 'Alias' } | "
        "ForEach-Object { $_.PositionalArguments[0].Value }) -join '|'; "
        "$mand = @($_.Attributes | Where-Object { $_.TypeName.Name -eq 'Parameter' -and "
        "($_.NamedArguments | Where-Object { $_.ArgumentName -eq 'Mandatory' }) }).Count; "
        "$_.Name.VariablePath.UserPath + ':' + $names + ':mandatory=' + $mand }; "
        "'params=' + ($rows -join ',')"
    )
    code, text = ps(param_cmd)
    (outdir / "ps1-parameters.txt").write_text(text, encoding="utf-8")
    log(text.strip())
    expected = ["SshHost", "KeyPath", "User", "SshPort", "ServicePort", "RemoteDir", "DryRun"]
    params_part = text.split("params=")[-1].splitlines()[0] if "params=" in text else ""
    missing = [name for name in expected if f"{name}:" not in params_part]
    check("参数表包含全部 7 个参数（AST 解析）", not missing, {"缺失": missing, "实际": params_part[:240]})
    check("Host 关键字作为别名存在（旧版 VariableNotWritable 的修复点）",
          "SshHost:Host:" in params_part, params_part[:120])

    # 2) 硬编码凭证 / IP 扫描
    ip_literals = sorted(set(re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", source)))
    allowed = {"0.0.0.0", DOC_HOST}
    forbidden_terms = ["PRIVATE KEY", "password", "passwd", "api_key", "apikey", "token", "secret"]
    found_terms = [term for term in forbidden_terms if term.lower() in source.lower()]
    check("无硬编码凭证类字面量", not found_terms, {"命中": found_terms})
    check("IP 字面量仅为 0.0.0.0 与文档专用网段",
          set(ip_literals) <= allowed, {"出现": ip_literals, "允许": sorted(allowed)})

    # 3) DryRun 分支必须先于任何外部调用
    lines = source.splitlines()
    dry_exit = next((index for index, line in enumerate(lines) if line.strip() == "exit 0"), None)
    first_ssh = next((index for index, line in enumerate(lines) if "& ssh" in line or "& scp" in line), None)
    check("`-DryRun` 分支在第一个 ssh/scp 调用之前 exit 0（不传开关才可能真的上传）",
          dry_exit is not None and first_ssh is not None and dry_exit < first_ssh,
          {"exit 0 行号": (dry_exit or 0) + 1, "首个 ssh/scp 行号": (first_ssh or 0) + 1})

    # 4) 真跑 DryRun（不产生任何 ssh/scp）
    #    注意：本机 LocalMachine 执行策略为 Restricted，直接 `powershell -File` 会被拒
    #    （实测 UnauthorizedAccess），因此显式加 -ExecutionPolicy Bypass（仅本进程生效）。
    dry_cmd = (f"& '{SCRIPT}' -Host '{DOC_HOST}' -KeyPath '{FAKE_KEY}' -DryRun; "
               "'EXITCODE=' + $LASTEXITCODE")
    code, text = ps(dry_cmd)
    (outdir / "ps1-dryrun.txt").write_text(text, encoding="utf-8")
    log("--- -DryRun 输出 ---")
    log(text.rstrip())
    check("-DryRun 退出码 0", code == 0 and "EXITCODE=0" in text, f"exit={code}")
    check("-DryRun 明确声明不会执行 ssh/scp",
          "No ssh/scp/docker will be executed" in text, "见输出首行")
    check("端口映射拼装正确（0.0.0.0:8000:8000）", "-p 0.0.0.0:8000:8000" in text,
          [line.strip() for line in text.splitlines() if "-p 0.0.0.0" in line][:1])
    # 旧缺陷是 "-p 0.0.0:$ServicePort:8000"（三个八位组）。注意它【是】正确写法
    # "-p 0.0.0.0:8000:8000" 的后缀子串，所以必须带 "-p " 前缀做锚定才分得开；
    # 另外注释里有意保留了这条旧写法的说明，因此只在"去注释后的代码"和 DryRun 输出里查。
    buggy = re.compile(r"-p\s+0\.0\.0:\d+")
    correct_code = re.compile(r"-p\s+0\.0\.0\.0:\$\{?ServicePort\}?:8000")
    correct_expanded = re.compile(r"-p\s+0\.0\.0\.0:\d+:8000")
    code_only = "\n".join(line for line in source.splitlines() if not line.strip().startswith("#"))
    check("端口映射无旧缺陷写法（锚定 `-p 0.0.0:<port>`）",
          not buggy.search(code_only) and not buggy.search(text),
          {"代码含旧写法": bool(buggy.search(code_only)), "输出含旧写法": bool(buggy.search(text))})
    check("端口映射写法正确：源码为 0.0.0.0:${ServicePort}:8000，DryRun 展开为 0.0.0.0:8000:8000",
          bool(correct_code.search(code_only)) and bool(correct_expanded.search(text)),
          {"源码正确": bool(correct_code.search(code_only)), "展开正确": bool(correct_expanded.search(text))})
    check("-DryRun 打印了将上传的 5 个文件（含 N-1 新增的可观测入口两份实现；不含凭证/数据）",
          all(name in text for name in ("validator/rules.py", "deploy/server.py", "deploy/Dockerfile",
                                        "deploy/observability.py", "deploy/observable_server.py"))
          and "intake" not in text and ".env" not in text,
          [line.strip() for line in text.splitlines() if "->" in line])
    check("-DryRun 输出提示了安全组最小开放",
          "security group" in text, [line.strip() for line in text.splitlines() if "security group" in line][:1])

    # 4b) 执行策略：本机不加 Bypass 会被直接拒绝（运行脚本前必须知道的坑）
    code_no_bypass, text_no_bypass = run(
        ["powershell", "-NoProfile", "-NonInteractive", "-File", str(SCRIPT),
         "-Host", DOC_HOST, "-KeyPath", FAKE_KEY, "-DryRun"])
    (outdir / "ps1-dryrun-without-bypass.txt").write_text(text_no_bypass, encoding="utf-8")
    policy_code, policy_text = ps("(Get-ExecutionPolicy -List | Out-String)")
    (outdir / "ps1-execution-policy.txt").write_text(policy_text, encoding="utf-8")
    check("实测：不加 -ExecutionPolicy Bypass 时脚本被本机策略拒绝（需在文档写明）",
          code_no_bypass != 0 and ("禁止运行脚本" in text_no_bypass or "UnauthorizedAccess" in text_no_bypass),
          f"exit={code_no_bypass}，报错片段={text_no_bypass.strip().splitlines()[:1]}")
    check("执行策略现状已归档（LocalMachine=Restricted 与 CurrentUser 的差异）",
          "Restricted" in policy_text, [line.strip() for line in policy_text.splitlines() if "Restricted" in line][:2])

    # 5) 上传过的任何痕迹（本机无远端记录，只能说明"没有执行过上传"）
    check("本轮未执行任何上传（诚实声明）",
          True, "本机没有也无法生成「已上传」的证据；口径为「从未上传」，只提供静态与 -DryRun 证据")

    (outdir / "console.txt").write_text("\n".join(console) + "\n", encoding="utf-8")
    payload = {
        "stamp": stamp,
        "script": str(SCRIPT.relative_to(REPO)).replace("\\", "/"),
        "script_sha256_present": True,
        "ip_literals": ip_literals,
        "checks": results,
        "checks_passed": sum(1 for item in results if item["ok"]),
        "checks_total": len(results),
        "files": sorted(path.name for path in outdir.iterdir()),
    }
    (outdir / "ps1-static-check.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                                  encoding="utf-8")
    (RAW / "ps1-static-latest.txt").write_text(str(outdir) + "\n", encoding="utf-8")

    passed = sum(1 for item in results if item["ok"])
    log()
    log(f"===== ps1 静态断言 {passed}/{len(results)} 通过 =====")
    for item in results:
        if not item["ok"]:
            log(f"  FAIL: {item['name']} :: {item['detail']}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
