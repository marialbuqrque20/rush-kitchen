
const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const MAX_PLAYERS = 3;

const stations = [
 {id:"bread",name:"Pão",emoji:"🍞",x:60,y:90,w:130,h:90,type:"ingredient",item:"pao"},
 {id:"meat",name:"Carne",emoji:"🥩",x:210,y:90,w:130,h:90,type:"ingredient",item:"carne_crua"},
 {id:"cheese",name:"Queijo",emoji:"🧀",x:360,y:90,w:130,h:90,type:"ingredient",item:"queijo"},
 {id:"potato",name:"Batata",emoji:"🥔",x:510,y:90,w:130,h:90,type:"ingredient",item:"batata_crua"},
 {id:"dough",name:"Massa",emoji:"🥟",x:660,y:90,w:130,h:90,type:"ingredient",item:"massa"},
 {id:"sauce",name:"Molho",emoji:"🍅",x:810,y:90,w:130,h:90,type:"ingredient",item:"molho"},
 {id:"grill",name:"Chapa",emoji:"🔥",x:70,y:410,w:160,h:120,type:"cook",accepts:"carne_crua",result:"carne_cozida",time:3},
 {id:"fryer",name:"Fritadeira",emoji:"🍟",x:260,y:410,w:160,h:120,type:"cook",accepts:"batata_crua",result:"batata_frita",time:3},
 {id:"oven",name:"Forno",emoji:"🍕",x:450,y:410,w:160,h:120,type:"oven",time:4},
 {id:"assembly",name:"Montagem",emoji:"🔪",x:640,y:410,w:160,h:120,type:"assembly"},
 {id:"delivery",name:"Entrega",emoji:"✅",x:830,y:410,w:130,h:120,type:"delivery"}
];
const recipes = [
 {name:"🍔 Hambúrguer",needs:["pao","carne_cozida"],points:120},
 {name:"🧀 Burger queijo",needs:["pao","carne_cozida","queijo"],points:160},
 {name:"🍟 Batata frita",needs:["batata_frita"],points:100},
 {name:"🍕 Pizza",needs:["pizza_assada"],points:170}
];

