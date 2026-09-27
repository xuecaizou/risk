# Web接口优先采集

本说明于2026-09-27对照当前网页请求验证了搜索、详情与两类投资列表。它不是风鸟公开、稳定或付费API的承诺。运行时仍须验证响应结构，失败不代表零条结果。已授权本机CDP环境优先用 [cdp-runner.md](cdp-runner.md) 的现成执行器，不重新编写连接代码。

## 路径选择

1. 宿主允许当前页面JavaScript和同源请求时，在用户已登录风鸟的页面执行下面的接口流程。不必识别“筛选”“下一页”按钮，也不必打开F12。
2. 宿主只提供网络响应读取时，可读取该任务页面已经产生的Fetch/XHR JSON；需要分页时用宿主允许的同会话请求能力。仅拿到第一页不算完整。
3. 宿主禁止页面fetch/网络调用或只提供DOM时，使用 [browser-workflow.md](browser-workflow.md) 的UI方案，不用外部运行时绕过宿主限制。WorkBuddy等宿主能否执行第1种方式以其实际工具为准，不假定具备Playwright。

浏览器须位于 `https://www.riskbird.com` 或 `https://riskbird.com`。同源请求采用当前页面的origin和登录会话；以下均为相对路径。不要从本地HTML直接请求网站，不要把Cookie、Token、Authorization、HAR或登录资料复制进脚本、技能、报告或对话。浏览器自动携带会话即可。

## 已有适配器使用的接口

| 用途 | 方法 | 相对路径 | 结果关键字段 |
| --- | --- | --- | --- |
| 按全称/简称搜索 | POST | `/riskbird-api/api/v1/companies/search` | `list`、`total`、`fuzzyId` |
| 获取主体详情和本次查询标识 | GET | `/api/ent/query` | `orderNo`、`basicResult.apiData.list.jbxxInfo` |
| 直接投资（A） | POST | `/riskbird-api/api/v1/companies/dimension/list/companyInvestDirect` | `apiData`数组、`totalCount` |
| 间接投资（B） | POST | `/riskbird-api/api/v1/companies/dimension/list/companyInvestPenetration` | `apiData`数组、`totalCount` |

上述字段指业务数据层：`code === 20000`时读取`response.data`；部分既有响应直接返回业务对象。必须验证结构，不能只因HTTP 200就认为成功。详情接口可以直接返回顶层`state:2`和`orderNo`，此状态表示完成，不能当成访问限制；仍须核对`basicResult.apiData.list.jbxxInfo`的主体身份。

同源请求选项：`credentials:'include'`、`mode:'same-origin'`、`redirect:'error'`、`cache:'no-store'`。**请求头必须按接口区分**：搜索发送`accept: application/json`、`Content-Type: application/json`、`app-device: WEB`，不发送`xs-content-type`；详情GET仅需`accept: application/json`；直接/间接投资列表发送前述三个头并额外带`xs-content-type: application/json`。在线对照表明，把列表用的xs-content-type带到搜索会产生误导性的无数据响应；从列表删除该头则可能产生服务端Content-Type错误。不要统一增删该头。若当前站点要求其他认证流程，回到正常页面登录/验证；不得猜测或提取私有凭据。

### 搜索

```json
{"queryType":"1","searchKey":"用户原始名称或简称","pageNo":1,"range":10,"selectConditionData":"{\"status\":\"\",\"sort_field\":\"\",\"keyword_fields\":\"\"}"}
```

按 [entity-resolution.md](entity-resolution.md) 判断唯一主体。`entName`/`ENTNAME`为名称、`entid`为企业ID，另读取信用代码、地区和曾用名；不能无条件选择第一条。`fuzzyId`取本次搜索返回值，`position`取候选在搜索结果的实际序位。

### 详情

查询参数为`entName`、`entId`、`fuzzyId`、`position`，通过`URLSearchParams`编码。注意参数`entId`与响应`entid`大小写不同。

核对`jbxxInfo.entName`和`jbxxInfo.entid`对应已选主体。取本次`orderNo`用于列表请求；它是查询上下文，不是平台企业ID，也不是PID。不要沿用其他企业或失效会话的orderNo。只在本次内存会话中保存，不写入发布包或报告。

### 直接投资：无比例或状态限制

```json
{"filterCnd":1,"page":1,"size":10,"orderNo":"本次详情返回值","sortField":"","filterMap":{}}
```

**A的`filterMap`必须为空对象**，不发送`all_prop`、直接投资比例或经营状态条件。低于50%、0%、空白或未知比例也保留，比例只是原始字段。平台的“直接投资”分类按原样记录，不把该列表所有企业称为直接控股。

### 间接投资：持股合计≥50%，全部经营状态

