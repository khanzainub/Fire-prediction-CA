'use strict';
const $=id=>document.getElementById(id),st=t=>$('eestatus').textContent=t;
const LOGS=[];function note(k,m){LOGS.push(new Date().toLocaleTimeString()+'  '+k+'  '+m);if(LOGS.length>400)LOGS.shift();const e=$('elog');if(e){e.textContent=LOGS.join('\n');e.scrollTop=e.scrollHeight}}
const log=t=>{$('log').textContent=t;if(/^Error/.test(t))note('ERR',t.slice(7))};
window.addEventListener('error',e=>note('ERR','script: '+e.message));window.addEventListener('unhandledrejection',e=>note('ERR','promise: '+(e.reason&&e.reason.message||e.reason)));
$('copylog').onclick=()=>{const t=LOGS.join('\n');(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>log('Log copied.'),()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'text/plain'}));a.download='wildfire-log.txt';a.click()})};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),sleep=ms=>new Promise(r=>setTimeout(r,ms)),raf=()=>new Promise(r=>requestAnimationFrame(r));
const addD=(d,n)=>new Date(+new Date(d)+n*864e5).toISOString().slice(0,10),isoD=ms=>new Date(ms).toISOString().slice(0,10);
const daysBetween=(a,b)=>Math.round((+new Date(b)-+new Date(a))/864e5);
const MISSING=-32000,MAXC=4e6,TS=256;             // missing-value marker, max cells, EE tile size (cells)
const NF=new Uint8Array(256);[50,60,70,80].forEach(c=>NF[c]=1);   // non-flammable WorldCover classes
let MODE='now',G=null,AOI=null,eeReady=false,running=false,FILEROWS=null,CH=[],rec,chunks,vc,H,HROWS=null,HBY={},SEL=new Set(),SKIPN=0,RNG=[],SELR=new Set(),LASTSRC='',FBT=+localStorage.getItem('wf_fbt')||0;

/* ================= map, area of interest ================= */
const map=L.map('map').setView([29.5,75],8);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
// stacking order (bottom to top): base map < AOI outline (420) < raster layers (450) < fire canvas (same pane, added later) < detection dots (470)
map.createPane('aoi').style.zIndex=420;map.createPane('raster').style.zIndex=450;map.createPane('dots').style.zIndex=470;
const AOI_STYLE={color:'#3b82f6',weight:2.5,opacity:1,fill:false,fillOpacity:0,pane:'aoi'};   // outline only, no fill, so nothing sits over the rasters
const drawn=L.featureGroup().addTo(map),dots=L.layerGroup().addTo(map),hdots=L.layerGroup().addTo(map);   // dots: detections of this run, hdots: fire history
map.addControl(new L.Control.Draw({edit:{featureGroup:drawn},draw:{polygon:{shapeOptions:AOI_STYLE},rectangle:{shapeOptions:AOI_STYLE},polyline:false,circle:false,marker:false,circlemarker:false}}));

// canvas drawn straight on the map (no PNG encoding per frame), hard pixel edges
const CanvasOverlay=L.ImageOverlay.extend({_initImage(){const c=this._image=this._url;c.classList.add('leaflet-image-layer');
 if(this._zoomAnimated)c.classList.add('leaflet-zoom-animated');c.style.imageRendering='pixelated';c.style.pointerEvents='none'}});

function dropGrid(){if(G){G.fo&&G.fo.remove();G.bgo&&G.bgo.remove()}G=null;dots.clearLayers()}
function setAOI(){const polys=[];drawn.eachLayer(l=>{const g=l.toGeoJSON().geometry;g.type==='Polygon'?polys.push(g.coordinates):g.coordinates.forEach(c=>polys.push(c))});
 AOI=polys.length?polys:null;dropGrid();clearHist();if(AOI)localStorage.setItem('wf_aoi',JSON.stringify(AOI));log(AOI?'Area set.':'No area.')}
function addGJ(gj){drawn.clearLayers();(gj.features||[gj]).forEach(f=>{const g=f.geometry||f;if(/Polygon/.test(g.type))L.geoJSON(g,{pane:'aoi',style:()=>AOI_STYLE}).eachLayer(l=>drawn.addLayer(l))});
 if(drawn.getLayers().length){map.fitBounds(drawn.getBounds());setAOI()}else log('No polygon found in that file.')}
map.on(L.Draw.Event.CREATED,e=>{drawn.clearLayers();e.layer.setStyle&&e.layer.setStyle(AOI_STYLE);drawn.addLayer(e.layer);setAOI()});
map.on('draw:edited draw:deleted',setAOI);
$('aoifile').onchange=e=>{const f=e.target.files[0];if(f)f.text().then(t=>addGJ(JSON.parse(t))).catch(()=>log('Could not read that file.'))};
$('aoisave').onclick=()=>{if(!AOI)return log('Draw an area first.');const a=document.createElement('a');
 a.href=URL.createObjectURL(new Blob([JSON.stringify({type:'MultiPolygon',coordinates:AOI})],{type:'application/json'}));a.download='aoi.geojson';a.click()};
try{const s=localStorage.getItem('wf_aoi');if(s)addGJ({type:'MultiPolygon',coordinates:JSON.parse(s)})}catch(e){}

/* ================= saved keys, tabs, parameters ================= */
const KEYS=['firms','client','project'];
KEYS.forEach(k=>{const v=localStorage.getItem('wf_'+k);if(v)$(k).value=v});
const saveKeys=()=>KEYS.forEach(k=>$('remember').checked?localStorage.setItem('wf_'+k,$(k).value.trim()):localStorage.removeItem('wf_'+k));
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{MODE=b.dataset.m;document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
 $('hindbox').hidden=MODE!=='hind';$('hours').value={now:12,fore:72,hind:24}[MODE];if(MODE==='hind')$('usebi').checked=true;dropGrid()});
$('sensor').onchange=()=>{$('cell').value=$('sensor').value==='s2'?10:30;dropGrid()};
$('fh1').value=new Date().toISOString().slice(0,10);$('fh0').value=addD($('fh1').value,-365);
const P=()=>({mode:MODE,sensor:$('sensor').value,cell:Math.max(5,+$('cell').value||30),hours:clamp(+$('hours').value||12,1,240),dt:clamp(+$('dt').value||2,.25,30),
 span:selSpan(),R0:+$('r0').value||10,tb:+$('tb').value||20,seedR:+$('seedr').value||60,look:+$('look').value||24,spc:Math.max(1,+$('wsp').value||5),
 ww0:$('ww0').value,ww1:$('ww1').value,dw0:$('dw0').value,dw1:$('dw1').value,bi:$('usebi').checked,bx:$('bxsel').value,pre:+$('pre').value||45,post:+$('post').value||45});
const startMs=p=>{if(p.mode==='hind')return Date.parse($('hs').value+'T'+String(clamp(+$('hh').value||0,0,23)).padStart(2,'0')+':00:00Z');const n=new Date();n.setUTCMinutes(0,0,0);return+n};

/* ================= cache (IndexedDB, this browser only) ================= */
const DB=new Promise(r=>{const q=indexedDB.open('wf',1);q.onupgradeneeded=()=>q.result.createObjectStore('c');q.onsuccess=()=>r(q.result)});
const idb=async(m,k,v)=>{const d=await DB;return new Promise(r=>{const s=d.transaction('c',m==='get'?'readonly':'readwrite').objectStore('c');
 const q=m==='get'?s.get(k):m==='put'?s.put(v,k):s.clear();q.onsuccess=()=>r(q.result);q.onerror=()=>r(undefined)})};
$('clear').onclick=async()=>{await idb('clear');log('Cache cleared.')};

/* ================= network helper with clear error messages ================= */
async function getJ(url,label,tries=3){for(let a=0;;a++){let r;
 try{r=await fetch(url)}catch(e){if(a<tries-1){await sleep(2000*(a+1));continue}throw Error(label+': network error (Failed to fetch). Check internet, VPN, ad-blocker or data-saver.')}
 if(r.status===429&&a<tries-1){await sleep(4000*(a+1));continue}
 if(!r.ok)throw Error(label+': HTTP '+r.status+' '+(await r.text()).slice(0,120));return r.json()}}

/* ================= Earth Engine sign-in (token kept in this browser) ================= */
const TOKKEY='wf_tok';
function saveTok(){try{const t=ee.data.getAuthToken();if($('remember').checked&&t)localStorage.setItem(TOKKEY,JSON.stringify({t,exp:Date.now()+3300e3}))}catch(e){}}
const tokLeft=()=>{try{const s=JSON.parse(localStorage.getItem(TOKKEY)||'null');return s?s.exp-Date.now():-1}catch(e){return-1}};
function eeInit(){const p=$('project').value.trim();ee.initialize(null,null,()=>{eeReady=true;st('Signed in. Earth Engine ready.');note('OK','Earth Engine ready (project '+p+')')},e=>{st('Earth Engine init failed: '+e);note('ERR','Earth Engine init failed: '+e)},null,p)}
const silentAuth=()=>new Promise(res=>{const c=$('client').value.trim();if(!c)return res(false);setTimeout(()=>res(false),8000);
 try{ee.data.authenticateViaOauth(c,()=>{saveTok();res(true)},()=>res(false),null,()=>res(false))}catch(e){res(false)}});
