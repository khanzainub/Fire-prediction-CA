'use strict';
const $=id=>document.getElementById(id),st=t=>$('eestatus').textContent=t;
const LOGS=[];function note(k,m){LOGS.push(new Date().toLocaleTimeString()+'  '+k+'  '+m);if(LOGS.length>400)LOGS.shift();const e=$('elog');if(e){e.textContent=LOGS.join('\n');e.scrollTop=e.scrollHeight}}
const log=t=>{$('log').textContent=t;if($('loadprogress')&&/^(Grid|Loading|Earth Engine tiles|Weather |Event |Ensemble |Ready|Baseline|Run finished)/.test(t))$('loadprogress').textContent=t;if(/^Error/.test(t))note('ERR',t.slice(7))};
window.addEventListener('error',e=>note('ERR','script: '+e.message));window.addEventListener('unhandledrejection',e=>note('ERR','promise: '+(e.reason&&e.reason.message||e.reason)));
$('copylog').onclick=()=>{const t=LOGS.join('\n');(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>log('Log copied.'),()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'text/plain'}));a.download='wildfire-log.txt';a.click()})};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),sleep=ms=>new Promise(r=>setTimeout(r,ms)),raf=()=>new Promise(r=>requestAnimationFrame(r));
const addD=(d,n)=>new Date(+new Date(d)+n*864e5).toISOString().slice(0,10),isoD=ms=>new Date(ms).toISOString().slice(0,10);
const daysBetween=(a,b)=>Math.round((+new Date(b)-+new Date(a))/864e5);
const MISSING=-32000,MAXC=4e6,TS=256;             // missing-value marker, max cells, EE tile size (cells)
const NF=new Uint8Array(256);[50,60,70,80].forEach(c=>NF[c]=1);   // non-flammable WorldCover classes
let MODE='now',G=null,AOI=null,eeReady=false,running=false,FILEROWS=null,CH=[],EXCH=[],rec,chunks,vc,H,HROWS=null,HBY={},SEL=new Set(),SKIPN=0,LASTSRC='',FBT=+localStorage.getItem('wf_fbt')||0,EVENTS=[],METRICS=[],PROB=null,RUNS=[],LANG='en',PREVIEW=null,previewSeq=0;
let BASE=null,CAL=null,CANDIDATE=null,SEARCH=[],CALWORKER=null,CALCANCEL=null,CALSTOP=false,RUN_KIND='baseline',REFS=[];
const bilingual=(en,hi)=>LANG==='hi'?hi:en;
const checklist=(rows)=>{$('checklist').innerHTML=rows.map(([ok,en,hi])=>`<div class="check ${ok?'good':'bad'}"><b aria-hidden="true">${ok?'✔':'✖'}</b><span>${bilingual(en,hi)}</span></div>`).join('')};
function openStep(id){document.querySelectorAll('aside details').forEach(d=>d.open=d.id===id)}

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
function clearPreview(){++previewSeq;if(PREVIEW?.overlay)PREVIEW.overlay.remove();PREVIEW=null;$('curestatus').textContent=LANG==='hi'?'AOI और NDVI की दोनों तारीखें चुनें, फिर Preview दबाएँ।':'Choose an AOI and both NDVI date ranges, then press Preview.'}
function setAOI(){const polys=[];drawn.eachLayer(l=>{const g=l.toGeoJSON().geometry;g.type==='Polygon'?polys.push(g.coordinates):g.coordinates.forEach(c=>polys.push(c))});
 AOI=polys.length?polys:null;dropGrid();clearPreview();clearHist();if(AOI)localStorage.setItem('wf_aoi',JSON.stringify(AOI));else localStorage.removeItem('wf_aoi');log(AOI?'Area set.':'No area.')}
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
 $('hindbox').hidden=MODE!=='hind';if(!SEL.size)$('hours').value={now:12,fore:72,hind:24}[MODE];if(MODE==='hind')$('usebi').checked=true;dropGrid()});
$('sensor').onchange=()=>{$('cell').value=$('sensor').value==='s2'?10:30;dropGrid()};
$('fh1').value=new Date().toISOString().slice(0,10);$('fh0').value=addD($('fh1').value,-365);
function chosenSources(){return [...document.querySelectorAll('.firesrc:checked')].map(x=>x.value)}
$('gap').onchange=()=>renderHist();$('sensor').onchange=()=>{$('cell').value=$('sensor').value==='s2'?10:30;clearPreview();dropGrid()};$('dem').onchange=dropGrid;
function useFireDefaults(a,b){if(!a||!b)return;for(const [lo,hi,from,to] of [['nm0','nm1',-30,-1],['wi0','wi1',-30,-1],['met0','met1',0,0],['lst0','lst1',-45,-1]]){if(!$(lo).value)$(lo).value=addD(a,from);if(!$(hi).value)$(hi).value=to?addD(a,to):b}}

const weight=id=>clamp(Number($(id).value),0,2);
const P=()=>({mode:MODE,sensor:$('sensor').value,dem:$('dem').value,cell:Math.max(5,+$('cell').value||30),cureThr:+$('curethr').value,hours:clamp(+$('hours').value||12,1,8760),dt:clamp(+$('dt').value||2,.25,30),
 R0:+$('r0').value||10,tb:+$('tb').value||20,seedR:+$('seedr').value||60,look:+$('look').value||24,spc:Math.max(1,+$('wsp').value||5),
 ww0:$('ww0').value,ww1:$('ww1').value,dw0:$('dw0').value,dw1:$('dw1').value,nm0:$('nm0').value,nm1:$('nm1').value,wi0:$('wi0').value,wi1:$('wi1').value,lst0:$('lst0').value,lst1:$('lst1').value,met0:$('met0').value,met1:$('met1').value,ignmode:$('ignmode').value,moistScale:+$('moistScale').value||1,rainScale:+$('rainScale').value||1,bi:$('usebi').checked,bx:$('bxsel').value,pre:+$('pre').value||45,post:+$('post').value||45,
 wCure:weight('wCure'),wNdmi:weight('wNdmi'),wSoil:weight('wSoil'),wSlope:weight('wSlope'),wElev:weight('wElev'),wWind:weight('wWind'),wWindDir:weight('wWindDir'),wTemp:weight('wTemp'),wRh:weight('wRh'),wRain:weight('wRain'),wLST:weight('wLST')});
const startMs=p=>{if(p.start)return p.start;if(p.mode==='hind')return Date.parse($('hs').value+'T'+String(clamp(+$('hh').value||0,0,23)).padStart(2,'0')+':00:00Z');const n=new Date();n.setUTCMinutes(0,0,0);return+n};

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
function eeInit(){const p=$('project').value.trim();ee.initialize(null,null,()=>{eeReady=true;st('Signed in. Earth Engine ready.');$('accounts').open=false;note('OK','Earth Engine ready (project '+p+')')},e=>{st('Earth Engine init failed: '+e);note('ERR','Earth Engine init failed: '+e)},null,p)}
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
 G={w,n,dx,dy,e:w+nx*dx,s:n-ny*dy,nx,ny,N,cell:p.cell,z:new Int16Array(N),demMissing:new Uint8Array(N),lc:new Uint8Array(N).fill(30),base:new Uint8Array(N),inside:new Uint8Array(N),nw:new Int16Array(N).fill(MISSING),nd:new Int16Array(N).fill(MISSING),nm:new Int16Array(N).fill(MISSING),sm:new Int16Array(N).fill(MISSING),wi:new Int16Array(N).fill(MISSING),lst:new Int16Array(N).fill(MISSING),fuelMask:new Uint8Array(N),water:new Uint8Array(N),prob:null,seedSpec:[],skipped:[],
  state:new Uint8Array(N),age:new Uint16Array(N),obs:new Uint8Array(N),bx:new Int16Array(N).fill(MISSING),hasBI:false,act:[],nBurnt:0,tbs:1,centers:[],dets:[],M:null};
 rasterize(aoi)}
function rasterize(aoi,grid=G){const{nx,ny,w,n,dx,dy,inside}=grid;      // scan-line polygon fill, even-odd rule (holes work)
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
function resetState(rm){const{N,state,inside,lc}=G;for(let i=0;i<N;i++)state[i]=inside[i]&&!NF[lc[i]]&&!G.water[i]&&G.fuelMask[i]?0:3;
 G.age.fill(0);G.act=[];G.nBurnt=0;G.lastC=null;if(G.im)G.im.data.fill(0);if(G.seedSpec.length)G.seedSpec.forEach(o=>igniteDisc(o.i,o.rad));else G.centers.forEach(c=>igniteDisc(c,rm));if(G.im)G.ctx.putImageData(G.im,0,0)}

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
 const zWeight=G.params?.wElev??1;wT=bl(W.Ts)-.0065*zc*zWeight;
 wRH=clamp(100*bl(W.E)*Math.exp(-zc*zWeight/2500)/esat(wT),2,100);
 wA=bl(W.A)}

/* ================= the automaton ================= */
const DX=[-1,0,1,-1,1,-1,0,1],DY=[-1,-1,-1,0,0,1,1,1],SQ=Math.SQRT2,
 COSA=DX.map((x,k)=>-DY[k]/Math.hypot(x,DY[k])),SINA=DX.map((x,k)=>x/Math.hypot(x,DY[k]));
// weather factor: each term is softened and has a floor, so humid or wet weather slows the fire but never stops it outright
// (the old product of five terms fell to ~0 in humid/wet weather, so nothing ever spread)
const fRH=rh=>Math.max(.15,1-.75*(rh/100)**2),fT=t=>clamp(Math.exp(.03*(t-25)),.6,1.6),fRain=a=>.3+.7*Math.exp(-.1*a),fWx=()=>fRH(wRH)*fT(wT)*fRain(wA);
const influence=(factor,w)=>Math.max(.03,1+w*(factor-1));
function step(p,tmin){const{nx,ny,state,age,z,base,cell}=G;G.params=p;setWeather(tmin);const keep=[],born=[];
 for(const i of G.act){const x=i%nx,y=(i-x)/nx,zi=z[i];wxAt(x,y,zi);
  const V=wV;
  let left=0;   // neighbours that could still catch fire
  for(let k=0;k<8;k++){const X=x+DX[k],Y=y+DY[k];if(X<0||Y<0||X>=nx||Y>=ny)continue;const j=Y*nx+X;if(state[j]!==0)continue;if(DX[k]&&DY[k]&&G.water[y*nx+X]&&G.water[Y*nx+x])continue;
  const d=DX[k]&&DY[k]?cell*SQ:cell,dot=COSA[k]*wCos+SINA[k]*wSin,
    pw=V>.05?Math.exp(.045*V*p.wWind+.131*V*(dot-1)*p.wWind*p.wWindDir):1,
    ps=G.demMissing[i]||G.demMissing[j]?1:Math.exp(.078*clamp(Math.atan((z[j]-zi)/Math.max(d,30))*57.29578,-45,45)*p.wSlope),
    lst=G.lst[j]===MISSING||!Number.isFinite(G.lstMean)?1:clamp(Math.exp(.025*(G.lst[j]/100-G.lstMean)),.7,1.4),
    R=Math.max(.03,p.R0*(base[j]/255)*(p.moistScale||1)*influence(fRH(wRH),p.wRh)*influence(fT(wT),p.wTemp)*influence(fRain(wA*(p.rainScale||1)),p.wRain)*influence(lst,p.wLST)*pw*ps*(G.variation?G.variation[j]:1));
   if(Math.random()<1-Math.exp(-R*p.dt/d)){state[j]=1;age[j]=0;born.push(j);paintFlame(j,0)}else left++}
  // a cell burns at least tbs steps. After that it keeps burning while it still has an unburnt flammable neighbour (front keeps moving at R
  // even when R*burn time < one cell), up to tbMax. Without this, slow fires die at the percolation threshold and never spread.
  if(++age[i]>=G.tbs&&(left===0||age[i]>=(G.tbMax||G.tbs*12))){state[i]=2;G.nBurnt++;paintBurnt(i)}else keep.push(i)}
 G.act=keep.concat(born)}
// ===MODEL-END===

/* ================= Earth Engine: native-resolution raster, fetched in tiles ================= */
const PH=['red','nir','sw1','sw2','green'];
function sr(sen,a,b,reg,maxCloud,field){let c;
 if(sen==='s2')c=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(reg).filterDate(a,b).filter(maxCloud===undefined?ee.Filter.gte('system:time_start',0):ee.Filter.lte(field,maxCloud)).map(i=>{const s=i.select('SCL'),ok=s.eq(3).or(s.eq(8)).or(s.eq(9)).or(s.eq(10)).or(s.eq(11)).not();
  return i.select(['B4','B8','B11','B12','B3'],PH).divide(1e4).updateMask(ok)});
 else c=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterBounds(reg).filterDate(a,b).filter(maxCloud===undefined?ee.Filter.gte('system:time_start',0):ee.Filter.lte(field,maxCloud))
  .map(i=>i.select(['SR_B4','SR_B5','SR_B6','SR_B7','SR_B3'],PH).multiply(2.75e-5).add(-0.2).updateMask(i.select('QA_PIXEL').bitwiseAnd(26).eq(0)));
 c=c.merge(ee.ImageCollection([ee.Image.constant([0,0,0,0,0]).rename(PH).updateMask(ee.Image.constant(0))]));   // fully masked dummy: an empty window gives "no data", not an error
 const m=c.median();return ee.Image.cat([m.normalizedDifference(['nir','red']).rename('ndvi'),m.normalizedDifference(['nir','sw1']).rename('ndmi'),m.normalizedDifference(['nir','sw2']).rename('nbr'),m.normalizedDifference(['green','nir']).rename('ndwi')])}
