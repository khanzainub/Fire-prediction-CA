// Full application initialization and DOM event wiring in jsdom (no live scientific data).
// npm install --prefix /tmp/fire-workflow-test jsdom
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom'),fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..'),dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://example.test/test7/',runScripts:'outside-only'}),w=dom.window,c=dom.getInternalVMContext();
function layer(){return{_layers:[],addTo(){return this},remove(){},setStyle(){},setOpacity(){},eachLayer(f){this._layers.forEach(f)},clearLayers(){this._layers=[]},getLayers(){return this._layers},getBounds(){return{getWest:()=>79.44,getEast:()=>79.443,getSouth:()=>29.38,getNorth:()=>29.383,contains:()=>true}},on(){return this},bindTooltip(){return this},addLayer(v){this._layers.push(v)},removeLayer(){},hasLayer(){return false},setView(){return this},fitBounds(){},addControl(){},createPane(){return{style:{}}},addBaseLayer(){}}}
const control=()=>layer();control.layers=()=>layer();w.L={map:layer,tileLayer:layer,featureGroup:layer,layerGroup:layer,control,circleMarker:layer,Control:{Draw:function(){}},Draw:{Event:{CREATED:'created'}},ImageOverlay:{extend(){return function(){return layer()}}},DomUtil:{create(t,cls){const e=w.document.createElement(t);e.className=cls;return e}}};
w.AbortController=AbortController;w.DOMException=DOMException;w.fetch=async()=>{throw Error('Network disabled in DOM test')};w.requestAnimationFrame=f=>setTimeout(f,0);w.confirm=()=>false;
w.HTMLCanvasElement.prototype.getContext=function(){return{createImageData:(a,b)=>({data:new Uint8ClampedArray(a*b*4)}),putImageData(){},clearRect(){}}};
for(const file of ['data-io.js','temporal.js','workflow.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c,{filename:file});
const run=x=>vm.runInContext(x,c),$=id=>w.document.getElementById(id),change=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('change',{bubbles:true}))};
(async()=>{
const unbound=[...w.document.querySelectorAll('button[id]')].filter(b=>!b.onclick).map(b=>b.id);assert.deepEqual(unbound,[]);assert.equal($('hours').max,'2');assert.equal($('hours').value,'2');
w.document.querySelector('[data-m=fore]').click();assert.equal($('hours').value,'22');w.document.querySelector('[data-m=hind]').click();change('hs','2024-04-10');change('hh','17');change('hours','48');assert.equal($('met0').value,'2024-04-10');assert.equal($('met1').value,'2024-04-12');assert.equal($('ww0').value,'2023-10-01');assert.equal($('lst1').value,'2024-04-09');change('hs','2026-04-10');assert.equal($('ww0').value,'2025-10-01');
console.log('PASS full app boots; every button bound; real mode/date/duration events synchronize ranges without leap-year drift');
run(`installDetections([{la:29.381,lo:79.441,date:'2024-04-10',t:Date.parse('2024-04-10T17:00Z'),b:'VIIRS'},{la:29.382,lo:79.442,date:'2024-04-10',t:Date.parse('2024-04-10T18:00Z'),b:'VIIRS'}],true);renderHist()`);
w.document.querySelector('#hist [data-r="0"]').click();assert.equal(run('POINT_SEL.size'),2);assert.equal($('hh').value,'17');assert.equal($('hs').value,'2024-04-10');w.document.querySelector('#hist [data-none]').click();assert.equal(run('POINT_SEL.size'),0);assert.equal(run('EVENTS.length'),0);
$('lang').click();assert.equal(w.document.documentElement.lang,'hi');$('lang').click();assert.equal(w.document.documentElement.lang,'en');
console.log('PASS first event link selects actual points, Clear all removes them, language switching retains controls');
const before=$('hs').value;await $('reset').onclick();assert.equal($('hs').value,before);w.confirm=()=>true;await $('reset').onclick();assert.equal($('hs').value,'2026-04-10');assert.equal($('hours').value,'2');assert.equal($('rerunbaseline').hidden,true);assert.equal(run('DETECTIONS.length'),0);
assert.equal(run("LOGS.some(s=>s.includes('script:')||s.includes('promise:'))"),false,run('LOGS.join("\\n")'));
console.log('PASS full DOM Reset confirm/cancel and default restoration; no uncaught application errors');
dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
