const socket = io();

// Mirrors the executive-power schedule in game.js, used here only to decide
// which power icon to draw under each fascist policy slot.
const FASCIST_POWERS = {
  small: [null, null, 'policyPeek', 'execution', 'execution', null],
  medium: [null, 'investigate', 'specialElection', 'execution', 'execution', null],
  large: ['investigate', 'investigate', 'specialElection', 'execution', 'execution', null]
};

const POWER_ICON = {
  investigate: '\u{1F50D}',
  policyPeek: '\u{1F441}',
  specialElection: '\u{1F5F3}',
  execution: '\u{1F480}'
};

const POWER_LABEL = {
  investigate: 'Investigate',
  policyPeek: 'Peek',
  specialElection: 'Election',
  execution: 'Execute'
};

const STORED_NAME_KEY = 'secretDictator.playerName';

let publicState = null;
let privateState = null;

const joinPanel = document.getElementById('joinPanel');
const nameInput = document.getElementById('nameInput');
const joinButton = document.getElementById('joinButton');
const startButton = document.getElementById('startButton');
const errorEl = document.getElementById('error');
const connectionStatus = document.getElementById('connectionStatus');
const phaseText = document.getElementById('phaseText');
const presidentText = document.getElementById('presidentText');
const chancellorText = document.getElementById('chancellorText');
const playerCountText = document.getElementById('playerCountText');
const winnerText = document.getElementById('winnerText');
const pauseNotice = document.getElementById('pauseNotice');
const playerList = document.getElementById('playerList');
const tableSeating = document.getElementById('tableSeating');
const liberalTrack = document.getElementById('liberalTrack');
const fascistTrack = document.getElementById('fascistTrack');
const fascistPowerRow = document.getElementById('fascistPowerRow');
const electionTrack = document.getElementById('electionTrack');
const actions = document.getElementById('actions');
const personal = document.getElementById('personal');
const eventToast = document.getElementById('eventToast');

let lastToastKey = null;
let hasRenderedInitialLog = false;
let toastTimer = null;
let votedKey = null;

joinButton.addEventListener('click', () => joinGame());
nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinGame();
});
startButton.addEventListener('click', () => emit('startGame'));

const storedName = window.localStorage.getItem(STORED_NAME_KEY);
if (storedName) nameInput.value = storedName;

socket.on('connect', () => {
  connectionStatus.textContent = 'connected';
  connectionStatus.className = 'connection-status online';
  const rememberedName = window.localStorage.getItem(STORED_NAME_KEY);
  if (rememberedName) emit('joinGame', rememberedName, null, () => {
    nameInput.value = rememberedName;
  });
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'disconnected';
  connectionStatus.className = 'connection-status offline';
});

socket.on('gameState', (state) => {
  publicState = state;
  render();
});

socket.on('privateState', (state) => {
  privateState = state;
  render();
});

socket.on('errorMessage', (message) => {
  errorEl.textContent = message;
});

function joinGame() {
  const name = nameInput.value;
  emit('joinGame', name, null, () => {
    window.localStorage.setItem(STORED_NAME_KEY, name.trim().slice(0, 24));
  });
}

function emit(eventName, payload, onError, onSuccess) {
  errorEl.textContent = '';
  socket.emit(eventName, payload, (reply) => {
    if (reply && !reply.ok) {
      errorEl.textContent = reply.error;
      if (onError) onError();
      return;
    }
    if (onSuccess) onSuccess();
  });
}

function render() {
  if (!publicState) return;
  renderJoin();
  renderStatus();
  renderPauseNotice();
  renderPlayers();
  renderBoard();
  renderTableSeating();
  renderPersonal();
  renderActions();
  renderEventToast();
}

function renderJoin() {
  const joined = Boolean(privateState);
  joinPanel.style.display = publicState.phase === 'lobby' ? 'block' : 'none';
  nameInput.disabled = joined;
  joinButton.disabled = joined;
  startButton.disabled = publicState.players.length < 5 || publicState.players.length > 10;
}

