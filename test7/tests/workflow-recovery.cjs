// Run with: node test7/tests/workflow-recovery.cjs
// Controlled asynchronous failures; no fixture data enters the application.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const transport=fs.readFileSync(require('node:path').join(__dirname,'../data-io.js'),'utf8');
function context(){const elements=new Map();const c=vm.createContext({AbortController,DOMException,setTimeout,clearTimeout,console,Uint8Array,Float32Array,Int16Array});c.$=id=>{if(!elements.has(id))elements.set(id,{disabled:true,hidden:false,textContent:''});return elements.get(id)};vm.runInContext(transport+`;var G=null,DATA_READY=true,running=true,prepActive=true,prepCheckpoint={},CALSTOP=false,CALWORKER=null,CALCANCEL=null,videoGeneration=0,rec=null,dots={clearLayers(){}},W=null;function bilingual(a){return a}`,c);return c}
function functionSource(name,next){return source.slice(source.indexOf('function '+name+'('),source.indexOf(next,source.indexOf('function '+name+'(')))}
(async()=>{
 const c=context();vm.runInContext(functionSource('cancelWorkflow','function dropGrid')+functionSource('dropGrid','\n'),c);
 vm.runInContext('var oldSignal=DataIO.signal; G={fo:{remove(){}},bgo:{remove(){}}};dropGrid()',c);
 assert.equal(vm.runInContext('oldSignal.aborted&&G===null&&!prepActive&&!running&&!DATA_READY',c),true);
 assert.equal(c.$('prep').disabled,false);assert.equal(c.$('retryprep').hidden,true);
 vm.runInContext('var current=DataIO.signal;prepCheckpoint={};dropGrid(true)',c);
 assert.equal(vm.runInContext('!current.aborted&&prepCheckpoint!==null',c),true);
 console.log('PASS area/settings invalidation cancels old work; internal prepare preserves ownership');
 const d=context();vm.runInContext('var EVENTS=[{start:"2026-01-01",end:"2026-01-01"}];G={M:"original",seedSpec:[]};var release;function eventReference(){return new Promise(r=>release=r)}',d);
 vm.runInContext('async '+functionSource('calibrationInputs','\n'),d);
 const pending=vm.runInContext('calibrationInputs({})',d);vm.runInContext('DataIO.reset();G=null;release(new Int16Array())',d);
 await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(d.G,null);
 console.log('PASS reset during calibration does not restore or dereference discarded grid');
 const e=context();vm.runInContext(`function independentReference(){return {ref:[],valid:[]}};function clamp(x){return x};function log(){};function P(){return {}};var H={},release;G={N:1,state:new Uint8Array(1),im:{data:new Uint8Array(4)},M:{},seedSpec:[]};running=false;function simulateEvents(){return new Promise(r=>release=r)}`,e);
 vm.runInContext(source.slice(source.indexOf("$('ensemble').onclick="),source.indexOf('async function eventReference')),e);
 const ensemble=e.$('ensemble').onclick();vm.runInContext('DataIO.reset();G=null;release(new Uint8Array(1))',e);await ensemble;assert.equal(e.G,null);
 console.log('PASS reset during ensemble cannot crash or resurrect results');
 const f=context();const signal=vm.runInContext('DataIO.signal',f);const timeout=vm.runInContext('DataIO.wait(new Promise(()=>{}),DataIO.signal,5)',f);await assert.rejects(timeout,/timed out/);
 const aborted=vm.runInContext('DataIO.wait(new Promise(()=>{}))',f);vm.runInContext('DataIO.reset()',f);await assert.rejects(aborted,e=>e.name==='AbortError');assert.equal(signal.aborted,true);
 console.log('PASS bounded timeout and immediate cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
