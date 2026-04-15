// ============================================================
// background.js — Service Worker for All Links Extractor PRO
// Manifest V3 compliant
// ============================================================

'use strict';

// ── Install / Activate ───────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ── Context Menus ────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'extractPage',
    title: 'Extract All Links from This Page',
    contexts: ['page', 'frame']
  });
  chrome.contextMenus.create({
    id: 'extractLink',
    title: 'Save This Link to Extractor',
    contexts: ['link']
  });
  console.log('[Links Extractor PRO] Extension installed / updated.');
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'extractPage') {
    // Trigger extraction on the active tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (_) { /* already injected */ }

    chrome.tabs.sendMessage(tab.id, { action: 'extractLinks', options: {} }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      if (response.success && response.links.length > 0) {
        saveSessionFromBackground(response.links, response.url, response.title);
      }
    });
  }

  if (info.menuItemId === 'extractLink' && info.linkUrl) {
    // Save single link to a quick-save list
    chrome.storage.local.get(['quickSaved'], (data) => {
      const list = data.quickSaved || [];
      const url  = info.linkUrl;
      if (!list.find(l => l.url === url)) {
        list.unshift({ url, savedAt: Date.now(), text: url });
        if (list.length > 200) list.pop();
        chrome.storage.local.set({ quickSaved: list });
      }
    });
  }
});

// ── Badge update helper ───────────────────────────────────────
function updateBadge(count) {
  const text = count > 0 ? (count > 999 ? '999+' : String(count)) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

// ── Save session (called from context menu) ───────────────────
function saveSessionFromBackground(links, url, title) {
  chrome.storage.local.get(['historyData', 'cumulativeStats'], (data) => {
    const history = data.historyData || [];
    const stats   = data.cumulativeStats || { totalLinks: 0, sessions: 0, sites: new Set() };

    const session = {
      id: 'sess_' + Date.now(),
      url, title,
      links,
      timestamp: Date.now(),
      pinned: false
    };

    history.unshift(session);
    if (history.length > 100) history.splice(100);

    const totalLinks = (stats.totalLinks || 0) + links.length;
    const sessions   = (stats.sessions   || 0) + 1;

    chrome.storage.local.set({
      historyData: history,
      currentLinks: links,
      cumulativeStats: { totalLinks, sessions }
    });
    updateBadge(links.length);
  });
}

// ── Message router ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Get active tab info ─────────────────────────────────────
  if (msg.action === 'getActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tab: tabs[0] || null });
    });
    return true;
  }

  // ── Inject content script & extract ────────────────────────
  if (msg.action === 'injectAndExtract') {
    const { tabId, options } = msg;
    (async () => {
      try {
        // Try injecting content script (may already be there)
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });
        } catch (_) { /* already injected — safe to ignore */ }

        // Send extraction request
        chrome.tabs.sendMessage(tabId, { action: 'extractLinks', options }, (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(resp || { success: false, error: 'No response from content script' });
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── Save session ────────────────────────────────────────────
  if (msg.action === 'saveSession') {
    const { session } = msg;
    chrome.storage.local.get(['historyData', 'cumulativeStats', 'settings'], (data) => {
      const history  = data.historyData      || [];
      const stats    = data.cumulativeStats  || { totalLinks: 0, sessions: 0 };
      const settings = data.settings         || { maxSessions: 20 };

      history.unshift(session);
      const max = parseInt(settings.maxSessions) || 20;
      if (history.length > max) history.splice(max);

      chrome.storage.local.set({
        historyData: history,
        currentLinks: session.links,
        cumulativeStats: {
          totalLinks: (stats.totalLinks || 0) + session.links.length,
          sessions:   (stats.sessions   || 0) + 1
        }
      }, () => {
        updateBadge(session.links.length);
        sendResponse({ success: true });
      });
    });
    return true;
  }

  // ── Update badge ────────────────────────────────────────────
  if (msg.action === 'updateBadge') {
    updateBadge(msg.count || 0);
    sendResponse({ success: true });
    return true;
  }

  // ── Clear badge ─────────────────────────────────────────────
  if (msg.action === 'clearBadge') {
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ success: true });
    return true;
  }

  // ── Open full tab ───────────────────────────────────────────
  if (msg.action === 'openFullTab') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    sendResponse({ success: true });
    return true;
  }
});

// ── Tab update: reset badge when navigating away ─────────────
chrome.tabs.onActivated.addListener(() => {
  // Keep badge as is — it shows last extraction count
});
