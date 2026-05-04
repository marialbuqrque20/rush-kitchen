const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const screens = {
  menu: document.getElementById("menu"),
  lobby: document.getElementById("lobby"),
  game: document.getElementById("game"),
  end: document.getElementById("end")
};

const avatarEmoji = { chef: "👨‍🍳", pirata: "🏴‍☠️", palhaco: "🤡", ruiva: "👩‍🦰" };
let ws = null, roomCode = null, myPlayerId = null, latest = null;
const input = { up: false, down: false, left: false, right: false };

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
  if (name === "game") {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}
function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function connect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}`);
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("Não foi possível conectar."));
    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.type === "error") {
        document.getElementById("status").textContent = msg.message;
        return;
      }
      if (msg.type === "joined") {
        roomCode = msg.roomCode; myPlayerId = msg.playerId; latest = msg.payload;
        document.getElementById("roomCodeLabel").textContent = roomCode;
        renderLobby(); showScreen("lobby"); return;
      }
      if (msg.type === "state") {
        latest = msg.payload;
        if (screens.lobby.classList.contains("active")) renderLobby();
        return;
      }
      if (msg.type === "started") {
        latest = msg.payload; showScreen("game"); requestAnimationFrame(draw); return;
      }
      if (msg.type === "ended") {
        document.getElementById("finalStars").textContent = "⭐".repeat(msg.stars) + ` (${msg.stars}/5)`;
        document.getElementById("finalScore").textContent = `Pontuação final: ${msg.score}`;
        showScreen("end"); return;
      }
    };
  });
}
function getAvatar() { return document.getElementById("avatar").value; }
function getName() { return document.getElementById("playerName").value.trim() || "Chef"; }

document.getElementById("createBtn").addEventListener("click", async () => {
  document.getElementById("status").textContent = "Criando sala...";
  await connect();
  send({type: "createRoom", avatar: getAvatar(), name: getName()});
});
document.getElementById("joinBtn").addEventListener("click", async () => {
  const code = document.getElementById("roomInput").value.trim();
  if (!code) return document.getElementById("status").textContent = "Digite o código da sala.";
  document.getElementById("status").textContent = "Entrando...";
  await connect();
  send({type: "joinRoom", roomCode: code, avatar: getAvatar(), name: getName()});
});
document.getElementById("startBtn").addEventListener("click", () => send({type: "startGame"}));
document.getElementById("backBtn").addEventListener("click", () => location.reload());
document.getElementById("againBtn").addEventListener("click", () => { showScreen("lobby"); renderLobby(); });
document.getElementById("avatar").addEventListener("change", () => send({type:"setAvatar", avatar:getAvatar()}));
document.getElementById("recipesToggle").addEventListener("click", () => {
  document.getElementById("recipeBox").classList.toggle("open");
});

function renderLobby() {
  if (!latest) return;
  const div = document.getElementById("playersList");
  div.innerHTML = "";
  latest.players.forEach(p => {
    const card = document.createElement("div");
    card.className = "player-card";
    card.textContent = `${avatarEmoji[p.avatar] || "👤"} P${p.number} - ${p.name}`;
    div.appendChild(card);
  });
}
function itemLabel(item) {
  const labels = {
    pao:"🍞 pão", carne_crua:"🥩 carne", carne_cozida:"🍖 carne ok",
    queijo:"🧀 queijo", batata_crua:"🥔 batata", batata_frita:"🍟 batata",
    massa:"🥟 massa", molho:"🍅 molho", pizza_assada:"🍕 pizza"
  };
  return labels[item] || item;
}
function updateHud() {
  if (!latest) return;
  const s = latest.state;
  document.getElementById("time").textContent = Math.max(0, Math.ceil(s.timeLeft));
  document.getElementById("score").textContent = s.score;
  document.getElementById("stars").textContent = s.stars;
  document.getElementById("orderName").textContent = s.currentOrder ? s.currentOrder.name : "---";
}
function drawStation(st) {
  ctx.fillStyle = "#7b4b25"; ctx.fillRect(st.x, st.y, st.w, st.h);
  ctx.strokeStyle = "#3b220f"; ctx.lineWidth = 4; ctx.strokeRect(st.x, st.y, st.w, st.h);
  ctx.font = "30px Arial"; ctx.fillText(st.emoji, st.x + 14, st.y + 42);
  ctx.font = "17px Arial"; ctx.fillStyle = "#fff4d8"; ctx.fillText(st.name, st.x + 14, st.y + 74);
}
function drawPlayer(p) {
  ctx.font = "34px Arial"; ctx.fillText(avatarEmoji[p.avatar] || "👤", p.x + 2, p.y + 34);
  ctx.fillStyle = p.id === myPlayerId ? "#ffffff" : "#222222";
  ctx.font = "14px Arial"; ctx.fillText(`P${p.number}`, p.x + 8, p.y - 6);
  if (p.holding) {
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#3b220f"; ctx.lineWidth = 2;
    ctx.fillRect(p.x - 18, p.y - 35, 118, 24); ctx.strokeRect(p.x - 18, p.y - 35, 118, 24);
    ctx.fillStyle = "#2b1a08"; ctx.font = "13px Arial"; ctx.fillText(itemLabel(p.holding), p.x - 12, p.y - 18);
  }
}
function drawOrderBar(s) {
  const barW = 310, pct = Math.max(0, s.orderPatience / s.orderMaxPatience);
  ctx.fillStyle = "#3b220f"; ctx.fillRect(345, 18, barW, 20);
  ctx.fillStyle = "#48d169"; ctx.fillRect(345, 18, barW * pct, 20);
  ctx.strokeStyle = "#fff"; ctx.strokeRect(345, 18, barW, 20);
  ctx.fillStyle = "#fff"; ctx.font = "18px Arial"; ctx.fillText("Paciência do cliente", 420, 62);
}
function drawCookingTimers(s) {
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(28, 200, 270, 90);
  ctx.fillStyle = "#fff"; ctx.font = "17px Arial"; ctx.fillText("Cozinhando:", 45, 226);
  s.cooking.slice(0,3).forEach((c, i) => ctx.fillText(`${itemLabel(c.result)} - ${Math.ceil(c.remaining)}s`, 45, 252 + i * 22));
}
function drawTableItems(s) {
  ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillRect(640, 545, 320, 55);
  ctx.fillStyle = "#2b1a08"; ctx.font = "15px Arial";
  ctx.fillText("Bancada: " + (s.tableItems.map(itemLabel).join(", ") || "vazio"), 652, 570);
  ctx.fillText("Montado: " + (s.assembled || "nenhum"), 652, 592);
}
function draw() {
  if (!latest || !screens.game.classList.contains("active")) return;
  updateHud();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = "#f0bc73"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(35,210,930,175);
  latest.stations.forEach(drawStation);
  drawOrderBar(latest.state); drawCookingTimers(latest.state); drawTableItems(latest.state);
  latest.players.forEach(drawPlayer);
  requestAnimationFrame(draw);
}
function pushInput() { send({type:"input", input}); }
setInterval(pushInput, 50);

function setDir(dir, value) {
  if (dir === "up") input.up = value;
  if (dir === "down") input.down = value;
  if (dir === "left") input.left = value;
  if (dir === "right") input.right = value;
}
document.querySelectorAll("[data-dir]").forEach(btn => {
  const dir = btn.dataset.dir;
  const start = e => { e.preventDefault(); btn.classList.add("touch-active"); setDir(dir, true); };
  const end = e => { e.preventDefault(); btn.classList.remove("touch-active"); setDir(dir, false); };
  btn.addEventListener("touchstart", start, {passive:false});
  btn.addEventListener("touchend", end, {passive:false});
  btn.addEventListener("touchcancel", end, {passive:false});
  btn.addEventListener("mousedown", start);
  btn.addEventListener("mouseup", end);
  btn.addEventListener("mouseleave", end);
});
const actionBtn = document.getElementById("actionBtn");
["touchstart", "mousedown"].forEach(ev => actionBtn.addEventListener(ev, e => {
  e.preventDefault(); actionBtn.classList.add("touch-active"); send({type:"interact"});
}, {passive:false}));
["touchend", "touchcancel", "mouseup", "mouseleave"].forEach(ev => actionBtn.addEventListener(ev, e => {
  e.preventDefault(); actionBtn.classList.remove("touch-active");
}, {passive:false}));

window.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if (k === "w" || e.key === "ArrowUp") input.up = true;
  if (k === "s" || e.key === "ArrowDown") input.down = true;
  if (k === "a" || e.key === "ArrowLeft") input.left = true;
  if (k === "d" || e.key === "ArrowRight") input.right = true;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); send({type:"interact"}); }
});
window.addEventListener("keyup", e => {
  const k = e.key.toLowerCase();
  if (k === "w" || e.key === "ArrowUp") input.up = false;
  if (k === "s" || e.key === "ArrowDown") input.down = false;
  if (k === "a" || e.key === "ArrowLeft") input.left = false;
  if (k === "d" || e.key === "ArrowRight") input.right = false;
});
window.addEventListener("touchmove", e => {
  if (screens.game.classList.contains("active")) e.preventDefault();
}, {passive:false});
