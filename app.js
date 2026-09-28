'use strict';
const $=id=>document.getElementById(id),log=t=>$('log').textContent=t,st=t=>$('eestatus').textContent=t;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),sleep=ms=>new Promise(r=>setTimeout(r,ms)),raf=()=>new Promise(r=>requestAnimationFrame(r));
const addD=(d,n)=>new Date(+new Date(d)+n*864e5).toISOString().slice(0,10),isoD=ms=>new Date(ms).toISOString().slice(0,10);
const daysBetween=(a,b)=>Math.round((+new Date(b)-+new Date(a))/864e5);
const MISSING=-32000,MAXC=4e6,TS=256;             // missing-value marker, max cells, EE tile size (cells)
const NF=new Uint8Array(256);[50,60,70,80].forEach(c=>NF[c]=1);   // non-flammable WorldCover classes
let MODE='now',G=null,AOI=null,eeReady=false,running=false,FILEROWS=null,CH=[],rec,chunks,vc,H;

/* ================= map, area of interest ================= */
const map=L.map('map').setView([29.5,75],8);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
const drawn=L.featureGroup().addTo(map),dots=L.layerGroup().addTo(map);
map.addControl(new L.Control.Draw({edit:{featureGroup:drawn},draw:{polygon:true,rectangle:true,polyline:false,circle:false,marker:false,circlemarker:false}}));

// canvas drawn straight on the map (no PNG encoding per frame), hard pixel edges
const CanvasOverlay=L.ImageOverlay.extend({_initImage(){const c=this._image=this._url;c.classList.add('leaflet-image-layer');
 if(this._zoomAnimated)c.classList.add('leaflet-zoom-animated');c.style.imageRendering='pixelated';c.style.pointerEvents='none'}});

function dropGrid(){if(G){G.fo&&G.fo.remove();G.bgo&&G.bgo.remove()}G=null;dots.clearLayers()}
function setAOI(){const polys=[];drawn.eachLayer(l=>{const g=l.toGeoJSON().geometry;g.type==='Polygon'?polys.push(g.coordinates):g.coordinates.forEach(c=>polys.push(c))});
 AOI=polys.length?polys:null;dropGrid();if(AOI)localStorage.setItem('wf_aoi',JSON.stringify(AOI));log(AOI?'Area set.':'No area.')}
function addGJ(gj){drawn.clearLayers();(gj.features||[gj]).forEach(f=>{const g=f.geometry||f;if(/Polygon/.test(g.type))L.geoJSON(g).eachLayer(l=>drawn.addLayer(l))});
 if(drawn.getLayers().length){map.fitBounds(drawn.getBounds());setAOI()}else log('No polygon found in that file.')}
map.on(L.Draw.Event.CREATED,e=>{drawn.clearLayers();drawn.addLayer(e.layer);setAOI()});
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
 R0:+$('r0').value||10,tb:+$('tb').value||20,seedR:+$('seedr').value||60,look:+$('look').value||24,spc:Math.max(1,+$('wsp').value||5),
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

/* ================= Earth Engine sign-in ================= */
$('signin').onclick=()=>{saveKeys();const c=$('client').value.trim(),p=$('project').value.trim();
 if(!c||!p)return st('Enter the OAuth client ID and project ID first.');
 const init=()=>ee.initialize(null,null,()=>{eeReady=true;st('Signed in. Earth Engine ready.')},e=>st('Earth Engine init failed: '+e),null,p);
 ee.data.authenticateViaOauth(c,init,e=>st('Sign-in failed: '+e),null,()=>ee.data.authenticateViaPopup(init))};

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
function step(p,tmin){const{nx,ny,state,age,z,base,cell}=G;setWeather(tmin);const keep=[],born=[];
 for(const i of G.act){const x=i%nx,y=(i-x)/nx,zi=z[i];wxAt(x,y,zi);
  const fm=(1-.9*(wRH/100)**2)*Math.exp(.03*(wT-25))*Math.exp(-.3*wA),V=wV,e1=Math.exp(.045*V);
  for(let k=0;k<8;k++){const X=x+DX[k],Y=y+DY[k];if(X<0||Y<0||X>=nx||Y>=ny)continue;const j=Y*nx+X;if(state[j]!==0)continue;
   const d=DX[k]&&DY[k]?cell*SQ:cell,pw=V>.05?e1*Math.exp(.131*V*(COSA[k]*wCos+SINA[k]*wSin-1)):1,
    ps=Math.exp(.078*clamp(Math.atan((z[j]-zi)/d)*57.29578,-45,45)),R=p.R0*(base[j]/255)*fm*pw*ps;
   if(Math.random()<1-Math.exp(-R*p.dt/d)){state[j]=1;age[j]=0;born.push(j);paintFlame(j,0)}}
  if(++age[i]>=G.tbs){state[i]=2;G.nBurnt++;paintBurnt(i)}else keep.push(i)}
 G.act=keep.concat(born)}
