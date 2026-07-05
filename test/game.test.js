const assert = require('node:assert/strict');
const test = require('node:test');
const { Game, ROLE_COUNTS, SECRET_ROLE_DEFINITIONS, SECRET_ROLE_COUNT_WEIGHTS } = require('../game');

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

test('mark can toggle secret roles in the lobby', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  game.addPlayer('alice-socket', 'Alice');
  const availableRoles = Object.values(SECRET_ROLE_DEFINITIONS);

  assert.deepEqual(game.publicState().secretRoles, {
    enabled: false,
    active: false,
    locked: false,
    availableRoles
  });

  game.setSecretRolesEnabledFrom(mark.socketId, true);

  assert.deepEqual(game.publicState().secretRoles, {
    enabled: true,
    active: false,
    locked: false,
    availableRoles
  });

  game.setSecretRolesEnabledFrom(mark.socketId, { enabled: false });

  assert.equal(game.publicState().secretRoles.enabled, false);
});

test('only mark can toggle secret roles', () => {
  const game = new Game();
  game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');

  assert.throws(() => game.setSecretRolesEnabledFrom(alice.socketId, true), /Only mark/);
});

test('secret roles lock once the game has started', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  for (let index = 0; index < 4; index += 1) {
    game.addPlayer(`socket-${index}`, `Player ${index + 1}`);
  }

  game.setSecretRolesEnabledFrom(mark.socketId, true);
  game.randomSecretRoleCount = () => 1;
  game.randomSample = (items, count) => items.slice(0, count);
  game.startGame();

  assert.equal(game.players.filter((player) => player.secretRole).length, 1);
  assert.deepEqual(game.publicState().secretRoles, {
    enabled: true,
    active: true,
    locked: true,
    availableRoles: Object.values(SECRET_ROLE_DEFINITIONS)
  });
  assert.throws(() => game.setSecretRolesEnabledFrom(mark.socketId, false), /Invalid action/);
  assert.equal(game.publicState().secretRoles.enabled, true);
  assert.equal(game.publicState().secretRoles.active, true);
});

test('secret role count uses the configured weighted chances', () => {
  const game = new Game();
  const rolls = [0, 424, 425, 674, 675, 849, 850, 949, 950, 999];
  const expectedCounts = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  let rollIndex = 0;
  game.randomInt = (max) => {
    assert.equal(max, totalSecretRoleWeight());
    return rolls[rollIndex++];
  };

  assert.deepEqual(
    rolls.map(() => game.randomSecretRoleCount()),
    expectedCounts
  );
});

test('secret roles assign unique power roles to unique players when enabled', () => {
  const game = new Game();
  const players = [
    game.addPlayer('mark-socket', 'mark'),
    game.addPlayer('alice-socket', 'Alice'),
    game.addPlayer('bob-socket', 'Bob'),
    game.addPlayer('carol-socket', 'Carol'),
    game.addPlayer('dave-socket', 'Dave')
  ];
  game.randomInitialPresidentIndex = () => 0;
  game.shuffledRoles = () => ['liberal', 'fascist', 'hitler', 'liberal', 'liberal'];
  game.randomSecretRoleCount = () => 3;
  game.randomSample = (items, count) => items.slice(0, count);

  game.setSecretRolesEnabledFrom(players[0].socketId, true);
  game.startGame();

  const assignedPlayers = game.players.filter((player) => player.secretRole);
  assert.equal(assignedPlayers.length, 3);
  assert.deepEqual(
    assignedPlayers.map((player) => player.secretRole),
    ['policeChief', 'assassin', 'journalist']
  );
  assert.deepEqual(
    assignedPlayers.map((player) => player.party),
    ['liberal', 'fascist', 'fascist']
  );
  assert.deepEqual(assignedPlayers.map((player) => player.secretRoleUsed), [false, false, false]);
  assert.equal(new Set(assignedPlayers.map((player) => player.id)).size, 3);
  assert.equal(new Set(assignedPlayers.map((player) => player.secretRole)).size, 3);
});

