const crypto = require('crypto');

const ROLE_COUNTS = {
  5: { liberal: 3, fascist: 1, hitler: 1 },
  6: { liberal: 4, fascist: 1, hitler: 1 },
  7: { liberal: 4, fascist: 2, hitler: 1 },
  8: { liberal: 5, fascist: 2, hitler: 1 },
  9: { liberal: 5, fascist: 3, hitler: 1 },
  10: { liberal: 6, fascist: 3, hitler: 1 }
};

const FASCIST_POWERS = {
  small: [null, null, 'policyPeek', 'execution', 'execution', null],
  medium: [null, 'investigate', 'specialElection', 'execution', 'execution', null],
  large: ['investigate', 'investigate', 'specialElection', 'execution', 'execution', null]
};

const PHASES = Object.freeze({
  LOBBY: 'lobby',
  NOMINATION: 'nomination',
  VOTING: 'voting',
  PRESIDENT_LEGISLATIVE: 'president_legislative',
  CHANCELLOR_LEGISLATIVE: 'chancellor_legislative',
  VETO_PENDING: 'veto_pending',
  EXECUTIVE_ACTION: 'executive_action',
  GAME_OVER: 'game_over'
});

const SECRET_ROLE_DEFINITIONS = Object.freeze({
  policeChief: Object.freeze({
    id: 'policeChief',
    name: 'Police Chief',
    type: 'power',
    ability: 'arrest',
    description: 'Can arrest someone, blocking them from being President or Chancellor.'
  }),
  assassin: Object.freeze({
    id: 'assassin',
    name: 'Assassin',
    type: 'power',
    ability: 'eliminate',
    description: 'Can eliminate a player. Killing Hitler gives liberals the win.'
  }),
  journalist: Object.freeze({
    id: 'journalist',
    name: 'Journalist',
    type: 'power',
    ability: 'revealDiscardedPolicy',
    description: 'Can force someone to reveal a discarded policy.'
  }),
  industrialist: Object.freeze({
    id: 'industrialist',
    name: 'Industrialist',
    type: 'power',
    ability: 'forcePassElection',
    description: 'Can force-pass an election.'
  }),
  unionOrganizer: Object.freeze({
    id: 'unionOrganizer',
    name: 'Union Organizer',
    type: 'power',
    ability: 'forceFailElection',
    description: 'Can force-fail an election.'
  }),
  constitutionalJudge: Object.freeze({
    id: 'constitutionalJudge',
    name: 'Constitutional Judge',
    type: 'power',
    ability: 'blockExecutivePower',
    description: 'Can block any executive power.'
  })
});

// Chances must sum to 100. Listed ascending so randomSecretRoleCount()'s
// running total is a plain, auditable cumulative distribution.
const SECRET_ROLE_COUNT_TABLE = Object.freeze([
  Object.freeze({ count: 1, chancePercent: 42.5 }),
  Object.freeze({ count: 2, chancePercent: 25 }),
  Object.freeze({ count: 3, chancePercent: 17.5 }),
  Object.freeze({ count: 4, chancePercent: 10 }),
  Object.freeze({ count: 5, chancePercent: 5 })
]);