// ===MODEL-END===

/* ================= Earth Engine: native-resolution raster, fetched in tiles ================= */
const PH=['red','nir','sw1','sw2'];
function sr(sen,a,b,reg){let c;
 if(sen==='s2')c=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(reg).filterDate(a,b).map(i=>{const s=i.select('SCL'),ok=s.eq(3).or(s.eq(8)).or(s.eq(9)).or(s.eq(10)).or(s.eq(11)).not();
  return i.resample('bilinear').select(['B4','B8','B11','B12'],PH).divide(1e4).updateMask(ok)});
 else c=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterBounds(reg).filterDate(a,b)
  .map(i=>i.select(['SR_B4','SR_B5','SR_B6','SR_B7'],PH).multiply(2.75e-5).add(-0.2).updateMask(i.select('QA_PIXEL').bitwiseAnd(26).eq(0)));
 c=c.merge(ee.ImageCollection([ee.Image.constant([0,0,0,0]).rename(PH).updateMask(ee.Image.constant(0))]));   // fully masked dummy: an empty window gives "no data", not an error
 const m=c.median();return ee.Image.cat([m.normalizedDifference(['nir','red']).rename('ndvi'),m.normalizedDifference(['nir','sw1']).rename('ndmi'),m.normalizedDifference(['nir','sw2']).rename('nbr')])}
function eeImage(p,reg){const d0=isoD(startMs(p)),dEnd=isoD(startMs(p)+p.hours*36e5),
 era=ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR').filterDate(addD(d0,-10),d0).select('volumetric_soil_water_layer_1')
  .merge(ee.ImageCollection([ee.Image.constant(0).rename('volumetric_soil_water_layer_1').updateMask(ee.Image.constant(0))])).mean().rename('sm'),
 bands=[sr(p.sensor,p.ww0,p.ww1,reg).select('ndvi').rename('nw'),sr(p.sensor,p.dw0,p.dw1,reg).select('ndvi').rename('nd'),sr(p.sensor,addD(d0,-30),d0,reg).select('ndmi').rename('nm'),era];
 if(p.bi){const pre=sr(p.sensor,addD(d0,-p.pre),d0,reg).select('nbr'),post=sr(p.sensor,dEnd,addD(dEnd,p.post),reg).select('nbr'),dn=pre.subtract(post);
  bands.push((p.bx==='rbr'?dn.divide(pre.add(1.001)).clamp(-2,3):dn.clamp(-2,3)).rename('bx'))}
 const cont=ee.Image.cat(bands).multiply(1e4).round().toInt16(),
 stat=ee.Image.cat([ee.Image('USGS/SRTMGL1_003').resample('bilinear').rename('z'),ee.ImageCollection('ESA/WorldCover/v200').first().rename('lc')]).toInt16();
 return ee.Image.cat([cont,stat]).reproject({crs:'EPSG:4326',crsTransform:[G.dx,0,G.w,0,-G.dy,G.n]}).unmask(MISSING)}   // nearest neighbour onto our grid