function renderStatus() {
  phaseText.textContent = labelPhase(publicState.phase);
  presidentText.textContent = playerName(publicState.currentPresidentId) || '—';
  chancellorText.textContent = playerName(publicState.currentChancellorId) || '—';
  playerCountText.textContent = publicState.players.length;
  winnerText.textContent = publicState.winner ? `${capitalize(publicState.winner)} win. ${publicState.winReason}` : '';
}

function renderPauseNotice() {
  const waitingId = isDisconnected(publicState.currentChancellorId)
    ? publicState.currentChancellorId
    : isDisconnected(publicState.currentPresidentId) ? publicState.currentPresidentId : null;
  pauseNotice.textContent = waitingId
    ? `Waiting up to 60s for ${playerName(waitingId)} to reconnect…`
    : '';
}

function isDisconnected(id) {
  const player = id && publicState.players.find((candidate) => candidate.id === id);
  return Boolean(player && !player.connected);
}

function renderPlayers() {
  playerList.innerHTML = '';
  const canRemovePlayers = isMark();
  const canAssignSeats = isMark() && publicState.phase === 'lobby';
  for (const player of publicState.players) {
    const item = document.createElement('li');
    if (!player.alive) item.classList.add('dead');
    const details = document.createElement('div');
    details.className = 'player-details';
    details.append(player.name);
    if (typeof player.tableSeat === 'number') details.append(tag(`Seat ${player.tableSeat + 1}`));
    if (player.isPresident) details.append(tag('President'));
    if (player.isChancellor) details.append(tag('Chancellor'));
    if (player.isTermLimited) details.append(tag('Term limited'));
    if (!player.alive) details.append(tag('Dead', true));
    if (!player.connected) details.append(tag('Disconnected', true));
    item.append(details);

    if (canAssignSeats) {
      item.append(seatSelect(player));
    }

    if (canRemovePlayers && player.id !== privateState.id) {
      const button = document.createElement('button');
      button.className = 'player-remove';
      button.type = 'button';
      button.textContent = 'Remove';
      button.addEventListener('click', () => {
        if (window.confirm(`Remove ${player.name} from the game?`)) {
          emit('removePlayer', player.id);
        }
      });
      item.append(button);
    }

    playerList.append(item);
  }
}

function seatSelect(player) {
  const select = document.createElement('select');
  select.className = 'seat-select';
  const unseated = document.createElement('option');
  unseated.value = '';
  unseated.textContent = 'Unseated';
  select.append(unseated);
  for (let seat = 0; seat < 10; seat += 1) {
    const option = document.createElement('option');
    option.value = String(seat);
    option.textContent = `Seat ${seat + 1}`;
    select.append(option);
  }
  select.value = typeof player.tableSeat === 'number' ? String(player.tableSeat) : '';
  select.addEventListener('change', () => {
    emit('setPlayerSeat', { playerId: player.id, tableSeat: select.value === '' ? null : Number(select.value) });
  });
  return select;
}

function renderTableSeating() {
  tableSeating.querySelectorAll('.table-seat').forEach((el) => el.remove());
  const order = publicState.tableOrderIds
    .map((id) => publicState.players.find((player) => player.id === id))
    .filter(Boolean);
  const count = order.length;
  if (!count) return;

  const radiusX = 47;
  const radiusY = 44;
  order.forEach((player, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const left = 50 + radiusX * Math.cos(angle);
    const top = 50 + radiusY * Math.sin(angle);

    const seat = document.createElement('div');
    seat.className = 'table-seat';
    seat.style.left = `${left}%`;
    seat.style.top = `${top}%`;

    const circle = document.createElement('div');
    circle.className = 'seat-circle';
    if (player.isPresident) circle.classList.add('seat-president');
    if (player.isChancellor) circle.classList.add('seat-chancellor');
    if (!player.alive) circle.classList.add('seat-dead');
    if (!player.connected) circle.classList.add('seat-disconnected');
    circle.textContent = initials(player.name);
    seat.append(circle);

    if (player.isPresident || player.isChancellor) {
      const tags = document.createElement('div');
      tags.className = 'seat-tags';
      if (player.isPresident) tags.append(seatTag('President', 'president'));
      if (player.isChancellor) tags.append(seatTag('Chancellor', 'chancellor'));
      seat.append(tags);
    }

    const name = document.createElement('div');
    name.className = 'seat-name';
    name.textContent = player.name;
    seat.append(name);

    tableSeating.append(seat);
  });
}

