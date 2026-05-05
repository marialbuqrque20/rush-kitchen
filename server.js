
const express=require("express"), path=require("path"), http=require("http"), WebSocket=require("ws");
const app=express(), PORT=process.env.PORT||3000;
app.use(express.static(__dirname));
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
const server=http.createServer(app), wss=new WebSocket.Server({server});
const rooms=new Map(), MAX=3;
const stations=[
{id:"pao",label:"Pão",icon:"🍞",x:70,y:150,w:116,h:92,type:"ingredient",item:"pao"},
{id:"carne",label:"Carne",icon:"🥩",x:205,y:150,w:116,h:92,type:"ingredient",item:"carne_crua"},
{id:"queijo",label:"Queijo",icon:"🧀",x:340,y:150,w:116,h:92,type:"ingredient",item:"queijo"},
{id:"batata",label:"Batata",icon:"🥔",x:475,y:150,w:116,h:92,type:"ingredient",item:"batata_crua"},
{id:"massa",label:"Massa",icon:"🥟",x:610,y:150,w:116,h:92,type:"ingredient",item:"massa"},
{id:"molho",label:"Molho",icon:"🍅",x:745,y:150,w:116,h:92,type:"ingredient",item:"molho"},
{id:"grill",label:"Chapa",icon:"🔥",x:70,y:430,w:144,h:106,type:"cook",accepts:"carne_crua",result:"carne_ok",time:3},
{id:"fryer",label:"Fritadeira",icon:"🍟",x:240,y:430,w:144,h:106,type:"cook",accepts:"batata_crua",result:"batata_ok",time:3},
{id:"oven",label:"Forno",icon:"🍕",x:410,y:430,w:144,h:106,type:"oven",time:4},
{id:"assembly",label:"Montagem",icon:"🔪",x:580,y:430,w:144,h:106,type:"assembly"},
{id:"delivery",label:"Entrega",icon:"✅",x:750,y:430,w:144,h:106,type:"delivery"},
{id:"trash",label:"Lixo",icon:"🗑️",x:910,y:430,w:70,h:106,type:"trash"}];
const recipes=[
{id:"burger",name:"Burger",icon:"🍔",needs:["pao","carne_ok"],points:130,patience:32},
{id:"cheese_burger",name:"Cheese Burger",icon:"🧀",needs:["pao","carne_ok","queijo"],points:170,patience:34},
{id:"fries",name:"Batata",icon:"🍟",needs:["batata_ok"],points:110,patience:26},
{id:"pizza",name:"Pizza",icon:"🍕",needs:["pizza_ok"],points:190,patience:38},
{id:"mega",name:"Mega Burger",icon:"🔥",needs:["pao","carne_ok","queijo","molho"],points:230,patience:36}];
function send(ws,d){if(ws.readyState===1)ws.send(JSON.stringify(d))}
function bc(r,d){for(const p of r.players.values())send(p.ws,d)}
function mk(){return Math.random().toString(36).slice(2,10)}
function code(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(rooms.has(c));return c}
function st(){return{started:false,ended:false,timeLeft:180,score:0,stars:0,combo:0,multiplier:1,orders:[],tableItems:[],cooking:[],shake:0,floating:[]}}
function newOrder(r){if(r.state.orders.length>=4)return;let x=recipes[Math.floor(Math.random()*recipes.length)];r.state.orders.push({...x,orderId:mk(),maxPatience:x.patience,mood:"happy"})}
function room(){let r={code:code(),players:new Map(),state:st(),interval:null,last:Date.now(),nextOrder:3};newOrder(r);newOrder(r);rooms.set(r.code,r);return r}
function stars(s){return s>=2400?5:s>=1800?4:s>=1200?3:s>=650?2:s>=220?1:0}
function ov(a,b){return a.x<b.x+b.w&&a.x+a.size>b.x&&a.y<b.y+b.h&&a.y+a.size>b.y}
function near(p){let f=null;for(const s of stations)if(ov(p,s))f=s;return f}
function rem(a,i){let n=a.indexOf(i);if(n>=0)a.splice(n,1)}
function fl(r,t,x=500,y=250,type="good"){r.state.floating.push({id:mk(),text:t,x,y,life:1.1,type})}
function pizza(r){let t=r.state.tableItems;if(["massa","molho","queijo"].every(i=>t.includes(i))){["massa","molho","queijo"].forEach(i=>rem(t,i));r.state.cooking.push({result:"pizza_ok",remaining:4,max:4});fl(r,"FORNO!",480,410);return true}return false}
function assemble(r,p){if(p.holding){r.state.tableItems.push(p.holding);p.holding=null;fl(r,"+ITEM",620,400);return}for(const o of r.state.orders){if(o.id==="pizza"||o.id==="fries")continue;if(o.needs.every(n=>r.state.tableItems.includes(n))){o.needs.forEach(n=>rem(r.state.tableItems,n));p.holding=o.id;fl(r,"PRONTO!",650,395);return}}fl(r,"FALTA ITEM!",640,395,"bad");r.state.shake=.2}
function deliver(r,p){if(!p.holding)return;let idx=r.state.orders.findIndex(o=>p.holding===o.id||(p.holding==="batata_ok"&&o.id==="fries")||(p.holding==="pizza_ok"&&o.id==="pizza"));if(idx>=0){let o=r.state.orders[idx],bonus=Math.floor((o.patience/o.maxPatience)*80);r.state.combo++;r.state.multiplier=Math.min(4,1+Math.floor(r.state.combo/3));let g=Math.floor((o.points+bonus)*r.state.multiplier);r.state.score+=g;r.state.orders.splice(idx,1);p.holding=null;fl(r,"PERFECT +"+g,680,130);if(r.state.orders.length<3)newOrder(r)}else{r.state.score=Math.max(0,r.state.score-90);r.state.combo=0;r.state.multiplier=1;r.state.shake=.4;fl(r,"ERRADO!",650,130,"bad");p.holding=null}r.state.stars=stars(r.state.score)}
function interact(r,p){if(!r.state.started||r.state.ended||p.cooldown>0)return;p.cooldown=8;let s=near(p);if(!s)return;if(s.type==="ingredient"){if(!p.holding){p.holding=s.item;fl(r,s.icon,s.x+50,s.y)}return}if(s.type==="cook"){if(p.holding===s.accepts){r.state.cooking.push({result:s.result,remaining:s.time,max:s.time});p.holding=null;fl(r,"COZINHANDO!",s.x+20,s.y)}else{fl(r,"NÃO AQUI!",s.x,s.y,"bad");r.state.shake=.15}return}if(s.type==="oven"){if(!pizza(r)){fl(r,"MASSA+MOLHO+QUEIJO",s.x-35,s.y,"bad");r.state.shake=.15}return}if(s.type==="assembly")return assemble(r,p);if(s.type==="delivery")return deliver(r,p);if(s.type==="trash"&&p.holding){p.holding=null;r.state.score=Math.max(0,r.state.score-20);fl(r,"LIXO",-20,450,"bad")}}
function pub(r){return{code:r.code,maxPlayers:MAX,stations,players:[...r.players.values()].map(p=>({id:p.id,number:p.number,x:p.x,y:p.y,size:p.size,avatar:p.avatar,holding:p.holding,name:p.name})),state:r.state}}
function update(r,dt){let s=r.state;if(!s.started||s.ended)return;s.timeLeft-=dt;r.nextOrder-=dt;if(r.nextOrder<=0){newOrder(r);r.nextOrder=Math.max(5.5,10-Math.floor((180-s.timeLeft)/35))}for(const o of s.orders){o.patience-=dt;o.mood=o.patience<o.maxPatience*.35?"angry":o.patience<o.maxPatience*.65?"worried":"happy"}let exp=s.orders.filter(o=>o.patience<=0);if(exp.length){s.orders=s.orders.filter(o=>o.patience>0);s.score=Math.max(0,s.score-120*exp.length);s.combo=0;s.multiplier=1;s.shake=.45;fl(r,"CLIENTE FOI EMBORA!",380,120,"bad");while(s.orders.length<2)newOrder(r)}for(const p of r.players.values()){if(p.cooldown>0)p.cooldown--;let i=p.input||{};if(i.up)p.y-=p.speed;if(i.down)p.y+=p.speed;if(i.left)p.x-=p.speed;if(i.right)p.x+=p.speed;p.x=Math.max(12,Math.min(960,p.x));p.y=Math.max(80,Math.min(565,p.y))}s.cooking.forEach(c=>c.remaining-=dt);let done=s.cooking.filter(c=>c.remaining<=0);s.cooking=s.cooking.filter(c=>c.remaining>0);done.forEach(c=>{s.tableItems.push(c.result);fl(r,"PRONTO!",300,390)});s.floating.forEach(f=>{f.life-=dt;f.y-=35*dt});s.floating=s.floating.filter(f=>f.life>0);s.shake=Math.max(0,s.shake-dt);s.stars=stars(s.score);if(s.timeLeft<=0){s.timeLeft=0;s.ended=true;s.started=false;bc(r,{type:"ended",score:s.score,stars:s.stars})}}
function loop(r){if(r.interval)return;r.last=Date.now();r.interval=setInterval(()=>{let n=Date.now(),dt=Math.min((n-r.last)/1000,.1);r.last=n;update(r,dt);bc(r,{type:"state",payload:pub(r)})},1000/30)}
function add(r,ws,d){if(r.players.size>=MAX)return send(ws,{type:"error",message:"Sala cheia."});let n=r.players.size+1,sp=[{x:430,y:330},{x:520,y:330},{x:610,y:330}][n-1];let p={id:mk(),number:n,ws,x:sp.x,y:sp.y,size:48,speed:3.9,avatar:d.avatar||"ruiva",name:d.name||"Chef "+n,holding:null,input:{},cooldown:0};r.players.set(p.id,p);ws.playerId=p.id;ws.roomCode=r.code;send(ws,{type:"joined",roomCode:r.code,playerId:p.id,playerNumber:n,payload:pub(r)});bc(r,{type:"state",payload:pub(r)});loop(r)}
wss.on("connection",ws=>{send(ws,{type:"hello"});ws.on("message",raw=>{let d;try{d=JSON.parse(raw)}catch{return}if(d.type==="createRoom")return add(room(),ws,d);if(d.type==="joinRoom"){let r=rooms.get(String(d.roomCode||"").trim());if(!r)return send(ws,{type:"error",message:"Sala não encontrada."});return add(r,ws,d)}let r=rooms.get(ws.roomCode),p=r&&r.players.get(ws.playerId);if(!r||!p)return;if(d.type==="startGame"){r.state=st();r.nextOrder=2.5;newOrder(r);newOrder(r);r.state.started=true;for(const pl of r.players.values()){pl.holding=null;pl.x=[430,520,610][pl.number-1]||520;pl.y=330}return bc(r,{type:"started",payload:pub(r)})}if(d.type==="input")return p.input=d.input||{};if(d.type==="interact")return interact(r,p);if(d.type==="setAvatar"){p.avatar=d.avatar||p.avatar;return bc(r,{type:"state",payload:pub(r)})}});ws.on("close",()=>{let r=rooms.get(ws.roomCode);if(!r)return;r.players.delete(ws.playerId);if(r.players.size===0){clearInterval(r.interval);rooms.delete(r.code)}else bc(r,{type:"state",payload:pub(r)})})});
server.listen(PORT,()=>console.log("Rush Kitchen Chaos Pro no ar"));