function srClear(sen,a,b,reg){const field=sen==='s2'?'CLOUDY_PIXEL_PERCENTAGE':'CLOUD_COVER';return sr(sen,a,b,reg,10,field)}
function eeImage(p,reg){const d0=isoD(startMs(p)),dEnd=p.eventEnd?addD(p.eventEnd,1):EVENTS.length?addD(EVENTS.at(-1).end,1):isoD(startMs(p)+p.hours*36e5),
 era=ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR').filterDate(addD(d0,-10),d0).select('volumetric_soil_water_layer_1')
  .merge(ee.ImageCollection([ee.Image.constant(0).rename('volumetric_soil_water_layer_1').updateMask(ee.Image.constant(0))])).mean().rename('sm'),
 bands=[sr(p.sensor,p.ww0,addD(p.ww1,1),reg).select('ndvi').rename('nw'),sr(p.sensor,p.dw0,addD(p.dw1,1),reg).select('ndvi').rename('nd'),sr(p.sensor,p.nm0||addD(d0,-30),addD(p.nm1||d0,1),reg).select('ndmi').rename('nm'),sr(p.sensor,p.wi0||addD(d0,-30),addD(p.wi1||d0,1),reg).select('ndwi').rename('wi'),era];
 if(p.bi){const clear=(a,b)=>srClear(p.sensor,a,b,reg).select('nbr'),pre=clear(addD(d0,-p.pre),d0),post=clear(dEnd,addD(dEnd,p.post)),dn=pre.subtract(post);
  bands.push((p.bx==='rbr'?dn.divide(pre.add(1.001)).clamp(-2,3):dn.clamp(-2,3)).rename('bx'))}
 const lstRaw=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterBounds(reg).filterDate(p.lst0||addD(d0,-45),addD(p.lst1||addD(d0,-1),1)).filter(ee.Filter.eq('PROCESSING_LEVEL','L2SP')).filter(ee.Filter.lte('CLOUD_COVER',10)).map(i=>i.select('ST_B10').multiply(.00341802).add(149).subtract(273.15).updateMask(i.select('QA_PIXEL').bitwiseAnd(63).eq(0))),
 lst=lstRaw.merge(ee.ImageCollection([ee.Image.constant(0).rename('ST_B10').updateMask(ee.Image.constant(0))])).median().multiply(100).round().toInt16().rename('lst'),
 cont=ee.Image.cat(bands).multiply(1e4).round().toInt16(),
 cop=ee.ImageCollection('COPERNICUS/DEM/GLO30').select('DEM'),
 dem=p.dem==='srtm'?ee.Image('USGS/SRTMGL1_003').select('elevation'):cop.mosaic().setDefaultProjection(ee.Image(cop.first()).projection()),
 stat=ee.Image.cat([dem.rename('z'),ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').rename('lc')]).toInt16(),
 wc=ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').eq(80).unmask(0),
 water=wc.reduceResolution({reducer:ee.Reducer.max(),maxPixels:1024}).rename('wcWater');
 return ee.Image.cat([cont,lst,stat,water]).reproject({crs:'EPSG:4326',crsTransform:[G.dx,0,G.w,0,-G.dy,G.n]}).unmask(MISSING)}   // nearest neighbour onto our grid
async function eeTile(img,x0,y0,tw,th,grid=G){
 const reg=ee.Geometry.Rectangle([grid.w+(x0+.25)*grid.dx,grid.n-(y0+th-.25)*grid.dy,grid.w+(x0+tw-.25)*grid.dx,grid.n-(y0+.25)*grid.dy],'EPSG:4326',false);
 const r=await new Promise((ok,no)=>img.sampleRectangle({region:reg,defaultValue:MISSING}).getInfo((v,er)=>er?no(Error(er)):ok(v))),o=r.properties,out={};
 for(const k in o){out[k]=Int16Array.from(o[k].flat());if(out[k].length!==tw*th)throw Error(`Earth Engine tile size mismatch (${out[k].length} vs ${tw*th})`)}return out}
function baseOf(nw,nd,nm,sm,p){const fn=nw!==MISSING&&nd!==MISSING?clamp((nw-nd)/5000,0,1):0,mv=nm!==MISSING?clamp((nm/1e4+.2)/.6,0,1):.5,ms=sm!==MISSING?clamp(sm/1e4/.4,0,1):.5;
 const fuel=1+p.wCure*((.25+.75*fn)-1),moist=Math.max(.03,1-.8*(.7*mv*p.wNdmi+.3*ms*p.wSoil));return clamp(fuel*moist,0,1)}
const hasFuel=(nw,nd,threshold)=>nw!==MISSING&&nd!==MISSING&&(nw-nd)/1e4>=threshold;
function previewGrid(p){const b=drawn.getBounds(),n=b.getNorth(),w=b.getWest(),dx=p.cell/(111320*Math.cos((n+b.getSouth())/2*Math.PI/180)),dy=p.cell/111320,
 nx=Math.max(1,Math.ceil((b.getEast()-w)/dx)),ny=Math.max(1,Math.ceil((n-b.getSouth())/dy)),N=nx*ny;
 if(N>MAXC)throw Error(`Preview needs ${(N/1e6).toFixed(1)} million cells. Draw a smaller AOI or select Landsat 30 m.`);
 const grid={w,n,dx,dy,nx,ny,N,e:w+nx*dx,s:n-ny*dy,inside:new Uint8Array(N),nw:new Int16Array(N).fill(MISSING),nd:new Int16Array(N).fill(MISSING)};rasterize(AOI,grid);return grid}
function renderPreview(){if(!PREVIEW)return;const {grid:g,canvas}=PREVIEW,im=canvas.getContext('2d').createImageData(g.nx,g.ny),d=im.data,thr=+$('curethr').value;let eligible=0,missing=0,blocked=0;
 for(let i=0;i<g.N;i++){if(!g.inside[i])continue;const k=i*4,unknown=g.nw[i]===MISSING||g.nd[i]===MISSING,ok=!unknown&&hasFuel(g.nw[i],g.nd[i],thr),c=unknown?[125,125,125]:ok?[41,174,91]:[200,65,50];if(unknown)missing++;else if(ok)eligible++;else blocked++;d[k]=c[0];d[k+1]=c[1];d[k+2]=c[2];d[k+3]=255}
 canvas.getContext('2d').putImageData(im,0,0);$('curestatus').textContent=LANG==='hi'?`ΔNDVI ≥ ${thr.toFixed(2)}: ईंधन ${eligible}, ईंधन रहित ${blocked}, NDVI अनुपलब्ध ${missing} सेल। हरा = ईंधन; लाल = ईंधन रहित; धूसर = डेटा नहीं।`:`ΔNDVI ≥ ${thr.toFixed(2)}: ${eligible} fuel, ${blocked} no fuel, ${missing} missing NDVI cells. Green = fuel; red = no fuel; grey = no data.`;
 $('legend').textContent=$('curestatus').textContent}
function attachPreview(grid){if(PREVIEW?.overlay)PREVIEW.overlay.remove();const canvas=document.createElement('canvas');canvas.width=grid.nx;canvas.height=grid.ny;const overlay=new CanvasOverlay(canvas,[[grid.s,grid.w],[grid.n,grid.e]],{opacity:1,interactive:false,pane:'raster'}).addTo(map);PREVIEW={grid,canvas,overlay};$('lyr').value='fuelmask';renderPreview()}
$('previewcure').onclick=async()=>{const button=$('previewcure'),seq=++previewSeq;try{if(!AOI)throw Error('Draw or load an AOI first.');const p=P();if(!p.ww0||!p.ww1||!p.dw0||!p.dw1||p.ww0>p.ww1||p.dw0>p.dw1)throw Error('Choose valid green and dry NDVI date ranges.');await ensureEE();if(!eeReady)throw Error('Sign in to Earth Engine to preview actual NDVI rasters.');button.disabled=true;$('curestatus').textContent='Loading green and dry NDVI only…';const g=previewGrid(p),reg=ee.Geometry.Rectangle([g.w,g.s,g.e,g.n],'EPSG:4326',false),image=ee.Image.cat([sr(p.sensor,p.ww0,addD(p.ww1,1),reg).select('ndvi').rename('nw'),sr(p.sensor,p.dw0,addD(p.dw1,1),reg).select('ndvi').rename('nd')]).multiply(1e4).round().toInt16().reproject({crs:'EPSG:4326',crsTransform:[g.dx,0,g.w,0,-g.dy,g.n]}).unmask(MISSING),tiles=[];
 for(let y=0;y<g.ny;y+=TS)for(let x=0;x<g.nx;x+=TS){const tw=Math.min(TS,g.nx-x),th=Math.min(TS,g.ny-y);let any=false;for(let yy=y;yy<y+th&&!any;yy++)for(let xx=x;xx<x+tw;xx++)if(g.inside[yy*g.nx+xx]){any=true;break}if(any)tiles.push({x,y,tw,th})}
 const key=JSON.stringify(['cure-preview-1',p.sensor,g.w,g.n,g.nx,g.ny,p.ww0,p.ww1,p.dw0,p.dw1]);let cursor=0,done=0,err=null;await Promise.all(Array.from({length:4},async()=>{while(cursor<tiles.length&&!err&&seq===previewSeq){const t=tiles[cursor++];try{const ck=key+JSON.stringify([t.x,t.y,t.tw,t.th]);let o=await idb('get',ck);if(!o){o=await eeTile(image,t.x,t.y,t.tw,t.th,g);await idb('put',ck,o)}for(let j=0;j<t.th;j++)for(let i=0;i<t.tw;i++){const dst=(t.y+j)*g.nx+t.x+i,src=j*t.tw+i;g.nw[dst]=o.nw[src];g.nd[dst]=o.nd[src]}$('curestatus').textContent=`NDVI tiles ${++done}/${tiles.length}…`}catch(e){err=e}}}));if(err)throw err;if(seq!==previewSeq)return;dropGrid();attachPreview(g);map.fitBounds([[g.s,g.w],[g.n,g.e]])}catch(e){$('curestatus').textContent='Error: '+e.message;note('ERR','NDVI preview: '+e.message)}finally{button.disabled=false}};
$('curethr').oninput=()=>{$('curevalue').textContent=(+$('curethr').value).toFixed(2);if(G){const g={w:G.w,n:G.n,e:G.e,s:G.s,nx:G.nx,ny:G.ny,N:G.N,inside:G.inside,nw:G.nw,nd:G.nd};dropGrid();attachPreview(g);log('Threshold changed. Preview updated; press Prepare again before running.')}else if(PREVIEW)renderPreview()};
for(const id of ['ww0','ww1','dw0','dw1'])$(id).addEventListener('change',()=>{clearPreview();dropGrid()});
for(const id of ['lst0','lst1'])$(id).addEventListener('change',dropGrid);
async function loadEE(p){const{nx,ny,N}=G;
 if($('noee').checked){for(let i=0;i<N;i++){G.z[i]=0;G.lc[i]=30;G.nw[i]=8000;G.nd[i]=2000;G.nm[i]=2000;G.sm[i]=2000;G.base[i]=Math.round(baseOf(8000,2000,2000,2000,p)*255);G.fuelMask[i]=hasFuel(8000,2000,p.cureThr)?1:0}G.variation=makeVariation(N);G.gaps='Satellite layers skipped for testing. LST unavailable.';return}
 const fireStart=isoD(startMs(p));if((p.lst0&&p.lst1&&p.lst0>p.lst1)||(p.lst1&&p.lst1>=fireStart))throw Error('LST date range must end before the fire start date.');
 await ensureEE();if(!eeReady)throw Error('Sign in to Earth Engine first (tap Sign in with Google), or tick "Skip Earth Engine".');
 const img=eeImage(p,ee.Geometry.Rectangle([G.w,G.s,G.e,G.n],'EPSG:4326',false)),tiles=[];
 for(let y0=0;y0<ny;y0+=TS)for(let x0=0;x0<nx;x0+=TS){const tw=Math.min(TS,nx-x0),th=Math.min(TS,ny-y0);let any=false;
  for(let y=y0;y<y0+th&&!any;y++)for(let x=x0;x<x0+tw;x++)if(G.inside[y*nx+x]){any=true;break}
  if(any)tiles.push({x0,y0,tw,th})}
 const d0=isoD(startMs(p)),miss={nw:0,nd:0,nm:0,wi:0,sm:0,bx:0,z:0,lst:0},cnt={done:0,hit:0};let err=null,tot=0;
 const kb=JSON.stringify(['ee5',p.sensor,p.dem,p.cell,G.w,G.n,p.ww0,p.ww1,p.dw0,p.dw1,p.nm0,p.nm1,p.wi0,p.wi1,p.lst0,p.lst1,d0,p.bi?[p.bx,p.pre,p.post,p.hours]:0]);
 const work=async t=>{if(err)return;try{const key=kb+JSON.stringify([t.x0,t.y0,t.tw,t.th]);let o=await idb('get',key);if(o)cnt.hit++;else{o=await eeTile(img,t.x0,t.y0,t.tw,t.th);await idb('put',key,o)}
  for(let ty=0;ty<t.th;ty++)for(let tx=0;tx<t.tw;tx++){const q=ty*t.tw+tx,i=(t.y0+ty)*nx+t.x0+tx;if(!G.inside[i])continue;tot++;
   const nw=o.nw[q],nd=o.nd[q],nm=o.nm[q],sm=o.sm[q];if(nw===MISSING)miss.nw++;if(nd===MISSING)miss.nd++;if(nm===MISSING)miss.nm++;if(sm===MISSING)miss.sm++;if(o.wi[q]===MISSING)miss.wi++;if(o.lst[q]===MISSING)miss.lst++;G.nw[i]=nw;G.nd[i]=nd;G.nm[i]=nm;G.sm[i]=sm;G.wi[i]=o.wi[q];G.lst[i]=o.lst[q];
   G.demMissing[i]=o.z[q]===MISSING?1:0;G.z[i]=o.z[q]===MISSING?0:o.z[q];if(G.demMissing[i])miss.z++;G.lc[i]=o.lc[q]===MISSING?30:o.lc[q];
   G.base[i]=Math.round(baseOf(nw,nd,nm,sm,p)*255);G.fuelMask[i]=hasFuel(nw,nd,p.cureThr)?1:0;G.water[i]=(o.wcWater[q]===1||o.wi[q]!==MISSING&&o.wi[q]>0)?1:0;
   if(o.bx){G.bx[i]=o.bx[q];if(o.bx[q]===MISSING)miss.bx++;else G.hasBI=true}}
  cnt.done++;log(`Earth Engine tiles ${cnt.done}/${tiles.length} (${cnt.hit} from cache)…`)}catch(e){err=e}};
 let k=0;await Promise.all(Array.from({length:4},async()=>{while(k<tiles.length&&!err)await work(tiles[k++])}));if(err)throw err;
 const pc=v=>Math.round(100*v/Math.max(1,tot));
 note('OK',`Earth Engine: ${tiles.length} tiles of ${TS}×${TS} cells (${cnt.hit} from cache), ${tot} cells inside the area.`);
 G.variation=makeVariation(N);G.gaps=`Data gaps (% of cells): green NDVI ${pc(miss.nw)}, dry NDVI ${pc(miss.nd)}, NDMI ${pc(miss.nm)}, NDWI ${pc(miss.wi)}, DEM ${pc(miss.z)}, LST ${pc(miss.lst)}, soil ${pc(miss.sm)}${p.bi?', burn index '+pc(miss.bx):''}.`;note(miss.nw||miss.nd||miss.lst||miss.z?'WARN':'OK',G.gaps);
 let lstSum=0,lstN=0,fuelN=0;for(let i=0;i<N;i++)if(G.inside[i]){if(G.lst[i]!==MISSING){lstSum+=G.lst[i]/100;lstN++}if(G.fuelMask[i])fuelN++}G.lstMean=lstN?lstSum/lstN:NaN;note(lstN?'OK':'WARN',`Pre-fire LST: ${lstN}/${tot} valid cells, mean ${lstN?G.lstMean.toFixed(1)+' °C':'missing'}; fuel mask: ${fuelN}/${tot} cells pass ΔNDVI ≥ ${p.cureThr.toFixed(2)}.`);
 let bs=0,bn=0;for(let i=0;i<G.N;i++)if(G.inside[i]){bs+=G.base[i];bn++}note('OK',`Fuel×moisture factor mean ${(bs/Math.max(1,bn)/255).toFixed(2)}, burn reference ${G.hasBI?'loaded':'not loaded'}.`)}

function makeVariation(N){const out=new Float32Array(N);let x=0x72ae391d;for(let i=0;i<N;i++){x^=x<<13;x^=x>>>17;x^=x<<5;out[i]=.95+(x>>>0)/4294967296*.1}return out}
function refreshFuel(p){if(!G)return;for(let i=0;i<G.N;i++)if(G.inside[i])G.base[i]=Math.round(baseOf(G.nw[i],G.nd[i],G.nm[i],G.sm[i],p)*255);G.params=p;drawBG()}
/* ================= Open-Meteo lattice ================= */
const WX_CACHE=new Map();async function loadMet(p){const cacheKey=JSON.stringify([G.w,G.n,G.nx,G.ny,p.start||startMs(p),p.hours,p.met0,p.met1,p.spc,p.mode]);if(WX_CACHE.has(cacheKey)){G.M=WX_CACHE.get(cacheKey);W=null;return}
const km=(G.e-G.w)*111.32*Math.cos((G.n+G.s)/2*Math.PI/180),kh=(G.n-G.s)*111.32;let sp=p.spc,nlx,nly;
 const dims=()=>{nlx=Math.max(2,Math.ceil(km/sp)+1);nly=Math.max(2,Math.ceil(kh/sp)+1)};dims();while(nlx*nly>400){sp*=1.25;dims()}
 const la=[],lo=[];for(let y=0;y<nly;y++)for(let x=0;x<nlx;x++){la.push((G.n-y/(nly-1)*(G.n-G.s)).toFixed(3));lo.push((G.w+x/(nlx-1)*(G.e-G.w)).toFixed(3))}
 const ts=startMs(p),hind=p.mode==='hind',hrS=new Date(ts).toISOString().slice(0,13)+':00',d0=isoD(ts),
 base=hind?'https://archive-api.open-meteo.com/v1/archive':'https://api.open-meteo.com/v1/forecast',
 tail=hind?`&start_date=${p.met0&&p.met0<addD(d0,-3)?p.met0:addD(d0,-3)}&end_date=${p.met1&&p.met1>addD(d0,Math.ceil(p.hours/24))?p.met1:addD(d0,Math.ceil(p.hours/24))}`:`&past_days=3&forecast_days=${Math.min(16,Math.ceil(p.hours/24)+1)}`,outs=[];
 for(let i=0;i<la.length;i+=40){log(`Weather ${Math.min(i+40,la.length)}/${la.length} points…`);
  const url=`${base}?latitude=${la.slice(i,i+40)}&longitude=${lo.slice(i,i+40)}&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=UTC${tail}`,key=url+(hind?'':hrS);
  let j=await idb('get',key);if(!j){j=await getJ(url,'Open-Meteo');await idb('put',key,j);await sleep(500)}
  (Array.isArray(j)?j:[j]).forEach(o=>outs.push(o))}
 if(outs.length!==la.length)throw Error('Open-Meteo returned '+outs.length+' points, expected '+la.length);
 const t=outs[0].hourly.time,len=t.length,np=outs.length,sIdx=t.indexOf(hrS);if(sIdx<0)throw Error('Open-Meteo has no data for '+hrS+' UTC.');
 const M={nlx,nly,np,len,sIdx,sp,U:[],V:[],Ts:[],E:[],A:[],P:[],avg:{temp:[],wind:[],wdir:[],rh:[],rain:[]}};
 for(const o of outs){const h=o.hourly,el=o.elevation||0,U=new Float32Array(len),V=new Float32Array(len),Ts=new Float32Array(len),E=new Float32Array(len),A=new Float32Array(len),Pr=new Float32Array(len);
  for(let i=0;i<len;i++){const T=h.temperature_2m[i]??15,RH=h.relative_humidity_2m[i]??50,ws=h.wind_speed_10m[i]??0,th=(((h.wind_direction_10m[i]??0)+180)%360)*Math.PI/180;
   U[i]=ws*Math.sin(th);V[i]=ws*Math.cos(th);Ts[i]=T+.0065*el;E[i]=RH/100*esat(T)*Math.exp(el/2500);
   Pr[i]=h.precipitation[i]??0;let a=0;for(let k=0;k<=72&&i-k>=0;k++)a+=(h.precipitation[i-k]??0)*Math.exp(-k/48);A[i]=a}
  M.U.push(U);M.V.push(V);M.Ts.push(Ts);M.E.push(E);M.A.push(A);M.P.push(Pr)}
 const ix=t.map((v,i)=>v.slice(0,10)>= (p.met0||d0)&&v.slice(0,10)<= (p.met1||isoD(ts+p.hours*36e5))?i:-1).filter(i=>i>=0);if(!ix.length)throw Error('Open-Meteo has no weather in the selected range.');
 for(let q=0;q<np;q++){const avg=a=>ix.reduce((sum,i)=>sum+a[i],0)/ix.length,u=avg(M.U[q]),v=avg(M.V[q]),T=avg(M.Ts[q])-.0065*(outs[q].elevation||0);M.avg.temp[q]=T;M.avg.wind[q]=Math.hypot(u,v);M.avg.wdir[q]=(Math.atan2(u,v)*180/Math.PI+360)%360;M.avg.rh[q]=clamp(100*avg(M.E[q])/esat(T),0,100);M.avg.rain[q]=avg(M.P[q])}
 G.M=M;W=null;WX_CACHE.set(cacheKey,M);if(WX_CACHE.size>12)WX_CACHE.delete(WX_CACHE.keys().next().value);note('OK',`Open-Meteo: ${np} points (${nlx}×${nly}, ${sp.toFixed(1)} km), ${len} hours ${t[0]} to ${t[len-1]}, start ${hrS}.`)}

/* ================= FIRMS fire detections ================= */
function csvRows(text){const rows=[],row=[];let cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row.splice(0));cell=''}else cell+=c}row.push(cell);if(row.some(Boolean))rows.push(row);return rows}
function parseCSV(txt,src){const rows=csvRows(txt);if(!rows.length)return[];const h=rows.shift().map(s=>s.trim().toLowerCase().replace(/^\ufeff/,'')),ix=n=>h.indexOf(n),la=ix('latitude'),lo=ix('longitude'),ad=ix('acq_date'),at=ix('acq_time'),cf=ix('confidence'),ins=ix('instrument');
 if(la<0||lo<0||ad<0)throw Error('FIRMS CSV missing latitude, longitude or acq_date.');const out=[];
 for(const c of rows){const tm=String(at>=0?c[at]||'0000':'0000').padStart(4,'0'),t=Date.parse(c[ad]+'T'+tm.slice(0,2)+':'+tm.slice(2)+':00Z'),b=src||(ins>=0&&/MODIS/i.test(c[ins])?'MODIS':'VIIRS'),conf=cf>=0?String(c[cf]||'').trim().toLowerCase():'';
  if(!Number.isFinite(t)||!Number.isFinite(+c[la])||!Number.isFinite(+c[lo]))continue;
  if($('hiconf').checked&&(conf==='l'||conf==='low'||conf!==''&&Number.isFinite(+conf)&&+conf<30))continue;
  out.push({la:+c[la],lo:+c[lo],date:c[ad],t,b})}return out}