function seatTag(label, kind) {
  const span = document.createElement('span');
  span.className = `seat-tag seat-tag-${kind}`;
  span.textContent = label;
  return span;
}

function initials(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function renderBoard() {
  renderTrack(liberalTrack, 5, publicState.liberalPolicies, 'liberal');
  renderTrack(fascistTrack, 6, publicState.fascistPolicies, 'fascist');
  renderPowerRow();
  electionTrack.innerHTML = '';
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('div');
    dot.className = `circle ${index < publicState.electionTracker ? 'tracker-filled' : ''}`;
    electionTrack.append(dot);
  }
}

function renderTrack(container, total, filled, party) {
  container.innerHTML = '';
  for (let index = 0; index < total; index += 1) {
    const slot = document.createElement('div');
    const isFilled = index < filled;
    slot.className = `slot ${isFilled ? `filled-${party}` : ''}`;
    slot.textContent = isFilled ? '✓' : '';
    container.append(slot);
  }
}

function renderPowerRow() {
  fascistPowerRow.innerHTML = '';
  const playerCount = publicState.players.length;
  const schedule = playerCount > 0 ? powerSchedule(playerCount) : FASCIST_POWERS.large;
  for (let index = 0; index < 6; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'power-cell';
    const power = schedule[index];
    if (power) {
      cell.textContent = POWER_ICON[power];
      const label = document.createElement('span');
      label.className = 'power-label';
      label.textContent = POWER_LABEL[power];
      cell.append(label);
    }
    fascistPowerRow.append(cell);
  }
}

function powerSchedule(playerCount) {
  if (playerCount <= 6) return FASCIST_POWERS.small;
  if (playerCount <= 8) return FASCIST_POWERS.medium;
  return FASCIST_POWERS.large;
}

function renderPersonal() {
  if (!privateState) {
    personal.textContent = 'Join to see your private information.';
    return;
  }
  personal.innerHTML = '';
  personal.append(renderIdentityCard(privateState));

  if (privateState.visibleRoles && privateState.visibleRoles.length) {
    const chips = document.createElement('div');
    chips.className = 'chip-row';
    for (const player of privateState.visibleRoles) {
      const chip = document.createElement('span');
      chip.className = `chip chip-${player.role === 'hitler' ? 'hitler' : 'fascist'}`;
      chip.textContent = `${roleIcon(player.role)} ${player.name}`;
      chips.append(chip);
    }
    personal.append(infoSection('Known fascists', chips));
  }

  if (privateState.investigationResult) {
    const chip = document.createElement('span');
    chip.className = `chip chip-${privateState.investigationResult.party}`;
    chip.textContent = `${partyIcon(privateState.investigationResult.party)} ${privateState.investigationResult.name} is ${capitalize(privateState.investigationResult.party)}`;
    personal.append(infoSection('Investigation result', chip));
  }

  if (privateState.policyPeek) {
    personal.append(infoSection('Next three policies', renderPolicyList(privateState.policyPeek)));
  }
}

function renderIdentityCard(state) {
  const card = document.createElement('div');
  card.className = 'identity-card';

  const avatar = document.createElement('div');
  avatar.className = `identity-avatar avatar-${state.role || 'unknown'}`;
  avatar.textContent = roleIcon(state.role);
  card.append(avatar);

  const name = document.createElement('div');
  name.className = 'identity-name';
  name.textContent = state.name;
  card.append(name);

  if (state.party) {
    const party = document.createElement('span');
    party.className = `identity-party party-${state.party}`;
    party.textContent = capitalize(state.party);
    card.append(party);
  }

  const badges = document.createElement('div');
  badges.className = 'identity-badges';
  badges.append(statusBadge(state.alive ? 'alive' : 'dead', state.alive ? '❤️ Alive' : '💀 Dead'));
  if (state.isPresident) badges.append(statusBadge('president', '👑 President'));
  if (state.isChancellor) badges.append(statusBadge('chancellor', '🎗️ Chancellor'));
  if (state.isTermLimited) badges.append(statusBadge('term', '⏳ Term limited'));
  card.append(badges);

  return card;
}