async function eeTile(img,x0,y0,tw,th){
 const reg=ee.Geometry.Rectangle([G.w+(x0+.25)*G.dx,G.n-(y0+th-.25)*G.dy,G.w+(x0+tw-.25)*G.dx,G.n-(y0+.25)*G.dy],'EPSG:4326',false);
 const r=await new Promise((ok,no)=>img.sampleRectangle({region:reg,defaultValue:MISSING}).getInfo((v,er)=>er?no(Error(er)):ok(v))),o=r.properties,out={};
 for(const k in o){out[k]=Int16Array.from(o[k].flat());if(out[k].length!==tw*th)throw Error(`Earth Engine tile size mismatch (${out[k].length} vs ${tw*th})`)}return out}
function baseOf(nw,nd,nm,sm){const fn=nw!==MISSING&&nd!==MISSING?clamp((nw-nd)/5000,0,1):.3,mv=nm!==MISSING?clamp((nm/1e4+.2)/.6,0,1):.5,ms=sm!==MISSING?clamp(sm/1e4/.4,0,1):.5;
 return(.25+.75*fn)*Math.exp(-2*(.7*mv+.3*ms))}
async function loadEE(p){const{nx,ny,N}=G;
 if($('noee').checked){for(let i=0;i<N;i++){G.z[i]=0;G.lc[i]=30;G.base[i]=Math.round(baseOf(8000,2000,2000,2000)*255)}return}
 if(!eeReady)throw Error('Sign in to Earth Engine first, or tick "Skip Earth Engine".');
 const img=eeImage(p,ee.Geometry.Rectangle([G.w,G.s,G.e,G.n],'EPSG:4326',false)),tiles=[];
 for(let y0=0;y0<ny;y0+=TS)for(let x0=0;x0<nx;x0+=TS){const tw=Math.min(TS,nx-x0),th=Math.min(TS,ny-y0);let any=false;
  for(let y=y0;y<y0+th&&!any;y++)for(let x=x0;x<x0+tw;x++)if(G.inside[y*nx+x]){any=true;break}
  if(any)tiles.push({x0,y0,tw,th})}
 const d0=isoD(startMs(p)),miss={nw:0,nd:0,nm:0,sm:0,bx:0,z:0},cnt={done:0,hit:0};let err=null,tot=0;
 const kb=JSON.stringify(['ee3',p.sensor,p.cell,G.w,G.n,p.ww0,p.ww1,p.dw0,p.dw1,d0,p.bi?[p.bx,p.pre,p.post,p.hours]:0]);
 const work=async t=>{if(err)return;try{const key=kb+JSON.stringify([t.x0,t.y0,t.tw,t.th]);let o=await idb('get',key);if(o)cnt.hit++;else{o=await eeTile(img,t.x0,t.y0,t.tw,t.th);await idb('put',key,o)}
  for(let ty=0;ty<t.th;ty++)for(let tx=0;tx<t.tw;tx++){const q=ty*t.tw+tx,i=(t.y0+ty)*nx+t.x0+tx;if(!G.inside[i])continue;tot++;
   const nw=o.nw[q],nd=o.nd[q],nm=o.nm[q],sm=o.sm[q];if(nw===MISSING)miss.nw++;if(nd===MISSING)miss.nd++;if(nm===MISSING)miss.nm++;if(sm===MISSING)miss.sm++;
   G.z[i]=o.z[q]===MISSING?MISSING:o.z[q];if(o.z[q]===MISSING)miss.z++;G.lc[i]=o.lc[q]===MISSING?30:o.lc[q];
   G.base[i]=Math.round(baseOf(nw,nd,nm,sm)*255);
   if(o.bx){G.bx[i]=o.bx[q];if(o.bx[q]===MISSING)miss.bx++;else G.hasBI=true}}
  cnt.done++;log(`Earth Engine tiles ${cnt.done}/${tiles.length} (${cnt.hit} from cache)…`)}catch(e){err=e}};
 let k=0;await Promise.all(Array.from({length:4},async()=>{while(k<tiles.length&&!err)await work(tiles[k++])}));if(err)throw err;
 for(let y=0;y<ny;y++){let last=0;for(let x=0;x<nx;x++){const i=y*nx+x;if(G.z[i]===MISSING)G.z[i]=last;else last=G.z[i]}}   // fill DEM voids
 const pc=v=>Math.round(100*v/Math.max(1,tot));
 G.gaps=`Data gaps (% of cells): green NDVI ${pc(miss.nw)}, dry NDVI ${pc(miss.nd)}, NDMI ${pc(miss.nm)}, soil ${pc(miss.sm)}${p.bi?', burn index '+pc(miss.bx):''}.`}

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
 G.M=M;W=null}

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
async function getDetections(dA,dB,bb,key){const bases=$('fsrc').value==='ALL'?['VIIRS_SNPP','VIIRS_NOAA20','MODIS']:[$('fsrc').value],jobs=[];
 for(let d=dA;d<=dB;d=addD(d,5)){const nd=Math.min(5,daysBetween(d,dB)+1),age=(Date.now()-new Date(d))/864e5;
  for(const b of bases)for(const suf of age>150?['_SP']:age<70?['_NRT']:['_SP','_NRT'])jobs.push({src:b+suf,d,nd})}
 const all=[],seen=new Set();let k=0,done=0,err=null;
 await Promise.all(Array.from({length:3},async()=>{while(k<jobs.length&&!err){const j=jobs[k++];try{const rows=await firmsChunk(key,j.src,bb,j.d,j.nd);
  for(const r of rows){const s=r.la+','+r.lo+','+r.t+r.b;if(!seen.has(s)){seen.add(s);all.push(r)}}}catch(e){err=e}
  log(`FIRMS requests ${++done}/${jobs.length}…`)}}));
 if(err)throw err;return all}