async function firmsChunk(key,src,bb,d,nd){const url=`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${src}/${bb}/${nd}/${d}`,
 ck=JSON.stringify(['firms3',src,bb,d,nd,$('hiconf').checked]),old=daysBetween(d,isoD(Date.now()))>nd+4;
 if(old){const c=await idb('get',ck);if(c)return c}
 let last;for(let a=0;a<3;a++){try{const r=await fetch(url);if(!r.ok)throw Error('HTTP '+r.status);const txt=await r.text();if(/Invalid MAP_KEY|Error|<html/i.test(txt.slice(0,120)))throw Error(txt.slice(0,100));const rows=parseCSV(txt,src.replace(/_(NRT|SP)$/,''));if(old)await idb('put',ck,rows);return rows}
 catch(e){last=e;if(a<2){note('WARN',`FIRMS ${src} ${d}: request failed; retry ${a+1}/2 (${e.message})`);await sleep(1500*(a+1))}}}
 throw Error(`FIRMS ${src} ${d}: ${last.message}`)}
async function apiDetections(dA,dB,bb,key){const bases=chosenSources().filter(x=>x!=='EE'),jobs=[];
 for(let d=dA;d<=dB;d=addD(d,5)){const nd=Math.min(5,daysBetween(d,dB)+1),age=daysBetween(d,isoD(Date.now()));for(const b of bases)jobs.push({b,d,nd,age})}
 const all=[],seen=new Set();let k=0,done=0,err=null;
 await Promise.all(Array.from({length:3},async()=>{while(k<jobs.length&&!err){const j=jobs[k++];try{let rows=null,last;
  for(const src of (j.age>150?[j.b+'_SP',j.b+'_NRT']:[j.b+'_NRT',j.b+'_SP'])){try{rows=await firmsChunk(key,src,bb,j.d,j.nd);break}catch(e){last=e;note('WARN',e.message)}}
  if(!rows)throw last;for(const r of rows){const s=[r.la,r.lo,r.t,r.b].join('|');if(!seen.has(s)){seen.add(s);all.push(r)}}}catch(e){err=e}
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
async function getDetections(dA,dB,bb,key,force=false){
 const src=chosenSources();if(!src.length)throw Error('Select at least one fire source.');if(!src.some(x=>x!=='EE')||(!key&&eeReady))return eeFirms(dA,dB);
 if(!force&&fbOn()){note('INFO','FIRMS failed recently: using the MODIS fallback (Earth Engine).');return eeFirms(dA,dB)}
 try{note('INFO','FIRMS API '+dA+' to '+dB+' bbox '+bb);const rows=await apiDetections(dA,dB,bb,key);if(src.includes('EE')&&eeReady){const extra=await eeFirms(dA,dB),seen=new Set(rows.map(r=>[r.la,r.lo,r.t,r.b].join('|')));for(const r of extra){const id=[r.la,r.lo,r.t,r.b].join('|');if(!seen.has(id)){seen.add(id);rows.push(r)}}}FBT=0;localStorage.removeItem('wf_fbt');LASTSRC='FIRMS API';note('OK','FIRMS API: '+rows.length+' detections fetched.');return rows}
 catch(e){note('ERR','FIRMS API failed: '+e.message);await probeNet();
  if(eeReady){FBT=Date.now();try{localStorage.setItem('wf_fbt',FBT)}catch(_){}note('INFO','Falling back to MODIS detections from Earth Engine (1 km, daily).');LASTSRC='MODIS via Earth Engine (fallback)';return eeFirms(dA,dB)}throw e}}
const bboxStr=()=>{const b=drawn.getBounds();return[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(4)).join(',')};
$('firmsfile').onchange=e=>{const f=e.target.files[0];if(!f){FILEROWS=null;return}f.text().then(t=>{FILEROWS=parseCSV(t);log(`Loaded ${FILEROWS.length} detections from the CSV file. They are used instead of the FIRMS API.`)}).catch(x=>{FILEROWS=null;log('CSV error: '+x.message)})};
async function loadFire(p){const hind=p.mode==='hind',tA=hind?startMs(p):Date.now()-p.look*36e5,tB=hind?tA+p.hours*36e5:Date.now();let rows;
 if(FILEROWS)rows=FILEROWS;else if(hind&&HROWS)rows=HROWS;else{const key=$('firms').value.trim();if(!key&&!eeReady){log('Enter a FIRMS key or sign in to Earth Engine.');return null}rows=await getDetections(isoD(tA),isoD(tB),bboxStr(),key)}
 const selected=hind&&SEL.size,days=SEL,dotsSeen=new Set();let n=0,burnable=0;dots.clearLayers();G.seedSpec=[];G.dets=[];G.skipped=[];
 for(const r of rows){if(selected?!days.has(r.date):(r.day?r.date<isoD(tA)||r.date>isoD(tB):r.t<tA||r.t>tB))continue;
  const i=cellAt(r.la,r.lo);if(i<0||!G.inside[i])continue;n++;const rad=r.b.startsWith('MODIS')?500:190,ok=!NF[G.lc[i]]&&!G.water[i]&&!!G.fuelMask[i];
  L.circleMarker([r.la,r.lo],{pane:'dots',radius:3,weight:1,color:'#fff',fillColor:ok?'#a855f7':'#38bdf8',fillOpacity:.95}).addTo(dots);
  if(!ok){G.skipped.push(r);continue}burnable++;G.dets.push({i,rad,t:r.t});disc(i,rad,j=>G.obs[j]=1);
  if(!dotsSeen.has(i)){dotsSeen.add(i);G.seedSpec.push({i,rad:p.ignmode==='pixel'?rad:p.seedR,date:r.date})}}
 note('OK',`Ignition: ${n} selected / ${burnable} on burnable cells / ${G.seedSpec.length} ignited at t=0; ${G.skipped.length} skipped (cyan).`);
 return{nd:n,seeds:G.seedSpec.length}}

/* fire history: real detections over a long period */
function eventRanges(){const days=Object.keys(HBY).sort(),gap=clamp(+$('gap').value||0,0,30),groups=[];for(const d of days){const last=groups.at(-1);if(last&&daysBetween(last.end,d)<=gap+1){last.end=d;last.days.push(d);last.n+=HBY[d].n}else groups.push({start:d,end:d,days:[d],n:HBY[d].n})}return groups}
function selectedEvents(){return eventRanges().filter(g=>g.days.some(d=>SEL.has(d)))}
function renderHist(){const groups=eventRanges(),tot=groups.reduce((n,g)=>n+g.n,0);$('hist').innerHTML=tot?`<b>${tot}</b> detections in <b>${groups.length}</b> event ranges (${LASTSRC||'loaded'}).<br><a href="#" data-all="1">${LANG==='hi'?'सभी चुनें':'Select all'}</a> · <a href="#" data-none="1">${LANG==='hi'?'चयन साफ़ करें':'Clear all'}</a><div class="dates">`+groups.map((g,i)=>`<div class="event"><b>${i+1}.</b><a href="#" data-r="${i}" class="${g.days.some(d=>SEL.has(d))?'sel':''}">${g.start}${g.end!==g.start?' – '+g.end:''} (${g.n})</a></div>`).join('')+'</div>'+`<b>${selectedEvents().length}</b> ${LANG==='hi'?'रेंज चुनी गई हैं।':'ranges selected.'}`:(LANG==='hi'?'इस क्षेत्र और अवधि में कोई डिटेक्शन नहीं मिला। तारीखें और FIRMS कुंजी जाँचें।':'No detections in this area and period. Check dates and the FIRMS key.')}
function applySel(){if(!SEL.size)return;const groups=selectedEvents();if(!groups.length)return;if(MODE!=='hind')document.querySelector('.tabs button[data-m=hind]').click();$('hs').value=groups[0].start;$('hh').value=0;const hours=groups.reduce((sum,g)=>sum+(daysBetween(g.start,g.end)+1)*24,0);$('hours').value=hours;useFireDefaults(groups[0].start,groups.at(-1).end)}
function histMessage(t){$('hist').textContent=t;log(t)}
$('hbtn').onclick=async()=>{const b=$('hbtn');try{if(!AOI)return histMessage('Draw an area on the map or load a GeoJSON area first.');const key=$('firms').value.trim();if(!key&&!FILEROWS&&!eeReady)return histMessage('Enter your NASA FIRMS map key under Accounts, or sign in to Earth Engine first.');b.disabled=true;saveKeys();histMessage('Loading fire detections…');
 const dA=$('fh0').value,dB=$('fh1').value,rows=FILEROWS||await getDetections(dA,dB,bboxStr(),key,true),bd=drawn.getBounds();clearHist();dropGrid();
 const keep=[];for(const r of rows){if(r.date<dA||r.date>dB||!bd.contains([r.la,r.lo]))continue;keep.push(r);const o=HBY[r.date]||(HBY[r.date]={n:0,t:1e15});o.n++;o.t=Math.min(o.t,r.t);
  L.circleMarker([r.la,r.lo],{pane:'dots',radius:3,weight:1,color:'#fff',fillColor:'hsl('+(+r.date.slice(5,7)*30)+',90%,55%)',fillOpacity:.9}).addTo(hdots)}
 HROWS=keep;if(FILEROWS)LASTSRC='CSV file';renderHist();$('firebox').open=true;log(`Fire history: ${keep.length} detections on ${Object.keys(HBY).length} dates.`)}catch(e){histMessage('Error: '+(e.message||e))}finally{b.disabled=false}};
$('hist').onclick=e=>{const a=e.target.closest('a');if(!a)return;e.preventDefault();
 if(a.dataset.all)Object.keys(HBY).forEach(d=>SEL.add(d));else if(a.dataset.none)SEL.clear();else if(a.dataset.r){const g=eventRanges()[+a.dataset.r];if(!g)return;const on=g.days.some(d=>SEL.has(d));g.days.forEach(d=>on?SEL.delete(d):SEL.add(d))}else return;
 applySel();renderHist()};

/* ================= prepare ================= */
function mkOverlays(){const{nx,ny,w,e,s,n}=G,mk=()=>{const c=document.createElement('canvas');c.width=nx;c.height=ny;return c},bb=[[s,w],[n,e]];
 G.bgc=mk();G.cv=mk();G.ctx=G.cv.getContext('2d');G.im=G.ctx.createImageData(nx,ny);
 G.bgo=new CanvasOverlay(G.bgc,bb,{opacity:lop(),interactive:false,pane:'raster'}).addTo(map);G.fo=new CanvasOverlay(G.cv,bb,{interactive:false,pane:'raster'}).addTo(map)}
const lop=()=>clamp((+$('lop').value||100)/100,.2,1);
$('prep').onclick=async()=>{const b=$('prep');try{if(!AOI){checklist([[false,'Area of interest missing','अध्ययन क्षेत्र नहीं मिला']]);return log('Draw or load an area first.')}b.disabled=true;saveKeys();const p=P();EVENTS=selectedEvents();if(p.mode==='hind'&&!EVENTS.length)throw Error('Select at least one fire-history range first.');BASE=CAL=CANDIDATE=null;SEARCH=[];REFS=[];$('val').innerHTML='';$('comparison').innerHTML='';$('obsstatus').textContent='';$('candidateTable').innerHTML='';$('paramCompare').innerHTML='';clearPreview();dropGrid();const bb=drawn.getBounds();
 build({w:bb.getWest(),e:bb.getEast(),s:bb.getSouth(),n:bb.getNorth()},p,AOI);mkOverlays();
 log(`Grid ${G.nx} × ${G.ny} cells of ${p.cell} m (${(G.N/1e6).toFixed(2)} M cells). Loading satellite and terrain…`);
 await loadEE(p);G.params=p;await loadMet(p);const f=await loadFire(p);resetState(p.seedR);drawBG();checklist([[true,`Area: ${G.N} cells`,`क्षेत्र: ${G.N} सेल`],[!$('noee').checked,`Satellite and terrain: ${G.gaps||'loaded'}`,'उपग्रह और भूभाग: '+(G.gaps||'लोड')],[!!G.M,`Weather: ${G.M?.np||0} points`,`मौसम: ${G.M?.np||0} बिंदु`],[!!f?.seeds,`Ignition: ${f?.seeds||0} points`,`इग्निशन: ${f?.seeds||0} बिंदु`]]);map.fitBounds([[G.s,G.w],[G.n,G.e]]);
 log(`Ready: ${G.nx} × ${G.ny} cells of ${p.cell} m, weather lattice ${G.M.nlx} × ${G.M.nly} (${G.M.sp.toFixed(1)} km). ${f?`${f.nd} FIRMS detections, ${f.seeds} ignition points.`:''} ${G.gaps||''}${f&&!f.nd?' No FIRMS detections in this window: use "Show fire history" to find real fire dates.':''}`)}
 catch(e){checklist([[!!G,'Area of interest','अध्ययन क्षेत्र'],[false,`Preparation incomplete: ${e.message||e}`,`तैयारी अधूरी: ${e.message||e}`]]);log('Error: '+(e.message||e));note('ERR','stack: '+String(e.stack||'').split('\n').slice(0,3).join(' | '))}finally{b.disabled=false}};
map.on('click',ev=>{if(G&&G.im&&!running){const i=cellAt(ev.latlng.lat,ev.latlng.lng);if(i>=0){G.centers.push(i);igniteDisc(i,+$('seedr').value||60);G.ctx.putImageData(G.im,0,0)}}});

/* ================= background layers ================= */
const RAMP=[[40,60,130],[50,160,140],[250,225,60],[225,50,30]],ramp=t=>{t=clamp(t,0,1)*3;const k=Math.min(2,t|0),f=t-k,a=RAMP[k],b=RAMP[k+1];return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]};
const LCC={10:[0,100,0],20:[255,187,34],30:[255,255,76],40:[240,150,255],50:[250,0,0],60:[180,180,180],70:[240,240,240],80:[0,100,200],90:[0,150,160],95:[0,207,117],100:[250,230,160]};
function slopeOf(){if(G.slope)return G.slope;const{nx,ny,z,cell,demMissing}=G,sl=new Uint8Array(G.N),r=Math.max(1,Math.round(30/cell));
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const xa=Math.max(0,x-r),xb=Math.min(nx-1,x+r),ya=Math.max(0,y-r),yb=Math.min(ny-1,y+r),i=y*nx+x;
  if(demMissing[i]||demMissing[y*nx+xa]||demMissing[y*nx+xb]||demMissing[ya*nx+x]||demMissing[yb*nx+x])continue;
  const gx=(z[y*nx+xb]-z[y*nx+xa])/((xb-xa||1)*cell),gy=(z[yb*nx+x]-z[ya*nx+x])/((yb-ya||1)*cell);sl[i]=Math.min(90,Math.round(Math.atan(Math.hypot(gx,gy))*57.29578))}
 return G.slope=sl}
function metValue(i,v){const M=G.M;if(!M?.avg?.[v])return null;const x=i%G.nx,y=(i-x)/G.nx,gx=clamp((x+.5)/G.nx*(M.nlx-1),0,M.nlx-1),gy=clamp((y+.5)/G.ny*(M.nly-1),0,M.nly-1),x0=Math.min(M.nlx-2,Math.floor(gx)),y0=Math.min(M.nly-2,Math.floor(gy)),fx=gx-x0,fy=gy-y0,a=M.avg[v],k=y0*M.nlx+x0;return a[k]*(1-fx)*(1-fy)+a[k+1]*fx*(1-fy)+a[k+M.nlx]*(1-fx)*fy+a[k+M.nlx+1]*fx*fy}
function drawBG(){if(!G||!G.bgc)return;const v=$('lyr').value,{nx,ny,N,inside,base,z,lc,bx,obs,state}=G,c=G.bgc.getContext('2d'),im=c.createImageData(nx,ny),d=im.data,thr=(+$('bthr').value||.1)*1e4,lg=$('legend');
 if(G.fo)G.fo.setOpacity(['observed','baseline','calibrated','difference'].includes(v)?0:1);
 let zmin=1e9,zmax=-1e9,sl=null,msg='',lmin=1e9,lmax=-1e9;
 if(v==='z'){for(let i=0;i<N;i++)if(inside[i]&&!G.demMissing[i]){if(z[i]<zmin)zmin=z[i];if(z[i]>zmax)zmax=z[i]}msg=zmin<=zmax?`Raw ${$('dem').selectedOptions[0].text} elevation ${zmin} to ${zmax} m; nearest-neighbour cells (blue low, red high).`:'DEM has no valid cells.'}
 if(v==='lst'){for(let i=0;i<N;i++)if(inside[i]&&G.lst[i]!==MISSING){const t=G.lst[i]/100;lmin=Math.min(lmin,t);lmax=Math.max(lmax,t)}msg=lmin<=lmax?`Pre-fire Landsat LST ${lmin.toFixed(1)} to ${lmax.toFixed(1)} °C; nearest neighbour, no spatial interpolation.`:'No clear pre-fire LST in the selected window.'}
 if(v==='fuelmask')msg=`ΔNDVI ≥ ${(+$('curethr').value).toFixed(2)}: green = fuel, red = no fuel, grey = missing NDVI.`;
 if(v==='slope'){sl=slopeOf();msg='Slope 0 to 45° and steeper (blue flat, red steep).'}
 if(v==='bi'){msg=G.hasBI?`${$('bxsel').value==='rbr'?'RBR':'dNBR'} from -0.25 (blue) to 1.0 or more (red). Cells above ${thr/1e4} count as burnt. Grey = no satellite data.`:'No burn reference loaded. Tick "Fetch burn-scar reference from satellite" (Validation) and press 1. Prepare data again.'}
 if(v==='obs'&&!G.dets.length)msg='No FIRMS detections loaded for this run.';
 if(v==='fuel')msg='Fuel × moisture: blue = low, red = high.';if(v==='curing')msg='Green NDVI minus dry NDVI (×10⁻⁴).';if(v==='ndmi')msg='NDMI: blue = dry, red = moist.';if(v==='ndwi')msg='NDWI: positive values indicate water.';if(v==='water')msg='Water mask: blue = blocked water (WorldCover or NDWI).';if(v==='prob')msg=G.prob?'Burn probability: blue = 0, red = 1.':'Run probability analysis first.';if(['temp','wind','wdir','rh','rain'].includes(v))msg={temp:'Mean air temperature (°C)',wind:'Mean wind speed (m/s)',wdir:'Mean wind direction (degrees)',rh:'Mean relative humidity (%)',rain:'Mean precipitation (mm/h)'}[v]+' over '+($('met0').value||'event')+' to '+($('met1').value||'event')+'.';
 if(v==='observed')msg=G.hasBI?'Satellite burn index above the selected threshold; grey = no clear observation.':'Load the observed satellite burn first.';
 if(v==='baseline')msg=BASE?'Baseline burnt cells (orange).':'Run the baseline first.';
 if(v==='calibrated')msg=CAL?'Calibrated burnt cells (violet).':'Run the calibrated model first.';
 if(v==='difference')msg=BASE&&CAL?'Green = both; orange = baseline only; violet = calibrated only.':'Run baseline and calibrated simulations first.';
 if(lg)lg.textContent=msg;if(msg&&/^No /.test(msg))note('WARN','Layer: '+msg);
 for(let i=0;i<N;i++){if(!inside[i])continue;let col=null;
 if(v==='fuelmask')col=G.nw[i]===MISSING||G.nd[i]===MISSING?[125,125,125]:G.fuelMask[i]?[41,174,91]:[200,65,50];else if(v==='fuel')col=ramp(base[i]/255*1.6);else if(v==='curing')col=G.nw[i]===MISSING||G.nd[i]===MISSING?[90,90,90]:ramp(clamp((G.nw[i]-G.nd[i])/6000,0,1));else if(v==='lst')col=G.lst[i]===MISSING?[90,90,90]:ramp((G.lst[i]/100-lmin)/Math.max(1,lmax-lmin));else if(v==='ndmi')col=G.nm[i]===MISSING?[90,90,90]:ramp(clamp((G.nm[i]+4000)/12000,0,1));else if(v==='ndwi')col=G.wi[i]===MISSING?[90,90,90]:ramp(clamp((G.wi[i]+5000)/10000,0,1));else if(v==='water')col=G.water[i]?[25,110,235]:[85,70,60];else if(v==='prob')col=G.prob?ramp(G.prob[i]):null;else if(['temp','wind','wdir','rh','rain'].includes(v)){const q=metValue(i,v);col=q===null?null:ramp(clamp(v==='temp'?(q+10)/55:v==='wind'?q/25:v==='wdir'?q/360:v==='rh'?q/100:q/15,0,1))}else if(v==='z')col=G.demMissing[i]?[90,90,90]:ramp((z[i]-zmin)/Math.max(1,zmax-zmin));else if(v==='slope')col=G.demMissing[i]?[90,90,90]:ramp(sl[i]/45);else if(v==='lc')col=LCC[lc[i]]||[128,128,128];
  else if(v==='bi'){if(bx[i]===MISSING)col=[90,90,90];else col=ramp((bx[i]/1e4+.25)/1.25)}   // continuous index, not just the burnt cells
  else if(v==='obs'){if(obs[i])col=[190,80,250]}
  else if(v==='cmp'){const pr=state[i]===1||state[i]===2,ob=G.hasBI?(bx[i]!==MISSING&&bx[i]>thr):obs[i]===1;if(pr&&ob)col=[60,200,90];else if(pr)col=[240,60,60];else if(ob)col=[70,130,255]}
  else if(v==='observed'){if(G.hasBI)col=bx[i]===MISSING?[85,85,85]:bx[i]>thr?[65,185,100]:[48,43,49]}
  else if(v==='baseline'){if(BASE)col=BASE.state[i]===2?[255,128,35]:[45,42,45]}
  else if(v==='calibrated'){if(CAL)col=CAL.state[i]===2?[166,105,245]:[45,42,45]}
  else if(v==='difference'&&BASE&&CAL){const a=BASE.state[i]===2,b=CAL.state[i]===2;col=a&&b?[55,190,90]:a?[255,128,35]:b?[166,105,245]:[45,42,45]}
  if(col){d[i*4]=col[0];d[i*4+1]=col[1];d[i*4+2]=col[2];d[i*4+3]=255}}
 c.putImageData(im,0,0)}
$('lyr').onchange=()=>{if(PREVIEW&&!G){PREVIEW.overlay.setOpacity($('lyr').value==='fuelmask'?1:0);if($('lyr').value==='fuelmask')renderPreview();else $('legend').textContent='Press Prepare to view this layer.'}else drawBG()};$('lop').oninput=()=>{if(G&&G.bgo)G.bgo.setOpacity(lop())};

/* ================= video, validation, charts ================= */
function vstart(){$('vlink').hidden=true;rec=null;chunks=[];if(!$('vid').checked)return;if(!window.MediaRecorder){note('ERR','Video recording unsupported in this browser.');return}
 try{const w=G.nx<720?G.nx*Math.max(1,Math.floor(720/G.nx)):960;vc=document.createElement('canvas');vc.width=w;vc.height=Math.round(G.ny*w/G.nx)+30;
  rec=new MediaRecorder(vc.captureStream(10));rec.onerror=e=>note('ERR','Video recording failed: '+(e.error?.message||e.message||e));rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const kind=RUN_KIND;rec.onstop=()=>{if(!chunks.length){note('ERR','Video recording failed: empty output.');return}const url=URL.createObjectURL(new Blob(chunks,{type:rec.mimeType||'video/webm'}));for(const id of ['vlink',kind==='baseline'?'basevideo':'calvideo']){const a=$(id);if(a.href?.startsWith('blob:'))URL.revokeObjectURL(a.href);a.href=url;a.download=kind+'-fire-spread.webm';a.hidden=false}};rec.start()}
 catch(e){rec=null;note('ERR','Video recording failed: '+e.message)}}
function vframe(tm){if(!rec)return;const x=vc.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,vc.width,vc.height);x.imageSmoothingEnabled=vc.width<G.nx;
 if($('lyr').value!=='none'){x.globalAlpha=lop();x.drawImage(G.bgc,0,30,vc.width,vc.height-30);x.globalAlpha=1}
 x.drawImage(G.cv,0,30,vc.width,vc.height-30);x.fillStyle='#ffc21a';x.font='16px sans-serif';x.fillText(`t + ${(tm/60).toFixed(1)} h`,8,20)}
function sampleBoundary(mask,valid,limit=700){const out=[],stride=Math.max(1,Math.floor(Math.sqrt(G.N/50000)));for(let y=1;y<G.ny-1;y+=stride)for(let x=1;x<G.nx-1;x+=stride){const i=y*G.nx+x;if(!valid[i]||!mask[i])continue;if(!mask[i-1]||!mask[i+1]||!mask[i-G.nx]||!mask[i+G.nx])out.push([x,y])}if(out.length>limit){const k=Math.ceil(out.length/limit);return out.filter((_,i)=>i%k===0)}return out}
function hausdorff(a,b){if(!a.length||!b.length)return null;const one=(p,q)=>Math.max(...p.map(([x,y])=>{let best=Infinity;for(const [u,v] of q){const d=(x-u)**2+(y-v)**2;if(d<best)best=d}return Math.sqrt(best)}));return Math.max(one(a,b),one(b,a))*G.cell}
function metrics(mask,valid,name,state=G.state){const{N,cell}=G;let tp=0,fp=0,fn=0,tn=0,psx=0,psy=0,rsx=0,rsy=0,pn=0,rn=0,brier=0;
 for(let i=0;i<N;i++){if(!valid[i])continue;const pr=state[i]===1||state[i]===2,ob=!!mask[i];if(pr&&ob)tp++;else if(pr)fp++;else if(ob)fn++;else tn++;if(pr){psx+=i%G.nx;psy+=Math.floor(i/G.nx);pn++}if(ob){rsx+=i%G.nx;rsy+=Math.floor(i/G.nx);rn++}if(G.prob)brier+=(G.prob[i]-Number(ob))**2}
 const total=tp+fp+fn+tn,div=(a,b)=>b?a/b:null,precision=div(tp,tp+fp),recall=div(tp,tp+fn),specificity=div(tn,tn+fp),accuracy=div(tp+tn,total),f1=div(2*tp,2*tp+fp+fn),iou=div(tp,tp+fp+fn),pYes=div((tp+fp)*(tp+fn)+(tn+fn)*(tn+fp),total*total),kappa=pYes===null||pYes===1?null:(accuracy-pYes)/(1-pYes),mcc=div(tp*tn-fp*fn,Math.sqrt((tp+fp)*(tp+fn)*(tn+fp)*(tn+fn))),shift=pn&&rn?Math.hypot(psx/pn-rsx/rn,psy/pn-rsy/rn)*cell:null;
 const h=hausdorff(sampleBoundary(Uint8Array.from(state,v=>v===1||v===2),valid),sampleBoundary(mask,valid));
 return{name,tp,fp,fn,tn,precision,recall,specificity,accuracy,f1,iou,commission:div(fp,tp+fp),omission:div(fn,tp+fn),areaBias:(pn-rn)*cell*cell/1e6,relativeAreaError:div(pn-rn,rn),kappa,mcc,brier:G.prob?div(brier,total):null,centroidShiftM:shift,hausdorffM:h,hausdorffApproximate:true,validCells:total}}
function tolerant(mask,valid,r,state=G.state){const near=(i,a)=>{const x=i%G.nx,y=Math.floor(i/G.nx);for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<G.nx&&Y<G.ny&&dx*dx+dy*dy<=r*r&&a[Y*G.nx+X])return true}return false};const pred=Uint8Array.from(state,v=>v===1||v===2);let hitP=0,nP=0,hitR=0,nR=0;for(let i=0;i<G.N;i++)if(valid[i]){if(pred[i]){nP++;if(near(i,mask))hitP++}if(mask[i]){nR++;if(near(i,pred))hitR++}}return{precision:nP?hitP/nP:null,recall:nR?hitR/nR:null}}
function nearSeeds(){const out=new Uint8Array(G.N);for(const d of G.dets)disc(d.i,1000,j=>out[j]=1);return out}
function validate(snapshot=BASE,slot='val'){if(!G||!snapshot)return log('Prepare data and run a baseline simulation first.');const sat=G.hasBI,hasObs=G.dets.length;if(!sat&&!hasObs)return log('No independent reference. Load satellite burn or FIRMS detections first.');
 const valid=new Uint8Array(G.N),ref=new Uint8Array(G.N),thr=(+$('bthr').value||.1)*1e4,near=nearSeeds(),vNear=new Uint8Array(G.N);
 for(let i=0;i<G.N;i++){if(!G.inside[i]||NF[G.lc[i]]||G.water[i])continue;if(sat&&G.bx[i]===MISSING)continue;valid[i]=1;ref[i]=sat?Number(G.bx[i]>thr):G.obs[i];vNear[i]=near[i]}
 const whole=metrics(ref,valid,(snapshot===BASE?'Baseline':'Calibrated')+' · '+(sat?'Satellite burn index':'FIRMS footprints'),snapshot.state),nearValid=Uint8Array.from(valid,(v,i)=>v&&vNear[i]?1:0),local=metrics(ref,nearValid,'Near ignition points (1 km)',snapshot.state),tol=tolerant(ref,valid,clamp(+$('tol').value||1,1,2),snapshot.state);METRICS.push(whole,local);
 const fmt=v=>v===null||!Number.isFinite(v)?'N/A':Number(v).toFixed(3),names=['tp','fp','fn','tn','precision','recall','specificity','accuracy','f1','iou','commission','omission','areaBias','relativeAreaError','kappa','mcc','brier','centroidShiftM','hausdorffM'];
 $(slot).innerHTML=`<p class="st">Reference: ${whole.name}. Hausdorff distance uses sampled boundary pixels; Brier score needs ensemble probability. RMSE / MAE across events need event-specific independent reference.</p><table><tr><th>Score</th><th>Whole area</th><th>Near seeds</th></tr>${names.map(k=>`<tr><td>${k}</td><td>${fmt(whole[k])}</td><td>${fmt(local[k])}</td></tr>`).join('')}</table><p class="st">${$('tol').value}-cell tolerance: precision ${fmt(tol.precision)}, recall ${fmt(tol.recall)}. Valid cells: ${whole.validCells}.</p>`;
 const strata=stratifiedPoints(ref,valid),counts=strata.map(a=>a.length);$(slot).insertAdjacentHTML('beforeend',`<p class="st">Stratified spaced sample: ${counts[1]} burnt and ${counts[0]} unburnt reference points (minimum about 300 m apart).</p>`);plotScores(whole);if($('lyr').value==='cmp')drawBG();return whole}