test('secret roles are only visible in the assigned player private state', () => {
  const game = makeGame(5);
  game.randomSecretRoleCount = () => 1;
  game.randomSample = (items, count) => items.slice(0, count);
  game.players[0].name = 'mark';
  game.setSecretRolesEnabledFrom('socket-0', true);
  game.startGame();

  const assigned = game.players.find((player) => player.secretRole);
  const unassigned = game.players.find((player) => !player.secretRole);

  assert.equal(game.publicState().players.some((player) => 'secretRole' in player), false);
  assert.equal(game.privateStateFor(assigned.socketId).secretRole, 'policeChief');
  assert.deepEqual(game.privateStateFor(assigned.socketId).secretRoleDetails, SECRET_ROLE_DEFINITIONS.policeChief);
  assert.equal(game.privateStateFor(assigned.socketId).secretRoleUsed, false);
  assert.equal(game.privateStateFor(unassigned.socketId).secretRole, null);
  assert.equal(game.privateStateFor(unassigned.socketId).secretRoleDetails, null);
});

function makeGameWithAllSecretRoles(count) {
  const game = makeGame(count);
  game.secretRolesEnabled = true;
  game.randomSecretRoleCount = () => 6;
  game.randomSample = (items, sampleCount) => items.slice(0, sampleCount);
  return game;
}

test('police chief can arrest a player, blocking them from chancellor nomination', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.randomInitialPresidentIndex = () => 0;
  game.startGame();

  const policeChief = game.players[0];
  const president = game.getPlayer(game.currentPresidentId);
  const target = game.players.find((player) => player.id !== president.id && player.id !== policeChief.id);
  assert.equal(policeChief.secretRole, 'policeChief');

  assert.throws(() => game.useSecretRole('unknown-socket', { targetId: target.id }), /Join the game first/);

  game.useSecretRole(policeChief.socketId, { targetId: target.id });

  assert.equal(game.arrestedPlayerId, target.id);
  assert.equal(policeChief.secretRoleUsed, true);
  assert.equal(game.getEligibleChancellors().some((player) => player.id === target.id), false);
  assert.equal(game.publicState().players.find((player) => player.id === target.id).arrested, true);
  assert.throws(() => game.useSecretRole(policeChief.socketId, { targetId: target.id }), /already used/);
});

test('an arrest clears once the round advances to a new president', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.randomInitialPresidentIndex = () => 0;
  game.startGame();

  const policeChief = game.players[0];
  const president = game.getPlayer(game.currentPresidentId);
  const target = game.players.find((player) => player.id !== president.id && player.id !== policeChief.id);
  game.useSecretRole(policeChief.socketId, { targetId: target.id });

  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(president.socketId, nominee.id);
  for (const player of game.livingPlayers()) game.castVote(player.socketId, 'nein');

  assert.equal(game.phase, 'nomination');
  assert.equal(game.arrestedPlayerId, null);
});

test('police chief cannot arrest the sitting president', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.randomInitialPresidentIndex = () => 1;
  game.startGame();

  const policeChief = game.players[0];
  const president = game.getPlayer(game.currentPresidentId);
  assert.notEqual(policeChief.id, president.id);

  assert.throws(() => game.useSecretRole(policeChief.socketId, { targetId: president.id }), /sitting President/);
  assert.equal(game.privateStateFor(policeChief.socketId).secretRoleTargetIds.includes(president.id), false);
});

test('an arrested player is skipped by normal president rotation', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.randomInitialPresidentIndex = () => 0;
  game.startGame();

  const policeChief = game.players[0];
  const president = game.getPlayer(game.currentPresidentId);
  const nextPresidentInRotation = game.players[1];
  game.useSecretRole(policeChief.socketId, { targetId: nextPresidentInRotation.id });

  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(president.socketId, nominee.id);
  for (const player of game.livingPlayers()) game.castVote(player.socketId, 'nein');

  assert.equal(game.currentPresidentId, game.players[2].id);
  assert.equal(game.currentPresidentId === nextPresidentInRotation.id, false);
  assert.equal(game.arrestedPlayerId, null);
});

test('secret role actions are restricted to their usable phase', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.randomInitialPresidentIndex = () => 0;
  game.startGame();

  const assassin = game.players[1];
  const president = game.getPlayer(game.currentPresidentId);
  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(president.socketId, nominee.id);
  assert.equal(game.phase, 'voting');

  const target = game.players.find((player) => player.id !== assassin.id && player.id !== president.id);
  assert.throws(() => game.useSecretRole(assassin.socketId, { targetId: target.id }), /Invalid action/);
});

