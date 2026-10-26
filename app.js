const $ = (id) => document.getElementById(id);
const fields = ['role', 'company', 'profile', 'mode', 'style'];
let recognition = null;
let finalTranscript = '';
let toastTimer;
let answerForCopy = '';
let micSessionActive = false;
let lastSuggestion = '';
let recentQuestion = '';
let candidateContext = [];
let turnQueue = Promise.resolve();
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.hidden = true, 4000);
}
function setAccessState(authenticated, isProtected = true) {
  $('appShell').hidden = !authenticated;
  $('loginScreen').hidden = authenticated;
  $('logoutBtn').hidden = !authenticated || !isProtected;
}
async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    setAccessState(false, true);
    $('loginStatus').textContent = 'Your sign-in expired. Enter the access password again.';
    throw new Error('Please sign in again.');
  }
  return response;
}
async function initializeAccess() {
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    const session = await response.json();
    setAccessState(Boolean(session.authenticated), Boolean(session.protected));
  } catch { setAccessState(false, true); $('loginStatus').textContent = 'Could not connect to the app server.'; }
}
$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('loginStatus').textContent = 'Signing in…';
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('accessPassword').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sign in failed.');
    $('accessPassword').value = ''; $('loginStatus').textContent = '';
    setAccessState(true, true);
  } catch (error) { $('loginStatus').textContent = error.message || 'Sign in failed.'; }
});
$('logoutBtn').addEventListener('click', async () => {
  if (micSessionActive) $('micBtn').click();
  try { await fetch('/api/logout', { method: 'POST' }); } finally { $('accessPassword').value = ''; setAccessState(false, true); }
});
function saveContext() {
  try { localStorage.setItem('interview-copilot-context', JSON.stringify(Object.fromEntries(fields.map((id) => [id, $(id).value])))); }
  catch { showToast('Could not save in this browser.'); }
}
function renderAnswer(data) {
  const prose = typeof data.answer === 'string' ? data.answer : 'No answer was returned. Try again.';
  const detectedBlocks = [];
  const cleanProse = prose.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match, language, code) => {
    detectedBlocks.push({ language: language.trim() || 'code', code: code.replace(/\n$/, '') });
    return '';
  }).trim();
  const blocks = Array.isArray(data.codeBlocks) && data.codeBlocks.length ? data.codeBlocks : detectedBlocks;
  $('answerText').textContent = cleanProse;
  $('codeBlocks').replaceChildren();
  for (const block of blocks) {
    if (typeof block?.code !== 'string') continue;
    const wrapper = document.createElement('section'); wrapper.className = 'code-block';
    const toolbar = document.createElement('div'); toolbar.className = 'code-toolbar';
    const language = document.createElement('span'); language.textContent = typeof block.language === 'string' ? block.language : 'code';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'code-copy'; copy.textContent = 'Copy code';
    const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = block.code; pre.append(code);
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(block.code); showToast('Code copied.'); } catch { showToast('Clipboard access is unavailable.'); } });
    toolbar.append(language, copy); wrapper.append(toolbar, pre); $('codeBlocks').append(wrapper);
  }
  const context = Array.isArray(data.codeBlocks) && data.codeBlocks.length ? data.codeBlocks : detectedBlocks;
  answerForCopy = [cleanProse, ...context.map((block) => `\n\n\`\`\`${block.language || 'code'}\n${block.code}\n\`\`\``)].filter(Boolean).join('');
}
function displayAnswer(data) {
  renderAnswer(data);
  $('detectedStyle').textContent = data.detectedStyle ? `Style: ${data.detectedStyle}` : '';
  $('missingContext').textContent = data.missingContext || ''; $('missingContext').hidden = !data.missingContext;
  $('evidence').textContent = Array.isArray(data.evidenceUsed) && data.evidenceUsed.length ? `Grounded in: ${data.evidenceUsed.join(' · ')}` : '';
  $('latency').textContent = Number.isFinite(data.latencyMs) ? `Generated in ${(data.latencyMs / 1000).toFixed(1)}s` : '';
  $('answerEmpty').hidden = true; $('answerContent').hidden = false;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}
