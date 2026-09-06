// Voice chat - LiveKit integration
let vkRoom = null;
let vkChannelId = null;
let vkMuted = false;
let vkDeafened = false;

async function joinVoice(channelId) {
  if (vkRoom) await leaveVoice();

  const { token, url } = await api('/voice/token', {
    method: 'POST',
    body: JSON.stringify({ channelId }),
  });

  const room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
  vkRoom = room;
  vkChannelId = channelId;

  room.on(LivekitClient.RoomEvent.ParticipantConnected, renderVoiceParticipants);
  room.on(LivekitClient.RoomEvent.ParticipantDisconnected, renderVoiceParticipants);
  room.on(LivekitClient.RoomEvent.ConnectionQualityChanged, renderVoiceParticipants);
  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
    if (track.kind === 'audio') {
      const el = track.attach();
      el.dataset.participantIdentity = participant.identity;
      document.body.appendChild(el);
    }
    renderVoiceParticipants();
  });
  room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
  });

  await room.connect(url, token);
  await room.localParticipant.setMicrophoneEnabled(true);

  $('voice-panel').classList.remove('hidden');
  $('btn-join-voice').textContent = '🎙 Connected';
  renderVoiceParticipants();
}

async function leaveVoice() {
  if (!vkRoom) return;
  vkRoom.disconnect();
  vkRoom = null;
  vkChannelId = null;
  vkMuted = false;
  vkDeafened = false;
  $('voice-panel').classList.add('hidden');
  $('btn-join-voice').textContent = '🎙 Join Voice';
  document.querySelectorAll('audio[data-participant-identity]').forEach((el) => el.remove());
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

    const initial = (p.name || p.identity || '?')[0].toUpperCase();
    const tier = qualityTier(p.connectionQuality);
    const isLocal = p === vkRoom.localParticipant;
    const micOn = isLocal ? !vkMuted : [...p.audioTrackPublications.values()].some((pub) => !pub.isMuted);

    row.innerHTML = `
      <div class="vp-avatar">${initial}<span class="vp-latency ${tier}"></span></div>
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

setInterval(() => { if (vkRoom) renderVoiceParticipants(); }, 4000);