async function restoreEE(){const c=$('client').value.trim(),p=$('project').value.trim();if(!c||!p||!$('remember').checked)return;
 try{const s=JSON.parse(localStorage.getItem(TOKKEY)||'null');
  if(s&&s.exp>Date.now()+60e3){ee.data.setAuthToken(c,'Bearer',s.t.replace(/^Bearer /,''),Math.round((s.exp-Date.now())/1000),[],null,false);eeInit();note('OK','Restored saved Google sign-in ('+Math.round((s.exp-Date.now())/6e4)+' min left)');return}}catch(e){note('WARN','Could not restore saved sign-in: '+e.message)}
 st('Refreshing Google sign-in…');if(await silentAuth()){eeInit();note('OK','Google sign-in refreshed silently')}else{st('Google session expired. Tap "Sign in with Google" once.');note('WARN','Saved Google sign-in expired and silent refresh was not possible')}}
async function ensureEE(){if(eeReady&&tokLeft()>60e3)return;if(eeReady&&tokLeft()<0&&!(await silentAuth())){eeReady=false;st('Google session expired. Tap "Sign in with Google" once.')}}
$('signin').onclick=()=>{saveKeys();const c=$('client').value.trim(),p=$('project').value.trim();
 if(!c||!p)return st('Enter the OAuth client ID and project ID first.');
 const init=()=>{saveTok();eeInit()};
 ee.data.authenticateViaOauth(c,init,e=>{st('Sign-in failed: '+e);note('ERR','Sign-in failed: '+e)},null,()=>ee.data.authenticateViaPopup(init))};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!running&&(!eeReady||tokLeft()<300e3))restoreEE()});
restoreEE();

// ===MODEL-START===
/* ================= raster grid (square cells of 30 m / 10 m, EPSG:4326 with cos(lat) scaling) ================= */
function build(b,p,aoi){const mLat=111320,mLon=111320*Math.cos((b.n+b.s)/2*Math.PI/180),dx=p.cell/mLon,dy=p.cell/mLat,w=b.w,n=b.n,
 nx=Math.max(1,Math.ceil((b.e-w)/dx)),ny=Math.max(1,Math.ceil((n-b.s)/dy)),N=nx*ny;
 if(N>MAXC)throw Error(`Area needs ${(N/1e6).toFixed(1)} M cells of ${p.cell} m (limit ${MAXC/1e6} M). Draw a smaller area or raise the cell size.`);
 G={w,n,dx,dy,e:w+nx*dx,s:n-ny*dy,nx,ny,N,cell:p.cell,z:new Int16Array(N),lc:new Uint8Array(N).fill(30),base:new Uint8Array(N),inside:new Uint8Array(N),
  state:new Uint8Array(N),age:new Uint16Array(N),obs:new Uint8Array(N),bx:new Int16Array(N).fill(MISSING),hasBI:false,act:[],nBurnt:0,tbs:1,centers:[],dets:[],M:null};
 rasterize(aoi)}
function rasterize(aoi){const{nx,ny,w,n,dx,dy,inside}=G;      // scan-line polygon fill, even-odd rule (holes work)
 for(const poly of aoi){const ed=[];for(const r of poly)for(let i=0,j=r.length-1;i<r.length;j=i++)ed.push([r[j],r[i]]);
  for(let y=0;y<ny;y++){const py=n-(y+.5)*dy,xs=[];
   for(const[a,b]of ed)if((a[1]>py)!==(b[1]>py))xs.push(a[0]+(py-a[1])*(b[0]-a[0])/(b[1]-a[1]));
   xs.sort((p,q)=>p-q);
   for(let k=0;k+1<xs.length;k+=2){const x0=Math.max(0,Math.ceil((xs[k]-w)/dx-.5)),x1=Math.min(nx-1,Math.ceil((xs[k+1]-w)/dx-.5)-1);for(let x=x0;x<=x1;x++)inside[y*nx+x]=1}}}}
const cellAt=(la,lo)=>{const x=Math.floor((lo-G.w)/G.dx),y=Math.floor((G.n-la)/G.dy);return x<0||y<0||x>=G.nx||y>=G.ny?-1:y*G.nx+x};
function disc(i,rm,fn){const r=Math.max(0,Math.round(rm/G.cell)),x0=i%G.nx,y0=(i/G.nx)|0;
 for(let y=Math.max(0,y0-r);y<=Math.min(G.ny-1,y0+r);y++)for(let x=Math.max(0,x0-r);x<=Math.min(G.nx-1,x0+r);x++)if((x-x0)**2+(y-y0)**2<=r*r+.5)fn(y*G.nx+x)}

/* ================= painting (fire canvas) ================= */
const flame=t=>{const k=t<.5?t*2:(t-.5)*2;return t<.5?[255,235-95*k,90-65*k]:[255-55*k,140-110*k,25-10*k]};
const FL=Array.from({length:33},(_,k)=>flame(k/32));
function paint(i,r,g,b,a){if(!G.im)return;const d=G.im.data,o=i*4;d[o]=r;d[o+1]=g;d[o+2]=b;d[o+3]=a}
const paintFlame=(i,t)=>{const c=FL[Math.min(32,(t*32)|0)];paint(i,c[0],c[1],c[2],245)};
const paintBurnt=i=>paint(i,52,38,38,215);
function drawFrame(){if(!G.im)return;for(const i of G.act)paintFlame(i,Math.min(1,G.age[i]/G.tbs));G.ctx.putImageData(G.im,0,0)}

function igniteDisc(c,rm){let k=0;disc(c,rm,j=>{if(G.state[j]===0){G.state[j]=1;G.age[j]=0;G.act.push(j);paintFlame(j,0);k++}});return k}
function resetState(rm){const{N,state,inside,lc}=G;for(let i=0;i<N;i++)state[i]=inside[i]&&!NF[lc[i]]?0:3;
 G.age.fill(0);G.act=[];G.nBurnt=0;G.lastC=null;if(G.im)G.im.data.fill(0);G.centers.forEach(c=>igniteDisc(c,rm));if(G.im)G.ctx.putImageData(G.im,0,0)}

/* ================= weather: lattice of Open-Meteo points -> bilinear per cell ================= */
const esat=T=>6.112*Math.exp(17.62*T/(243.12+T));
let W=null,p00,p10,p01,p11,w00,w10,w01,w11,wV,wSin,wCos,wT,wRH,wA,wDir;
const bl=a=>a[p00]*w00+a[p10]*w10+a[p01]*w01+a[p11]*w11;
function setWeather(tmin){const M=G.M,h=M.sIdx+tmin/60,i0=Math.min(M.len-1,Math.floor(h)),i1=Math.min(M.len-1,i0+1),f=h-Math.floor(h);
 if(!W)W={u:new Float32Array(M.np),v:new Float32Array(M.np),Ts:new Float32Array(M.np),E:new Float32Array(M.np),A:new Float32Array(M.np)};
 for(let q=0;q<M.np;q++){W.u[q]=M.U[q][i0]*(1-f)+M.U[q][i1]*f;W.v[q]=M.V[q][i0]*(1-f)+M.V[q][i1]*f;W.Ts[q]=M.Ts[q][i0]*(1-f)+M.Ts[q][i1]*f;
  W.E[q]=M.E[q][i0]*(1-f)+M.E[q][i1]*f;W.A[q]=M.A[q][i0]*(1-f)+M.A[q][i1]*f}}
function wxAt(x,y,zc){const M=G.M,gx=clamp((x+.5)/G.nx*(M.nlx-1),0,M.nlx-1),gy=clamp((y+.5)/G.ny*(M.nly-1),0,M.nly-1),
 x0=Math.min(M.nlx-2,Math.floor(gx)),y0=Math.min(M.nly-2,Math.floor(gy)),fx=gx-x0,fy=gy-y0;
 p00=y0*M.nlx+x0;p10=p00+1;p01=p00+M.nlx;p11=p01+1;w00=(1-fx)*(1-fy);w10=fx*(1-fy);w01=(1-fx)*fy;w11=fx*fy;
 const u=bl(W.u),v=bl(W.v);wV=Math.hypot(u,v);wSin=wV>1e-6?u/wV:0;wCos=wV>1e-6?v/wV:1;wDir=(Math.atan2(u,v)*180/Math.PI+360)%360;
 wT=bl(W.Ts)-.0065*zc;                                   // lapse rate with the 30 m DEM
 wRH=clamp(100*bl(W.E)*Math.exp(-zc/2500)/esat(wT),2,100); // vapour pressure kept, RH follows the cell temperature
 wA=bl(W.A)}

/* ================= the automaton ================= */
const DX=[-1,0,1,-1,1,-1,0,1],DY=[-1,-1,-1,0,0,1,1,1],SQ=Math.SQRT2,
 COSA=DX.map((x,k)=>-DY[k]/Math.hypot(x,DY[k])),SINA=DX.map((x,k)=>x/Math.hypot(x,DY[k]));