function plotScores(m){const c=$('scoresChart');if(!c||!window.Chart)return;EXCH[0]?.destroy();EXCH[0]=new Chart(c,{type:'bar',data:{labels:['Precision','Recall','Specificity','Accuracy','F1','IoU'],datasets:[{label:'Validation scores',data:[m.precision,m.recall,m.specificity,m.accuracy,m.f1,m.iou],backgroundColor:'#ff7a00'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:1}}}})}
$('validate').onclick=()=>validate(BASE);
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
function clearHist(){hdots.clearLayers();HROWS=null;HBY={};SEL.clear();SKIPN=0;const h=$('hist');if(h)h.innerHTML=''}
$('reset').onclick=()=>{running=false;if(CALWORKER){CALWORKER.terminate();CALWORKER=null;CALCANCEL?.();CALCANCEL=null}clearPreview();dropGrid();drawn.clearLayers();AOI=null;localStorage.removeItem('wf_aoi');clearHist();dots.clearLayers();H=null;EVENTS=[];METRICS=[];RUNS=[];PROB=null;BASE=CAL=CANDIDATE=null;SEARCH=[];REFS=[];FILEROWS=null;W=null;WX_CACHE.clear();$('aoifile').value='';$('firmsfile').value='';
 for(const id of ['sensor','gap','hiconf','ww0','ww1','dw0','dw1','wsp','noee','dt','r0','tb','seedr','look','vid','ignmode','moistScale','rainScale','usebi','bxsel','bthr','pre','post','tol','runs','lop','lyr']){const e=$(id);if(e.type==='checkbox')e.checked=e.defaultChecked;else e.value=e.defaultValue}
 for(const id of ['nm0','nm1','wi0','wi1','lst0','lst1','met0','met1'])$(id).value='';$('cell').value='30';$('fh1').value=isoD(Date.now());$('fh0').value=addD($('fh1').value,-365);$('hs').value='2026-04-10';$('hh').value='0';$('hours').value='12';document.querySelectorAll('.firesrc').forEach((x,i)=>x.checked=i===0);
 $('dem').value='cop';$('curethr').value='0.10';$('curevalue').textContent='0.10';document.querySelectorAll('#weights input').forEach(e=>e.value=e.defaultValue);
 document.querySelector('.tabs button[data-m=now]').click();$('hist').textContent='';$('checklist').textContent='';for(const id of ['val','comparison','candidateTable','paramCompare','calEvents','obsstatus','calstatus','finalstatus','loadprogress'])$(id).innerHTML='';$('calprogress').value=0;$('stopcal').hidden=true;$('autocal').disabled=false;$('legend').textContent='';for(const id of ['vlink','basevideo','calvideo']){if($(id).href?.startsWith('blob:'))URL.revokeObjectURL($(id).href);$(id).hidden=true}CH.forEach(c=>c?.destroy());CH=[];EXCH.forEach(c=>c?.destroy());EXCH=[];document.querySelectorAll('#resultsbox canvas').forEach(c=>c.getContext('2d').clearRect(0,0,c.width,c.height));
 document.querySelectorAll('aside details').forEach(d=>d.open=false);$('areabox').open=true;log('Reset complete. API keys and sign-in retained; draw or load an area to start again.')}
