// Node.js 22+; built-in modules only. Connects to an existing user-authorized Chrome.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export function endpoint(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) ||
      !u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/')
    throw Error('CDP仅允许带端口的本机HTTP根地址');
  return u.origin;
}
export function site(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['www.riskbird.com','riskbird.com'].includes(u.hostname); }
  catch { return false; }
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', event => {
      const m = JSON.parse(event.data), job = this.pending.get(m.id);
      if (!job) return;
      clearTimeout(job.timer); this.pending.delete(m.id);
      m.error ? job.reject(Error('CDP执行错误')) : job.resolve(m.result);
    });
    ws.addEventListener('close', () => {
      for (const job of this.pending.values()) {clearTimeout(job.timer);job.reject(Error('CDP连接关闭'));}
      this.pending.clear();
    });
  }
  static async connect(url, origin) {
    const u = new URL(url), local = new URL(origin);
    if (u.protocol !== 'ws:' || u.hostname !== local.hostname || u.port !== local.port || u.username || u.password)
      throw Error('CDP目标地址与已授权本机端点不一致');
    const ws = new WebSocket(url);
    await new Promise((resolve,reject) => {
      const timer = setTimeout(()=>{ws.close();reject(Error('CDP连接超时'));},10000);
      ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP连接失败'));},{once:true});
    });
    return new CDP(ws);
  }
  send(method, params={}) {
    const id = ++this.id;
    return new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>{this.pending.delete(id);reject(Error('页面执行超时'));},40000);
      this.pending.set(id,{resolve,reject,timer});
      this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  close() { this.ws.close(); }
}
async function save(file, value) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2),'utf8');
  await fs.rename(file+'.tmp',file);
}
export function chooseCandidate(search, id) {
  const choices = search.candidates?.filter(x=>x.id === id) || [];
  if (choices.length !== 1 || !choices[0].name) throw Error('须从已核对的搜索结果指定唯一--entity-id，不自动选择首条');
  return choices[0];
}
function argsOf(args) {
  const [command,...rest]=args, options={};
  for(let i=0;i<rest.length;i+=2) {
    if(!rest[i]?.startsWith('--') || !rest[i+1] || rest[i+1].startsWith('--')) throw Error('参数须为--名称 值');
    options[rest[i].slice(2)]=rest[i+1];
  }
  return {command,options};
}
async function report(input,out,python) {
  return await new Promise((resolve,reject)=>{
    const child=spawn(python || (process.platform==='win32'?'py':'python3'),
      ['-B','-X','utf8',path.join(HERE,'build_result.py'),'--input',input,'--out',out],{stdio:'inherit',windowsHide:true});
    child.on('error',()=>reject(Error('Python未找到；输入已保存，可指定--python重新生成报告')));
    child.on('exit',code=>code===0?resolve():reject(Error('报告生成失败；输入与检查点已保留')));
  });
}
export async function main(args) {
  const {command,options:o}=argsOf(args);
  if(!['search','collect'].includes(command) || !o.out)
    throw Error('用法：node run_cdp.mjs search --keyword 企业名称 --out 搜索.json；collect --search-file 搜索.json --entity-id 已确认ID --input-name 原始输入 --reason 匹配依据 --out 输出目录 [--python Python路径]');
  if(command==='search' && !o.keyword) throw Error('--keyword必填');
  if(command==='collect' && (!o['search-file'] || !o['entity-id'] || !o['input-name'] || !o.reason))
    throw Error('collect必须提供搜索文件、已确认ID、原始输入及匹配依据');
  if(typeof WebSocket !== 'function') throw Error('需要Node.js 22或更新版本（内置WebSocket）');
  const pageSize=Number(o['page-size'] || 50), intervalMs=Number(o['interval-ms'] || 4000);
  if(![10,50].includes(pageSize) || !Number.isFinite(intervalMs) || intervalMs<4000)
    throw Error('page-size支持10/50；interval-ms不得低于4000');
  const origin=endpoint(o.cdp || 'http://127.0.0.1:9222');
  const response=await fetch(origin+'/json/list',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok) throw Error('CDP未就绪，请按setup.md启动专用Chrome并登录风鸟');
  const targets=(await response.json()).filter(t=>t.type==='page' && site(t.url) && (!o.target || t.id===o.target));
  if(targets.length!==1) throw Error('需保留一个用于本任务的风鸟标签，或用--target指定其ID；未选择无关标签');
  const cdp=await CDP.connect(targets[0].webSocketDebuggerUrl,origin);
  const source=await fs.readFile(path.join(HERE,'query_web_api.js'),'utf8');
  let last=0, stopped=false, payload;
  const stop=()=>{stopped=true;}; process.on('SIGINT',stop);
  const run=async options=>{
    if(stopped) throw Error('用户停止；已保存检查点');
    await wait(Math.max(0,intervalMs-(Date.now()-last))); last=Date.now();
    const result=await cdp.send('Runtime.evaluate',{expression:'('+source.trim()+')('+JSON.stringify(options)+')',awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails) {
      const desc=String(result.exceptionDetails.exception?.description || '页面请求失败').split('\n')[0];
      throw Error(desc.slice(0,350));
    }
    if(!result.result?.value) throw Error('页面未返回有效结果');
    return result.result.value;
  };
  const out=path.resolve(o.out), started=Date.now();
  try {
    if(command==='search') {
      const result=await run({action:'search',keyword:o.keyword,page:Number(o.page || 1)});
      await save(out,{...result,keyword:o.keyword,collected_at:new Date().toISOString()});
      console.log(JSON.stringify({total:result.total,candidates:result.candidates,file:out},null,2));
      return;
    }
    // Do not silently overwrite previous evidence. Use a fresh output directory per run.
    try {await fs.access(path.join(out,'查询输入.json'));throw Error('输出目录已有查询输入，请选择新的输出目录');}
    catch(e) {if(e.code!=='ENOENT') throw e;}
    const search=JSON.parse(await fs.readFile(o['search-file'],'utf8'));
    const candidate=chooseCandidate(search,o['entity-id']);
    const detail=await run({action:'detail',candidate});
    const empty=()=>({expected_count:null,complete:false,status_filter:'all',ratio_filter:'unknown',rows:[]});
    payload={root:detail.root,collected_at:new Date().toISOString(),min_ratio:50,status:'all',
      entity_resolution:{input_name:o['input-name'],search_terms:[search.keyword].filter(Boolean),selected_name:detail.root.企业名称,
        method:'agent_selected_candidate',reason:o.reason,user_confirmed:o['user-confirmed']==='true'},
      sources:{A:empty(),B:empty()}};
    const input=path.join(out,'查询输入.json');
    await save(input,payload);
    for(const [key,action] of [['A','direct'],['B','indirect']]) {
      const current=payload.sources[key]; let page=1;
      while(page) {
        const result=await run({action,page,pageSize,rootId:detail.root.企业ID,orderNo:detail.orderNo,
          ...(current.expected_count!==null?{expectedCount:current.expected_count}:{}),seenIds:current.rows.map(r=>r.企业ID)});
        const {rows,nextPage,...metadata}=result;
        Object.assign(current,metadata,{rows:[...current.rows,...rows],complete:nextPage===null,nextPage});
        current.page_filters=key==='A'?'直接投资无比例阈值；全部状态':'间接投资持股合计≥50%；全部状态';
        await save(input,payload);
        if(page===1 || page%10===0 || !nextPage) console.log(`${key==='A'?'直接投资':'间接控股'} ${current.rows.length}/${current.expected_count}`);
        page=nextPage;
      }
    }
    await report(input,out,o.python);
    const check=JSON.parse(await fs.readFile(path.join(out,'校验结果.json'),'utf8'));
    console.log(JSON.stringify({status:check.完整?'complete':'needs_review',seconds:Math.round((Date.now()-started)/1000),out}));
    if(!check.完整) process.exitCode=2;
  } catch(error) {
    if(payload) {
      payload.collection_error=String(error.message).slice(0,350);
      await save(path.join(out,'查询输入.json'),payload);
      await report(path.join(out,'查询输入.json'),out,o.python).catch(()=>{});
    }
    throw error;
  } finally {
    process.removeListener('SIGINT',stop); cdp.close();
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
