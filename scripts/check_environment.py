"""Check Python and an explicitly selected local CDP endpoint; no tab or credential access."""
import argparse
import json
import platform
import sys
from urllib.parse import urlsplit
from urllib.request import Request, ProxyHandler, HTTPRedirectHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check_cdp(endpoint):
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
            or parsed.username or parsed.password or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment):
        raise ValueError("仅支持用户指定的本机HTTP端点，例如http://127.0.0.1:9222")
    if not parsed.port:
        raise ValueError("请明确提供CDP端口")
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(Request(endpoint.rstrip("/") + "/json/version"), timeout=3) as response:
        data = json.loads(response.read(65536).decode("utf-8"))
    return isinstance(data, dict) and isinstance(data.get("Browser"), str) and bool(data.get("webSocketDebuggerUrl"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--skip-cdp", action="store_true")
    args = parser.parse_args()
    python_ok = sys.version_info >= (3, 9)
    report = {"操作系统": platform.system(), "Python版本": platform.python_version(),
              "Python满足最低版本": python_ok, "额外Python依赖": "无，仅标准库", "CDP状态": "未检查"}
    cdp_ok = False
    if args.skip_cdp:
        report["下一步"] = "使用宿主已有浏览器能力核实风鸟登录状态。"
    else:
        try:
            cdp_ok = check_cdp(args.cdp_url)
            report["CDP状态"] = "就绪" if cdp_ok else "响应不符合CDP格式"
        except ValueError:
            report["CDP状态"] = "端点参数或响应格式无效"
        except Exception:
            report["CDP状态"] = "未连接，未启动或无法访问"
        report["下一步"] = ("请由Agent连接浏览器并确认风鸟已登录；端点响应不等于查询已就绪。" if cdp_ok
                           else "按references/setup.md中用户电脑对应系统的命令启动Chrome，在新窗口登录风鸟后重试。")
    if not python_ok:
        report["Python提示"] = "请使用受支持的Python 3版本，代码最低要求3.9。"
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if python_ok and (args.skip_cdp or cdp_ok) else 2


if __name__ == "__main__":
    raise SystemExit(main())
