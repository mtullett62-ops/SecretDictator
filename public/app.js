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
const playerList = document.getElementById('playerList');
const liberalTrack = document.getElementById('liberalTrack');
const fascistTrack = document.getElementById('fascistTrack');
const fascistPowerRow = document.getElementById('fascistPowerRow');
const electionTrack = document.getElementById('electionTrack');
const actions = document.getElementById('actions');
const personal = document.getElementById('personal');
const log = document.getElementById('log');

joinButton.addEventListener('click', () => emit('joinGame', nameInput.value));
nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') emit('joinGame', nameInput.value);
});
startButton.addEventListener('click', () => emit('startGame'));

socket.on('connect', () => {
  connectionStatus.textContent = 'connected';
  connectionStatus.className = 'connection-status online';
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

function emit(eventName, payload) {
  errorEl.textContent = '';
  socket.emit(eventName, payload, (reply) => {
    if (reply && !reply.ok) errorEl.textContent = reply.error;
  });
}

function render() {
  if (!publicState) return;
  renderJoin();
  renderStatus();
  renderPlayers();
  renderBoard();
  renderPersonal();
  renderActions();
  renderLog();
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

function renderPlayers() {
  playerList.innerHTML = '';
  for (const player of publicState.players) {
    const item = document.createElement('li');
    if (!player.alive) item.classList.add('dead');
    item.append(player.name);
    if (player.isPresident) item.append(tag('President'));
    if (player.isChancellor) item.append(tag('Chancellor'));
    if (player.isTermLimited) item.append(tag('Term limited'));
    if (!player.alive) item.append(tag('Dead', true));
    if (!player.connected) item.append(tag('Disconnected', true));
    playerList.append(item);
  }
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
  const list = document.createElement('dl');
  const rows = [
    ['Username', privateState.name],
    ['Role', privateState.role || 'Not assigned'],
    ['Party', privateState.party || 'Not assigned'],
    ['Status', privateState.alive ? 'Alive' : 'Dead'],
    ['President', privateState.isPresident ? 'Yes' : 'No'],
    ['Chancellor', privateState.isChancellor ? 'Yes' : 'No'],
    ['Term limited', privateState.isTermLimited ? 'Yes' : 'No']
  ];
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = value;
    list.append(dt, dd);
  }
  personal.append(list);

  if (privateState.visibleRoles && privateState.visibleRoles.length) {
    const title = document.createElement('p');
    const label = document.createElement('strong');
    label.textContent = 'Known fascists: ';
    title.append(label);
    title.append(privateState.visibleRoles.map((player) => `${player.name} (${player.role})`).join(', '));
    personal.append(title);
  }

  if (privateState.investigationResult) {
    const result = document.createElement('p');
    const label = document.createElement('strong');
    label.textContent = 'Investigation result: ';
    result.append(
      label,
      `${privateState.investigationResult.name} is ${privateState.investigationResult.party}.`
    );
    personal.append(result);
  }

  if (privateState.policyPeek) {
    personal.append(renderPolicyList(privateState.policyPeek));
  }
}

function renderActions() {
  actions.innerHTML = '';
  if (!privateState) {
    actions.textContent = 'Join the game to act.';
    return;
  }
  if (publicState.phase === 'game_over') {
    actions.textContent = 'Game over.';
    return;
  }
  if (!privateState.alive) {
    actions.textContent = 'Dead players cannot act.';
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
}

function renderNomination() {
  const select = playerSelect(publicState.eligibleChancellorIds);
  const button = document.createElement('button');
  button.textContent = 'Nominate Chancellor';
  button.addEventListener('click', () => emit('nominateChancellor', select.value));
  actions.append(select, button);
}

function renderVoting() {
  const ja = document.createElement('button');
  const nein = document.createElement('button');
  ja.textContent = 'Ja';
  nein.textContent = 'Nein';
  nein.className = 'secondary';
  ja.addEventListener('click', () => emit('castVote', 'ja'));
  nein.addEventListener('click', () => emit('castVote', 'nein'));
  actions.append(ja, nein);
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
    .filter((player) => player.alive && player.id !== privateState.id)
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

function renderLog() {
  log.innerHTML = '';
  for (const entry of publicState.log.slice().reverse()) {
    const item = document.createElement('li');
    item.textContent = entry.message;
    log.append(item);
  }
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
