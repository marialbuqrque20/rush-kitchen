const express = require('express');
const path = require('path');
const WebSocket = require('ws');

const app = express();

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando");
});

const wss = new WebSocket.Server({ server });

let salas = {};

wss.on('connection', (ws) => {
  let salaAtual = null;

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    if (data.tipo === 'criar') {
      const codigo = Math.floor(1000 + Math.random() * 9000).toString();
      salas[codigo] = [ws];
      salaAtual = codigo;

      ws.send(JSON.stringify({ tipo: 'sala_criada', codigo }));
    }

    if (data.tipo === 'entrar') {
      if (salas[data.codigo]) {
        salas[data.codigo].push(ws);
        salaAtual = data.codigo;

        ws.send(JSON.stringify({ tipo: 'entrou', codigo: data.codigo }));
      }
    }
  });

  ws.on('close', () => {
    if (salaAtual && salas[salaAtual]) {
      salas[salaAtual] = salas[salaAtual].filter(s => s !== ws);
    }
  });
});
