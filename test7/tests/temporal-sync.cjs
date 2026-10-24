// Controlled transport fixtures only. No synthetic data is used by the live app.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {TemporalSync:T,WeatherIntervals:WX}=require('../temporal.js');
const ms=s=>Date.parse(s+'Z'),now=ms('2026-10-24T12:37:00');
const a=T.windowFor('now',now,12,now),b=T.windowFor('fore',now+2*T.HOUR,72,now);
assert.equal(a.end,now+2*T.HOUR);assert.equal(b.end,now+24*T.HOUR);
assert.equal(a.first,T.floor(now)-72*T.HOUR);assert.equal(a.last,T.ceil(a.end));
const h=T.windowFor('hind',ms('2024-04-10T17:00:00'),5,now);
assert.equal(h.cacheLast,h.start+8760*T.HOUR);assert.equal(h.end,h.start+5*T.HOUR);
assert.throws(()=>T.windowFor('hind',now,1,now),/not yet available/);
assert.equal(T.shift('2025-10-01','2026-04-10','2024-04-10'),'2023-10-01');
assert.equal(T.shift('2024-02-29','2024-04-10','2025-04-10'),'2025-02-28');
assert.equal(T.shift('2026-03-11','2026-04-10','2026-05-15'),'2026-04-15');
console.log('PASS exact nowcast/forecast windows, historical horizon, event years and leap dates');
const store=new Map(),calls=[],cache=async(op,k,v)=>{if(op==='put')store.set(k,structuredClone(v));return op==='keys'?[...store.keys()]:op==='get'?structuredClone(store.get(k)):undefined};
let nullHour=null,fail=false;
async function request(url){
 const u=new URL(url),p=u.searchParams,from=p.get('start_hour')||p.get('start_date')+'T00:00',to=p.get('end_hour')||p.get('end_date')+'T23:00';
 calls.push({url,from,to,lat:p.get('latitude')});if(fail)throw Error('Controlled timeout');
 const times=[];for(let t=ms(from);t<=ms(to);t+=T.HOUR)times.push(T.hour(t));
 return p.get('latitude').split(',').map((lat,q)=>({elevation:300,hourly:{time:times,...Object.fromEntries(WX.vars.map((key,j)=>[key,times.map(t=>t===nullHour&&lat==='29.380'?null:[25,40,0,2,90][j])]))}}));
}
const args={identity:['small Nainital test grid',30],lat:['29.380','29.389'],lon:['79.440','79.450'],first:ms('2024-04-07T17:00'),last:ms('2024-04-10T22:00'),cacheLast:ms('2024-04-20T17:00'),now,cache,request};
(async()=>{
 await WX.load(args);const count=calls.length;
 const shorter=await WX.load({...args,last:ms('2024-04-10T19:00')});assert.equal(calls.length,count);assert.equal(shorter[0].hourly.time.at(-1),'2024-04-10T19:00');
 await WX.load({...args,last:ms('2024-04-18T19:00')});assert.equal(calls.length,count);
 // Recreate the module, simulating a fresh page using only persisted records.
 delete require.cache[require.resolve('../temporal.js')];await require('../temporal.js').WeatherIntervals.load(args);assert.equal(calls.length,count);
 await WX.load({...args,identity:['different grid',10]});assert(calls.length>count);
 console.log('PASS shorter/longer runs and fresh-page cache reuse; resolution mismatch fetches separately');
 store.clear();calls.length=0;nullHour='2026-10-23T17:00';
 const partial={...args,first:ms('2026-10-23T16:00'),last:ms('2026-10-23T19:00'),cacheLast:ms('2026-10-23T19:00')};
 await assert.rejects(WX.load(partial),/missing weather/);assert(store.size>0);nullHour=null;
 await WX.load(partial);assert.equal(calls.length,2);assert.equal(calls[1].from,'2026-10-23T17:00');assert.equal(calls[1].to,'2026-10-23T17:00');assert.equal(calls[1].lat,'29.380');
 const fresh=calls.length;await WX.load({...partial,now:now+30*60000});assert.equal(calls.length,fresh);
 await WX.load({...partial,now:now+2*T.HOUR});assert(calls.length>fresh);
 console.log('PASS partial null response saves valid points/hours; retries only missing point/hour; forecast TTL');
 store.clear();calls.length=0;fail=true;await assert.rejects(WX.load(partial),/timeout/);fail=false;await WX.load(partial);const recovered=calls.length;await WX.load(partial);assert.equal(calls.length,recovered);
 let cancelled=false;await assert.rejects(WX.load({...partial,check:()=>{if(cancelled)throw Error('cancelled')},identity:['cancel'],request:async u=>{cancelled=true;return request(u)}}),/cancelled/);
 console.log('PASS timeout recovery, subsequent reuse and cancellation');
 // Exercise the production date sync and real weather conversion in a VM, with no browser/auth.
 const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8'),els={};
 const $=id=>els[id]||(els[id]={value:'',max:''});
 Object.assign(els,{hs:{value:'2024-04-10'},hh:{value:'17'},hours:{value:'5'},ww0:{value:'2025-10-01'},ww1:{value:'2025-11-30'},dw0:{value:'2026-03-01'},dw1:{value:'2026-04-30'}});
 const c=vm.createContext({console,$,TemporalSync:T,WeatherIntervals:WX,Date,URL,Float32Array,Map,Number,Math});
 vm.runInContext(`const daysBetween=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/864e5);var seasonTemplates={},MODE='hind',temporalAnchor='2026-04-10',liveStart=${now};const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),isoD=ms=>new Date(ms).toISOString().slice(0,10),addD=(d,n)=>isoD(Date.parse(d)+n*864e5);`,c);
 vm.runInContext(source.slice(source.indexOf('function syncTemporal('),source.indexOf('function eventStart(')),c);
 vm.runInContext('syncTemporal()',c);assert.equal($('ww0').value,'2023-10-01');assert.equal($('lst1').value,'2024-04-09');assert.equal($('nm0').value,'2024-03-11');assert.equal($('met0').value,'2024-04-10');
 $('hs').value='2025-05-15';vm.runInContext('syncTemporal()',c);assert.equal($('lst1').value,'2025-05-14');assert.equal($('nm1').value,'2025-05-14');assert.equal($('hours').max,8760);
 $('hs').value='2026-04-10';vm.runInContext('syncTemporal()',c);assert.equal($('ww0').value,'2025-10-01');assert.equal($('dw0').value,'2026-03-01');
 console.log('PASS production input synchronization overwrites stale years and preserves relative windows');
 store.clear();calls.length=0;
 const legacyURL='https://archive-api.open-meteo.com/v1/archive?latitude=29.380,29.389&longitude=79.440,79.450&hourly='+WX.vars+'&wind_speed_unit=ms&timezone=UTC&start_date=2024-04-07&end_date=2024-04-20';
 store.set(legacyURL,await request(legacyURL));calls.length=0;await WX.load(args);assert.equal(calls.length,0);
 console.log('PASS existing historical URL cache migrated without downloading again');

 store.clear();calls.length=0;
 const dt=ms('2024-04-10T17:00'),p={mode:'hind',start:dt,hours:2,spc:5};
 c.G={w:79.44,e:79.45,s:29.38,n:29.389,dx:.0003,dy:.0003,nx:34,ny:30};c.DataIO={signal:{},check(){}};c.idb=cache;c.getJ=request;c.applyFieldWeather=x=>x;c.log=()=>{};c.prepStage=()=>{};c.note=()=>{};c.startMs=p=>p.start;
 vm.runInContext('var W=null;const esat=T=>6.112*Math.exp(17.62*T/(243.12+T));',c);
 vm.runInContext(source.slice(source.indexOf('const WX_CACHE='),source.indexOf('\nfunction parseCSV(')>0?source.indexOf('function parseCSV('):undefined).split('/* ================= fire')[0],c);
 // Date.now uses the host clock, but this historical run remains entirely in the archive.
 await c.loadMet(p);assert.equal(c.G.M.sIdx,72);assert.equal(c.G.M.len,75);assert.equal(c.G.M.U[0][72],-2);assert(Math.abs(c.G.M.Ts[0][72]-26.95)<1e-4);
 const n=calls.length;await c.loadMet({...p,hours:1});assert.equal(calls.length,n);assert.equal(c.G.M.len,74);assert.equal(c.G.M.meanIndices.length,2);
 assert(calls.every(x=>new URL(x.url).hostname==='archive-api.open-meteo.com'));
 console.log('PASS production weather loader, 8760-hour prefetch, shorter run without download, original wind/lapse calculations');
})().catch(e=>{console.error(e);process.exitCode=1});