// weather factor: each term is softened and has a floor, so humid or wet weather slows the fire but never stops it outright
// (the old product of five terms fell to ~0 in humid/wet weather, so nothing ever spread)
const fRH=rh=>Math.max(.15,1-.75*(rh/100)**2),fT=t=>clamp(Math.exp(.03*(t-25)),.6,1.6),fRain=a=>.3+.7*Math.exp(-.1*a),fWx=()=>fRH(wRH)*fT(wT)*fRain(wA);
function step(p,tmin){const{nx,ny,state,age,z,base,cell,lc}=G;setWeather(tmin);const keep=[],born=[];
 for(const i of G.act){const x=i%nx,y=(i-x)/nx,zi=z[i];wxAt(x,y,zi);
  const fm=fWx(),V=wV,e1=Math.exp(.045*V);
  let left=0;   // neighbours that could still catch fire
  for(let k=0;k<8;k++){const X=x+DX[k],Y=y+DY[k];if(X<0||Y<0||X>=nx||Y>=ny)continue;const j=Y*nx+X;if(state[j]!==0)continue;
   if(DX[k]&&DY[k]&&NF[lc[y*nx+X]]&&NF[lc[Y*nx+x]])continue;   // no diagonal leak between two blocked (water/built-up) cells
   const d=DX[k]&&DY[k]?cell*SQ:cell,pw=V>.05?e1*Math.exp(.131*V*(COSA[k]*wCos+SINA[k]*wSin-1)):1,
    ps=Math.exp(.078*clamp(Math.atan((z[j]-zi)/d)*57.29578,-45,45)),R=p.R0*(base[j]/255)*fm*pw*ps;if(R<.03)continue;   // minimum spread rate
   if(Math.random()<1-Math.exp(-R*p.dt/d)){state[j]=1;age[j]=0;born.push(j);paintFlame(j,0)}else left++}
  // a cell burns at least tbs steps. After that it keeps burning while it still has an unburnt flammable neighbour (front keeps moving at R
  // even when R*burn time < one cell), up to tbMax. Without this, slow fires die at the percolation threshold and never spread.
  if(++age[i]>=G.tbs&&(left===0||age[i]>=(G.tbMax||G.tbs*12))){state[i]=2;G.nBurnt++;paintBurnt(i)}else keep.push(i)}
 G.act=keep.concat(born)}
// ===MODEL-END===

/* ================= Earth Engine: native-resolution raster, fetched in tiles ================= */
const PH=['green','red','nir','sw1','sw2'];
function sr(sen,a,b,reg){let c;
 if(sen==='s2')c=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(reg).filterDate(a,b).map(i=>{const s=i.select('SCL'),ok=s.eq(3).or(s.eq(8)).or(s.eq(9)).or(s.eq(10)).or(s.eq(11)).not();
  return i.resample('bilinear').select(['B3','B4','B8','B11','B12'],PH).divide(1e4).updateMask(ok)});
 else c=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterBounds(reg).filterDate(a,b)
  .map(i=>i.select(['SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'],PH).multiply(2.75e-5).add(-0.2).updateMask(i.select('QA_PIXEL').bitwiseAnd(26).eq(0)));
 c=c.merge(ee.ImageCollection([ee.Image.constant([0,0,0,0,0]).rename(PH).updateMask(ee.Image.constant(0))]));   // fully masked dummy: an empty window gives "no data", not an error
 const m=c.median();return ee.Image.cat([m.normalizedDifference(['nir','red']).rename('ndvi'),m.normalizedDifference(['nir','sw1']).rename('ndmi'),m.normalizedDifference(['nir','sw2']).rename('nbr'),m.normalizedDifference(['green','nir']).rename('ndwi')])}
function eeImage(p,reg){const d0=isoD(startMs(p)),dEnd=isoD(startMs(p)+(p.span||p.hours)*36e5),
 era=ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR').filterDate(addD(d0,-10),d0).select('volumetric_soil_water_layer_1')
  .merge(ee.ImageCollection([ee.Image.constant(0).rename('volumetric_soil_water_layer_1').updateMask(ee.Image.constant(0))])).mean().rename('sm'),
 bands=[sr(p.sensor,p.ww0,p.ww1,reg).select('ndvi').rename('nw'),sr(p.sensor,p.dw0,p.dw1,reg).select('ndvi').rename('nd'),sr(p.sensor,addD(d0,-30),d0,reg).select('ndmi').rename('nm'),era,sr(p.sensor,p.dw0,p.dw1,reg).select('ndwi').rename('ndw')];
 if(p.bi){const pre=sr(p.sensor,addD(d0,-p.pre),d0,reg).select('nbr'),post=sr(p.sensor,dEnd,addD(dEnd,p.post),reg).select('nbr').unmask(sr(p.sensor,addD(dEnd,p.post),addD(dEnd,2*p.post),reg).select('nbr')),   // cloudy cells take the next clear visit
 dn=pre.subtract(post);
  bands.push((p.bx==='rbr'?dn.divide(pre.add(1.001)).clamp(-2,3):dn.clamp(-2,3)).rename('bx'))}
 const cont=ee.Image.cat(bands).multiply(1e4).round().toInt16(),
 stat=ee.Image.cat([ee.ImageCollection('COPERNICUS/DEM/GLO30').select('DEM').mosaic().setDefaultProjection({crs:'EPSG:4326',crsTransform:[1/3600,0,-180,0,-1/3600,90]}).resample('bilinear').rename('z'),
  ee.ImageCollection('ESA/WorldCover/v200').first().rename('lc'),ee.ImageCollection('ESA/WorldCover/v200').first().eq(80).reduceResolution({reducer:ee.Reducer.max(),maxPixels:1024}).rename('wat')]).toInt16();
 return ee.Image.cat([cont,stat]).reproject({crs:'EPSG:4326',crsTransform:[G.dx,0,G.w,0,-G.dy,G.n]}).unmask(MISSING)}   // nearest neighbour onto our grid
async function eeTile(img,x0,y0,tw,th){
 const reg=ee.Geometry.Rectangle([G.w+(x0+.25)*G.dx,G.n-(y0+th-.25)*G.dy,G.w+(x0+tw-.25)*G.dx,G.n-(y0+.25)*G.dy],'EPSG:4326',false);
 const r=await new Promise((ok,no)=>img.sampleRectangle({region:reg,defaultValue:MISSING}).getInfo((v,er)=>er?no(Error(er)):ok(v))),o=r.properties,out={};
 for(const k in o){out[k]=Int16Array.from(o[k].flat());if(out[k].length!==tw*th)throw Error(`Earth Engine tile size mismatch (${out[k].length} vs ${tw*th})`)}return out}
function baseOf(nw,nd,nm,sm){const fn=nw!==MISSING&&nd!==MISSING?clamp((nw-nd)/5000,0,1):.3,mv=nm!==MISSING?clamp((nm/1e4+.2)/.6,0,1):.5,ms=sm!==MISSING?clamp(sm/1e4/.4,0,1):.5;
 return(.25+.75*fn)*(1-.8*(.7*mv+.3*ms))}
async function loadEE(p){const{nx,ny,N}=G;
 if($('noee').checked){for(let i=0;i<N;i++){G.z[i]=0;G.lc[i]=30;G.base[i]=Math.round(baseOf(8000,2000,2000,2000)*255)}return}
 await ensureEE();if(!eeReady)throw Error('Sign in to Earth Engine first (tap Sign in with Google), or tick "Skip Earth Engine".');
 const img=eeImage(p,ee.Geometry.Rectangle([G.w,G.s,G.e,G.n],'EPSG:4326',false)),tiles=[];
 for(let y0=0;y0<ny;y0+=TS)for(let x0=0;x0<nx;x0+=TS){const tw=Math.min(TS,nx-x0),th=Math.min(TS,ny-y0);let any=false;
  for(let y=y0;y<y0+th&&!any;y++)for(let x=x0;x<x0+tw;x++)if(G.inside[y*nx+x]){any=true;break}
  if(any)tiles.push({x0,y0,tw,th})}
 const d0=isoD(startMs(p)),miss={nw:0,nd:0,nm:0,sm:0,bx:0,z:0},cnt={done:0,hit:0};let err=null,tot=0,nwat=0;
 const kb=JSON.stringify(['ee5',p.sensor,p.cell,G.w,G.n,p.ww0,p.ww1,p.dw0,p.dw1,d0,p.bi?[p.bx,p.pre,p.post,p.span||p.hours]:0]);
 const work=async t=>{if(err)return;try{const key=kb+JSON.stringify([t.x0,t.y0,t.tw,t.th]);let o=await idb('get',key);if(o)cnt.hit++;else{o=await eeTile(img,t.x0,t.y0,t.tw,t.th);await idb('put',key,o)}
  for(let ty=0;ty<t.th;ty++)for(let tx=0;tx<t.tw;tx++){const q=ty*t.tw+tx,i=(t.y0+ty)*nx+t.x0+tx;if(!G.inside[i])continue;tot++;
   const nw=o.nw[q],nd=o.nd[q],nm=o.nm[q],sm=o.sm[q];if(nw===MISSING)miss.nw++;if(nd===MISSING)miss.nd++;if(nm===MISSING)miss.nm++;if(sm===MISSING)miss.sm++;
   G.z[i]=o.z[q]===MISSING?MISSING:o.z[q];if(o.z[q]===MISSING)miss.z++;G.lc[i]=o.lc[q]===MISSING?30:o.lc[q];if(o.wat[q]===1||(o.ndw[q]!==MISSING&&o.ndw[q]>1000)){G.lc[i]=80;nwat++}   // water = WorldCover water OR NDWI > 0.1 (any water pixel in the cell)
      G.base[i]=Math.min(255,Math.round(baseOf(nw,nd,nm,sm)*255*(.85+.3*((Math.imul(i,2654435761)>>>0)%1000)/1000)));   // small fixed fuel variation
   if(o.bx){G.bx[i]=o.bx[q];if(o.bx[q]===MISSING)miss.bx++;else G.hasBI=true}}
  cnt.done++;log(`Earth Engine tiles ${cnt.done}/${tiles.length} (${cnt.hit} from cache)…`)}catch(e){err=e}};
 let k=0;await Promise.all(Array.from({length:4},async()=>{while(k<tiles.length&&!err)await work(tiles[k++])}));if(err)throw err;
 for(let y=0;y<ny;y++){let last=0;for(let x=0;x<nx;x++){const i=y*nx+x;if(G.z[i]===MISSING)G.z[i]=last;else last=G.z[i]}}   // fill DEM voids
 G.miss=miss;G.tot=tot;G.nwat=nwat;const pc=v=>Math.round(100*v/Math.max(1,tot));
 note('OK',`Earth Engine: ${tiles.length} tiles of ${TS}×${TS} cells (${cnt.hit} from cache), ${tot} cells inside the area.`);
 G.gaps=`Data gaps (% of cells): green NDVI ${pc(miss.nw)}, dry NDVI ${pc(miss.nd)}, NDMI ${pc(miss.nm)}, soil ${pc(miss.sm)}${p.bi?', burn index '+pc(miss.bx):''}.`;note(/[1-9]/.test(G.gaps.replace(/[^0-9 ,]/g,'').replace(/0/g,''))?'WARN':'OK',G.gaps);
 let bs=0,bn=0;for(let i=0;i<G.N;i++)if(G.inside[i]){bs+=G.base[i];bn++}note('OK',`Fuel×moisture factor mean ${(bs/Math.max(1,bn)/255).toFixed(2)}, burn reference ${G.hasBI?'loaded':'not loaded'}.`)}

