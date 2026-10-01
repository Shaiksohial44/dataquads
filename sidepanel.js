// ============================================================
// Live Fact Checker — Side Panel  (v2.0)
// ============================================================
// Three transcription modes:
//   1. YouTube Captions — polls CC text from the DOM
//   2. Tab Audio — captures tab sound, LOCAL Whisper transcription
//      (via sandboxed iframe running @xenova/transformers)
//   3. Microphone — Web Speech API via the user's mic
// ============================================================

(() => {
  'use strict';

  // ==========================================================
  // STATE
  // ==========================================================
  const state = {
    isRunning: false,
    mode: 'youtube',
    tabId: null,
    tabUrl: '',

    transcript: [],
    fullText: '',
    pendingText: '',
    wordCount: 0,

    claims: new Map(),
    claimIdCounter: 0,

    context: { speaker: '', event: '', custom: '', platform: '', title: '', url: '', description: '', date: '' },
    startTime: null,
    clarifications: {},
    pendingClarification: null,

    apiKey: '',  // user enters their own key in Settings
    checkInterval: 10000,
    minWords: 20,
    language: 'auto',  // 'auto' = use Chrome's language

    checkTimer: null,
    recognition: null,

    // Tab audio capture state
    audioStream: null,
    audioContext: null,
    audioTimer: null,
    audioBuffer: [],

    // Whisper sandbox
    whisperIframe: null,
    whisperReady: false,
    whisperLoading: false,
    whisperRequestId: 0,
    whisperCallbacks: {},
    whisperCurrentModel: '',
    batchMode: false,
  };

  // ==========================================================
  // DOM
  // ==========================================================
  const $ = (s) => document.querySelector(s);
  const dom = {
    statusDot: $('#statusDot'), statusText: $('#statusText'),
    settingsBtn: $('#settingsBtn'), settingsPanel: $('#settingsPanel'),
    apiKeyInput: $('#apiKeyInput'), langSelect: $('#langSelect'), saveSettingsBtn: $('#saveSettingsBtn'),
    contextToggle: $('#contextToggle'), contextFields: $('#contextFields'),
    contextBadge: $('#contextBadge'),
    ctxSpeaker: $('#ctxSpeaker'), ctxEvent: $('#ctxEvent'), ctxCustom: $('#ctxCustom'),
    startBtn: $('#startBtn'), stopBtn: $('#stopBtn'), clearBtn: $('#clearBtn'), exportBtn: $('#exportBtn'),
    progressWrap: $('#progressWrap'), progressFill: $('#progressFill'), progressLabel: $('#progressLabel'),
    statsBar: $('#statsBar'),
    statWords: $('#statWords'), statClaims: $('#statClaims'),
    statTrue: $('#statTrue'), statFalse: $('#statFalse'), statUncertain: $('#statUncertain'),
    clarBanner: $('#clarificationBanner'), clarQuestion: $('#clarificationQuestion'),
    clarInput: $('#clarificationInput'), clarSubmit: $('#submitClarification'),
    clarDismiss: $('#dismissClarification'),
    analyzeNowBtn: $('#analyzeNowBtn'),
    transcriptWrap: $('#transcriptContainer'), transcript: $('#transcript'),
    modal: $('#claimModal'), modalVerdict: $('#modalVerdict'), modalClaim: $('#modalClaim'),
    modalExplanation: $('#modalExplanation'), modalSources: $('#modalSources'),
    modalConfidence: $('#modalConfidence'), closeModal: $('#closeModal'),
  };

  // ==========================================================
  // i18n
  // ==========================================================
  const i18n = {
    en: {
      status_ready: 'Ready — pick a mode and press Start',
      settings_apikey: 'Gemini API Key',
      settings_interval: 'Check Interval',
      settings_language: 'Language',
      settings_language_hint: 'Affects transcription, analysis language, and the interface.',
      settings_mode: 'Transcription Mode',
      settings_mode_hint: '<b>YouTube Captions</b>: reads CC directly from the page — best for YouTube.<br><b>Tab Audio</b>: captures tab audio and transcribes locally with Whisper (~40MB model, first time only).<br><b>Microphone</b>: uses your mic to pick up audio from speakers.',
      settings_save: 'Save Settings',
      mode_youtube: 'YouTube Captions (reads CC text)',
      mode_tab_audio: 'Tab Audio (local Whisper — works on ANY tab)',
      mode_mic: 'Microphone (Web Speech API via your mic)',
      context_title: 'Context',
      context_badge: 'auto-detected',
      context_speaker: 'Speaker / Channel',
      context_speaker_ph: 'e.g. President Biden',
      context_event: 'Event / Topic',
      context_event_ph: 'e.g. State of the Union 2025',
      context_custom: 'Additional Context',
      context_custom_ph: 'Any extra info the AI should know...',
      btn_start: 'Start Fact-Checking',
      btn_stop: 'Stop',
      btn_clear: 'Clear',
      btn_export: 'Export',
      stat_words: 'words',
      stat_claims: 'claims',
      stat_true: 'true',
      stat_false: 'false',
      stat_unclear: 'unclear',
      clar_title: 'AI needs your help',
      clar_placeholder: 'Type your answer...',
      clar_send: 'Send',
      transcript_placeholder: 'Transcript will appear here once you start...',
      footer_built: 'Built by',
      status_settings_saved: 'Settings saved',
      status_listening_yt: 'Listening via YouTube captions',
      status_listening_mic: 'Listening via microphone...',
      status_analyzing: 'Analyzing for claims...',
      status_stopped: 'Stopped',
      status_rate_limited: 'Rate limited — will retry automatically',
      status_downloading_whisper: 'Downloading Whisper model...',
      status_whisper_loaded: 'Whisper model loaded! Capturing audio...',
      status_report_exported: 'Report exported!',
      status_connecting_yt: 'Connecting to YouTube...',
      status_no_captions: 'No captions detected yet. Make sure CC is on.',
      tooltip_verifying: 'Verifying...',
      tooltip_true: 'TRUE — click for details',
      tooltip_false: 'FALSE — click for details',
      tooltip_uncertain: 'UNCERTAIN — click for details',
      modal_sources: 'Sources',
      modal_confidence: 'Confidence',
      btn_analyze_now: 'Analyze Video',
      tooltip_click: 'Click for full details',
      status_fetching_transcript: 'Fetching full transcript...',
      status_no_transcript: 'No transcript available for this video',
      status_identifying_phase: 'Identifying claims... ({current}/{total})',
      status_verifying_phase: 'Verifying claims... ({current}/{total})',
      status_analysis_complete: 'Analysis complete',
      verdict_true: 'TRUE',
      verdict_false: 'FALSE',
      verdict_uncertain: 'UNCERTAIN',
      verdict_pending: 'VERIFYING...',
      label_confidence: 'Confidence',
      label_sources: 'Sources',
    },
    es: {
      status_ready: 'Listo — elegí un modo y presioná Iniciar',
      settings_apikey: 'Clave API de Gemini',
      settings_interval: 'Intervalo de chequeo',
      settings_language: 'Idioma',
      settings_language_hint: 'Afecta la transcripción, el idioma del análisis y la interfaz.',
      settings_mode: 'Modo de transcripción',
      settings_mode_hint: '<b>Subtítulos YouTube</b>: lee los CC directamente de la página — ideal para YouTube.<br><b>Audio de pestaña</b>: captura audio y transcribe localmente con Whisper (~40MB, solo la primera vez).<br><b>Micrófono</b>: usa tu micrófono para captar el audio.',
      settings_save: 'Guardar',
      mode_youtube: 'Subtítulos YouTube (lee texto CC)',
      mode_tab_audio: 'Audio de pestaña (Whisper local — funciona en CUALQUIER pestaña)',
      mode_mic: 'Micrófono (Web Speech API)',
      context_title: 'Contexto',
      context_badge: 'auto-detectado',
      context_speaker: 'Orador / Canal',
      context_speaker_ph: 'ej. Javier Milei',
      context_event: 'Evento / Tema',
      context_event_ph: 'ej. Discurso legislativas 2025',
      context_custom: 'Contexto adicional',
      context_custom_ph: 'Cualquier información extra que la IA deba saber...',
      btn_start: 'Iniciar Fact-Check',
      btn_stop: 'Detener',
      btn_clear: 'Limpiar',
      btn_export: 'Exportar',
      stat_words: 'palabras',
      stat_claims: 'claims',
      stat_true: 'verdad',
      stat_false: 'falso',
      stat_unclear: 'incierto',
      clar_title: 'La IA necesita tu ayuda',
      clar_placeholder: 'Escribí tu respuesta...',
      clar_send: 'Enviar',
      transcript_placeholder: 'La transcripción aparecerá acá al iniciar...',
      footer_built: 'Creado por',
      status_settings_saved: 'Configuración guardada',
      status_listening_yt: 'Escuchando subtítulos de YouTube',
      status_listening_mic: 'Escuchando micrófono...',
      status_analyzing: 'Analizando claims...',
      status_stopped: 'Detenido',
      status_rate_limited: 'Límite de tasa — reintentará automáticamente',
      status_downloading_whisper: 'Descargando modelo Whisper...',
      status_whisper_loaded: '¡Modelo Whisper cargado! Capturando audio...',
      status_report_exported: '¡Reporte exportado!',
      status_connecting_yt: 'Conectando a YouTube...',
      status_no_captions: 'Sin subtítulos detectados. Asegurate de activar CC.',
      tooltip_verifying: 'Verificando...',
      tooltip_true: 'VERDADERO — clic para detalles',
      tooltip_false: 'FALSO — clic para detalles',
      tooltip_uncertain: 'INCIERTO — clic para detalles',
      modal_sources: 'Fuentes',
      modal_confidence: 'Confianza',
      btn_analyze_now: 'Analizar Video',
      tooltip_click: 'Clic para ver detalles',
      status_fetching_transcript: 'Obteniendo transcripción completa...',
      status_no_transcript: 'No hay transcripción disponible para este video',
      status_identifying_phase: 'Identificando claims... ({current}/{total})',
      status_verifying_phase: 'Verificando claims... ({current}/{total})',
      status_analysis_complete: 'Análisis completado',
      verdict_true: 'VERDADERO',
      verdict_false: 'FALSO',
      verdict_uncertain: 'INCIERTO',
      verdict_pending: 'VERIFICANDO...',
      label_confidence: 'Confianza',
      label_sources: 'Fuentes',
    }
  };

  /** Get a translated string */
  function t(key) {
    const lang = getEffectiveLanguage();
    return (i18n[lang] && i18n[lang][key]) || i18n.en[key] || key;
  }

  /** Apply translations to all data-i18n elements */
  function applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val) el.innerHTML = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key);
      if (val) el.placeholder = val;
    });
  }

  // ==========================================================
  // INIT
  // ==========================================================
  async function init() {
    await loadSettings();
    applyLanguage();
    setupUI();
    setupMessageListener();
    await fetchActiveTab();
    await fetchPageContext();
    setStatus(t('status_ready'));
  }

  // ==========================================================
  // SETTINGS
  // ==========================================================
  async function loadSettings() {
    return new Promise(r => {
      chrome.storage.local.get(['apiKey','checkInterval','mode','language','clarifications'], d => {
        if (d.apiKey)         state.apiKey = d.apiKey;
        if (d.checkInterval)  state.checkInterval = d.checkInterval;
        if (d.mode)           state.mode = d.mode;
        if (d.language)       state.language = d.language;
        if (d.clarifications) state.clarifications = d.clarifications;
        dom.apiKeyInput.value = state.apiKey;
        dom.langSelect.value = state.language;
        const intRadio = document.querySelector(`input[name="interval"][value="${state.checkInterval}"]`);
        if (intRadio) intRadio.checked = true;
        const modeRadio = document.querySelector(`input[name="mode"][value="${state.mode}"]`);
        if (modeRadio) modeRadio.checked = true;
        r();
      });
    });
  }

  function saveSettings() {
    state.apiKey = dom.apiKeyInput.value.trim() || state.apiKey;
    state.checkInterval = +(document.querySelector('input[name="interval"]:checked')?.value || 10000);
    state.mode = document.querySelector('input[name="mode"]:checked')?.value || 'youtube';
    state.language = dom.langSelect.value || 'en';
    chrome.storage.local.set({ apiKey: state.apiKey, checkInterval: state.checkInterval, mode: state.mode, language: state.language, clarifications: state.clarifications });
    applyLanguage();
  }

  // ==========================================================
  // UI SETUP
  // ==========================================================
  function setupUI() {
    dom.settingsBtn.onclick = () => dom.settingsPanel.classList.toggle('hidden');
    dom.saveSettingsBtn.onclick = () => { saveSettings(); dom.settingsPanel.classList.add('hidden'); setStatus(t('status_settings_saved')); };
    dom.contextToggle.onclick = () => { dom.contextFields.classList.toggle('hidden'); dom.contextToggle.classList.toggle('open'); };
    dom.startBtn.onclick = startFactChecking;
    dom.stopBtn.onclick = stopFactChecking;
    dom.clearBtn.onclick = clearTranscript;
    dom.exportBtn.onclick = exportReport;
    dom.analyzeNowBtn.onclick = analyzeNow;
    dom.clarSubmit.onclick = submitClarification;
    dom.clarInput.onkeydown = e => { if (e.key === 'Enter') submitClarification(); };
    dom.clarDismiss.onclick = () => { dom.clarBanner.classList.add('hidden'); state.pendingClarification = null; };
    dom.closeModal.onclick = closeModal;
    dom.modal.querySelector('.modal-backdrop').onclick = closeModal;
    dom.transcript.onclick = e => { const m = e.target.closest('.claim-mark'); if (m) openClaimDetail(m.dataset.claimId); };

    // Claim hover tooltip
    dom.transcript.addEventListener('mouseover', e => {
      const mark = e.target.closest('.claim-mark');
      if (!mark) { hideClaimTooltip(); return; }
      const claim = state.claims.get(mark.dataset.claimId);
      if (claim) showClaimTooltip(mark, claim);
    });
    dom.transcript.addEventListener('mouseout', e => {
      const related = e.relatedTarget;
      if (!related || !related.closest || !related.closest('.claim-mark')) hideClaimTooltip();
    });
  }

  // ==========================================================
  // TAB & CONTEXT
  // ==========================================================
  async function fetchActiveTab() {
    return new Promise(r => {
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' }, resp => {
        if (resp?.tab) {
          state.tabId = resp.tab.id;
          state.tabUrl = resp.tab.url || '';
          const isYT = state.tabUrl.includes('youtube.com');
          if (!isYT && state.mode === 'youtube') {
            state.mode = 'tab_audio';
            const radio = document.querySelector('input[name="mode"][value="tab_audio"]');
            if (radio) radio.checked = true;
          }
        }
        r();
      });
    });
  }

  async function fetchPageContext() {
    if (!state.tabId) return;
    return new Promise(r => {
      chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT', tabId: state.tabId }, resp => {
        if (resp?.context) {
          const c = resp.context;
          state.context.platform = c.platform || '';
          state.context.title = c.title || '';
          state.context.url = c.url || '';
          state.context.description = c.description || '';
          state.context.date = c.date || '';
          if (c.channel && !dom.ctxSpeaker.value) { dom.ctxSpeaker.value = c.channel; state.context.speaker = c.channel; }
          if (c.title && !dom.ctxEvent.value) { dom.ctxEvent.value = c.title; state.context.event = c.title; }
          if (c.isLive) { dom.contextBadge.textContent = 'LIVE'; dom.contextBadge.style.color = '#22c55e'; }
        }
        r();
      });
    });
  }

  function getContextString() {
    const parts = [];
    const sp = dom.ctxSpeaker.value.trim();
    const ev = dom.ctxEvent.value.trim();
    const cu = dom.ctxCustom.value.trim();
    if (sp) parts.push('Speaker/Source: ' + sp);
    if (ev) parts.push('Event/Topic: ' + ev);
    if (cu) parts.push('Additional: ' + cu);
    if (state.context.platform) parts.push('Platform: ' + state.context.platform);
    if (state.context.url) parts.push('URL: ' + state.context.url);
    if (state.context.date) parts.push('Date: ' + state.context.date);
    if (state.context.description) parts.push('Video description: ' + state.context.description.substring(0, 300));
    const cl = Object.entries(state.clarifications);
    if (cl.length) { parts.push('Clarifications:'); cl.forEach(([q,a]) => parts.push('  Q: '+q+' A: '+a)); }
    return parts.join('\n') || 'No context.';
  }

  // ==========================================================
  // STATUS
  // ==========================================================
  function setStatus(text, type) {
    dom.statusText.textContent = text;
    dom.statusDot.className = 'status-dot' + (type ? ' ' + type : '');
  }

  // ==========================================================
  // START / STOP
  // ==========================================================
  async function startFactChecking() {
    state.mode = document.querySelector('input[name="mode"]:checked')?.value || 'youtube';
    saveSettings();
    state.isRunning = true;
    state.startTime = Date.now();
    dom.startBtn.classList.add('hidden');
    dom.stopBtn.classList.remove('hidden');
    dom.statsBar.classList.remove('hidden');

    state.context.speaker = dom.ctxSpeaker.value.trim();
    state.context.event = dom.ctxEvent.value.trim();
    state.context.custom = dom.ctxCustom.value.trim();

    if (state.mode === 'youtube') {
      await startYouTubeMode();
    } else if (state.mode === 'tab_audio') {
      await startTabAudioMode();
    } else {
      startMicMode();
    }

    // Use adaptive timer instead of fixed interval
    // Free tier: 15 RPM = 1 call every 4s. With identify (1) + verify (up to 3),
    // that's 4 calls per round = need ~16s minimum between rounds.
    scheduleNextClaimCheck();
  }

  function getAdaptiveInterval() {
    // Base: user-configured interval (default 10s)
    let interval = state.checkInterval;
    // If budget is tight (fewer than 4 slots = can't do 1 identify + 3 verify), slow down
    const avail = availableRequests();
    if (avail < 4) interval = Math.max(interval, 15000);
    if (avail < 2) interval = Math.max(interval, 30000);
    if (avail < 1) interval = Math.max(interval, msUntilNextSlot() + 2000);
    return Math.min(interval, 120000);
  }

  function scheduleNextClaimCheck() {
    if (state.checkTimer) { clearTimeout(state.checkTimer); state.checkTimer = null; }
    if (!state.isRunning) return;
    const interval = getAdaptiveInterval();
    state.checkTimer = setTimeout(async () => {
      await runClaimCheck();
      scheduleNextClaimCheck(); // schedule next after this one finishes
    }, interval);
  }

  function stopFactChecking() {
    state.isRunning = false;
    dom.startBtn.classList.remove('hidden');
    dom.stopBtn.classList.add('hidden');
    setStatus(t('status_stopped'));
    if (state.checkTimer) { clearTimeout(state.checkTimer); state.checkTimer = null; }

    if (!state.batchMode) {
      if (state.mode === 'youtube') stopYouTubeMode();
      else if (state.mode === 'tab_audio') stopTabAudioMode();
      else stopMicMode();
    }
    state.batchMode = false;
    dom.progressWrap.classList.add('hidden');
  }

  async function analyzeNow() {
    // ── Full-video batch analysis ──
    // 1. Fetch the complete transcript from YouTube
    setStatus(t('status_fetching_transcript'), 'checking');
    dom.progressWrap.classList.remove('hidden');
    dom.progressFill.style.width = '0%';
    dom.progressLabel.textContent = '0%';

    const lang = getEffectiveLanguage();
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'GET_FULL_TRANSCRIPT', tabId: state.tabId, language: lang },
          resp => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError.message);
            else resolve(resp);
          }
        );
      });
    } catch (err) {
      setStatus(t('status_no_transcript'), 'error');
      dom.progressWrap.classList.add('hidden');
      return;
    }

    if (!result?.success || !result?.segments?.length) {
      setStatus(result?.error || t('status_no_transcript'), 'error');
      dom.progressWrap.classList.add('hidden');
      return;
    }

    // 2. Stop any ongoing live monitoring
    if (state.isRunning) {
      state.isRunning = false;
      if (state.checkTimer) { clearTimeout(state.checkTimer); state.checkTimer = null; }
      if (state.mode === 'youtube') stopYouTubeMode();
      else if (state.mode === 'tab_audio') stopTabAudioMode();
      else stopMicMode();
    }

    // 3. Enter batch mode
    clearTranscript();
    state.batchMode = true;
    state.isRunning = true;
    state.startTime = Date.now();
    dom.startBtn.classList.add('hidden');
    dom.stopBtn.classList.remove('hidden');
    dom.statsBar.classList.remove('hidden');

    // 4. Merge tiny caption segments into ~20-second paragraphs
    const merged = [];
    let buf = '', bufStart = 0;
    for (const seg of result.segments) {
      if (!buf) {
        bufStart = seg.startMs; buf = seg.text;
      } else if (seg.startMs - bufStart < 20000) {
        buf += ' ' + seg.text;
      } else {
        merged.push({ text: buf.trim(), startMs: bufStart });
        bufStart = seg.startMs; buf = seg.text;
      }
    }
    if (buf) merged.push({ text: buf.trim(), startMs: bufStart });

    // 5. Render the full transcript at once
    let fullText = '';
    for (const seg of merged) {
      const entry = {
        id: 't-' + seg.startMs + '-' + Math.random().toString(36).slice(2,6),
        text: seg.text,
        timestamp: seg.startMs
      };
      state.transcript.push(entry);
      fullText += (fullText ? ' ' : '') + seg.text;
      state.wordCount += seg.text.split(/\s+/).filter(Boolean).length;
      renderTranscriptEntry(entry, true);
    }
    state.fullText = fullText;
    updateStats();

    // 6. Phase 1 — Identify claims chunk by chunk (0 → 40% progress)
    const CHUNK_WORDS = 150;
    const words = fullText.split(/\s+/).filter(Boolean);
    const totalChunks = Math.ceil(words.length / CHUNK_WORDS);

    for (let i = 0; i < totalChunks; i++) {
      if (!state.isRunning) break;

      const chunkText = words.slice(i * CHUNK_WORDS, (i + 1) * CHUNK_WORDS).join(' ');
      const pct = Math.round(((i + 1) / totalChunks) * 40);
      dom.progressFill.style.width = pct + '%';
      dom.progressLabel.textContent = pct + '%';
      setStatus(
        t('status_identifying_phase').replace('{current}', i + 1).replace('{total}', totalChunks),
        'checking'
      );

      try {
        const claims = await identifyClaims(chunkText);
        if (claims?.length) {
          for (const cl of claims) {
            const id = 'c-' + (++state.claimIdCounter);
            const obj = {
              id, text: cl.claim || cl.text || '',
              summary: cl.summary || cl.claim || '',
              searchQuery: cl.searchQuery || '',
              status: 'pending', verdict: null,
              explanation: '', sources: [], confidence: 0,
              needsClarification: false, clarificationQuestion: null
            };
            state.claims.set(id, obj);
            highlightClaimInTranscript(obj);
            updateStats();
          }
        }
      } catch (err) {
        if (err.message.startsWith('RATE_LIMITED')) {
          const waitMs = parseInt(err.message.split(':')[1]) || 30000;
          setStatus(t('status_rate_limited'), 'checking');
          await sleep(waitMs);
          i--; // retry this chunk
          continue;
        }
        console.error('Batch identification error:', err);
      }
    }

    // 7. Phase 2 — Verify each claim one by one (40 → 100% progress)
    const claimsToVerify = [...state.claims.values()].filter(c => c.status === 'pending');
    const totalClaims = claimsToVerify.length;
    let verified = 0;

    for (let i = 0; i < claimsToVerify.length; i++) {
      if (!state.isRunning) break;
      const claim = claimsToVerify[i];

      const pct = 40 + Math.round(((verified + 1) / totalClaims) * 60);
      dom.progressFill.style.width = Math.min(pct, 99) + '%';
      dom.progressLabel.textContent = Math.min(pct, 99) + '%';
      setStatus(
        t('status_verifying_phase').replace('{current}', verified + 1).replace('{total}', totalClaims),
        'checking'
      );

      await verifyClaim(claim);

      if (claim.status === 'verified') {
        verified++;
      } else {
        // Rate limited — verifyClaim already waited, retry
        if (!claim._retries) claim._retries = 0;
        claim._retries++;
        if (claim._retries > 5) {
          claim.status = 'verified';
          claim.verdict = 'UNCERTAIN';
          claim.explanation = 'Could not verify — rate limit exceeded';
          updateClaimInTranscript(claim);
          updateStats();
          verified++;
        } else {
          i--; // retry this claim
          continue;
        }
      }
    }

    // 8. Done!
    dom.progressFill.style.width = '100%';
    dom.progressLabel.textContent = '100%';
    setStatus(t('status_analysis_complete'));
    state.isRunning = false;
    state.batchMode = false;
    dom.startBtn.classList.remove('hidden');
    dom.stopBtn.classList.add('hidden');
    setTimeout(() => dom.progressWrap.classList.add('hidden'), 4000);
  }

  function clearTranscript() {
    state.transcript = []; state.fullText = ''; state.pendingText = '';
    state.wordCount = 0; state.claims.clear(); state.claimIdCounter = 0;
    dom.transcript.innerHTML = '<p class="placeholder-text">Transcript will appear here once you start...</p>';
    updateStats();
  }

  // ==========================================================
  // MODE 1: YOUTUBE CAPTIONS
  // ==========================================================
  async function startYouTubeMode() {
    if (!state.tabId) { setStatus('No active tab', 'error'); return; }

    setStatus(t('status_connecting_yt'), 'checking');

    // First check content script is alive
    const alive = await pingContent();
    if (!alive) {
      setStatus('Injecting content script...', 'checking');
      await injectContentScript();
      await sleep(1000);
    }

    chrome.runtime.sendMessage({ type: 'START_CAPTIONS', tabId: state.tabId }, resp => {
      if (resp?.error) {
        setStatus('Content script error: ' + resp.error + '. Try reloading the YouTube page.', 'error');
      } else if (resp?.success) {
        const info = [];
        if (resp.ccStatus === 'enabled') info.push('CC turned on');
        else if (resp.ccStatus === 'already_on') info.push('CC is on');
        else if (resp.ccStatus === 'no_button') info.push('CC button not found — enable manually');
        if (resp.isLive) info.push('LIVE');
        setStatus(t('status_listening_yt') + (info.length ? ' (' + info.join(', ') + ')' : ''), 'live');
      }
    });
  }

  function stopYouTubeMode() {
    if (state.tabId) chrome.runtime.sendMessage({ type: 'STOP_CAPTIONS', tabId: state.tabId });
  }

  function pingContent() {
    return new Promise(r => {
      chrome.runtime.sendMessage({ type: 'PING_CONTENT', tabId: state.tabId }, resp => {
        r(resp?.alive === true);
      });
    });
  }

  function injectContentScript() {
    return new Promise(r => {
      chrome.runtime.sendMessage({ type: 'INJECT_CONTENT_SCRIPT', tabId: state.tabId }, resp => {
        r(resp?.success === true);
      });
    });
  }

  // ==========================================================
  // WHISPER SANDBOX (local model via transformers.js)
  // ==========================================================
  function initWhisperSandbox() {
    if (state.whisperIframe) return;

    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('whisper-sandbox.html');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    state.whisperIframe = iframe;

    // Listen for messages from the sandbox
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'SANDBOX_ALIVE':
          console.log('[Whisper] Sandbox iframe alive');
          break;

        case 'WHISPER_STATUS':
          console.log('[Whisper]', msg.status, msg.message);
          if (msg.status === 'ready') {
            state.whisperReady = true;
            state.whisperLoading = false;
            dom.progressWrap.classList.add('hidden');
            setStatus(t('status_whisper_loaded'), 'live');
          } else if (msg.status === 'error') {
            state.whisperLoading = false;
            dom.progressWrap.classList.add('hidden');
            setStatus('Whisper error: ' + msg.message, 'error');
          } else if (msg.status === 'downloading' && msg.progress != null) {
            dom.progressWrap.classList.remove('hidden');
            dom.progressFill.style.width = msg.progress + '%';
            dom.progressLabel.textContent = msg.progress + '%';
            setStatus(t('status_downloading_whisper'), 'checking');
          } else if (msg.status === 'loading') {
            dom.progressWrap.classList.remove('hidden');
            dom.progressFill.style.width = '0%';
            dom.progressLabel.textContent = '...';
            setStatus(msg.message, 'checking');
          }
          break;

        case 'WHISPER_RESULT':
          if (msg.requestId && state.whisperCallbacks[msg.requestId]) {
            state.whisperCallbacks[msg.requestId](msg);
            delete state.whisperCallbacks[msg.requestId];
          }
          break;

        case 'PONG':
          console.log('[Whisper] Pong:', msg);
          break;
      }
    });
  }

  // Resolve effective language code
  function getEffectiveLanguage() {
    if (state.language === 'es' || state.language === 'en') return state.language;
    // Fallback: detect from browser
    const nav = (navigator.language || 'en').split('-')[0].toLowerCase();
    return nav === 'es' ? 'es' : 'en';
  }

  function loadWhisperModel() {
    const lang = getEffectiveLanguage();
    const isEnglish = (lang === 'en');
    const modelName = isEnglish ? 'Xenova/whisper-tiny.en' : 'Xenova/whisper-tiny';

    // If already loaded with the right model, skip
    if (state.whisperReady && state.whisperCurrentModel === modelName) return;
    if (state.whisperLoading) return;

    state.whisperLoading = true;
    state.whisperReady = false;
    state.whisperCurrentModel = modelName;

    state.whisperIframe.contentWindow.postMessage({
      type: 'INIT_WHISPER',
      model: modelName,
      language: lang
    }, '*');
  }

  function whisperTranscribe(audioFloat32) {
    return new Promise((resolve) => {
      const requestId = 'wr-' + (++state.whisperRequestId);
      state.whisperCallbacks[requestId] = (result) => {
        resolve(result.text || '');
      };
      state.whisperIframe.contentWindow.postMessage({
        type: 'TRANSCRIBE',
        audio: audioFloat32,
        requestId,
        language: getEffectiveLanguage()
      }, '*');
      // Timeout after 30 seconds
      setTimeout(() => {
        if (state.whisperCallbacks[requestId]) {
          delete state.whisperCallbacks[requestId];
          resolve('');
        }
      }, 30000);
    });
  }

  // ==========================================================
  // MODE 2: TAB AUDIO → LOCAL WHISPER TRANSCRIPTION
  // ==========================================================
  async function startTabAudioMode() {
    setStatus('Setting up local Whisper...', 'checking');

    // 1. Initialize the Whisper sandbox iframe
    initWhisperSandbox();
    await sleep(500);
    loadWhisperModel();

    // 2. Capture tab audio
    setStatus('Requesting tab audio (select the tab to share)...', 'checking');

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 1 },
        audio: true
      });

      // Drop video
      stream.getVideoTracks().forEach(t => t.stop());
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setStatus('No audio — make sure you check "Share tab audio"', 'error');
        return;
      }

      state.audioStream = new MediaStream(audioTracks);

      // 3. Set up AudioContext at 16kHz (Whisper requirement)
      state.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = state.audioContext.createMediaStreamSource(state.audioStream);
      const processor = state.audioContext.createScriptProcessor(4096, 1, 1);
      state.audioBuffer = [];

      source.connect(processor);
      processor.connect(state.audioContext.destination);

      processor.onaudioprocess = (e) => {
        if (!state.isRunning) return;
        const data = e.inputBuffer.getChannelData(0);
        state.audioBuffer.push(new Float32Array(data));
      };

      setStatus(state.whisperReady ? t('status_whisper_loaded') : t('status_downloading_whisper'), state.whisperReady ? 'live' : 'checking');

      // 4. Every 5 seconds, send accumulated audio to Whisper
      state.audioTimer = setInterval(async () => {
        if (!state.isRunning || state.audioBuffer.length === 0) return;
        if (!state.whisperReady) return; // Wait for model to load

        // Combine all buffered Float32Arrays into one
        const totalLength = state.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const buf of state.audioBuffer) {
          combined.set(buf, offset);
          offset += buf.length;
        }
        state.audioBuffer = [];

        // Skip if too short (< 0.5 seconds at 16kHz)
        if (combined.length < 8000) return;

        setStatus('Transcribing (local Whisper)...', 'checking');

        const text = await whisperTranscribe(combined);
        if (text && text.trim().length > 1) {
          handleTranscriptText(text.trim());
        }

        setStatus('Capturing & transcribing (local Whisper)...', 'live');
      }, 5000);

      // Handle user revoking share
      audioTracks[0].onended = () => {
        setStatus('Tab audio share ended', 'error');
        stopTabAudioMode();
      };

    } catch (err) {
      console.error('Tab audio error:', err);
      if (err.name === 'NotAllowedError') {
        setStatus('Tab share cancelled — click Start again', 'error');
      } else {
        setStatus('Audio error: ' + err.message, 'error');
      }
      state.isRunning = false;
      dom.startBtn.classList.remove('hidden');
      dom.stopBtn.classList.add('hidden');
    }
  }

  function stopTabAudioMode() {
    if (state.audioTimer) { clearInterval(state.audioTimer); state.audioTimer = null; }
    if (state.audioContext) {
      try { state.audioContext.close(); } catch {}
      state.audioContext = null;
    }
    if (state.audioStream) {
      state.audioStream.getTracks().forEach(t => t.stop());
      state.audioStream = null;
    }
    state.audioBuffer = [];
  }

  // ==========================================================
  // MODE 3: MICROPHONE (Web Speech API)
  // ==========================================================
  function startMicMode() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setStatus('Speech recognition not supported in this browser', 'error');
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.recognition = new SR();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    const lang = getEffectiveLanguage();
    const langRegion = { en:'en-US', es:'es-ES', pt:'pt-BR', fr:'fr-FR', de:'de-DE', it:'it-IT', nl:'nl-NL', pl:'pl-PL', ru:'ru-RU', uk:'uk-UA', zh:'zh-CN', ja:'ja-JP', ko:'ko-KR', ar:'ar-SA', hi:'hi-IN', tr:'tr-TR', vi:'vi-VN', th:'th-TH', sv:'sv-SE' };
    state.recognition.lang = langRegion[lang] || lang;

    let lastFinal = '';

    state.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text && text !== lastFinal) {
            lastFinal = text;
            handleTranscriptText(text);
          }
        }
      }
    };

    state.recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (e.error === 'not-allowed') setStatus('Microphone access denied — allow in browser', 'error');
      else console.warn('Speech error:', e.error);
    };

    state.recognition.onend = () => {
      if (state.isRunning && state.mode === 'mic') {
        try { state.recognition.start(); } catch {}
      }
    };

    try {
      state.recognition.start();
      setStatus(t('status_listening_mic'), 'live');
    } catch { setStatus('Could not start microphone', 'error'); }
  }

  function stopMicMode() {
    if (state.recognition) {
      state.recognition.onend = null;
      try { state.recognition.stop(); } catch {}
      state.recognition = null;
    }
  }

  // ==========================================================
  // TRANSCRIPT HANDLING
  // ==========================================================
  const recentTexts = [];
  const MAX_RECENT = 15;

  function handleTranscriptText(text) {
    if (!text || !state.isRunning) return;

    // Secondary dedup: skip if this exact text (normalized) was recently received
    const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm.length < 2) return;
    for (const prev of recentTexts) {
      if (prev === norm) return;
      // Skip if new text is entirely contained in a recent entry
      if (prev.includes(norm)) return;
    }
    recentTexts.push(norm);
    if (recentTexts.length > MAX_RECENT) recentTexts.shift();

    const entry = { id: 't-' + Date.now() + '-' + Math.random().toString(36).slice(2,6), text, timestamp: Date.now() };
    state.transcript.push(entry);
    state.fullText += (state.fullText ? ' ' : '') + text;
    state.pendingText += (state.pendingText ? ' ' : '') + text;
    state.wordCount += text.split(/\s+/).filter(Boolean).length;
    renderTranscriptEntry(entry);
    updateStats();
    autoScroll();
  }

  function renderTranscriptEntry(entry, useVideoTime) {
    const ph = dom.transcript.querySelector('.placeholder-text');
    if (ph) ph.remove();
    const block = document.createElement('span');
    block.className = 'transcript-block';
    block.dataset.entryId = entry.id;
    const timeStr = useVideoTime
      ? formatVideoTime(entry.timestamp)
      : new Date(entry.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    block.innerHTML = `<span class="transcript-time">${timeStr}</span>${escapeHtml(entry.text)} `;
    dom.transcript.appendChild(block);
  }

  function autoScroll() {
    const el = dom.transcriptWrap;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }

  // ==========================================================
  // MESSAGE LISTENER
  // ==========================================================
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'CAPTION_UPDATE') handleTranscriptText(msg.text);
      else if (msg.type === 'CONTEXT_UPDATE' && msg.context) {
        if (msg.context.channel && !dom.ctxSpeaker.value) { dom.ctxSpeaker.value = msg.context.channel; }
        if (msg.context.title && !dom.ctxEvent.value) { dom.ctxEvent.value = msg.context.title; }
      }
      else if (msg.type === 'CONTENT_STATUS') {
        setStatus(msg.message, 'checking');
      }
    });
  }

  // ==========================================================
  // GEMINI API — budget-based rate limiter
  // ==========================================================
  // Gemini 2.0 Flash free tier limits:
  //   - 15 requests per minute (RPM)
  //   - 1,000,000 tokens per minute (TPM)
  //   - 1,500 requests per day (RPD)
  // We track a sliding window of request timestamps to NEVER exceed these.
  // ==========================================================
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

  const RPM_LIMIT = 14;           // stay 1 under the 15 RPM hard limit
  const RPD_LIMIT = 1400;         // stay under the 1500 RPD hard limit
  const requestLog = [];          // timestamps of all API calls
  let dailyRequestCount = 0;
  let dailyResetTime = Date.now() + 86400000;
  let serverBackoffUntil = 0;     // if we DO get a 429, respect server's retry-after
  let pendingVerifications = [];
  let isProcessingQueue = false;

  /** How many requests can we make right now? */
  function availableRequests() {
    const now = Date.now();
    // Prune entries older than 60s
    while (requestLog.length && requestLog[0] < now - 60000) requestLog.shift();
    // Reset daily counter if needed
    if (now > dailyResetTime) { dailyRequestCount = 0; dailyResetTime = now + 86400000; }
    const minuteAvail = RPM_LIMIT - requestLog.length;
    const dayAvail = RPD_LIMIT - dailyRequestCount;
    return Math.max(0, Math.min(minuteAvail, dayAvail));
  }

  /** Minimum ms to wait before the next request is allowed */
  function msUntilNextSlot() {
    const now = Date.now();
    // Server-imposed backoff takes priority
    if (serverBackoffUntil > now) return serverBackoffUntil - now;
    if (availableRequests() > 0) return 0;
    // Earliest slot opens when oldest request in window expires
    if (requestLog.length >= RPM_LIMIT) return requestLog[0] + 60000 - now + 200; // +200ms buffer
    return 1000; // fallback
  }

  /** Wait until we have budget, then record the request */
  async function acquireSlot() {
    let wait = msUntilNextSlot();
    while (wait > 0) {
      console.log(`[Budget] Waiting ${Math.round(wait/1000)}s for API slot (${requestLog.length}/${RPM_LIMIT} RPM used)`);
      setStatus(`Waiting for API slot (${Math.round(wait/1000)}s)...`, 'checking');
      await sleep(wait);
      wait = msUntilNextSlot();
    }
    requestLog.push(Date.now());
    dailyRequestCount++;
  }

  async function callGemini(prompt, { grounded = false, temperature = 0.1, maxTokens = 1024, jsonMode = false, jsonSchema = null } = {}) {
    await acquireSlot();

    const model = 'gemini-3.8-flash';
    const url = `${GEMINI}/${model}:generateContent`;
    const genConfig = { maxOutputTokens: maxTokens };

    // Force JSON output when not using grounding (grounding + JSON mode is unsupported)
    if (jsonMode && !grounded) {
      genConfig.responseMimeType = 'application/json';
      if (jsonSchema) genConfig.responseSchema = jsonSchema;
    }

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: genConfig
    };
    if (grounded) body.tools = [{ google_search: {} }];

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': state.apiKey
      },
      body: JSON.stringify(body)
    });

    if (r.status === 429) {
      // Parse server-suggested retry delay
      let waitMs = 30000;
      try {
        const errBody = await r.json();
        const retryInfo = errBody.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
        if (retryInfo?.retryDelay) {
          const s = retryInfo.retryDelay.match(/([\d.]+)s/);
          if (s) waitMs = Math.ceil(parseFloat(s[1]) * 1000) + 1000;
        }
      } catch {}
      serverBackoffUntil = Date.now() + waitMs;
      console.log(`[Budget] 429 received. Server says wait ${Math.round(waitMs/1000)}s`);
      throw new Error(`RATE_LIMITED:${waitMs}`);
    }

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Gemini ${r.status}: ${errText.substring(0, 1200)}`);
    }

    const d = await r.json();
    if (!d.candidates?.length) throw new Error('No candidates');
    const c = d.candidates[0];
    const text = c.content?.parts?.[0]?.text || '';
    let sources = [];
    if (c.groundingMetadata?.groundingChunks)
      sources = c.groundingMetadata.groundingChunks.filter(x=>x.web).map(x=>({url:x.web.uri, title:x.web.title||x.web.uri}));
    return { text, sources };
  }

  function parseJSON(text) {
    if (!text) return null;
    // Strip markdown code fences (```json ... ``` or ``` ... ```)
    let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    // Try direct parse
    try { return JSON.parse(cleaned); } catch {}
    // Try to extract JSON object or array from surrounding text
    // Use the LAST { or [ that leads to valid JSON (Gemini often adds preamble)
    for (const startChar of ['{', '[']) {
      const endChar = startChar === '{' ? '}' : ']';
      const lastStart = cleaned.lastIndexOf(startChar);
      if (lastStart === -1) continue;
      const firstStart = cleaned.indexOf(startChar);
      // Try from the first occurrence (most common)
      for (const idx of [firstStart, lastStart]) {
        const lastEnd = cleaned.lastIndexOf(endChar);
        if (lastEnd > idx) {
          try { return JSON.parse(cleaned.substring(idx, lastEnd + 1)); } catch {}
        }
      }
    }
    return null;
  }

  /**
   * Fallback for grounded verification calls (which can't use JSON mode).
   * When Gemini returns a prose response instead of JSON, this extracts
   * the verdict, confidence, and explanation from the natural language text.
   */
  function extractVerdictFromProse(text) {
    if (!text || text.length < 5) return null;

    // --- 1. Detect verdict ---
    const upper = text.toUpperCase();
    let verdict = 'UNCERTAIN';

    // Look for explicit verdict patterns first (strongest signal)
    const verdictPatterns = [
      // English patterns
      { re: /\bverdict\s*[:=]\s*"?(TRUE|FALSE|UNCERTAIN|VERDADERO|FALSO|INCIERTO)"?/i, group: 1 },
      { re: /\bmarked?\s+(?:as\s+)?(TRUE|FALSE|UNCERTAIN|VERDADERO|FALSO|INCIERTO)\b/i, group: 1 },
      { re: /\bclaim\s+is\s+(TRUE|FALSE|UNCERTAIN|VERDADERO|FALSO|INCIERTO)\b/i, group: 1 },
      { re: /\brating\s*[:=]\s*"?(TRUE|FALSE|UNCERTAIN|VERDADERO|FALSO|INCIERTO)"?/i, group: 1 },
      // Spanish patterns
      { re: /\bveredicto\s*[:=]\s*"?(TRUE|FALSE|UNCERTAIN|VERDADERO|FALSO|INCIERTO)"?/i, group: 1 },
      { re: /\bla\s+afirmaci[oó]n\s+es\s+(VERDADERA|FALSA|INCIERTA|TRUE|FALSE|UNCERTAIN)\b/i, group: 1 },
    ];

    for (const { re, group } of verdictPatterns) {
      const m = text.match(re);
      if (m) {
        const raw = m[group].toUpperCase();
        if (raw === 'VERDADERO' || raw === 'VERDADERA') verdict = 'TRUE';
        else if (raw === 'FALSO' || raw === 'FALSA') verdict = 'FALSE';
        else if (raw === 'INCIERTO' || raw === 'INCIERTA') verdict = 'UNCERTAIN';
        else verdict = raw;
        break;
      }
    }

    // If no explicit pattern found, use keyword heuristics
    if (verdict === 'UNCERTAIN') {
      const falseSignals = [
        /\bis\s+(false|incorrect|wrong|inaccurate|misleading)\b/i,
        /\bes\s+(falso|falsa|incorrecta?|errónea?|inexacta?)\b/i,
        /\bcontradicts?\b/i, /\bcontradice\b/i,
        /\bthe\s+(?:real|actual)\s+(?:number|figure|data)\b.*?\bdifferent\b/i,
        /\blos\s+datos\s+(?:reales|oficiales)\b.*?\bdiferente\b/i,
        /\bnot\s+(?:true|accurate|correct|supported)\b/i,
        /\bno\s+es\s+(?:cierto|correcto|preciso)\b/i,
      ];
      const trueSignals = [
        /\bis\s+(true|correct|accurate|supported|confirmed)\b/i,
        /\bes\s+(verdadera?|correcta?|precisa?|cierta?)\b/i,
        /\bconfirms?\b/i, /\bconfirma\b/i,
        /\bdata\s+supports?\b/i, /\blos\s+datos\s+(?:confirman|respaldan)\b/i,
      ];

      let falseScore = 0, trueScore = 0;
      for (const re of falseSignals) if (re.test(text)) falseScore++;
      for (const re of trueSignals) if (re.test(text)) trueScore++;

      if (falseScore > trueScore && falseScore >= 1) verdict = 'FALSE';
      else if (trueScore > falseScore && trueScore >= 1) verdict = 'TRUE';
      // else stays UNCERTAIN
    }

    // --- 2. Extract confidence ---
    let confidence = verdict === 'UNCERTAIN' ? 0.4 : 0.6;
    const confMatch = text.match(/\bconfidence\s*[:=]\s*(0(?:\.\d+)?|1(?:\.0)?)\b/i)
                   || text.match(/\bconfianza\s*[:=]\s*(0(?:\.\d+)?|1(?:\.0)?)\b/i);
    if (confMatch) confidence = parseFloat(confMatch[1]);

    // --- 3. Build explanation ---
    // Use the full prose as the explanation, trimmed to a reasonable length.
    // Strip any leading "Okay, I understand" / "Voy a analizar" filler.
    let explanation = text
      .replace(/^(?:Okay|Ok|Bien|Entiendo|Voy a)[^.]*\.\s*/i, '')
      .replace(/^(?:Let me|Déjame|Permíteme|I'll|Vamos a)[^.]*\.\s*/i, '')
      .trim();
    if (explanation.length > 500) explanation = explanation.substring(0, 497) + '...';
    if (!explanation) explanation = text.substring(0, 300);

    return {
      verdict,
      confidence,
      explanation,
      needsClarification: false,
      clarificationQuestion: null
    };
  }

  // ==========================================================
  // CLAIM IDENTIFICATION
  // ==========================================================
  async function runClaimCheck(force = false) {
    if (!state.isRunning && !force) return;
    const text = state.pendingText.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < (force ? 5 : state.minWords)) return;

    // Don't even try if no budget (unless forced — acquireSlot will wait)
    if (!force && availableRequests() < 1) {
      const wait = msUntilNextSlot();
      setStatus(`Buffering transcript (API slot in ${Math.round(wait/1000)}s)...`, 'checking');
      return; // keep text in pendingText, try next tick
    }

    state.pendingText = '';
    const prevStatus = dom.statusText.textContent;
    setStatus(t('status_analyzing'), 'checking');

    try {
      const claims = await identifyClaims(text);
      if (claims?.length) {
        for (const cl of claims) {
          const id = 'c-' + (++state.claimIdCounter);
          const obj = { id, text: cl.claim||cl.text||'', summary: cl.summary||cl.claim||'', searchQuery: cl.searchQuery||'', status: 'pending', verdict: null, explanation: '', sources: [], confidence: 0, needsClarification: false, clarificationQuestion: null };
          state.claims.set(id, obj);
          highlightClaimInTranscript(obj);
          updateStats();
          queueVerification(obj);
        }
      }
      setStatus(state.isRunning ? prevStatus : 'Stopped', state.isRunning ? 'live' : '');
    } catch (err) {
      console.error('Claim ID error:', err);
      if (err.message.startsWith('RATE_LIMITED')) {
        setStatus(t('status_rate_limited'), 'checking');
      } else {
        setStatus('API error: ' + err.message.substring(0, 80), 'error');
      }
      state.pendingText = text + ' ' + state.pendingText;
    }
  }

  // ── Verification queue — one at a time, respects budget ──
  function queueVerification(claim) {
    pendingVerifications.push(claim);
    if (!isProcessingQueue) processVerificationQueue();
  }

  async function processVerificationQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    while (pendingVerifications.length > 0) {
      const claim = pendingVerifications.shift();
      await verifyClaim(claim);
    }
    isProcessingQueue = false;
  }

  async function identifyClaims(text) {
    const lang = getEffectiveLanguage();
    const langNames = {en:'English',es:'Spanish'};
    const langName = langNames[lang] || 'the same language as the transcript';
    const prompt = `You are a fact-checking analyst. Extract ALL verifiable claims from the transcript.