function diag(p){try{const i=G.act[0],x=i%G.nx,y=(i/G.nx)|0;setWeather(0);wxAt(x,y,G.z[i]);let bs=0,n=0;for(let j=0;j<G.N;j+=7)if(G.inside[j]&&!NF[G.lc[j]]){bs+=G.base[j];n++}
 const b=bs/Math.max(1,n)/255,R=p.R0*b*fWx();
 note(R<.05?'WARN':'OK',`Spread check at t=0: wind ${wV.toFixed(1)} m/s, T ${wT.toFixed(1)} C, RH ${Math.round(wRH)}%, rain index ${wA.toFixed(1)} mm. Factors: RH ${fRH(wRH).toFixed(2)}, T ${fT(wT).toFixed(2)}, rain ${fRain(wA).toFixed(2)}, mean fuel×moisture ${b.toFixed(2)}. Mean R about ${R.toFixed(2)} m/min (before wind and slope), so about ${(R*p.hours*60).toFixed(0)} m of front travel in ${p.hours} h.${R<.05?' Very slow: raise R0 or check fuel/moisture layers.':''}`)}catch(e){note('WARN','diag failed: '+e.message)}}
function record(tm){let cx=G.nx/2,cy=G.ny/2;if(G.act.length){let sx=0,sy=0;for(const i of G.act){sx+=i%G.nx;sy+=(i/G.nx)|0}cx=sx/G.act.length;cy=sy/G.act.length;G.lastC=[cx,cy]}else if(G.lastC)[cx,cy]=G.lastC;
 const ci=clamp(Math.round(cy),0,G.ny-1)*G.nx+clamp(Math.round(cx),0,G.nx-1);wxAt(cx,cy,G.z[ci]);const a=G.cell*G.cell/1e6;
 H.t.push(+(tm/60).toFixed(3));H.area.push(+((G.nBurnt+G.act.length)*a).toFixed(3));H.act.push(+(G.act.length*a).toFixed(3));H.ws.push(+wV.toFixed(1));H.wd.push(Math.round(wDir));H.T.push(+wT.toFixed(1));H.RH.push(Math.round(wRH))}