function infoSection(labelText, content) {
  const section = document.createElement('div');
  section.className = 'info-section';
  const label = document.createElement('div');
  label.className = 'info-section-label';
  label.textContent = labelText;
  section.append(label, content);
  return section;
}

function statusBadge(kind, label) {
  const span = document.createElement('span');
  span.className = `status-badge status-badge-${kind}`;
  span.textContent = label;
  return span;
}

function roleIcon(role) {
  return { liberal: '🕊️', fascist: '🔥', hitler: '🎩' }[role] || '❔';
}

function partyIcon(party) {
  return party === 'fascist' ? '🔥' : '🕊️';
}

function renderActions() {
  actions.innerHTML = '';
  if (!privateState) {
    actions.textContent = 'Join the game to act.';
    return;
  }
  if (publicState.phase === 'game_over') {
    actions.textContent = 'Game over.';
    renderAdminReset();
    return;
  }
  if (!privateState.alive) {
    actions.textContent = 'Dead players cannot act.';
    renderAdminReset();
    return;
  }

  if (publicState.phase === 'nomination' && privateState.isPresident) {
    renderNomination();
  } else if (publicState.phase === 'voting' && publicState.currentChancellorId) {
    renderVoting();
  } else if (publicState.phase === 'president_legislative' && privateState.isPresident) {
    renderPresidentLegislative();
  } else if (publicState.phase === 'chancellor_legislative' && privateState.isChancellor) {
    renderChancellorLegislative();
  } else if (publicState.phase === 'veto_pending' && privateState.isPresident) {
    renderVetoResponse();
  } else if (publicState.phase === 'executive_action' && privateState.isPresident) {
    renderExecutiveAction();
  } else {
    actions.textContent = 'Waiting for another player.';
  }

  renderAdminReset();
}

function renderAdminReset() {
  if (!isMark()) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'admin-actions';

  const button = document.createElement('button');
  button.className = 'danger';
  button.textContent = 'Reset Game';
  button.addEventListener('click', () => {
    if (window.confirm('Reset the game and keep all current players?')) {
      votedKey = null;
      emit('resetGame');
    }
  });

  wrapper.append(button);
  actions.append(wrapper);
}

function isMark() {
  return Boolean(privateState && privateState.name.trim().toLowerCase() === 'mark');
}

function renderNomination() {
  const select = playerSelect(publicState.eligibleChancellorIds);
  const button = document.createElement('button');
  button.textContent = 'Nominate Chancellor';
  button.addEventListener('click', () => emit('nominateChancellor', select.value));
  actions.append(select, button);
}

