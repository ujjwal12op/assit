const $ = (id) => document.getElementById(id);
const connectButton = $('connectButton');
const stopButton = $('stopButton');
const pairInput = $('pairCode');
const status = $('companionStatus');
let pairId = '';
let captureStream = null;
let audioContext = null;
let analyser = null;
let animationFrame = null;
let recorder = null;
let mimeType = '';
let speechAt = 0;
let recordingAt = 0;
let uploading = Promise.resolve();
let stopping = false;
let sendingAudio = false;
let lastDiagnosticAt = 0;
const samples = new Float32Array(512);
const isDesktopAudioApp = window.interviewCopilotDesktop?.systemAudioLoopback === true;

if (isDesktopAudioApp) {
  const hint = document.querySelector('.hint');
  if (hint) hint.textContent = 'This desktop app captures Windows playback directly, including audio sent to connected headphones. Keep the app open and use the six-character code shown in your phone session.';
}

async function request(action, details = {}) {
  const response = await fetch('/api/interviewer-audio-pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...details })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Connection request failed.');
  return data;
}

function startRecording() {
  if (!pairId || !captureStream || recorder?.state === 'recording') return;
  // Every MediaRecorder owns its own chunk list. A new utterance can start
  // before the prior recorder's asynchronous stop event fires; a shared list
  // lets the new start clear or mix the previous utterance's audio.
  const recorderChunks = [];
  try {
    const audioOnlyStream = new MediaStream(captureStream.getAudioTracks());
    recorder = new MediaRecorder(audioOnlyStream, mimeType ? { mimeType } : undefined);
    const activeRecorder = recorder;
    recordingAt = Date.now();
    activeRecorder.ondataavailable = (event) => { if (event.data?.size) recorderChunks.push(event.data); };
    activeRecorder.onerror = () => { status.textContent = 'Audio capture was interrupted. Check the sharing permission.'; };
    activeRecorder.onstop = () => {
      const blob = new Blob(recorderChunks, { type: mimeType || recorderChunks[0]?.type || 'audio/webm' });
      if (recorder === activeRecorder) recorder = null;
      if (blob.size < 1_200 || !pairId) {
        status.textContent = 'Audio activity was detected, but the browser produced no usable recording. Try sharing the meeting tab or window audio.';
        return;
      }
      sendingAudio = true;
      status.textContent = 'Interviewer speech captured · sending audio to your phone…';
      const audioMimeType = (blob.type || 'audio/webm').split(';')[0];
      uploading = uploading.then(async () => {
        const audioData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('Could not prepare an audio segment.'));
          reader.readAsDataURL(blob);
        });
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await request('upload', { id: pairId, audioData, audioMimeType });
            status.textContent = 'Connected · interviewer audio is being sent to your phone.';
            sendingAudio = false;
            return;
          } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
        status.textContent = (lastError?.message || 'Upload failed.') + ' Capture remains active; retrying with the next segment.';
        sendingAudio = false;
      }).catch((error) => {
        status.textContent = error.message || 'Could not send this audio segment.';
        sendingAudio = false;
      });
    };
    activeRecorder.start();
  } catch (error) {
    recorder = null;
    status.textContent = error.message || 'This browser could not record the shared audio source.';
  }
}

function stopRecording() {
  if (recorder?.state === 'recording') {
    try { recorder.stop(); } catch { /* Already stopping. */ }
  }
}

function monitorAudio() {
  if (!pairId || !analyser || stopping) return;
  analyser.getFloatTimeDomainData(samples);
  let sum = 0, peak = 0;
  for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  const level = Math.sqrt(sum / samples.length);
  const now = Date.now();
  if (level > 0.0035) {
    speechAt = now;
    if (recorder?.state !== 'recording') startRecording();
  }
  if (recorder?.state === 'recording') {
    const duration = now - recordingAt;
    if (duration >= 25_000 || (speechAt && now - speechAt > 1_000 && duration > 750)) stopRecording();
  }
  if (now - lastDiagnosticAt > 1_200 && !sendingAudio && recorder?.state !== 'recording') {
    lastDiagnosticAt = now;
    const videoTrack = captureStream?.getVideoTracks()[0];
    const audioTrack = captureStream?.getAudioTracks()[0];
    const surface = videoTrack?.getSettings?.().displaySurface;
    if (level < 0.0008) {
      const audioState = audioTrack ? 'track ' + audioTrack.readyState + (audioTrack.muted ? ', muted' : '') + (audioTrack.enabled ? '' : ', disabled') : 'no audio track';
      status.textContent = isDesktopAudioApp
        ? 'No Windows playback signal · RMS ' + level.toFixed(4) + ' · peak ' + peak.toFixed(3) + ' · ' + audioState + '. Check that audio is playing and Windows is outputting to the intended device. Headphones are supported.'
        : 'Connected, but the selected source is silent · RMS ' + level.toFixed(4) + ' · peak ' + peak.toFixed(3) + (surface ? ' · source: ' + surface : '') + ' · ' + audioState + '. Choose the Chrome Tab playing the interviewer and enable Share tab audio.';
    } else {
      status.textContent = isDesktopAudioApp
        ? 'Windows playback detected · RMS ' + level.toFixed(4) + ' · peak ' + peak.toFixed(3) + ' · waiting for a pause to send the phrase.'
        : 'Audio signal detected · RMS ' + level.toFixed(4) + ' · peak ' + peak.toFixed(3) + (surface ? ' · source: ' + surface : '') + ' · waiting for a pause to send the phrase.';
    }
  }
  animationFrame = requestAnimationFrame(monitorAudio);
}

