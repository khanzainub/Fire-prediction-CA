/* Date scheduling and raw hourly cache only. No satellite or fire-model equations. */
'use strict';
const TemporalSync=(()=>{
 const HOUR=3600000,DAY=24*HOUR,MAX_HOURS=8760;
 const date=t=>new Date(t).toISOString().slice(0,10),hour=t=>new Date(t).toISOString().slice(0,13)+':00';
 const floor=t=>Math.floor(t/HOUR)*HOUR,ceil=t=>Math.ceil(t/HOUR)*HOUR;
 function shift(value,from,to){
  if(!value||from===to)return value;
  // Keep calendar seasons/year offsets, then move by the event's within-year offset.
  const years=+to.slice(0,4)-+from.slice(0,4);
  const yearShift=d=>{const y=+d.slice(0,4)+years,m=+d.slice(5,7),day=+d.slice(8,10);return Date.UTC(y,m-1,Math.min(day,new Date(Date.UTC(y,m,0)).getUTCDate()))};
  return date(yearShift(value)+Date.parse(to+'T00:00:00Z')-yearShift(from));
 }
 function windowFor(mode,start,hours,now=Date.now(),maxHours=MAX_HOURS){
  if(!Number.isFinite(start))throw Error('Choose a valid ignition date and UTC hour.');
  const limit=mode==='now'?2:mode==='fore'?22:Math.min(MAX_HOURS,maxHours);
  const duration=Math.min(limit,Math.max(1,Number(hours)||limit));
  const end=start+duration*HOUR;
  if(mode==='hind'&&end>floor(now))throw Error('Historical weather is not yet available through the simulation end. Shorten Duration or choose an earlier ignition.');
  return {start,end,hours:duration,first:floor(start)-72*HOUR,last:ceil(end),
   cacheLast:mode==='hind'?Math.min(ceil(start+limit*HOUR),floor(now)):ceil(start+limit*HOUR)};
 }
 return {HOUR,DAY,MAX_HOURS,date,hour,floor,ceil,shift,windowFor};
})();