/* ================= Open-Meteo lattice ================= */
async function loadMet(p){const km=(G.e-G.w)*111.32*Math.cos((G.n+G.s)/2*Math.PI/180),kh=(G.n-G.s)*111.32;let sp=p.spc,nlx,nly;
 const dims=()=>{nlx=Math.max(2,Math.ceil(km/sp)+1);nly=Math.max(2,Math.ceil(kh/sp)+1)};dims();while(nlx*nly>400){sp*=1.25;dims()}
 const la=[],lo=[];for(let y=0;y<nly;y++)for(let x=0;x<nlx;x++){la.push((G.n-y/(nly-1)*(G.n-G.s)).toFixed(3));lo.push((G.w+x/(nlx-1)*(G.e-G.w)).toFixed(3))}
 const ts=startMs(p),hind=p.mode==='hind',hrS=new Date(ts).toISOString().slice(0,13)+':00',d0=isoD(ts),
 base=hind?'https://archive-api.open-meteo.com/v1/archive':'https://api.open-meteo.com/v1/forecast',
 tail=hind?`&start_date=${addD(d0,-3)}&end_date=${addD(d0,Math.ceil(p.hours/24))}`:`&past_days=3&forecast_days=${Math.min(16,Math.ceil(p.hours/24)+1)}`,outs=[];
 for(let i=0;i<la.length;i+=40){log(`Weather ${Math.min(i+40,la.length)}/${la.length} points…`);
  const url=`${base}?latitude=${la.slice(i,i+40)}&longitude=${lo.slice(i,i+40)}&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=UTC${tail}`,key=url+(hind?'':hrS);
  let j=await idb('get',key);if(!j){j=await getJ(url,'Open-Meteo');await idb('put',key,j);await sleep(500)}
  (Array.isArray(j)?j:[j]).forEach(o=>outs.push(o))}
 if(outs.length!==la.length)throw Error('Open-Meteo returned '+outs.length+' points, expected '+la.length);
 const t=outs[0].hourly.time,len=t.length,np=outs.length,sIdx=t.indexOf(hrS);if(sIdx<0)throw Error('Open-Meteo has no data for '+hrS+' UTC.');
 const M={nlx,nly,np,len,sIdx,sp,U:[],V:[],Ts:[],E:[],A:[]};
 for(const o of outs){const h=o.hourly,el=o.elevation||0,U=new Float32Array(len),V=new Float32Array(len),Ts=new Float32Array(len),E=new Float32Array(len),A=new Float32Array(len);
  for(let i=0;i<len;i++){const T=h.temperature_2m[i]??15,RH=h.relative_humidity_2m[i]??50,ws=h.wind_speed_10m[i]??0,th=(((h.wind_direction_10m[i]??0)+180)%360)*Math.PI/180;
   U[i]=ws*Math.sin(th);V[i]=ws*Math.cos(th);Ts[i]=T+.0065*el;E[i]=RH/100*esat(T)*Math.exp(el/2500);
   let a=0;for(let k=0;k<=72&&i-k>=0;k++)a+=(h.precipitation[i-k]??0)*Math.exp(-k/48);A[i]=a}
  M.U.push(U);M.V.push(V);M.Ts.push(Ts);M.E.push(E);M.A.push(A)}
 G.M=M;W=null;note('OK',`Open-Meteo: ${np} points (${nlx}×${nly}, ${sp.toFixed(1)} km), ${len} hours ${t[0]} to ${t[len-1]}, start ${hrS}.`)}

/* ================= FIRMS fire detections ================= */
function parseCSV(txt,src){const rows=txt.trim().split(/\r?\n/),h=rows[0].split(',').map(s=>s.trim()),ix=n=>h.indexOf(n),la=ix('latitude'),lo=ix('longitude'),ad=ix('acq_date'),at=ix('acq_time'),cf=ix('confidence'),ins=ix('instrument');
 if(la<0||lo<0||ad<0)throw Error('FIRMS: '+rows[0].slice(0,140));const out=[];
 for(let k=1;k<rows.length;k++){const c=rows[k].split(',');if(c.length<h.length-2)continue;const tm=String(c[at]||'0').padStart(4,'0'),b=src||(ins>=0&&/MODIS/i.test(c[ins])?'MODIS':'VIIRS'),conf=cf>=0?c[cf].trim().toLowerCase():'';
  if($('hiconf').checked&&(conf==='l'||conf==='low'||(!isNaN(+conf)&&conf!==''&&+conf<30)))continue;
  out.push({la:+c[la],lo:+c[lo],date:c[ad],t:Date.parse(c[ad]+'T'+tm.slice(0,2)+':'+tm.slice(2)+':00Z'),b})}
 return out}
async function firmsChunk(key,src,bb,d,nd){const url=`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${bb}/${nd}/${d}`,
 ck=JSON.stringify(['firms2',src,bb,d,nd]),old=(Date.now()-new Date(d))/864e5>nd+4;
 if(old){const c=await idb('get',ck);if(c)return c}
 let r;for(let a=0;;a++){try{r=await fetch(url);break}catch(e){if(a<1){await sleep(1500);continue}
  let reach=false;try{await fetch(url,{mode:'no-cors'});reach=true}catch(_){}
  throw Error(reach?'FIRMS answered but the browser blocked the reply (CORS). Use "Load FIRMS CSV" in the Data section, or click the map to place ignitions.':'FIRMS is unreachable from this browser (offline, VPN, ad-blocker or data-saver?).')}}
 const txt=await r.text(),rows=parseCSV(txt,src.replace(/_(NRT|SP)$/,''));if(old)await idb('put',ck,rows);return rows}
async function apiDetections(dA,dB,bb,key,bases){const jobs=[];
 for(let d=dA;d<=dB;d=addD(d,5)){const nd=Math.min(5,daysBetween(d,dB)+1),age=(Date.now()-new Date(d))/864e5;
  for(const b of bases)for(const suf of age>150?['_SP']:age<70?['_NRT']:['_SP','_NRT'])jobs.push({src:b+suf,d,nd})}
 const all=[],seen=new Set();let k=0,done=0,err=null;
 await Promise.all(Array.from({length:3},async()=>{while(k<jobs.length&&!err){const j=jobs[k++];try{const rows=await firmsChunk(key,j.src,bb,j.d,j.nd);
  for(const r of rows){const s=r.la+','+r.lo+','+r.t+r.b;if(!seen.has(s)){seen.add(s);all.push(r)}}}catch(e){err=e}
  log(`FIRMS requests ${++done}/${jobs.length}…`)}}));
 if(err)throw err;return all}
async function probeNet(){for(const[n,u]of[['FIRMS','https://firms.modaps.eosdis.nasa.gov/api/'],['Open-Meteo','https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0'],['Google','https://www.gstatic.com/generate_204'],['OSM tiles','https://tile.openstreetmap.org/0/0/0.png']]){
 const t=Date.now();try{await fetch(u,{mode:'no-cors'});note('INFO','probe '+n+': reachable ('+(Date.now()-t)+' ms)')}catch(e){note('ERR','probe '+n+': FAILED ('+e.name+': '+e.message+')')}}}
async function eeFirms(dA,dB){await ensureEE();const ck=JSON.stringify(['eef',dA,dB,bboxStr(),$('hiconf').checked]),oldE=(Date.now()-new Date(dB))/864e5>3;
 if(oldE){const c=await idb('get',ck);if(c){LASTSRC='MODIS via Earth Engine (cached)';note('OK','MODIS detections from saved cache: '+c.length);return c}}
 const rows=await eeFirms0(dA,dB);if(oldE)await idb('put',ck,rows);return rows}
async function eeFirms0(dA,dB){if(!eeReady)throw Error('Sign in to Earth Engine to use MODIS fire detections from Earth Engine.');
 const b=drawn.getBounds(),reg=ee.Geometry.Rectangle([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],'EPSG:4326',false),
 fc=ee.ImageCollection('FIRMS').filterDate(dA,addD(dB,1)).filterBounds(reg).map(img=>img.select(['T21','confidence']).addBands(ee.Image.pixelLonLat()).sample({region:reg,scale:1000})
  .map(f=>f.set('date',img.date().format('YYYY-MM-dd')))).flatten();
 log('Fire detections from Earth Engine (MODIS, 1 km)…');
 const r=await new Promise((ok,no)=>fc.getInfo((v,er)=>er?no(Error('Earth Engine FIRMS: '+er)):ok(v)));
 const rows=r.features.map(f=>f.properties).filter(o=>!($('hiconf').checked&&o.confidence<30)).map(o=>({la:o.latitude,lo:o.longitude,date:o.date,t:Date.parse(o.date+'T06:00:00Z'),b:'MODIS',day:true}));
 LASTSRC='MODIS via Earth Engine';note('OK','MODIS fire detections via Earth Engine: '+rows.length+' ('+dA+' to '+dB+', day-level times).');return rows}