test('assassin can eliminate a player, and eliminating Hitler ends the game for liberals', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.shuffledRoles = () => ['liberal', 'liberal', 'liberal', 'liberal', 'fascist', 'hitler'];
  game.randomInitialPresidentIndex = () => 0;
  game.startGame();

  const assassin = game.players[1];
  const hitler = game.players[5];
  assert.equal(assassin.secretRole, 'assassin');
  assert.equal(hitler.role, 'hitler');
  assert.notEqual(game.currentPresidentId, hitler.id);

  game.useSecretRole(assassin.socketId, { targetId: hitler.id });

  assert.equal(hitler.alive, false);
  assert.equal(assassin.secretRoleUsed, true);
  assert.equal(game.winner, 'liberals');
  assert.equal(game.phase, 'game_over');
});

test('assassin cannot target the sitting president', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.randomInitialPresidentIndex = () => 0;
  game.startGame();

  const assassin = game.players[1];
  const president = game.getPlayer(game.currentPresidentId);
  assert.notEqual(president.id, assassin.id);

  assert.throws(() => game.useSecretRole(assassin.socketId, { targetId: president.id }), /sitting President/);
});

test('journalist can reveal a discarded policy from the discard pile', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.startGame();

  const journalist = game.players[2];
  assert.equal(journalist.secretRole, 'journalist');
  assert.throws(() => game.useSecretRole(journalist.socketId, {}), /no discarded policies/i);

  game.discard.push('fascist');
  game.useSecretRole(journalist.socketId, {});

  assert.equal(journalist.secretRoleUsed, true);
  assert.match(game.log[game.log.length - 1].message, /revealed a discarded policy: Fascist/);
});

test('industrialist can force an election to pass regardless of votes', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.startGame();

  const industrialist = game.players[3];
  assert.equal(industrialist.secretRole, 'industrialist');

  const president = game.getPlayer(game.currentPresidentId);
  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(president.socketId, nominee.id);
  for (const player of game.livingPlayers()) {
    if (player.id !== industrialist.id) game.castVote(player.socketId, 'nein');
  }
  assert.equal(game.phase, 'voting');

  game.useSecretRole(industrialist.socketId, {});

  assert.equal(game.phase, 'president_legislative');
  assert.equal(game.lastVoteResult.passed, true);
  assert.equal(game.lastVoteResult.forced, true);
  assert.equal(game.lastVoteResult.ja, 6);
  assert.equal(industrialist.secretRoleUsed, true);
});

test('union organizer can force an election to fail regardless of votes', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.startGame();

  const unionOrganizer = game.players[4];
  assert.equal(unionOrganizer.secretRole, 'unionOrganizer');

  const president = game.getPlayer(game.currentPresidentId);
  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(president.socketId, nominee.id);
  for (const player of game.livingPlayers()) {
    if (player.id !== unionOrganizer.id) game.castVote(player.socketId, 'ja');
  }
  assert.equal(game.phase, 'voting');

  game.useSecretRole(unionOrganizer.socketId, {});

  assert.equal(game.lastVoteResult.passed, false);
  assert.equal(game.lastVoteResult.forced, true);
  assert.equal(game.electionTracker, 1);
  assert.equal(unionOrganizer.secretRoleUsed, true);
});

test('constitutional judge can block a pending executive power', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.startGame();

  const judge = game.players[5];
  assert.equal(judge.secretRole, 'constitutionalJudge');
  game.pendingPower = 'execution';
  game.phase = 'executive_action';

  game.useSecretRole(judge.socketId, {});

  assert.equal(game.pendingPower, null);
  assert.equal(judge.secretRoleUsed, true);
  assert.equal(game.phase, 'nomination');
});

test('constitutional judge cannot block outside the executive action phase', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.startGame();

  const judge = game.players[5];
  assert.throws(() => game.useSecretRole(judge.socketId, {}), /Invalid action/);
});

test('constitutional judge cannot block when no executive power is pending', () => {
  const game = makeGameWithAllSecretRoles(6);
  game.startGame();

  const judge = game.players[5];
  game.phase = 'executive_action';
  game.pendingPower = null;

  assert.throws(() => game.useSecretRole(judge.socketId, {}), /No executive power is pending/);
});

