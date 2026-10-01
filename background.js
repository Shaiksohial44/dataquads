// ============================================================
// Live Fact Checker — Background Service Worker
// ============================================================

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

let activeTabId = null;

// ── Helper: inject content script if needed, then send message ─
function ensureContentScriptAndSend(tabId, msg, sendResponse, retries = 2) {
  chrome.tabs.sendMessage(tabId, msg, (response) => {
    if (chrome.runtime.lastError) {
      if (retries > 0) {
        // Content script not there — inject it and retry
        console.log('[BG] Content script not found, injecting... (' + retries + ' retries left)');
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        }).then(() => {
          // Wait a beat for the script to initialize
          setTimeout(() => {
            ensureContentScriptAndSend(tabId, msg, sendResponse, retries - 1);
          }, 800);
        }).catch((err) => {
          sendResponse({ success: false, error: 'Injection failed: ' + err.message });
        });
      } else {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      }
    } else {
      sendResponse(response || { success: true });
    }
  });
}

// ── Message Router ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case 'GET_ACTIVE_TAB': {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          activeTabId = tabs[0].id;
          sendResponse({ tab: tabs[0] });
        } else {
          sendResponse({ tab: null });
        }
      });
      return true;
    }

    case 'GET_PAGE_CONTEXT': {
      const tabId = message.tabId || activeTabId;
      if (!tabId) { sendResponse({ context: null }); return; }
      // Auto-inject if needed
      ensureContentScriptAndSend(tabId, { type: 'GET_CONTEXT' }, (resp) => {
        sendResponse(resp?.context ? resp : { context: null });
      });
      return true;
    }

    case 'PING_CONTENT': {
      const tabId = message.tabId || activeTabId;
      if (!tabId) { sendResponse({ alive: false, error: 'no tab' }); return; }
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ alive: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ alive: true, ...response });
        }
      });
      return true;
    }

    case 'START_CAPTIONS':
    case 'STOP_CAPTIONS': {
      const tabId = message.tabId || activeTabId;
      if (!tabId) { sendResponse({ success: false, error: 'No active tab' }); return; }
      ensureContentScriptAndSend(tabId, { type: message.type }, sendResponse);
      return true;
    }

    case 'GET_FULL_TRANSCRIPT': {
      const tabId = message.tabId || activeTabId;
      if (!tabId) { sendResponse({ success: false, error: 'No active tab' }); return; }

      // Use chrome.scripting.executeScript with MAIN world to directly
      // access the YouTube player API — bypasses CSP entirely.
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [message.language || ''],
        func: async (preferLang) => {
          try {
            // ── Get player response (multiple sources, freshest first) ──
            let pr = null;

            // 1. YouTube player internal API — freshest, has VALID signed URLs
            var player = document.getElementById('movie_player');
            if (player && typeof player.getPlayerResponse === 'function') {
              pr = player.getPlayerResponse();
            }

            // 2. Global variable — may have stale/expired URLs after SPA nav
            if (!pr || !pr.captions) {
              pr = window.ytInitialPlayerResponse;
            }

            if (!pr || !pr.captions || !pr.captions.playerCaptionsTracklistRenderer ||
                !pr.captions.playerCaptionsTracklistRenderer.captionTracks ||
                pr.captions.playerCaptionsTracklistRenderer.captionTracks.length === 0) {
              return { error: 'No captions available for this video' };
            }

            var tracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks;
            var track = tracks[0];
            var safeLang = (preferLang || '').replace(/[^a-z\-]/gi, '');
            if (safeLang) {
              for (var i = 0; i < tracks.length; i++) {
                if (tracks[i].languageCode === safeLang) { track = tracks[i]; break; }
              }
            }

            // ── Fetch timedtext ─────────────────────────────────
            // Use baseUrl as-is (preserves signature). Only APPEND fmt=json3
            // if not present — never replace (replacing breaks the signature).
            var url = track.baseUrl;
            if (!url.includes('fmt=')) {
              url += '&fmt=json3';
            }

            var resp = await fetch(url);
            if (!resp.ok) return { error: 'Timedtext fetch failed: HTTP ' + resp.status };
            var body = await resp.text();

            // If empty, retry with fmt=json3 forcefully appended
            if (!body || body.trim().length < 2) {
              resp = await fetch(track.baseUrl + '&fmt=json3');
              if (resp.ok) body = await resp.text();
            }
            if (!body || body.trim().length < 2) {
              return { error: 'Empty transcript response from YouTube' };
            }

            // ── Parse response (JSON or XML) ───────────────────
            var segments = [];
            var trimmed = body.trim();

            if (trimmed[0] === '{') {
              // JSON (fmt=json3)
              var data = JSON.parse(body);
              var events = data.events || [];
              for (var j = 0; j < events.length; j++) {
                var ev = events[j];
                if (!ev.segs) continue;
                var txt = '';
                for (var k = 0; k < ev.segs.length; k++) txt += ev.segs[k].utf8 || '';
                txt = txt.trim();
                if (txt && txt !== '\n') {
                  segments.push({ text: txt, startMs: ev.tStartMs || 0, durationMs: ev.dDurationMs || 0 });
                }
              }
            } else if (trimmed[0] === '<') {
              // XML/SRV3 format — parse with DOMParser
              var parser = new DOMParser();
              var xml = parser.parseFromString(body, 'text/xml');
              var pEls = xml.querySelectorAll('p, text');
              for (var m = 0; m < pEls.length; m++) {
                var p = pEls[m];
                var startMs = parseInt(p.getAttribute('t') || p.getAttribute('start') || '0', 10);
                var durMs = parseInt(p.getAttribute('d') || p.getAttribute('dur') || '0', 10);
                // dur might be in seconds (float) for some formats
                if (durMs < 100 && durMs > 0) durMs = Math.round(durMs * 1000);
                var ptxt = p.textContent.trim();
                if (ptxt) segments.push({ text: ptxt, startMs: startMs, durationMs: durMs });
              }
            } else {
              return { error: 'Unexpected transcript format' };
            }

            if (segments.length === 0) return { error: 'Transcript parsed but contained no segments' };

            return {
              segments: segments,
              language: track.languageCode || '',
              trackName: (track.name && track.name.simpleText) || ''
            };
          } catch (e) {
            return { error: e.message || 'Unknown error extracting transcript' };
          }
        }
      }).then(results => {
        const result = results && results[0] && results[0].result;
        if (!result) {
          sendResponse({ success: false, error: 'Script returned no result' });
        } else if (result.error) {
          sendResponse({ success: false, error: result.error });
        } else {
          sendResponse({ success: true, ...result });
        }
      }).catch(err => {
        console.warn('[BG] MAIN world transcript extraction failed:', err.message);
        sendResponse({ success: false, error: 'Transcript extraction failed: ' + (err.message || 'unknown error') });
      });
      return true;
    }

    case 'INJECT_CONTENT_SCRIPT': {
      const tabId = message.tabId || activeTabId;
      if (!tabId) { sendResponse({ success: false }); return; }
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      }).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'GET_TAB_CAPTURE_STREAM': {
      const tabId = message.tabId || activeTabId;
      if (!tabId) { sendResponse({ streamId: null, error: 'No tab' }); return; }
      try {
        chrome.tabCapture.getMediaStreamId(
          { targetTabId: tabId },
          (streamId) => {
            if (chrome.runtime.lastError) {
              sendResponse({ streamId: null, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ streamId });
            }
          }
        );
      } catch (e) {
        sendResponse({ streamId: null, error: e.message });
      }
      return true;
    }

    case 'CAPTION_UPDATE':
    case 'CONTEXT_UPDATE':
    case 'CONTENT_STATUS':
      // These propagate to the side panel listener
      break;
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
});
