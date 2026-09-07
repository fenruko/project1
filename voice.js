// Voice chat - LiveKit integration
let vkRoom = null;
let vkChannelId = null;
let vkMuted = false;
let vkDeafened = false;
let vkCameraOn = false;
let vkScreenOn = false;

// High-quality audio publish settings (LiveKit defaults are low-bitrate speech mode,
// which is the main reason default voice quality sounds bad).
const AUDIO_PUBLISH_OPTS = {
  audioPreset: LivekitClient.AudioPresets.musicHighQualityStereo,
  dtx: false,
  red: true,
  forceStereo: true,
};
const AUDIO_CAPTURE_OPTS = {
  channelCount: 2,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function saveDevicePref(kind, deviceId) {
  localStorage.setItem('device_' + kind, deviceId);
}
function loadDevicePref(kind) {
  return localStorage.getItem('device_' + kind) || undefined;
}

async function joinVoice(channelId) {
  if (vkRoom) await leaveVoice();

  const { token, url } = await api('/voice/token', {
    method: 'POST',
    body: JSON.stringify({ channelId }),
  });

  const room = new LivekitClient.Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: AUDIO_PUBLISH_OPTS,
    audioCaptureDefaults: AUDIO_CAPTURE_OPTS,
  });
  vkRoom = room;
  vkChannelId = channelId;

  room.on(LivekitClient.RoomEvent.ParticipantConnected, renderVoiceParticipants);
  room.on(LivekitClient.RoomEvent.ParticipantDisconnected, renderVoiceParticipants);
  room.on(LivekitClient.RoomEvent.ConnectionQualityChanged, renderVoiceParticipants);
  room.on(LivekitClient.RoomEvent.TrackMuted, renderVoiceParticipants);
  room.on(LivekitClient.RoomEvent.TrackUnmuted, renderVoiceParticipants);

  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
    if (track.kind === 'audio') {
      const el = track.attach();
      el.dataset.participantIdentity = participant.identity;
      const savedOut = loadDevicePref('audiooutput');
      if (savedOut && el.setSinkId) el.setSinkId(savedOut).catch(() => {});
      document.body.appendChild(el);
    } else if (track.kind === 'video') {
      attachVideoTile(track, participant, pub.source === LivekitClient.Track.Source.ScreenShare);
    }
    renderVoiceParticipants();
  });

  room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
    updateVideoGridVisibility();
  });

  room.on(LivekitClient.RoomEvent.LocalTrackPublished, (pub) => {
    if (pub.track && pub.track.kind === 'video') {
      attachVideoTile(pub.track, room.localParticipant, pub.source === LivekitClient.Track.Source.ScreenShare);
    }
  });
  room.on(LivekitClient.RoomEvent.LocalTrackUnpublished, (pub) => {
    if (pub.track) {
      pub.track.detach().forEach((el) => el.remove());
      updateVideoGridVisibility();
    }
  });

  await room.connect(url, token);
  await room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE_OPTS, AUDIO_PUBLISH_OPTS);

  const savedMic = loadDevicePref('audioinput');
  if (savedMic && room.switchActiveDevice) {
    room.switchActiveDevice('audioinput', savedMic).catch(() => {});
  }

  $('voice-panel').classList.remove('hidden');
  $('btn-join-voice').textContent = '🎙 Connected';
  renderVoiceParticipants();
  refreshDeviceLists();
}

async function leaveVoice() {
  if (!vkRoom) return;
  vkRoom.disconnect();
  vkRoom = null;
  vkChannelId = null;
  vkMuted = false;
  vkDeafened = false;
  vkCameraOn = false;
  vkScreenOn = false;
  $('voice-panel').classList.add('hidden');
  $('btn-join-voice').textContent = '🎙 Join Voice';
  document.querySelectorAll('audio[data-participant-identity]').forEach((el) => el.remove());
  $('video-grid').innerHTML = '';
  updateVideoGridVisibility();
}

function qualityTier(quality) {
  // LiveKit ConnectionQuality: 'excellent' | 'good' | 'poor' | 'unknown'
  if (quality === 'excellent') return 'good';
  if (quality === 'good') return 'ok';
  return 'poor';
}

function renderVoiceParticipants() {
  if (!vkRoom) return;
  const container = $('voice-participants');
  container.innerHTML = '';

  const all = [vkRoom.localParticipant, ...vkRoom.remoteParticipants.values()];
  all.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'vp-row';

    const tier = qualityTier(p.connectionQuality);
    const isLocal = p === vkRoom.localParticipant;
    const micOn = isLocal ? !vkMuted : [...p.audioTrackPublications.values()].some((pub) => !pub.isMuted);

    row.innerHTML = `
      <div class="vp-avatar"><span class="vp-latency ${tier}"></span></div>
      <span class="vp-name">${escapeHtml(p.name || p.identity)}${isLocal ? ' (you)' : ''}</span>
      <span class="vp-muted">${micOn ? '' : '🔇'}</span>
    `;

    if (!isLocal) {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '2';
      slider.step = '0.1';
      slider.value = '1';
      slider.className = 'vp-volume';
      slider.oninput = () => {
        document.querySelectorAll(`audio[data-participant-identity="${p.identity}"]`)
          .forEach((el) => { el.volume = Math.min(1, slider.value); });
      };
      row.appendChild(slider);
    }

    container.appendChild(row);
  });
}