CONTEXT:
${getContextString()}

TRANSCRIPT:
"""
${text}
"""

RULES:
1. Extract ANY claim that contains: a number, percentage, date, statistic, named event, historical assertion, economic figure, comparison, or attribution — even if approximate ("cerca del 60%", "más de 100 años").
2. INCLUDE sweeping claims that reference time periods or magnitudes ("100 years of X", "the worst in history", "never created a single job") — these ARE checkable against historical data.
3. INCLUDE claims with approximate numbers ("cerca de", "alrededor de", "más de") — the approximation itself can be verified.
4. EXCLUDE ONLY: pure opinions with no factual anchor, predictions about the future, greetings, emotional expressions, applause, procedural statements.
5. Max 5 claims per chunk. Prioritize claims with concrete numbers, but also include broader historical/economic assertions.
6. If the text is only greetings/filler with NO factual content at all, return [].
7. Write "summary" as a precise, testable assertion in ${langName}.
8. Write "searchQuery" as a specific search query to find data that confirms or denies the claim.

JSON array (or []):
[{"claim":"verbatim quote from transcript","summary":"testable assertion in ${langName}","searchQuery":"specific data-finding query"}]`;
    const claimSchema = {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          claim: { type: 'STRING' },
          summary: { type: 'STRING' },
          searchQuery: { type: 'STRING' }
        },
        required: ['claim', 'summary', 'searchQuery']
      }
    };
    const r = await callGemini(prompt, { temperature: 0.05, maxTokens: 512, jsonMode: true, jsonSchema: claimSchema });
    const parsed = parseJSON(r.text);
    if (!Array.isArray(parsed)) {
      console.warn('[FactChecker] Failed to parse identification response. Raw text:', r.text);
    }
    return Array.isArray(parsed) ? parsed : [];
  }

  // ==========================================================
  // CLAIM VERIFICATION
  // ==========================================================
  async function verifyClaim(claim) {
    const lang = getEffectiveLanguage();
    const langNames = {en:'English',es:'Spanish'};
    const langName = langNames[lang] || 'the same language as the claim';
    const prompt = `You are an aggressive fact-checker. Your job: FIND THE DATA. Do NOT say "difficult to verify" — SEARCH for it. Respond in ${langName}.

