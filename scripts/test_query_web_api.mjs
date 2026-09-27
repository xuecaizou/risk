// Synthetic responses only; these tests do not contact Riskbird.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const code = await readFile(new URL('./query_web_api.js', import.meta.url), 'utf8');
const row = (id, allProp='1%') => ({entName:'虚构企业'+id, entid:id, allProp, entStatus:'注销', directProp:'1%', accountSecret:'DO-NOT-EXPORT'});
function setup(responses, origin='https://www.riskbird.com') {
  const calls = [];
  const context = vm.createContext({location:{origin}, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({url, options});
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return {status:response.status ?? 200, json: async () => {if(response.nonJson) throw Error('html'); return response.json;}};
    }});
  vm.runInContext(code, context);
  return {calls, query: options => context.riskbirdWebQuery(options),
    evaluate: options => vm.runInContext('(' + code.trim() + ')(' + JSON.stringify(options) + ')', context)};
}
const ok = data => ({json:{code:20000,data}});
const list = (apiData, totalCount=apiData.length) => ok({apiData,totalCount});
const opts = {orderNo:'synthetic-query',rootId:'synthetic-root'};

test('direct has no filters, retains low/missing ratios and non-active rows, exports whitelist', async()=>{
  const {query,calls} = setup([list([row('a'),row('b','--'),row('c','')])]);
  const data=await query({...opts,action:'direct'});
  assert.deepEqual(JSON.parse(calls[0].options.body).filterMap,{});
  assert.equal(data.rows.length,3);
  assert.equal(data.rows[0].经营状态,'注销');
  assert.equal(data.ratio_filter,'all');
  assert.equal(data.status_filter,'all');
  assert.equal(calls[0].options.credentials,'include');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.headers['xs-content-type'],'application/json');
  assert(!JSON.stringify(data).includes('DO-NOT-EXPORT'));
  assert(!JSON.stringify(data).includes('synthetic-query'));
});
test('indirect filter applies only all_prop; custom thresholds can fetch all', async()=>{
  const {query,calls}=setup([list([row('a','50%')]),list([])]);
  const data=await query({...opts,action:'indirect'});
  assert.deepEqual(JSON.parse(calls[0].options.body).filterMap,{all_prop:'50%及以上'});
  assert.equal(data.min_ratio,50);
  await query({...opts,action:'indirect',ratioFilter:'all'});
  assert.deepEqual(JSON.parse(calls[1].options.body).filterMap,{});
});
test('pagination checks count, offsets and duplicates',async()=>{
  const {query,calls}=setup([list(Array.from({length:10},(_,i)=>row(String(i))),11),list([row('last')],11),list([row('last')],11),list([row('new')],12)]);
  const first=await query({...opts,action:'direct'});
  assert.equal(first.nextPage,2);
  const second=await query({...opts,action:'direct',page:2,expectedCount:11,seenIds:first.rows.map(r=>r.企业ID)});
  assert.equal(second.nextPage,null);
  assert.equal(second.rows[0].序号,11);
  assert.equal(JSON.parse(calls[1].options.body).filterCnd,0);
  await assert.rejects(query({...opts,action:'direct',page:2,seenIds:['last']}),/重复/);
  await assert.rejects(query({...opts,action:'direct',page:2,expectedCount:11}),/总数变化/);
});
test('search produces candidates without choosing first; detail binds query to identity',async()=>{
  const a={entName:'虚构甲企业',entid:'a'}, b={entName:'虚构乙企业',entid:'b'};
  const {query,calls}=setup([ok({list:[a,b],total:2,fuzzyId:'synthetic-search'}),ok({orderNo:'context',basicResult:{apiData:{list:{jbxxInfo:b}}}}),ok({orderNo:'context',basicResult:{apiData:{list:{jbxxInfo:a}}}})]);
  const search=await query({action:'search',keyword:'虚构'});
  assert.equal(search.candidates.length,2);
  assert.equal(JSON.parse(calls[0].options.body).searchKey,'虚构');
  assert.equal(calls[0].options.headers['xs-content-type'],undefined);
  assert.equal(calls[0].options.headers.accept,'application/json');
  const detail=await query({action:'detail',candidate:search.candidates[1]});
  assert.equal(detail.root.企业ID,'b');
  assert(calls[1].url.includes('entId=b'));
  assert.equal(calls[1].options.method,'GET');
  assert.deepEqual(Object.keys(calls[1].options.headers),['accept']);
  await assert.rejects(query({action:'detail',candidate:search.candidates[1]}),/主体不一致/);
});
test('access errors and non-JSON are not empty lists and do not retry',async()=>{
  for(const response of [{status:401},{status:403},{status:402},{status:412},{status:429},{nonJson:true},
    {json:{code:50000,data:{}}},ok({state:'limit:auth',apiData:[],totalCount:0}),{json:{code:20000,msg:'请购买权益',data:{apiData:[],totalCount:0}}}]){
    const {query,calls}=setup([response]);
    await assert.rejects(query({...opts,action:'direct'}));
    assert.equal(calls.length,1);
  }
});
test('malformed and missing pages fail; only explicit zero is zero',async()=>{
  const {query}=setup([ok({}),list([],11),list([],0)]);
  await assert.rejects(query({...opts,action:'direct'}),/结构变化/);
  await assert.rejects(query({...opts,action:'direct'}),/分页/);
  assert.equal((await query({...opts,action:'direct'})).expected_count,0);
});
test('foreign origin and filtered direct calls are rejected before network',async()=>{
  const foreign=setup([],'https://example.invalid');
  await assert.rejects(foreign.query({...opts,action:'direct'}));
  assert.equal(foreign.calls.length,0);
  const local=setup([]);
  await assert.rejects(local.query({...opts,action:'direct',ratioFilter:'gte50'}));
  assert.equal(local.calls.length,0);
});
test('documented page-evaluate expression returns the page data',async()=>{
  const {evaluate}=setup([list([row('example')])]);
  const data=await evaluate({...opts,action:'direct'});
  assert.equal(data.rows[0].企业ID,'example');
});
test('detail state=2 is a completed result, and still verifies identity',async()=>{
  const candidate={id:'sample',name:'虚构示例企业'};
  const data={state:2,orderNo:'private-context',detailResult:{state:2},basicResult:{apiData:{list:{jbxxInfo:{entid:'sample',entName:'虚构示例企业',uniscid:'SYNTHETIC'}}}}};
  const {query}=setup([{json:data},{json:{...data,state:1}},{json:null}]);
  const result=await query({action:'detail',candidate});
  assert.equal(result.root.统一社会信用代码,'SYNTHETIC');
  await assert.rejects(query({action:'detail',candidate}),/业务状态异常/);
  await assert.rejects(query({action:'detail',candidate}),/业务状态异常/);
});
test('3000000 is not silently converted to a zero result',async()=>{
  const {query}=setup([{json:{code:3000000,msg:'暂时没有找到相关数据'}}]);
  await assert.rejects(query({action:'search',keyword:'虚构'}),/code=3000000/);
});
test('verified 50-row pages use correct last-page count and sequence',async()=>{
  const {query,calls}=setup([list(Array.from({length:50},(_,i)=>row(String(i))),51),list([row('last')],51)]);
  const first=await query({...opts,action:'direct',pageSize:50});
  assert.equal(first.nextPage,2);
  assert.equal(JSON.parse(calls[0].options.body).size,50);
  const last=await query({...opts,action:'direct',pageSize:50,page:2,expectedCount:51,seenIds:first.rows.map(r=>r.企业ID)});
  assert.equal(last.rows[0].序号,51);
  assert.equal(last.nextPage,null);
});
test('operation too fast is explicitly a rate limit, no automatic retry',async()=>{
  const {query,calls}=setup([ok({state:'operation:too:fast',msg:'操作太快'})]);
  await assert.rejects(query({...opts,action:'indirect'}),/ACCESS_LIMIT.*operation:too:fast/);
  assert.equal(calls.length,1);
});
