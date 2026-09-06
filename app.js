let token = localStorage.getItem('token');
let me = JSON.parse(localStorage.getItem('me') || 'null');
let currentChannel = null;
let ws = null;

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showApp() {
  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('me').textContent = me.username;
  loadChannels();
}

function showAuth() {
  $('auth-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
}

// ---- Auth ----
$('btn-signup').onclick = () => doAuth('/auth/signup');
$('btn-login').onclick = () => doAuth('/auth/login');

async function doAuth(path) {
  $('auth-error').textContent = '';
  try {
    const data = await api(path, {
      method: 'POST',
      body: JSON.stringify({
        username: $('auth-username').value,
        password: $('auth-password').value,
      }),
    });
    token = data.token;
    me = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('me', JSON.stringify(me));
    showApp();
  } catch (err) {
    $('auth-error').textContent = err.message;
  }
}

$('btn-logout').onclick = () => {
  localStorage.clear();
  token = null;
  me = null;
  if (ws) ws.close();
  showAuth();
};

// ---- Channels ----
async function loadChannels() {
  const [mine, pub] = await Promise.all([api('/channels/mine'), api('/channels/public')]);

  $('my-channels').innerHTML = '';
  mine.forEach((c) => {
    const li = document.createElement('li');
    li.textContent = (c.is_private ? '🔒 ' : '# ') + c.name;
    li.onclick = () => openChannel(c);
    $('my-channels').appendChild(li);
  });

  $('public-channels').innerHTML = '';
  const myIds = new Set(mine.map((c) => c.id));
  pub.filter((c) => !myIds.has(c.id)).forEach((c) => {
    const li = document.createElement('li');
    li.textContent = '# ' + c.name + ' (join)';
    li.onclick = async () => {
      await api(`/channels/${c.id}/join`, { method: 'POST' });
      await loadChannels();
    };
    $('public-channels').appendChild(li);
  });
}

$('btn-create-channel').onclick = async () => {
  const name = $('new-channel-name').value.trim();
  if (!name) return;
  const isPrivate = $('new-channel-private').checked;
  const channel = await api('/channels', { method: 'POST', body: JSON.stringify({ name, isPrivate }) });
  $('new-channel-name').value = '';
  await loadChannels();
  if (channel.invite_code) alert('Invite code: ' + channel.invite_code);
  openChannel(channel);
};

$('btn-join-code').onclick = async () => {
  const code = $('invite-code').value.trim();
  if (!code) return;
  try {
    const { channel } = await api('/channels/join-by-code', { method: 'POST', body: JSON.stringify({ code }) });
    $('invite-code').value = '';
    await loadChannels();
    openChannel(channel);
  } catch (err) {
    alert(err.message);
  }
};

// ---- Chat ----
async function openChannel(channel) {
  currentChannel = channel;
  $('channel-header').textContent = (channel.is_private ? '🔒 ' : '# ') + channel.name;
  $('composer').classList.remove('hidden');
  $('messages').innerHTML = '';

  const history = await api(`/channels/${channel.id}/messages`);
  history.forEach(renderMessage);
  scrollToBottom();

  connectWS(channel.id);
}

function connectWS(channelId) {
  if (ws) ws.close();
  ws = new WebSocket(`${WS_BASE}?token=${token}`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', channelId }));
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'message') {
      renderMessage(msg);
      scrollToBottom();
    }
    if (msg.type === 'error') alert(msg.error);
  };
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg';
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<span class="author">${escapeHtml(msg.username)}</span><span class="time">${time}</span>
                    <div class="content">${escapeHtml(msg.content)}</div>`;
  $('messages').appendChild(div);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function scrollToBottom() {
  $('messages').scrollTop = $('messages').scrollHeight;
}

$('btn-send').onclick = sendMessage;
$('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
  const input = $('message-input');
  const content = input.value.trim();
  if (!content || !ws) return;
  ws.send(JSON.stringify({ type: 'message', content }));
  input.value = '';
}

// ---- Init ----
if (token && me) showApp();
else showAuth();
