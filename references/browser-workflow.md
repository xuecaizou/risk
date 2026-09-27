# 浏览器操作与分页

以下来自2026-09-21实际页面操作；页面可能变化。先观察当前页面，再使用对应定位器。这是宿主仅支持DOM或接口结构不兼容时的降级方案。优先使用 [web-api.md](web-api.md) 的已登录同源Web接口，无需识别筛选按钮；不要提取Cookie或浏览器配置文件。接口出现登录、验证、限流、付费限制时停止，不以切换UI绕过限制。

开始前先按 [setup.md](setup.md) 检查Python和浏览器。CDP连接失败时给出对应系统的启动命令及新窗口登录提醒，不要只回复“无法连接”或反复尝试同一未启动端点。

## 搜索与主体

- 官网：`https://www.riskbird.com/`。
- 搜索占位文字：`请输入企业名、人名等，多关键词用空格隔开`；填写后回车。
- 读取结果卡片内企业全称、统一社会信用代码和 `/ent/` 链接。不要输出账号手机号或无关联系方式。
- 详情页的 `entid` 是平台企业ID。用真实链接导航并再次核对主体。
- 沿用已授权会话；新建本任务专用标签更容易隔离。不要列出无关标签。仅为了读取网页，无需提取登录凭据。

## 表格定位

详情页为懒加载，先滚动到“直接投资”/“间接投资”，等真实名称和链接出现。空白骨架有序号但无数据，不能保存为结果。

Playwright参考（仅在支持该API且已授权的环境使用）：

```js
const module = page.locator('.xs-data-module-box')
  .filter({has:page.getByText('间接投资',{exact:true})});
const table = page.locator('table.table-box')
  .filter({hasText:'被间接投资企业'}); // 直接页：被投资企业
```

同名控件可在隐藏区域或工商信息表内出现，筛选控件应限定module及可见元素。例如在module内选择可见的“经营状态”，而不是全页首个同名文字。

直接投资A：比例设为“不限”，不做任何比例筛选；间接投资B：点击可见的“持股合计”→“50%及以上”。状态筛选：点击“经营状态”→可见tooltip中的“不限”。A、B都要核对状态不限，避免沿用上次“在营”过滤。仅用户明确要求时改选“在营”。等待菜单和请求完成，再读取筛选后计数。点击控件和立即读取之间，UI可能尚未更新。全部状态采集时不得根据某行“注销/吊销/撤销”等状态跳过记录。

实际列：序号、企业、法定代表人、注册资本、成立日期、地区、行业、[直接投资]、持股合计。不采集法定代表人个人联系方式。

- 主表行用 `:scope > tbody > tr`，列用 `:scope > td`。投资详情弹窗可能嵌套在表内；普通 `tbody tr` 会混入隐藏弹窗行。
- 企业名称/链接：第2列 `.td-ent-right a` 的首个名称span和href。
- 经营状态：第2列 `.td-ent-status`。
- 持股合计：末列 `.investment-beneficiary-ratio`；不要将整格弹窗文本当比例。
- 名单未显示统一社会信用代码时留空。无需访问每家公司补齐。

## 分页和检查点

页码 `aria-label="第 2 页"`；下一页按钮 `aria-label="下一页"`。较多页有数值输入 `aria-label="页"`，填写后回车。

网站可能先更新序号再更新企业内容。必须同时确认序号正确、名称存在、首条企业ID与上页不同，并等加载遮罩消失。不能仅靠序号就保存，也不要使用“点下一页直到空白”为结束条件。

`collect_visible_list.mjs` 只读取当前已配置好的查询分页，不代替主体选择或筛选设置。调用者传入从当前UI验证过的筛选后计数；每个批次最多10页，间隔至少4秒。脚本不会连接CDP、下载依赖或关闭用户浏览器。

```js
const {collectVisibleList}=await import('绝对路径/scripts/collect_visible_list.mjs');
const result=await collectVisibleList(page, {
  mode:'indirect', expectedCount:当前不限状态的页面计数, statusFilter:'all', sourceUrl:实际详情链接,
  checkpointPath:输出目录+'/B-checkpoint.json', maxPages:10, ratioFilter:'gte', minRatio:50
});
```

A传`ratioFilter:'all'`；B按实际读取范围传`all`或`gte`与`minRatio`。未记录范围的数据不能判为全量。

状态 `partial` 表示批次结束或当前请求失败，查看 `nextPage`/`error`。继续前核对浏览器已经处在 `nextPage`，必要时使用当前UI页码跳转；再次调用时传 `startPage` 和此前 `rows`（可从检查点读取）。不要重复采集后直接追加，必须校验序号和企业ID。

正常重试可以刷新同一页面、重新应用同样筛选再跳到断点。先保存数据；若出现明确限流/验证提示，停止而不是反复刷新。跨调用保存函数时避免依赖后来重绑定的REPL变量：将page、mode、结果显式传参，采用导出的模块函数。

## 穿透抽样

点击主表 `.investment-beneficiary-ratio`，读取可见 `role=dialog` 的“投资者、被间接投资企业、持股合计、股权路径”。示例验证过两段路径，但不要推断平台对所有企业都无限层穿透。关闭用当前观察到的控件（当日为dialog内 `img.close`）。路径默认按需展开，不对每行都点击。
