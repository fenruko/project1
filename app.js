let token = localStorage.getItem('token');
let me = JSON.parse(localStorage.getItem('me') || 'null');
let currentChannel = null;
let ws = null;
let myChannels = [];
let editingMessageId = null;
const messageElements = new Map(); // message id -> { item, contentSpan, timeSpan }
const mutedChannels = new Set(JSON.parse(localStorage.getItem('muted_channels') || '[]'));
const userAvatars = new Map(); // userId -> avatar url, filled in as messages arrive
const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%235865f2'/%3E%3Ccircle cx='12' cy='9' r='4.2' fill='%23e3e5e8'/%3E%3Cpath d='M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7' fill='%23e3e5e8'/%3E%3C/svg%3E";

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
  $('me-avatar').src = me.avatarUrl || DEFAULT_AVATAR;
  $('avatar-preview').src = me.avatarUrl || DEFAULT_AVATAR;
  if (me.avatarUrl) userAvatars.set(me.id, me.avatarUrl);
  loadChannels();
  applyStoredBackground();
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
  myChannels = mine;

  $('my-channels').innerHTML = '';
  mine.forEach((c) => {
    const li = document.createElement('li');
    li.dataset.channelId = c.id;

    const label = document.createElement('span');
    label.textContent = (c.is_private ? '🔒 ' : '# ') + c.name;
    label.onclick = () => openChannel(c);
    li.appendChild(label);

    const dot = document.createElement('span');
    dot.className = 'unread-dot hidden';
    li.appendChild(dot);

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
      ensureWSConnected();
    };
    $('public-channels').appendChild(li);
  });

  ensureWSConnected();
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

// ---- Realtime connection: one socket, joined to every channel you're in ----
function ensureWSConnected() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
    joinAllChannels();
    return;
  }
  ws = new WebSocket(`${WS_BASE}?token=${token}`);
  ws.onopen = joinAllChannels;
  ws.onmessage = handleWSMessage;
}

function joinAllChannels() {
  if (!ws || ws.readyState !== 1) return;
  myChannels.forEach((c) => ws.send(JSON.stringify({ type: 'join', channelId: c.id })));
}

function handleWSMessage(event) {
  const msg = JSON.parse(event.data);

  if (msg.type === 'message') {
    if (currentChannel && msg.channelId === currentChannel.id) {
      renderMessage(msg);
      scrollToBottom();
    } else {
      markUnread(msg.channelId);
    }
    maybeNotify(msg);
  }

  if (msg.type === 'edit' && currentChannel && msg.channelId === currentChannel.id) {
    const entry = messageElements.get(msg.id);
    if (entry) {
      entry.contentSpan.textContent = msg.content;
      entry.timeSpan.textContent = entry.timeLabel + ' (edited)';
    }
  }

  if (msg.type === 'delete' && currentChannel && msg.channelId === currentChannel.id) {
    const entry = messageElements.get(msg.id);
    if (entry) {
      const bodyEl = entry.item.parentElement;
      entry.item.remove();
      messageElements.delete(msg.id);
      if (bodyEl && !bodyEl.querySelector('.msg-item')) {
        bodyEl.closest('.msg-group')?.remove();
        if (lastRenderedMsg && lastRenderedMsg.bodyEl === bodyEl) lastRenderedMsg = null;
      }
    }
  }

  if (msg.type === 'error') alert(msg.error);
}

function markUnread(channelId) {
  const li = document.querySelector(`#my-channels li[data-channel-id="${channelId}"]`);
  li?.querySelector('.unread-dot')?.classList.remove('hidden');
}

// ---- Chat ----
let lastRenderedMsg = null; // tracks last message group for consecutive-message grouping

async function openChannel(channel) {
  currentChannel = channel;
  $('channel-title').textContent = (channel.is_private ? '🔒 ' : '# ') + channel.name;
  $('composer').classList.remove('hidden');
  $('btn-join-voice').classList.remove('hidden');
  $('btn-mute-channel').classList.remove('hidden');
  updateMuteChannelButton();
  $('messages').innerHTML = '';
  messageElements.clear();
  lastRenderedMsg = null;
  cancelEdit();

  const li = document.querySelector(`#my-channels li[data-channel-id="${channel.id}"]`);
  li?.querySelector('.unread-dot')?.classList.add('hidden');

  const history = await api(`/channels/${channel.id}/messages`);
  history.forEach(renderMessage);
  scrollToBottom();

  ensureWSConnected();
}

