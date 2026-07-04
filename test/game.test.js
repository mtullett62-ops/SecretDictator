const assert = require('node:assert/strict');
const test = require('node:test');
const { Game, ROLE_COUNTS } = require('../game');

function makeGame(count) {
  const game = new Game();
  for (let index = 0; index < count; index += 1) {
    game.addPlayer(`socket-${index}`, `Player ${index + 1}`);
  }
  return game;
}

test('assigns the official role distribution for each player count', () => {
  for (const count of Object.keys(ROLE_COUNTS).map(Number)) {
    const game = makeGame(count);
    game.startGame();
    const roles = tally(game.players.map((player) => player.role));
    assert.equal(roles.liberal || 0, ROLE_COUNTS[count].liberal);
    assert.equal(roles.fascist || 0, ROLE_COUNTS[count].fascist);
    assert.equal(roles.hitler || 0, ROLE_COUNTS[count].hitler);
  }
});

test('keeps role visibility private for 5 and 6 player games', () => {
  const game = makeGame(5);
  game.startGame();
  const hitler = game.players.find((player) => player.role === 'hitler');
  const fascist = game.players.find((player) => player.role === 'fascist');
  const liberal = game.players.find((player) => player.role === 'liberal');

  assert.deepEqual(game.privateStateFor(hitler.socketId).visibleRoles.map((player) => player.role), ['fascist']);
  assert.deepEqual(game.privateStateFor(fascist.socketId).visibleRoles.map((player) => player.role), ['hitler']);
  assert.deepEqual(game.privateStateFor(liberal.socketId).visibleRoles, []);
});

test('keeps Hitler from seeing fascists in 7 to 10 player games', () => {
  const game = makeGame(7);
  game.startGame();
  const hitler = game.players.find((player) => player.role === 'hitler');
  const fascist = game.players.find((player) => player.role === 'fascist');

  assert.deepEqual(game.privateStateFor(hitler.socketId).visibleRoles, []);
  assert(game.privateStateFor(fascist.socketId).visibleRoles.some((player) => player.role === 'hitler'));
});

test('only the current president can nominate an eligible chancellor', () => {
  const game = makeGame(5);
  game.startGame();
  const president = game.getPlayer(game.currentPresidentId);
  const nominee = game.getEligibleChancellors()[0];
  const nonPresident = game.players.find((player) => player.id !== president.id);

  assert.throws(() => game.nominateChancellor(nonPresident.socketId, nominee.id), /Only the President/);
  game.nominateChancellor(president.socketId, nominee.id);
  assert.equal(game.currentChancellorId, nominee.id);
  assert.equal(game.phase, 'voting');
});

test('passes a government on simple majority and sends policies only to the president', () => {
  const game = makeGame(5);
  game.startGame();
  const president = game.getPlayer(game.currentPresidentId);
  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(president.socketId, nominee.id);

  for (const player of game.livingPlayers()) {
    game.castVote(player.socketId, 'ja');
  }

  assert.equal(game.phase, 'president_legislative');
  assert.equal(game.privateStateFor(president.socketId).presidentPolicies.length, 3);
  const bystander = game.players.find((player) => player.id !== president.id && player.id !== nominee.id);
  assert.equal(game.privateStateFor(bystander.socketId).presidentPolicies, undefined);
});

test('chaos policy enacts top card without triggering an executive action', () => {
  const game = makeGame(7);
  game.startGame();
  game.deck = ['fascist', ...game.deck.filter((policy) => policy !== 'fascist')];

  for (let round = 0; round < 3; round += 1) {
    const president = game.getPlayer(game.currentPresidentId);
    const nominee = game.getEligibleChancellors()[0];
    game.nominateChancellor(president.socketId, nominee.id);
    for (const player of game.livingPlayers()) {
      game.castVote(player.socketId, 'nein');
    }
  }

  assert.equal(game.fascistPolicies, 1);
  assert.equal(game.electionTracker, 0);
  assert.equal(game.pendingPower, null);
  assert.equal(game.phase, 'nomination');
});

function tally(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}