const fbOn=()=>eeReady&&Date.now()-FBT<30*60e3;    // once FIRMS failed, MODIS via Earth Engine stays the source for 30 min (not retried on every click)
const srcBases=()=>[['fs_snpp','VIIRS_SNPP'],['fs_noaa','VIIRS_NOAA20'],['fs_modis','MODIS']].filter(x=>$(x[0]).checked).map(x=>x[1]);
async function getDetections(dA,dB,bb,key){const bs=srcBases(),useEE=$('fs_ee').checked;let out=[];
 if(!bs.length&&!useEE)throw Error('Select at least one fire source.');
 if(bs.length){if(!key||fbOn()){if(!eeReady)throw Error('Enter a FIRMS key or sign in to Earth Engine.');note('INFO','Using the MODIS fallback (Earth Engine).');if(!useEE)out=await eeFirms(dA,dB)}
  else try{note('INFO','FIRMS API '+dA+' to '+dB);out=await apiDetections(dA,dB,bb,key,bs);LASTSRC='FIRMS API';note('OK','FIRMS API: '+out.length+' detections.')}
  catch(e){note('ERR','FIRMS API failed: '+e.message);await probeNet();if(!eeReady)throw e;FBT=Date.now();try{localStorage.setItem('wf_fbt',FBT)}catch(_){}LASTSRC='MODIS via Earth Engine (fallback)';if(!useEE)out=await eeFirms(dA,dB)}}
 if(useEE)out=out.concat(await eeFirms(dA,dB));return out}
const bboxStr=()=>{const b=drawn.getBounds();return[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(4)).join(',')};
$('firmsfile').onchange=e=>{const f=e.target.files[0];if(!f){FILEROWS=null;return}f.text().then(t=>{FILEROWS=parseCSV(t);log(`Loaded ${FILEROWS.length} detections from the CSV file. They are used instead of the FIRMS API.`)}).catch(x=>{FILEROWS=null;log('CSV error: '+x.message)})};
async function loadFire(p){const ts=startMs(p),hind=p.mode==='hind',tA=hind?ts:Date.now()-p.look*36e5,tB=hind?ts+p.hours*36e5:Date.now();let rows;
 if(FILEROWS)rows=FILEROWS;else if(hind&&HROWS)rows=HROWS;else{const key=$('firms').value.trim();if(!key&&!$('fs_ee').checked&&!eeReady){log('No FIRMS key and not signed in to Earth Engine. Click the map to place ignition points.');return null}
  rows=await getDetections(isoD(tA),isoD(tB),bboxStr(),key)}
 const useSel=hind&&SEL.size,seedEnd=hind?(useSel?tB:ts+6*36e5):tB,seen=new Set();let nd=0;dots.clearLayers();
 for(const r of rows){if(useSel&&!SEL.has(r.date))continue;if(r.day?(r.date<isoD(tA)||r.date>isoD(tB)):(r.t<tA||r.t>tB))continue;const i=cellAt(r.la,r.lo);if(i<0)continue;nd++;const rad=r.b.startsWith('MODIS')?500:190;
  G.dets.push({i,rad,t:r.t});disc(i,rad,j=>G.obs[j]=1);L.circleMarker([r.la,r.lo],{pane:'dots',radius:3,weight:1,color:'#fff',fillColor:'#a855f7',fillOpacity:.9}).addTo(dots);
  if((r.day?r.date<=isoD(seedEnd):r.t<=seedEnd)&&!seen.has(i)){seen.add(i);G.centers.push(i)}}
 note(nd?'OK':'WARN',`Fire detections: ${rows.length} fetched, ${nd} inside the area and time window, ${G.centers.length} ignition points.`);
 return{nd,seeds:G.centers.length}}

/* fire history: real detections over a long period */
function buildRanges(){const ds=Object.keys(HBY).sort(),g=+$('gap').value||3;RNG=[];SELR.clear();SEL.clear();      // consecutive dates closer than g days form one range
 for(const d of ds){const l=RNG[RNG.length-1];if(l&&daysBetween(l.b,d)<=g){l.b=d;l.dates.push(d);l.n+=HBY[d].n}else RNG.push({a:d,b:d,dates:[d],n:HBY[d].n})}}
function renderHist(){const tot=RNG.reduce((a,r)=>a+r.n,0),A=(a,t)=>`<a href="#" ${a}>${t}</a>`;
 $('hist').innerHTML=tot?`<b>${tot}</b> detections in <b>${RNG.length}</b> date ranges (${LASTSRC||'loaded'}). Tap one or more ranges, then press 1. Prepare data.<br>`+A('data-all="1"','Select all')+' · '+A('data-none="1"','Clear all')+
  `<div class="dates">`+RNG.map((r,i)=>`<a href="#" data-r="${i}" class="${SELR.has(i)?'sel':''}">${i+1}: ${r.a}${r.b>r.a?' to '+r.b:''} (${r.n})</a>`).join(' ')+`</div><b>${SELR.size}</b> selected${SKIPN?`, ${SKIPN} range(s) fall after the 240 h limit and are ignored. Select fewer or closer ranges`:''}.`
  :'No detections in this area and period. If this looks wrong, check the date range and the FIRMS key.'}
const selSpan=()=>{if(MODE!=='hind'||!SEL.size)return 0;const ds=[...SEL].sort();return Math.ceil((Date.parse(ds[ds.length-1]+'T23:59:00Z')-startMs({mode:'hind'}))/36e5)+6};
function applySel(){SEL.clear();SELR.forEach(i=>RNG[i].dates.forEach(d=>SEL.add(d)));SKIPN=0;if(!SEL.size)return;const ds=[...SEL].sort();if(MODE!=='hind')document.querySelector('.tabs button[data-m=hind]').click();
 $('hs').value=ds[0];$('hh').value=new Date(HBY[ds[0]].t).getUTCHours();const need=selSpan(),t1=startMs({mode:'hind'})+240*36e5;$('hours').value=clamp(need,12,240);
 SKIPN=need>240?[...SELR].filter(i=>RNG[i].b>isoD(t1)).length:0}
$('hbtn').onclick=async()=>{const b=$('hbtn');try{if(!AOI)return log('Draw or load an area first.');const key=$('firms').value.trim();if(!key&&!FILEROWS&&!eeReady)return log('Enter a FIRMS key or sign in to Earth Engine first.');b.disabled=true;saveKeys();
 const dA=$('fh0').value,dB=$('fh1').value,rows=FILEROWS||await getDetections(dA,dB,bboxStr(),key),bd=drawn.getBounds();clearHist();dropGrid();
 const keep=[];for(const r of rows){if(r.date<dA||r.date>dB||!bd.contains([r.la,r.lo]))continue;keep.push(r);const o=HBY[r.date]||(HBY[r.date]={n:0,t:1e15});o.n++;o.t=Math.min(o.t,r.t);
  L.circleMarker([r.la,r.lo],{pane:'dots',radius:3,weight:1,color:'#fff',fillColor:'hsl('+(+r.date.slice(5,7)*30)+',90%,55%)',fillOpacity:.9}).addTo(hdots)}
 HROWS=keep;if(FILEROWS)LASTSRC='CSV file';buildRanges();renderHist();log(`Fire history: ${keep.length} detections on ${Object.keys(HBY).length} dates.`)}catch(e){log('Error: '+(e.message||e))}finally{b.disabled=false}};
$('hist').onclick=e=>{const a=e.target.closest('a');if(!a)return;e.preventDefault();
 if(a.dataset.all)RNG.forEach((r,i)=>SELR.add(i));else if(a.dataset.none)SELR.clear();else if(a.dataset.r!==undefined){const i=+a.dataset.r;SELR.has(i)?SELR.delete(i):SELR.add(i)}else return;
 applySel();renderHist()};
$('gap').oninput=()=>{if(Object.keys(HBY).length){buildRanges();renderHist()}};

/* ================= prepare ================= */
function mkOverlays(){const{nx,ny,w,e,s,n}=G,mk=()=>{const c=document.createElement('canvas');c.width=nx;c.height=ny;return c},bb=[[s,w],[n,e]];
 G.bgc=mk();G.cv=mk();G.ctx=G.cv.getContext('2d');G.im=G.ctx.createImageData(nx,ny);
 G.bgo=new CanvasOverlay(G.bgc,bb,{opacity:lop(),interactive:false,pane:'raster'}).addTo(map);G.fo=new CanvasOverlay(G.cv,bb,{interactive:false,pane:'raster'}).addTo(map)}