async function loadContextFile(file, kind) {
  if (!file) return;
  const status = kind === 'resume' ? $('resumeStatus') : $('jobStatus');
  const target = kind === 'resume' ? $('resumeContext') : $('jobDescription');
  const maxBytes = 4 * 1024 * 1024;
  if (file.size > maxBytes) { status.textContent = 'File is too large; choose a PDF under 4 MB.'; return; }
  status.textContent = 'Reading document…';
  try {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const response = await apiFetch('/api/parse-document', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, name: file.name.slice(0, 160), mimeType: 'application/pdf', data: await fileToBase64(file) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not extract text from this PDF.');
      target.value = result.text || '';
    } else if (/\.(txt|md)$/i.test(file.name) || file.type.startsWith('text/')) {
      target.value = (await file.text()).slice(0, 30_000);
    } else throw new Error('Use a PDF, TXT, or MD file.');
    status.textContent = target.value ? `Loaded ${file.name}. Review or edit the extracted text.` : 'No readable text found in that file.';
  } catch (error) { status.textContent = error.message; showToast(error.message); }
}
function soundsLikeSuggestionReadback(utterance) {
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const spoken = normalize(utterance); const suggestion = normalize(lastSuggestion);
  if (spoken.length < 35 || !suggestion) return false;
  if (suggestion.includes(spoken)) return true;
  const spokenWords = new Set(spoken.split(' ').filter((word) => word.length > 3));
  const suggestionWords = new Set(suggestion.split(' ').filter((word) => word.length > 3));
  const shared = [...spokenWords].filter((word) => suggestionWords.has(word)).length;
  return spokenWords.size >= 6 && shared / spokenWords.size >= 0.78;
}
try {
  const saved = JSON.parse(localStorage.getItem('interview-copilot-context') || '{}');
  for (const id of fields) if (typeof saved[id] === 'string') $(id).value = saved[id];
  if (saved.style === 'Concise') $('style').value = 'Auto detect';
} catch { /* Allow a fresh profile if browser storage is invalid. */ }
 $('resumeFile').addEventListener('change', (event) => loadContextFile(event.target.files?.[0], 'resume'));
 $('jobFile').addEventListener('change', (event) => loadContextFile(event.target.files?.[0], 'job'));
fields.forEach((id) => $(id).addEventListener('input', saveContext));
['mode', 'style'].forEach((id) => $(id).addEventListener('change', saveContext));

