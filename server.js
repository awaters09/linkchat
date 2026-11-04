const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');const {WebSocketServer}=require('ws');
const PORT=process.env.PORT||8787,DB=path.join(__dirname,'rooms.json'),TTL=2*3600*1000;
let rooms={};try{rooms=JSON.parse(fs.readFileSync(DB))}catch{}
const pool=process.env.DATABASE_URL?new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,ssl:/render\.com/.test(process.env.DATABASE_URL)&&/\./.test(new URL(process.env.DATABASE_URL).hostname)?{rejectUnauthorized:false}:false}):null;
const dirty=new Set();let flushing=false;
async function flush(){if(flushing||!pool)return;flushing=true;try{for(const id of[...dirty]){dirty.delete(id);const r=rooms[id];if(r&&r.mode==='saved')await pool.query('INSERT INTO rooms(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[id,r])}}catch(e){console.error('db save',e.message)}flushing=false;if(dirty.size)flush()}
const save=id=>{if(pool){for(const[k,r]of Object.entries(rooms))if(r.mode==='saved'&&(!id||k===id))dirty.add(k);return flush()}const s={};for(const[k,r]of Object.entries(rooms))if(r.mode==='saved')s[k]=r;fs.writeFileSync(DB,JSON.stringify(s))};
const cache=new Map();
async function tr(text,to){if(!text.trim())return text;const k=to+'|'+text;if(cache.has(k))return cache.get(k);let out=null;
try{const r=await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl='+encodeURIComponent(to)+'&q='+encodeURIComponent(text));const j=await r.json();out=j[0].map(x=>x[0]).join('');}catch{}
if(!out)try{const r=await fetch('https://api.mymemory.translated.net/get?langpair=autodetect|'+to+'&q='+encodeURIComponent(text));const j=await r.json();out=j.responseData.translatedText}catch{}
out=out||text;cache.set(k,out);return out}
const clients=new Map();// room -> Set(ws)
function alive(id){const r=rooms[id];if(!r)return null;if(r.mode==='disappearing'&&Date.now()>r.expires){delete rooms[id];return null}return r}
setInterval(()=>{for(const id in rooms)if(!alive(id)){for(const w of clients.get(id)||[])w.close();clients.delete(id)}},60000);
const html=fs.readFileSync(path.join(__dirname,'index.html'));
const srv=http.createServer((q,s)=>{const u=new URL(q.url,'http://x');
if(q.method==='POST'&&u.pathname==='/api/rooms'){let b='';q.on('data',d=>b+=d);q.on('end',()=>{let m='saved';try{m=JSON.parse(b).mode==='disappearing'?'disappearing':'saved'}catch{}
const id=crypto.randomBytes(5).toString('hex');rooms[id]={id,mode:m,created:Date.now(),expires:m==='disappearing'?Date.now()+TTL:null,messages:[]};save(id);s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify(rooms[id]))});return}
const mm=u.pathname.match(/^\/api\/rooms\/(\w+)$/);if(mm){const r=alive(mm[1]);s.writeHead(r?200:404,{'content-type':'application/json'});s.end(JSON.stringify(r?{id:r.id,mode:r.mode,expires:r.expires}:{error:'not found'}));return}
s.writeHead(200,{'content-type':'text/html'});s.end(html)});
const wss=new WebSocketServer({server:srv});
async function deliver(w,m){const t=m.lang===w.lang?m.text:await tr(m.text,w.lang);if(w.readyState===1)w.send(JSON.stringify({type:'msg',msg:{...m,translated:t}}))}
wss.on('connection',(w,q)=>{const u=new URL(q.url,'http://x');const id=u.searchParams.get('room');const r=alive(id);if(!r){w.send(JSON.stringify({type:'error',error:'Room not found or expired'}));return w.close()}
w.name=(u.searchParams.get('name')||'Guest').slice(0,30);w.lang=u.searchParams.get('lang')||'en';w.room=id;
if(!clients.has(id))clients.set(id,new Set());clients.get(id).add(w);
w.send(JSON.stringify({type:'room',room:{id:r.id,mode:r.mode,expires:r.expires}}));
(async()=>{for(const m of r.messages)await deliver(w,m)})();
const sys=t=>{for(const c of clients.get(id)||[])if(c.readyState===1)c.send(JSON.stringify({type:'sys',text:t}))};sys(w.name+' joined');
w.on('message',async d=>{let j;try{j=JSON.parse(d)}catch{return}const rr=alive(id);if(!rr)return;
if(j.type==='lang'){w.lang=String(j.lang);return}
if(j.type==='msg'&&j.text){const m={id:crypto.randomUUID(),name:w.name,lang:w.lang,text:String(j.text).slice(0,2000),ts:Date.now()};rr.messages.push(m);if(rr.messages.length>500)rr.messages.shift();save(id);for(const c of clients.get(id))deliver(c,m)}});
w.on('close',()=>{clients.get(id)?.delete(w);sys(w.name+' left')})});
(async()=>{if(pool){try{await pool.query('CREATE TABLE IF NOT EXISTS rooms(id text PRIMARY KEY,data jsonb NOT NULL)');const r=await pool.query('SELECT data FROM rooms');for(const x of r.rows)rooms[x.data.id]=x.data;console.log('Loaded',r.rows.length,'saved rooms from Postgres')}catch(e){console.error('db init',e.message)}}
srv.listen(PORT,()=>console.log('LinkChat on',PORT))})();
