/* Preparation dependencies only. Satellite expressions and model equations live in app.js. */
'use strict';
const WorkflowData=(()=>{
 const date=t=>new Date(t).toISOString().slice(0,10),add=(d,n)=>date(Date.parse(d)+n*86400000);
 const key=x=>JSON.stringify(x),ids=new WeakMap();let sequence=0;
 const token=x=>{if(!x||typeof x!=='object')return x;if(!ids.has(x))ids.set(x,++sequence);return ids.get(x)};
 const detection=r=>key([r.la,r.lo,r.t,r.b]);
 function satellite(p,events=[]){
  const start=date(p.start),end=p.eventEnd?add(p.eventEnd,1):events.length?add(events.at(-1).end,1):date(p.start+p.hours*3600000);
  return [
   [['nw'],[p.sensor,p.ww0,p.ww1]], [['nd'],[p.sensor,p.dw0,p.dw1]],
   [['nm'],[p.sensor,p.nm0||add(start,-30),p.nm1||start]],
   [['wi'],[p.sensor,p.wi0||add(start,-30),p.wi1||start]],
   [['recent','bsi'],[p.sensor,start]], [['sm'],[start]],
   [['lst'],[p.lst0||add(start,-45),p.lst1||add(start,-1)]],
   [['z'],[p.dem]], [['lc','wcWater'],['WorldCover/v200']],
   ...(p.bi?[[['bx'],[p.sensor,start,end,p.bx,p.pre,p.post]]]:[])
  ];
 }
 function keys(p,s){
  const area=key([s.aoi,p.cell]),sat=key([area,s.test,satellite(p,s.events)]),barriers=key([area,s.lines,s.skip,s.barrierSource]);
  const weather=key([area,p.start,p.hours,p.spc,p.mode,s.observations,s.weatherMethod]);
  return {area,satellite:sat,barriers,weather,field:key([area,s.species,s.litter,s.litterClass]),
   fire:key([sat,barriers,p.cureThr,p.start,p.mode,p.look,p.ignmode,p.seedR,s.selection,s.manual,s.rows,s.sources,s.confidence])};
 }
 return {key,token,detection,satellite,keys};
})();
if(typeof module!=='undefined')module.exports=WorkflowData;
