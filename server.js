const path = require('path');
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { Game } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const game = new Game();
const DISCONNECT_GRACE_MS = 60000;
const disconnectTimers = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.sendStatus(200));

io.on('connection', (socket) => {
  emitAll();

  socket.on('joinGame', (name, reply) => handle(socket, reply, () => {
    const player = game.addPlayer(socket.id, name);
    clearDisconnectTimer(player.id);
  }));
  socket.on('leaveGame', (_payload, reply) => handle(socket, reply, () => {
    const player = game.findPlayerBySocket(socket.id);
    game.removePlayer(socket.id);
    if (player) clearDisconnectTimer(player.id);
  }));
  socket.on('removePlayer', (playerId, reply) => handle(socket, reply, () => {
    game.removePlayerFrom(socket.id, playerId);
    clearDisconnectTimer(playerId);
  }));
  socket.on('setPlayerSeat', (payload, reply) => handle(socket, reply, () => {
    game.setPlayerSeatFrom(socket.id, payload && payload.playerId, payload && payload.tableSeat);
  }));
  socket.on('setTableOrder', (payload, reply) => handle(socket, reply, () => {
    game.setTableOrderFrom(socket.id, payload && payload.playerIds);
  }));
  socket.on('startGame', (_payload, reply) => handle(socket, reply, () => game.startGame()));
  socket.on('resetGame', (_payload, reply) => handle(socket, reply, () => game.resetGameFrom(socket.id)));
  socket.on('nominateChancellor', (playerId, reply) => handle(socket, reply, () => game.nominateChancellor(socket.id, playerId)));
  socket.on('castVote', (vote, reply) => handle(socket, reply, () => game.castVote(socket.id, vote)));
  socket.on('presidentDiscard', (index, reply) => handle(socket, reply, () => game.presidentDiscard(socket.id, index)));
  socket.on('chancellorChoice', (payload, reply) => handle(socket, reply, () => game.chancellorChoose(socket.id, payload)));
  socket.on('vetoResponse', (accept, reply) => handle(socket, reply, () => game.respondToVeto(socket.id, Boolean(accept))));
  socket.on('executiveAction', (targetId, reply) => handle(socket, reply, () => game.completeExecutiveAction(socket.id, targetId)));
  socket.on('acknowledgePolicyPeek', (_payload, reply) => handle(socket, reply, () => game.acknowledgePolicyPeek(socket.id)));

  socket.on('disconnect', () => {
    try {
      const player = game.disconnectPlayer(socket.id);
      if (player) scheduleDisconnectExpiry(player.id);
    } finally {
      emitAll();
    }
  });
});

function scheduleDisconnectExpiry(playerId) {
  clearDisconnectTimer(playerId);
  const timer = setTimeout(() => {
    disconnectTimers.delete(playerId);
    if (game.expireDisconnectedPlayer(playerId)) emitAll();
  }, DISCONNECT_GRACE_MS);
  disconnectTimers.set(playerId, timer);
}

function clearDisconnectTimer(playerId) {
  const timer = disconnectTimers.get(playerId);
  if (!timer) return;
  clearTimeout(timer);
  disconnectTimers.delete(playerId);
}

function handle(socket, reply, action) {
  try {
    action();
    if (typeof reply === 'function') reply({ ok: true });
  } catch (error) {
    socket.emit('errorMessage', error.message);
    if (typeof reply === 'function') reply({ ok: false, error: error.message });
  } finally {
    emitAll();
  }
}

function emitAll() {
  const publicState = game.publicState();
  io.emit('gameState', publicState);
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('privateState', game.privateStateFor(socket.id));
  }
}

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`SecretDictator listening on http://localhost:${port}`);
  startKeepAlive();
});

// Render's free tier spins the service down after a period without an inbound
// HTTP request. Pinging our own public health endpoint keeps it awake.
function startKeepAlive() {
  const target = `${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/health`;
  const client = target.startsWith('https') ? https : http;
  setInterval(() => {
    client.get(target, (res) => res.resume()).on('error', () => {});
  }, 45000);
}