async function stopCapture(sendStop = true) {
  stopping = true;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  const oldPairId = pairId;
  const activeRecorder = recorder;
  if (activeRecorder?.state === 'recording') {
    const stopped = new Promise((resolve) => activeRecorder.addEventListener('stop', resolve, { once: true }));
    stopRecording();
    await stopped;
    await uploading.catch(() => {});
  }
  pairId = '';
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
  if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
  audioContext = null;
  analyser = null;
  if (sendStop && oldPairId) {
    try { await request('stop', { id: oldPairId, role: 'laptop' }); } catch { /* The phone may have disconnected already. */ }
  }
  stopping = false;
  connectButton.disabled = false;
  stopButton.disabled = true;
  pairInput.disabled = false;
  status.textContent = 'Disconnected.';
}

connectButton.addEventListener('click', async () => {
  const code = pairInput.value.trim().toUpperCase();
  if (!/^[A-F0-9]{6}$/.test(code)) {
    status.textContent = 'Enter the 6-character pairing code shown on your phone.';
    pairInput.focus();
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder || typeof AudioContext === 'undefined') {
    status.textContent = 'This browser does not support shared-audio capture. Try current Chrome on Windows.';
    return;
  }
  connectButton.disabled = true;
  status.textContent = isDesktopAudioApp ? 'Connecting to Windows playback audio…' : 'Connecting · choose a tab or screen and enable audio sharing…';
  let pendingAudioContext = null;
  try {
    // Create/resume audio and request sharing synchronously from the Connect
    // click. Waiting for the pairing HTTP request first can let Chrome suspend
    // a newly-created context, leaving a valid share with a zero audio meter.
    pendingAudioContext = new AudioContext();
    const audioContextReady = pendingAudioContext.resume();
    const capturePromise = navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: { suppressLocalAudioPlayback: false },
      monitorTypeSurfaces: 'exclude',
      systemAudio: 'include',
      windowAudio: 'system',
      selfBrowserSurface: 'exclude'
    });
    const capture = await capturePromise;
    if (!capture.getAudioTracks().length) {
      const surface = capture.getVideoTracks()[0]?.getSettings?.().displaySurface;
      capture.getTracks().forEach((track) => track.stop());
      const isChrome = /Chrome\/\d+/.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
      throw new Error(isChrome && surface === 'monitor'
        ? 'Chrome does not provide audio when Entire Screen is selected. Choose the Chrome Tab playing the interviewer and enable Share tab audio, or select a Window with audio.'
        : 'The selected source did not provide an audio track. Choose the actual meeting tab or a Window with audio and enable audio sharing.');
    }
    captureStream = capture;
    await audioContextReady;
    if (pendingAudioContext.state !== 'running') throw new Error('Chrome kept the audio monitor suspended. Click Connect again and allow audio playback.');
    const joined = await request('join', { code });
    pairId = joined.id;
    audioContext = pendingAudioContext;
    pendingAudioContext = null;
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    audioContext.createMediaStreamSource(new MediaStream(capture.getAudioTracks())).connect(analyser);
    mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
    capture.getTracks().forEach((track) => {
      track.onended = () => { if (pairId && !stopping) stopCapture(); };
    });
    pairInput.disabled = true;
    connectButton.disabled = true;
    stopButton.disabled = false;
    const surface = capture.getVideoTracks()[0]?.getSettings?.().displaySurface;
    status.textContent = isDesktopAudioApp
      ? 'Connected · capturing Windows playback audio, including headphones. Start or continue interviewer playback.'
      : surface === 'monitor'
      ? 'Connected to Entire Screen. Chrome may not include audio for this source; choose the Chrome Tab or Window playing the interviewer if the audio level stays at zero.'
      : surface === 'browser'
      ? 'Connected to this Chrome Tab · capture stays on this tab. To capture another tab, stop and reconnect choosing that tab.'
      : 'Connected · listening for interviewer audio.';
    monitorAudio();
  } catch (error) {
    if (pendingAudioContext && pendingAudioContext.state !== 'closed') await pendingAudioContext.close().catch(() => {});
    if (pairId) {
      try { await request('stop', { id: pairId, role: 'laptop' }); } catch { /* The phone may have expired this pairing. */ }
    }
    pairId = '';
    captureStream?.getTracks().forEach((track) => track.stop());
    captureStream = null;
    connectButton.disabled = false;
    status.textContent = error.name === 'NotAllowedError'
      ? 'Audio-sharing permission was denied or cancelled. Allow sharing and connect again.'
      : error.message || 'Could not connect. Check the pairing code and try again.';
  }
});

stopButton.addEventListener('click', () => { stopCapture(); });
