const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),WorkflowData=require('../workflow.js');
const s=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const c=vm.createContext({console,WorkflowData,AbortController,DOMException,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../data-io.js'),'utf8'),c);
vm.runInContext(`var cache=new Map(),G={w:79,n:29,dx:.001,dy:.001,nx:2,ny:2},EVENTS=[],calls=[],fail='nm',blocked=null;const startMs=p=>p.start;async function idb(m,k,v){if(m==='get')return cache.get(k);if(m==='put')cache.set(k,v)}function note(){}function prepStage(){}var prepStates={};DataIO.delay=async()=>{};async function eeTile(image,x,y,w,h){calls.push(image.bands.join(','));if(image.bands.includes(fail))throw Error('test timeout');if(blocked)await blocked;return Object.fromEntries(image.bands.map(b=>[b,new Int16Array(w*h).fill(123)]))}async function img(){return{select(bands){return{bands}}}};var p={start:Date.parse('2024-04-10'),hours:24,sensor:'l',dem:'cop',ww0:'2023-10-01',ww1:'2023-11-30',dw0:'2024-03-01',dw1:'2024-04-30',nm0:'2024-03-11',nm1:'2024-04-09',wi0:'2024-03-11',wi1:'2024-04-09',lst0:'2024-02-25',lst1:'2024-04-09',bi:true,bx:'dnbr',pre:45,post:45},t={x0:0,y0:0,tw:2,th:2};`,c);
vm.runInContext(s.slice(s.indexOf('const EE_REQUIRED='),s.indexOf('function baseOf(')),c);
const run=s=>vm.runInContext(s,c);
(async()=>{
await assert.rejects(run("preparedSatelliteTile(img,t,'old',p,DataIO.signal,G)"),/timeout/);assert.deepEqual(Array.from(run('calls')),['nw','nd','nm','nm']);run("calls=[];fail=''");await run("preparedSatelliteTile(img,t,'old',p,DataIO.signal,G)");assert(!run("calls.includes('nw')||calls.includes('nd')"));run('calls=[]');await run("preparedSatelliteTile(img,t,'old',p,DataIO.signal,G)");assert.equal(run('calls.length'),0);
run("p.lst0='2024-03-01'");await run("preparedSatelliteTile(img,t,'new',p,DataIO.signal,G)");assert.deepEqual(Array.from(run('calls')),['lst']);
run("calls=[];p.dem='srtm'");await run("preparedSatelliteTile(img,t,'new',p,DataIO.signal,G)");assert.deepEqual(Array.from(run('calls')),['z']);
run("calls=[];p.hours=48");await run("preparedSatelliteTile(img,t,'new',p,DataIO.signal,G)");assert.deepEqual(Array.from(run('calls')),['bx']);
run("calls=[];p.R0=20;p.seedR=100;p.cureThr=.2");await run("preparedSatelliteTile(img,t,'new',p,DataIO.signal,G)");assert.equal(run('calls.length'),0);
console.log('PASS partial band failure retains completed bands; only LST, DEM or burn-window dependencies fetch again');
run("cache.clear();calls=[];cache.set('legacy'+JSON.stringify([0,0,2,2]),Object.fromEntries([...EE_REQUIRED,'bx'].map(k=>[k,new Int16Array(4)])))");await run("preparedSatelliteTile(img,t,'legacy',p,DataIO.signal,G)");assert.equal(run('calls.length'),0);assert(run('cache.size')>1);
console.log('PASS legacy complete satellite tiles seed per-band caches without re-downloading');
// A late EE callback after a confirmed cache clear must not resurrect cleared cache entries.
run("cache.clear();blocked=new Promise(r=>globalThis.release=r);const epoch=DataIO.epoch");const pending=run("prepareEETile(()=>({bands:['nw']}),t,'late',['nw'],0,DataIO.signal,G)");await new Promise(r=>setTimeout(r,5));run("DataIO.reset();DataIO.cache('clear');release()");await assert.rejects(pending,e=>e.name==='AbortError');await new Promise(r=>setTimeout(r,5));assert.equal(run("cache.has('late'+JSON.stringify([0,0,2,2]))"),false);
console.log('PASS full reset prevents a late satellite response from repopulating cleared data');
})().catch(e=>{console.error(e);process.exitCode=1});
