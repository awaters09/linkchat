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
const MIME={'.html':'text/html; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml'};
const STATIC={'/manifest.json':'manifest.json','/sw.js':'sw.js','/icon-192.png':'icons/icon-192.png','/icon-512.png':'icons/icon-512.png','/apple-touch-icon.png':'icons/apple-touch-icon.png','/icon.svg':'icons/icon.svg'};
const MAXIMG=2*1024*1024,MAXAUD=1024*1024,ROOM_MEDIA_CAP=40*1024*1024;
function trimMedia(r){let tot=0;for(let i=r.messages.length-1;i>=0;i--){const m=r.messages[i];if(!m.data)continue;tot+=m.data.length;if(tot>ROOM_MEDIA_CAP){delete m.data;m.expired=true}}}
const srv=http.createServer((q,s)=>{const u=new URL(q.url,'http://x');
if(q.method==='POST'&&u.pathname==='/api/rooms'){let b='';q.on('data',d=>b+=d);q.on('end',()=>{let m='saved';try{m=JSON.parse(b).mode==='disappearing'?'disappearing':'saved'}catch{}
const id=crypto.randomBytes(5).toString('hex');rooms[id]={id,mode:m,created:Date.now(),expires:m==='disappearing'?Date.now()+TTL:null,messages:[]};save(id);s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify(rooms[id]))});return}
const mm=u.pathname.match(/^\/api\/rooms\/(\w+)$/);if(mm){const r=alive(mm[1]);s.writeHead(r?200:404,{'content-type':'application/json'});s.end(JSON.stringify(r?{id:r.id,mode:r.mode,expires:r.expires}:{error:'not found'}));return}
const f=STATIC[u.pathname];if(f){try{const b=fs.readFileSync(path.join(__dirname,f));s.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream','cache-control':f==='sw.js'?'no-cache':'public, max-age=86400'});return s.end(b)}catch{}}
s.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});s.end(fs.readFileSync(path.join(__dirname,'index.html')))});
const wss=new WebSocketServer({server:srv,maxPayload:3*1024*1024});
function deliver(w,m){w.q=(w.q||Promise.resolve()).then(()=>deliverNow(w,m)).catch(()=>{});return w.q}
async function deliverNow(w,m){const t=m.lang===w.lang?m.text:await tr(m.text,w.lang);if(w.readyState===1)w.send(JSON.stringify({type:'msg',msg:{...m,translated:t}}))}
wss.on('connection',(w,q)=>{const u=new URL(q.url,'http://x');const id=u.searchParams.get('room');const r=alive(id);if(!r){w.send(JSON.stringify({type:'error',error:'Room not found or expired'}));return w.close()}
w.name=(u.searchParams.get('name')||'Guest').slice(0,30);w.lang=u.searchParams.get('lang')||'en';w.room=id;
if(!clients.has(id))clients.set(id,new Set());clients.get(id).add(w);
w.send(JSON.stringify({type:'room',room:{id:r.id,mode:r.mode,expires:r.expires}}));w.send(JSON.stringify({type:'people',people:r.people||{}}));
for(const m of r.messages)deliver(w,m);
const sys=t=>{for(const c of clients.get(id)||[])if(c.readyState===1)c.send(JSON.stringify({type:'sys',text:t}))};sys(w.name+' joined');
w.on('message',async d=>{let j;try{j=JSON.parse(d)}catch{return}const rr=alive(id);if(!rr)return;
if(j.type==='lang'){w.lang=String(j.lang);return}
if(j.type==='profile'){const a=String(j.avatar||'');if(a&&(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(a)||a.length*0.75>150*1024)){if(w.readyState===1)w.send(JSON.stringify({type:'error',error:'Profile photo too large or invalid'}));return}
rr.people=rr.people||{};rr.people[w.name]={avatar:a||null,lang:w.lang,ts:Date.now()};const ks=Object.keys(rr.people);if(ks.length>50)delete rr.people[ks.sort((x,y)=>rr.people[x].ts-rr.people[y].ts)[0]];save(id);
for(const c of clients.get(id)||[])if(c.readyState===1)c.send(JSON.stringify({type:'people',people:rr.people}));return}
if(j.type!=='msg')return;const kind=['image','audio'].includes(j.kind)?j.kind:'text';const text=String(j.text||'').slice(0,2000);
const m={id:crypto.randomUUID(),name:w.name,lang:w.lang,text,ts:Date.now()};
if(kind==='text'){if(!text.trim())return}else{const data=String(j.data||'');const re=kind==='image'?/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/:/^data:audio\/[\w.+-]+(;[\w=.-]+)*;base64,[A-Za-z0-9+\/=]+$/;
const max=kind==='image'?MAXIMG:MAXAUD;if(!re.test(data)||data.length*0.75>max){if(w.readyState===1)w.send(JSON.stringify({type:'error',error:(kind==='image'?'Photo':'Voice message')+' too large or invalid'}));return}
m.kind=kind;m.data=data;if(kind==='audio')m.dur=Math.min(600,Math.max(0,+j.dur||0))}
{rr.messages.push(m);trimMedia(rr);if(rr.messages.length>500)rr.messages.shift();save(id);for(const c of clients.get(id))deliver(c,m)}});
w.on('close',()=>{clients.get(id)?.delete(w);sys(w.name+' left')})});
(async()=>{if(pool){try{await pool.query('CREATE TABLE IF NOT EXISTS rooms(id text PRIMARY KEY,data jsonb NOT NULL)');const r=await pool.query('SELECT data FROM rooms');for(const x of r.rows)rooms[x.data.id]=x.data;console.log('Loaded',r.rows.length,'saved rooms from Postgres')}catch(e){console.error('db init',e.message)}}
srv.listen(PORT,()=>console.log('LinkChat on',PORT))})();
