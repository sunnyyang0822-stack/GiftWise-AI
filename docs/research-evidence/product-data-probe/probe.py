"""Read-only, bounded provider probes; no credentials or paid calls required."""
import argparse
import concurrent.futures
import datetime
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
TARGET = "https://www.kintocn.cn/product/detail_231.html"


def call(label, url, body, headers=None):
    started = time.monotonic()
    observed = datetime.datetime.now(datetime.timezone.utc).isoformat()
    status, response, error = None, None, None
    # Windows curl uses the OS certificate store (Schannel). Python's standalone
    # OpenSSL store failed certificate validation here; TLS verification stays on.
    command = ["curl.exe", "--silent", "--show-error", "--max-time", "45",
               "--request", "POST", url, "--header", "Content-Type: application/json",
               "--data-binary", "@-", "--write-out", "\n%{http_code}"]
    for key, value in (headers or {}).items():
        command.extend(["--header", key + ": " + value])
    try:
        result = subprocess.run(command, input=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                capture_output=True, timeout=50)
        raw, _, status_text = result.stdout.decode("utf-8", "replace").rpartition("\n")
        status = int(status_text) if status_text.isdigit() and status_text != "000" else None
        if result.returncode:
            error = result.stderr.decode("utf-8", "replace")
    except Exception as exc:
        raw = ""
        error = type(exc).__name__ + ": " + str(exc)
    try:
        response = json.loads(raw)
    except ValueError:
        response = raw
    record = {"label": label, "observed_at": observed,
              "elapsed_seconds": round(time.monotonic() - started, 3),
              "endpoint": url, "request": body, "http_status": status,
              "transport_error": error, "response": response}
    (ROOT / (label + ".json")).write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {k: v for k, v in record.items() if k not in ("request", "response")}
    if isinstance(response, dict):
        summary["response_keys"] = list(response)
        if "results" in response:
            summary["results"] = [{"title": x.get("title"), "url": x.get("url"),
                                   "content_excerpt": (x.get("content") or x.get("raw_content") or "")[:180]}
                                  for x in response["results"][:8]]
        if "data" in response and isinstance(response["data"], dict):
            summary["data_keys"] = list(response["data"])
            summary["markdown_excerpt"] = response["data"].get("markdown", "")[:800]
            summary["json"] = response["data"].get("json")
        for key in ("error", "detail", "message", "success", "failed_results"):
            if key in response:
                summary[key] = response[key]
    else:
        summary["response_excerpt"] = str(response)[:600]
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["initial", "extract", "scenarios", "targeted", "optimized", "discovered", "jd", "jd-detail"])
    args = parser.parse_args()
    tasks = []
    tavily_headers = {"X-Tavily-Access-Mode": "keyless"}
    if args.stage == "initial":
        tasks = [
            ("tavily_search_kinto", "https://api.tavily.com/search",
             {"query": "KINTO SCS-S03 手做陶瓷马克杯 320ml 价格 中国", "max_results": 5,
              "include_raw_content": True}, tavily_headers),
            ("firecrawl_scrape_kinto", "https://api.firecrawl.dev/v2/scrape",
             {"url": TARGET, "formats": ["markdown"], "maxAge": 0}, None),
        ]
    elif args.stage == "extract":
        tasks = [
            ("tavily_extract_kinto", "https://api.tavily.com/extract", {"urls": [TARGET]}, tavily_headers),
        ]
    elif args.stage == "targeted":
        tasks = [
            ("tavily_search_kinto_english", "https://api.tavily.com/search",
             {"query": "KINTO SCS-S03 mug 320ml price", "max_results": 5}, tavily_headers),
            ("tavily_search_kinto_domain", "https://api.tavily.com/search",
             {"query": "KINTO 马克杯", "include_domains": ["kintocn.cn"], "max_results": 5}, tavily_headers),
        ]
    elif args.stage == "optimized":
        tasks = [
            ("tavily_optimized_kinto", "https://api.tavily.com/search",
             {"query": "SCS-S03 320ml", "include_domains": ["kintocn.cn"], "search_depth": "advanced", "max_results": 5}, tavily_headers),
            ("tavily_optimized_pilot", "https://api.tavily.com/search",
             {"query": "百乐 78G 钢笔", "include_domains": ["jd.com"], "search_depth": "advanced", "max_results": 5}, tavily_headers),
            ("tavily_optimized_puzzle", "https://api.tavily.com/search",
             {"query": "拼图 1000片", "include_domains": ["jd.com"], "search_depth": "advanced", "max_results": 5}, tavily_headers),
        ]
    elif args.stage == "discovered":
        record = json.loads((ROOT / "tavily_search_kinto_domain.json").read_text(encoding="utf-8"))
        urls = list(dict.fromkeys(x["url"].replace("http://", "https://") for x in record["response"]["results"]
                                 if "/product/detail_" in x["url"]))[:3]
        tasks = [("tavily_extract_discovered", "https://api.tavily.com/extract", {"urls": urls}, tavily_headers)]
    elif args.stage == "jd":
        urls = []
        for name in ("pilot", "puzzle"):
            record = json.loads((ROOT / ("tavily_optimized_" + name + ".json")).read_text(encoding="utf-8"))
            urls.append(record["response"]["results"][0]["url"])
        tasks = [("tavily_extract_jd", "https://api.tavily.com/extract", {"urls": urls}, tavily_headers)]
    elif args.stage == "jd-detail":
        record = json.loads((ROOT / "tavily_extract_jd.json").read_text(encoding="utf-8"))
        urls = [re.search(r"https://item\.jd\.com/\d+\.html", result["raw_content"]).group(0)
                for result in record["response"]["results"]]
        tasks = [("tavily_extract_jd_detail", "https://api.tavily.com/extract", {"urls": urls}, tavily_headers)]
    else:
        queries = {
            "partner": "恋人 生日 礼物 咖啡 KINTO 马克杯 官方 价格 200元以内",
            "pursuit": "朋友 文具 礼物 百乐 钢笔 礼盒 价格 200元以内 官方",
            "friend": "朋友 生日 拼图 礼物 价格 150元以内 商品",
        }
        tasks = [("tavily_scenario_" + name, "https://api.tavily.com/search",
                  {"query": query, "max_results": 5, "include_raw_content": True}, tavily_headers)
                 for name, query in queries.items()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lambda task: call(*task), tasks):
            print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
