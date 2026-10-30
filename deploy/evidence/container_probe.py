"""容器 / 编排运行时存在性实测探针（CLOUD-001 任务 4）。

目的：如实记录本机是否具备构建镜像与运行容器的能力，并保留每条命令的原始输出。
本脚本只做本地探测：不安装任何软件、不拉取镜像、不上传、不产生费用。

运行：在仓库根目录执行 `python deploy/evidence/container_probe.py`
输出：deploy/evidence/raw/container-probe-<stamp>.txt（原始输出）与 .json（结构化摘要）
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "deploy" / "evidence" / "raw"
CN = timezone(timedelta(hours=8))

PROBES: list[tuple[str, str]] = [
    ("docker_cli_in_path", "where docker"),
    ("docker_version", "docker --version"),
    ("docker_info", "docker info"),
    ("docker_build_dry", "docker build -t giftwise-validator:local -f deploy/Dockerfile ."),
    ("docker_compose_version", "docker compose version"),
    ("podman_in_path", "where podman"),
    ("podman_version", "podman --version"),
    ("nerdctl_in_path", "where nerdctl"),
    ("nerdctl_version", "nerdctl --version"),
    ("containerd_in_path", "where containerd"),
    ("wsl_status", "wsl --status"),
    ("wsl_list_verbose", "wsl -l -v"),
    ("wsl_version", "wsl --version"),
    ("kubectl_version", "kubectl version --client"),
    ("minikube_version", "minikube version"),
    ("kind_version", "kind version"),
    ("buildkit_in_path", "where buildkitd"),
]

PS_PROBES: list[tuple[str, str]] = [
    (
        "windows_services",
        "Get-Service -Name 'com.docker.service','docker','containerd','com.docker.build' "
        "-ErrorAction SilentlyContinue | Select-Object Name,Status,StartType | Format-Table -AutoSize | Out-String",
    ),
    (
        "docker_desktop_paths",
        "@('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',"
        "'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',"
        "'C:\\Program Files\\Rancher Desktop\\Rancher Desktop.exe',"
        "'C:\\Program Files\\RedHat\\Podman\\podman.exe') | ForEach-Object { "
        "'{0} => {1}' -f $_, (Test-Path -LiteralPath $_) }",
    ),
    (
        "windows_optional_features_containers",
        "foreach ($f in 'Containers','Microsoft-Windows-Subsystem-Linux','VirtualMachinePlatform') { "
        "try { $r = Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction Stop; "
        "'{0} = {1}' -f $r.FeatureName, $r.State } catch { '{0} = 查询失败: {1}' -f $f, "
        "$_.Exception.Message } }",
    ),
    (
        "wsl_appx_package",
        "Get-AppxPackage -Name 'MicrosoftCorporationII.WindowsSubsystemForLinux' "
        "-ErrorAction SilentlyContinue | Select-Object Name,Version,Status | Format-List | Out-String; "
        "'appx_found=' + [bool](Get-AppxPackage -Name 'MicrosoftCorporationII.WindowsSubsystemForLinux' "
        "-ErrorAction SilentlyContinue)",
    ),
    (
        "wsl_distros_registry",
        "try { (Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss' -ErrorAction Stop | "
        "ForEach-Object { $_.PSChildName }) -join ',' } catch { 'Lxss 注册表项不存在: ' + $_.Exception.Message }",
    ),
    (
        "hyperv_present",
        "'vmcompute_service=' + ((Get-Service -Name vmcompute -ErrorAction SilentlyContinue).Status) + "
        "'; lxss_dir=' + (Test-Path -LiteralPath 'C:\\Windows\\System32\\lxss')",
    ),
]


def decode_output(path: Path) -> str:
    """Windows 工具输出编码不一致：wsl.exe 用 UTF-16LE，cmd/where 用 GBK，其余多为 UTF-8。

    这里按实际字节判定编码后转码，仅用于让证据可读，不修改任何输出内容。
    """
    data = path.read_bytes()
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", "replace")
    if data.count(b"\x00") > len(data) // 4:
        try:
            return data.decode("utf-16-le", "replace")
        except UnicodeDecodeError:
            pass
    for encoding in ("utf-8", "gbk"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace")


def run(cmd: str, out_file: Path) -> tuple[int, str]:
    """执行命令并把 stdout+stderr 落盘后读回（沙箱禁用管道，故一律重定向到文件）。"""
    with open(out_file, "wb") as fh:
        rc = subprocess.run(cmd, shell=True, cwd=REPO, stdout=fh, stderr=subprocess.STDOUT).returncode
    return rc, decode_output(out_file)


def main() -> int:
    try:  # Windows 控制台默认 GBK，避免打印代理字符时崩溃
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    RAW.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    raw_path = RAW / f"container-probe-{stamp}.txt"
    summary: dict = {
        "generated_at": datetime.now(CN).isoformat(timespec="seconds"),
        "host_note": "本探针只检查本机能力，不代表任何云端环境",
        "path_lookup": {
            name: (shutil.which(name) or None)
            for name in ("docker", "podman", "nerdctl", "containerd", "wsl", "kubectl", "minikube", "kind")
        },
        "probes": [],
    }

    lines: list[str] = [
        f"# 容器/编排运行时实测探针  {stamp}",
        f"# 主机：{sys.platform} / python {sys.version.split()[0]}",
        "# 说明：只做本地探测，不安装、不拉取镜像、不上传、不产生费用。",
        "",
    ]

    with open(raw_path, "w", encoding="utf-8", errors="replace") as fh:
        for label, cmd in PROBES:
            rc, text = run(cmd, raw_path.with_suffix(f".{label}.tmp"))
            summary["probes"].append({"label": label, "command": cmd, "exit_code": rc, "output": text.strip()[:2000]})
            fh.write(f"$ {cmd}\n[exit {rc}]\n{text.strip()}\n\n---\n\n")
        for label, cmd in PS_PROBES:
            full = f'powershell -NoProfile -ExecutionPolicy Bypass -Command "{cmd}"'
            rc, text = run(full, raw_path.with_suffix(f".{label}.tmp"))
            summary["probes"].append({"label": label, "command": full, "exit_code": rc, "output": text.strip()[:2000]})
            fh.write(f"$ {full}\n[exit {rc}]\n{text.strip()}\n\n---\n\n")

    for tmp in RAW.glob("container-probe-*.tmp"):
        tmp.unlink(missing_ok=True)

    (RAW / "container-probe-latest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"raw   -> {raw_path.relative_to(REPO)}")
    print(f"json  -> deploy/evidence/raw/container-probe-latest.json")
    for probe in summary["probes"]:
        first = probe["output"].splitlines()[0] if probe["output"] else "<无输出>"
        print(f"  [{probe['exit_code']:>3}] {probe['label']:<34} {first[:88]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