function send(ws,data){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function broadcast(room,data){ for(const p of room.players.values()) send(p.ws,data); }
function code(){ let c; do c=String(Math.floor(1000+Math.random()*9000)); while(rooms.has(c)); return c; }
function id(){ return Math.random().toString(36).slice(2,10); }
function state(){ return {started:false,ended:false,timeLeft:180,score:0,stars:0,currentOrder:null,orderPatience:30,orderMaxPatience:30,tableItems:[],cooking:[],assembled:null}; }
function newOrder(room){ room.state.currentOrder=recipes[Math.floor(Math.random()*recipes.length)]; room.state.orderPatience=25+Math.floor(Math.random()*13); room.state.orderMaxPatience=room.state.orderPatience; }
function createRoom(){ const room={code:code(),players:new Map(),state:state(),interval:null,last:Date.now()}; newOrder(room); rooms.set(room.code,room); return room; }
function stars(score){ return score>=1200?5:score>=900?4:score>=650?3:score>=350?2:score>=120?1:0; }
function overlap(a,b){ return a.x < b.x+b.w && a.x+a.size > b.x && a.y < b.y+b.h && a.y+a.size > b.y; }
function nearest(p){ let found=null; for(const s of stations) if(overlap(p,s)) found=s; return found; }
function rem(room,item){ const i=room.state.tableItems.indexOf(item); if(i!==-1) room.state.tableItems.splice(i,1); }
function assemble(room){ for(const r of recipes){ if(r.name.includes("Pizza")) continue; if(r.needs.every(n=>room.state.tableItems.includes(n))){ r.needs.forEach(n=>rem(room,n)); room.state.assembled=r.name; return; }}}
function deliver(room,p){ if(!p.holding||!room.state.currentOrder) return; const o=room.state.currentOrder.name; const ok=p.holding===o || (o.includes("Batata")&&p.holding==="batata_frita") || (o.includes("Pizza")&&p.holding==="pizza_assada"); if(ok){room.state.score+=room.state.currentOrder.points+Math.floor((room.state.orderPatience/room.state.orderMaxPatience)*50);}else{room.state.score=Math.max(0,room.state.score-80);} p.holding=null; room.state.stars=stars(room.state.score); newOrder(room);}
function interact(room,p){ if(!room.state.started||room.state.ended||p.cooldown>0) return; p.cooldown=10; const s=nearest(p); if(!s) return;
 if(s.type==="ingredient"){ if(!p.holding) p.holding=s.item; return; }
 if(s.type==="cook"){ if(p.holding===s.accepts){room.state.cooking.push({result:s.result,remaining:s.time}); p.holding=null;} return; }
 if(s.type==="oven"){ if(["massa","molho","queijo"].every(x=>room.state.tableItems.includes(x))){["massa","molho","queijo"].forEach(x=>rem(room,x)); room.state.cooking.push({result:"pizza_assada",remaining:s.time});} return; }
 if(s.type==="assembly"){ if(p.holding){room.state.tableItems.push(p.holding); p.holding=null;} else if(room.state.assembled){p.holding=room.state.assembled; room.state.assembled=null;} else assemble(room); return; }
 if(s.type==="delivery") deliver(room,p);
}
function publicState(room){ return {code:room.code,maxPlayers:MAX_PLAYERS,stations,players:[...room.players.values()].map(p=>({id:p.id,number:p.number,x:p.x,y:p.y,size:p.size,avatar:p.avatar,holding:p.holding,name:p.name})),state:room.state}; }
function update(room,dt){ if(!room.state.started||room.state.ended) return; room.state.timeLeft-=dt; room.state.orderPatience-=dt; if(room.state.orderPatience<=0){room.state.score=Math.max(0,room.state.score-100); newOrder(room);}
 for(const p of room.players.values()){ if(p.cooldown>0) p.cooldown--; const i=p.input||{}; if(i.up)p.y-=p.speed; if(i.down)p.y+=p.speed; if(i.left)p.x-=p.speed; if(i.right)p.x+=p.speed; p.x=Math.max(10,Math.min(948,p.x)); p.y=Math.max(10,Math.min(568,p.y)); }
 room.state.cooking.forEach(c=>c.remaining-=dt); const done=room.state.cooking.filter(c=>c.remaining<=0); room.state.cooking=room.state.cooking.filter(c=>c.remaining>0); done.forEach(c=>room.state.tableItems.push(c.result));
 room.state.stars=stars(room.state.score); if(room.state.timeLeft<=0){room.state.timeLeft=0; room.state.ended=true; room.state.started=false; broadcast(room,{type:"ended",score:room.state.score,stars:room.state.stars});}
}
function loop(room){ if(room.interval) return; room.last=Date.now(); room.interval=setInterval(()=>{const now=Date.now(); const dt=Math.min((now-room.last)/1000,.1); room.last=now; update(room,dt); broadcast(room,{type:"state",payload:publicState(room)});},1000/30);}
function add(room,ws,data){ if(room.players.size>=MAX_PLAYERS) return send(ws,{type:"error",message:"Sala cheia."}); const n=room.players.size+1; const sp=[{x:405,y:280},{x:510,y:280},{x:615,y:280}][n-1]; const p={id:id(),number:n,ws,x:sp.x,y:sp.y,size:48,speed:3.4,avatar:data.avatar||"ruiva",name:data.name||`Jogador ${n}`,holding:null,input:{},cooldown:0}; room.players.set(p.id,p); ws.playerId=p.id; ws.roomCode=room.code; send(ws,{type:"joined",roomCode:room.code,playerId:p.id,playerNumber:n,payload:publicState(room)}); broadcast(room,{type:"state",payload:publicState(room)}); loop(room); }

wss.on("connection", ws=>{
 send(ws,{type:"hello"});
 ws.on("message", raw=>{
  let data; try{data=JSON.parse(raw)}catch{return}
  if(data.type==="createRoom") return add(createRoom(),ws,data);
  if(data.type==="joinRoom"){ const room=rooms.get(String(data.roomCode||"").trim()); if(!room) return send(ws,{type:"error",message:"Sala não encontrada."}); return add(room,ws,data); }
  const room=rooms.get(ws.roomCode); const p=room&&room.players.get(ws.playerId); if(!room||!p) return;
  if(data.type==="startGame"){ room.state=state(); newOrder(room); room.state.started=true; for(const pl of room.players.values()){pl.holding=null; pl.x=[405,510,615][pl.number-1]||510; pl.y=280;} return broadcast(room,{type:"started",payload:publicState(room)}); }
  if(data.type==="input") return p.input=data.input||{};
  if(data.type==="interact") return interact(room,p);
  if(data.type==="setAvatar"){p.avatar=data.avatar||p.avatar; return broadcast(room,{type:"state",payload:publicState(room)});}
 });
 ws.on("close",()=>{ const room=rooms.get(ws.roomCode); if(!room) return; room.players.delete(ws.playerId); if(room.players.size===0){clearInterval(room.interval); rooms.delete(room.code);} else broadcast(room,{type:"state",payload:publicState(room)}); });
});
server.listen(PORT,()=>console.log(`Rush Kitchen rodando na porta ${PORT}`));
