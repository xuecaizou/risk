# 现成CDP执行器：不要现场重写连接脚本

适用：用户已授权本机Chrome/CDP，Agent可运行本机命令。使用附带的`scripts/run_cdp.mjs`，不再临时编写`cdp_eval.js`、关键词探测或抓包脚本。宿主限制外部CDP时，仍遵从宿主限制并使用其浏览器工具。

## 依赖

- Node.js 22+（内置fetch、WebSocket），无npm包依赖，不需要Playwright。优先使用WorkBuddy/Codex等宿主已有Node；找不到时按实际环境提供安装指导，不硬编码某台电脑的路径。
- Python 3.9+用于报告，仅标准库；Windows默认命令`py`，其他系统`python3`。宿主已有Python但不在PATH时，用`--python`指定解释器绝对路径。
- 已启动本机CDP并登录风鸟；准备命令见 [setup.md](setup.md)。仅保留一个用于本任务的风鸟标签，多个任务标签时用`--target`指定已确认的CDP目标ID。不得读取或输出无关标签内容。

## 两步调用

在技能目录运行。以下均为占位符，由Agent替换为实际输入、路径及核对结果。

```text
node scripts/run_cdp.mjs search --keyword "用户原始简称或全称" --out "搜索结果.json"
```

读取候选并按 [entity-resolution.md](entity-resolution.md) 核对。必要时用已有证据支持的全称再次搜索。可用`--page 2`读取后续搜索页，不假定首条或第一页就是用户主体。脚本不内置真实企业别名表。

```text
node scripts/run_cdp.mjs collect --search-file "搜索结果.json" --entity-id "核对过的企业ID" --input-name "用户原始输入" --reason "实际匹配依据" --out "新的查询输出目录" --python "可用Python解释器路径"
```

已有可用默认Python时省略`--python`。用户确实选定主体才传`--user-confirmed true`，Agent自动匹配不冒充用户确认。Windows路径带空格时，PowerShell用`& "Node解释器绝对路径"`启动，余下参数同上。可用`--page-size 10`切换为已验证的10条分页，或用`--interval-ms 6000`进一步降低频率；不得在分页途中改变pageSize。可选`--cdp http://127.0.0.1:9222`指定已授权的本机端点，不支持公网端点。

执行器自动获取本次详情、依次采集全量A和≥50%的B，逐页校验及保存`查询输入.json`，最后调用Python生成HTML、JSON和校验结果。每10页输出进度；Agent应继续等待，不能把命令转入后台后就宣称完成。投资列表默认每页50条，顺序请求间隔至少4秒，不提高并发来追求速度。

## 完成和错误

- `status:complete`以报告校验为准，`needs_review`需查看校验结果。异常退出时保留已采集的数据并尽可能生成明确标注为部分的报告。
- 收到业务异常不自动重试、不扫描不同queryType、不批量更换关键词，也不自动转UI绕过权限。HTTP 200不证明登录有效，业务“暂无数据”不必然代表企业不存在。
- 先查看错误中的action/code/state。若当前接口行为与已验证格式不同，只做一次正常页面同请求对照；记录脱敏差异后停止查询任务中的无休止适配。
- 验证码、登录失效、额度/访问限制或付费要求出现时按网站提示处理，保留断点供核查。程序不自动切换账号或代理。
- 本版不在跨会话间复用orderNo，不将它写入输出。异常后重跑需使用新目录，从第一页重新核对，不盲目拼接旧快照；旧检查点保留。不要承诺已经支持自动断点续跑。
- 退出关闭的是本执行器的CDP连接，不关闭Chrome及用户标签。

性能主要取决于页数与网站响应：默认每页50条，数千条名单正常需要数分钟；首次环境准备、验证提示不计为纯采集耗时。不承诺所有企业都在一分钟内完成。
