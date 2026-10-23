// Run the unchanged production CA and optimization worker using explicit test fixtures.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const piece=(a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const c=vm.createContext({console,performance,Uint8Array,Uint16Array,Int16Array,Float32Array});
vm.runInContext(`const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),MISSING=-32000,NF=new Uint8Array(256);[50,60,70,80].forEach(i=>NF[i]=1);var G;const paintFlame=()=>{},paintBurnt=()=>{};`+
 piece('function disc(', '/* ================= painting')+piece('function igniteDisc(', '// ===MODEL-END===')+
 piece('function baseOf(', 'const hasFuel=')+piece('function calibrationWorkerSource(', 'async function calibrationInputs('),c);
const code=c.calibrationWorkerSource(),N=400;
const grid={N,nx:20,ny:20,cell:30,lstMean:25,fieldFuelFactor:1};
for(const [key,type,value] of [['inside',Uint8Array,1],['water',Uint8Array,0],['lc',Uint8Array,30],['z',Int16Array,300],['demMissing',Uint8Array,0],['nw',Int16Array,8000],['nd',Int16Array,2000],['nm',Int16Array,2000],['sm',Int16Array,2000],['lst',Int16Array,2500],['recent',Int16Array,6000],['bareFactor',Float32Array,1],['hardBare',Uint8Array,0],['lineBarrier',Uint8Array,0],['variation',Float32Array,1],['fuelMask',Uint8Array,1],['base',Uint8Array,255]])grid[key]=new type(N).fill(value);
const M={np:4,nlx:2,nly:2,len:76,sIdx:72.5};for(const [key,value] of [['U',-2],['V',0],['Ts',26.95],['E',15],['A',0],['P',0]])M[key]=Array.from({length:4},()=>new Float32Array(76).fill(value));
const p={R0:10,tb:20,dt:2,seedR:30,hours:2,moistScale:1,rainScale:1};for(const key of ['wCure','wNdmi','wSoil','wSlope','wElev','wWind','wWindDir','wTemp','wRh','wRain','wLST'])p[key]=1;
const ev={seeds:[{i:210,rad:30}],parts:[{hours:2,M}],valid:new Uint8Array(N).fill(1),ref:Uint8Array.from({length:N},(_,i)=>i%20<10?1:0)};
function search(held){const messages=[],w=vm.createContext({performance,postMessage:m=>messages.push(m),onmessage:null});vm.runInContext(code,w);w.onmessage({data:{type:'search',grid:structuredClone(grid),events:[ev,{...ev,ref:held}],holdout:1,baseline:p,keys:['R0','tb'],bounds:{R0:[.03,30],tb:[1,240]},requested:8,repeats:2}});assert(!messages.some(m=>m.type==='error'),JSON.stringify(messages));const result=messages.find(m=>m.type==='optimized');assert(result);assert.equal(result.history.length,11);assert(Number.isFinite(result.bestScore));assert(result.trainBefore.tp+result.trainBefore.fp>0);w.onmessage({data:{type:'validate',baseline:p,best:result.best}});const validation=messages.find(m=>m.type==='validated');assert(validation&&Number.isFinite(validation.after.iou));return result}
const a=search(ev.ref),b=search(new Uint8Array(N).fill(1));assert.deepEqual(JSON.parse(JSON.stringify(a.best)),JSON.parse(JSON.stringify(b.best)));
console.log('PASS real CA/optimization worker: fractional UTC hour, 11 runs, finite metrics, independent holdout');
// Both scheduling paths must retain an event's selected UTC hour, including chunk boundaries.
const {TemporalSync}=require('../temporal.js'),calls=[],elements={};
const d=vm.createContext({console,TemporalSync,Date,Int16Array,Uint8Array,Number,Math});d.$=id=>elements[id]||(elements[id]={value:'.1',textContent:''});
vm.runInContext(`var G={N:2,M:{original:true},seedSpec:[{i:0,date:'2024-04-10'}],inside:[1,1],water:[0,0],lc:[30,30]},EVENTS=[{start:'2024-04-10',end:'2024-04-25'}],HBY={},CALSTOP=false,W=null,MISSING=-32000,NF=[];const isoD=t=>new Date(t).toISOString().slice(0,10),daysBetween=(a,b)=>(Date.parse(b)-Date.parse(a))/864e5,startMs=p=>p.start;const bilingual=x=>x;`,d);
 d.DataIO={signal:{aborted:false},check(){}};d.eventReference=async()=>new Int16Array([3000,0]);d.loadMet=async p=>{calls.push(p);d.G.M={start:p.start}};
 vm.runInContext(piece('function eventStart(', 'const weight=')+'async '+piece('function calibrationInputs(', 'function paramTable('),d);
 (async()=>{const start=Date.parse('2024-04-10T17:00:00Z'),events=await d.calibrationInputs({mode:'hind',start,hours:300});assert.equal(events[0].parts.length,2);assert.equal(calls[0].start,start);assert.equal(calls[1].start,start+240*36e5);assert.equal(calls[1].hours,60);assert.equal(calls[1].weatherStart,start);assert.equal(d.G.M.original,true);console.log('PASS calibration weather starts at selected UTC hour and continues across 240-hour segments')})().catch(e=>{console.error(e);process.exitCode=1});
