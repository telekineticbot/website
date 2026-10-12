const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
const code=fs.readFileSync('assets/replay.js','utf8');
function fixture({decision,restricted=false,path='/',blocked=false}={}) {
 const scripts=[], saved=[], body=[], callbacks={}; let reloads=0;
 function element(tag) { const children={}; return {tag,style:{},hidden:false,handlers:{},setAttribute(){},addEventListener(n,f){this.handlers[n]=f;},focus(){},querySelector(s){return children[s]||(children[s]=element('child'));}}; }
 const window={}; const context={window,location:{hostname:'telekinetic.bot',pathname:path,reload(){reloads++;}},navigator:{globalPrivacyControl:restricted},
 localStorage:{getItem(){if(blocked)throw Error('blocked');return decision;},setItem(k,v){if(blocked)throw Error('blocked');saved.push(v);}},
 document:{readyState:'loading',cookie:'',head:{appendChild(e){if(e.tag==='script')scripts.push(e.src);}},body:{appendChild(e){body.push(e);}},createElement:element,addEventListener(n,f){callbacks[n]=f;}}};
 vm.runInNewContext(code,context); callbacks.DOMContentLoaded?.();
 return {window,scripts,saved,body,get reloads(){return reloads;},choose(value){body[0].handlers.click({target:{getAttribute:()=>value}});}};
}
test('no recorder before opt-in, including when storage is unavailable',()=>{for(const blocked of [false,true])assert.equal(fixture({blocked}).scripts.length,0);});
test('allow loads the exact project once and denies advertising storage',()=>{
 const f=fixture();f.choose('allow');f.choose('allow');assert.equal(f.scripts.length,1);assert.ok(f.scripts[0].endsWith('/ywrpm8qywl'));
 assert.equal(f.window.clarity.q[0][1].ad_Storage,'denied');assert.equal(f.window.clarity.q[0][1].analytics_Storage,'granted');
 f.window.tkReplayEvent('generate_lead');f.window.tkReplayEvent('email=secret@example.com');
 assert.equal(f.window.clarity.q.filter(a=>a[0]==='event').length,1);
});
test('declining does not load replay; revoking reloads without recorder',()=>{
 const no=fixture();no.choose('deny');assert.equal(no.scripts.length,0);
 const yes=fixture({decision:'allow'});yes.choose('deny');assert.equal(yes.reloads,1);assert.equal(yes.saved.at(-1),'deny');
 const count=yes.window.clarity.q.length;yes.window.tkReplayEvent('generate_lead');assert.equal(yes.window.clarity.q.length,count);
});
test('privacy signals override stored opt-in and preview never loads replay',()=>{
 assert.equal(fixture({decision:'allow',restricted:true}).scripts.length,0);
 assert.equal(fixture({decision:'allow',path:'/preview/'}).scripts.length,0);
});