const lop=()=>clamp((+$('lop').value||90)/100,.2,1);
$('prep').onclick=async()=>{const b=$('prep');try{if(!AOI)return log('Draw or load an area first.');b.disabled=true;saveKeys();const p=P();dropGrid();const bb=drawn.getBounds();
 build({w:bb.getWest(),e:bb.getEast(),s:bb.getSouth(),n:bb.getNorth()},p,AOI);mkOverlays();
 log(`Grid ${G.nx} × ${G.ny} cells of ${p.cell} m (${(G.N/1e6).toFixed(2)} M cells). Loading satellite and terrain…`);
 await loadEE(p);await loadMet(p);const f=await loadFire(p);resetState(p.seedR);drawBG();checklist(f);map.fitBounds([[G.s,G.w],[G.n,G.e]]);
 log(`Ready: ${G.nx} × ${G.ny} cells of ${p.cell} m, weather lattice ${G.M.nlx} × ${G.M.nly} (${G.M.sp.toFixed(1)} km). ${f?`${f.nd} FIRMS detections, ${f.seeds} ignition points.`:''} ${G.gaps||''}${f&&!f.nd?' No FIRMS detections in this window: use "Show fire history" to find real fire dates.':''}`)}
 catch(e){log('Error: '+(e.message||e));note('ERR','stack: '+String(e.stack||'').split('\n').slice(0,3).join(' | '))}finally{b.disabled=false}};
map.on('click',ev=>{if(G&&G.im&&!running){const i=cellAt(ev.latlng.lat,ev.latlng.lng);if(i>=0){G.centers.push(i);igniteDisc(i,+$('seedr').value||60);G.ctx.putImageData(G.im,0,0)}}});

/* ================= background layers ================= */
const RAMP=[[40,60,130],[50,160,140],[250,225,60],[225,50,30]],ramp=t=>{t=clamp(t,0,1)*3;const k=Math.min(2,t|0),f=t-k,a=RAMP[k],b=RAMP[k+1];return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]};
const LCC={10:[0,100,0],20:[255,187,34],30:[255,255,76],40:[240,150,255],50:[250,0,0],60:[180,180,180],70:[240,240,240],80:[0,100,200],90:[0,150,160],95:[0,207,117],100:[250,230,160]};
function slopeOf(){if(G.slope)return G.slope;const{nx,ny,z,cell}=G,sl=new Uint8Array(G.N);      // Horn-style central differences, degrees
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const xa=Math.max(0,x-1),xb=Math.min(nx-1,x+1),ya=Math.max(0,y-1),yb=Math.min(ny-1,y+1),
  gx=(z[y*nx+xb]-z[y*nx+xa])/((xb-xa||1)*cell),gy=(z[yb*nx+x]-z[ya*nx+x])/((yb-ya||1)*cell);sl[y*nx+x]=Math.min(90,Math.round(Math.atan(Math.hypot(gx,gy))*57.29578))}
 return G.slope=sl}
function drawBG(){if(!G||!G.bgc)return;const v=$('lyr').value,{nx,ny,N,inside,base,z,lc,bx,obs,state}=G,c=G.bgc.getContext('2d'),im=c.createImageData(nx,ny),d=im.data,thr=(+$('bthr').value||.1)*1e4,lg=$('legend');
 let zmin=1e9,zmax=-1e9,sl=null,msg='';
 if(v==='z'){for(let i=0;i<N;i++)if(inside[i]){if(z[i]<zmin)zmin=z[i];if(z[i]>zmax)zmax=z[i]}msg=`Elevation ${zmin} to ${zmax} m (blue low, red high).`}
 if(v==='slope'){sl=slopeOf();msg='Slope 0 to 45° and steeper (blue flat, red steep).'}
 if(v==='bi'){msg=G.hasBI?`${$('bxsel').value==='rbr'?'RBR':'dNBR'} from -0.25 (blue) to 1.0 or more (red). Cells above ${thr/1e4} count as burnt. Grey = no satellite data.`:'No burn reference loaded. Tick "Fetch burn-scar reference from satellite" (Validation) and press 1. Prepare data again.'}
 if(v==='obs'&&!G.dets.length)msg='No FIRMS detections loaded for this run.';
 if(v==='water')msg='Water mask: WorldCover water or NDWI > 0.1. Fire cannot enter or cross it.';if(v==='prob')msg=G.prob?'Burn probability over the repeated runs (blue low, red high).':'No multi-run yet: press Run N times in Validation.';
 if(v==='fuel')msg='Fuel × moisture: blue = poor spread potential, red = high.';
 if(lg)lg.textContent=msg;if(msg&&/^No /.test(msg))note('WARN','Layer: '+msg);
 for(let i=0;i<N;i++){if(!inside[i])continue;let col=null;
  if(v==='fuel')col=ramp(base[i]/255*1.6);else if(v==='z')col=ramp((z[i]-zmin)/Math.max(1,zmax-zmin));else if(v==='slope')col=ramp(sl[i]/45);else if(v==='lc')col=LCC[lc[i]]||[128,128,128];else if(v==='water'){if(lc[i]===80)col=[40,120,255]}else if(v==='prob'){if(G.prob&&G.prob[i]>0)col=ramp(G.prob[i])}
  else if(v==='bi'){if(bx[i]===MISSING)col=[90,90,90];else col=ramp((bx[i]/1e4+.25)/1.25)}   // continuous index, not just the burnt cells
  else if(v==='obs'){if(obs[i])col=[190,80,250]}
  else if(v==='cmp'){const pr=state[i]===1||state[i]===2,ob=G.hasBI?(bx[i]!==MISSING&&bx[i]>thr):obs[i]===1;if(pr&&ob)col=[60,200,90];else if(pr)col=[240,60,60];else if(ob)col=[70,130,255]}
  if(col){d[i*4]=col[0];d[i*4+1]=col[1];d[i*4+2]=col[2];d[i*4+3]=255}}
 c.putImageData(im,0,0)}
$('lyr').onchange=drawBG;$('lop').oninput=()=>{if(G&&G.bgo)G.bgo.setOpacity(lop())};

/* ================= video, validation, charts ================= */
function vstart(){$('vlink').hidden=true;rec=null;if(!$('vid').checked||!window.MediaRecorder)return;const w=G.nx<720?G.nx*Math.floor(720/G.nx):960;
 vc=document.createElement('canvas');vc.width=w;vc.height=Math.round(G.ny*w/G.nx)+30;chunks=[];
 rec=new MediaRecorder(vc.captureStream(10));rec.ondataavailable=e=>chunks.push(e.data);
 rec.onstop=()=>{const a=$('vlink');a.href=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));a.download='fire-spread.webm';a.hidden=false};rec.start()}
function vframe(tm){if(!rec)return;const x=vc.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,vc.width,vc.height);x.imageSmoothingEnabled=vc.width<G.nx;
 if($('lyr').value!=='none'){x.globalAlpha=lop();x.drawImage(G.bgc,0,30,vc.width,vc.height-30);x.globalAlpha=1}
 x.drawImage(G.cv,0,30,vc.width,vc.height-30);x.fillStyle='#ffc21a';x.font='16px sans-serif';x.fillText(`t + ${(tm/60).toFixed(1)} h`,8,20)}
let SC=[],MR=[];
function dil(m,t){if(!t)return m;const{nx,ny,N}=G,a=new Uint8Array(N),b=new Uint8Array(N);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(m[y*nx+x])for(let k=Math.max(0,x-t);k<=Math.min(nx-1,x+t);k++)a[y*nx+k]=1;
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(a[y*nx+x])for(let k=Math.max(0,y-t);k<=Math.min(ny-1,y+t);k++)b[k*nx+x]=1;return b}
function scoresOf(ref,valid,tol){const{state,inside,lc,N,cell,nx}=G,pr=new Uint8Array(N),rf=new Uint8Array(N);let c1=[0,0,0],c2=[0,0,0];
 for(let i=0;i<N;i++){if(!inside[i]||NF[lc[i]]||(valid&&!valid(i)))continue;const x=i%nx,y=(i/nx)|0;
  if(state[i]===1||state[i]===2){pr[i]=1;c1[0]+=x;c1[1]+=y;c1[2]++}if(ref(i)){rf[i]=1;c2[0]+=x;c2[1]+=y;c2[2]++}}
 const dp=dil(pr,tol),dr=dil(rf,tol);let tp=0,fp=0,fn=0,tn=0;
 for(let i=0;i<N;i++){if(!inside[i]||NF[lc[i]]||(valid&&!valid(i)))continue;if(pr[i]){dr[i]?tp++:fp++}else if(rf[i]){dp[i]?tp++:fn++}else tn++}
 const n=tp+fp+fn+tn,d=(a,b)=>b?a/b:0,pre=d(tp,tp+fp),rec=d(tp,tp+fn),pe=d((tp+fp)*(tp+fn)+(fn+tn)*(fp+tn),n*n),km=c=>c*cell*cell/1e6;
 return{'TP (cells)':tp,'FP (cells)':fp,'FN (cells)':fn,'TN (cells)':tn,'Model area (km²)':km(c1[2]),'Reference area (km²)':km(c2[2]),Precision:pre,'Recall (sensitivity)':rec,Specificity:d(tn,tn+fp),Accuracy:d(tp+tn,n),
  'F1 (Dice)':d(2*pre*rec,pre+rec),'IoU (Jaccard)':d(tp,tp+fp+fn),'Commission error':d(fp,tp+fp),'Omission error':d(fn,tp+fn),'Area bias (%)':100*d(c1[2]-c2[2],c2[2]),
  "Cohen's kappa":d(d(tp+tn,n)-pe,1-pe),MCC:d(tp*tn-fp*fn,Math.sqrt((tp+fp)*(tp+fn)*(tn+fp)*(tn+fn))),'Centroid shift (m)':c1[2]&&c2[2]?Math.hypot(c1[0]/c1[2]-c2[0]/c2[2],c1[1]/c1[2]-c2[1]/c2[2])*cell:NaN}}