class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.players = [];
    this.secretRolesEnabled = false;
    this.resetRoundState();
    this.addLog('Waiting for players.');
  }

  resetRoundState() {
    this.phase = PHASES.LOBBY;
    this.log = [];
    this.round = 0;
    this.presidentCursor = -1;
    this.normalPresidentCursor = -1;
    this.specialPresidentId = null;
    this.returnPresidentCursor = null;
    this.currentPresidentId = null;
    this.currentChancellorId = null;
    this.previousPresidentId = null;
    this.previousChancellorId = null;
    this.votes = {};
    this.lastVoteResult = null;
    this.liberalPolicies = 0;
    this.fascistPolicies = 0;
    this.electionTracker = 0;
    this.deck = [];
    this.discard = [];
    this.presidentHand = [];
    this.chancellorHand = [];
    this.pendingPower = null;
    this.pendingPowerSource = null;
    this.pendingVeto = false;
    this.winner = null;
    this.winReason = null;
    this.secretRolesActive = false;
    this.arrestedPlayerId = null;
  }

  resetGameFrom(socketId) {
    const requester = this.findPlayerBySocket(socketId);
    if (!this.isMark(requester)) {
      throw new Error('Only mark can reset the game.');
    }

    this.players = this.players.map((player) => ({
      ...player,
      role: null,
      secretRole: null,
      secretRoleUsed: false,
      party: null,
      alive: true
    }));
    this.resetRoundState();
    this.addLog('Game reset by mark.');
  }

  addPlayer(socketId, name) {
    if (this.findPlayerBySocket(socketId)) throw new Error('You have already joined.');
    const cleanName = String(name || '').trim().slice(0, 24);
    if (!cleanName) throw new Error('Enter a username.');

    const existing = this.players.find((player) => player.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      if (existing.connected) throw new Error('That username is already taken.');
      existing.socketId = socketId;
      existing.connected = true;
      existing.disconnectedAt = null;
      this.addLog(`${existing.name} reconnected.`);
      return existing;
    }

    this.requirePhase(PHASES.LOBBY);
    if (this.players.length >= 10) throw new Error('The game is full.');

    const player = {
      id: crypto.randomUUID(),
      socketId,
      name: cleanName,
      tableSeat: null,
      role: null,
      secretRole: null,
      secretRoleUsed: false,
      party: null,
      alive: true,
      connected: true,
      disconnectedAt: null
    };
    this.players.push(player);
    this.addLog(`${player.name} joined.`);
    return player;
  }

  disconnectPlayer(socketId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player || !player.connected) return null;
    player.connected = false;
    player.disconnectedAt = new Date().toISOString();
    this.addLog(`${player.name} disconnected.`);
    return player;
  }

  removePlayer(socketId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) return;
    this.removePlayerById(player.id, `${player.name} left.`);
  }

  expireDisconnectedPlayer(playerId) {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || player.connected) return false;
    this.removePlayerById(player.id, `${player.name} was removed after disconnecting.`);
    return true;
  }

  removePlayerFrom(requesterSocketId, targetPlayerId) {
    const requester = this.findPlayerBySocket(requesterSocketId);
    if (!this.isMark(requester)) {
      throw new Error('Only mark can remove players.');
    }
    const target = this.getPlayer(targetPlayerId);
    this.removePlayerById(target.id, `${target.name} was removed by mark.`);
  }

  setPlayerSeatFrom(requesterSocketId, targetPlayerId, tableSeat) {
    this.requireMarkLobbyAction(requesterSocketId, 'set table seats');

    const target = this.getPlayer(targetPlayerId);
    const cleanSeat = this.normalizeTableSeat(tableSeat);
    if (
      cleanSeat !== null &&
      this.players.some((player) => player.id !== target.id && player.tableSeat === cleanSeat)
    ) {
      throw new Error('That table seat is already taken.');
    }

    target.tableSeat = cleanSeat;
    this.addLog(`${target.name} was seated${cleanSeat === null ? '' : ` at table position ${cleanSeat + 1}`}.`);
  }

  setTableOrderFrom(requesterSocketId, playerIds) {
    this.requireMarkLobbyAction(requesterSocketId, 'set table order');
    if (!Array.isArray(playerIds)) throw new Error('Table order must be a list of player ids.');
    if (playerIds.length !== this.players.length) {
      throw new Error('Table order must include every player exactly once.');
    }

    const seen = new Set();
    const orderedPlayers = playerIds.map((playerId) => {
      if (seen.has(playerId)) throw new Error('Table order cannot contain duplicate players.');
      seen.add(playerId);
      return this.getPlayer(playerId);
    });

    for (let index = 0; index < orderedPlayers.length; index += 1) {
      orderedPlayers[index].tableSeat = index;
    }
    this.addLog('Table order was updated by mark.');
  }

  setSecretRolesEnabledFrom(requesterSocketId, setting) {
    this.requireMarkLobbyAction(requesterSocketId, 'set secret roles');
    const enabled = typeof setting === 'object' && setting !== null ? setting.enabled : setting;
    this.secretRolesEnabled = Boolean(enabled);
    this.addLog(`Secret roles were turned ${this.secretRolesEnabled ? 'on' : 'off'} by mark.`);
  }

  removePlayerById(playerId, logMessage) {
    const removedIndex = this.players.findIndex((candidate) => candidate.id === playerId);
    const player = this.players[removedIndex];
    if (!player) return;
    this.players = this.players.filter((candidate) => candidate.id !== player.id);
    this.adjustCursorsAfterRemoval(removedIndex);
    this.cleanUpRemovedPlayer(player.id);
    this.addLog(logMessage);
    this.maybeResolveElection();
  }

  adjustCursorsAfterRemoval(removedIndex) {
    if (removedIndex <= this.normalPresidentCursor) this.normalPresidentCursor -= 1;
    if (removedIndex <= this.presidentCursor) this.presidentCursor -= 1;
    this.normalPresidentCursor = Math.min(this.normalPresidentCursor, this.players.length - 1);
    this.presidentCursor = Math.min(this.presidentCursor, this.players.length - 1);
  }

  cleanUpRemovedPlayer(playerId) {
    delete this.votes[playerId];
    if (this.previousPresidentId === playerId) this.previousPresidentId = null;
    if (this.previousChancellorId === playerId) this.previousChancellorId = null;
    if (this.specialPresidentId === playerId) this.specialPresidentId = null;

    if (this.currentPresidentId === playerId) {
      this.currentPresidentId = null;
      this.cancelActiveTurn();
      if (this.phase !== PHASES.LOBBY && this.phase !== PHASES.GAME_OVER && this.livingPlayers().length) {
        this.advancePresident();
      }
      return;
    }

    if (this.currentChancellorId === playerId) {
      this.currentChancellorId = null;
      this.cancelGovernmentSelection();
    }
  }

  cancelActiveTurn() {
    this.cancelGovernmentSelection();
    this.pendingPower = null;
    this.pendingPowerSource = null;
  }

  cancelGovernmentSelection() {
    this.votes = {};
    this.lastVoteResult = null;
    this.presidentHand = [];
    this.chancellorHand = [];
    this.pendingVeto = false;
    if (this.phase !== PHASES.LOBBY && this.phase !== PHASES.GAME_OVER) {
      this.phase = PHASES.NOMINATION;
    }
  }

  startGame() {
    this.requirePhase(PHASES.LOBBY);
    if (!ROLE_COUNTS[this.players.length]) throw new Error('Start requires 5 to 10 players.');
    if (this.players.some((player) => !player.connected)) {
      throw new Error('All players must be connected before starting.');
    }
    if (
      this.players.some((player) => player.tableSeat !== null) &&
      this.players.some((player) => player.tableSeat === null)
    ) {
      throw new Error('Seat every player before starting with table order.');
    }

    const roles = this.shuffledRoles();
    this.players = this.tableOrderedPlayers().map((player, index) => {
      const role = roles[index];
      return {
        ...player,
        role,
        secretRole: null,
        secretRoleUsed: false,
        party: role === 'liberal' ? 'liberal' : 'fascist',
        alive: true
      };
    });
    this.assignSecretRoles();

    this.deck = shuffle([...Array(6).fill('liberal'), ...Array(11).fill('fascist')]);
    this.discard = [];
    this.phase = PHASES.NOMINATION;
    this.presidentCursor = -1;
    this.normalPresidentCursor = -1;
    this.previousPresidentId = null;
    this.previousChancellorId = null;
    this.secretRolesActive = this.secretRolesEnabled;
    this.addLog('Game started.');
    this.chooseInitialPresident();
  }

  assignSecretRoles() {
    if (!this.secretRolesEnabled) return;
    const roleIds = Object.keys(SECRET_ROLE_DEFINITIONS);
    const secretRoleCount = Math.min(this.randomSecretRoleCount(), this.players.length, roleIds.length);
    const selectedPlayers = this.randomSample(this.players, secretRoleCount);
    const selectedRoleIds = this.randomSample(roleIds, secretRoleCount);

    for (let index = 0; index < selectedPlayers.length; index += 1) {
      selectedPlayers[index].secretRole = selectedRoleIds[index];
      selectedPlayers[index].secretRoleUsed = false;
    }
  }

  randomSecretRoleCount() {
    const roll = this.randomInt(1000);
    let cumulativePerMille = 0;
    for (const option of SECRET_ROLE_COUNT_TABLE) {
      cumulativePerMille += option.chancePercent * 10;
      if (roll < cumulativePerMille) return option.count;
    }
    return SECRET_ROLE_COUNT_TABLE[SECRET_ROLE_COUNT_TABLE.length - 1].count;
  }

  randomInt(max) {
    return crypto.randomInt(max);
  }

  randomSample(items, count) {
    return shuffle(items).slice(0, count);
  }

  useSecretRole(socketId, payload) {
    const player = this.requireLivingPlayer(socketId);
    if (!this.secretRolesActive) throw new Error('Secret roles are not active this game.');
    if (!player.secretRole) throw new Error('You do not have a secret role.');
    if (player.secretRoleUsed) throw new Error('You have already used your secret role.');

    const targetId = payload && payload.targetId;
    switch (SECRET_ROLE_DEFINITIONS[player.secretRole].ability) {
      case 'arrest':
        return this.useArrest(player, targetId);
      case 'eliminate':
        return this.useEliminate(player, targetId);
      case 'revealDiscardedPolicy':
        return this.useRevealDiscardedPolicy(player);
      case 'forcePassElection':
        return this.useForceElection(player, true);
      case 'forceFailElection':
        return this.useForceElection(player, false);
      case 'blockExecutivePower':
        return this.useBlockExecutivePower(player);
      default:
        throw new Error('Unknown secret role ability.');
    }
  }

  useArrest(player, targetId) {
    this.requirePhase(PHASES.NOMINATION);
    const target = this.requireLivingConnectedTarget(targetId, player.id);
    if (target.id === this.currentPresidentId) throw new Error('The sitting President cannot be targeted.');
    this.arrestedPlayerId = target.id;
    player.secretRoleUsed = true;
    this.addLog(`A hidden power arrested ${target.name}. They cannot be President or Chancellor this round.`);
  }

  useEliminate(player, targetId) {
    this.requirePhase(PHASES.NOMINATION);
    const target = this.requireLivingConnectedTarget(targetId, player.id);
    if (target.id === this.currentPresidentId) throw new Error('The sitting President cannot be targeted.');
    target.alive = false;
    player.secretRoleUsed = true;
    this.addLog(`A hidden power eliminated ${target.name}.`);
    if (target.role === 'hitler') {
      this.endGame('liberals', 'Hitler was eliminated by a secret power.');
    }
  }

  useRevealDiscardedPolicy(player) {
    if (this.phase === PHASES.LOBBY || this.phase === PHASES.GAME_OVER) throw new Error('The game is not active.');
    if (!this.discard.length) throw new Error('There are no discarded policies to reveal.');
    const revealed = this.discard[crypto.randomInt(this.discard.length)];
    player.secretRoleUsed = true;
    this.addLog(`A hidden power revealed a discarded policy: ${revealed === 'liberal' ? 'Liberal' : 'Fascist'}.`);
  }

  useForceElection(player, forcePass) {
    this.requirePhase(PHASES.VOTING);
    player.secretRoleUsed = true;
    const living = this.livingPlayers();
    const votes = living.map((candidate) => ({ playerId: candidate.id, vote: this.votes[candidate.id] || null }));
    this.votes = {};
    this.addLog(`A hidden power forced this election to ${forcePass ? 'pass' : 'fail'}.`);
    this.applyElectionResult(forcePass, forcePass ? living.length : 0, forcePass ? 0 : living.length, votes, true);
  }

  useBlockExecutivePower(player) {
    this.requirePhase(PHASES.EXECUTIVE_ACTION);
    if (!this.pendingPower) throw new Error('No executive power is pending.');
    player.secretRoleUsed = true;
    this.addLog(`A hidden power blocked the ${formatPower(this.pendingPower)} power.`);
    this.pendingPower = null;
    this.pendingPowerSource = null;
    this.finishRound();
  }

  secretRoleActionStateFor(player) {
    const unavailable = { available: false, targetIds: null };
    if (!this.secretRolesActive || !player.secretRole || player.secretRoleUsed || !player.alive) return unavailable;

    const ability = SECRET_ROLE_DEFINITIONS[player.secretRole].ability;
    switch (ability) {
      case 'arrest':
        if (this.phase !== PHASES.NOMINATION) return unavailable;
        return this.availableSecretRoleTargets(
          this.otherLivingConnectedIds(player.id).filter((id) => id !== this.currentPresidentId)
        );
      case 'eliminate':
        if (this.phase !== PHASES.NOMINATION) return unavailable;
        return this.availableSecretRoleTargets(
          this.otherLivingConnectedIds(player.id).filter((id) => id !== this.currentPresidentId)
        );
      case 'revealDiscardedPolicy':
        if (this.phase === PHASES.LOBBY || this.phase === PHASES.GAME_OVER || !this.discard.length) return unavailable;
        return { available: true, targetIds: null };
      case 'forcePassElection':
      case 'forceFailElection':
        if (this.phase !== PHASES.VOTING) return unavailable;
        return { available: true, targetIds: null };
      case 'blockExecutivePower':
        if (this.phase !== PHASES.EXECUTIVE_ACTION || !this.pendingPower) return unavailable;
        return { available: true, targetIds: null };
      default:
        return unavailable;
    }
  }

  otherLivingConnectedIds(excludePlayerId) {
    return this.livingPlayers()
      .filter((player) => player.connected && player.id !== excludePlayerId)
      .map((player) => player.id);
  }

  availableSecretRoleTargets(targetIds) {
    return targetIds.length ? { available: true, targetIds } : { available: false, targetIds: [] };
  }

  chooseInitialPresident() {
    const living = this.livingPlayers();
    if (!living.length) throw new Error('No living players remain.');
    const president = living[this.randomInitialPresidentIndex(living.length)];
    const cursor = this.players.findIndex((player) => player.id === president.id);
    this.normalPresidentCursor = cursor;
    this.presidentCursor = cursor;
    this.currentPresidentId = president.id;
    this.round += 1;
    this.addLog(`${president.name} is President.`);
  }

  randomInitialPresidentIndex(playerCount) {
    return crypto.randomInt(playerCount);
  }

  nominateChancellor(socketId, nomineeId) {
    this.requirePhase(PHASES.NOMINATION);
    this.requireCurrentPresident(socketId);
    if (!this.getEligibleChancellors().some((player) => player.id === nomineeId)) {
      throw new Error('That player cannot be nominated.');
    }
    this.currentChancellorId = nomineeId;
    this.votes = {};
    this.lastVoteResult = null;
    this.phase = PHASES.VOTING;
    this.addLog(`${this.playerName(this.currentPresidentId)} nominated ${this.playerName(nomineeId)}.`);
  }

  castVote(socketId, vote) {
    this.requirePhase(PHASES.VOTING);
    const player = this.requireLivingPlayer(socketId);
    if (vote !== 'ja' && vote !== 'nein') throw new Error('Vote must be Ja or Nein.');
    this.votes[player.id] = vote;
    this.maybeResolveElection();
  }

  maybeResolveElection() {
    if (this.phase !== PHASES.VOTING) return;
    const living = this.livingPlayers();
    if (living.length && living.every((candidate) => this.votes[candidate.id])) {
      this.resolveElection();
    }
  }

  presidentDiscard(socketId, policyIndex) {
    this.requirePhase(PHASES.PRESIDENT_LEGISLATIVE);
    this.requireCurrentPresident(socketId);
    this.assertIndex(policyIndex, this.presidentHand.length);
    const [discarded] = this.presidentHand.splice(policyIndex, 1);
    this.discard.push(discarded);
    this.chancellorHand = this.presidentHand;
    this.presidentHand = [];
    this.phase = PHASES.CHANCELLOR_LEGISLATIVE;
    this.addLog('President passed two policies to the Chancellor.');
  }

  chancellorChoose(socketId, payload) {
    this.requirePhase(PHASES.CHANCELLOR_LEGISLATIVE);
    this.requireCurrentChancellor(socketId);
    if (payload && payload.veto) {
      if (this.fascistPolicies < 5) throw new Error('Veto is not unlocked.');
      this.pendingVeto = true;
      this.phase = PHASES.VETO_PENDING;
      this.addLog('Chancellor requested a veto.');
      return;
    }

    const policyIndex = typeof payload === 'number' ? payload : payload.policyIndex;
    this.assertIndex(policyIndex, this.chancellorHand.length);
    const [enacted] = this.chancellorHand.splice(policyIndex, 1);
    this.discard.push(...this.chancellorHand);
    this.chancellorHand = [];
    this.enactPolicy(enacted, true);
  }

  respondToVeto(socketId, accept) {
    this.requirePhase(PHASES.VETO_PENDING);
    this.requireCurrentPresident(socketId);
    if (accept) {
      this.discard.push(...this.chancellorHand);
      this.chancellorHand = [];
      this.pendingVeto = false;
      this.addLog('Veto accepted. Both policies were discarded.');
      this.failedGovernmentAfterVeto();
      return;
    }
    this.pendingVeto = false;
    this.phase = PHASES.CHANCELLOR_LEGISLATIVE;
    this.addLog('Veto rejected. Chancellor must enact a policy.');
  }

  completeExecutiveAction(socketId, targetId) {
    this.requirePhase(PHASES.EXECUTIVE_ACTION);
    const president = this.requireCurrentPresident(socketId);
    const target = this.requireLivingConnectedTarget(targetId, president.id);

    if (this.pendingPower === 'investigate') {
      this.pendingPowerSource = { type: 'investigation', presidentId: president.id, targetId: target.id };
      this.addLog(`${president.name} investigated ${target.name}.`);
      this.finishRound();
      return;
    }

    if (this.pendingPower === 'specialElection') {
      if (target.id === this.arrestedPlayerId) throw new Error('That player has been arrested and cannot be chosen.');
      this.specialPresidentId = target.id;
      this.returnPresidentCursor = this.normalPresidentCursor;
      this.addLog(`${president.name} chose ${target.name} for a special election.`);
      this.finishRound();
      return;
    }

    if (this.pendingPower === 'execution') {
      target.alive = false;
      this.addLog(`${president.name} executed ${target.name}.`);
      if (target.role === 'hitler') {
        this.endGame('liberals', 'Hitler was executed.');
        return;
      }
      this.finishRound();
      return;
    }

    throw new Error('No executive action is pending.');
  }

  acknowledgePolicyPeek(socketId) {
    this.requirePhase(PHASES.EXECUTIVE_ACTION);
    this.requireCurrentPresident(socketId);
    if (this.pendingPower !== 'policyPeek') throw new Error('Policy peek is not pending.');
    this.addLog(`${this.playerName(this.currentPresidentId)} viewed the next three policies.`);
    this.finishRound();
  }

  resolveElection() {
    const living = this.livingPlayers();
    const ja = living.filter((player) => this.votes[player.id] === 'ja').length;
    const nein = living.length - ja;
    const passed = ja > nein;
    const votes = living.map((player) => ({ playerId: player.id, vote: this.votes[player.id] }));
    this.addLog(`Vote revealed: ${ja} Ja, ${nein} Nein. Government ${passed ? 'passed' : 'failed'}.`);
    this.applyElectionResult(passed, ja, nein, votes, false);
  }

  applyElectionResult(passed, ja, nein, votes, forced) {
    this.lastVoteResult = { passed, ja, nein, votes, forced };

    if (!passed) {
      this.failGovernment();
      return;
    }

    this.arrestedPlayerId = null;
    this.electionTracker = 0;
    if (this.fascistPolicies >= 3 && this.getPlayer(this.currentChancellorId).role === 'hitler') {
      this.endGame('fascists', 'Hitler was elected Chancellor after three Fascist policies.');
      return;
    }

    this.previousPresidentId = this.currentPresidentId;
    this.previousChancellorId = this.currentChancellorId;
    this.drawPresidentPolicies();
    this.phase = PHASES.PRESIDENT_LEGISLATIVE;
  }

  failGovernment() {
    this.electionTracker += 1;
    this.currentChancellorId = null;

    if (this.electionTracker >= 3) {
      const policy = this.drawPolicies(1)[0];
      this.electionTracker = 0;
      this.addLog(`Election tracker reached three. Top policy was enacted.`);
      this.enactPolicy(policy, false);
      return;
    }

    this.advancePresident();
  }

  failedGovernmentAfterVeto() {
    this.electionTracker += 1;
    this.currentChancellorId = null;
    if (this.electionTracker >= 3) {
      const policy = this.drawPolicies(1)[0];
      this.electionTracker = 0;
      this.addLog(`Election tracker reached three. Top policy was enacted.`);
      this.enactPolicy(policy, false);
      return;
    }
    this.finishRound();
  }

  enactPolicy(policy, triggerPower) {
    if (policy === 'liberal') {
      this.liberalPolicies += 1;
      this.addLog('A Liberal policy was enacted.');
      if (this.liberalPolicies >= 5) {
        this.endGame('liberals', 'Five Liberal policies were enacted.');
        return;
      }
      this.finishRound();
      return;
    }

    this.fascistPolicies += 1;
    this.addLog('A Fascist policy was enacted.');
    if (this.fascistPolicies >= 6) {
      this.endGame('fascists', 'Six Fascist policies were enacted.');
      return;
    }

    const power = triggerPower ? this.powerForFascistPolicy(this.fascistPolicies) : null;
    if (power) {
      this.pendingPower = power;
      this.phase = PHASES.EXECUTIVE_ACTION;
      this.addLog(`Executive action: ${formatPower(power)}.`);
      return;
    }
    this.finishRound();
  }

  finishRound() {
    this.pendingPower = null;
    this.currentChancellorId = null;
    this.votes = {};
    this.presidentHand = [];
    this.chancellorHand = [];
    if (this.phase !== PHASES.GAME_OVER) this.advancePresident();
  }

  advancePresident() {
    this.phase = PHASES.NOMINATION;

    if (this.specialPresidentId) {
      this.currentPresidentId = this.specialPresidentId;
      this.specialPresidentId = null;
      this.presidentCursor = this.players.findIndex((player) => player.id === this.currentPresidentId);
      this.arrestedPlayerId = null;
      this.addLog(`${this.playerName(this.currentPresidentId)} is President by special election.`);
      return;
    }

    if (this.returnPresidentCursor !== null) {
      this.normalPresidentCursor = this.returnPresidentCursor;
      this.returnPresidentCursor = null;
    }

    const nextCursor = this.nextLivingCursor(this.normalPresidentCursor);
    this.normalPresidentCursor = nextCursor;
    this.presidentCursor = nextCursor;
    this.currentPresidentId = this.players[nextCursor].id;
    this.arrestedPlayerId = null;
    this.round += 1;
    this.addLog(`${this.playerName(this.currentPresidentId)} is President.`);
  }

  nextLivingCursor(fromCursor) {
    if (!this.livingPlayers().length) throw new Error('No living players remain.');
    let cursor = fromCursor;
    for (let i = 0; i < this.players.length; i += 1) {
      cursor = (cursor + 1 + this.players.length) % this.players.length;
      if (this.players[cursor].alive && this.players[cursor].id !== this.arrestedPlayerId) return cursor;
    }
    throw new Error('No living players remain.');
  }

  drawPresidentPolicies() {
    this.presidentHand = this.drawPolicies(3);
  }

  drawPolicies(count) {
    this.refillDeckIfNeeded(count);
    return this.deck.splice(0, count);
  }

  refillDeckIfNeeded(count) {
    if (this.deck.length >= count) return;
    this.deck = this.deck.concat(shuffle(this.discard));
    this.discard = [];
    if (this.deck.length < count) throw new Error('Policy deck is unexpectedly empty.');
  }

  shuffledRoles() {
    const counts = ROLE_COUNTS[this.players.length];
    return shuffle([
      ...Array(counts.liberal).fill('liberal'),
      ...Array(counts.fascist).fill('fascist'),
      ...Array(counts.hitler).fill('hitler')
    ]);
  }

  powerForFascistPolicy(position) {
    const count = this.players.length;
    const track = count <= 6 ? FASCIST_POWERS.small : count <= 8 ? FASCIST_POWERS.medium : FASCIST_POWERS.large;
    return track[position - 1];
  }

  getEligibleChancellors() {
    const living = this.livingPlayers();
    return living.filter((player) => {
      if (!player.connected) return false;
      if (player.id === this.currentPresidentId) return false;
      if (player.id === this.arrestedPlayerId) return false;
      return player.id !== this.previousPresidentId && player.id !== this.previousChancellorId;
    });
  }

  tableOrderedPlayers() {
    return [...this.players].sort((left, right) => {
      const leftSeat = left.tableSeat;
      const rightSeat = right.tableSeat;
      if (leftSeat === null && rightSeat === null) return 0;
      if (leftSeat === null) return 1;
      if (rightSeat === null) return -1;
      return leftSeat - rightSeat;
    });
  }

  publicState() {
    const tableOrderIds = this.tableOrderedPlayers().map((player) => player.id);
    return {
      phase: this.phase,
      players: this.players.map((player) => ({
        id: player.id,
        name: player.name,
        tableSeat: player.tableSeat,
        alive: player.alive,
        connected: player.connected,
        isPresident: player.id === this.currentPresidentId,
        isChancellor: player.id === this.currentChancellorId,
        isTermLimited: this.isTermLimited(player.id),
        arrested: player.id === this.arrestedPlayerId
      })),
      currentPresidentId: this.currentPresidentId,
      currentChancellorId: this.currentChancellorId,
      arrestedPlayerId: this.arrestedPlayerId,
      tableOrderIds,
      eligibleChancellorIds: this.getEligibleChancellors().map((player) => player.id),
      liberalPolicies: this.liberalPolicies,
      fascistPolicies: this.fascistPolicies,
      electionTracker: this.electionTracker,
      round: this.round,
      lastVoteResult: this.lastVoteResult,
      pendingPower: this.pendingPower,
      secretRoles: this.secretRolePublicState(),
      vetoUnlocked: this.fascistPolicies >= 5,
      winner: this.winner,
      winReason: this.winReason,
      log: this.log.slice(-80)
    };
  }

  privateStateFor(socketId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) return null;
    const visiblePlayers = this.roleVisibilityFor(player);
    const secretRoleAction = this.secretRoleActionStateFor(player);
    const state = {
      id: player.id,
      name: player.name,
      role: player.role,
      secretRole: player.secretRole,
      secretRoleDetails: this.secretRoleDetails(player.secretRole),
      secretRoleUsed: player.secretRoleUsed,
      secretRoleAvailable: secretRoleAction.available,
      secretRoleTargetIds: secretRoleAction.targetIds,
      party: player.party,
      alive: player.alive,
      isPresident: player.id === this.currentPresidentId,
      isChancellor: player.id === this.currentChancellorId,
      isTermLimited: this.isTermLimited(player.id),
      visibleRoles: visiblePlayers
    };

    if (this.phase === PHASES.PRESIDENT_LEGISLATIVE && player.id === this.currentPresidentId) {
      state.presidentPolicies = [...this.presidentHand];
    }
    if ((this.phase === PHASES.CHANCELLOR_LEGISLATIVE || this.phase === PHASES.VETO_PENDING) && player.id === this.currentChancellorId) {
      state.chancellorPolicies = [...this.chancellorHand];
    }
    if (this.phase === PHASES.EXECUTIVE_ACTION && player.id === this.currentPresidentId && this.pendingPower === 'policyPeek') {
      this.refillDeckIfNeeded(Math.min(3, this.deck.length + this.discard.length));
      state.policyPeek = this.deck.slice(0, 3);
    }
    if (this.pendingPowerSource && this.pendingPowerSource.type === 'investigation' && this.pendingPowerSource.presidentId === player.id) {
      const target = this.getPlayer(this.pendingPowerSource.targetId);
      state.investigationResult = {
        playerId: target.id,
        name: target.name,
        party: target.party
      };
    }
    return state;
  }

  roleVisibilityFor(viewer) {
    if (this.phase === PHASES.LOBBY || !viewer.role) return [];
    const fascists = this.players.filter((player) => player.party === 'fascist');
    if (this.players.length <= 6 && viewer.party === 'fascist') {
      return fascists
        .filter((player) => player.id !== viewer.id)
        .map((player) => ({ playerId: player.id, name: player.name, role: player.role, party: player.party }));
    }
    if (this.players.length >= 7 && viewer.role === 'fascist') {
      return fascists
        .filter((player) => player.id !== viewer.id)
        .map((player) => ({ playerId: player.id, name: player.name, role: player.role, party: player.party }));
    }
    return [];
  }

  secretRolePublicState() {
    return {
      enabled: this.secretRolesEnabled,
      active: this.secretRolesActive,
      locked: this.phase !== PHASES.LOBBY,
      availableRoles: this.secretRoleDefinitions()
    };
  }

  secretRoleDefinitions() {
    return Object.values(SECRET_ROLE_DEFINITIONS).map((role) => ({ ...role }));
  }

  secretRoleDetails(roleId) {
    const role = SECRET_ROLE_DEFINITIONS[roleId];
    return role ? { ...role } : null;
  }

  isTermLimited(playerId) {
    return playerId === this.previousPresidentId || playerId === this.previousChancellorId;
  }

  endGame(winner, reason) {
    this.winner = winner;
    this.winReason = reason;
    this.phase = PHASES.GAME_OVER;
    this.addLog(`${winner === 'liberals' ? 'Liberals' : 'Fascists'} win: ${reason}`);
  }

  requirePhase(phase) {
    if (this.phase !== phase) throw new Error(`Invalid action during ${this.phase}.`);
  }

  requireCurrentPresident(socketId) {
    const player = this.requireLivingPlayer(socketId);
    if (player.id !== this.currentPresidentId) throw new Error('Only the President can do that.');
    return player;
  }

  requireCurrentChancellor(socketId) {
    const player = this.requireLivingPlayer(socketId);
    if (player.id !== this.currentChancellorId) throw new Error('Only the Chancellor can do that.');
    return player;
  }

  requireLivingPlayer(socketId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) throw new Error('Join the game first.');
    if (!player.alive) throw new Error('Dead players cannot do that.');
    return player;
  }

  requireLivingConnectedTarget(targetId, excludePlayerId) {
    const target = this.players.find((player) => player.id === targetId);
    if (!target || !target.alive || !target.connected || target.id === excludePlayerId) {
      throw new Error('Choose a valid living target.');
    }
    return target;
  }

  findPlayerBySocket(socketId) {
    return this.players.find((player) => player.socketId === socketId);
  }

  getPlayer(playerId) {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('Unknown player.');
    return player;
  }

  livingPlayers() {
    return this.players.filter((player) => player.alive);
  }

  playerName(playerId) {
    return this.getPlayer(playerId).name;
  }

  assertIndex(index, length) {
    if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error('Invalid policy choice.');
  }

  normalizeTableSeat(tableSeat) {
    if (tableSeat === null || tableSeat === undefined || tableSeat === '') return null;
    const seatNumber = typeof tableSeat === 'string' ? Number(tableSeat) : tableSeat;
    if (!Number.isInteger(seatNumber) || seatNumber < 0 || seatNumber >= 10) {
      throw new Error('Table seat must be between 0 and 9.');
    }
    return seatNumber;
  }

  requireMarkLobbyAction(socketId, action) {
    this.requirePhase(PHASES.LOBBY);
    const requester = this.findPlayerBySocket(socketId);
    if (!this.isMark(requester)) {
      throw new Error(`Only mark can ${action}.`);
    }
    return requester;
  }

  isMark(player) {
    return Boolean(player && player.name.trim().toLowerCase() === 'mark');
  }

  addLog(message) {
    this.log.push({ at: new Date().toISOString(), message });
  }
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function formatPower(power) {
  return {
    investigate: 'Investigate Loyalty',
    policyPeek: 'Policy Peek',
    specialElection: 'Special Election',
    execution: 'Execution'
  }[power] || power;
}

module.exports = { Game, PHASES, ROLE_COUNTS, SECRET_ROLE_DEFINITIONS, SECRET_ROLE_COUNT_TABLE };
