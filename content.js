// ============================================================
// Live Fact Checker — Content Script (YouTube)
// ============================================================
// HYBRID approach: debounce for pre-recorded + timeout for live.
// Tracks the longest caption text in each "window" (between
// caption appearances) so even rapidly-updating live CC gets sent.
// ============================================================

(() => {
  'use strict';

  let isMonitoring = false;
  let pollTimer = null;
  let retryCount = 0;

  // ── Debounce + window tracking ──────────────────────────────
  let lastRawText = '';          // last raw caption snapshot
  let stableCount = 0;          // how many polls the text has been stable
  const STABLE_THRESHOLD = 2;   // require 2 consecutive identical polls (~1.2s)

  // "Window" tracking: accumulates the longest text seen between
  // caption appearances, so live streams don't get lost.
  let windowLongestText = '';    // longest text seen in current caption window
  let windowStartTime = 0;      // when the current window started
  let windowLastChange = 0;     // last time text changed within window
  let hasFlushedWindow = false;  // have we already flushed this window?
  const MAX_WINDOW_WAIT = 3500;  // after 3.5s of changing text, send what we have
  const LIVE_FLUSH_INTERVAL = 4000; // for live, flush every 4s of accumulated text

  let lastSentText = '';         // last text we actually sent
  let sentHistory = [];          // history of sent texts for overlap detection
  const MAX_HISTORY = 20;

  // ── Caption selectors ──────────────────────────────────────
  const CAPTION_SELECTORS = [
    '.ytp-caption-segment',
    '.captions-text span',
    '.caption-visual-line span',
    '.caption-window span[style]',
    '.ytp-caption-window-container span',
    // Newer YouTube layouts
    '.ytp-caption-window-rollup span',
    '.ytp-caption-window-bottom span',
    '#ytp-caption-window-container span',
    '.caption-window .captions-text .caption-visual-line',
  ];

  const CONTAINER_SELECTORS = [
    '.caption-window',
    '.captions-text',
    '.ytp-caption-window-container',
    '#ytp-caption-window-container',
  ];

  const CC_BUTTON_SELECTORS = [
    '.ytp-subtitles-button',
    'button.ytp-subtitles-button',
  ];

  function log(...args) {
    console.log('[FactChecker Content]', ...args);
  }

  // ── Context extraction ────────────────────────────────────
  function getPageContext() {
    const title =
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent ||
      document.querySelector('#title h1')?.textContent ||
      document.querySelector('title')?.textContent?.replace(' - YouTube', '') || '';

    const channel =
      document.querySelector('#channel-name a')?.textContent?.trim() ||
      document.querySelector('ytd-channel-name a')?.textContent?.trim() ||
      document.querySelector('#owner #upload-info #channel-name a')?.textContent?.trim() ||
      document.querySelector('.ytd-video-owner-renderer #channel-name a')?.textContent?.trim() || '';

    const description =
      document.querySelector('#description-inline-expander')?.textContent?.substring(0, 500) ||
      document.querySelector('#description')?.textContent?.substring(0, 500) || '';

    const isLive =
      !!document.querySelector('.ytp-live-badge[disabled]') ||
      !!document.querySelector('.ytp-live') ||
      !!document.querySelector('.badge-style-type-live-now') ||
      document.querySelector('.ytp-time-display')?.textContent?.includes('LIVE') ||
      false;

    const date =
      document.querySelector('#info-strings yt-formatted-string')?.textContent?.trim() ||
      document.querySelector('ytd-video-primary-info-renderer #info-strings span')?.textContent?.trim() ||
      document.querySelector('#info #date yt-formatted-string')?.textContent?.trim() ||
      document.querySelector('.date.ytd-video-primary-info-renderer')?.textContent?.trim() ||
      '';

    return { title, channel, description, date, isLive, url: location.href, platform: 'YouTube' };
  }

  // ── Enable captions ───────────────────────────────────────
  function enableCaptions() {
    for (const sel of CC_BUTTON_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn) {
        const pressed = btn.getAttribute('aria-pressed');
        log('CC button found, aria-pressed =', pressed);
        if (pressed === 'false') {
          btn.click();
          log('Clicked CC button to enable captions');
          return 'enabled';
        }
        return pressed === 'true' ? 'already_on' : 'unknown';
      }
    }
    log('CC button NOT found in DOM');
    return 'no_button';
  }

  // ── YouTube UI junk patterns to filter out ─────────────────
  // These are YouTube settings/overlay strings that leak into caption selectors
  const UI_JUNK_PATTERNS = [
    /\b(generado automáticamente|auto-generated)\b/i,
    /\bhaz clic\b/i,
    /\bclick to\b/i,
    /\bacceder a la configuración\b/i,
    /\baccess.*settings\b/i,
    /\bsubtítulos?\b.*\b(activad|desactivad|generado)\b/i,
    /\bcaptions?\b.*\b(on|off|settings)\b/i,
    /\bidioma\b.*\b(original|audio)\b/i,
    /\blanguage\b.*\b(original|audio)\b/i,
    /\b(Español|English|Português|Français|Deutsch)\s*\(.*\)/i,
  ];

  function isUIJunk(text) {
    for (const pattern of UI_JUNK_PATTERNS) {
      if (pattern.test(text)) return true;
    }
    return false;
  }

  // ── Read current caption text ─────────────────────────────
  function readCaptionText() {
    // Try specific selectors first
    for (const sel of CAPTION_SELECTORS) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        const seen = new Set();
        const parts = [];
        for (const el of els) {
          // Skip elements inside YouTube settings panels
          if (el.closest('.ytp-panel, .ytp-settings-menu, .ytp-menuitem, .ytp-popup')) continue;
          const t = el.textContent.trim();
          if (t && !seen.has(t) && !isUIJunk(t)) {
            seen.add(t);
            parts.push(t);
          }
        }
        const text = parts.join(' ').trim();
        if (text.length > 0 && !isUIJunk(text)) return text;
      }
    }
    // Fallback: read entire container
    for (const sel of CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text.length > 0 && !isUIJunk(text)) return text;
      }
    }
    return '';
  }

  // ── Normalize for comparison ──────────────────────────────
  function normalize(text) {
    return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  // ── Extract new text by removing overlap with history ─────
  function extractNewText(settledText) {
    if (!lastSentText) return settledText;

    const words = settledText.split(/\s+/);
    const oldWords = lastSentText.split(/\s+/);

    // Case 1: new text starts with old text (prefix match)
    if (settledText.startsWith(lastSentText)) {
      const suffix = settledText.slice(lastSentText.length).trim();
      return suffix || '';
    }

    // Case 2: find longest overlap (suffix of old = prefix of new)
    let bestOverlap = 0;
    for (let i = Math.min(words.length, oldWords.length); i >= 1; i--) {
      const oldTail = oldWords.slice(-i).join(' ');
      const newHead = words.slice(0, i).join(' ');
      if (oldTail === newHead) {
        bestOverlap = i;
        break;
      }
    }
    if (bestOverlap > 0) {
      return words.slice(bestOverlap).join(' ');
    }

    // Case 3: check against full history
    for (const prev of sentHistory) {
      const prevWords = prev.split(/\s+/);
      for (let i = Math.min(words.length, prevWords.length); i >= 2; i--) {
        const prevTail = prevWords.slice(-i).join(' ');
        const newHead = words.slice(0, i).join(' ');
        if (prevTail === newHead) {
          return words.slice(i).join(' ');
        }
      }
    }

    // Case 4: check if new text is entirely contained in a recent send
    const normNew = normalize(settledText);
    for (const prev of sentHistory) {
      if (normalize(prev).includes(normNew)) return '';
    }

    return settledText;
  }

  // ── Send text upstream ────────────────────────────────────
  function sendText(text) {
    if (!text || text.trim().length < 2) return;

    const newText = extractNewText(text);
    if (!newText || newText.trim().length < 2) return;

    // Final dedup: check normalized text against recent sends
    const normNew = normalize(newText);
    for (const prev of sentHistory.slice(-10)) {
      const normPrev = normalize(prev);
      if (normPrev === normNew) return;
      if (normPrev.includes(normNew) && normNew.length < normPrev.length) return;
    }

    lastSentText = text;
    sentHistory.push(text);
    if (sentHistory.length > MAX_HISTORY) sentHistory.shift();

    log('Sending:', newText.trim().substring(0, 80) + '...');

    chrome.runtime.sendMessage({
      type: 'CAPTION_UPDATE',
      text: newText.trim(),
      timestamp: Date.now()
    }).catch(() => {});
  }

  // ── Poll for captions (hybrid: debounce + window timeout) ─
  function pollCaptions() {
    const rawText = readCaptionText();
    const now = Date.now();

    if (!rawText) {
      retryCount++;
      if (retryCount % 25 === 0) {
        log('No captions after', retryCount, 'polls. Re-trying CC...');
        enableCaptions();
        sendStatus('No captions detected yet. Make sure CC is on.');
      }

      // Caption window ended — flush whatever we accumulated
      if (windowLongestText && !hasFlushedWindow) {
        log('Captions disappeared, flushing window:', windowLongestText.substring(0, 60));
        sendText(windowLongestText);
        hasFlushedWindow = true;
      }

      // Reset window state
      windowLongestText = '';
      windowStartTime = 0;
      windowLastChange = 0;
      hasFlushedWindow = false;
      lastRawText = '';
      stableCount = 0;
      return;
    }

    retryCount = 0;

    // ── Track the caption window ──
    if (!windowStartTime) {
      windowStartTime = now;
      windowLastChange = now;
    }

    // Keep track of the longest caption text in this window
    if (rawText.length > windowLongestText.length) {
      windowLongestText = rawText;
    }

    // ── Standard debounce check ──
    if (rawText === lastRawText) {
      stableCount++;
      if (stableCount === STABLE_THRESHOLD && !hasFlushedWindow) {
        // Text stabilized — send it
        log('Text stable, flushing');
        sendText(rawText);
        hasFlushedWindow = true;
        windowLongestText = ''; // Reset for next accumulation
        windowStartTime = now;
      }
    } else {
      // Text changed
      stableCount = 0;
      windowLastChange = now;
      lastRawText = rawText;

      // ── LIVE STREAM FALLBACK ──
      // If text has been changing for too long without stabilizing, send what we have
      if (!hasFlushedWindow && windowStartTime && (now - windowStartTime) > MAX_WINDOW_WAIT) {
        log('Max wait exceeded, flushing window (live mode):', windowLongestText.substring(0, 60));
        sendText(windowLongestText);
        hasFlushedWindow = true;
        // Start a new accumulation window
        windowLongestText = rawText;
        windowStartTime = now;
        hasFlushedWindow = false;
      }
    }

    // ── Periodic flush for long-running live captions ──
    // If we've already flushed but new text keeps accumulating
    if (hasFlushedWindow && windowLongestText &&
        rawText.length > 0 &&
        (now - windowStartTime) > LIVE_FLUSH_INTERVAL) {
      log('Periodic live flush:', windowLongestText.substring(0, 60));
      sendText(windowLongestText);
      windowLongestText = rawText;
      windowStartTime = now;
    }
  }

  // ── Send status message ───────────────────────────────────
  function sendStatus(message) {
    chrome.runtime.sendMessage({
      type: 'CONTENT_STATUS',
      message,
      timestamp: Date.now()
    }).catch(() => {});
  }

  // ── Full transcript extraction is handled by background.js ──
  // Uses chrome.scripting.executeScript with world: 'MAIN' to
  // access the YouTube player API directly, bypassing CSP.
  // See background.js GET_FULL_TRANSCRIPT handler.

  // ── Start monitoring ──────────────────────────────────────
  function startMonitoring() {
    if (isMonitoring) return { success: true, status: 'already_running' };

    log('Starting caption monitoring (hybrid debounce+window mode)');
    isMonitoring = true;
    lastRawText = '';
    stableCount = 0;
    windowLongestText = '';
    windowStartTime = 0;
    windowLastChange = 0;
    hasFlushedWindow = false;
    lastSentText = '';
    sentHistory = [];
    retryCount = 0;

    const ccStatus = enableCaptions();
    log('CC enable result:', ccStatus);

    // Poll every 500ms — fast enough to catch live updates
    pollTimer = setInterval(pollCaptions, 500);

    // Also check right away
    setTimeout(pollCaptions, 300);
    setTimeout(pollCaptions, 800);

    const context = getPageContext();
    return {
      success: true,
      ccStatus,
      isLive: context.isLive,
      title: context.title,
      channel: context.channel
    };
  }

  // ── Stop monitoring ───────────────────────────────────────
  function stopMonitoring() {
    log('Stopping caption monitoring');
    isMonitoring = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // Flush any remaining text
    if (windowLongestText && !hasFlushedWindow) {
      sendText(windowLongestText);
    }
    lastRawText = '';
    stableCount = 0;
    windowLongestText = '';
    windowStartTime = 0;
    windowLastChange = 0;
    hasFlushedWindow = false;
    lastSentText = '';
    sentHistory = [];
    return { success: true };
  }

  // ── Message listener ──────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    log('Received message:', msg.type);
    switch (msg.type) {
      case 'GET_CONTEXT':
        sendResponse({ context: getPageContext() });
        break;
      case 'START_CAPTIONS':
        sendResponse(startMonitoring());
        break;
      case 'STOP_CAPTIONS':
        sendResponse(stopMonitoring());
        break;
      case 'PING':
        sendResponse({ pong: true, monitoring: isMonitoring, url: location.href });
        break;
      default:
        break;
    }
    return false;
  });

  // ── SPA navigation ────────────────────────────────────────
  document.addEventListener('yt-navigate-finish', () => {
    log('YouTube SPA navigation detected');
    if (isMonitoring) stopMonitoring();
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'CONTEXT_UPDATE',
        context: getPageContext()
      }).catch(() => {});
    }, 1500);
  });

  log('Content script loaded on', location.href);

})();
