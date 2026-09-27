/* Execute this function in an authorized, logged-in Riskbird page. No imports. */
async function riskbirdWebQuery(options) {
  'use strict';
  const origin = location.origin;
  if (!['https://www.riskbird.com', 'https://riskbird.com'].includes(origin))
    throw new Error('请在已登录的风鸟页面执行，不支持本地HTML或其他站点');
  const routes = {
    search: '/riskbird-api/api/v1/companies/search',
    detail: '/api/ent/query',
    direct: '/riskbird-api/api/v1/companies/dimension/list/companyInvestDirect',
    indirect: '/riskbird-api/api/v1/companies/dimension/list/companyInvestPenetration'
  };
  const {action, page = 1, pageSize = 10, candidate, orderNo, rootId} = options;
  if (!Object.hasOwn(routes, action) || !Number.isInteger(page) || page < 1)
    throw new Error('action/page无效');
  const clean = v => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim() : '';
  const urlFor = (name, id) => origin + '/ent/' + encodeURIComponent(name) + '.html?entid=' + encodeURIComponent(id);
  let path = routes[action], body;
  if (action === 'search') {
    if (typeof options.keyword !== 'string' || !options.keyword.trim()) throw new Error('keyword必填');
    body = {queryType: '1', searchKey: options.keyword.trim(), pageNo: page, range: 10,
      selectConditionData: JSON.stringify({status: '', sort_field: '', keyword_fields: ''})};
  } else if (action === 'detail') {
    if (!candidate?.id || !candidate?.name) throw new Error('必须传入已经核对的候选主体');
    path += '?' + new URLSearchParams({entName: candidate.name, entId: candidate.id,
      fuzzyId: candidate.fuzzyId || '', position: candidate.position || ''});
  } else {
    if (!orderNo || !rootId) throw new Error('须使用本次详情返回的orderNo和rootId');
    if (![10,50].includes(pageSize)) throw new Error('列表pageSize仅支持已验证的10或50');
    if (options.ratioFilter !== undefined && !['all', 'gte50'].includes(options.ratioFilter))
      throw new Error('ratioFilter仅支持all/gte50');
    if (action === 'direct' && options.ratioFilter && options.ratioFilter !== 'all')
      throw new Error('直接投资不允许比例过滤');
    body = {filterCnd: page === 1 ? 1 : 0, page, size: pageSize, orderNo, sortField: '',
      filterMap: action === 'direct' || options.ratioFilter === 'all' ? {} : {all_prop: '50%及以上'}};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let json;
  try {
    const response = await fetch(path, {method: body ? 'POST' : 'GET', credentials: 'include',
      mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: action === 'detail' ? {accept: 'application/json'} :
        {accept: 'application/json', 'Content-Type': 'application/json', 'app-device': 'WEB',
          ...(['direct', 'indirect'].includes(action) ? {'xs-content-type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})});
    if (response.status !== 200) throw new Error('HTTP ' + response.status + '；停止并检查登录、权限或访问限制');
    try { json = await response.json(); } catch { throw new Error('非JSON响应；停止，不作为空结果'); }
    const state = String(json?.data?.state || json?.state || '');
    const message = String(json?.msg || json?.message || '');
    if (state === 'operation:too:fast')
      throw new Error('ACCESS_LIMIT: operation:too:fast；网站提示操作过快，已停止并保留进度；冷却后再查询，不自动重试');
    const detailReady = action === 'detail' && json?.code === undefined && json?.state === 2;
    if (!json || typeof json !== 'object' || Array.isArray(json) ||
        (json.code !== undefined && json.code !== 20000) || (state && !detailReady) ||
        /登录|未授权|token.*(?:无效|过期)|unauth|验证码|验证|频繁|限流|额度|购买|支付|充值|付费|解锁/i.test(message))
      throw new Error('接口业务状态异常（action=' + action + ', code=' + String(json?.code ?? 'none') +
        ', state=' + (/^[a-zA-Z0-9_:\-]{1,80}$/.test(state) ? state : state ? 'unrecognized' : 'none') +
        '）；先与正常网页请求对照，不当作零结果、不盲试参数');
  } finally { clearTimeout(timer); }
  const data = json.code === 20000 ? json.data : json;
  if (action === 'search') {
    if (!Array.isArray(data?.list) || data.total == null || data.total === '' ||
        !Number.isInteger(Number(data.total)) || Number(data.total) < 0)
      throw new Error('搜索返回结构变化');
    return {page, total: Number(data.total), candidates: data.list.map((r, i) => {
      const name = clean(r.entName || r.ENTNAME), id = clean(r.entid);
      if (!name || !id) throw new Error('候选主体身份缺失');
      return {name, id, status: clean(r.entStatus || r.ENTSTATUS),
        code: clean(r.creditCode || r.uniscid || r.creditNo || r.UNISCID),
        formerName: clean(r.historyName || r.oldName || r.entNameOld), region: clean(r.regionCn || r.dom || r.DOM),
        fuzzyId: String(data.fuzzyId || ''), position: (page - 1) * 10 + i + 1, url: urlFor(name, id)};
    })};
  }
  if (action === 'detail') {
    const info = data?.basicResult?.apiData?.list?.jbxxInfo;
    if (!data?.orderNo || info?.entid !== candidate.id || clean(info?.entName) !== clean(candidate.name))
      throw new Error('详情主体不一致或未返回查询标识');
    return {orderNo: data.orderNo, root: {企业名称: clean(info.entName), 企业ID: info.entid,
      统一社会信用代码: clean(info.creditCode || info.uniscid || info.creditNo || candidate.code),
      经营状态: clean(info.companyTag?.status || info.entStatus || candidate.status), 链接: urlFor(info.entName, info.entid)}};
  }
  if (!Array.isArray(data?.apiData) || !Number.isInteger(data.totalCount) || data.totalCount < 0)
    throw new Error('投资列表结构变化，不作为零条结果');
  if (options.expectedCount !== undefined && options.expectedCount !== data.totalCount)
    throw new Error('分页期间总数变化，请重新核对列表');
  if (page > Math.max(1, Math.ceil(data.totalCount / pageSize)) ||
      data.apiData.length !== Math.min(pageSize, Math.max(0, data.totalCount - (page - 1) * pageSize)))
    throw new Error('分页条数或页码异常，不作为正常结束');
  const seen = new Set(options.seenIds || []);
  const rows = data.apiData.map((r, i) => {
    const name = clean(r.entName), id = clean(r.entid);
    if (!name || !id || seen.has(id)) throw new Error('企业身份缺失或分页重复');
    seen.add(id);
    return {序号: (page - 1) * pageSize + i + 1, 企业名称: name, 企业ID: id,
      统一社会信用代码: clean(r.creditCode || r.uniscid || r.creditNo), 经营状态: clean(r.entStatus),
      直接投资: clean(r.directProp), 持股合计: clean(r.allProp), 地区: clean(r.regionCn),
      行业: clean(r.nic), 注册资本: clean(r.regCap), 成立日期: clean(r.esDate), 链接: urlFor(name, id)};
  });
  const filtered = action === 'indirect' && options.ratioFilter !== 'all';
  return {rootId, mode: action, page, page_size: pageSize, expected_count: data.totalCount, endpoint: routes[action],
    status_filter: 'all', ratio_filter: filtered ? 'gte' : 'all', ...(filtered ? {min_ratio: 50} : {}),
    transport: 'browser-same-origin-fetch', rows,
    nextPage: page * pageSize < data.totalCount ? page + 1 : null};
}
