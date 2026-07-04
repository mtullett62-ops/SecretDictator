const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const game = new Game();

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  emitAll();

  socket.on('joinGame', (name, reply) => handle(socket, reply, () => game.addPlayer(socket.id, name)));
  socket.on('leaveGame', (_payload, reply) => handle(socket, reply, () => game.removePlayer(socket.id)));
  socket.on('startGame', (_payload, reply) => handle(socket, reply, () => game.startGame()));
  socket.on('nominateChancellor', (playerId, reply) => handle(socket, reply, () => game.nominateChancellor(socket.id, playerId)));
  socket.on('castVote', (vote, reply) => handle(socket, reply, () => game.castVote(socket.id, vote)));
  socket.on('presidentDiscard', (index, reply) => handle(socket, reply, () => game.presidentDiscard(socket.id, index)));
  socket.on('chancellorChoice', (payload, reply) => handle(socket, reply, () => game.chancellorChoose(socket.id, payload)));
  socket.on('vetoResponse', (accept, reply) => handle(socket, reply, () => game.respondToVeto(socket.id, Boolean(accept))));
  socket.on('executiveAction', (targetId, reply) => handle(socket, reply, () => game.completeExecutiveAction(socket.id, targetId)));
  socket.on('acknowledgePolicyPeek', (_payload, reply) => handle(socket, reply, () => game.acknowledgePolicyPeek(socket.id)));

  socket.on('disconnect', () => {
    try {
      game.removePlayer(socket.id);
    } finally {
      emitAll();
    }
  });
});

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
});
