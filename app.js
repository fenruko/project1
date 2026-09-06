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
    const label = document.createElement('span');
    label.textContent = (c.is_private ? '🔒 ' : '# ') + c.name;
    label.onclick = () => openChannel(c);
    li.appendChild(label);

    if (c.is_private && c.invite_code) {
      const copyBtn = document.createElement('button');
      copyBtn.textContent = '📋';
      copyBtn.title = 'Copy invite code';
      copyBtn.className = 'link';
      copyBtn.style.marginLeft = '6px';
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(c.invite_code);
        copyBtn.textContent = '✅';
        setTimeout(() => (copyBtn.textContent = '📋'), 1200);
      };
      li.appendChild(copyBtn);
    }
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
let lastRenderedMsg = null; // tracks last message group for consecutive-message grouping

async function openChannel(channel) {
  currentChannel = channel;
  $('channel-title').textContent = (channel.is_private ? '🔒 ' : '# ') + channel.name;
  $('composer').classList.remove('hidden');
  $('btn-join-voice').classList.remove('hidden');
  $('messages').innerHTML = '';
  lastRenderedMsg = null;

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

const GROUP_WINDOW_MS = 5 * 60 * 1000; // messages within 5 min of the same author are grouped

function renderMessage(msg) {
  const time = new Date(msg.created_at);
  const timeLabel = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const canGroup = lastRenderedMsg &&
    lastRenderedMsg.username === msg.username &&
    (time - lastRenderedMsg.time) < GROUP_WINDOW_MS;

  if (canGroup) {
    const line = document.createElement('div');
    line.className = 'msg-line';
    line.innerHTML = msg.content ? `${escapeHtml(msg.content)}<span class="time-inline">${timeLabel}</span>` : `<span class="time-inline">${timeLabel}</span>`;
    lastRenderedMsg.bodyEl.appendChild(line);
    if (msg.attachment_url) lastRenderedMsg.bodyEl.appendChild(renderAttachment(msg));
  } else {
    const group = document.createElement('div');
    group.className = 'msg-group';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';

    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = `<div class="msg-header"><span class="author">${escapeHtml(msg.username)}</span><span class="time">${timeLabel}</span></div>`;

    const line = document.createElement('div');
    line.className = 'msg-line';
    if (msg.content) line.textContent = msg.content;
    body.appendChild(line);
    if (msg.attachment_url) body.appendChild(renderAttachment(msg));

    group.appendChild(avatar);
    group.appendChild(body);
    $('messages').appendChild(group);

    lastRenderedMsg = { username: msg.username, time, bodyEl: body };
  }

  lastRenderedMsg.time = time;
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

function renderAttachment(msg) {
  if (msg.attachment_type === 'image') {
    const img = document.createElement('img');
    img.className = 'attachment-img';
    img.src = msg.attachment_url;
    img.loading = 'lazy';
    img.onclick = () => window.open(msg.attachment_url, '_blank');
    return img;
  }
  const audio = document.createElement('audio');
  audio.className = 'attachment-audio';
  audio.src = msg.attachment_url;
  audio.controls = true;
  return audio;
}

// ---- File upload (direct browser -> R2, never touches the backend) ----
$('btn-attach').onclick = () => $('file-input').click();

$('file-input').onchange = async () => {
  const file = $('file-input').files[0];
  $('file-input').value = '';
  if (!file || !currentChannel) return;

  const isImage = file.type.startsWith('image/');
  const isAudio = file.type.startsWith('audio/');
  if (!isImage && !isAudio) {
    alert('Only image and audio files are supported.');
    return;
  }

  const progressEl = $('upload-progress');
  progressEl.classList.remove('hidden');
  progressEl.textContent = `Uploading ${file.name}... 0%`;

  try {
    const { uploadUrl, key } = await api('/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
    });

    await uploadDirectToStorage(uploadUrl, file, (pct) => {
      progressEl.textContent = `Uploading ${file.name}... ${pct}%`;
    });

    progressEl.classList.add('hidden');

    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'message',
        content: '',
        attachmentKey: key,
        attachmentType: isImage ? 'image' : 'audio',
      }));
    }
  } catch (err) {
    progressEl.classList.add('hidden');
    alert('Upload failed: ' + err.message);
  }
};

function uploadDirectToStorage(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Storage rejected the upload')));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}
if (token && me) showApp();
else showAuth();