const GROUP_WINDOW_MS = 5 * 60 * 1000; // messages within 5 min of the same author are grouped

function renderMessage(msg) {
  if (msg.userId && msg.avatar_url) userAvatars.set(msg.userId, msg.avatar_url);
  const time = new Date(msg.created_at);
  const timeLabel = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const canGroup = lastRenderedMsg &&
    lastRenderedMsg.username === msg.username &&
    (time - lastRenderedMsg.time) < GROUP_WINDOW_MS;

  let bodyEl;
  if (canGroup) {
    bodyEl = lastRenderedMsg.bodyEl;
  } else {
    const group = document.createElement('div');
    group.className = 'msg-group';

    const avatar = document.createElement('img');
    avatar.className = 'msg-avatar';
    avatar.src = msg.avatar_url || userAvatars.get(msg.userId) || DEFAULT_AVATAR;
    avatar.alt = '';

    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = `<div class="msg-header"><span class="author">${escapeHtml(msg.username)}</span></div>`;

    group.appendChild(avatar);
    group.appendChild(body);
    $('messages').appendChild(group);

    bodyEl = body;
    lastRenderedMsg = { username: msg.username, time, bodyEl };
  }
  lastRenderedMsg.time = time;

  const item = document.createElement('div');
  item.className = 'msg-item';
  item.dataset.id = msg.id;

  const line = document.createElement('div');
  line.className = 'msg-line';

  const contentSpan = document.createElement('span');
  contentSpan.className = 'msg-content';
  contentSpan.textContent = msg.content || '';
  line.appendChild(contentSpan);

  const timeSpan = document.createElement('span');
  timeSpan.className = 'time-inline';
  timeSpan.textContent = timeLabel + (msg.edited_at ? ' (edited)' : '');
  line.appendChild(timeSpan);

  item.appendChild(line);
  if (msg.attachment_url) item.appendChild(renderAttachment(msg));

  const isMine = (msg.userId && msg.userId === me.id) || msg.username === me.username;
  if (isMine) {
    const actions = document.createElement('span');
    actions.className = 'msg-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.onclick = () => startEditMessage(msg.id, contentSpan.textContent);
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn';
    delBtn.textContent = '🗑️';
    delBtn.title = 'Delete';
    delBtn.onclick = () => {
      if (confirm('Delete this message?')) {
        ws.send(JSON.stringify({ type: 'delete', channelId: currentChannel.id, id: msg.id }));
      }
    };
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    item.appendChild(actions);
  }

  bodyEl.appendChild(item);
  messageElements.set(msg.id, { item, contentSpan, timeSpan, timeLabel });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function scrollToBottom() {
  $('messages').scrollTop = $('messages').scrollHeight;
}

// ---- Sending / editing messages ----
$('btn-send').onclick = sendMessage;
$('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
  if (e.key === 'Escape') cancelEdit();
});
$('btn-cancel-edit').onclick = cancelEdit;

function sendMessage() {
  const input = $('message-input');
  const content = input.value.trim();
  if (!content || !ws || !currentChannel) return;

  if (editingMessageId) {
    ws.send(JSON.stringify({ type: 'edit', channelId: currentChannel.id, id: editingMessageId, content }));
    cancelEdit();
  } else {
    ws.send(JSON.stringify({ type: 'message', channelId: currentChannel.id, content }));
  }
  input.value = '';
}

function startEditMessage(id, currentText) {
  editingMessageId = id;
  $('message-input').value = currentText;
  $('message-input').focus();
  $('btn-send').textContent = 'Save';
  $('btn-cancel-edit').classList.remove('hidden');
}

function cancelEdit() {
  editingMessageId = null;
  $('message-input').value = '';
  $('btn-send').textContent = 'Send';
  $('btn-cancel-edit').classList.add('hidden');
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
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
  if (msg.attachment_type === 'video') {
    const video = document.createElement('video');
    video.className = 'attachment-video';
    video.src = msg.attachment_url;
    video.controls = true;
    return video;
  }
  if (msg.attachment_type === 'audio') {
    const audio = document.createElement('audio');
    audio.className = 'attachment-audio';
    audio.src = msg.attachment_url;
    audio.controls = true;
    return audio;
  }
  const link = document.createElement('a');
  link.className = 'attachment-file';
  link.href = msg.attachment_url;
  link.target = '_blank';
  link.download = msg.attachment_name || '';
  link.innerHTML = `
    <span class="file-icon">📄</span>
    <span class="file-meta">
      <div class="file-name">${escapeHtml(msg.attachment_name || 'file')}</div>
      <div class="file-size">${formatBytes(msg.attachment_size)}</div>
    </span>
  `;
  return link;
}

