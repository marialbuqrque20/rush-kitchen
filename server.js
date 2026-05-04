
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_PLAYERS = 3;
const TICK_RATE = 30;

const server = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC_DIR, req.url === "/" ? "index.html" : req.url);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".html" ? "text/html; charset=utf-8" :
               ext === ".css" ? "text/css; charset=utf-8" :
               ext === ".js" ? "application/javascript; charset=utf-8" :
               "text/plain; charset=utf-8";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, {"Content-Type": type});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

const stations = [
  { id: "bread", name: "Pão", emoji: "🍞", x: 60, y: 90, w: 130, h: 90, type: "ingredient", item: "pao" },
  { id: "meat", name: "Carne", emoji: "🥩", x: 210, y: 90, w: 130, h: 90, type: "ingredient", item: "carne_crua" },
  { id: "cheese", name: "Queijo", emoji: "🧀", x: 360, y: 90, w: 130, h: 90, type: "ingredient", item: "queijo" },
  { id: "potato", name: "Batata", emoji: "🥔", x: 510, y: 90, w: 130, h: 90, type: "ingredient", item: "batata_crua" },
  { id: "dough", name: "Massa", emoji: "🥟", x: 660, y: 90, w: 130, h: 90, type: "ingredient", item: "massa" },
  { id: "sauce", name: "Molho", emoji: "🍅", x: 810, y: 90, w: 130, h: 90, type: "ingredient", item: "molho" },
  { id: "grill", name: "Chapa", emoji: "🔥", x: 70, y: 410, w: 160, h: 120, type: "cook", accepts: "carne_crua", result: "carne_cozida", time: 3 },
  { id: "fryer", name: "Fritadeira", emoji: "🍟", x: 260, y: 410, w: 160, h: 120, type: "cook", accepts: "batata_crua", result: "batata_frita", time: 3 },
  { id: "oven", name: "Forno", emoji: "🍕", x: 450, y: 410, w: 160, h: 120, type: "oven", time: 4 },
  { id: "assembly", name: "Montagem", emoji: "🔪", x: 640, y: 410, w: 160, h: 120, type: "assembly" },
  { id: "delivery", name: "Entrega", emoji: "✅", x: 830, y: 410, w: 130, h: 120, type: "delivery" },
];

