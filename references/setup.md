# 首次使用：Python与Chrome CDP准备

这里是 **CDP（Chrome DevTools Protocol）**，不是SDP。以下命令由用户按需运行；提供命令不表示技能已经执行安装或启动。不要为了普通查询自动安装软件、关闭全部Chrome或改启动配置。

## 给Agent的检查顺序

1. 先复用宿主已有的Python和可用浏览器控制能力。已有可操作且已登录的宿主浏览器时，不强制用户再启动CDP或重复安装Python。
2. 若使用用户授权的Chrome/CDP，默认端点为 `http://127.0.0.1:9222`。只检查此端点或用户明确提供的地址，不扫描端口和浏览器标签。Python可用时可运行本技能的 `scripts/check_environment.py`。
3. 端点未就绪：保留用户输入的企业名称，告知用户“请按下面的命令打开用于查询的Chrome，在新窗口登录风鸟，保持窗口打开，完成后回复已就绪”，只给与用户实际操作系统匹配的命令。检测不到用户系统时询问Windows/macOS/Linux，不根据远程Agent服务器的系统推断用户电脑系统。
4. 用户启动后重试一次正常连接，核对风鸟登录状态再自动继续原任务，不要求用户重新输入企业名称。
5. 端点可达且允许本机命令/CDP时，使用附带的`run_cdp.mjs`（Node.js 22+，无npm依赖），见 [cdp-runner.md](cdp-runner.md)，不用现场写执行器。若宿主既不允许该脚本也没有浏览器工具，说明缺少控制能力，不能假装已连接。Agent在远程服务器/容器里时，127.0.0.1指Agent所在机器；不要让用户开放公网调试端口作为通用解决办法。

## Python安装及依赖

报告生成与环境检查脚本最低需要Python 3.9，**新安装请选择官方仍受支持的Python 3版本**。已有宿主Python可直接使用，无需重复安装。

本技能Python脚本仅用标准库，**没有额外pip依赖**；不需要requests、pandas，也不需要Python版playwright。推荐的CDP执行器使用宿主已有Node.js 22+，无需Playwright或npm安装；DOM备用分页助手才使用宿主提供的Playwright Page，不属于Python依赖；不要为了本技能盲目安装整套浏览器或额外包。

### Windows（PowerShell）

从 [Python官网下载页](https://www.python.org/downloads/) 安装Python Install Manager。已经有合适Python解释器的用户跳过安装。安装管理器后，若尚无Python运行时，可以安装一个支持的版本，例如：

```powershell
pymanager install 3.14
py --version
```

`pymanager`是新安装管理器命令，旧版`py`启动器不提供此安装子命令。若系统仅有可用的`python`而没有`py`，下文将`py`替换为`python`或解释器的实际路径。

进入技能目录后检查标准库并运行自检：

```powershell
py -c "import sys,json,decimal,pathlib,urllib.request; print(sys.version)"
py scripts/check_environment.py
```

### macOS（终端）

从 [Python官方macOS安装页](https://www.python.org/downloads/macos/) 下载并安装受支持的Python 3安装包，重新打开终端。已安装的用户直接检查：

```bash
python3 --version
python3 -c "import sys,json,decimal,pathlib,urllib.request; print(sys.version)"
python3 scripts/check_environment.py
```

### Linux（终端）

先运行 `python3 --version`。如未安装，使用发行版的官方包管理器；以下命令会安装软件，用户按自己的系统选一种运行。

Debian/Ubuntu系列：

```bash
sudo apt update
sudo apt install python3
```

Fedora/RHEL系列（仓库需提供满足最低版本的Python）：

```bash
sudo dnf install python3
```

安装后进入技能目录：

```bash
python3 -c "import sys,json,decimal,pathlib,urllib.request; print(sys.version)"
python3 scripts/check_environment.py
```

pip不是本技能运行前提，不必为缺少pip阻塞查询。这里只检查依赖，不自动读取任何登录凭据。

## Chrome启动命令

先安装Google Chrome，使用有图形桌面的用户会话。以下命令创建独立的持久数据目录，只监听本机9222端口。Chrome 136起对默认用户数据目录不再接受远程调试开关，因此不要删除 `--user-data-dir`，也不要将它改为平时Chrome的默认目录。[Chrome官方说明](https://developer.chrome.com/blog/remote-debugging-port)

**首次使用这个独立目录时，请在新打开的Chrome里重新登录风鸟。** 平时浏览器已登录不代表此独立目录也已登录。后续沿用同一目录可复用其登录状态，但仍以网站实际状态为准。查询期间保持该Chrome窗口打开。

### Windows（PowerShell，可直接复制）

自动查找常见安装位置；Chrome装在其他路径时将 `$riskbirdChrome` 改为实际chrome.exe路径。

```powershell
$riskbirdChrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $riskbirdChrome) { throw '未找到Chrome，请先安装或填写chrome.exe的实际路径。' }
$riskbirdProfile = Join-Path $env:LOCALAPPDATA 'riskbird-chrome-cdp'
& $riskbirdChrome --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 "--user-data-dir=$riskbirdProfile" 'https://www.riskbird.com/'
```

### macOS（终端，可直接复制）

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/riskbird-chrome-cdp" \
  'https://www.riskbird.com/'
```

如果Chrome装在用户Applications目录，请将首行改为实际路径。命令运行期间保留终端和Chrome窗口。

### Linux（有图形桌面的终端，可直接复制）

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.local/share/riskbird-chrome-cdp" \
  'https://www.riskbird.com/'
```

部分安装使用 `google-chrome-stable`，可替换首行。不要添加 `--no-sandbox`；无桌面的服务器不能直接照此完成可视化登录。macOS/Linux启动命令是准备指南，本项目尚未完成这些系统上的端到端查询实测。

## 如何检查启动成功

在Chrome中打开 `http://127.0.0.1:9222/json/version`；显示包含Browser字段的JSON说明调试服务响应。不要复制整个响应到公开页面；无需提供任何Cookie或WebSocket调试地址。

在技能目录中运行：

```powershell
# Windows
py scripts/check_environment.py
```

```bash
# macOS/Linux
python3 scripts/check_environment.py
```

工具只返回Python版本、系统、CDP是否就绪和下一步提示，不枚举标签页，不输出调试WebSocket地址。已有宿主浏览器而不使用CDP时用 `--skip-cdp`。用户明确改用其他本机端口时，例如 `--cdp-url http://127.0.0.1:9223`。

常见问题：

- 连接拒绝：Chrome未启动、参数未生效或端口不同。核对命令，不无限重试。
- 使用同一专用目录的Chrome已在运行但未启用调试：保存工作后仅正常关闭该专用窗口，再用命令重开；不强杀全部Chrome。
- 9222被其他程序占用：不要关闭未知程序，可选一个空闲本机端口，并把新端点告知Agent。
- 浏览器启动了但风鸟要求登录：用户在该专用窗口登录，完成验证码后继续。
- 普通浏览器能力已可用：复用它，无需重复启动CDP。

参考：[Python Windows安装](https://docs.python.org/3/using/windows.html)、[Python macOS安装](https://docs.python.org/3/using/mac.html)、[Python Unix安装](https://docs.python.org/3/using/unix.html)。