function renderVoting() {
  if (votedKey === currentVoteKey()) {
    actions.append(text('Vote submitted. Waiting for the other players…'));
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'vote-buttons';
  const ja = document.createElement('button');
  const nein = document.createElement('button');
  ja.textContent = 'Ja';
  nein.textContent = 'Nein';
  nein.className = 'secondary';
  ja.addEventListener('click', () => castVote('ja'));
  nein.addEventListener('click', () => castVote('nein'));
  wrapper.append(ja, nein);
  actions.append(wrapper);
}

function castVote(vote) {
  const key = currentVoteKey();
  votedKey = key;
  render();
  emit('castVote', vote, () => {
    if (votedKey === key) {
      votedKey = null;
      render();
    }
  });
}

function currentVoteKey() {
  return `${publicState.currentPresidentId}:${publicState.currentChancellorId}:${publicState.electionTracker}`;
}

function renderPresidentLegislative() {
  const policies = privateState.presidentPolicies || [];
  actions.append(text('Discard one policy. The other two go to the Chancellor.'));
  actions.append(renderPolicyButtons(policies, (index) => emit('presidentDiscard', index), 'Discard'));
}

function renderChancellorLegislative() {
  const policies = privateState.chancellorPolicies || [];
  actions.append(text('Enact one policy and discard the other.'));
  actions.append(renderPolicyButtons(policies, (index) => emit('chancellorChoice', { policyIndex: index }), 'Enact'));
  if (publicState.vetoUnlocked) {
    const veto = document.createElement('button');
    veto.className = 'secondary';
    veto.textContent = 'Request Veto';
    veto.addEventListener('click', () => emit('chancellorChoice', { veto: true }));
    actions.append(veto);
  }
}

function renderVetoResponse() {
  const accept = document.createElement('button');
  const reject = document.createElement('button');
  accept.textContent = 'Accept Veto';
  reject.textContent = 'Reject Veto';
  reject.className = 'secondary';
  accept.addEventListener('click', () => emit('vetoResponse', true));
  reject.addEventListener('click', () => emit('vetoResponse', false));
  actions.append(accept, reject);
}

function renderExecutiveAction() {
  if (publicState.pendingPower === 'policyPeek') {
    actions.append(text('Policy peek is shown in your personal information.'));
    const done = document.createElement('button');
    done.textContent = 'Done';
    done.addEventListener('click', () => emit('acknowledgePolicyPeek'));
    actions.append(done);
    return;
  }

  const targetIds = publicState.players
    .filter((player) => player.alive && player.connected && player.id !== privateState.id)
    .map((player) => player.id);
  const select = playerSelect(targetIds);
  const button = document.createElement('button');
  button.textContent = {
    investigate: 'Investigate',
    specialElection: 'Choose President',
    execution: 'Execute'
  }[publicState.pendingPower] || 'Confirm';
  button.addEventListener('click', () => emit('executiveAction', select.value));
  actions.append(select, button);
}

function renderEventToast() {
  if (!publicState.log.length) return;

  const latest = publicState.log[publicState.log.length - 1];
  const key = `${latest.at}:${latest.message}`;
  if (key === lastToastKey) return;

  lastToastKey = key;
  if (!hasRenderedInitialLog) {
    hasRenderedInitialLog = true;
    return;
  }

  eventToast.textContent = latest.message;
  eventToast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    eventToast.classList.remove('show');
  }, 2800);
}

function renderPolicyButtons(policies, onClick, verb) {
  const wrapper = document.createElement('div');
  wrapper.className = 'policyList';
  policies.forEach((policy, index) => {
    const button = document.createElement('button');
    button.className = `policy ${policy}`;
    button.textContent = `${verb} ${capitalize(policy)}`;
    button.addEventListener('click', () => onClick(index));
    wrapper.append(button);
  });
  return wrapper;
}

function renderPolicyList(policies) {
  const wrapper = document.createElement('div');
  wrapper.className = 'policyList';
  for (const policy of policies) {
    const item = document.createElement('div');
    item.className = `policy ${policy}`;
    item.textContent = capitalize(policy);
    wrapper.append(item);
  }
  return wrapper;
}

function playerSelect(ids) {
  const select = document.createElement('select');
  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = playerName(id);
    select.append(option);
  }
  return select;
}

function playerName(id) {
  const player = publicState && publicState.players.find((candidate) => candidate.id === id);
  return player ? player.name : '';
}

function tag(label, muted) {
  const span = document.createElement('span');
  span.className = muted ? 'tag tag-dead' : 'tag';
  span.textContent = label;
  return span;
}

function text(value) {
  const paragraph = document.createElement('p');
  paragraph.textContent = value;
  return paragraph;
}

function labelPhase(phase) {
  return {
    lobby: 'Lobby',
    nomination: 'Nomination',
    voting: 'Voting',
    president_legislative: 'President legislative session',
    chancellor_legislative: 'Chancellor legislative session',
    veto_pending: 'Veto pending',
    executive_action: 'Executive action',
    game_over: 'Game over'
  }[phase] || phase;
}

function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