// ---- File upload (direct browser -> Backblaze, never touches the backend) ----
$('btn-attach').onclick = () => $('file-input').click();

$('file-input').onchange = async () => {
  const file = $('file-input').files[0];
  $('file-input').value = '';
  if (!file || !currentChannel) return;

  let attachmentType = 'file';
  if (file.type.startsWith('image/')) attachmentType = 'image';
  else if (file.type.startsWith('audio/')) attachmentType = 'audio';
  else if (file.type.startsWith('video/')) attachmentType = 'video';

  const progressEl = $('upload-progress');
  progressEl.classList.remove('hidden');
  progressEl.textContent = `Uploading ${file.name}... 0%`;

  try {
    const { uploadUrl, key } = await api('/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
    });

    await uploadDirectToStorage(uploadUrl, file, (pct) => {
      progressEl.textContent = `Uploading ${file.name}... ${pct}%`;
    });

    progressEl.classList.add('hidden');

    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'message',
        channelId: currentChannel.id,
        content: '',
        attachmentKey: key,
        attachmentType,
        attachmentName: file.name,
        attachmentSize: file.size,
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

// ---- Emoji picker (official emoji-picker-element library) ----
let emojiPickerBuilt = false;
$('btn-emoji').onclick = () => {
  const pop = $('emoji-popover');
  if (!emojiPickerBuilt) {
    const picker = document.createElement('emoji-picker');
    picker.addEventListener('emoji-click', (e) => {
      const input = $('message-input');
      input.value += e.detail.unicode;
      input.focus();
    });
    pop.appendChild(picker);
    emojiPickerBuilt = true;
  }
  pop.classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  if (!$('emoji-popover').contains(e.target) && e.target !== $('btn-emoji')) {
    $('emoji-popover').classList.add('hidden');
  }
});

// ---- Notifications ----
function loadNotifPrefs() {
  $('notif-global-toggle').checked = localStorage.getItem('notif_enabled') !== 'false';
  updateNotifStatus();
}
function updateNotifStatus() {
  const perm = window.Notification ? Notification.permission : 'unsupported';
  $('notif-status').textContent =
    perm === 'granted' ? 'Browser notifications are enabled.' :
    perm === 'denied' ? 'Browser notifications are blocked in your browser settings.' :
    'Browser notifications not yet enabled.';
}
$('notif-global-toggle').onchange = (e) => {
  localStorage.setItem('notif_enabled', e.target.checked ? 'true' : 'false');
};
$('btn-enable-browser-notif').onclick = async () => {
  if (!window.Notification) return alert('This browser does not support notifications.');
  await Notification.requestPermission();
  updateNotifStatus();
};

function updateMuteChannelButton() {
  const muted = mutedChannels.has(currentChannel?.id);
  $('btn-mute-channel').textContent = muted ? '🔕' : '🔔';
  $('btn-mute-channel').title = muted ? 'Unmute this channel' : 'Mute this channel';
}
$('btn-mute-channel').onclick = () => {
  if (!currentChannel) return;
  if (mutedChannels.has(currentChannel.id)) mutedChannels.delete(currentChannel.id);
  else mutedChannels.add(currentChannel.id);
  localStorage.setItem('muted_channels', JSON.stringify([...mutedChannels]));
  updateMuteChannelButton();
};

function maybeNotify(msg) {
  if (localStorage.getItem('notif_enabled') === 'false') return;
  if (mutedChannels.has(msg.channelId)) return;
  if (currentChannel && msg.channelId === currentChannel.id && !document.hidden) return;
  if (!window.Notification || Notification.permission !== 'granted') return;
  if (msg.username === me.username) return;

  const channel = myChannels.find((c) => c.id === msg.channelId);
  const n = new Notification(`${msg.username} in #${channel?.name || 'channel'}`, {
    body: msg.content || '[attachment]',
  });
  n.onclick = () => {
    window.focus();
    if (channel) openChannel(channel);
  };
}