const bboxStr=()=>{const b=drawn.getBounds();return[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(4)).join(',')};
$('firmsfile').onchange=e=>{const f=e.target.files[0];if(!f){FILEROWS=null;return}f.text().then(t=>{FILEROWS=parseCSV(t);log(`Loaded ${FILEROWS.length} detections from the CSV file. They are used instead of the FIRMS API.`)}).catch(x=>{FILEROWS=null;log('CSV error: '+x.message)})};
async function loadFire(p){const ts=startMs(p),hind=p.mode==='hind',tA=hind?ts:Date.now()-p.look*36e5,tB=hind?ts+p.hours*36e5:Date.now();let rows;
 if(FILEROWS)rows=FILEROWS;else{const key=$('firms').value.trim();if(!key){log('No FIRMS key. Click the map to place ignition points.');return null}
  rows=await getDetections(isoD(tA),isoD(tB),bboxStr(),key)}
 const seedEnd=hind?ts+6*36e5:tB,seen=new Set();let nd=0;dots.clearLayers();
 for(const r of rows){if(r.t<tA||r.t>tB)continue;const i=cellAt(r.la,r.lo);if(i<0)continue;nd++;const rad=r.b.startsWith('MODIS')?500:190;
  G.dets.push({i,rad,t:r.t});disc(i,rad,j=>G.obs[j]=1);L.circleMarker([r.la,r.lo],{radius:3,weight:1,color:'#fff',fillColor:'#a855f7',fillOpacity:.9}).addTo(dots);
  if(r.t<=seedEnd&&!seen.has(i)){seen.add(i);G.centers.push(i)}}
 return{nd,seeds:G.centers.length}}