// ---- Video (camera + screen share) ----
function attachVideoTile(track, participant, isScreenShare) {
  const grid = $('video-grid');
  const el = track.attach();
  el.className = 'video-tile-el';
  el.dataset.trackSid = track.sid;

  const wrapper = document.createElement('div');
  wrapper.className = 'video-tile';
  wrapper.dataset.trackSid = track.sid;
  const label = document.createElement('div');
  label.className = 'video-tile-label';
  const isLocal = participant === vkRoom.localParticipant;
  label.textContent = (isLocal ? 'You' : (participant.name || participant.identity)) + (isScreenShare ? ' (screen)' : '');
  wrapper.appendChild(el);
  wrapper.appendChild(label);
  grid.appendChild(wrapper);
  updateVideoGridVisibility();
}

function updateVideoGridVisibility() {
  const grid = $('video-grid');
  grid.classList.toggle('hidden', grid.children.length === 0);
}

$('btn-camera').onclick = async () => {
  if (!vkRoom) return;
  vkCameraOn = !vkCameraOn;
  const savedCam = loadDevicePref('videoinput');
  await vkRoom.localParticipant.setCameraEnabled(vkCameraOn, savedCam ? { deviceId: savedCam } : undefined);
  $('btn-camera').classList.toggle('active', vkCameraOn);
};

$('btn-screenshare').onclick = async () => {
  if (!vkRoom) return;
  vkScreenOn = !vkScreenOn;
  try {
    await vkRoom.localParticipant.setScreenShareEnabled(vkScreenOn);
  } catch {
    vkScreenOn = false; // user cancelled the browser's screen picker
  }
  $('btn-screenshare').classList.toggle('active', vkScreenOn);
};

// ---- Device selection ----
async function refreshDeviceLists() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillDeviceSelect('select-mic', devices.filter((d) => d.kind === 'audioinput'), 'audioinput');
    fillDeviceSelect('select-speaker', devices.filter((d) => d.kind === 'audiooutput'), 'audiooutput');
    fillDeviceSelect('select-camera', devices.filter((d) => d.kind === 'videoinput'), 'videoinput');
  } catch (err) {
    console.error('Could not list devices', err);
  }
}

function fillDeviceSelect(selectId, devices, kind) {
  const select = $(selectId);
  const current = loadDevicePref(kind);
  select.innerHTML = '';
  devices.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `${kind} ${i + 1}`;
    if (d.deviceId === current) opt.selected = true;
    select.appendChild(opt);
  });
}

$('select-mic').onchange = async (e) => {
  saveDevicePref('audioinput', e.target.value);
  if (vkRoom && vkRoom.switchActiveDevice) {
    try { await vkRoom.switchActiveDevice('audioinput', e.target.value); } catch (err) { console.error(err); }
  }
};
$('select-camera').onchange = async (e) => {
  saveDevicePref('videoinput', e.target.value);
  if (vkRoom && vkRoom.switchActiveDevice) {
    try { await vkRoom.switchActiveDevice('videoinput', e.target.value); } catch (err) { console.error(err); }
  }
};
$('select-speaker').onchange = async (e) => {
  saveDevicePref('audiooutput', e.target.value);
  // Not all browsers support output switching (setSinkId) - fails silently where unsupported.
  document.querySelectorAll('audio[data-participant-identity]').forEach((el) => {
    if (el.setSinkId) el.setSinkId(e.target.value).catch(() => {});
  });
  if (vkRoom && vkRoom.switchActiveDevice) {
    try { await vkRoom.switchActiveDevice('audiooutput', e.target.value); } catch (err) { /* unsupported in this browser */ }
  }
};

$('btn-voice-settings').onclick = () => {
  $('voice-settings').classList.toggle('hidden');
  refreshDeviceLists();
};

$('btn-join-voice').onclick = () => {
  if (vkRoom) return leaveVoice();
  if (currentChannel) joinVoice(currentChannel.id);
};

$('btn-leave-voice').onclick = leaveVoice;

$('btn-mute').onclick = async () => {
  if (!vkRoom) return;
  vkMuted = !vkMuted;
  await vkRoom.localParticipant.setMicrophoneEnabled(!vkMuted);
  $('btn-mute').classList.toggle('active', vkMuted);
  renderVoiceParticipants();
};

$('btn-deafen').onclick = () => {
  if (!vkRoom) return;
  vkDeafened = !vkDeafened;
  $('btn-deafen').classList.toggle('active', vkDeafened);
  document.querySelectorAll('audio[data-participant-identity]').forEach((el) => {
    el.muted = vkDeafened;
  });
  // Deafening also mutes your own mic, like Discord
  if (vkDeafened && !vkMuted) $('btn-mute').click();
};

navigator.mediaDevices?.addEventListener?.('devicechange', refreshDeviceLists);
setInterval(() => { if (vkRoom) renderVoiceParticipants(); }, 4000);