// ---- Settings overlay ----
$('btn-open-settings').onclick = () => {
  $('settings-overlay').classList.remove('hidden');
  loadNotifPrefs();
};
$('btn-close-settings').onclick = () => $('settings-overlay').classList.add('hidden');

// ---- Custom chat background ----
const BG_PRESETS = {
  dark: '#313338',
  black: '#000000',
  white: '#ffffff',
  navy: '#1a1b3a',
};
function applyBackground(style) {
  const main = document.querySelector('.main');
  if (style.type === 'color') {
    main.style.backgroundImage = 'none';
    main.style.backgroundColor = style.value;
  } else {
    main.style.backgroundImage = `url("${style.value}")`;
    main.style.backgroundSize = 'cover';
    main.style.backgroundPosition = 'center';
  }
}
function applyStoredBackground() {
  const saved = JSON.parse(localStorage.getItem('bg_style') || 'null');
  if (saved) applyBackground(saved);
}
document.querySelectorAll('.bg-preset').forEach((btn) => {
  btn.onclick = () => {
    const style = { type: 'color', value: BG_PRESETS[btn.dataset.bg] };
    applyBackground(style);
    localStorage.setItem('bg_style', JSON.stringify(style));
  };
});
$('btn-apply-bg-url').onclick = () => {
  const url = $('bg-url-input').value.trim();
  if (!url) return;
  const style = { type: 'image', value: url };
  applyBackground(style);
  localStorage.setItem('bg_style', JSON.stringify(style));
};
$('bg-file-input').onchange = () => {
  const file = $('bg-file-input').files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) {
    alert('Please pick an image under 3MB - custom backgrounds are stored locally in your browser.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const style = { type: 'image', value: reader.result };
    applyBackground(style);
    try {
      localStorage.setItem('bg_style', JSON.stringify(style));
    } catch {
      alert('That image was too large to save for next time, but it is applied for this session.');
    }
  };
  reader.readAsDataURL(file);
};

if (token && me) showApp();
else showAuth();

// ---- Profile picture: upload or GIPHY GIF ----
async function setAvatar(avatarType, avatarValue) {
  const { avatarUrl } = await api('/avatar', {
    method: 'PATCH',
    body: JSON.stringify({ avatarType, avatarValue }),
  });
  me.avatarUrl = avatarUrl;
  localStorage.setItem('me', JSON.stringify(me));
  userAvatars.set(me.id, avatarUrl);
  $('me-avatar').src = avatarUrl;
  $('avatar-preview').src = avatarUrl;
}

$('avatar-file-input').onchange = async () => {
  const file = $('avatar-file-input').files[0];
  $('avatar-file-input').value = '';
  if (!file) return;
  try {
    const { uploadUrl, key } = await api('/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type || 'image/png', size: file.size }),
    });
    await uploadDirectToStorage(uploadUrl, file, () => {});
    await setAvatar('upload', key);
  } catch (err) {
    alert('Could not set profile picture: ' + err.message);
  }
};

$('btn-open-giphy').onclick = () => {
  $('giphy-popover').classList.toggle('hidden');
};

let giphySearchTimer = null;
$('giphy-search').addEventListener('input', (e) => {
  clearTimeout(giphySearchTimer);
  giphySearchTimer = setTimeout(() => searchGiphy(e.target.value.trim()), 400);
});

async function searchGiphy(query) {
  const results = $('giphy-results');
  if (!query) { results.innerHTML = ''; return; }
  if (!GIPHY_API_KEY || GIPHY_API_KEY === 'YOUR_GIPHY_KEY_HERE') {
    results.innerHTML = '<p class="hint">Add your GIPHY API key to config.js first.</p>';
    return;
  }
  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=9&rating=pg-13`);
    const data = await res.json();
    results.innerHTML = '';
    (data.data || []).forEach((gif) => {
      const img = document.createElement('img');
      img.src = gif.images.fixed_width_small.url;
      img.className = 'giphy-thumb';
      img.onclick = async () => {
        await setAvatar('external', gif.images.original.url);
        $('giphy-popover').classList.add('hidden');
      };
      results.appendChild(img);
    });
  } catch {
    results.innerHTML = '<p class="hint">Could not reach GIPHY.</p>';
  }
}
