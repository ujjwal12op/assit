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
let chunks = [];
let mimeType = '';
let speechAt = 0;
let recordingAt = 0;
let uploading = Promise.resolve();
let stopping = false;
const samples = new Float32Array(512);

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
  chunks = [];
  try {
    const audioOnlyStream = new MediaStream(captureStream.getAudioTracks());
    recorder = new MediaRecorder(audioOnlyStream, mimeType ? { mimeType } : undefined);
    const activeRecorder = recorder;
    recordingAt = Date.now();
    activeRecorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    activeRecorder.onerror = () => { status.textContent = 'Audio capture was interrupted. Check the sharing permission.'; };
    activeRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || chunks[0]?.type || 'audio/webm' });
      chunks = [];
      if (recorder === activeRecorder) recorder = null;
      if (blob.size < 1_200 || !pairId) return;
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
            return;
          } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
        status.textContent = (lastError?.message || 'Upload failed.') + ' Capture remains active; retrying with the next segment.';
      }).catch((error) => {
        status.textContent = error.message || 'Could not send this audio segment.';
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
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
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
  status.textContent = 'Connecting · choose a tab or screen and enable audio sharing…';
  try {
    // Call directly from the click handler because browsers require a user gesture.
    const capturePromise = navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude'
    });
    const capture = await capturePromise;
    if (!capture.getAudioTracks().length) {
      capture.getTracks().forEach((track) => track.stop());
      throw new Error('The selected source did not provide audio. Choose a tab or source and enable audio sharing.');
    }
    captureStream = capture;
    const joined = await request('join', { code });
    pairId = joined.id;
    audioContext = new AudioContext();
    await audioContext.resume();
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
    status.textContent = 'Connected · listening for interviewer audio.';
    monitorAudio();
  } catch (error) {
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
