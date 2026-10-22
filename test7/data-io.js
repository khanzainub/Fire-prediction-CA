/* Transport, cancellation and browser-local storage only; no scientific processing. */
const DataIO=(()=>{
 let controller=new AbortController(),dbPromise=null,warned=false;
 const memory=new Map(),pending=new Map();
 const api={warn:()=>{},get signal(){return controller.signal},check(signal){if(signal?.aborted)throw new DOMException('Workflow reset','AbortError')},reset(){controller.abort();controller=new AbortController()}};
 function warning(){if(!warned){warned=true;api.warn('Persistent cache unavailable or full. Downloaded data is retained in this tab only.')}}
 function database(){if(dbPromise)return dbPromise;dbPromise=new Promise(resolve=>{
  let settled=false,q;const finish=db=>{if(settled){db?.close();return}settled=true;clearTimeout(timer);resolve(db)},timer=setTimeout(()=>{warning();finish(null)},5000);
  try{q=indexedDB.open('wf',1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('c'))q.result.createObjectStore('c')};q.onsuccess=()=>finish(q.result);q.onerror=q.onblocked=()=>{warning();finish(null)}}catch(e){warning();finish(null)}
 });return dbPromise}
 api.cache=async(method,key,value)=>{
  if(method==='clear')memory.clear();if(method==='put')memory.set(key,value);if(method==='get'&&memory.has(key))return memory.get(key);
  const db=await database();if(!db)return method==='put'?value:undefined;
  return new Promise(resolve=>{let result,done=false,tx;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v)},timer=setTimeout(()=>{warning();try{tx?.abort()}catch(e){}finish(method==='put'?value:undefined)},5000);
   try{tx=db.transaction('c',method==='get'?'readonly':'readwrite');const store=tx.objectStore('c'),q=method==='get'?store.get(key):method==='put'?store.put(value,key):store.clear();q.onsuccess=()=>{result=q.result};tx.oncomplete=()=>{if(method==='get'&&result!==undefined)memory.set(key,result);finish(method==='put'?value:result)};tx.onerror=tx.onabort=()=>{warning();finish(method==='put'?value:undefined)}}catch(e){warning();finish(method==='put'?value:undefined)}
  })
 };
 api.wait=(promise,signal=controller.signal,ms=0)=>new Promise((resolve,reject)=>{
  let timer;const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort)},abort=()=>{cleanup();reject(new DOMException('Workflow reset','AbortError'))};
  if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});if(ms)timer=setTimeout(()=>{cleanup();reject(new Error(`Request timed out after ${ms/1000} s`))},ms);
  Promise.resolve(promise).then(v=>{cleanup();resolve(v)},e=>{cleanup();reject(e)})
 });
 api.delay=(ms,signal)=>api.wait(new Promise(r=>setTimeout(r,ms)),signal);
 // The timeout covers both response headers and the complete body.
 api.request=async(url,options={},type='json',ms=30000,signal=controller.signal)=>{
  api.check(signal);const local=new AbortController(),abort=()=>local.abort();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,ms);
  try{const response=await fetch(url,{...options,signal:local.signal});if(!response.ok){const e=new Error(`HTTP ${response.status}`);e.status=response.status;e.retryAfter=response.headers.get('Retry-After');throw e}const value=await response[type]();api.check(signal);return value}
  catch(e){api.check(signal);if(local.signal.aborted)throw Error(`Request timed out after ${ms/1000} s`);throw e}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
 };
 // Timed-out Earth Engine callbacks may still finish: cache their valid result,
 // and never submit a duplicate request while that same tile is in flight.
 api.once=(key,load)=>{if(pending.has(key))return pending.get(key);const promise=Promise.resolve().then(load);pending.set(key,promise);promise.then(()=>pending.delete(key),()=>pending.delete(key));return promise};
 return api;
})();