/* fire history: real detections over a long period */
$('hbtn').onclick=async()=>{const b=$('hbtn');try{if(!AOI)return log('Draw or load an area first.');const key=$('firms').value.trim();if(!key&&!FILEROWS)return log('Enter a FIRMS key first.');b.disabled=true;saveKeys();
 const dA=$('fh0').value,dB=$('fh1').value,rows=FILEROWS||await getDetections(dA,dB,bboxStr(),key),bd=drawn.getBounds();dots.clearLayers();
 const by={};for(const r of rows){if(r.date<dA||r.date>dB||!bd.contains([r.la,r.lo]))continue;const o=by[r.date]||(by[r.date]={n:0,t:1e15});o.n++;o.t=Math.min(o.t,r.t);
  L.circleMarker([r.la,r.lo],{radius:3,weight:1,color:'#fff',fillColor:'hsl('+(+r.date.slice(5,7)*30)+',90%,55%)',fillOpacity:.9}).addTo(dots)}
 const days=Object.keys(by),tot=days.reduce((s,d)=>s+by[d].n,0),top=days.sort((a,c)=>by[c].n-by[a].n).slice(0,6);
 $('hist').innerHTML=tot?`<b>${tot}</b> detections on <b>${days.length}</b> days between ${dA} and ${dB}. Busiest days (tap one to set up a hindcast):<br>`+top.map(d=>`<a href="#" data-d="${d}" data-h="${new Date(by[d].t).getUTCHours()}">${d} (${by[d].n})</a>`).join(' · ')
  :'No detections in this area and period. If this looks wrong, check the date range and the FIRMS key.';
 log(`Fire history: ${tot} detections.`)}catch(e){log('Error: '+(e.message||e))}finally{b.disabled=false}};
$('hist').onclick=e=>{const a=e.target.closest('a[data-d]');if(!a)return;e.preventDefault();$('hs').value=a.dataset.d;$('hh').value=a.dataset.h;document.querySelector('.tabs button[data-m=hind]').click();$('hs').value=a.dataset.d;$('hh').value=a.dataset.h};

/* ================= prepare ================= */
function mkOverlays(){const{nx,ny,w,e,s,n}=G,mk=()=>{const c=document.createElement('canvas');c.width=nx;c.height=ny;return c},bb=[[s,w],[n,e]];
 G.bgc=mk();G.cv=mk();G.ctx=G.cv.getContext('2d');G.im=G.ctx.createImageData(nx,ny);
 G.bgo=new CanvasOverlay(G.bgc,bb,{opacity:.75,interactive:false}).addTo(map);G.fo=new CanvasOverlay(G.cv,bb,{interactive:false}).addTo(map)}
$('prep').onclick=async()=>{const b=$('prep');try{if(!AOI)return log('Draw or load an area first.');b.disabled=true;saveKeys();const p=P();dropGrid();const bb=drawn.getBounds();
 build({w:bb.getWest(),e:bb.getEast(),s:bb.getSouth(),n:bb.getNorth()},p,AOI);mkOverlays();
 log(`Grid ${G.nx} × ${G.ny} cells of ${p.cell} m (${(G.N/1e6).toFixed(2)} M cells). Loading satellite and terrain…`);
 await loadEE(p);await loadMet(p);const f=await loadFire(p);resetState(p.seedR);drawBG();map.fitBounds([[G.s,G.w],[G.n,G.e]]);
 log(`Ready: ${G.nx} × ${G.ny} cells of ${p.cell} m, weather lattice ${G.M.nlx} × ${G.M.nly} (${G.M.sp.toFixed(1)} km). ${f?`${f.nd} FIRMS detections, ${f.seeds} ignition points.`:''} ${G.gaps||''}${f&&!f.nd?' No FIRMS detections in this window: use "Show fire history" to find real fire dates.':''}`)}
 catch(e){log('Error: '+(e.message||e))}finally{b.disabled=false}};
map.on('click',ev=>{if(G&&G.im&&!running){const i=cellAt(ev.latlng.lat,ev.latlng.lng);if(i>=0){G.centers.push(i);igniteDisc(i,+$('seedr').value||60);G.ctx.putImageData(G.im,0,0)}}});

