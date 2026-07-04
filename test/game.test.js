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

test('disconnect keeps a player during the grace period and reconnects by name', () => {
  const game = makeGame(5);
  game.startGame();
  const player = game.players[0];

  const disconnected = game.disconnectPlayer(player.socketId);
  assert.equal(disconnected.id, player.id);
  assert.equal(game.players.length, 5);
  assert.equal(game.getPlayer(player.id).connected, false);

  const reconnected = game.addPlayer('fresh-socket', player.name);
  assert.equal(reconnected.id, player.id);
  assert.equal(reconnected.socketId, 'fresh-socket');
  assert.equal(reconnected.connected, true);
  assert.equal(reconnected.disconnectedAt, null);
});

test('expired disconnected players are removed from the player list', () => {
  const game = makeGame(5);
  const player = game.players[0];

  game.disconnectPlayer(player.socketId);

  assert.equal(game.expireDisconnectedPlayer(player.id), true);
  assert.equal(game.players.some((candidate) => candidate.id === player.id), false);
});

test('mark can manually remove players', () => {
  const game = new Game();
  game.addPlayer('mark-socket', 'mark');
  game.addPlayer('other-socket', 'Other');
  const other = game.findPlayerBySocket('other-socket');

  game.removePlayerFrom('mark-socket', other.id);

  assert.equal(game.players.some((candidate) => candidate.id === other.id), false);
});

test('only mark can manually remove players', () => {
  const game = new Game();
  game.addPlayer('mark-socket', 'mark');
  game.addPlayer('other-socket', 'Other');
  const mark = game.findPlayerBySocket('mark-socket');

  assert.throws(() => game.removePlayerFrom('other-socket', mark.id), /Only mark/);
});

test('mark can assign table seats and public state exposes table order', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');
  const bob = game.addPlayer('bob-socket', 'Bob');

  game.setPlayerSeatFrom(mark.socketId, bob.id, '0');
  game.setPlayerSeatFrom(mark.socketId, alice.id, 1);

  const publicState = game.publicState();
  const publicBob = publicState.players.find((player) => player.id === bob.id);
  const publicAlice = publicState.players.find((player) => player.id === alice.id);
  assert.equal(publicBob.tableSeat, 0);
  assert.equal(publicAlice.tableSeat, 1);
  assert.deepEqual(publicState.tableOrderIds.slice(0, 2), [bob.id, alice.id]);
});

test('only mark can assign table seats', () => {
  const game = new Game();
  game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');

  assert.throws(() => game.setPlayerSeatFrom(alice.socketId, alice.id, 0), /Only mark/);
});

test('table seats must be unique', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');
  const bob = game.addPlayer('bob-socket', 'Bob');

  game.setPlayerSeatFrom(mark.socketId, alice.id, 0);

  assert.throws(() => game.setPlayerSeatFrom(mark.socketId, bob.id, 0), /already taken/);
});

test('initial president starts randomly and then rotation follows table order', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');
  const bob = game.addPlayer('bob-socket', 'Bob');
  const carol = game.addPlayer('carol-socket', 'Carol');
  const dave = game.addPlayer('dave-socket', 'Dave');

  game.setPlayerSeatFrom(mark.socketId, bob.id, 0);
  game.setPlayerSeatFrom(mark.socketId, dave.id, 1);
  game.setPlayerSeatFrom(mark.socketId, alice.id, 2);
  game.setPlayerSeatFrom(mark.socketId, carol.id, 3);
  game.setPlayerSeatFrom(mark.socketId, mark.id, 4);
  game.randomInitialPresidentIndex = () => 2;
  game.startGame();

  assert.equal(game.currentPresidentId, alice.id);
  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(alice.socketId, nominee.id);
  for (const player of game.livingPlayers()) {
    game.castVote(player.socketId, 'nein');
  }

  assert.equal(game.currentPresidentId, carol.id);
});

test('starting with table order requires every player to be seated', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');
  game.addPlayer('bob-socket', 'Bob');
  game.addPlayer('carol-socket', 'Carol');
  game.addPlayer('dave-socket', 'Dave');

  game.setPlayerSeatFrom(mark.socketId, alice.id, 0);

  assert.throws(() => game.startGame(), /Seat every player/);
});