test('only a player with an unused secret role can use one', () => {
  const game = makeGame(7);
  game.secretRolesEnabled = true;
  game.randomSecretRoleCount = () => 6;
  game.randomSample = (items, count) => items.slice(0, count);
  game.startGame();

  const bystander = game.players.find((player) => !player.secretRole);
  assert.throws(() => game.useSecretRole(bystander.socketId, {}), /do not have a secret role/);
});

test('private state exposes whether a secret role action is currently available with valid targets', () => {
  const game = makeGame(5);
  game.secretRolesEnabled = true;
  game.randomSecretRoleCount = () => 1;
  game.randomSample = (items, count) => items.slice(0, count);
  game.randomInitialPresidentIndex = () => 0;
  game.startGame();

  const policeChief = game.players[0];
  const before = game.privateStateFor(policeChief.socketId);
  assert.equal(before.secretRoleAvailable, true);
  assert.deepEqual(
    new Set(before.secretRoleTargetIds),
    new Set(game.players.filter((player) => player.id !== policeChief.id).map((player) => player.id))
  );

  const target = game.players.find((player) => player.id !== policeChief.id);
  game.useSecretRole(policeChief.socketId, { targetId: target.id });

  assert.equal(game.privateStateFor(policeChief.socketId).secretRoleAvailable, false);
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

test('resetGameFrom clears round state and returns to lobby', () => {
  const game = new Game();
  const mark = game.addPlayer('mark-socket', 'mark');
  const alice = game.addPlayer('alice-socket', 'Alice');
  const bob = game.addPlayer('bob-socket', 'Bob');
  const carol = game.addPlayer('carol-socket', 'Carol');
  const dave = game.addPlayer('dave-socket', 'Dave');
  game.setTableOrderFrom(mark.socketId, [mark.id, alice.id, bob.id, carol.id, dave.id]);
  game.startGame();

  const president = game.getPlayer(game.currentPresidentId);
  const nominee = game.getEligibleChancellors()[0];
  game.nominateChancellor(president.socketId, nominee.id);
  game.castVote(president.socketId, 'ja');
  game.lastVoteResult = { passed: true, ja: 1, nein: 0, votes: [] };
  game.liberalPolicies = 2;
  game.fascistPolicies = 3;
  game.electionTracker = 2;
  game.pendingPower = 'execution';
  game.pendingPowerSource = { type: 'investigation', presidentId: president.id, targetId: nominee.id };
  game.pendingVeto = true;
  game.presidentHand = ['liberal'];
  game.chancellorHand = ['fascist'];
  game.winner = 'liberals';
  game.winReason = 'test state';
  game.players[0].secretRole = 'assassin';
  game.players[0].secretRoleUsed = true;

  game.resetGameFrom(mark.socketId);

  assert.equal(game.phase, 'lobby');
  assert.equal(game.round, 0);
  assert.equal(game.currentPresidentId, null);
  assert.equal(game.currentChancellorId, null);
  assert.equal(game.previousPresidentId, null);
  assert.equal(game.previousChancellorId, null);
  assert.deepEqual(game.votes, {});
  assert.equal(game.lastVoteResult, null);
  assert.equal(game.liberalPolicies, 0);
  assert.equal(game.fascistPolicies, 0);
  assert.equal(game.electionTracker, 0);
  assert.deepEqual(game.presidentHand, []);
  assert.deepEqual(game.chancellorHand, []);
  assert.equal(game.pendingPower, null);
  assert.equal(game.pendingPowerSource, null);
  assert.equal(game.pendingVeto, false);
  assert.equal(game.winner, null);
  assert.equal(game.winReason, null);
  assert.deepEqual(game.players.map((player) => player.role), [null, null, null, null, null]);
  assert.deepEqual(game.players.map((player) => player.secretRole), [null, null, null, null, null]);
  assert.deepEqual(game.players.map((player) => player.secretRoleUsed), [false, false, false, false, false]);
  assert.deepEqual(game.players.map((player) => player.party), [null, null, null, null, null]);
  assert.equal(game.publicState().secretRoles.active, false);
  assert.equal(game.publicState().secretRoles.locked, false);
  assert.deepEqual(game.publicState().tableOrderIds, [mark.id, alice.id, bob.id, carol.id, dave.id]);
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

function totalSecretRoleWeight() {
  return SECRET_ROLE_COUNT_WEIGHTS.reduce((total, option) => total + option.weight, 0);
}