function validate(){if(!G||!G.M)return log('Prepare data and run a simulation first.');const thr=(+$('bthr').value||.1)*1e4,tol=clamp(+$('tol').value||0,0,3),cols=[];
 if(G.dets.length)cols.push(['FIRMS',scoresOf(i=>G.obs[i]===1,null,tol)]);
 if(G.hasBI)cols.push([($('bxsel').value==='rbr'?'RBR':'dNBR')+'>'+thr/1e4,scoresOf(i=>G.bx[i]>thr,i=>G.bx[i]!==MISSING,tol)]);
 if(!cols.length)return $('val').innerHTML='<p class="st">No reference data. Load FIRMS detections, or tick "Fetch burn-scar reference" and press 1. Prepare data again.</p>';
 const f=v=>Number.isNaN(v)?'-':Math.abs(v)>=100?v.toFixed(0):v.toFixed(3);SC=[];
 $('val').innerHTML='<table><tr><th>Metric (tolerance '+tol+' cell)</th>'+cols.map(c=>'<th>'+c[0]+'</th>').join('')+'</tr>'+Object.keys(cols[0][1]).map(k=>{cols.forEach(c=>SC.push([c[0],k,c[1][k]]));return'<tr><td>'+k+'</td>'+cols.map(c=>'<td>'+f(c[1][k])+'</td>').join('')+'</tr>'}).join('')+'</table><p class="st">Metrics use flammable cells only. Map layer "Model vs reference" shows agreement.</p>';
 if($('lyr').value==='cmp')drawBG()}
async function multiRun(){const b=$('mrun');if(!G||!G.M)return log('Prepare data first.');b.disabled=true;
 try{const p=P(),n=clamp(+$('nrun').value||10,2,60),thr=(+$('bthr').value||.1)*1e4;resetState(p.seedR);if(!G.act.length)return log('Nothing to ignite.');
  G.tbs=Math.max(1,Math.round(p.tb/p.dt));G.tbMax=G.tbs*3;const nS=Math.round(p.hours*60/p.dt),cnt=new Uint16Array(G.N),im=G.im;G.im=null;running=true;
  for(let r=0;r<n&&running;r++){resetState(p.seedR);for(let k=0;k<nS&&G.act.length;k++)step(p,k*p.dt);for(let i=0;i<G.N;i++)if(G.state[i]===1||G.state[i]===2)cnt[i]++;log(`Multi-run ${r+1}/${n}…`);await sleep(0)}
  G.im=im;running=false;resetState(p.seedR);G.prob=Float32Array.from(cnt,c=>c/n);
  const ref=G.hasBI?(i=>G.bx[i]>thr):(i=>G.obs[i]===1),ok=G.hasBI?(i=>G.bx[i]!==MISSING):()=>true,pos=new Float64Array(n+1),neg=new Float64Array(n+1);let br=0,tot=0;
  for(let i=0;i<G.N;i++){if(!G.inside[i]||NF[G.lc[i]]||!ok(i))continue;const y=ref(i)?1:0;(y?pos:neg)[cnt[i]]++;br+=(cnt[i]/n-y)**2;tot++}
  const P1=pos.reduce((a,c)=>a+c,0),N1=neg.reduce((a,c)=>a+c,0);if(!P1||!N1)return log('Multi-run done, but the reference has no burnt or no unburnt cells, so no curves.');
  const roc=[{x:0,y:0}],prc=[];let tp=0,fp=0,auc=0,ap=0,px=0,py=0,pR=0;
  for(let l=n;l>=0;l--){tp+=pos[l];fp+=neg[l];const tpr=tp/P1,fpr=fp/N1,pre=tp/Math.max(1,tp+fp);auc+=(fpr-px)*(tpr+py)/2;px=fpr;py=tpr;ap+=(tpr-pR)*pre;pR=tpr;roc.push({x:fpr,y:tpr});prc.push({x:tpr,y:pre})}
  MR.forEach(c=>c&&c.destroy());const mk=(id,t,d,xl,yl)=>new Chart($(id),{type:'scatter',data:{datasets:[{label:t,data:d,showLine:true,borderColor:'#ff7a00',pointRadius:0,borderWidth:2}].concat(id==='c4'?[{label:'chance',data:[{x:0,y:0},{x:1,y:1}],showLine:true,borderColor:'#777',borderDash:[4,4],pointRadius:0}]:[])},
   options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{title:{display:true,text:t,color:'#f3e9e1'}},scales:{x:{min:0,max:1,title:{display:true,text:xl}},y:{min:0,max:1,title:{display:true,text:yl}}}}});
  MR=[mk('c4',`ROC (AUC ${auc.toFixed(3)})`,roc,'False positive rate','True positive rate'),mk('c5',`Precision-Recall (AP ${ap.toFixed(3)})`,prc,'Recall','Precision')];
  $('mrres').innerHTML=`<b>${n} runs.</b> AUC ${auc.toFixed(3)}, average precision ${ap.toFixed(3)}, Brier score ${(br/tot).toFixed(4)}. Map layer "Burn probability" shows the result.`;
  SC.push(['multirun','AUC',auc],['multirun','AP',ap],['multirun','Brier',br/tot]);drawBG()}
 catch(e){log('Error: '+(e.message||e))}finally{running=false;b.disabled=false}}
$('mrun').onclick=multiRun;
$('dlplots').onclick=()=>{[...CH,...MR].forEach((c,i)=>{if(!c)return;const a=document.createElement('a');a.href=c.toBase64Image();a.download='plot-'+(i+1)+'.png';a.click()})};
$('dlcsv').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['reference,metric,value\n'+SC.map(r=>r.join(',')).join('\n')],{type:'text/csv'}));a.download='scores.csv';a.click()};
$('validate').onclick=validate;
function charts(){CH.forEach(c=>c&&c.destroy());Chart.defaults.color='#c9b8b0';Chart.defaults.borderColor='#2b2226';Chart.defaults.font.family='Manrope,system-ui,sans-serif';
 const pt=a=>a.map((y,i)=>({x:H.t[i],y})),
 ax=(pos,text,c,o={})=>({position:pos,title:{display:true,text,color:c},ticks:{color:c},grid:{drawOnChartArea:pos==='left',color:'#2b2226'},...o}),
 ds=(label,data,c,o={})=>({label,data:pt(data),borderColor:c,backgroundColor:c+'40',pointRadius:0,borderWidth:2,tension:.2,...o}),
 mk=(id,title,sets,scales)=>new Chart($(id),{type:'line',data:{datasets:sets},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
  plugins:{title:{display:true,text:title,color:'#f3e9e1'},legend:{labels:{boxWidth:12,boxHeight:3}}},scales:{x:{type:'linear',title:{display:true,text:'Hours since start'},ticks:{maxTicksLimit:7},grid:{color:'#2b2226'}},...scales}}}),
 cd={0:'N',90:'E',180:'S',270:'W',360:'N'};
 CH=[mk('c1','Fire growth',[ds('Burnt + burning (km²)',H.area,'#ff7a00',{fill:true,yAxisID:'y'}),ds('Burning now (km²)',H.act,'#e11d2e',{yAxisID:'y1'})],
   {y:ax('left','km²','#ff7a00',{min:0}),y1:ax('right','km² burning','#e11d2e',{min:0})}),
  mk('c2','Wind at the fire',[ds('Speed (m/s)',H.ws,'#ffc21a',{yAxisID:'y'}),ds('Blowing toward',H.wd,'#a8968f',{yAxisID:'y1',showLine:false,pointRadius:2})],
   {y:ax('left','m/s','#ffc21a',{min:0}),y1:ax('right','direction','#a8968f',{min:0,max:360,ticks:{stepSize:90,color:'#a8968f',callback:v=>cd[v]??v}})}),
  mk('c3','Temperature and humidity at the fire',[ds('Temperature (°C)',H.T,'#e11d2e',{yAxisID:'y'}),ds('Humidity (%)',H.RH,'#38bdf8',{yAxisID:'y1'})],
   {y:ax('left','°C','#e11d2e'),y1:ax('right','% RH','#38bdf8',{min:0,max:100})})]}

/* ================= run ================= */
const DEF={};document.querySelectorAll('aside input[type=number],aside input[type=range],aside input[type=date]').forEach(e=>DEF[e.id]=e.value);
function clearHist(){hdots.clearLayers();HROWS=null;HBY={};RNG=[];SELR.clear();SEL.clear();SKIPN=0;const h=$('hist');if(h)h.innerHTML=''}
$('reset').onclick=()=>{running=false;dropGrid();dots.clearLayers();clearHist();$('val').innerHTML='';$('vlink').hidden=true;if($('legend'))$('legend').textContent='';
 CH.forEach(c=>c&&c.destroy());CH=[];MR.forEach(c=>c&&c.destroy());MR=[];SC=[];$('mrres').innerHTML='';$('checks').innerHTML='';Object.keys(DEF).forEach(k=>$(k).value=DEF[k]);log('Reset: fire, layers, history, dates and results cleared. Your area is kept. Start again with Show fire history.')}