```json
{"filterCnd":1,"page":1,"size":10,"orderNo":"本次详情返回值","sortField":"","filterMap":{"all_prop":"50%及以上"}}
```

经营状态默认不传；禁止复用带“在营”的历史filterMap。B在报告生成时仍用Decimal按≥50%校验边界。用户自定义阈值时可用`filterMap:{}`读取全部间接投资再本地筛选，不编造服务端筛选枚举。显式要求仅在营时，也可全量读取后本地筛选，保留实际`status_filter:'all'`。

### 分页与字段

- 页码从1开始；2026-09-27在线验证支持每页10或50条，CDP执行器默认50条以减少请求。首请求`filterCnd:1`，后续页`filterCnd:0`；逐页增加`page`，保持同一orderNo和filterMap。
- 总页数为`ceil(totalCount/size)`；第一响应的`totalCount`是原始计数。全程核对总数不变、每页条数正确、企业ID不重复；不能凭空页判定结束。零条只接受有效响应明确给出`totalCount:0, apiData:[]`。
- 每页校验后立即保存白名单字段检查点。顺序请求，间隔至少4秒；建议每10页汇报进度，向用户汇报并继续。批次结束不等于完整。
- HTTP 401/403/402/412/429、非JSON、异常业务码、不符合接口成功结构的`state`（详情的2除外）、登录/验证/额度/付费提示：保存已获取数据并停止；不是零结果，不自动切换UI绕过限制。普通连接失败可在确认无访问限制后同页重试最多两次；现成CDP执行器默认直接保存并退出，由Agent核实后决定。
- `complete:true`仅在总数、所有页、连续序号和去重检查都通过后写入。续查须验证主体、查询时点、实际筛选范围；查询上下文失效时重新查询并核对，不拼接不同快照。

| 接口字段 | 本地字段 |
| --- | --- |
| `entName`、`entid` | 企业名称、企业ID |
| `entStatus` | 经营状态，空缺留空 |
| `creditCode` / `uniscid` / `creditNo` | 统一社会信用代码，缺失留空 |
| `directProp`、`allProp` | 直接投资、持股合计（保留原始百分比文本） |
| `regionCn`、`nic`、`regCap`、`esDate` | 地区、行业、注册资本、成立日期 |

不要假设裸数0.5代表50%；未验证单位时留作待核查。B比例未知需标记未完成核查；A不依赖比例入选。序号用`(page-1)*pageSize+index+1`。PID统一为查询起点企业ID，不从orderNo生成。

遇`operation:too:fast`明确按网站限速处理：停止并保存进度，不自动重试，不改成零结果。默认4秒间隔是本次优化后的设置，仍不保证所有账号或时段都不触发限制。

## 无按钮助手

[scripts/query_web_api.js](../scripts/query_web_api.js) 定义一个可在页面内执行的自包含异步函数`riskbirdWebQuery(options)`，无需Node模块或额外pip包。每次仅发一个请求，调用者负责间隔、逐页落盘及汇总。只输出业务白名单字段，不返回整份详情或账号资料。

如宿主已有已授权的Playwright Page与文件读取能力，可读取函数源码后传给`page.evaluate`：

```js
// 只在宿主允许页面evaluate/fetch时使用；不安装或启动其他浏览器运行时。
const source = await fs.readFile(skillPath + '/scripts/query_web_api.js', 'utf8');
const runQuery = options => page.evaluate('(' + source.trim() + ')(' + JSON.stringify(options) + ')');
const search = await runQuery({action:'search', keyword:用户输入});
// 依据实体匹配规则选择candidate；有实质歧义时先让用户选择。
const detail = await runQuery({action:'detail', candidate:已确认候选});
const firstA = await runQuery({action:'direct', orderNo:detail.orderNo, rootId:detail.root.企业ID, page:1, pageSize:50});
// 间隔至少4秒；有nextPage则继续直接列表，并将expectedCount和seenIds传入后续页校验。
const firstB = await runQuery({action:'indirect', orderNo:detail.orderNo, rootId:detail.root.企业ID, page:1, pageSize:50});
```

以上是调用形状示例，变量由当前宿主提供；不是复制到Shell直接执行的命令。WorkBuddy具备“执行页面JavaScript”时可用同一个函数；如只有DOM工具则走UI降级。不要声称未测试的宿主已验证兼容。

每个来源汇总为`{expected_count,complete,status_filter,ratio_filter,min_ratio?,page_filters,endpoint,transport,rows}`，传给`build_result.py`。助手返回的`nextPage:null`仅说明该响应是最后一页；调用者仍须检查先前各页都已保存，不可直接当作全量完成。原始响应可能含额外信息，默认不保存整份响应或HAR。