CONTEXT: ${getContextString()}
CLAIM: "${claim.summary || claim.text}"
Original: "${claim.text}"

YOU HAVE GOOGLE SEARCH. USE IT. Most economic, demographic, and political claims CAN be verified using:
- Official statistics agencies (INDEC, BLS, Eurostat, World Bank, IMF)
- Central bank reports (BCRA, Fed, ECB)
- Fact-checking organizations (Chequeado, PolitiFact, FullFact)
- News archives and government reports
Do NOT assume data is unavailable. SEARCH for it. If you truly cannot find ANY data after searching, only THEN mark UNCERTAIN.

DECISION RULES:
1. SEARCH for the specific data point (the number, date, percentage, statistic).
2. You found data that MATCHES the claim (within reasonable margin ±10-15%) → TRUE.
3. You found data that CONTRADICTS the claim (the real number is substantially different) → FALSE. Example: claim says "60% poverty" but official data shows 42% → FALSE. Claim says "7500% inflation" but data shows 211% → FALSE.
4. The claim is a SWEEPING NARRATIVE with no single verifiable data point ("100 years of decline", "the worst in history") → UNCERTAIN.
5. You genuinely cannot find ANY relevant data after searching → UNCERTAIN.
6. Partially true but with misleading exaggeration or missing critical context that changes the meaning → FALSE.

