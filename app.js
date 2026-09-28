const $=i=>document.getElementById(i),log=t=>$('log').textContent=t,st=t=>$('eestatus').textContent=t;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),addD=(d,n)=>new Date(+new Date(d)+n*864e5).toISOString().slice(0,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),NONFLAM=[50,60,70,80];
let MODE='now',G=null,AOI=null,eeReady=false,running=false,overlay=null,H=null,C1,C2,rec,chunks,vc;

// ---------- map and area ----------
const map=L.map('map').setView([29.5,75],8);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
const drawn=L.featureGroup().addTo(map);
map.addControl(new L.Control.Draw({edit:{featureGroup:drawn},draw:{polygon:true,rectangle:true,polyline:false,circle:false,marker:false,circlemarker:false}}));
function setAOI(){const polys=[];drawn.eachLayer(l=>{const g=l.toGeoJSON().geometry;g.type==='Polygon'?polys.push(g.coordinates):g.coordinates.forEach(c=>polys.push(c))});
 AOI=polys.length?polys:null;G=null;if(AOI)localStorage.setItem('wf_aoi',JSON.stringify(AOI));log(AOI?'Area set.':'No area.')}
function addGJ(gj){drawn.clearLayers();(gj.features||[gj]).forEach(f=>{const g=f.geometry||f;if(/Polygon/.test(g.type))L.geoJSON(g).eachLayer(l=>drawn.addLayer(l))});
 if(drawn.getLayers().length){map.fitBounds(drawn.getBounds());setAOI()}else log('No polygon found in that file.')}
map.on(L.Draw.Event.CREATED,e=>{drawn.clearLayers();drawn.addLayer(e.layer);setAOI()});
map.on('draw:edited draw:deleted',setAOI);
$('aoifile').onchange=e=>{const f=e.target.files[0];if(f)f.text().then(t=>addGJ(JSON.parse(t))).catch(()=>log('Could not read that file.'))};
$('aoisave').onclick=()=>{if(!AOI)return log('Draw an area first.');const a=document.createElement('a');
 a.href=URL.createObjectURL(new Blob([JSON.stringify({type:'MultiPolygon',coordinates:AOI})],{type:'application/json'}));a.download='aoi.geojson';a.click()};
try{const s=localStorage.getItem('wf_aoi');if(s)addGJ({type:'MultiPolygon',coordinates:JSON.parse(s)})}catch(e){}

// ---------- saved keys, tabs ----------
const KEYS=['firms','client','project'];
KEYS.forEach(k=>{const v=localStorage.getItem('wf_'+k);if(v)$(k).value=v});
const saveKeys=()=>KEYS.forEach(k=>$('remember').checked?localStorage.setItem('wf_'+k,$(k).value.trim()):localStorage.removeItem('wf_'+k));
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{MODE=b.dataset.m;document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
 $('hindbox').hidden=MODE!=='hind';$('steps').value={now:12,fore:72,hind:24}[MODE];G=null});
const P=()=>({mode:MODE,sensor:$('sensor').value,cell:+$('cell').value||375,steps:clamp(+$('steps').value||12,1,360),B:Math.max(1,+$('block').value||10),
 ph:+$('ph').value,tb:+$('tb').value||2,ww0:$('ww0').value,ww1:$('ww1').value,dw0:$('dw0').value,dw1:$('dw1').value});
const start=p=>p.mode==='hind'?$('hs').value:new Date().toISOString().slice(0,10);

// ---------- cache (IndexedDB, this browser only) ----------
const DB=new Promise(r=>{const q=indexedDB.open('wf',1);q.onupgradeneeded=()=>q.result.createObjectStore('c');q.onsuccess=()=>r(q.result)});
const idb=async(m,k,v)=>{const d=await DB;return new Promise(r=>{const s=d.transaction('c',m==='get'?'readonly':'readwrite').objectStore('c');
 const q=m==='get'?s.get(k):m==='put'?s.put(v,k):s.clear();q.onsuccess=()=>r(q.result)})};
$('clear').onclick=async()=>{await idb('clear');log('Cache cleared.')};

// ---------- Earth Engine sign-in ----------
$('signin').onclick=()=>{saveKeys();const c=$('client').value.trim(),p=$('project').value.trim();
 if(!c||!p)return st('Enter the OAuth client ID and project ID first.');
 const init=()=>ee.initialize(null,null,()=>{eeReady=true;st('Signed in. Earth Engine ready.')},e=>st('Earth Engine init failed: '+e),null,p);
 ee.data.authenticateViaOauth(c,init,e=>st('Sign-in failed: '+e),null,()=>ee.data.authenticateViaPopup(init))};