test('mark can set the full table order in one update', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');
  const bob = game.addPlayer('bob-socket', 'Bob');
  const carol = game.addPlayer('carol-socket', 'Carol');
  const dave = game.addPlayer('dave-socket', 'Dave');

  game.setTableOrderFrom(mark.socketId, [carol.id, alice.id, mark.id, dave.id, bob.id]);

  assert.deepEqual(game.publicState().tableOrderIds, [carol.id, alice.id, mark.id, dave.id, bob.id]);
  assert.deepEqual(
    [carol, alice, mark, dave, bob].map((player) => game.getPlayer(player.id).tableSeat),
    [0, 1, 2, 3, 4]
  );
});

test('only mark can set the full table order', () => {
  const game = new Game();
  game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');

  assert.throws(() => game.setTableOrderFrom(alice.socketId, game.players.map((player) => player.id)), /Only mark/);
});

test('table order update must include every player exactly once', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');
  const bob = game.addPlayer('bob-socket', 'Bob');

  assert.throws(() => game.setTableOrderFrom(mark.socketId, [mark.id, alice.id]), /include every player/);
  assert.throws(() => game.setTableOrderFrom(mark.socketId, [mark.id, alice.id, alice.id]), /duplicate/);
  assert.throws(() => game.setTableOrderFrom(mark.socketId, [mark.id, alice.id, 'missing-player']), /Unknown player/);
  assert.deepEqual(
    [mark, alice, bob].map((player) => game.getPlayer(player.id).tableSeat),
    [null, null, null]
  );
});

test('voting resolves once a non-president voter times out mid-vote', () => {
  const game = makeGame(5);
  game.startGame();
  const president = game.getPlayer(game.currentPresidentId);
  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(president.socketId, nominee.id);
  assert.equal(game.phase, 'voting');

  const [holdout, ...voters] = game.players.filter(
    (player) => player.id !== president.id && player.id !== nominee.id
  );
  for (const voter of voters) game.castVote(voter.socketId, 'ja');
  game.castVote(president.socketId, 'ja');
  game.castVote(nominee.socketId, 'ja');
  assert.equal(game.phase, 'voting');

  game.disconnectPlayer(holdout.socketId);
  assert.equal(game.expireDisconnectedPlayer(holdout.id), true);

  assert.notEqual(game.phase, 'voting');
  assert.equal(game.lastVoteResult.passed, true);
});

test('startGame requires every lobby player to be connected', () => {
  const game = makeGame(5);
  const player = game.players[0];
  game.disconnectPlayer(player.socketId);

  assert.throws(() => game.startGame(), /All players must be connected/);
});

test('resetGameFrom preserves a disconnected player\'s connection state', () => {
  const game = new Game();
  game.addPlayer('mark-socket', 'mark');
  for (let index = 0; index < 4; index += 1) {
    game.addPlayer(`socket-${index}`, `Player ${index + 1}`);
  }
  game.startGame();
  const other = game.players.find((player) => player.name === 'Player 1');
  game.disconnectPlayer(other.socketId);

  game.resetGameFrom('mark-socket');

  assert.equal(game.getPlayer(other.id).connected, false);
  assert.notEqual(game.getPlayer(other.id).disconnectedAt, null);
});

test('excludes disconnected players from eligible chancellor nominees', () => {
  const game = makeGame(5);
  game.startGame();
  const candidates = game.getEligibleChancellors();
  const target = candidates[0];
  game.disconnectPlayer(target.socketId);

  const eligible = game.getEligibleChancellors().map((player) => player.id);
  assert.equal(eligible.includes(target.id), false);
  assert.equal(eligible.length, candidates.length - 1);
});

test('executive actions cannot target disconnected players', () => {
  const game = makeGame(5);
  game.startGame();
  game.pendingPower = 'execution';
  game.phase = 'executive_action';
  const president = game.getPlayer(game.currentPresidentId);
  const target = game.players.find((player) => player.id !== president.id);
  game.disconnectPlayer(target.socketId);

  assert.throws(() => game.completeExecutiveAction(president.socketId, target.id), /valid living target/);
});

function tally(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}