const WeatherIntervals=(()=>{
 const {HOUR,DAY,hour,date,floor}=TemporalSync;
 const vars=['temperature_2m','relative_humidity_2m','precipitation','wind_speed_10m','wind_direction_10m'];
 const validRow=(r,t,now)=>r&&Array.isArray(r.v)&&r.v.length===vars.length&&r.v.every(Number.isFinite)&&
  Number.isFinite(r.elevation)&&Number.isFinite(r.saved)&&
  (r.source==='archive'||r.source==='forecast'&&(t<now-5*DAY&&r.saved>=t+5*DAY||now-r.saved<HOUR));
 // Fixed spatial chunks and month buckets are independent of run duration or date range.
 // Every finite point/hour is persisted, even when other points/hours in a response fail.
 async function load({identity,lat,lon,first,last,cacheLast=last,now=Date.now(),cache,request,check=()=>{},progress=()=>{},warn=()=>{}}){
  const legacyKeys=((await cache('keys'))||[]).filter(k=>typeof k==='string'&&k.startsWith('https://archive-api.open-meteo.com/v1/archive?'));
  check();
  const output=lat.map(()=>({hourly:{time:[],...Object.fromEntries(vars.map(k=>[k,[]]))}}));
  output.expires=Infinity;
  for(let offset=0;offset<lat.length;offset+=40){
   const la=lat.slice(offset,offset+40),lo=lon.slice(offset,offset+40),buckets=new Map();
   const prefix=JSON.stringify(['wx-hours-1',identity,la,lo,vars,'ms','UTC']);
   const key=t=>hour(t).slice(0,7);
   async function bucket(t){const m=key(t);if(!buckets.has(m)){const value=await cache('get',prefix+m);check();buckets.set(m,value?.hours?value:{hours:{}})}return buckets.get(m)}
   const row=async(t,q)=>(await bucket(t)).hours[hour(t)]?.[q];
   async function missing(t){const a=[];for(let q=0;q<la.length;q++)if(!validRow(await row(t,q),t,now))a.push(q);return a}
   async function ingest(body,points,source){
     const items=Array.isArray(body)?body:[body],dirty=new Set();
     if(items.length!==points.length)throw Error('Open-Meteo returned an unexpected number of locations.');
     for(let j=0;j<items.length;j++){
      const o=items[j],h=o?.hourly;if(!h||!Array.isArray(h.time)||!Number.isFinite(o.elevation))continue;
      for(let i=0;i<h.time.length;i++){
       const at=Date.parse(h.time[i]+'Z'),v=vars.map(k=>h[k]?.[i]);
       if(!Number.isFinite(at)||at!==floor(at)||at<Math.floor(first/DAY)*DAY||at>Math.floor(cacheLast/DAY)*DAY+23*HOUR||!v.every(Number.isFinite))continue;
       const b=await bucket(at),name=hour(at),q=points[j];
       if(!b.hours[name])b.hours[name]=[];
       if(!validRow(b.hours[name][q],at,now)){b.hours[name][q]={v,elevation:o.elevation,source,saved:now};dirty.add(key(at))}
      }
     }
     for(const m of dirty){check();await cache('put',prefix+m,buckets.get(m))}
   }
   // Older archive responses have no expiry and can seed the new interval cache.
   // Old forecast entries have no retrieval timestamp, so freshness cannot be proved.
   if((await missing(first)).length)for(const oldKey of legacyKeys){
    const params=new URL(oldKey).searchParams;
    if(params.get('latitude')!==la.join(',')||params.get('longitude')!==lo.join(',')||
     params.get('hourly')!==vars.join(',')||params.get('wind_speed_unit')!=='ms'||params.get('timezone')!=='UTC')continue;
    const body=await cache('get',oldKey);check();if(body&&(Array.isArray(body)?body.length:1)===la.length)await ingest(body,la.map((_,q)=>q),'archive');
   }
   async function fill(from,to,required){
    for(let t=from;t<=to;){
     check();const points=await missing(t);if(!points.length){t+=HOUR;continue}
     const source=t<floor(now)-90*DAY?'archive':'forecast';
     let end=t;
     // Coalesce only identical missing-point sets; never request a completed point.
     while(end+HOUR<=to&&end-t<7*DAY-HOUR&&
      ((end+HOUR<floor(now)-90*DAY?'archive':'forecast')===source)&&
      JSON.stringify(await missing(end+HOUR))===JSON.stringify(points))end+=HOUR;
     const base=source==='archive'?'https://archive-api.open-meteo.com/v1/archive':'https://api.open-meteo.com/v1/forecast';
     // Archive API exposes date-level bounds; forecast API also supports exact hours.
     const range=source==='archive'?`&start_date=${date(t)}&end_date=${date(end)}`:`&start_hour=${hour(t)}&end_hour=${hour(end)}`;
     const url=`${base}?latitude=${points.map(q=>la[q])}&longitude=${points.map(q=>lo[q])}&hourly=${vars}&wind_speed_unit=ms&timezone=UTC${range}`;
     progress(`Weather ${offset+1}–${offset+la.length}/${lat.length} points · ${hour(t)} to ${hour(end)} UTC${required?'':' · caching longer runs'}`);
     let body;try{body=await request(url);check()}catch(e){check();if(required)throw e;warn('Extra historical weather could not be cached: '+e.message);return}
     await ingest(body,points,source);
     for(let at=t;at<=end;at+=HOUR)if((await missing(at)).length){
      const message=`Open-Meteo has missing weather at ${hour(at)} UTC. Valid hours were saved; retry fetches only gaps.`;
      if(required)throw Error(message);warn(message);return;
     }
     t=end+HOUR;
    }
   }
   await fill(first,last,true);
   if(cacheLast>last)await fill(last+HOUR,cacheLast,false);
   for(let q=0;q<la.length;q++)for(let t=first;t<=last;t+=HOUR){
    const r=await row(t,q);if(!validRow(r,t,now))throw Error('Cached weather became incomplete. Retry preparation.');
    if(r.source==='forecast'&&!(t<now-5*DAY&&r.saved>=t+5*DAY))output.expires=Math.min(output.expires,r.saved+HOUR);
    const o=output[offset+q];o.elevation=r.elevation;o.hourly.time.push(hour(t));vars.forEach((k,i)=>o.hourly[k].push(r.v[i]));
   }
   progress(`Weather ${Math.min(offset+40,lat.length)}/${lat.length} points ready · matching hours cached`);
  }
  return output;
 }
 return {load,vars,validRow};
})();
if(typeof module!=='undefined')module.exports={TemporalSync,WeatherIntervals};