// ---------- grid ----------
const pip=(px,py,rings)=>{let c=false;for(const r of rings)for(let i=0,j=r.length-1;i<r.length;j=i++){const[a,b]=r[i],[d,f]=r[j];if((b>py)!==(f>py)&&px<(d-a)*(py-b)/(f-b)+a)c=!c}return c};
function build(nx2,ny2){const b=drawn.getBounds(),n=b.getNorth(),s=b.getSouth(),e=b.getEast(),w=b.getWest(),p=P(),
 wm=(e-w)*111320*Math.cos((n+s)/2*Math.PI/180),hm=(n-s)*111320,cell=Math.max(p.cell,wm/250,hm/250),
 nx=nx2||Math.max(1,Math.round(wm/cell)),ny=ny2||Math.max(1,Math.round(hm/cell)),N=nx*ny,seeds=G?G.seeds:new Set();
 G={n,s,e,w,nx,ny,cell,N,z:new Float32Array(N),lc:new Uint8Array(N).fill(30),base:new Float32Array(N),inside:new Uint8Array(N),
  state:new Uint8Array(N),age:new Uint8Array(N),obs:new Uint8Array(N),bi:new Uint8Array(N),hasBI:false,seeds:new Set(),M:null};
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)G.inside[y*nx+x]=AOI.some(r=>pip(w+(x+.5)/nx*(e-w),n-(y+.5)/ny*(n-s),r))?1:0}
const cellAt=(la,lo)=>{const x=Math.floor((lo-G.w)/(G.e-G.w)*G.nx),y=Math.floor((G.n-la)/(G.n-G.s)*G.ny);return x<0||y<0||x>=G.nx||y>=G.ny?-1:y*G.nx+x};
function ignite(i){if(G.state[i]===0){G.state[i]=1;G.age[i]=0;G.seeds.add(i);return true}return false}
function resetState(){for(let i=0;i<G.N;i++){G.state[i]=G.inside[i]&&!NONFLAM.includes(G.lc[i])?0:3;G.age[i]=0}G.seeds.forEach(i=>{if(G.state[i]===0)G.state[i]=1});draw()}
map.on('click',ev=>{if(G&&!running){const i=cellAt(ev.latlng.lat,ev.latlng.lng);if(i>=0&&ignite(i))draw()}});

// ---------- Earth Engine data: terrain, land cover, curing fuel, moisture ----------
const sr=(sen,a,b,reg)=>{let c;
 if(sen==='s2')c=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(reg).filterDate(a,b).map(i=>{const s=i.select('SCL'),ok=s.eq(3).or(s.eq(8)).or(s.eq(9)).or(s.eq(10)).or(s.eq(11)).not();
  return i.select(['B4','B8','B11','B12'],['red','nir','sw1','sw2']).divide(1e4).updateMask(ok)});
 else c=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterBounds(reg).filterDate(a,b)
  .map(i=>i.select(['SR_B4','SR_B5','SR_B6','SR_B7'],['red','nir','sw1','sw2']).multiply(2.75e-5).add(-0.2).updateMask(i.select('QA_PIXEL').bitwiseAnd(26).eq(0)));
 const m=c.median();return ee.Image.cat([m.normalizedDifference(['nir','red']).rename('ndvi'),m.normalizedDifference(['nir','sw1']).rename('ndmi'),m.normalizedDifference(['nir','sw2']).rename('nbr')])};
