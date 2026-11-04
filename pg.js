const {Client}=require('ssh2'),net=require('net');const c=new Client();
c.on('ready',()=>{c.forwardIn('localhost',0,e=>e&&console.log('fwd err',e));c.shell((e,s)=>{if(e)return console.log(e);s.on('data',d=>process.stdout.write(d.toString()))})});
c.on('tcp connection',(i,acc)=>{const ch=acc();const so=net.connect(8787,'127.0.0.1');ch.pipe(so).pipe(ch);so.on('error',()=>ch.end())});
c.on('error',e=>console.log('ERR',e.message));c.on('close',()=>{console.log('closed');process.exit(1)});
c.connect({host:'a.pinggy.io',port:443,username:'free',tryKeyboard:true,password:'',readyTimeout:20000});
c.on('keyboard-interactive',(n,i,l,p,f)=>f(p.map(()=>'')));