ABSOLUTE RULES:
- NEVER say "difficult to verify" for claims with specific numbers. Numbers are ALWAYS verifiable — search for them.
- NEVER mark TRUE if your own explanation shows different numbers than the claim. If claim says X but you found Y, and X ≠ Y, that is FALSE.
- ALWAYS state: "Claim says [X]. Official data shows [Y]." in your explanation.
- The explanation MUST be consistent with the verdict. If you write "data shows a different figure", the verdict MUST be FALSE, not TRUE or UNCERTAIN.
- Political speeches routinely exaggerate. When the real number exists but differs significantly, that's FALSE — not "hard to verify".
- Write the "explanation" field in ${langName}. Keep it 2-3 sentences. Always compare claimed vs real numbers.

CRITICAL: Your ENTIRE response must be a single JSON object. No text before or after. All analysis goes inside "explanation".

{"verdict":"TRUE|FALSE|UNCERTAIN","confidence":0.0-1.0,"explanation":"Claim says [X]. Official data from [source] shows [Y]. Therefore [verdict reasoning]","needsClarification":false,"clarificationQuestion":null}`;

    try {
      const r = await callGemini(prompt, { grounded: true, maxTokens: 1024 });
      let p = parseJSON(r.text);
      // Grounded calls can't use JSON mode, so Gemini sometimes responds in prose.
      // If parseJSON fails, try to extract verdict from the natural language response.
      if (!p && r.text && r.text.length > 10) {
        console.warn('[FactChecker] Grounded response was not JSON, extracting from prose:', r.text.substring(0, 200));
        p = extractVerdictFromProse(r.text);
      }
      // Self-consistency check: if the explanation mentions contradicting data but verdict is TRUE, override
      if (p && p.verdict) {
        const v = p.verdict.toUpperCase();
        const expl = (p.explanation || '').toLowerCase();
        // Detect contradiction: verdict says TRUE but explanation mentions different/contradicting numbers
        if (v === 'TRUE') {
          const contradictionSignals = [
            /(?:data|datos|cifra|oficial|indec|bcra)\s+(?:shows?|muestra|indica|registr[aó]|señala)\s+(?:un |una |el |la |los |las )?(?:\d|diferente|distint)/i,
            /(?:sin embargo|however|but|pero)\s.*?(?:\d+[.,]?\d*\s*%)/i,
            /(?:real|actual|oficial)\s+(?:figure|number|dato|cifra|porcentaje)\s.*?(?:differ|distint|no coincid)/i,
          ];
          for (const re of contradictionSignals) {
            if (re.test(p.explanation)) {
              console.warn('[FactChecker] Self-consistency override: TRUE→UNCERTAIN (explanation contradicts verdict)');
              p.verdict = 'UNCERTAIN';
              p.confidence = Math.min(p.confidence || 0.5, 0.5);
              break;
            }
          }
        }
      }
      if (p) {
        claim.status = 'verified';
        claim.verdict = (p.verdict||'UNCERTAIN').toUpperCase();
        claim.confidence = p.confidence || 0.5;
        claim.explanation = p.explanation || '';
        claim.sources = r.sources || [];
        if (p.needsClarification && p.clarificationQuestion) {
          const existing = findClarification(p.clarificationQuestion);
          if (existing) { claim.status = 'pending'; await reVerify(claim, p.clarificationQuestion, existing); return; }
          else { claim.needsClarification = true; claim.clarificationQuestion = p.clarificationQuestion; showClarification(claim.id, p.clarificationQuestion); }
        }
      } else {
        console.warn('[FactChecker] Failed to parse verification response. Raw text:', r.text);
        claim.status = 'verified'; claim.verdict = 'UNCERTAIN';
        // Show the raw response so the user can see what went wrong
        const preview = (r.text || '').substring(0, 200).trim();
        claim.explanation = preview ? 'API returned unexpected format: "' + preview + '..."' : 'API returned empty response';
      }
    } catch (err) {
      console.error('Verification error:', err);
      if (err.message.startsWith('RATE_LIMITED')) {
        claim.explanation = 'Rate limited — queued for retry...';
        updateClaimInTranscript(claim);
        pendingVerifications.unshift(claim);
        // Wait for the server backoff then continue
        const waitMs = parseInt(err.message.split(':')[1]) || 30000;
        await sleep(waitMs);
        return;
      }
      claim.status = 'verified'; claim.verdict = 'UNCERTAIN'; claim.explanation = 'Error: ' + err.message.substring(0, 100);
    }
    updateClaimInTranscript(claim);
    updateStats();
  }

  async function reVerify(claim, question, answer) {
    const prompt = `Verify claim with context. ${getContextString()}\nQ: ${question} A: ${answer}\nCLAIM: "${claim.text}"\nJSON: {"verdict":"TRUE|FALSE|UNCERTAIN","confidence":0-1,"explanation":"..."}`;
    try {
      const r = await callGemini(prompt, { grounded: true, maxTokens: 512 });
      const p = parseJSON(r.text);
      if (p) { claim.status='verified'; claim.verdict=(p.verdict||'UNCERTAIN').toUpperCase(); claim.confidence=p.confidence||0.5; claim.explanation=p.explanation||''; claim.sources=r.sources||[]; claim.needsClarification=false; }
    } catch { claim.status='verified'; claim.verdict='UNCERTAIN'; claim.explanation='Re-verification failed.'; }
    updateClaimInTranscript(claim);
    updateStats();
  }

  // ==========================================================
  // CLARIFICATIONS
  // ==========================================================
  function findClarification(q) {
    const ql = q.toLowerCase();
    for (const [k,v] of Object.entries(state.clarifications)) {
      if (ql.includes(k.toLowerCase()) || k.toLowerCase().includes(ql)) return v;
    }
    return null;
  }

  function showClarification(claimId, question) {
    state.pendingClarification = { claimId, question };
    dom.clarQuestion.textContent = question;
    dom.clarInput.value = '';
    dom.clarBanner.classList.remove('hidden');
    dom.clarInput.focus();
  }

  function submitClarification() {
    const answer = dom.clarInput.value.trim();
    if (!answer || !state.pendingClarification) return;
    const { claimId, question } = state.pendingClarification;
    state.clarifications[question] = answer;
    chrome.storage.local.set({ clarifications: state.clarifications });
    dom.clarBanner.classList.add('hidden');
    state.pendingClarification = null;
    const claim = state.claims.get(claimId);
    if (claim) { claim.status = 'pending'; updateClaimInTranscript(claim); reVerify(claim, question, answer); }
  }

  // ==========================================================
  // HIGHLIGHTING
  // ==========================================================
  function highlightClaimInTranscript(claim) {
    const blocks = dom.transcript.querySelectorAll('.transcript-block');
    const escaped = escapeRegExp(claim.text);

    for (const block of blocks) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.parentElement.classList.contains('claim-mark')) nodes.push(walker.currentNode);
      }
      for (const node of nodes) {
        const match = node.textContent.match(new RegExp(`(${escaped})`, 'i'));
        if (match) {
          const idx = match.index;
          const before = node.textContent.substring(0, idx);
          const matched = node.textContent.substring(idx, idx + match[1].length);
          const after = node.textContent.substring(idx + match[1].length);
          const mark = document.createElement('mark');
          mark.className = 'claim-mark claim-pending';
          mark.dataset.claimId = claim.id;
          mark.dataset.tooltip = t('tooltip_verifying');
          mark.textContent = matched;
          const frag = document.createDocumentFragment();
          if (before) frag.appendChild(document.createTextNode(before));
          frag.appendChild(mark);
          if (after) frag.appendChild(document.createTextNode(after));
          node.parentNode.replaceChild(frag, node);
          return;
        }
      }
    }

    // Fuzzy fallback: find best matching block
    const claimWords = claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    let best = null, bestScore = 0;
    for (const b of blocks) {
      const bt = b.textContent.toLowerCase();
      const score = claimWords.filter(w => bt.includes(w)).length;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    if (best && bestScore >= Math.min(3, claimWords.length)) {
      const ind = document.createElement('mark');
      ind.className = 'claim-mark claim-pending';
      ind.dataset.claimId = claim.id;
      ind.dataset.tooltip = t('tooltip_verifying');
      ind.textContent = ` [${claim.summary.substring(0,50)}...]`;
      ind.style.fontSize = '12px';
      best.appendChild(ind);
    }
  }

  function updateClaimInTranscript(claim) {
    const marks = dom.transcript.querySelectorAll(`[data-claim-id="${claim.id}"]`);
    for (const m of marks) {
      m.className = 'claim-mark';
      const v = (claim.verdict || 'uncertain').toLowerCase();
      if (v === 'true') { m.classList.add('claim-true'); m.dataset.tooltip = t('tooltip_true'); }
      else if (v === 'false') { m.classList.add('claim-false'); m.dataset.tooltip = t('tooltip_false'); }
      else { m.classList.add('claim-uncertain'); m.dataset.tooltip = t('tooltip_uncertain'); }
    }
  }

  // ==========================================================
  // CLAIM HOVER TOOLTIP
  // ==========================================================
  function showClaimTooltip(el, claim) {
    const tooltip = document.getElementById('claimTooltip');
    const v = (claim.verdict || 'pending').toLowerCase();
    const icons = { true: '\u2713', false: '\u2717', uncertain: '?', pending: '\u21BB' };

    const verdictDiv = tooltip.querySelector('.ct-verdict');
    verdictDiv.className = 'ct-verdict ' + v;
    verdictDiv.textContent = (icons[v] || '?') + ' ' + t('verdict_' + v);

    const summaryDiv = tooltip.querySelector('.ct-summary');
    if (claim.explanation) {
      const maxLen = 150;
      summaryDiv.textContent = claim.explanation.substring(0, maxLen) + (claim.explanation.length > maxLen ? '\u2026' : '');
    } else {
      summaryDiv.textContent = v === 'pending' ? t('tooltip_verifying') : '';
    }

    const sourcesDiv = tooltip.querySelector('.ct-sources');
    if (claim.sources?.length) {
      sourcesDiv.innerHTML = claim.sources.slice(0, 2).map(s => {
        const title = (s.title || s.url || '').substring(0, 55);
        return '<span class="ct-src">\uD83D\uDCC4 ' + escapeHtml(title) + '</span>';
      }).join('');
    } else {
      sourcesDiv.innerHTML = '';
    }

    const footerDiv = tooltip.querySelector('.ct-footer');
    footerDiv.textContent = claim.status === 'verified' ? t('tooltip_click') : '';

    // Position above the element
    tooltip.classList.remove('hidden');
    const rect = el.getBoundingClientRect();
    const tRect = tooltip.getBoundingClientRect();
    let top = rect.top - tRect.height - 8;
    let left = rect.left + (rect.width / 2) - (tRect.width / 2);

    if (top < 4) top = rect.bottom + 8;
    if (left < 4) left = 4;
    if (left + tRect.width > window.innerWidth - 4) left = window.innerWidth - tRect.width - 4;

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function hideClaimTooltip() {
    document.getElementById('claimTooltip').classList.add('hidden');
  }

  // ==========================================================
  // MODAL
  // ==========================================================
  function openClaimDetail(id) {
    const c = state.claims.get(id);
    if (!c) return;
    const v = (c.verdict||'uncertain').toLowerCase();
    const icons = { true:'\u2713', false:'\u2717', uncertain:'?' };
    dom.modalVerdict.className = 'modal-verdict ' + v;
    dom.modalVerdict.innerHTML = `<span class="verdict-icon">${icons[v]||'?'}</span> ${t('verdict_' + v)}`;
    dom.modalClaim.textContent = c.text;
    dom.modalExplanation.textContent = c.explanation || 'Verification in progress...';
    if (c.sources?.length) {
      dom.modalSources.innerHTML = `<div class="source-label">${t('label_sources')}</div>` + c.sources.map(s => `<a href="${escapeHtml(s.url||s)}" target="_blank">${escapeHtml(s.title||s.url||s)}</a>`).join('');
    } else { dom.modalSources.innerHTML = ''; }
    if (c.confidence > 0) {
      const pct = Math.round(c.confidence*100);
      const col = v==='true'?'var(--green)':v==='false'?'var(--red)':'var(--yellow)';
      dom.modalConfidence.innerHTML = `${t('label_confidence')}: ${pct}%<div class="confidence-bar"><div class="confidence-fill" style="width:${pct}%;background:${col}"></div></div>`;
    } else { dom.modalConfidence.innerHTML = ''; }
    dom.modal.classList.remove('hidden');
  }

  function closeModal() { dom.modal.classList.add('hidden'); }

  // ==========================================================
  // STATS
  // ==========================================================
  function updateStats() {
    dom.statWords.textContent = state.wordCount;
    dom.statClaims.textContent = state.claims.size;
    let t=0,f=0,u=0;
    for (const c of state.claims.values()) {
      if (c.verdict==='TRUE') t++; else if (c.verdict==='FALSE') f++; else if (c.status==='verified') u++;
    }
    dom.statTrue.textContent = t;
    dom.statFalse.textContent = f;
    dom.statUncertain.textContent = u;
  }

  // ==========================================================
  // EXPORT REPORT
  // ==========================================================
  function exportReport() {
    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
    const timeStr = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const speaker = dom.ctxSpeaker.value.trim() || 'Unknown';
    const event = dom.ctxEvent.value.trim() || state.context.title || 'Untitled';
    const videoDate = state.context.date || '';
    const url = state.context.url || '';
    const platform = state.context.platform || '';
    const description = state.context.description || '';
    const duration = state.startTime ? Math.round((Date.now() - state.startTime) / 60000) : 0;

    // Gather claim stats
    let trueCount=0, falseCount=0, uncertainCount=0;
    const claimList = [];
    for (const c of state.claims.values()) {
      if (c.verdict==='TRUE') trueCount++;
      else if (c.verdict==='FALSE') falseCount++;
      else uncertainCount++;
      claimList.push(c);
    }

    // Build transcript HTML with inline claim highlights
    let transcriptHtml = '';
    for (const entry of state.transcript) {
      const t = new Date(entry.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      let text = escapeHtml(entry.text);
      // Highlight claims inline
      for (const c of claimList) {
        const escaped = escapeRegExp(escapeHtml(c.text));
        const v = (c.verdict||'uncertain').toLowerCase();
        const cls = v === 'true' ? 'claim-true' : v === 'false' ? 'claim-false' : 'claim-uncertain';
        const label = v === 'true' ? 'TRUE' : v === 'false' ? 'FALSE' : 'UNCERTAIN';
        text = text.replace(new RegExp(`(${escaped})`, 'i'), `<mark class="${cls}" title="${label}: ${escapeHtml(c.explanation?.substring(0,100)||'')}">$1</mark>`);
      }
      transcriptHtml += `<div class="t-entry"><span class="t-time">${t}</span>${text}</div>\n`;
    }

    // Build claims detail HTML
    let claimsHtml = '';
    for (const c of claimList) {
      const v = (c.verdict||'uncertain').toLowerCase();
      const cls = v === 'true' ? 'v-true' : v === 'false' ? 'v-false' : 'v-uncertain';
      const icon = v === 'true' ? '\u2713' : v === 'false' ? '\u2717' : '?';
      const label = (c.verdict||'PENDING').toUpperCase();
      const pct = c.confidence ? Math.round(c.confidence*100) : 0;
      const sourcesHtml = (c.sources||[]).map(s => `<a href="${escapeHtml(s.url||s)}" target="_blank">${escapeHtml(s.title||s.url||s)}</a>`).join('');
      claimsHtml += `
      <div class="claim-card ${cls}">
        <div class="claim-header">
          <span class="verdict-badge ${cls}"><span class="v-icon">${icon}</span> ${label}</span>
          <span class="confidence">${pct}% confidence</span>
        </div>
        <blockquote>"${escapeHtml(c.text)}"</blockquote>
        <p class="explanation">${escapeHtml(c.explanation||'')}</p>
        ${sourcesHtml ? '<div class="sources">Sources: ' + sourcesHtml + '</div>' : ''}
      </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fact Check Report — ${escapeHtml(event)}</title>