async function getEE(p){const{n,s,e,w,nx,ny}=G,T=[(e-w)/nx,0,w,0,-(n-s)/ny,n],reg=ee.Geometry.Rectangle([w,s,e,n]),d0=start(p),d1=addD(d0,Math.ceil(p.steps/24));
 const cont=[sr(p.sensor,p.ww0,p.ww1,reg).select('ndvi').rename('nw'),sr(p.sensor,p.dw0,p.dw1,reg).select('ndvi').rename('nd'),sr(p.sensor,addD(d0,-30),d0,reg).select('ndmi').rename('nm'),
  ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR').filterDate(addD(d0,-10),d0).select('volumetric_soil_water_layer_1').mean().rename('sm')];
 if(p.mode==='hind')cont.push(sr(p.sensor,addD(d0,-30),d0,reg).select('nbr').subtract(sr(p.sensor,d1,addD(d1,30),reg).select('nbr')).rename('dn'));
 const c=ee.Image.cat(cont).reproject({crs:'EPSG:4326',scale:p.sensor==='s2'?10:30}).reduceResolution({reducer:ee.Reducer.mean(),maxPixels:65535,bestEffort:true}).reproject({crs:'EPSG:4326',crsTransform:T}),
 d=ee.Image.cat([ee.Image('USGS/SRTMGL1_003').rename('z'),ee.ImageCollection('ESA/WorldCover/v200').first().rename('lc')]).reproject({crs:'EPSG:4326',crsTransform:T});
 const r=await new Promise((ok,no)=>c.addBands(d).toFloat().unmask(-9999,false).sampleRectangle({region:reg}).getInfo((v,er)=>er?no(Error(er)):ok(v))),o=r.properties,f=k=>o[k]?o[k].flat():null;
 return{nx:o.z[0].length,ny:o.z.length,z:f('z'),lc:f('lc'),nw:f('nw'),nd:f('nd'),nm:f('nm'),sm:f('sm'),dn:f('dn')}}
async function loadEE(){const p=P();let r;
 if($('noee').checked){const N=G.N,c=v=>new Array(N).fill(v);r={nx:G.nx,ny:G.ny,z:c(0),lc:c(30),nw:c(.8),nd:c(.2),nm:c(.2),sm:c(.2),dn:null}}
 else{if(!eeReady)throw Error('Sign in to Earth Engine first, or tick "Skip Earth Engine".');
  const key=JSON.stringify(['ee',G.n,G.s,G.e,G.w,G.nx,G.ny,p.sensor,p.ww0,p.ww1,p.dw0,p.dw1,start(p),p.mode==='hind'?p.steps:0]);
  r=await idb('get',key);if(!r){r=await getEE(p);await idb('put',key,r)}}
 if(r.nx!==G.nx||r.ny!==G.ny)build(r.nx,r.ny);
 for(let i=0;i<G.N;i++){G.z[i]=r.z[i];G.lc[i]=r.lc[i];const nw=r.nw[i],nd=r.nd[i],nm=r.nm[i],sm=r.sm[i],
  fn=nw>-1&&nd>-1?clamp((nw-nd)/.5,0,1):.3,mv=nm>-1?clamp((nm+.2)/.6,0,1):.5,ms=sm>-1?clamp(sm/.4,0,1):.5;
  G.base[i]=(.25+.75*fn)*Math.exp(-2*(.7*mv+.3*ms));if(r.dn){G.hasBI=true;G.bi[i]=r.dn[i]>.1?1:0}}}

// ---------- Open-Meteo: one point per block of cells ----------
async function loadMet(){const p=P(),B=p.B,nbx=Math.ceil(G.nx/B),nby=Math.ceil(G.ny/B),la=[],lo=[];
 for(let by=0;by<nby;by++)for(let bx=0;bx<nbx;bx++){const cx=Math.min(G.nx-1,bx*B+B/2),cy=Math.min(G.ny-1,by*B+B/2);
  la.push((G.n-(cy+.5)/G.ny*(G.n-G.s)).toFixed(3));lo.push((G.w+(cx+.5)/G.nx*(G.e-G.w)).toFixed(3))}
 const d0=start(p),hind=p.mode==='hind',hr=new Date().toISOString().slice(0,13),pts=[],
 base=hind?'https://archive-api.open-meteo.com/v1/archive':'https://api.open-meteo.com/v1/forecast',
 tail=hind?`&start_date=${addD(d0,-3)}&end_date=${addD(d0,Math.ceil(p.steps/24))}`:`&past_days=3&forecast_days=${Math.min(16,Math.ceil(p.steps/24)+1)}`;
 for(let i=0;i<la.length;i+=40){log(`Weather ${Math.min(i+40,la.length)}/${la.length} points…`);
  const url=`${base}?latitude=${la.slice(i,i+40)}&longitude=${lo.slice(i,i+40)}&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=UTC${tail}`,key=url+(hind?'':hr);
  let j=await idb('get',key);if(!j){const r=await fetch(url);if(!r.ok)throw Error('Open-Meteo: '+(await r.text()).slice(0,150));j=await r.json();await idb('put',key,j)}
  (Array.isArray(j)?j:[j]).forEach(o=>pts.push(o.hourly))}
 const t=pts[0].time;
 pts.forEach(h=>h.A=h.precipitation.map((_,i)=>{let a=0;for(let k=0;k<=72&&i-k>=0;k++)a+=(h.precipitation[i-k]||0)*Math.exp(-k/48);return a}));
 G.M={nbx,B,pts,sIdx:Math.max(0,t.indexOf(hind?d0+'T00:00':hr+':00')),len:t.length}}

// ---------- FIRMS: ignition points and observed footprint ----------
async function loadFire(){const key=$('firms').value.trim();if(!key)return log('No FIRMS key. Click the map to place ignition points.');
 const p=P(),d0=start(p),hind=p.mode==='hind',days=hind?Math.min(10,Math.ceil(p.steps/24)):1;
 let srcs=$('fsrc').value==='ALL'?['VIIRS_SNPP_NRT','VIIRS_NOAA20_NRT','MODIS_NRT']:[$('fsrc').value],k=0;
 if(hind&&new Date()-new Date(d0)>60*864e5)srcs=srcs.map(s=>s.replace('_NRT','_SP'));
 for(const s of srcs){const r=await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${s}/${G.w},${G.s},${G.e},${G.n}/${days}${hind?'/'+d0:''}`),
  rows=(await r.text()).trim().split('\n'),h=rows[0].split(','),la=h.indexOf('latitude'),lo=h.indexOf('longitude'),ad=h.indexOf('acq_date');
  if(la<0)throw Error('FIRMS: '+rows[0].slice(0,120));
  rows.slice(1).forEach(l=>{const c=l.split(','),i=cellAt(+c[la],+c[lo]);if(i<0)return;G.obs[i]=1;if((!hind||c[ad]===d0)&&G.inside[i]&&G.state[i]===0&&ignite(i))k++})}
 return k}
$('prep').onclick=async()=>{const b=$('prep');try{if(!AOI)return log('Draw or load an area first.');b.disabled=true;saveKeys();build();
 log('Loading satellite and terrain data…');await loadEE();resetState();await loadMet();const k=await loadFire();resetState();
 log(`Ready: ${G.nx} × ${G.ny} cells of ${Math.round(G.cell)} m.${k!=null?` ${k} cells ignited from fire detections.`:''}`)}
 catch(e){log('Error: '+(e.message||e))}finally{b.disabled=false}};

// ---------- the automaton ----------
const NB=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function metStep(k){const M=G.M,nb=M.pts.length,fm=new Float32Array(nb),ws=new Float32Array(nb),wt=new Float32Array(nb);let sw=0,sT=0,sR=0;
 for(let b=0;b<nb;b++){const h=M.pts[b],i=Math.min(M.len-1,M.sIdx+k),RH=h.relative_humidity_2m[i],T=h.temperature_2m[i];
  fm[b]=(1-.9*(RH/100)**2)*Math.exp(.03*(T-25))*Math.exp(-.3*h.A[i]);ws[b]=h.wind_speed_10m[i];wt[b]=((h.wind_direction_10m[i]+180)%360)*Math.PI/180;sw+=ws[b];sT+=T;sR+=RH}
 return{fm,ws,wt,mw:sw/nb,mT:sT/nb,mR:sR/nb}}
function step(p,m){const{nx,ny,state,age,z,base,cell,M}=G,next=state.slice();
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const i=y*nx+x;if(state[i]!==1)continue;
  const b=Math.floor(y/M.B)*M.nbx+Math.floor(x/M.B),V=m.ws[b];
  for(const[dx,dy]of NB){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=nx||Y>=ny)continue;const j=Y*nx+X;if(state[j]!==0||next[j]!==0)continue;
   const d=cell*(dx&&dy?Math.SQRT2:1),pw=Math.exp(.045*V)*Math.exp(.131*V*(Math.cos(Math.atan2(dx,-dy)-m.wt[b])-1)),
   ps=Math.exp(.078*Math.atan((z[j]-z[i])/d)*180/Math.PI),pr=Math.min(1,p.ph*base[j]*m.fm[b]*pw*ps);
   if(Math.random()<pr){next[j]=1;age[j]=0}}
  if(++age[i]>=p.tb)next[i]=2}
 G.state=next}

// ---------- drawing, video, validation, charts ----------
function frame(){const{nx,ny,state,age}=G,cv=document.createElement('canvas');cv.width=nx;cv.height=ny;const x=cv.getContext('2d'),im=x.createImageData(nx,ny),tb=+$('tb').value||2;
 for(let i=0;i<state.length;i++){if(state[i]===1){const t=clamp(age[i]/tb,0,1);im.data.set([255-30*t,210-180*t,40-10*t,235],i*4)}else if(state[i]===2)im.data.set([110,18,14,190],i*4)}
 x.putImageData(im,0,0);return cv}
function draw(){if(!G)return;if(overlay)overlay.remove();overlay=L.imageOverlay(frame().toDataURL(),[[G.s,G.w],[G.n,G.e]],{interactive:false}).addTo(map)}
function vstart(){$('vlink').hidden=true;rec=null;if(!$('vid').checked||!window.MediaRecorder)return;const sc=Math.max(1,Math.floor(720/G.nx));
 vc=document.createElement('canvas');vc.width=G.nx*sc;vc.height=G.ny*sc+30;vc.sc=sc;chunks=[];
 rec=new MediaRecorder(vc.captureStream(10));rec.ondataavailable=e=>chunks.push(e.data);
 rec.onstop=()=>{const a=$('vlink');a.href=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));a.download='fire-spread.webm';a.hidden=false};rec.start()}
function vframe(k){if(!rec)return;const x=vc.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,vc.width,vc.height);x.imageSmoothingEnabled=false;
 x.drawImage(frame(),0,30,vc.width,vc.height-30);x.fillStyle='#ffc21a';x.font='16px sans-serif';x.fillText(`t + ${k} h`,8,20)}
function validate(){const{state,obs,bi,inside,lc,N,cell}=G,km=c=>(c*cell*cell/1e6).toFixed(1);
 const row=(nm,ref)=>{let tp=0,fp=0,fn=0;for(let i=0;i<N;i++){if(!inside[i]||NONFLAM.includes(lc[i]))continue;const pr=state[i]===1||state[i]===2,ob=ref[i]===1;if(pr&&ob)tp++;else if(pr)fp++;else if(ob)fn++}
  const pc=tp/(tp+fp)||0,rc=tp/(tp+fn)||0;return`<tr><td>${nm}</td><td>${km(tp+fp)}</td><td>${km(tp+fn)}</td><td>${pc.toFixed(2)}</td><td>${rc.toFixed(2)}</td><td>${(2*pc*rc/(pc+rc)||0).toFixed(2)}</td><td>${(tp/(tp+fp+fn)||0).toFixed(2)}</td></tr>`};
 $('val').innerHTML='<table><tr><th>Reference</th><th>Model km²</th><th>Ref. km²</th><th>Prec.</th><th>Recall</th><th>F1</th><th>IoU</th></tr>'+row('FIRMS detections',obs)+(G.hasBI?row('dNBR > 0.1',bi):'')+'</table>'}
function charts(){[C1,C2].forEach(c=>c&&c.destroy());Chart.defaults.color='#c9b8b0';
 const o=()=>({animation:false,scales:{y:{},y1:{position:'right',grid:{drawOnChartArea:false}}}}),l=(label,data,c,ax)=>({label,data,borderColor:c,pointRadius:0,yAxisID:ax||'y'});
 C1=new Chart($('c1'),{type:'line',data:{labels:H.t,datasets:[l('Burnt area (km²)',H.area,'#ff7a00'),l('Burning cells',H.burning,'#ffc21a','y1')]},options:o()});
 C2=new Chart($('c2'),{type:'line',data:{labels:H.t,datasets:[l('Wind (m/s)',H.ws,'#ffc21a'),l('Temperature (°C)',H.T,'#e11d2e'),l('Humidity (%)',H.RH,'#ff7a00','y1')]},options:o()})}
$('reset').onclick=()=>{running=false;if(G){resetState();log('Reset.')}};
$('run').onclick=async()=>{if(running){running=false;return}if(!G||!G.M)return log('Prepare data first.');resetState();
 if(!G.seeds.size)return log('Nothing to ignite. Add a FIRMS key or click the map.');
 const p=P(),b=$('run');running=true;b.textContent='Stop';H={t:[],area:[],burning:[],ws:[],T:[],RH:[]};vstart();$('val').innerHTML='';
 for(let k=0;k<p.steps&&running;k++){const m=metStep(k);step(p,m);draw();vframe(k+1);let a=0,f=0;for(let i=0;i<G.N;i++){const s=G.state[i];if(s===1){f++;a++}else if(s===2)a++}
  H.t.push(k+1);H.area.push(+(a*G.cell*G.cell/1e6).toFixed(2));H.burning.push(f);H.ws.push(+m.mw.toFixed(1));H.T.push(+m.mT.toFixed(1));H.RH.push(Math.round(m.mR));
  log(`Step ${k+1}/${p.steps}: ${H.area[k]} km² burnt or burning.`);await sleep(150)}
 if(rec&&rec.state!=='inactive')rec.stop();charts();if(p.mode==='hind')validate();running=false;b.textContent='2. Run simulation'};