function diag(p){try{const i=G.act[0],x=i%G.nx,y=(i/G.nx)|0;setWeather(0);wxAt(x,y,G.z[i]);let bs=0,n=0;for(let j=0;j<G.N;j+=7)if(G.inside[j]&&!NF[G.lc[j]]){bs+=G.base[j];n++}
 const b=bs/Math.max(1,n)/255,R=p.R0*b*fWx();
 note(R<.05?'WARN':'OK',`Spread check at t=0: wind ${wV.toFixed(1)} m/s, T ${wT.toFixed(1)} C, RH ${Math.round(wRH)}%, rain index ${wA.toFixed(1)} mm. Factors: RH ${fRH(wRH).toFixed(2)}, T ${fT(wT).toFixed(2)}, rain ${fRain(wA).toFixed(2)}, mean fuel×moisture ${b.toFixed(2)}. Mean R about ${R.toFixed(2)} m/min (before wind and slope), so about ${(R*p.hours*60).toFixed(0)} m of front travel in ${p.hours} h.${R<.05?' Very slow: raise R0 or check fuel/moisture layers.':''}`)}catch(e){note('WARN','diag failed: '+e.message)}}
function checklist(f){const m=G.miss,t=Math.max(1,G.tot||1),bad=v=>m&&100*v/t>50,ok=(b,x)=>(b?'✔ ':'✖ ')+x,r=[ok(!!G.M,'Weather (Open-Meteo)'),ok(!$('noee').checked,'Earth Engine layers'),ok(!bad((m||{}).z||0),'Terrain (DEM, slope)'),
 ok(!bad((m||{}).nw||0)&&!bad((m||{}).nd||0),'Fuel curing (NDVI green minus dry)'),ok(!bad((m||{}).nm||0),'NDMI'),ok(!bad((m||{}).sm||0),'Soil moisture'),ok(G.nwat!==undefined,'Water mask ('+(G.nwat||0)+' cells)'),ok(!!(f&&f.nd),'Fire detections ('+(f?f.nd:0)+')'),ok(G.hasBI,'Burn reference (dNBR/RBR)')];
 $('checks').innerHTML=r.join('<br>');note('INFO','Data check: '+r.join(' | '))}
function record(tm){let cx=G.nx/2,cy=G.ny/2;if(G.act.length){let sx=0,sy=0;for(const i of G.act){sx+=i%G.nx;sy+=(i/G.nx)|0}cx=sx/G.act.length;cy=sy/G.act.length;G.lastC=[cx,cy]}else if(G.lastC)[cx,cy]=G.lastC;
 const ci=clamp(Math.round(cy),0,G.ny-1)*G.nx+clamp(Math.round(cx),0,G.nx-1);wxAt(cx,cy,G.z[ci]);const a=G.cell*G.cell/1e6;
 H.t.push(+(tm/60).toFixed(3));H.area.push(+((G.nBurnt+G.act.length)*a).toFixed(3));H.act.push(+(G.act.length*a).toFixed(3));H.ws.push(+wV.toFixed(1));H.wd.push(Math.round(wDir));H.T.push(+wT.toFixed(1));H.RH.push(Math.round(wRH))}
$('run').onclick=async()=>{if(running){running=false;return}if(!G||!G.M)return log('Prepare data first.');const p=P(),b=$('run');resetState(p.seedR);
 if(!G.act.length)return log('Nothing to ignite. Add a FIRMS key, or click the map (a fire cell must be flammable).');
 G.tbs=Math.max(1,Math.round(p.tb/p.dt));G.tbMax=G.tbs*3;diag(p);note('INFO',`Ignition: ${G.centers.length} points selected, ${G.centers.filter(c=>G.state[c]!==3).length} on burnable cells, ${G.act.length} cells ignited.`);const nS=Math.round(p.hours*60/p.dt),per=Math.max(1,Math.round(10/p.dt));
 running=true;b.textContent='Stop';H={t:[],area:[],act:[],ws:[],wd:[],T:[],RH:[]};vstart();$('val').innerHTML='';let tm=0;
 try{for(let k=0;k<nS&&running;k++){step(p,k*p.dt);tm=(k+1)*p.dt;
  if((k+1)%per===0||k===nS-1||!G.act.length){drawFrame();vframe(tm);record(tm);
   log(`t + ${(tm/60).toFixed(1)} h: ${H.area[H.area.length-1]} km² burnt or burning, ${G.act.length} active cells.`);await(rec?sleep(90):raf());if(!G.act.length)break}}
 drawFrame();if(rec&&rec.state!=='inactive')rec.stop();if(H.t.length)charts();
 note('OK',`Run finished: ${H.area[H.area.length-1]||0} km² burnt/burning after ${(tm/60).toFixed(1)} h, ${G.act.length} cells still active.`);
 log(`Finished at t + ${(tm/60).toFixed(1)} h${G.act.length?'':' (fire burnt out)'}: ${H.area[H.area.length-1]||0} km² burnt.`);
 if(p.mode==='hind'||G.hasBI||G.dets.length)validate();if($('lyr').value==='cmp')drawBG()}
 catch(e){log('Error: '+(e.message||e))}finally{running=false;b.textContent='2. Run simulation'}};

/* ================= English / Hindi ================= */
const HI={'Wildfire spread simulator':'वनाग्नि प्रसार सिमुलेटर','Nowcast':'नाउकास्ट','Forecast':'पूर्वानुमान','Hindcast':'हिंडकास्ट','Accounts':'खाते','Area of interest':'रुचि का क्षेत्र','Map layer':'मानचित्र परत','Model':'मॉडल','Validation':'सत्यापन','Results':'परिणाम','About the simulator':'सिमुलेटर के बारे में','Model equations':'मॉडल समीकरण','One-time setup':'एक बार की सेटिंग',
'Log (errors and loaded data)':'लॉग (त्रुटियाँ और लोड किया डेटा)','Sign in with Google':'Google से साइन इन करें','Save area as GeoJSON':'क्षेत्र GeoJSON के रूप में सेव करें','Show fire history on map':'मानचित्र पर आग का इतिहास दिखाएँ','Clear saved data cache':'सेव किया डेटा कैश साफ़ करें','1. Prepare data':'1. डेटा तैयार करें','2. Run simulation':'2. सिमुलेशन चलाएँ','Reset':'रीसेट','Validate last run':'पिछला रन सत्यापित करें','Copy log':'लॉग कॉपी करें',
'Fire data and environmental data':'आग का डेटा और पर्यावरणीय डेटा','Fire sources (select any)':'आग के स्रोत (कोई भी चुनें)','Ignore low-confidence detections':'कम विश्वसनीय पहचान छोड़ें','Fire history from':'आग का इतिहास से','to':'तक','Green season from':'हरा मौसम से','Dry season from':'सूखा मौसम से','Weather point spacing (km)':'मौसम बिंदुओं की दूरी (किमी)','Cell size (m)':'सेल आकार (मी)',
'Satellite (sets the cell size)':'उपग्रह (सेल आकार तय करता है)','Duration (hours)':'अवधि (घंटे)','Step length (minutes)':'चरण की लंबाई (मिनट)','Burn duration (minutes)':'जलने की अवधि (मिनट)','Ignition radius (m)':'प्रज्वलन त्रिज्या (मी)','Record video (.webm)':'वीडियो रिकॉर्ड करें (.webm)','Download video':'वीडियो डाउनलोड करें','Layer opacity (%)':'परत की पारदर्शिता (%)',
'Merge dates closer than (days) into one range':'इतने दिनों से पास की तारीखें एक रेंज में जोड़ें','Tolerance (cells)':'सहनशीलता (सेल)','Runs':'रन की संख्या','Run N times: probability, ROC, PR':'N बार चलाएँ: संभावना, ROC, PR','Download plots (PNG)':'प्लॉट डाउनलोड करें (PNG)','Download scores (CSV)':'स्कोर डाउनलोड करें (CSV)','Developer:':'डेवलपर:','How to use':'कैसे उपयोग करें',
'Sign in (Accounts) and draw or load an area.':'खाते में साइन इन करें और क्षेत्र बनाएँ या लोड करें।','Choose the mode: Nowcast, Forecast or Hindcast.':'मोड चुनें: नाउकास्ट, पूर्वानुमान या हिंडकास्ट।','Choose fire sources and a date range, press Show fire history on map, then select date ranges.':'आग के स्रोत और तारीखें चुनें, "आग का इतिहास दिखाएँ" दबाएँ, फिर तारीख़ रेंज चुनें।','Choose the satellite and the season windows, press 1. Prepare data and check the ✔/✖ list.':'उपग्रह और मौसम की तारीखें चुनें, "1. डेटा तैयार करें" दबाएँ और ✔/✖ सूची देखें।','Adjust simulation parameters if needed, then press 2. Run simulation.':'ज़रूरत हो तो पैरामीटर बदलें, फिर "2. सिमुलेशन चलाएँ" दबाएँ।','Validation: tick Fetch burn-scar reference before Prepare, then run Validate or Run N times.':'सत्यापन: Prepare से पहले "burn-scar reference" टिक करें, फिर Validate या N बार चलाएँ।','Download plots and scores from Results. Reset clears everything except keys and sign-in.':'परिणाम से प्लॉट और स्कोर डाउनलोड करें। रीसेट कुंजियों और साइन-इन को छोड़कर सब साफ़ करता है।'};
let LANG=localStorage.getItem('wf_lang')||'en';
function applyLang(){const w=document.createTreeWalker($('panel'),NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const cur=n.nodeValue.trim();if(!cur)continue;if(n.__en===undefined)n.__en=cur;const t=LANG==='hi'?HI[n.__en]:n.__en;if(t&&t!==cur)n.nodeValue=n.nodeValue.replace(cur,t)}$('lang').textContent=LANG==='hi'?'English':'हिन्दी'}
$('lang').onclick=()=>{LANG=LANG==='hi'?'en':'hi';localStorage.setItem('wf_lang',LANG);applyLang()};applyLang();