async function simulateEvents(p,display,selectedGroups=EVENTS){const groups=selectedGroups.length?selectedGroups:[{start:isoD(startMs(p)),end:isoD(startMs(p)+p.hours*36e5)}],allSeeds=G.seedSpec.slice(),union=new Uint8Array(G.N),eventMasks=[],originalM=G.M;let elapsed=0;
 for(let e=0;e<groups.length&&running;e++){const ev=groups[e],hours=Math.min(p.hours,(daysBetween(ev.start,ev.end)+1)*24),begin=selectedGroups.length?Date.parse(ev.start+'T00:00:00Z'):startMs(p);
  G.seedSpec=selectedGroups.length?allSeeds.filter(o=>o.date>=ev.start&&o.date<=ev.end):allSeeds;resetState(p.seedR);G.tbs=Math.max(1,Math.round(p.tb/p.dt));G.tbMax=G.tbs*3;
  for(let offset=0;offset<hours&&running;offset+=240){const part=Math.min(240,hours-offset),q={...p,start:begin+offset*36e5,hours:part,met0:isoD(begin+offset*36e5),met1:isoD(begin+(offset+part)*36e5)};
   await loadMet(q);for(let k=0,n=Math.ceil(part*60/p.dt);k<n&&running;k++){step(q,k*p.dt);const tm=elapsed*60+k*p.dt+p.dt;
    if(display&&((k+1)%Math.max(1,Math.round(10/p.dt))===0||k===n-1||!G.act.length)){drawFrame();vframe(tm);record(tm);log(`Event ${e+1}/${groups.length}, t + ${(tm/60).toFixed(1)} h: ${G.nBurnt+G.act.length} burnt/burning cells.`);await(rec?sleep(60):raf())}
    if(!G.act.length)break}elapsed+=part}
  const eventMask=new Uint8Array(G.N);for(let i=0;i<G.N;i++)if(G.state[i]===1||G.state[i]===2){union[i]=1;eventMask[i]=1}eventMasks.push(eventMask)}
 G.seedSpec=allSeeds;G.M=originalM;W=null;for(let i=0;i<G.N;i++){G.state[i]=union[i]?2:G.inside[i]&&!NF[G.lc[i]]&&!G.water[i]?0:3;if(G.im){const k=i*4;if(union[i]){G.im.data[k]=52;G.im.data[k+1]=38;G.im.data[k+2]=38;G.im.data[k+3]=215}else G.im.data[k+3]=0}}if(G.im)G.ctx.putImageData(G.im,0,0);union.eventMasks=eventMasks;return union}
$('run').onclick=async()=>{if(running){running=false;return}if(!G||!G.M)return log('Prepare data first.');const p=P(),b=$('run');refreshFuel(p);if(!G.seedSpec.length&&!G.centers.length)return log('Nothing to ignite. Select fire ranges with burnable points.');
 running=true;RUN_KIND='baseline';b.textContent=bilingual('Stop','रोकें');H={t:[],area:[],act:[],ws:[],wd:[],T:[],RH:[]};$('val').innerHTML='';METRICS=[];PROB=null;G.prob=null;BASE=CAL=CANDIDATE=null;SEARCH=[];try{vstart();const mask=await simulateEvents(p,true);if(!running)throw Error('Baseline run stopped.');BASE={state:G.state.slice(),eventMasks:mask.eventMasks.map(a=>a.slice()),p:{...p},history:H};if(H.t.length)charts();drawFrame();drawBG();
 note('OK',`Baseline finished: ${G.state.reduce((n,v)=>n+(v===2),0)} burnt cells in the union.`);log('Baseline finished. Load observed burn and validate.');if(G.hasBI||G.dets.length)validate(BASE);renderCalibrationEvents();openStep('validbox')}
 catch(e){log('Error: '+(e.message||e));note('ERR','run: '+String(e.stack||e))}finally{if(rec&&rec.state!=='inactive')rec.stop();running=false;b.textContent=bilingual('Run baseline simulation','मूल सिमुलेशन चलाएँ')}};