/* ================= background layers ================= */
const RAMP=[[40,60,130],[50,160,140],[250,225,60],[225,50,30]],ramp=t=>{t=clamp(t,0,1)*3;const k=Math.min(2,t|0),f=t-k,a=RAMP[k],b=RAMP[k+1];return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]};
const LCC={10:[0,100,0],20:[255,187,34],30:[255,255,76],40:[240,150,255],50:[250,0,0],60:[180,180,180],70:[240,240,240],80:[0,100,200],90:[0,150,160],95:[0,207,117],100:[250,230,160]};
function drawBG(){if(!G||!G.bgc)return;const v=$('lyr').value,{nx,ny,N,inside,base,z,lc,bx,obs,state}=G,c=G.bgc.getContext('2d'),im=c.createImageData(nx,ny),d=im.data,thr=(+$('bthr').value||.1)*1e4;
 let zmin=1e9,zmax=-1e9;if(v==='z')for(let i=0;i<N;i++)if(inside[i]){if(z[i]<zmin)zmin=z[i];if(z[i]>zmax)zmax=z[i]}
 for(let i=0;i<N;i++){if(!inside[i])continue;let col=null,a=255;
  if(v==='fuel')col=ramp(base[i]/255*1.6);else if(v==='z')col=ramp((z[i]-zmin)/Math.max(1,zmax-zmin));else if(v==='lc')col=LCC[lc[i]]||[128,128,128];
  else if(v==='bi'){if(bx[i]!==MISSING&&bx[i]>thr)col=[255,40,40]}else if(v==='obs'){if(obs[i])col=[190,80,250]}
  else if(v==='cmp'){const pr=state[i]===1||state[i]===2,ob=G.hasBI?(bx[i]!==MISSING&&bx[i]>thr):obs[i]===1;if(pr&&ob)col=[60,200,90];else if(pr)col=[240,60,60];else if(ob)col=[70,130,255]}
  if(col){d[i*4]=col[0];d[i*4+1]=col[1];d[i*4+2]=col[2];d[i*4+3]=a}}
 c.putImageData(im,0,0)}
$('lyr').onchange=drawBG;

/* ================= video, validation, charts ================= */
function vstart(){$('vlink').hidden=true;rec=null;if(!$('vid').checked||!window.MediaRecorder)return;const w=G.nx<720?G.nx*Math.floor(720/G.nx):960;
 vc=document.createElement('canvas');vc.width=w;vc.height=Math.round(G.ny*w/G.nx)+30;chunks=[];
 rec=new MediaRecorder(vc.captureStream(10));rec.ondataavailable=e=>chunks.push(e.data);
 rec.onstop=()=>{const a=$('vlink');a.href=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));a.download='fire-spread.webm';a.hidden=false};rec.start()}
function vframe(tm){if(!rec)return;const x=vc.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,vc.width,vc.height);x.imageSmoothingEnabled=vc.width<G.nx;
 if($('lyr').value!=='none'){x.globalAlpha=.75;x.drawImage(G.bgc,0,30,vc.width,vc.height-30);x.globalAlpha=1}
 x.drawImage(G.cv,0,30,vc.width,vc.height-30);x.fillStyle='#ffc21a';x.font='16px sans-serif';x.fillText(`t + ${(tm/60).toFixed(1)} h`,8,20)}
