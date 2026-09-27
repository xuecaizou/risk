import fs from 'node:fs/promises';
import path from 'node:path';

// A Page is supplied by the authorized host. No connection, credentials or API calls.
export async function collectVisibleList(page, options) {
  const {mode, expectedCount, sourceUrl, checkpointPath, startPage=1,
    rows:previous=[], maxPages=10, intervalMs=4000, statusFilter='unknown', ratioFilter='unknown', minRatio}  = options;
  if (!['direct','indirect'].includes(mode) || !Number.isInteger(expectedCount) || expectedCount<0)
    throw new Error('mode/expectedCount无效');
  if (!Number.isInteger(startPage) || startPage<1 || maxPages<1 || maxPages>10)
    throw new Error('分页参数无效；每批最多10页');
  if (!['all','gte','unknown'].includes(ratioFilter)) throw new Error('ratioFilter无效');
  if (!['all','在营','unknown'].includes(statusFilter)) throw new Error('statusFilter无效');
  const url = new URL(sourceUrl);
  if(url.hostname!=='www.riskbird.com' || !url.searchParams.get('entid'))
    throw new Error('必须提供已验证的风鸟企业详情URL');
  if(new URL(page.url()).searchParams.get('entid')!==url.searchParams.get('entid'))
    throw new Error('当前企业与指定来源不符');
  const header=mode==='direct'?'被投资企业':'被间接投资企业';
  const table=page.locator('table.table-box').filter({hasText:header});
  const module=page.locator('.xs-data-module-box').filter({has:page.getByText('间接投资',{exact:true})});
  const result={mode,sourceUrl,expectedCount,statusFilter,ratioFilter,minRatio,rows:[...previous],lastPage:startPage-1,nextPage:startPage,
    complete:false,status:'partial',error:'',collectedAt:new Date().toISOString()};
  const save=async()=>{
    await fs.mkdir(path.dirname(checkpointPath),{recursive:true});
    await fs.writeFile(checkpointPath+'.tmp',JSON.stringify(result,null,2),'utf8');
    await fs.rename(checkpointPath+'.tmp',checkpointPath);
  };
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const read=async()=>table.locator(':scope > tbody > tr').evaluateAll(rs=>rs.map(r=>{
    const c=[...r.querySelectorAll(':scope > td')],a=c[1]?.querySelector('.td-ent-right a');
    return {序号:c[0]?.textContent.trim(),企业名称:a?.querySelector('span')?.textContent.trim()||'',
      经营状态:c[1]?.querySelector('.td-ent-status')?.textContent.trim()||'',统一社会信用代码:'',
      企业ID:a?.href?new URL(a.href).searchParams.get('entid')||'':'',链接:a?.href||'',
      注册资本:c[3]?.textContent.trim()||'',成立日期:c[4]?.textContent.trim()||'',
      地区:c[5]?.textContent.trim()||'',行业:c[6]?.textContent.trim()||'',
      直接投资:c.length===9?c[7]?.textContent.trim()||'':'',
      持股合计:c.at(-1)?.querySelector('.investment-beneficiary-ratio')?.textContent.trim()||c.at(-1)?.textContent.trim()||''};
  }));
  try {
    if(await module.count()!==1)throw new Error('投资模块定位不唯一，需检查页面');
    if(expectedCount===0){
      // Do not accept the transient empty table as a genuine zero.
      const label=module.locator('.ref-sec-title').filter({hasText:mode==='direct'?'直接投资':'间接投资'});
      if((await label.locator('.ref-sec-title-count').innerText({timeout:3000})).trim()!=='0' ||
        !(await module.innerText()).includes('没有记录'))throw new Error('页面未同时明确显示0和无记录');
      result.complete=true;result.status='complete';result.nextPage=null;await save();return result;
    }
    const totalPages=Math.ceil(expectedCount/10);
    if(startPage>totalPages || previous.length!==(startPage-1)*10)
      throw new Error('续查数据与startPage不匹配');
    if(previous.some((r,i)=>Number(r.序号)!==i+1))throw new Error('续查序号不连续');
    let lastFirst=previous.length?previous.at(-10)?.企业ID:null;
    for(let p=startPage;p<=totalPages && p<startPage+maxPages;p++){
      let batch=null;
      const deadline=Date.now()+12000;
      while(Date.now()<deadline){
        const dialogs=await page.getByRole('dialog').filter({visible:true}).allTextContents();
        if(dialogs.some(x=>/验证码|安全验证|登录|购买|支付|频繁|访问受限/.test(x)))
          throw new Error('页面要求验证、登录、付费或访问受限；停止自动操作');
        if(await table.count()===1){
          const candidate=await read();
          const busy=await module.locator('.xs-data-module-loading-mask').filter({visible:true}).count();
          const size=Math.min(10,expectedCount-(p-1)*10);
          if(!busy && candidate.length===size && candidate.every((r,i)=>r.企业名称&&r.企业ID&&Number(r.序号)===(p-1)*10+i+1)
            && (!lastFirst||candidate[0].企业ID!==lastFirst)){
            await sleep(350);
            const second=await read();
            if(JSON.stringify(candidate)===JSON.stringify(second)){batch=second;break;}
          }
        }
        await sleep(350);
      }
      if(!batch)throw new Error(`第${p}页加载未通过校验；保留断点，勿当作结束`);
      if(new Set([...result.rows,...batch].map(x=>x.企业ID)).size!==result.rows.length+batch.length)
        throw new Error('同一来源列表出现重复企业，需复核页面');
      result.rows.push(...batch);result.lastPage=p;result.nextPage=p<totalPages?p+1:null;
      result.complete=p===totalPages;result.status=result.complete?'complete':'partial';await save();
      lastFirst=batch[0].企业ID;
      if(result.complete||p===startPage+maxPages-1)break;
      await sleep(Math.max(4000,intervalMs));
      const next=module.getByRole('button',{name:'下一页',exact:true}).filter({visible:true});
      if(await next.count()!==1||await next.isDisabled())throw new Error('尚未达到计数但下一页不可用');
      await next.click({timeout:4000});
    }
  } catch(error) {
    result.status='blocked';result.complete=false;result.error=String(error.message||error);
    await save();
  }
  return result;
}