/* Additional analyses are explicit actions so a phone never silently runs an ensemble. */
function independentReference(){if(!G)return null;const ref=new Uint8Array(G.N),valid=new Uint8Array(G.N),sat=G.hasBI,thr=(+$('bthr').value||.1)*1e4;if(!sat&&!G.dets.length)return null;for(let i=0;i<G.N;i++){if(!G.inside[i]||NF[G.lc[i]]||G.water[i]||sat&&G.bx[i]===MISSING)continue;valid[i]=1;ref[i]=sat?Number(G.bx[i]>thr):G.obs[i]}return{ref,valid}}
function curvePoints(prob,ref,valid){let pos=0,neg=0;const bins=new Map();for(let i=0;i<G.N;i++)if(valid[i]){ref[i]?pos++:neg++;const k=Math.round(clamp(prob[i],0,1)*1e6);const b=bins.get(k)||[0,0];b[ref[i]?0:1]++;bins.set(k,b)}if(!pos||!neg)throw Error('ROC and PR require both burnt and unburnt reference cells.');const roc=[{x:0,y:0}],pr=[{x:0,y:1}];let tp=0,fp=0,auc=0,ap=0;for(const k of [...bins.keys()].sort((a,b)=>b-a)){const [p,n]=bins.get(k),oldTP=tp,oldFP=fp;tp+=p;fp+=n;auc+=(fp-oldFP)/neg*(tp+oldTP)/(2*pos);ap+=p/pos*tp/(tp+fp);roc.push({x:fp/neg,y:tp/pos});pr.push({x:tp/pos,y:tp/(tp+fp)})}return{roc,pr,auc,ap}}
function xyChart(el,label,points,color,slot){EXCH[slot]?.destroy();EXCH[slot]=new Chart($(el),{type:'line',data:{datasets:[{label,data:points,borderColor:color,pointRadius:0,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,animation:false,scales:{x:{type:'linear',min:0,max:1},y:{min:0,max:1}}}})}
$('ensemble').onclick=async()=>{if(running)return;const prior=independentReference();if(!G||!G.M||!prior)return log('Prepare and run with satellite burn reference or FIRMS reference first.');const count=clamp(+$('runs').value||10,10,30),saved={state:G.state.slice(),pixels:G.im.data.slice(),M:G.M,H,seedSpec:G.seedSpec.slice()},prob=new Float32Array(G.N),btn=$('ensemble');running=true;btn.disabled=true;
 try{const p=P();for(let k=0;k<count&&running;k++){log(`Ensemble ${k+1}/${count}…`);const mask=await simulateEvents(p,false);for(let i=0;i<G.N;i++)prob[i]+=mask[i]/count;await raf()}if(!running)throw Error('Ensemble stopped before completion.');G.prob=PROB=prob;const c=curvePoints(prob,prior.ref,prior.valid);xyChart('rocChart',`ROC AUC ${c.auc.toFixed(3)}`,c.roc,'#ff7a00',1);xyChart('prChart',`PR AP ${c.ap.toFixed(3)}`,c.pr,'#38bdf8',2);RUNS.push({type:'ensemble',runs:count,auc:c.auc,ap:c.ap});log(`Burn probability from ${count} runs; ROC AUC ${c.auc.toFixed(3)}, PR AP ${c.ap.toFixed(3)}.`)}catch(e){log('Error: '+e.message)}finally{G.state.set(saved.state);G.im.data.set(saved.pixels);G.ctx.putImageData(G.im,0,0);G.M=saved.M;G.seedSpec=saved.seedSpec;H=saved.H;W=null;running=false;btn.disabled=false;drawBG();if(G.prob&&BASE)validate(BASE)}};
async function eventReference(ev,p){if(!eeReady)throw Error('Sign in to Earth Engine for event-specific satellite reference.');const key=JSON.stringify(['event-bi-1',ev.start,ev.end,G.w,G.n,G.nx,G.ny,p.sensor,p.pre,p.post,p.bx]),cached=await idb('get',key);if(cached)return cached;
 const image=eeImage({...p,start:Date.parse(ev.start+'T00:00:00Z'),hours:(daysBetween(ev.start,ev.end)+1)*24,eventEnd:ev.end,bi:true},ee.Geometry.Rectangle([G.w,G.s,G.e,G.n],'EPSG:4326',false)),out=new Int16Array(G.N).fill(MISSING);
 for(let y=0;y<G.ny;y+=TS)for(let x=0;x<G.nx;x+=TS){const tw=Math.min(TS,G.nx-x),th=Math.min(TS,G.ny-y),tile=await eeTile(image,x,y,tw,th);for(let j=0;j<th;j++)for(let i=0;i<tw;i++)out[(y+j)*G.nx+x+i]=tile.bx[j*tw+i]}
 await idb('put',key,out);return out}
function eventIoU(mask,bx){let hit=0,union=0,pred=0,obs=0;const threshold=(+$('bthr').value||.1)*1e4;for(let i=0;i<G.N;i++){if(!G.inside[i]||G.water[i]||NF[G.lc[i]]||bx[i]===MISSING)continue;const a=!!mask[i],b=bx[i]>threshold;if(a)pred++;if(b)obs++;if(a&&b)hit++;if(a||b)union++}return{score:union?hit/union:0,pred,obs,valid:union}}
function barChart(id,labels,values,slot){EXCH[slot]?.destroy();EXCH[slot]=new Chart($(id),{type:'bar',data:{labels,datasets:[{label:'IoU',data:values,backgroundColor:'#ff7a00'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:1}}}})}
/* ================= observed burn and automatic calibration ================= */
const PARAMS=[['R0','Spread rate','फैलाव दर','r0',.03,30],['tb','Burn duration (min)','जलने की अवधि (मिनट)','tb',1,240],['moistScale','Moisture scale','नमी गुणक','moistScale',.05,3],['rainScale','Rain scale','वर्षा गुणक','rainScale',.05,4],['wCure','Fuel curing weight','ईंधन सुखने का भार','wCure',0,2],['wNdmi','NDMI weight','NDMI भार','wNdmi',0,2],['wSoil','Soil moisture weight','मृदा नमी भार','wSoil',0,2],['wSlope','Slope weight','ढाल भार','wSlope',0,2],['wElev','Elevation lapse weight','ऊँचाई भार','wElev',0,2],['wWind','Wind speed weight','हवा गति भार','wWind',0,2],['wWindDir','Wind direction weight','हवा दिशा भार','wWindDir',0,2],['wTemp','Air temperature weight','वायु तापमान भार','wTemp',0,2],['wRh','Humidity weight','आर्द्रता भार','wRh',0,2],['wRain','Rain weight','वर्षा भार','wRain',0,2],['wLST','LST weight','LST भार','wLST',0,2]];
function renderTune(){const defaults=new Set(['R0','tb','moistScale','rainScale','wCure','wNdmi','wSlope','wWind','wWindDir','wLST']);$('tunerows').innerHTML=PARAMS.map(([k,en,hi,id,min,max])=>`<label class="tune"><input type="checkbox" data-key="${k}" ${defaults.has(k)?'checked':''}><span>${bilingual(en,hi)} <small>(${Number($(id).value).toFixed(2)})</small></span><input aria-label="${en} min" data-min="${k}" type="number" step="any" value="${min}"><input aria-label="${en} max" data-max="${k}" type="number" step="any" value="${max}"></label>`).join('')}
renderTune();
$('selecttune').onclick=()=>document.querySelectorAll('#tunerows input[type=checkbox]').forEach(e=>e.checked=true);
$('cleartune').onclick=()=>document.querySelectorAll('#tunerows input[type=checkbox]').forEach(e=>e.checked=false);
function renderCalibrationEvents(){const choice=$('calEvents');choice.innerHTML='';if(!EVENTS.length){choice.textContent=bilingual('No selected event range. Baseline uses the current start date; calibration needs a dated fire range.','चुनी हुई घटना रेंज नहीं है। कैलिब्रेशन के लिए तारीख वाली रेंज चुनें।');return}
 const l=document.createElement('label');l.textContent=bilingual('Hold out one event for testing','जाँच के लिए एक घटना अलग रखें');const s=document.createElement('select');s.id='holdout';s.append(new Option(bilingual('None — fit only','कोई नहीं — केवल फिट'),'-1'));EVENTS.forEach((ev,i)=>s.append(new Option(`${i+1}. ${ev.start} – ${ev.end}`,String(i))));s.value=EVENTS.length>1?String(EVENTS.length-1):'-1';l.append(s);choice.append(l);const hint=document.createElement('p');hint.className='st';hint.textContent=bilingual('All other selected ranges train the model. The held-out range is scored only after selection.','अन्य सभी रेंज मॉडल को प्रशिक्षित करती हैं। अलग रखी रेंज का स्कोर चयन के बाद ही निकलेगा।');choice.append(hint)}
$('fetchobs').onclick=async()=>{if(!G||!BASE)return log('Prepare and run baseline first.');const b=$('fetchobs'),p=P();b.disabled=true;try{await ensureEE();if(!eeReady)throw Error('Sign in with Google to load an independent satellite burn raster.');const ev={start:EVENTS.length?EVENTS[0].start:isoD(startMs(p)),end:EVENTS.length?EVENTS.at(-1).end:isoD(startMs(p)+p.hours*36e5)};const ref=await eventReference(ev,p);G.bx.set(ref);G.hasBI=ref.some(x=>x!==MISSING);if(!G.hasBI)throw Error('No clear satellite observation for these dates. Extend the before/after windows.');$('obsstatus').textContent=bilingual(`Satellite reference loaded for ${ev.start} – ${ev.end}.`,`${ev.start} – ${ev.end} का उपग्रह संदर्भ लोड हुआ।`);drawBG();validate(BASE);openStep('validbox')}catch(e){$('obsstatus').textContent=e.message;note('ERR','Observed burn: '+e.message)}finally{b.disabled=false}};
function calibrationWorkerSource(){const decl=[['clamp',clamp],['bl',bl],['esat',esat],['fRH',fRH],['fT',fT],['fRain',fRain],['influence',influence]].map(([name,f])=>`const ${name}=${f.toString()};`).join('\n');const funcs=[disc,igniteDisc,resetState,setWeather,wxAt,baseOf,step].map(f=>f.toString().replaceAll('Math.random()','random()')).join('\n');return `"use strict";const MISSING=${MISSING},NF=new Uint8Array(${JSON.stringify([...NF])}),DX=${JSON.stringify(DX)},DY=${JSON.stringify(DY)},SQ=Math.SQRT2,COSA=${JSON.stringify(COSA)},SINA=${JSON.stringify(SINA)};let G,W,p00,p10,p01,p11,w00,w10,w01,w11,wV,wSin,wCos,wT,wRH,wA,wDir,seed=1;const paintFlame=()=>{},paintBurnt=()=>{};function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}\n${decl}\n${funcs}\nfunction simulate(p,ev,randomSeed){seed=randomSeed;G.seedSpec=ev.seeds;G.centers=[];G.params=p;for(let i=0;i<G.N;i++)if(G.inside[i])G.base[i]=Math.round(baseOf(G.nw[i],G.nd[i],G.nm[i],G.sm[i],p)*255);resetState(p.seedR);G.tbs=Math.max(1,Math.round(p.tb/p.dt));G.tbMax=G.tbs*3;for(const part of ev.parts){G.M=part.M;W=null;for(let k=0,n=Math.ceil(part.hours*60/p.dt);k<n&&G.act.length;k++)step(p,k*p.dt)}return G.state}\nfunction score(p,events,repeat){let total=0;for(let r=0;r<repeat;r++)for(let j=0;j<events.length;j++){const ev=events[j],state=simulate(p,ev,0x5eeda11+r*79+j*991);let hit=0,union=0;for(let i=0;i<G.N;i++)if(ev.valid[i]){const a=state[i]===1||state[i]===2,b=ev.ref[i];if(a&&b)hit++;if(a||b)union++}total+=union?hit/union:0}return total/(events.length*repeat)}\nonmessage=e=>{try{const m=e.data;G=m.grid;G.state=new Uint8Array(G.N);G.age=new Uint16Array(G.N);G.act=[];G.im=null;const train=m.events.filter((_,i)=>i!==m.holdout),held=m.holdout>=0?[m.events[m.holdout]]:[],keys=m.keys,bounds=m.bounds,base=m.baseline,budget=m.budget,repeats=m.repeats;let best={...base},bestScore=score(best,train,1),history=[{kind:'baseline',score:bestScore,params:{...best}}],sensitivity=[];postMessage({type:'progress',done:1,total:budget,score:bestScore});for(let n=1;n<budget;n++){const key=keys[(n-1)%keys.length],q={...best},range=bounds[key],original=base[key];if(n<=keys.length*2){const factor=n<=keys.length?.8:1.2;q[key]=clamp(original*factor,range[0],range[1])}else{const broad=n%5===0,center=broad?base[key]:best[key],span=(range[1]-range[0])*(broad?.4:.15);q[key]=clamp(center+(random()*2-1)*span,range[0],range[1]);for(let j=0;j<keys.length;j++)if(keys[j]!==key&&random()<.22){const k=keys[j],v=bounds[k];q[k]=clamp((broad?base[k]:best[k])+(random()*2-1)*(v[1]-v[0])*.12,v[0],v[1])}}if(q[key]===best[key]&&n>keys.length*2)continue;const s=score(q,train,1);history.push({kind:n<=keys.length*2?'sensitivity':'search',score:s,params:q});if(n<=keys.length*2)sensitivity.push({label:key+(n<=keys.length?' ×0.8':' ×1.2'),score:s});if(s>bestScore){best={...q};bestScore=s}postMessage({type:'progress',done:n+1,total:budget,score:bestScore})}const finalists=[...history].sort((a,b)=>b.score-a.score).slice(0,Math.min(3,history.length));for(const item of finalists)item.repeatScore=score(item.params,train,repeats);finalists.sort((a,b)=>b.repeatScore-a.repeatScore);best=finalists[0].params;const trainBefore=score(base,train,repeats),trainAfter=finalists[0].repeatScore,holdBefore=held.length?score(base,held,repeats):null,holdAfter=held.length?score(best,held,repeats):null;postMessage({type:'done',best,history,sensitivity,trainBefore,trainAfter,holdBefore,holdAfter,holdout:m.holdout})}catch(err){postMessage({type:'error',message:err.message,stack:err.stack})}};`}
async function calibrationInputs(p){const oldM=G.M,all=G.seedSpec.slice(),events=[];try{for(let j=0;j<EVENTS.length;j++){if(CALSTOP)throw Error('Calibration stopped.');const ev=EVENTS[j];$('calstatus').textContent=bilingual(`Loading reference and weather ${j+1}/${EVENTS.length}…`,`संदर्भ और मौसम ${j+1}/${EVENTS.length} लोड हो रहा है…`);const bx=await eventReference(ev,p),ref=new Uint8Array(G.N),valid=new Uint8Array(G.N),thr=(+$('bthr').value||.1)*1e4;let positive=0,negative=0;for(let i=0;i<G.N;i++)if(G.inside[i]&&!G.water[i]&&!NF[G.lc[i]]&&bx[i]!==MISSING){valid[i]=1;ref[i]=Number(bx[i]>thr);ref[i]?positive++:negative++}if(!positive||!negative)throw Error(`Event ${j+1}: reference needs both burnt and unburnt valid cells (found ${positive}/${negative}).`);const parts=[],hours=Math.min(p.hours,(daysBetween(ev.start,ev.end)+1)*24),begin=Date.parse(ev.start+'T00:00:00Z');for(let offset=0;offset<hours;offset+=240){const duration=Math.min(240,hours-offset),q={...p,start:begin+offset*36e5,hours:duration,met0:isoD(begin+offset*36e5),met1:isoD(begin+(offset+duration)*36e5)};await loadMet(q);parts.push({hours:duration,M:G.M})}events.push({ref,valid,seeds:all.filter(o=>o.date>=ev.start&&o.date<=ev.end),parts,bx})}return events}finally{G.M=oldM;W=null}}
function paramTable(base,best){$('paramCompare').innerHTML=`<table><tr><th>${bilingual('Parameter','पैरामीटर')}</th><th>${bilingual('Baseline','मूल')}</th><th>${bilingual('Proposed','प्रस्तावित')}</th></tr>${PARAMS.filter(([k])=>base[k]!==best[k]).map(([k,en,hi])=>`<tr><td>${bilingual(en,hi)}</td><td>${base[k].toFixed(3)}</td><td>${best[k].toFixed(3)}</td></tr>`).join('')}</table>`}
$('autocal').onclick=async()=>{if(running||CALWORKER)return;if(!G||!BASE)return log('Run baseline first.');if(!EVENTS.length)return log('Choose at least one dated fire range before Prepare.');if(!eeReady)return log('Sign in to Earth Engine for satellite observations before calibration.');const keys=[...document.querySelectorAll('#tunerows input[type=checkbox]:checked')].map(x=>x.dataset.key);if(!keys.length)return log('Select at least one parameter to tune.');const bounds={};for(const k of keys){const a=+document.querySelector(`[data-min="${k}"]`).value,b=+document.querySelector(`[data-max="${k}"]`).value;if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)return log(`Error: invalid bounds for ${k}.`);bounds[k]=[a,b]}const holdout=+$('holdout')?.value||0;let actualHoldout=$('holdout')?.value==='-1'?-1:holdout;if(EVENTS.length===1)actualHoldout=-1;const b=$('autocal');b.disabled=true;$('stopcal').hidden=false;$('calprogress').value=0;CALSTOP=false;try{if(G.N>350000)throw Error('Phone calibration limit: area exceeds 350,000 cells. Use a smaller AOI or 30 m Landsat.');const events=await calibrationInputs(BASE.p);if(CALSTOP)throw Error('Calibration stopped.');REFS=events.map(({bx})=>bx);const grid={N:G.N,nx:G.nx,ny:G.ny,cell:G.cell,inside:G.inside,water:G.water,lc:G.lc,z:G.z,demMissing:G.demMissing,nw:G.nw,nd:G.nd,nm:G.nm,sm:G.sm,lst:G.lst,lstMean:G.lstMean,variation:G.variation,fuelMask:G.fuelMask,base:G.base};const url=URL.createObjectURL(new Blob([calibrationWorkerSource()],{type:'text/javascript'}));const worker=CALWORKER=new Worker(url);URL.revokeObjectURL(url);const result=await new Promise((resolve,reject)=>{CALCANCEL=()=>reject(Error('Calibration stopped.'));worker.onmessage=({data:m})=>{if(m.type==='progress'){$('calprogress').value=m.done/m.total*100;$('calstatus').textContent=bilingual(`Candidates ${m.done}/${m.total}; best training IoU ${m.score.toFixed(3)}`,`उम्मीदवार ${m.done}/${m.total}; सर्वोत्तम प्रशिक्षण IoU ${m.score.toFixed(3)}`)}else if(m.type==='done')resolve(m);else if(m.type==='error')reject(Error(m.message))};worker.onerror=e=>reject(Error(e.message));worker.postMessage({grid,events:events.map(({bx,...rest})=>rest),holdout:actualHoldout,baseline:BASE.p,keys,bounds,budget:+$('calbudget').value,repeats:+$('calrepeats').value})});CANDIDATE=result.best;SEARCH=result.history;paramTable(BASE.p,CANDIDATE);$('candidateTable').innerHTML=`<table><tr><th>${bilingual('Candidate','उम्मीदवार')}</th><th>${bilingual('Training IoU','प्रशिक्षण IoU')}</th></tr>${[...SEARCH].sort((a,b)=>b.score-a.score).slice(0,8).map((o,i)=>`<tr><td>${i+1}. ${o.kind}</td><td>${o.score.toFixed(3)}</td></tr>`).join('')}</table>`;$('calstatus').textContent=bilingual(`Training IoU ${result.trainBefore.toFixed(3)} → ${result.trainAfter.toFixed(3)}. ${actualHoldout<0?'Fit only: no independent holdout.':`Held-out IoU ${result.holdBefore.toFixed(3)} → ${result.holdAfter.toFixed(3)}.`}`,`प्रशिक्षण IoU ${result.trainBefore.toFixed(3)} → ${result.trainAfter.toFixed(3)}। ${actualHoldout<0?'केवल फिट: स्वतंत्र जाँच नहीं।':`अलग घटना IoU ${result.holdBefore.toFixed(3)} → ${result.holdAfter.toFixed(3)}।`}`);barChart('calChart',['Training before','Training after',...(actualHoldout<0?[]:['Holdout before','Holdout after'])],[result.trainBefore,result.trainAfter,...(actualHoldout<0?[]:[result.holdBefore,result.holdAfter])],3);barChart('sensChart',result.sensitivity.map(x=>x.label),result.sensitivity.map(x=>x.score),4);RUNS.push({type:'auto-calibration',candidates:SEARCH.length,trainingEvents:EVENTS.length-(actualHoldout>=0?1:0),holdoutEvents:actualHoldout>=0?1:0,trainBefore:result.trainBefore,trainAfter:result.trainAfter,testBefore:result.holdBefore,testAfter:result.holdAfter});log('Automatic calibration completed. Review parameters, apply and rerun.');openStep('rerunbox')}catch(e){$('calstatus').textContent=e.message;log('Error: calibration: '+e.message)}finally{CALWORKER?.terminate();CALWORKER=null;CALCANCEL=null;CALSTOP=false;b.disabled=false;$('stopcal').hidden=true}};
$('stopcal').onclick=()=>{CALSTOP=true;if(CALWORKER){CALWORKER.terminate();CALWORKER=null;CALCANCEL?.();CALCANCEL=null;$('calstatus').textContent=bilingual('Calibration stopped.','कैलिब्रेशन रोका गया।');$('autocal').disabled=false;$('stopcal').hidden=true;log('Calibration stopped.')}};
$('applycal').onclick=()=>{if(!CANDIDATE)return log('Complete automatic calibration first.');for(const [k,,,id] of PARAMS)if(CANDIDATE[k]!==BASE.p[k])$(id).value=CANDIDATE[k].toFixed(4);$('finalstatus').textContent=bilingual('Proposed parameters applied. Run the calibrated model.','प्रस्तावित पैरामीटर लागू हुए। कैलिब्रेटेड मॉडल चलाएँ।');log('Calibrated parameters applied.')};
$('rerun').onclick=async()=>{if(running)return;if(!G||!BASE||!CANDIDATE)return log('Run baseline and calibration first.');const p=P(),b=$('rerun');running=true;RUN_KIND='calibrated';b.disabled=true;refreshFuel(p);H={t:[],area:[],act:[],ws:[],wd:[],T:[],RH:[]};try{vstart();const mask=await simulateEvents(p,true);if(!running)throw Error('Calibrated run stopped.');CAL={state:G.state.slice(),eventMasks:mask.eventMasks.map(a=>a.slice()),p:{...p},history:H};charts();drawBG();$('finalstatus').textContent=bilingual('Calibrated rerun finished. Compare both results below.','कैलिब्रेटेड पुनः रन पूरा हुआ। नीचे दोनों परिणामों की तुलना करें।');$('finalvalidate').click();openStep('rerunbox')}catch(e){log('Error: '+e.message)}finally{if(rec&&rec.state!=='inactive')rec.stop();running=false;b.disabled=false}};
$('finalvalidate').onclick=()=>{if(!CAL||!BASE)return log('Complete baseline and calibrated runs first.');if(!G.hasBI)return log('Load the independent observed satellite burn first.');const ref=independentReference();const before=metrics(ref.ref,ref.valid,'Baseline · satellite',BASE.state),after=metrics(ref.ref,ref.valid,'Calibrated · satellite',CAL.state);METRICS.push(before,after);const keys=['tp','fp','fn','tn','precision','recall','specificity','accuracy','f1','iou','commission','omission','areaBias','kappa','mcc'];$('comparison').innerHTML=`<table><tr><th>${bilingual('Score','स्कोर')}</th><th>${bilingual('Baseline','मूल')}</th><th>${bilingual('Calibrated','कैलिब्रेटेड')}</th></tr>${keys.map(k=>`<tr><td>${k}</td><td>${before[k]?.toFixed(3)??'N/A'}</td><td>${after[k]?.toFixed(3)??'N/A'}</td></tr>`).join('')}</table><p class="st">${bilingual('The full-area score includes training events. Use the held-out event result above for an independent test.','पूरे क्षेत्र का स्कोर प्रशिक्षण घटनाएँ भी शामिल करता है। स्वतंत्र जाँच के लिए ऊपर अलग रखी घटना का स्कोर देखें।')}</p>`;plotScores(after);drawBG();log(`Comparison: baseline IoU ${before.iou?.toFixed(3)}, calibrated IoU ${after.iou?.toFixed(3)}.`)};
$('baserasterdl').onclick=()=>{if(!BASE||!G)return log('Run baseline first.');saveBlob(tiffRaster(Uint8Array.from(BASE.state,x=>x===2?1:0)),'baseline-burn.tif')};
$('calrasterdl').onclick=()=>{if(!CAL||!G)return log('Run calibrated model first.');saveBlob(tiffRaster(Uint8Array.from(CAL.state,x=>x===2?1:0)),'calibrated-burn.tif')};
$('paramsdl').onclick=()=>{if(!BASE)return log('Run baseline first.');const rows=['parameter,baseline,proposed,calibrated',...PARAMS.map(([k])=>[k,BASE.p[k],CANDIDATE?.[k]??'',CAL?.p[k]??''].join(',')),'','candidate,kind,training_iou',...SEARCH.map((x,i)=>`${i+1},${x.kind},${x.score}`)];saveBlob(new Blob([rows.join('\n')+'\n'],{type:'text/csv'}),'calibration-parameters.csv')};
function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function tiffRaster(values){const n=G.N,width=G.nx,height=G.ny,tags=[
 [256,4,1,width],[257,4,1,height],[258,3,1,8],[259,3,1,1],[262,3,1,1],[273,4,1,0],[277,3,1,1],[278,4,1,height],[279,4,1,n],[284,3,1,1],[33550,12,3,0],[33922,12,6,0],[34735,3,16,0]];
 const ifd=8,extra=ifd+2+tags.length*12+4,scaleOff=extra,tieOff=scaleOff+24,geoOff=tieOff+48,dataOff=geoOff+32,size=dataOff+n;if(size>400e6)throw Error('GeoTIFF exceeds 400 MB; draw a smaller area.');
 tags[5][3]=dataOff;tags[10][3]=scaleOff;tags[11][3]=tieOff;tags[12][3]=geoOff;const buf=new ArrayBuffer(size),v=new DataView(buf),bytes=new Uint8Array(buf);v.setUint16(0,0x4949,true);v.setUint16(2,42,true);v.setUint32(4,ifd,true);v.setUint16(ifd,tags.length,true);let o=ifd+2;
 for(const [tag,type,count,value] of tags){v.setUint16(o,tag,true);v.setUint16(o+2,type,true);v.setUint32(o+4,count,true);if(type===3&&count===1)v.setUint16(o+8,value,true);else v.setUint32(o+8,value,true);o+=12}v.setUint32(o,0,true);
 [G.dx,G.dy,0].forEach((x,i)=>v.setFloat64(scaleOff+8*i,x,true));[0,0,0,G.w,G.n,0].forEach((x,i)=>v.setFloat64(tieOff+8*i,x,true));[1,1,0,3,1024,0,1,2,1025,0,1,1,2048,0,1,4326].forEach((x,i)=>v.setUint16(geoOff+2*i,x,true));
 bytes.set(values,dataOff);return new Blob([buf],{type:'image/tiff'})}
$('rasterdl').onclick=()=>{if(!G)return log('Prepare data first.');const v=G.prob?Uint8Array.from(G.prob,x=>Math.round(x*100)):Uint8Array.from(G.state,x=>x===2?1:0);try{saveBlob(tiffRaster(v),G.prob?'burn-probability-percent.tif':'burnt-union.tif');log('GeoTIFF downloaded (EPSG:4326, 0–100 probability % or 0/1 burn mask).')}catch(e){log('Error: '+e.message)}};
$('plotsdl').onclick=()=>{const cs=[...document.querySelectorAll('.chart canvas')].filter(c=>c.width&&c.height&&c.closest('.chart')?.offsetHeight);if(!cs.length)return log('No plots to download yet.');const out=document.createElement('canvas');out.width=Math.max(...cs.map(c=>c.width));out.height=cs.reduce((n,c)=>n+c.height,0);const ctx=out.getContext('2d');ctx.fillStyle='#131114';ctx.fillRect(0,0,out.width,out.height);let y=0;for(const c of cs){ctx.drawImage(c,0,y);y+=c.height}out.toBlob(b=>b?saveBlob(b,'wildfire-plots.png'):log('Error: PNG export failed.'),'image/png')};
$('scoresdl').onclick=()=>{if(!METRICS.length&&!RUNS.length)return log('No scores yet.');const rows=[['scope','metric','value']];for(const m of METRICS)for(const [k,v] of Object.entries(m))if(typeof v==='number'||v===null)rows.push([m.name,k,v??'']);for(const run of RUNS)for(const [k,v] of Object.entries(run))if(typeof v==='number')rows.push([run.type,k,v]);saveBlob(new Blob([rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n'],{type:'text/csv'}),'wildfire-scores.csv')};
function stratifiedPoints(ref,valid,count=100){const groups=[[],[]],spacing=Math.max(3,Math.ceil(300/G.cell)),occupied=new Set();let seed=0x153fb1;const candidates=[];for(let i=0;i<G.N;i+=Math.max(1,Math.floor(G.N/100000)))if(valid[i])candidates.push(i);for(let j=candidates.length-1;j>0;j--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const k=seed%(j+1);[candidates[j],candidates[k]]=[candidates[k],candidates[j]]}
 for(const i of candidates){const x=i%G.nx,y=Math.floor(i/G.nx),q=ref[i]?1:0;if(groups[q].length>=count)continue;const cx=Math.floor(x/spacing),cy=Math.floor(y/spacing),key=`${cx},${cy}`;if(occupied.has(key))continue;groups[q].push(i);occupied.add(key);if(groups[0].length>=count&&groups[1].length>=count)break}return groups}
function installLanguage(){const apply=()=>{document.documentElement.lang=LANG==='hi'?'hi':'en';document.querySelectorAll('[data-hi]').forEach(e=>{if(!e.dataset.en)e.dataset.en=e.textContent;e.textContent=LANG==='hi'?e.dataset.hi:e.dataset.en});$('lang').textContent=LANG==='hi'?'English':'हिन्दी';if(HROWS)renderHist()};$('lang').onclick=()=>{LANG=LANG==='en'?'hi':'en';apply()};apply();if(!$('firms').value&&!eeReady){$('accounts').open=true;$('modebox').open=false}else{$('accounts').open=false;$('modebox').open=true}}
installLanguage();
document.querySelectorAll('aside details').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)document.querySelectorAll('aside details').forEach(other=>{if(other!==d)other.open=false})}));
