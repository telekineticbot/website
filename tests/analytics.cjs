const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const signupCode = html.split('// Email signup wired to Loops')[1].split('</script>')[0];
function fixture(response, trackingThrows = false, extra = {}) {
  const events = [], calls = [];
  const elements = Object.fromEntries(['tk-signup','tk-form','tk-email','tk-submit','tk-error'].map(id => [id, {
    value: '', disabled: false, style: {}, listeners: {}, addEventListener(n, f) { this.listeners[n] = f; },
    replaceWith() { this.replaced = true; }, setAttribute() {}
  }]));
  const context = { document: {getElementById: id => elements[id], createElement: () => ({style:{},setAttribute(){}})},
    window: {tkTrack: (name, data) => {if(trackingThrows) throw Error('blocked'); events.push({name,data});}},
    performance: {now: () => 100}, URLSearchParams,
    fetch: async (...args) => {calls.push(args); if(response instanceof Error) throw response; return response;},
    ...extra
  };
  vm.runInNewContext(signupCode, context);
  return {elements, events, calls, submit: () => elements['tk-form'].listeners.submit({preventDefault(){}})};
}
test('invalid email never calls Loops or counts a lead', async () => {
  const f=fixture(); f.elements['tk-email'].value='not-an-email'; await f.submit();
  assert.equal(f.calls.length,0); assert.equal(f.events.at(-1).data.error_type,'invalid_email');
});
test('confirmed success produces one lead without email in telemetry', async () => {
  const f=fixture({ok:true,status:200,json:async()=>({success:true})});
  f.elements['tk-email'].value='synthetic@example.com';
  f.elements['tk-email'].listeners.input(); f.elements['tk-email'].listeners.input();
  await f.submit(); await f.submit();
  assert.equal(f.calls.length,1); assert.equal(f.events.filter(e=>e.name==='signup_start').length,1);
  assert.equal(f.events.filter(e=>e.name==='generate_lead').length,1);
  assert.ok(!JSON.stringify(f.events).includes('synthetic@example.com'));
  assert.equal(f.elements['tk-signup'].replaced,true);
});
for (const [name,response,kind] of [
  ['server error',{ok:false,status:500,json:async()=>({success:false})},'server_rejected'],
  ['rate limit',{ok:false,status:429,json:async()=>({success:false})},'rate_limited'],
  ['malformed response',{ok:true,status:200,json:async()=>{throw Error('bad json')}},'invalid_response'],
  ['missing success',{ok:true,status:200,json:async()=>({})},'server_rejected'],
  ['network error',Error('network'),'network']
]) test(name+' cannot count as a conversion', async()=>{
  const f=fixture(response); f.elements['tk-email'].value='synthetic@example.com'; await f.submit();
  assert.equal(f.events.filter(e=>e.name==='generate_lead').length,0);
  assert.equal(f.events.at(-1).data.error_type,kind); assert.equal(f.elements['tk-submit'].disabled,false);
});
test('rate limit shows the shared-network message', async()=>{
  const f=fixture({ok:false,status:429,json:async()=>({success:false})}); f.elements['tk-email'].value='synthetic@example.com'; await f.submit();
  assert.equal(f.elements['tk-error'].textContent,'Too many signups from this network, try again in a minute');
});
test('repeat signup from the same browser skips Loops and is not a lead', async()=>{
  const store={}; const localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v;}};
  const extra={localStorage,crypto:globalThis.crypto,TextEncoder};
  const ok={ok:true,status:200,json:async()=>({success:true})};
  const first=fixture(ok,false,extra); first.elements['tk-email'].value='Synthetic@example.com'; await first.submit();
  assert.ok(!JSON.stringify(store).includes('synthetic'));
  const again=fixture(ok,false,extra); again.elements['tk-email'].value='synthetic@example.com'; await again.submit();
  assert.equal(again.calls.length,0); assert.equal(again.events.filter(e=>e.name==='generate_lead').length,0);
  assert.equal(again.events.at(-1).data.error_type,'already_subscribed'); assert.equal(again.elements['tk-signup'].replaced,true);
});
test('signup sends a source to Loops without breaking when location is unavailable', async()=>{
  const f=fixture({ok:true,status:200,json:async()=>({success:true})}); f.elements['tk-email'].value='synthetic@example.com'; await f.submit();
  assert.equal(new URLSearchParams(f.calls[0][1].body).get('source'),'Website (direct)');
});
test('blocked tracking cannot break a successful signup', async()=>{
 const f=fixture({ok:true,status:200,json:async()=>({success:true})},true);
 f.elements['tk-email'].value='synthetic@example.com'; await f.submit(); assert.equal(f.elements['tk-signup'].replaced,true);
});
test('behavior telemetry strips unknown fields and suppresses preview',()=>{
 for(const path of ['/', '/preview/']) {
  const events=[]; const window={addEventListener(){},gtag:(...args)=>events.push(args)};
  const context={window,location:{hostname:'telekinetic.bot',pathname:path},document:{readyState:'loading',addEventListener(){}}};
  vm.runInNewContext(fs.readFileSync('assets/behavior.js','utf8'),context);
  window.tkTrack('signup_start',{form_id:'notify_me',email:'secret@example.com'});
  window.tkTrack('unknown',{email:'secret@example.com'});
  assert.equal(events.length,path==='/'?1:0); assert.ok(!JSON.stringify(events).includes('secret'));
 }
});
test('preview initializer does not send pageviews or load GA4',()=>{
 vm.runInNewContext(fs.readFileSync('assets/analytics.js','utf8'),{window:{location:{pathname:'/preview/'}}});
});