const recipes = [
  { name: "🍔 Hambúrguer", needs: ["pao", "carne_cozida"], points: 120 },
  { name: "🧀 Burger queijo", needs: ["pao", "carne_cozida", "queijo"], points: 160 },
  { name: "🍟 Batata frita", needs: ["batata_frita"], points: 100 },
  { name: "🍕 Pizza", needs: ["pizza_assada"], points: 170 },
];

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room, data) {
  for (const p of room.players.values()) send(p.ws, data);
}
function makeCode() {
  let code;
  do code = Math.floor(1000 + Math.random() * 9000).toString();
  while (rooms.has(code));
  return code;
}
function makeId() { return Math.random().toString(36).slice(2, 10); }
function createState() {
  return {
    started: false, ended: false, timeLeft: 180, score: 0, stars: 0,
    currentOrder: null, orderPatience: 30, orderMaxPatience: 30,
    tableItems: [], cooking: [], assembled: null
  };
}
function newOrder(room) {
  const order = recipes[Math.floor(Math.random() * recipes.length)];
  room.state.currentOrder = order;
  room.state.orderPatience = 25 + Math.floor(Math.random() * 13);
  room.state.orderMaxPatience = room.state.orderPatience;
}
function createRoom() {
  const room = {code: makeCode(), players: new Map(), state: createState(), interval: null, lastTick: Date.now()};
  rooms.set(room.code, room);
  newOrder(room);
  return room;
}
function starsFromScore(score) {
  if (score >= 1200) return 5;
  if (score >= 900) return 4;
  if (score >= 650) return 3;
  if (score >= 350) return 2;
  if (score >= 120) return 1;
  return 0;
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.size > b.x && a.y < b.y + b.h && a.y + a.size > b.y;
}
function nearestStation(player) {
  let found = null;
  for (const st of stations) if (rectsOverlap(player, st)) found = st;
  return found;
}
function removeTableItem(room, item) {
  const idx = room.state.tableItems.indexOf(item);
  if (idx !== -1) room.state.tableItems.splice(idx, 1);
}
function tryAssemble(room) {
  for (const recipe of recipes) {
    if (recipe.name.includes("Pizza")) continue;
    if (recipe.needs.every(n => room.state.tableItems.includes(n))) {
      recipe.needs.forEach(item => removeTableItem(room, item));
      room.state.assembled = recipe.name;
      return;
    }
  }
}
function deliver(room, player) {
  if (!player.holding || !room.state.currentOrder) return;
  const delivered = player.holding;
  const order = room.state.currentOrder.name;
  const correct = delivered === order ||
    (order.includes("Batata") && delivered === "batata_frita") ||
    (order.includes("Pizza") && delivered === "pizza_assada");
  if (correct) {
    const bonus = Math.floor((room.state.orderPatience / room.state.orderMaxPatience) * 50);
    room.state.score += room.state.currentOrder.points + bonus;
  } else {
    room.state.score = Math.max(0, room.state.score - 80);
  }
  player.holding = null;
  room.state.stars = starsFromScore(room.state.score);
  newOrder(room);
}
function interact(room, player) {
  if (!room.state.started || room.state.ended || player.cooldown > 0) return;
  player.cooldown = 10;
  const st = nearestStation(player);
  if (!st) return;
  if (st.type === "ingredient") {
    if (!player.holding) player.holding = st.item;
    return;
  }
  if (st.type === "cook") {
    if (player.holding === st.accepts) {
      room.state.cooking.push({stationId: st.id, result: st.result, remaining: st.time});
      player.holding = null;
    }
    return;
  }
  if (st.type === "oven") {
    if (room.state.tableItems.includes("massa") && room.state.tableItems.includes("molho") && room.state.tableItems.includes("queijo")) {
      removeTableItem(room, "massa"); removeTableItem(room, "molho"); removeTableItem(room, "queijo");
      room.state.cooking.push({stationId: "oven", result: "pizza_assada", remaining: st.time});
    }
    return;
  }
  if (st.type === "assembly") {
    if (player.holding) {
      room.state.tableItems.push(player.holding);
      player.holding = null;
    } else if (room.state.assembled) {
      player.holding = room.state.assembled;
      room.state.assembled = null;
    } else {
      tryAssemble(room);
    }
    return;
  }
  if (st.type === "delivery") deliver(room, player);
}
function publicState(room) {
  return {
    code: room.code, maxPlayers: MAX_PLAYERS, stations,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, number: p.number, x: p.x, y: p.y, size: p.size,
      avatar: p.avatar, holding: p.holding, name: p.name
    })),
    state: room.state
  };
}
function updateRoom(room, dt) {
  if (!room.state.started || room.state.ended) return;
  room.state.timeLeft -= dt;
  room.state.orderPatience -= dt;
  if (room.state.orderPatience <= 0) {
    room.state.score = Math.max(0, room.state.score - 100);
    room.state.stars = starsFromScore(room.state.score);
    newOrder(room);
  }
  for (const p of room.players.values()) {
    if (p.cooldown > 0) p.cooldown--;
    const i = p.input || {};
    if (i.up) p.y -= p.speed;
    if (i.down) p.y += p.speed;
    if (i.left) p.x -= p.speed;
    if (i.right) p.x += p.speed;
    p.x = Math.max(10, Math.min(1000 - p.size - 10, p.x));
    p.y = Math.max(10, Math.min(620 - p.size - 10, p.y));
  }
  room.state.cooking.forEach(c => c.remaining -= dt);
  const done = room.state.cooking.filter(c => c.remaining <= 0);
  room.state.cooking = room.state.cooking.filter(c => c.remaining > 0);
  done.forEach(c => room.state.tableItems.push(c.result));
  room.state.stars = starsFromScore(room.state.score);
  if (room.state.timeLeft <= 0) {
    room.state.timeLeft = 0; room.state.ended = true; room.state.started = false;
    broadcast(room, {type: "ended", score: room.state.score, stars: room.state.stars});
  }
}
function startLoop(room) {
  if (room.interval) return;
  room.lastTick = Date.now();
  room.interval = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - room.lastTick) / 1000, 0.1);
    room.lastTick = now;
    updateRoom(room, dt);
    broadcast(room, {type: "state", payload: publicState(room)});
  }, 1000 / TICK_RATE);
}
function addPlayer(room, ws, data) {
  if (room.players.size >= MAX_PLAYERS) return send(ws, {type: "error", message: "Sala cheia."});
  const id = makeId();
  const number = room.players.size + 1;
  const spawn = [{x:405,y:280},{x:510,y:280},{x:615,y:280}][number - 1];
  const player = {
    id, number, ws, x: spawn.x, y: spawn.y, size: 42, speed: 3.4,
    avatar: data.avatar || "ruiva", name: data.name || `Jogador ${number}`,
    holding: null, input: {}, cooldown: 0
  };
  room.players.set(id, player);
  ws.playerId = id; ws.roomCode = room.code;
  send(ws, {type: "joined", roomCode: room.code, playerId: id, playerNumber: number, payload: publicState(room)});
  broadcast(room, {type: "state", payload: publicState(room)});
  startLoop(room);
}
wss.on("connection", ws => {
  send(ws, {type: "hello"});
  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data.type === "createRoom") return addPlayer(createRoom(), ws, data);
    if (data.type === "joinRoom") {
      const room = rooms.get(String(data.roomCode || "").trim());
      if (!room) return send(ws, {type: "error", message: "Sala não encontrada."});
      return addPlayer(room, ws, data);
    }
    const room = rooms.get(ws.roomCode);
    const player = room && room.players.get(ws.playerId);
    if (!room || !player) return;
    if (data.type === "startGame") {
      room.state = createState();
      newOrder(room);
      room.state.started = true;
      for (const p of room.players.values()) {
        p.holding = null; p.x = [405,510,615][p.number-1] || 510; p.y = 280;
      }
      return broadcast(room, {type: "started", payload: publicState(room)});
    }
    if (data.type === "input") return player.input = data.input || {};
    if (data.type === "interact") return interact(room, player);
    if (data.type === "setAvatar") {
      player.avatar = data.avatar || player.avatar;
      return broadcast(room, {type: "state", payload: publicState(room)});
    }
  });
  ws.on("close", () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    room.players.delete(ws.playerId);
    if (room.players.size === 0) {
      clearInterval(room.interval); rooms.delete(room.code);
    } else {
      broadcast(room, {type: "state", payload: publicState(room)});
    }
  });
});
server.listen(PORT, () => console.log(`Rush Kitchen Mobile rodando na porta ${PORT}`));
