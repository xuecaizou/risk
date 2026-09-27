import test from 'node:test';
import assert from 'node:assert/strict';
import {endpoint,site,chooseCandidate} from './run_cdp.mjs';
test('CDP endpoint must stay on explicitly selected loopback origin',()=>{
  assert.equal(endpoint('http://127.0.0.1:9222'),'http://127.0.0.1:9222');
  for(const u of ['https://127.0.0.1:9222','http://example.com:9222','http://localhost:9222/path','http://u:p@localhost:9222','http://localhost:9222/?x=1']) assert.throws(()=>endpoint(u));
});
test('page origin matching rejects hostname-prefix lookalikes',()=>{
  assert(site('https://www.riskbird.com/ent/example'));
  assert(!site('https://www.riskbird.com.attacker.invalid/'));
  assert(!site('file:///tmp/riskbird.com.html'));
});
test('explicit entity ID required; no automatic first search result',()=>{
  const search={candidates:[{name:'虚构甲',id:'a'},{name:'虚构乙',id:'b'}]};
  assert.equal(chooseCandidate(search,'b').name,'虚构乙');
  assert.throws(()=>chooseCandidate(search,''));
  assert.throws(()=>chooseCandidate({candidates:[...search.candidates,search.candidates[1]]},'b'));
});