function validate(){if(!G||!G.M)return log('Prepare data and run a simulation first.');
 const{state,obs,bx,inside,lc,N,cell}=G,thr=(+$('bthr').value||.1)*1e4,km=c=>(c*cell*cell/1e6).toFixed(2);
 const row=(nm,ref,valid)=>{let tp=0,fp=0,fn=0,tot=0;for(let i=0;i<N;i++){if(!inside[i]||NF[lc[i]]||(valid&&!valid(i)))continue;tot++;const pr=state[i]===1||state[i]===2,ob=ref(i);if(pr&&ob)tp++;else if(pr)fp++;else if(ob)fn++}
  const pc=tp/(tp+fp)||0,rc=tp/(tp+fn)||0;return`<tr><td>${nm}</td><td>${km(tp+fp)}</td><td>${km(tp+fn)}</td><td>${pc.toFixed(2)}</td><td>${rc.toFixed(2)}</td><td>${(2*pc*rc/(pc+rc)||0).toFixed(2)}</td><td>${(tp/(tp+fp+fn)||0).toFixed(2)}</td></tr>`};
 let h='',rows='',note='';
 if(G.dets.length){rows+=row('FIRMS (dilated by pixel)',i=>obs[i]===1);let hit=0;G.dets.forEach(d=>{let ok=false;disc(d.i,d.rad,j=>{if(state[j]===1||state[j]===2)ok=true});if(ok)hit++});note+=`FIRMS detections inside the model burnt area (within their pixel footprint): ${hit} of ${G.dets.length}. `}
 if(G.hasBI){rows+=row(($('bxsel').value==='rbr'?'RBR':'dNBR')+' > '+(thr/1e4),i=>bx[i]>thr,i=>bx[i]!==MISSING)}
 if(!rows)return $('val').innerHTML='<p class="st">No reference data. Load FIRMS detections, or tick "Fetch burn-scar reference" and press 1. Prepare data again.</p>';
 $('val').innerHTML='<table><tr><th>Reference</th><th>Model km²</th><th>Ref. km²</th><th>Prec.</th><th>Recall</th><th>F1</th><th>IoU</th></tr>'+rows+'</table><p class="st">'+note+'Tip: map layer "Model vs reference" shows agreement (green), false alarm (red), miss (blue).</p>';
 if($('lyr').value==='cmp')drawBG()}
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
$('reset').onclick=()=>{running=false;if(G){resetState(+$('seedr').value||60);log('Reset.')}};
function record(tm){let cx=G.nx/2,cy=G.ny/2;if(G.act.length){let sx=0,sy=0;for(const i of G.act){sx+=i%G.nx;sy+=(i/G.nx)|0}cx=sx/G.act.length;cy=sy/G.act.length;G.lastC=[cx,cy]}else if(G.lastC)[cx,cy]=G.lastC;
 const ci=clamp(Math.round(cy),0,G.ny-1)*G.nx+clamp(Math.round(cx),0,G.nx-1);wxAt(cx,cy,G.z[ci]);const a=G.cell*G.cell/1e6;
 H.t.push(+(tm/60).toFixed(3));H.area.push(+((G.nBurnt+G.act.length)*a).toFixed(3));H.act.push(+(G.act.length*a).toFixed(3));H.ws.push(+wV.toFixed(1));H.wd.push(Math.round(wDir));H.T.push(+wT.toFixed(1));H.RH.push(Math.round(wRH))}
$('run').onclick=async()=>{if(running){running=false;return}if(!G||!G.M)return log('Prepare data first.');const p=P(),b=$('run');resetState(p.seedR);
 if(!G.act.length)return log('Nothing to ignite. Add a FIRMS key, or click the map (a fire cell must be flammable).');
 G.tbs=Math.max(1,Math.round(p.tb/p.dt));const nS=Math.round(p.hours*60/p.dt),per=Math.max(1,Math.round(10/p.dt));
 running=true;b.textContent='Stop';H={t:[],area:[],act:[],ws:[],wd:[],T:[],RH:[]};vstart();$('val').innerHTML='';let tm=0;
 try{for(let k=0;k<nS&&running;k++){step(p,k*p.dt);tm=(k+1)*p.dt;
  if((k+1)%per===0||k===nS-1||!G.act.length){drawFrame();vframe(tm);record(tm);
   log(`t + ${(tm/60).toFixed(1)} h: ${H.area[H.area.length-1]} km² burnt or burning, ${G.act.length} active cells.`);await(rec?sleep(90):raf());if(!G.act.length)break}}
 drawFrame();if(rec&&rec.state!=='inactive')rec.stop();if(H.t.length)charts();
 log(`Finished at t + ${(tm/60).toFixed(1)} h${G.act.length?'':' (fire burnt out)'}: ${H.area[H.area.length-1]||0} km² burnt.`);
 if(p.mode==='hind'||G.hasBI||G.dets.length)validate();if($('lyr').value==='cmp')drawBG()}
 catch(e){log('Error: '+(e.message||e))}finally{running=false;b.textContent='2. Run simulation'}};
