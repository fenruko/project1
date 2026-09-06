let token = localStorage.getItem('chat_token');
let currentUser = JSON.parse(localStorage.getItem('chat_user') || 'null');
let activeChannelId = null;
let ws = null;
let currentRoom = null;
let isVoiceConnected = false;

// API Helper
async function api(path, options = {}) {
  options.headers = options.headers || {};
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  options.headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API Request failed');
  return data;
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  if (token && currentUser) {
    showChatScreen();
  } else {
    showAuthScreen();
  }
});

// Auth Handlers
let authMode = 'login';
function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('auth-submit-btn').textContent = mode === 'login' ? 'Login' : 'Sign Up';
}

async function handleAuth(e) {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('auth-error');
  errorEl.textContent = '';

  try {
    const res = await api(`/auth/${authMode}`, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    token = res.token;
    currentUser = res.user;
    localStorage.setItem('chat_token', token);
    localStorage.setItem('chat_user', JSON.stringify(currentUser));
    showChatScreen();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

function logout() {
  localStorage.removeItem('chat_token');
  localStorage.removeItem('chat_user');
  token = null;
  currentUser = null;
  if (ws) ws.close();
  if (isVoiceConnected) toggleVoice();
  showAuthScreen();
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('chat-screen').classList.add('hidden');
}

function showChatScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('chat-screen').classList.remove('hidden');
  document.getElementById('user-display-name').textContent = currentUser.username;
  connectWS();
  loadChannels();
}

// WebSocket setup
function connectWS() {
  if (ws) ws.close();
  ws = new WebSocket(`${WS_BASE}?token=${token}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'message' && data.channelId === activeChannelId) {
      appendMessage(data);
    }
  };

  ws.onclose = () => {
    setTimeout(connectWS, 3000);
  };
}

// Channels UI logic
async function loadChannels() {
  try {
    const myChannels = await api('/channels/mine');
    const publicChannels = await api('/channels/public');

    renderChannelList('my-channels-list', myChannels, true);
    renderChannelList('public-channels-list', publicChannels, false);
  } catch (err) {
    console.error('Failed to load channels:', err);
  }
}

function renderChannelList(elementId, channels, isMine) {
  const container = document.getElementById(elementId);
  container.innerHTML = '';
  channels.forEach(ch => {
    const li = document.createElement('li');
    li.textContent = ch.name + (ch.is_private ? ' 🔒' : '');
    li.onclick = () => isMine ? selectChannel(ch.id, ch.name) : joinAndSelectChannel(ch.id, ch.name);
    if (ch.id === activeChannelId) li.classList.add('active');
    container.appendChild(li);
  });
}

async function selectChannel(id, name) {
  activeChannelId = id;
  document.getElementById('current-channel-name').textContent = name;
  document.getElementById('message-input').disabled = false;
  document.getElementById('send-btn').disabled = false;

  const voiceBtn = document.getElementById('voice-btn');
  if (voiceBtn) voiceBtn.classList.remove('hidden');

  if (isVoiceConnected) {
    toggleVoice();
  }

  loadChannels();
  loadMessages(id);
}

async function joinAndSelectChannel(id, name) {
  try {
    await api(`/channels/${id}/join`, { method: 'POST' });
    selectChannel(id, name);
  } catch (err) {
    alert(err.message);
  }
}

async function loadMessages(channelId) {
  const container = document.getElementById('message-container');
  container.innerHTML = '';
  try {
    const messages = await api(`/channels/${channelId}/messages`);
    messages.forEach(appendMessage);
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

function appendMessage(msg) {
  const container = document.getElementById('message-container');
  const div = document.createElement('div');
  div.className = 'message';
  
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<strong>${msg.username}</strong> <span class="time">${time}</span><br>${msg.content}`;
  
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !activeChannelId || !ws) return;

  ws.send(JSON.stringify({
    type: 'message',
    channelId: activeChannelId,
    content
  }));

  input.value = '';
}

// Voice Chat Logic
async function toggleVoice() {
  if (!activeChannelId) return;

  const btn = document.getElementById('voice-btn');

  if (isVoiceConnected) {
    if (currentRoom) {
      await currentRoom.disconnect();
      currentRoom = null;
    }
    isVoiceConnected = false;
    btn.textContent = 'Join Voice';
    btn.classList.remove('danger');
    return;
  }

  btn.textContent = 'Connecting...';
  btn.disabled = true;

  try {
    const res = await api(`/channels/${activeChannelId}/voice-token`);
    if (!res.token) throw new Error(res.error || 'Failed to fetch token');

    const room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
    });

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === LivekitClient.Track.Kind.Audio) {
        const audioElement = track.attach();
        document.body.appendChild(audioElement);
      }
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });

    await room.connect(res.url, res.token);
    await room.localParticipant.setMicrophoneEnabled(true);

    currentRoom = room;
    isVoiceConnected = true;
    btn.textContent = 'Leave Voice';
    btn.classList.add('danger');
  } catch (err) {
    alert('Voice connection failed: ' + err.message);
    btn.textContent = 'Join Voice';
  } finally {
    btn.disabled = false;
  }
}

// Modal Helpers
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

async function createChannel() {
  const name = document.getElementById('new-channel-name').value;
  const isPrivate = document.getElementById('new-channel-private').checked;
  if (!name) return;

  try {
    const channel = await api('/channels', {
      method: 'POST',
      body: JSON.stringify({ name, isPrivate })
    });
    closeModal('create-channel-modal');
    selectChannel(channel.id, channel.name);
  } catch (err) {
    alert(err.message);
  }
}

async function joinByCode() {
  const code = document.getElementById('invite-code-input').value.trim();
  if (!code) return;

  try {
    const res = await api('/channels/join-by-code', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    closeModal('join-code-modal');
    selectChannel(res.channel.id, res.channel.name);
  } catch (err) {
    alert(err.message);
  }
}