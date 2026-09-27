# 输入及输出约定

`build_result.py` 接受UTF-8 JSON；推荐直接读取采集检查点中的rows组装输入。以下为占位示例，不含真实企业信息；不要把示例数字或日期当成实时结果。

```json
{
  "root": {"企业名称":"用户选定的完整名称", "经营状态":"在营", "统一社会信用代码":"", "企业ID":"实际entid", "链接":"实际详情URL"},
  "collected_at":"2000-01-01T00:00:00+08:00",
  "entity_resolution":{"input_name":"用户输入的简称或全称","search_terms":[],"selected_name":"用户选定的完整名称","method":"unique_supported_candidate","reason":"本次匹配依据","user_confirmed":false},
  "min_ratio":50,
  "status":"all",
  "sources":{
    "A":{"expected_count":0,"complete":true,"status_filter":"all","ratio_filter":"all","page_filters":"直接投资不设持股阈值，经营状态不限","rows":[]},
    "B":{"expected_count":0,"complete":true,"status_filter":"all","ratio_filter":"gte","min_ratio":50,"page_filters":"持股合计≥50%，经营状态不限","rows":[]}
  },
  "evidence": []
}
```

- `status`：`all`或`在营`，默认`all`。全部状态均保留原文，缺失留空；不自动排除注销、吊销、撤销、停业等企业。仅用户明确要求时用`在营`。
- 每个来源的 `status_filter` 记录浏览器实际应用的状态条件：`all`或`在营`。要求全状态时，来源必须是`all`才能通过完整性校验；缺失或仅在营的旧数据不得冒充全状态。`page_filters`为便于阅读的补充说明，不代替此结构化字段。
- `entity_resolution`记录原始简称/全称及匹配依据；selected_name须与root企业名称一致。实质歧义未解决时不得开始投资采集。
- A固定不设持股阈值。旧字段`direct_basis`不再生效。A记录`ratio_filter:"all"`，未知或已过滤的旧A数据不通过完整性校验。B可记录`ratio_filter:"all"`或`"gte"`并附原始筛选的`min_ratio`；原始阈值须小于等于目标阈值才能覆盖目标范围。不能通过改元信息补齐旧数据。
- `min_ratio`为0至100的数值，默认50，仅对B生效，按包含边界比较。
- 每行字段：`序号`（来源列表序号）、`企业名称`、`经营状态`、`统一社会信用代码`（可空）、`企业ID`、`链接`、`直接投资`（例如`60%`）、`持股合计`（例如`60%`），可带`地区/行业/注册资本/成立日期/中间股权链`。
- 比例须有`%`或`％`；A比例缺失不影响入选；B未知比例需待核查，不用0替代。不支持含糊的区间、四舍五入后跨边界、默认0.5就是50%的猜测。
- `endpoint`记录来源接口相对路径，`transport`记录采集方式；不要保存orderNo或认证信息。
- 接口助手直接返回上述下划线字段；DOM助手的检查点字段需映射：`expectedCount→expected_count`、`statusFilter→status_filter`、`ratioFilter→ratio_filter`、`minRatio→min_ratio`，并保留其`complete`与`rows`。不要仅复制rows后默认补写完整。
- `expected_count`是当前接口或页面所选筛选条件下的原始条数，不是本地再筛选后的条数。`complete`由采集确认；脚本还核验数量与序号连续性。失效或失败的列表不得标为complete。
- `evidence`可保存真实观察到的路径文本/相对证据文件名。不要附加登录账号信息、Cookie等。

输出五个必需字段：企业名称、经营状态、统一社会信用代码、PID、数据关联。`数据关联`为数组，包含根公司ID/名称、直接或间接、阈值所用比例（A为空并注明不设阈值）、原始直接比例/合计比例、来源URL、来源序号、时间、中间链路。

同一企业出现于A和B时合并企业但保留两条关联。先使用信用代码，同平台ID用于将“有代码/无代码”的记录关联到同一企业。名称只帮助人工判断，不自动将同名企业合并。身份矛盾、无有效企业ID/信用代码或同一来源列表重复企业会使完整性不通过，详情写入校验结果。

输出：名单C.json（含根公司、A/B入选名单、C和校验）；查询结果.html（无需服务即可搜索、筛选）；查询说明.md；校验结果.json。缺失字段留空，部分结果明确标注。