async function generate() {
  const question = $('question').value.trim();
  if (!question) { $('question').focus(); showToast('Add a question first.'); return; }
  $('transcriptCorrection').hidden = true;
  saveContext(); $('answerEmpty').hidden = true; $('answerContent').hidden = true; $('loading').hidden = false; $('generateBtn').disabled = true;
  try {
    const response = await apiFetch('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, role: $('role').value, company: $('company').value, profile: $('profile').value, resumeContext: $('resumeContext').value, jobDescription: $('jobDescription').value, mode: $('mode').value, style: $('style').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not generate a suggestion.');
    displayAnswer(data); lastSuggestion = data.answer || '';
  } catch (error) { $('answerEmpty').hidden = false; showToast(error.message || 'Network error. Please retry.'); }
  finally { $('loading').hidden = true; $('generateBtn').disabled = false; }
}
function isLikelyMobileQuestion(value) {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.includes('?') || /^(?:what|why|how|when|where|who|which)\s+(?:is|are|was|were|do|does|did|can|could|would|should|will|have|has|had)\b/i.test(text) || /^(?:can|could|would|should|will|do|does|did|is|are|have|has)\b/i.test(text) || /^(?:tell me about|walk me through|explain|describe|compare|write|implement|solve|give me an example of)\b/i.test(text);
}
async function classifySessionTurn(utterance, source = 'browser') {
  if (!micSessionActive) return;
  $('micStatus').textContent = 'Checking whether that was a question or an answer…';
  try {
    const response = await apiFetch('/api/session-turn', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utterance, role: $('role').value, company: $('company').value, profile: $('profile').value, resumeContext: $('resumeContext').value, jobDescription: $('jobDescription').value, mode: $('mode').value, style: $('style').value, candidateContext, recentQuestion, lastSuggestion })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not classify the spoken turn.');
    if (!micSessionActive) return;
    const mobileText = data.correctedUtterance || data.question || utterance;
    const mobileQuestionFallback = source === 'mobile' && data.classification !== 'interviewer_question' && isLikelyMobileQuestion(mobileText);
    if (mobileQuestionFallback) {
      recentQuestion = mobileText; $('question').value = mobileText;
      $('micStatus').textContent = 'Mobile question recognized; generating its answer…';
      await generate();
      if (micSessionActive) $('micStatus').textContent = 'Mobile question answer ready.';
    } else if (data.classification === 'interviewer_question' && data.answer) {
      recentQuestion = data.correctedUtterance || data.question || utterance; $('question').value = recentQuestion;
      const corrections = Array.isArray(data.transcriptionCorrections) ? data.transcriptionCorrections : [];
      const correctionNote = $('transcriptCorrection');
      if (corrections.length) {
        correctionNote.textContent = `Possible speech correction: ${corrections.map((item) => `“${item.heard}” → “${item.corrected}”`).join('; ')}. Check the question wording.`;
        correctionNote.hidden = false;
      } else correctionNote.hidden = true;
      displayAnswer(data); lastSuggestion = data.answer;
      $('micStatus').textContent = `Interviewer question detected · ${(Number(data.latencyMs || 0) / 1000).toFixed(1)}s`;
    } else if (data.classification === 'candidate_answer') {
      if (source === 'mobile' && $('question').value === utterance) $('question').value = '';
      const readback = data.isReadingSuggestion === true || soundsLikeSuggestionReadback(utterance);
      if (!readback) candidateContext = [...candidateContext, data.correctedUtterance || utterance].slice(-8);
      $('micStatus').textContent = readback ? 'Your spoken response was recognized; no new question generated.' : 'Your response was recognized; waiting for the next interviewer question.';
    } else {
      if (source === 'mobile') $('question').value = mobileText;
      $('micStatus').textContent = source === 'mobile'
        ? 'Speech recognized but unclear: "' + mobileText.slice(0, 140) + '". It is in the question box if you want to generate it manually.'
        : 'Speech heard, but I could not confidently tell whether it was a question. No answer generated.';
    }
  } catch (error) { if (micSessionActive) $('micStatus').textContent = error.message || 'Could not process speech. Still listening.'; }
}
initializeAccess();
function enqueueSessionTurn(utterance, source = 'browser') {
  const clean = utterance.trim();
  if (!clean || clean.length < 3) return;
  turnQueue = turnQueue.then(() => classifySessionTurn(clean, source)).catch(() => {});
}
$('generateBtn').addEventListener('click', generate);
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); generate(); } });
$('clearBtn').addEventListener('click', () => { $('question').value = ''; $('transcriptCorrection').hidden = true; $('answerContent').hidden = true; $('answerEmpty').hidden = false; $('question').focus(); });
$('copyBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(answerForCopy || $('answerText').textContent); showToast('Answer copied.'); } catch { showToast('Clipboard access is unavailable.'); } });
function setWorkspaceView(view) {
  const showProfile = view === 'profile';
  $('profilePanel').hidden = !showProfile;
  $('interviewPanel').hidden = showProfile;
  $('currentViewName').textContent = showProfile ? 'Candidate profile' : 'Interview room';
  document.querySelectorAll('[data-view-target]').forEach((button) => {
    const selected = button.dataset.viewTarget === view;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('[data-view-target]').forEach((button) => {
  button.addEventListener('click', () => setWorkspaceView(button.dataset.viewTarget));
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const mobileBrowser = Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mobileRecorderAvailable = mobileBrowser && Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
if (mobileBrowser && SpeechRecognition) {
  let mobileRecognizer = null;
  let mobileRestartTimer = null;
  let mobileRetryDelay = 400;
  function scheduleMobileRecognitionRestart() {
    if (!micSessionActive || mobileRestartTimer) return;
    mobileRestartTimer = setTimeout(() => {
      mobileRestartTimer = null;
      if (micSessionActive) startMobileRecognition();
    }, mobileRetryDelay);
    mobileRetryDelay = Math.min(Math.round(mobileRetryDelay * 1.5), 2_000);
  }
  function startMobileRecognition() {
    if (!micSessionActive || mobileRecognizer) return;
    try {
      const instance = new SpeechRecognition();
      mobileRecognizer = instance;
      instance.continuous = false;
      instance.interimResults = true;
      instance.lang = navigator.language || 'en-US';
      instance.onstart = () => {
        if (instance !== mobileRecognizer || !micSessionActive) return;
        mobileRetryDelay = 400;
        $('micBtn').setAttribute('aria-pressed', 'true');
        $('micBtn').innerHTML = '<span>●</span> Stop session';
        $('micStatus').textContent = 'Mobile listening. Recognition restarts automatically after each spoken turn.';
      };
      instance.onresult = (event) => {
        if (instance !== mobileRecognizer || !micSessionActive) return;
        const finalParts = [];
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0]?.transcript?.trim() || '';
          if (event.results[i].isFinal) finalParts.push(text);
          else interim += text;
        }
        if (finalParts.length) {
          const transcript = finalParts.join(' ').trim();
          $('question').value = transcript;
          $('micStatus').textContent = 'Speech recognized. Checking the question…';
          enqueueSessionTurn(transcript, 'mobile');
        } else if (interim) {
          $('micStatus').textContent = 'Hearing: ' + interim.slice(-120);
        }
      };
      instance.onerror = (event) => {
        if (instance !== mobileRecognizer) return;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          micSessionActive = false;
          mobileRecognizer = null;
          $('micBtn').setAttribute('aria-pressed', 'false');
          $('micBtn').innerHTML = '<span>●</span> Start session';
          $('micStatus').textContent = 'Microphone or speech recognition permission was denied. Allow it for this site and try again.';
          clearTimeout(mobileRestartTimer);
          mobileRestartTimer = null;
        } else if (micSessionActive) {
          $('micStatus').textContent = 'Mobile speech service interrupted; reconnecting…';
        }
      };
      instance.onend = () => {
        if (instance !== mobileRecognizer) return;
        mobileRecognizer = null;
        scheduleMobileRecognitionRestart();
      };
      instance.start();
    } catch {
      mobileRecognizer = null;
      scheduleMobileRecognitionRestart();
    }
  }
  function stopMobileRecognitionSession() {
    micSessionActive = false;
    if (mobileRestartTimer) clearTimeout(mobileRestartTimer);
    mobileRestartTimer = null;
    const active = mobileRecognizer;
    mobileRecognizer = null;
    try { active?.stop(); } catch { /* It may already have stopped. */ }
    $('micBtn').setAttribute('aria-pressed', 'false');
    $('micBtn').innerHTML = '<span>●</span> Start session';
    $('micStatus').textContent = 'Session stopped. Spoken turns are not saved.';
  }
  $('micBtn').addEventListener('click', () => {
    if (micSessionActive) { stopMobileRecognitionSession(); return; }
    micSessionActive = true;
    candidateContext = []; recentQuestion = ''; lastSuggestion = ''; turnQueue = Promise.resolve();
    $('question').value = ''; $('transcriptCorrection').hidden = true; $('answerContent').hidden = true; $('answerEmpty').hidden = false;
    $('micStatus').textContent = 'Starting mobile speech recognition…';
    startMobileRecognition();
  });
} else if (mobileRecorderAvailable) {
  let mobileStream = null, mobileRecorder = null, mobileAudioContext = null, mobileAnalyser = null, mobileFrame = null, mobileWakeLock = null;
  let mobileChunks = [], mobileSpeechAt = 0, mobileRecordingAt = 0, mobileMimeType = '';
  const mobileSamples = new Float32Array(512);
  async function transcribeMobileAudio(blob) {
    if (!micSessionActive || blob.size < 1200) return;
    $('micStatus').textContent = 'Transcribing speech…';
    const audioData = await fileToBase64(blob);
    const response = await apiFetch('/api/transcribe-turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audioData, audioMimeType: (blob.type || mobileMimeType).split(';')[0], role: $('role').value, profile: $('profile').value, resumeContext: $('resumeContext').value, jobDescription: $('jobDescription').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not transcribe this audio.');
    const transcript = typeof result.transcript === 'string' ? result.transcript.trim() : '';
    if (!transcript) { $('micStatus').textContent = 'Audio captured, but no clear words were recognized. Keep speaking normally; I am still listening.'; return; }
    $('question').value = transcript;
    enqueueSessionTurn(transcript, 'mobile');
    if (micSessionActive) $('micStatus').textContent = 'Speech recognized. Checking whether it was a question or an answer…';
  }
  function startMobileRecording() {
    if (!micSessionActive || !mobileStream || mobileRecorder?.state === 'recording') return;
    mobileChunks = [];
    try {
      mobileRecorder = new MediaRecorder(mobileStream, mobileMimeType ? { mimeType: mobileMimeType } : undefined);
      mobileRecordingAt = Date.now();
      mobileRecorder.ondataavailable = (event) => { if (event.data?.size) mobileChunks.push(event.data); };
      mobileRecorder.onerror = () => { $('micStatus').textContent = 'Mobile audio capture interrupted; continuing to listen…'; };
      mobileRecorder.onstop = () => {
        const blob = new Blob(mobileChunks, { type: mobileMimeType || mobileChunks[0]?.type || 'audio/webm' });
        mobileChunks = [];
        transcribeMobileAudio(blob).catch((error) => { if (micSessionActive) $('micStatus').textContent = error.message || 'Transcription failed; still listening.'; });
      };
      mobileRecorder.start();
    } catch { $('micStatus').textContent = 'Could not start mobile audio capture. Check microphone permission and try again.'; }
  }
  function stopMobileRecording() { if (mobileRecorder?.state === 'recording') { try { mobileRecorder.stop(); } catch { /* Already stopped. */ } } }
  function monitorMobileAudio() {
    if (!micSessionActive || !mobileAnalyser) return;
    mobileAnalyser.getFloatTimeDomainData(mobileSamples);
    let sum = 0; for (const sample of mobileSamples) sum += sample * sample;
    const level = Math.sqrt(sum / mobileSamples.length), now = Date.now();
    if (level > 0.012) { mobileSpeechAt = now; if (mobileRecorder?.state !== 'recording') startMobileRecording(); }
    if (mobileRecorder?.state === 'recording') {
      const duration = now - mobileRecordingAt;
      if (duration > 14_000 || (mobileSpeechAt && now - mobileSpeechAt > 1_700 && duration > 1_600)) stopMobileRecording();
    }
    mobileFrame = requestAnimationFrame(monitorMobileAudio);
  }
  async function stopMobileSession() {
    micSessionActive = false;
    $('micBtn').setAttribute('aria-pressed', 'false'); $('micBtn').innerHTML = '<span>●</span> Start session';
    $('micStatus').textContent = 'Session stopped. Spoken turns are not saved.';
    if (mobileFrame) cancelAnimationFrame(mobileFrame);
    mobileFrame = null; stopMobileRecording();
    mobileStream?.getTracks().forEach((track) => track.stop()); mobileStream = null;
    if (mobileAudioContext && mobileAudioContext.state !== 'closed') await mobileAudioContext.close().catch(() => {});
    mobileAudioContext = null; mobileAnalyser = null;
    try { await mobileWakeLock?.release(); } catch { /* The browser may release it automatically. */ }
    mobileWakeLock = null;
  }
  async function startMobileSession() {
    mobileStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    mobileAudioContext = new AudioContext(); await mobileAudioContext.resume();
    mobileAnalyser = mobileAudioContext.createAnalyser(); mobileAnalyser.fftSize = 512;
    mobileAudioContext.createMediaStreamSource(mobileStream).connect(mobileAnalyser);
    mobileMimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
    try { if (navigator.wakeLock?.request) mobileWakeLock = await navigator.wakeLock.request('screen'); } catch { /* Optional enhancement. */ }
    $('micBtn').setAttribute('aria-pressed', 'true'); $('micBtn').innerHTML = '<span>●</span> Stop session';
    $('micStatus').textContent = 'Mobile transcription is ready. Speak normally and keep this tab open.';
    monitorMobileAudio();
  }
  $('micBtn').addEventListener('click', async () => {
    if (micSessionActive) { await stopMobileSession(); return; }
    micSessionActive = true; candidateContext = []; recentQuestion = ''; lastSuggestion = ''; turnQueue = Promise.resolve();
    $('question').value = ''; $('transcriptCorrection').hidden = true; $('answerContent').hidden = true; $('answerEmpty').hidden = false;
    $('micStatus').textContent = 'Starting mobile microphone…';
    try { await startMobileSession(); }
    catch (error) {
      await stopMobileSession();
      $('micStatus').textContent = error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow microphone access in your browser settings and try again.' : error.message || 'Could not start mobile audio capture. Check microphone permission and try again.';
    }
  });
} else if (!SpeechRecognition) { $('micBtn').disabled = true; $('micStatus').textContent = 'Speech input is unavailable here. Type your question instead.'; }
else {
  let restartTimer = null;
  let rolloverTimer = null;
  let endWatchdogTimer = null;
  let startupTimer = null;
  let retryDelay = 500;
  function clearRecognitionTimers() {
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (rolloverTimer) { clearTimeout(rolloverTimer); rolloverTimer = null; }
    if (endWatchdogTimer) { clearTimeout(endWatchdogTimer); endWatchdogTimer = null; }
    if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  }
  function armEndWatchdog(instance) {
    if (endWatchdogTimer) clearTimeout(endWatchdogTimer);
    endWatchdogTimer = setTimeout(() => {
      endWatchdogTimer = null;
      if (instance !== recognition || !micSessionActive) return;
      recognition = null;
      try { instance.abort(); } catch { /* Recover using a fresh recognizer below. */ }
      scheduleRecognitionRestart();
    }, 4_000);
  }
  function scheduleRecognitionRestart() {
    if (!micSessionActive || restartTimer) return;
    $('micStatus').textContent = 'Speech recognition paused; reconnecting…';
    const delay = retryDelay;
    retryDelay = Math.min(Math.round(retryDelay * 1.7), 5_000);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!micSessionActive) return;
      try { startRecognition(); } catch { scheduleRecognitionRestart(); }
    }, delay);
  }
  function startRecognition() {
    if (!micSessionActive) return;
    const instance = new SpeechRecognition();
    recognition = instance;
    instance.continuous = true; instance.interimResults = true; instance.lang = navigator.language || 'en-US';
    startupTimer = setTimeout(() => {
      if (instance !== recognition || !micSessionActive) return;
      $('micStatus').textContent = 'Speech service did not connect; retrying…';
      recognition = null;
      try { instance.abort(); } catch { /* The browser may have ended it already. */ }
      scheduleRecognitionRestart();
    }, 12_000);
    instance.onstart = () => {
      if (instance !== recognition || !micSessionActive) { try { instance.stop(); } catch {} return; }
      if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
      retryDelay = 500;
      $('micBtn').setAttribute('aria-pressed', 'true'); $('micBtn').innerHTML = '<span>●</span> Stop session';
      $('micStatus').textContent = 'Listening continuously. Speaker roles are inferred from words and context.';
      // Rotate the browser speech service before it silently stops long sessions.
      rolloverTimer = setTimeout(() => {
        if (instance !== recognition || !micSessionActive) return;
        $('micStatus').textContent = 'Refreshing speech connection…';
        try { instance.stop(); armEndWatchdog(instance); } catch { armEndWatchdog(instance); }
      }, 45_000);
    };
    instance.onresult = (event) => {
      if (instance !== recognition || !micSessionActive) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        enqueueSessionTurn(event.results[i][0].transcript.trim());
      }
    };
    instance.onerror = (event) => {
      if (instance !== recognition) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        micSessionActive = false; $('micBtn').setAttribute('aria-pressed', 'false'); $('micBtn').innerHTML = '<span>●</span> Start session';
        $('micStatus').textContent = 'Microphone access was denied. You can type instead.';
        clearRecognitionTimers();
      } else if (micSessionActive) {
        $('micStatus').textContent = `Speech recognition interrupted (${event.error}); reconnecting…`;
        try { instance.stop(); } catch { /* onend or the watchdog will reconnect. */ }
        armEndWatchdog(instance);
      }
    };
    instance.onend = () => {
      if (instance !== recognition || !micSessionActive) return;
      clearRecognitionTimers();
      recognition = null;
      scheduleRecognitionRestart();
    };
    instance.start();
  }
  function stopMicSession() {
    micSessionActive = false;
    $('micBtn').setAttribute('aria-pressed', 'false'); $('micBtn').innerHTML = '<span>●</span> Start session';
    $('micStatus').textContent = 'Session stopped. Spoken turns are not saved.';
    clearRecognitionTimers();
    try { recognition?.stop(); } catch { /* Recognition may already be stopped. */ }
  }
  $('micBtn').addEventListener('click', () => {
    if (micSessionActive) stopMicSession();
    else {
      micSessionActive = true; candidateContext = []; recentQuestion = ''; lastSuggestion = ''; turnQueue = Promise.resolve();
      $('question').value = ''; $('transcriptCorrection').hidden = true; $('answerContent').hidden = true; $('answerEmpty').hidden = false;
      $('micStatus').textContent = 'Starting microphone…';
      try { startRecognition(); } catch { micSessionActive = false; $('micStatus').textContent = 'Could not start microphone. Try again or type the question.'; }
    }
  });
}