<style>
:root { --bg:#0f1117; --bg2:#181a24; --bg3:#1e2130; --border:#2a2e3f; --text:#e2e4ed; --dim:#8b8fa3; --muted:#5c6078; --accent:#6366f1; --green:#22c55e; --yellow:#eab308; --red:#ef4444; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;padding:0}
.container{max-width:860px;margin:0 auto;padding:32px 24px 48px}
/* Header */
.report-header{text-align:center;padding:40px 24px 32px;background:linear-gradient(135deg,#1a1040 0%,#0f1117 50%,#0a1628 100%);border-bottom:1px solid var(--border);margin-bottom:32px}
.report-header h1{font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:4px}
.report-header .subtitle{color:var(--dim);font-size:15px;margin-bottom:16px}
.meta-row{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.meta-row span{display:flex;align-items:center;gap:4px}
.meta-row a{color:var(--accent);text-decoration:none}
/* Stats */
.stats-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:32px}
.stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center}
.stat-card .num{font-size:28px;font-weight:800}
.stat-card .label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-top:2px}
.stat-card.st-true .num{color:var(--green)} .stat-card.st-false .num{color:var(--red)} .stat-card.st-uncertain .num{color:var(--yellow)}
/* Sections */
h2{font-size:18px;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
h2 .count{font-size:13px;font-weight:500;color:var(--muted);background:var(--bg3);padding:2px 10px;border-radius:12px}
/* Claims */
.claim-card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;border-left:4px solid var(--muted)}
.claim-card.v-true{border-left-color:var(--green)} .claim-card.v-false{border-left-color:var(--red)} .claim-card.v-uncertain{border-left-color:var(--yellow)}
.claim-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.verdict-badge{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:4px;padding:3px 10px;border-radius:6px}
.verdict-badge.v-true{background:rgba(34,197,94,.15);color:var(--green)} .verdict-badge.v-false{background:rgba(239,68,68,.15);color:var(--red)} .verdict-badge.v-uncertain{background:rgba(234,179,8,.15);color:var(--yellow)}
.v-icon{font-size:14px}
.confidence{font-size:11px;color:var(--muted)}
blockquote{font-style:italic;color:var(--text);padding:8px 14px;margin:8px 0;border-left:3px solid var(--border);background:var(--bg3);border-radius:0 6px 6px 0;font-size:14px}
.explanation{font-size:13px;color:var(--dim);margin-top:6px;line-height:1.5}
.sources{font-size:12px;margin-top:8px;color:var(--muted)}
.sources a{color:var(--accent);text-decoration:none;margin-right:12px}
.sources a:hover{text-decoration:underline}
/* Transcript */
.transcript-section{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:32px}
.t-entry{margin-bottom:6px;font-size:13.5px;line-height:1.7}
.t-time{font-size:10px;color:var(--muted);margin-right:8px;font-variant-numeric:tabular-nums}
mark{padding:1px 3px;border-radius:3px;border-bottom:2px solid transparent}
.claim-true{background:rgba(34,197,94,.15);border-bottom-color:var(--green)}
.claim-false{background:rgba(239,68,68,.15);border-bottom-color:var(--red)}
.claim-uncertain{background:rgba(234,179,8,.15);border-bottom-color:var(--yellow)}
/* Footer */
.report-footer{text-align:center;padding:24px;color:var(--muted);font-size:12px;border-top:1px solid var(--border);margin-top:24px}
.report-footer a{color:var(--accent);text-decoration:none}
/* Print */
@media print{body{background:#fff;color:#111}.report-header{background:#f5f5f5}.stat-card,.claim-card,.transcript-section{border-color:#ddd;background:#fafafa}mark{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
@media(max-width:600px){.stats-grid{grid-template-columns:repeat(3,1fr)}.container{padding:16px}}
</style>
</head>
<body>
<div class="report-header">
  <h1>Fact Check Report</h1>
  <div class="subtitle">${escapeHtml(event)}</div>
  <div class="meta-row">
    <span><strong>By:</strong> ${escapeHtml(speaker)}</span>
    ${videoDate ? '<span><strong>Date:</strong> ' + escapeHtml(videoDate) + '</span>' : ''}
    ${platform ? '<span><strong>Platform:</strong> ' + escapeHtml(platform) + '</span>' : ''}
    <span><strong>Analyzed:</strong> ${escapeHtml(dateStr)} at ${escapeHtml(timeStr)}</span>
    ${duration ? '<span><strong>Duration:</strong> ' + duration + ' min</span>' : ''}
  </div>
  ${url ? '<div class="meta-row" style="margin-top:8px"><a href="' + escapeHtml(url) + '" target="_blank">' + escapeHtml(url) + '</a></div>' : ''}
</div>
<div class="container">
  <div class="stats-grid">
    <div class="stat-card"><div class="num">${state.wordCount.toLocaleString()}</div><div class="label">Words</div></div>
    <div class="stat-card"><div class="num">${state.claims.size}</div><div class="label">Claims</div></div>
    <div class="stat-card st-true"><div class="num">${trueCount}</div><div class="label">True</div></div>
    <div class="stat-card st-false"><div class="num">${falseCount}</div><div class="label">False</div></div>
    <div class="stat-card st-uncertain"><div class="num">${uncertainCount}</div><div class="label">Uncertain</div></div>
  </div>

  ${claimList.length > 0 ? `
  <h2>Claims Analysis <span class="count">${claimList.length} claims</span></h2>
  ${claimsHtml}
  ` : '<p style="color:var(--muted);text-align:center;padding:20px">No claims were identified during this session.</p>'}

  <h2 style="margin-top:32px">Full Transcript <span class="count">${state.transcript.length} segments</span></h2>
  <div class="transcript-section">
    ${transcriptHtml || '<p style="color:var(--muted)">No transcript recorded.</p>'}
  </div>

  ${description ? `
  <h2>Video Description</h2>
  <div class="transcript-section" style="font-size:13px;color:var(--dim)">
    ${escapeHtml(description)}
  </div>
  ` : ''}
</div>
<div class="report-footer">
  Live Fact Checker by <a href="https://twitter.com/alandaitch" target="_blank">@alandaitch</a><br>
  Report generated on ${escapeHtml(dateStr)} at ${escapeHtml(timeStr)} &middot; Powered by Gemini + Whisper
</div>
</body>
</html>`;

    // Download as HTML
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    const filename = 'fact-check-' + event.replace(/[^a-zA-Z0-9]/g,'-').substring(0,40).replace(/-+$/,'') + '-' + now.toISOString().slice(0,10) + '.html';
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(t('status_report_exported'));
  }

  // ==========================================================
  // UTILS
  // ==========================================================
  function formatVideoTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    return m + ':' + String(s).padStart(2,'0');
  }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ==========================================================
  // BOOT
  // ==========================================================
  init();
})();
