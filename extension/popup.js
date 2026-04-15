// ============================================================
// popup.js — All Links Extractor PRO v3.0.0
// Chrome Extension — Full App Logic (chrome.storage API)
// ============================================================
'use strict';

// ── State ─────────────────────────────────────────────────────
const state = {
  currentLinks:    [],
  historyData:     [],
  favorites:       [],
  notes:           {},
  settings:        {
    theme: 'dark', autoTheme: false, autoSave: true,
    maxSessions: 20, defaultFormat: 'JSON',
    includeAnchors: true, includeImages: true,
    includeVideos: true, includePdfs: true,
    removeDuplicates: true, filterJs: true, normalize: true
  },
  cumulativeStats: { totalLinks: 0, sessions: 0 },
  urlHistory:      [],
  quickSaved:      [],
  activeSection:   'dashboard',
  selectedLinks:   new Set(),
  filterType:      'all',
  searchQuery:     '',
  noteTarget:      null,
  extracting:      false,
  currentTab:      null,
  charts:          {},
  importPreview:   null
};

// ── Storage helpers ───────────────────────────────────────────
const Store = {
  get: (keys) => new Promise(r => chrome.storage.local.get(keys, r)),
  set: (obj)  => new Promise(r => chrome.storage.local.set(obj, r)),
  remove: (keys) => new Promise(r => chrome.storage.local.remove(keys, r))
};

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'info', dur = 3000) {
  const wrap = document.getElementById('toastWrap');
  const el   = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, dur);
}

// ── Navigation ────────────────────────────────────────────────
function navigate(section) {
  state.activeSection = section;
  document.querySelectorAll('.sidebar-link').forEach(b => {
    b.classList.toggle('active', b.dataset.section === section);
  });
  document.querySelectorAll('.section').forEach(s => {
    s.classList.toggle('active', s.id === `sec-${section}`);
  });
  if (section === 'analytics') renderCharts();
  if (section === 'history')   renderHistory();
  if (section === 'favorites') renderFavorites();
  if (section === 'import')    resetImport();
}

document.querySelectorAll('.sidebar-link').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.section));
});

// ── Load all data from chrome.storage ────────────────────────
async function loadAllData() {
  const data = await Store.get([
    'currentLinks','historyData','favorites','notes',
    'settings','cumulativeStats','urlHistory','quickSaved'
  ]);
  if (data.currentLinks)    state.currentLinks    = data.currentLinks;
  if (data.historyData)     state.historyData     = data.historyData;
  if (data.favorites)       state.favorites       = data.favorites;
  if (data.notes)           state.notes           = data.notes;
  if (data.settings)        state.settings        = { ...state.settings, ...data.settings };
  if (data.cumulativeStats) state.cumulativeStats = data.cumulativeStats;
  if (data.urlHistory)      state.urlHistory      = data.urlHistory;
  if (data.quickSaved)      state.quickSaved      = data.quickSaved;
}

// ── Save helpers ──────────────────────────────────────────────
function saveLinks()     { Store.set({ currentLinks:    state.currentLinks });    }
function saveHistory()   { Store.set({ historyData:     state.historyData });     }
function saveFavorites() { Store.set({ favorites:       state.favorites });       }
function saveNotes()     { Store.set({ notes:           state.notes });           }
function saveSettings()  { Store.set({ settings:        state.settings });        }
function saveStats()     { Store.set({ cumulativeStats: state.cumulativeStats }); }
function saveUrlHistory(){ Store.set({ urlHistory:      state.urlHistory });      }

// ── Theme ─────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.settings.theme = theme;
  const darkBtn  = document.getElementById('darkModeToggle');
  const lightBtn = document.getElementById('lightModeToggle');
  if (darkBtn)  darkBtn.classList.toggle('active',  theme === 'dark');
  if (lightBtn) lightBtn.classList.toggle('active', theme === 'light');
}

function toggleDarkMode()  { applyTheme('dark');  saveSettings(); }
function toggleLightMode() { applyTheme('light'); saveSettings(); }

// ── Get active tab ────────────────────────────────────────────
async function getActiveTab() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'getActiveTab' }, r => resolve(r?.tab || null));
  });
}

// ── Extraction ────────────────────────────────────────────────
async function extractLinks() {
  if (state.extracting) return;
  state.extracting = true;

  const btn = document.getElementById('btnDashExtract');
  const btn2 = document.getElementById('btnExtract');
  const spinner = document.getElementById('extractSpinner');
  const progressWrap = document.getElementById('progressWrap');

  if (btn)     { btn.disabled = true;  btn.textContent = 'Extracting…'; }
  if (btn2)    { btn2.disabled = true; btn2.textContent = 'Extracting…'; }
  if (spinner) spinner.style.display = 'flex';
  if (progressWrap) progressWrap.style.display = 'block';

  animateProgress(0, 70, 800);

  try {
    const tab = await getActiveTab();
    if (!tab) throw new Error('No active tab found');

    state.currentTab = tab;

    const options = {
      includeAnchors:   state.settings.includeAnchors,
      includeImages:    state.settings.includeImages,
      includeVideos:    state.settings.includeVideos,
      includePdfs:      state.settings.includePdfs,
      removeDuplicates: state.settings.removeDuplicates,
      filterJs:         state.settings.filterJs,
      normalize:        state.settings.normalize
    };

    const resp = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'injectAndExtract', tabId: tab.id, options },
        r => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        }
      );
    });

    animateProgress(70, 100, 400);

    if (!resp?.success) throw new Error(resp?.error || 'Extraction failed');

    state.currentLinks = resp.links || [];
    state.selectedLinks.clear();
    state.filterType  = 'all';
    state.searchQuery = '';

    // Save to URL history
    if (tab.url && !state.urlHistory.includes(tab.url)) {
      state.urlHistory.unshift(tab.url);
      if (state.urlHistory.length > 20) state.urlHistory.pop();
      saveUrlHistory();
    }

    // Auto-save session
    if (state.settings.autoSave) {
      const session = buildSession(resp.links, tab.url, tab.title || tab.url);
      await addSession(session);
    } else {
      saveLinks();
    }

    setTimeout(() => {
      updateDashboard();
      renderResults();
      navigate('results');
      toast(`Extracted ${state.currentLinks.length} links!`, 'success');
      updateBadge(state.currentLinks.length);
    }, 450);

  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
    console.error('[Links Extractor PRO] Extraction error:', err);
  } finally {
    state.extracting = false;
    if (btn)     { btn.disabled = false;  btn.textContent = 'Extract Now'; }
    if (btn2)    { btn2.disabled = false; btn2.textContent = 'Extract Links'; }
    if (spinner) spinner.style.display = 'none';
    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = 'none';
      const bar = document.getElementById('progressBar');
      if (bar) bar.style.width = '0%';
    }, 600);
  }
}

function animateProgress(from, to, dur) {
  const bar = document.getElementById('progressBar');
  if (!bar) return;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / dur, 1);
    bar.style.width = (from + (to - from) * t) + '%';
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function updateBadge(count) {
  chrome.runtime.sendMessage({ action: 'updateBadge', count });
}

// ── Build session ─────────────────────────────────────────────
function buildSession(links, url, title) {
  return {
    id: 'sess_' + Date.now(),
    url:       url       || 'Unknown',
    title:     title     || url || 'Unknown',
    links:     links,
    timestamp: Date.now(),
    pinned:    false,
    name:      null
  };
}

// ── Add session to history ────────────────────────────────────
async function addSession(session) {
  state.historyData.unshift(session);
  const max = parseInt(state.settings.maxSessions) || 20;
  if (state.historyData.length > max) state.historyData.splice(max);

  state.cumulativeStats.totalLinks = (state.cumulativeStats.totalLinks || 0) + session.links.length;
  state.cumulativeStats.sessions   = (state.cumulativeStats.sessions   || 0) + 1;

  await Store.set({
    historyData:     state.historyData,
    currentLinks:    session.links,
    cumulativeStats: state.cumulativeStats
  });
  updateHistoryBadge();
  updateStats();
}

// ── Dashboard ─────────────────────────────────────────────────
function updateDashboard() {
  const links = state.currentLinks;
  const counts = countByType(links);

  animCounter('dashTotal',    links.length);
  animCounter('dashInternal', counts.internal || 0);
  animCounter('dashExternal', counts.external || 0);
  animCounter('dashImages',   counts.image    || 0);
  animCounter('dashVideos',   counts.video    || 0);
  animCounter('dashPdfs',     (counts.pdf || 0) + (counts.file || 0));
  animCounter('totalExtracted', state.cumulativeStats.totalLinks || 0);
  animCounter('totalSessions',  state.cumulativeStats.sessions   || 0);
  animCounter('totalFavorites', state.favorites.length);

  // Recent sessions
  renderRecentSessions();
  updateStorageDisplay();
}

function animCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const dur   = 600;
  const begin = performance.now();
  (function step(now) {
    const t = Math.min((now - begin) / dur, 1);
    el.textContent = Math.round(start + (target - start) * t);
    if (t < 1) requestAnimationFrame(step);
  })(performance.now());
}

function countByType(links) {
  return links.reduce((acc, l) => { acc[l.type] = (acc[l.type] || 0) + 1; return acc; }, {});
}

function renderRecentSessions() {
  const wrap = document.getElementById('recentSessionsWrap');
  if (!wrap) return;
  const recent = state.historyData.slice(0, 3);
  if (!recent.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:12px 0;"><p>No sessions yet. Click "Extract Now" to start.</p></div>';
    return;
  }
  wrap.innerHTML = recent.map(s => `
    <div class="link-item" style="padding:10px 14px;cursor:pointer;" onclick="reloadSession('${s.id}')">
      <div class="link-favicon" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">${getDomainInitial(s.url)}</div>
      <div class="link-details">
        <div class="link-text">${escHtml(s.name || s.title || s.url)}</div>
        <div class="link-url mono">${s.links.length} links • ${timeAgo(s.timestamp)}</div>
      </div>
      <div class="link-badge badge-${s.links.length > 100 ? 'external' : 'internal'}" style="font-size:10px;">${s.links.length}</div>
    </div>`).join('');
}

function updateStats() {
  animCounter('totalExtracted', state.cumulativeStats.totalLinks || 0);
  animCounter('totalSessions',  state.cumulativeStats.sessions   || 0);
  animCounter('totalFavorites', state.favorites.length);
}

// ── Results ───────────────────────────────────────────────────
function renderResults() {
  const links = getFilteredLinks();
  const wrap  = document.getElementById('resultsWrap');
  if (!wrap) return;

  // Update counts in filter tabs
  const all    = state.currentLinks;
  const counts = countByType(all);
  safeText('filterCount-all',      all.length);
  safeText('filterCount-internal', counts.internal || 0);
  safeText('filterCount-external', counts.external || 0);
  safeText('filterCount-image',    counts.image    || 0);
  safeText('filterCount-video',    counts.video    || 0);
  safeText('filterCount-pdf',      (counts.pdf || 0) + (counts.file || 0));

  if (!links.length) {
    wrap.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>${state.currentLinks.length ? 'No links match your filter' : 'No links extracted yet'}</p>
      </div>`;
    return;
  }

  wrap.innerHTML = links.map(link => buildLinkRow(link)).join('');
  updateSelectionUI();
}

function buildLinkRow(link) {
  const isFav   = state.favorites.includes(link.url);
  const note    = state.notes[link.url] || '';
  const selClass = state.selectedLinks.has(link.url) ? ' selected' : '';
  const domain  = link.domain || getDomain(link.url);
  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`;

  return `
  <div class="link-item${selClass}" data-url="${escAttr(link.url)}">
    <div class="link-checkbox" onclick="toggleSelect('${escAttr(link.url)}')">
      <div class="link-chk${state.selectedLinks.has(link.url) ? ' checked' : ''}"></div>
    </div>
    <img class="link-favicon" src="${favicon}" alt="" onerror="this.style.display='none'">
    <div class="link-details">
      <div class="link-text">${escHtml(link.text || link.url)}</div>
      <div class="link-url mono">${escHtml(link.url)}</div>
      ${note ? `<div class="link-note-preview">${escHtml(note)}</div>` : ''}
    </div>
    <div class="link-badge badge-${escAttr(link.type)}">${link.type}</div>
    <div class="link-actions">
      <button class="btn-icon" title="Copy URL" onclick="copyUrl('${escAttr(link.url)}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="btn-icon" title="Open URL" onclick="openUrl('${escAttr(link.url)}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
      <button class="btn-icon ${isFav ? 'active' : ''}" title="${isFav ? 'Unfavorite' : 'Favorite'}" onclick="toggleFav('${escAttr(link.url)}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
      <button class="btn-icon" title="Add Note" onclick="openNote('${escAttr(link.url)}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
    </div>
  </div>`;
}

function getFilteredLinks() {
  let links = state.currentLinks;
  if (state.filterType !== 'all') {
    if (state.filterType === 'pdf') {
      links = links.filter(l => l.type === 'pdf' || l.type === 'file');
    } else {
      links = links.filter(l => l.type === state.filterType);
    }
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    links = links.filter(l =>
      l.url.toLowerCase().includes(q) ||
      (l.text || '').toLowerCase().includes(q) ||
      (state.notes[l.url] || '').toLowerCase().includes(q)
    );
  }
  return links;
}

// ── Selection ─────────────────────────────────────────────────
function toggleSelect(url) {
  if (state.selectedLinks.has(url)) state.selectedLinks.delete(url);
  else state.selectedLinks.add(url);
  // Update just the clicked row
  const row = document.querySelector(`.link-item[data-url="${CSS.escape(url)}"]`);
  if (row) {
    row.classList.toggle('selected', state.selectedLinks.has(url));
    const chk = row.querySelector('.link-chk');
    if (chk) chk.classList.toggle('checked', state.selectedLinks.has(url));
  }
  updateSelectionUI();
}

function selectAll() {
  getFilteredLinks().forEach(l => state.selectedLinks.add(l.url));
  renderResults();
}

function deselectAll() {
  state.selectedLinks.clear();
  renderResults();
}

function updateSelectionUI() {
  const count = state.selectedLinks.size;
  const bar = document.getElementById('selectionBar');
  const label = document.getElementById('selCountLabel');
  if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
  if (label) label.textContent = `${count} selected`;
}

// ── Actions ───────────────────────────────────────────────────
function copyUrl(url) {
  navigator.clipboard.writeText(url).then(() => toast('URL copied!', 'success', 1500));
}

function openUrl(url) {
  chrome.tabs.create({ url });
}

function copySelected() {
  const urls = [...state.selectedLinks].join('\n');
  navigator.clipboard.writeText(urls).then(() =>
    toast(`Copied ${state.selectedLinks.size} URLs`, 'success'));
}

function openSelected() {
  [...state.selectedLinks].slice(0, 10).forEach(url => chrome.tabs.create({ url, active: false }));
  if (state.selectedLinks.size > 10) toast('Max 10 tabs opened at once', 'warning');
}

function deleteSelected() {
  state.currentLinks = state.currentLinks.filter(l => !state.selectedLinks.has(l.url));
  state.selectedLinks.clear();
  saveLinks();
  renderResults();
  toast('Deleted selected links', 'info');
}

function favoriteSelected() {
  state.selectedLinks.forEach(url => {
    if (!state.favorites.includes(url)) state.favorites.push(url);
  });
  saveFavorites();
  updateFavBadge();
  renderResults();
  toast(`Starred ${state.selectedLinks.size} links`, 'success');
}

// ── Favorites ─────────────────────────────────────────────────
function toggleFav(url) {
  const idx = state.favorites.indexOf(url);
  if (idx === -1) {
    state.favorites.push(url);
    toast('Added to favorites', 'success', 1500);
  } else {
    state.favorites.splice(idx, 1);
    toast('Removed from favorites', 'info', 1500);
  }
  saveFavorites();
  updateFavBadge();
  // Refresh view
  if (state.activeSection === 'results')   renderResults();
  if (state.activeSection === 'favorites') renderFavorites();
}

function updateFavBadge() {
  const b = document.getElementById('favBadge');
  const c = state.favorites.length;
  if (b) { b.textContent = c; b.style.display = c > 0 ? 'inline-flex' : 'none'; }
  animCounter('totalFavorites', c);
}

function updateHistoryBadge() {
  const b = document.getElementById('histBadge');
  const c = state.historyData.length;
  if (b) { b.textContent = c; b.style.display = c > 0 ? 'inline-flex' : 'none'; }
}

function renderFavorites() {
  const wrap = document.getElementById('favoritesWrap');
  if (!wrap) return;
  const favLinks = state.favorites
    .map(url => state.currentLinks.find(l => l.url === url) || { url, type: 'external', domain: getDomain(url), text: url })
    .filter(Boolean);

  animCounter('favTotalCount', favLinks.length);

  if (!favLinks.length) {
    wrap.innerHTML = `<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><p>No favorites yet. Star links in Results.</p></div>`;
    return;
  }
  wrap.innerHTML = favLinks.map(link => {
    const note = state.notes[link.url] || '';
    return `
    <div class="link-item" data-url="${escAttr(link.url)}">
      <div class="link-details">
        <div class="link-text">${escHtml(link.text || link.url)}</div>
        <div class="link-url mono">${escHtml(link.url)}</div>
        ${note ? `<div class="link-note-preview">${escHtml(note)}</div>` : ''}
      </div>
      <div class="link-badge badge-${escAttr(link.type)}">${link.type}</div>
      <div class="link-actions">
        <button class="btn-icon" onclick="copyUrl('${escAttr(link.url)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <button class="btn-icon" onclick="openUrl('${escAttr(link.url)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
        <button class="btn-icon active" onclick="toggleFav('${escAttr(link.url)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>
        <button class="btn-icon" onclick="openNote('${escAttr(link.url)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

function exportFavorites() {
  const favLinks = state.favorites
    .map(url => state.currentLinks.find(l => l.url === url) || { url, type: 'external', text: url });
  downloadFile(JSON.stringify({ favorites: favLinks, exportedAt: new Date().toISOString() }, null, 2), 'favorites.json', 'application/json');
  toast('Favorites exported!', 'success');
}

// ── Notes ─────────────────────────────────────────────────────
function openNote(url) {
  state.noteTarget = url;
  const modal    = document.getElementById('noteModal');
  const urlEl    = document.getElementById('noteModalUrl');
  const textarea = document.getElementById('noteText');
  if (urlEl)    urlEl.textContent = url;
  if (textarea) textarea.value   = state.notes[url] || '';
  if (modal)    modal.classList.add('show');
  setTimeout(() => { if (textarea) textarea.focus(); }, 50);
}

function saveNote() {
  const textarea = document.getElementById('noteText');
  if (!textarea || !state.noteTarget) return;
  const text = textarea.value.trim();
  if (text) {
    state.notes[state.noteTarget] = text;
  } else {
    delete state.notes[state.noteTarget];
  }
  saveNotes();
  closeNoteModal();
  if (state.activeSection === 'results')   renderResults();
  if (state.activeSection === 'favorites') renderFavorites();
  toast('Note saved', 'success', 1500);
}

function closeNoteModal() {
  const modal = document.getElementById('noteModal');
  if (modal) modal.classList.remove('show');
  state.noteTarget = null;
}

// ── History ───────────────────────────────────────────────────
function renderHistory() {
  const wrap   = document.getElementById('historyWrap');
  const search = document.getElementById('historySearch');
  const query  = search ? search.value.toLowerCase() : '';
  if (!wrap) return;

  let sessions = state.historyData;
  if (query) {
    sessions = sessions.filter(s =>
      (s.url   || '').toLowerCase().includes(query) ||
      (s.title || '').toLowerCase().includes(query) ||
      (s.name  || '').toLowerCase().includes(query)
    );
  }

  if (!sessions.length) {
    wrap.innerHTML = `<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>${query ? 'No results found' : 'No history yet. Extract links to start.'}</p></div>`;
    return;
  }

  wrap.innerHTML = sessions.map(s => {
    const counts = countByType(s.links || []);
    const date   = new Date(s.timestamp);
    return `
    <div class="history-item card mb-6" style="padding:14px 16px;">
      <div class="row-between mb-8">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
          ${s.pinned ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color:#6366f1;flex-shrink:0;"><path d="M12 2L8 6H4l4 4-2 6 6-3 6 3-2-6 4-4h-4z"/></svg>' : ''}
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(s.name || s.title || s.url)}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn-icon" title="${s.pinned ? 'Unpin' : 'Pin'}" onclick="togglePin('${s.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${s.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2L8 6H4l4 4-2 6 6-3 6 3-2-6 4-4h-4z"/></svg>
          </button>
          <button class="btn-icon" title="Rename" onclick="renameSession('${s.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="btn-icon" title="Export session" onclick="exportSession('${s.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="btn-icon" title="Reload session" onclick="reloadSession('${s.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.44"/></svg>
          </button>
          <button class="btn-icon btn-icon-danger" title="Delete" onclick="deleteSession('${s.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="mono" style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px;">${escHtml(s.url)}</div>
      <div class="row gap-6" style="flex-wrap:wrap;">
        <span class="link-badge badge-internal">${s.links?.length || 0} total</span>
        ${counts.internal  ? `<span class="link-badge badge-internal">${counts.internal} internal</span>` : ''}
        ${counts.external  ? `<span class="link-badge badge-external">${counts.external} external</span>` : ''}
        ${counts.image     ? `<span class="link-badge badge-image">${counts.image} img</span>` : ''}
        ${counts.video     ? `<span class="link-badge badge-video">${counts.video} vid</span>` : ''}
        ${(counts.pdf || counts.file) ? `<span class="link-badge badge-pdf">${(counts.pdf||0)+(counts.file||0)} file</span>` : ''}
        <span style="margin-left:auto;font-size:10px;color:var(--text-muted);">${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      </div>
    </div>`;
  }).join('');
}

function reloadSession(id) {
  const s = state.historyData.find(x => x.id === id);
  if (!s) return;
  state.currentLinks = s.links || [];
  state.selectedLinks.clear();
  state.filterType  = 'all';
  state.searchQuery = '';
  saveLinks();
  updateDashboard();
  renderResults();
  navigate('results');
  toast(`Loaded "${s.name || s.title || s.url}" (${s.links.length} links)`, 'success');
}

function deleteSession(id) {
  state.historyData = state.historyData.filter(s => s.id !== id);
  saveHistory();
  updateHistoryBadge();
  renderHistory();
  renderRecentSessions();
  toast('Session deleted', 'info', 1500);
}

function clearAllHistory() {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  state.historyData = [];
  saveHistory();
  updateHistoryBadge();
  renderHistory();
  renderRecentSessions();
  toast('History cleared', 'info');
}

function togglePin(id) {
  const s = state.historyData.find(x => x.id === id);
  if (!s) return;
  s.pinned = !s.pinned;
  // Sort: pinned first
  state.historyData.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  saveHistory();
  renderHistory();
}

function renameSession(id) {
  const s = state.historyData.find(x => x.id === id);
  if (!s) return;
  const name = prompt('Enter session name:', s.name || s.title || '');
  if (name === null) return;
  s.name = name.trim() || null;
  saveHistory();
  renderHistory();
  renderRecentSessions();
}

function exportSession(id) {
  const s = state.historyData.find(x => x.id === id);
  if (!s) return;
  downloadFile(JSON.stringify(s, null, 2), `session_${id}.json`, 'application/json');
  toast('Session exported!', 'success');
}

function exportAllSessions() {
  const data = {
    exportedAt: new Date().toISOString(),
    version: '3.0.0',
    sessions: state.historyData,
    favorites: state.favorites,
    notes: state.notes,
    cumulativeStats: state.cumulativeStats
  };
  downloadFile(JSON.stringify(data, null, 2), 'links-extractor-backup.json', 'application/json');
  toast('Backup exported!', 'success');
}

// ── Analytics / Charts ────────────────────────────────────────
function renderCharts() {
  const links  = state.currentLinks;
  const counts = countByType(links);

  // Type distribution doughnut
  const typeCtx = document.getElementById('typeChart');
  if (typeCtx) {
    if (state.charts.type) state.charts.type.destroy();
    const labels = Object.keys(counts);
    const colors = { internal:'#6366f1', external:'#3b82f6', image:'#10b981', video:'#f59e0b', pdf:'#ef4444', file:'#8b5cf6' };
    state.charts.type = new Chart(typeCtx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: Object.values(counts),
          backgroundColor: labels.map(l => colors[l] || '#6b7280'),
          borderWidth: 2,
          borderColor: 'rgba(0,0,0,0.2)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#8888a0', font: { size: 11 }, padding: 12 } }
        }
      }
    });
  }

  // Domain bar chart (top 8)
  const domainCtx = document.getElementById('domainChart');
  if (domainCtx) {
    if (state.charts.domain) state.charts.domain.destroy();
    const domainCounts = {};
    links.forEach(l => { const d = l.domain || getDomain(l.url); domainCounts[d] = (domainCounts[d] || 0) + 1; });
    const sorted = Object.entries(domainCounts).sort((a,b) => b[1] - a[1]).slice(0, 8);
    state.charts.domain = new Chart(domainCtx, {
      type: 'bar',
      data: {
        labels: sorted.map(([d]) => d),
        datasets: [{
          label: 'Links',
          data: sorted.map(([,c]) => c),
          backgroundColor: '#6366f1',
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8888a0', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#8888a0', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }

  // Update analytics numbers
  const uniqueDomains = new Set(links.map(l => l.domain || getDomain(l.url))).size;
  safeText('anaTotal',    links.length);
  safeText('anaUnique',   uniqueDomains);
  safeText('anaInternal', counts.internal || 0);
  safeText('anaExternal', counts.external || 0);

  renderDomainBreakdown();
}

// ── Export ────────────────────────────────────────────────────
function exportLinks(format) {
  const links = state.selectedLinks.size > 0
    ? state.currentLinks.filter(l => state.selectedLinks.has(l.url))
    : state.currentLinks;

  if (!links.length) { toast('No links to export', 'warning'); return; }

  let content, mime, ext;
  const ts = new Date().toISOString().slice(0,10);

  switch ((format || state.settings.defaultFormat || 'JSON').toUpperCase()) {
    case 'TXT':
      content = links.map(l => l.url).join('\n');
      mime = 'text/plain'; ext = 'txt';
      break;
    case 'CSV':
      content = 'URL,Type,Domain,Text\n' +
        links.map(l => `"${l.url.replace(/"/g,'""')}","${l.type}","${l.domain || ''}","${(l.text||'').replace(/"/g,'""')}"`).join('\n');
      mime = 'text/csv'; ext = 'csv';
      break;
    case 'HTML':
      content = `<!DOCTYPE html><html><head><title>Links Export ${ts}</title></head><body><h1>Links Extractor PRO Export</h1><ul>` +
        links.map(l => `<li><a href="${escHtml(l.url)}">${escHtml(l.text || l.url)}</a> <small>[${l.type}]</small></li>`).join('') +
        '</ul></body></html>';
      mime = 'text/html'; ext = 'html';
      break;
    default: // JSON
      content = JSON.stringify({ exportedAt: new Date().toISOString(), count: links.length, links }, null, 2);
      mime = 'application/json'; ext = 'json';
  }

  downloadFile(content, `links-export-${ts}.${ext}`, mime);
  toast(`Exported ${links.length} links as ${ext.toUpperCase()}`, 'success');
}

// ── Import ────────────────────────────────────────────────────
function resetImport() {
  state.importPreview = null;
  const pw = document.getElementById('importPreviewWrap');
  const da = document.getElementById('dropArea');
  if (pw) pw.style.display = 'none';
  if (da) da.style.display = 'flex';
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => parseImport(e.target.result, file.name);
  reader.readAsText(file);
}

function parseImport(text, filename) {
  try {
    const ext = (filename || '').split('.').pop().toLowerCase();
    let links = [], sessions = [], favorites = [], notes = {};

    if (ext === 'json') {
      const data = JSON.parse(text);
      // Full backup
      if (data.sessions) {
        sessions  = data.sessions;
        favorites = data.favorites || [];
        notes     = data.notes     || {};
        links     = sessions.flatMap(s => s.links || []);
      } else if (data.links) {
        links = data.links;
      } else if (data.favorites) {
        favorites = data.favorites.map(f => typeof f === 'string' ? f : f.url);
        links     = data.favorites.filter(f => typeof f === 'object');
      } else if (Array.isArray(data)) {
        links = data;
      }
    } else if (ext === 'csv') {
      const rows = text.split('\n').slice(1);
      links = rows.map(r => {
        const cols = r.split(',');
        return { url: (cols[0] || '').replace(/^"|"$/g,'').trim(), type: (cols[1] || 'external').replace(/^"|"$/g,''), domain: (cols[2] || '').replace(/^"|"$/g,''), text: (cols[3] || '').replace(/^"|"$/g,'') };
      }).filter(l => l.url);
    } else { // TXT
      links = text.split('\n').map(u => u.trim()).filter(u => u.startsWith('http')).map(url => ({ url, type: 'external', domain: getDomain(url), text: url }));
    }

    state.importPreview = { links, sessions, favorites, notes };

    const pw = document.getElementById('importPreviewWrap');
    const da = document.getElementById('dropArea');
    const pl = document.getElementById('importPreviewList');
    const pc = document.getElementById('importPreviewCount');

    if (pc) pc.textContent = `${links.length} links${sessions.length ? `, ${sessions.length} sessions` : ''}`;
    if (pl) pl.innerHTML = links.slice(0, 5).map(l => `<div class="mono" style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(l.url)}</div>`).join('') + (links.length > 5 ? `<div style="font-size:10px;color:var(--text-muted);">… and ${links.length - 5} more</div>` : '');
    if (pw) pw.style.display = 'block';
    if (da) da.style.display = 'none';

  } catch(err) {
    toast('Failed to parse import file: ' + err.message, 'error');
  }
}

function confirmImport() {
  if (!state.importPreview) return;
  const { links, sessions, favorites, notes } = state.importPreview;

  if (sessions.length > 0) {
    state.historyData = [...sessions, ...state.historyData];
    const max = parseInt(state.settings.maxSessions) || 20;
    if (state.historyData.length > max) state.historyData.splice(max);
    saveHistory();
  }
  if (links.length > 0) {
    state.currentLinks = links;
    saveLinks();
  }
  if (favorites.length > 0) {
    favorites.forEach(f => { const url = typeof f === 'string' ? f : f.url; if (url && !state.favorites.includes(url)) state.favorites.push(url); });
    saveFavorites();
    updateFavBadge();
  }
  if (Object.keys(notes).length > 0) {
    state.notes = { ...state.notes, ...notes };
    saveNotes();
  }

  updateDashboard();
  updateHistoryBadge();
  renderResults();
  resetImport();
  navigate('results');
  toast(`Imported ${links.length} links!`, 'success');
}

// ── Settings ──────────────────────────────────────────────────
function initSettings() {
  const s = state.settings;

  // Theme buttons
  const darkBtn  = document.getElementById('darkModeToggle');
  const lightBtn = document.getElementById('lightModeToggle');
  if (darkBtn)  darkBtn.addEventListener('click', toggleDarkMode);
  if (lightBtn) lightBtn.addEventListener('click', toggleLightMode);

  // Toggles
  bindToggle('autoSaveToggle',  'autoSave');
  bindToggle('dedupToggle',     'removeDuplicates');
  bindToggle('filterJsToggle',  'filterJs');
  bindToggle('normalizeToggle', 'normalize');

  // Selects
  bindSelect('maxSessionsSel',    'maxSessions');
  bindSelect('defaultFormatSel',  'defaultFormat');

  // Buttons
  bindBtn('exportBackupBtn', exportAllSessions);
  bindBtn('goImportBtn',     () => navigate('import'));
  bindBtn('clearAllDataBtn', clearAllData);
}

function bindToggle(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('on', !!state.settings[key]);
  el.addEventListener('click', () => {
    state.settings[key] = !state.settings[key];
    el.classList.toggle('on', state.settings[key]);
    saveSettings();
  });
}

function bindSelect(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = state.settings[key];
  el.addEventListener('change', () => {
    state.settings[key] = el.value;
    saveSettings();
  });
}

function bindBtn(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

function clearAllData() {
  if (!confirm('Clear ALL data (history, favorites, notes, links)? This cannot be undone.')) return;
  state.currentLinks    = [];
  state.historyData     = [];
  state.favorites       = [];
  state.notes           = {};
  state.cumulativeStats = { totalLinks: 0, sessions: 0 };
  state.urlHistory      = [];
  chrome.storage.local.clear(() => {
    saveSettings(); // re-save settings only
    updateDashboard();
    updateFavBadge();
    updateHistoryBadge();
    updateStorageDisplay();
    toast('All data cleared', 'info');
  });
}

// ── Storage display ───────────────────────────────────────────
async function updateStorageDisplay() {
  chrome.storage.local.getBytesInUse(null, (bytes) => {
    const kb  = (bytes / 1024).toFixed(1);
    const mb  = (bytes / 1024 / 1024).toFixed(2);
    const pct = Math.min((bytes / (5 * 1024 * 1024)) * 100, 100).toFixed(1);
    const label = bytes > 1024 * 100 ? `${mb} MB` : `${kb} KB`;

    safeText('storageUsedLabel', label);
    safeText('sessCountLabel',   state.historyData.length);
    safeText('favCountLabel',    state.favorites.length);
    safeText('totalExtLabel',    state.cumulativeStats.totalLinks || 0);
    safeText('storageSideLabel', label + ' used');

    const bar = document.getElementById('storageSideBar');
    if (bar) bar.style.width = pct + '%';
  });
}

// ── Filter tabs ───────────────────────────────────────────────
function initFilterTabs() {
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.filterType  = tab.dataset.type || 'all';
      state.searchQuery = '';
      const si = document.getElementById('resultsSearch');
      if (si) si.value = '';
      renderResults();
    });
  });
}

// ── Search ────────────────────────────────────────────────────
function initSearch() {
  const si = document.getElementById('resultsSearch');
  if (si) {
    si.addEventListener('input', () => {
      state.searchQuery = si.value;
      renderResults();
    });
  }
  const hi = document.getElementById('historySearch');
  if (hi) hi.addEventListener('input', renderHistory);
}

// ── Quick extract (Extractor tab) ─────────────────────────────
function initExtractorTab() {
  const urlInput = document.getElementById('urlInput');
  // Populate with current tab URL
  getActiveTab().then(tab => {
    if (tab && urlInput && !urlInput.value) {
      urlInput.value = tab.url || '';
    }
  });

  // URL history chips
  const chipsWrap = document.getElementById('urlHistoryChips');
  if (chipsWrap && state.urlHistory.length) {
    chipsWrap.innerHTML = state.urlHistory.slice(0, 6).map(u =>
      `<button class="chip" onclick="useUrlChip('${escAttr(u)}')">${getDomain(u)}</button>`
    ).join('');
  }
}

function useUrlChip(url) {
  const urlInput = document.getElementById('urlInput');
  if (urlInput) urlInput.value = url;
}

// ── Global expose for inline onclick ─────────────────────────
Object.assign(window, {
  extractLinks, reloadSession, deleteSession, clearAllHistory,
  togglePin, renameSession, exportSession, exportAllSessions,
  copyUrl, openUrl, copySelected, openSelected, deleteSelected, favoriteSelected,
  toggleFav, toggleSelect, selectAll, deselectAll,
  openNote, saveNote, closeNoteModal,
  exportLinks, exportFavorites,
  confirmImport, resetImport,
  useUrlChip
});

// ── Drag & Drop for import ─────────────────────────────────────
function initImportDrop() {
  const dropArea = document.getElementById('dropArea');
  const fileInput = document.getElementById('importFileInput');

  if (dropArea) {
    dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('drag-over'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
    dropArea.addEventListener('drop', e => {
      e.preventDefault();
      dropArea.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleImportFile(file);
    });
    dropArea.addEventListener('click', () => fileInput && fileInput.click());
  }

  if (fileInput) {
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) handleImportFile(file);
    });
  }

  // Paste URLs
  const pasteArea = document.getElementById('pasteArea');
  const pasteBtn  = document.getElementById('parsePasteBtn');
  if (pasteBtn && pasteArea) {
    pasteBtn.addEventListener('click', () => {
      const text = pasteArea.value.trim();
      if (text) parseImport(text, 'paste.txt');
    });
  }

  // Confirm / Cancel import
  const confirmBtn = document.getElementById('confirmImportBtn');
  const cancelBtn  = document.getElementById('cancelImportBtn');
  if (confirmBtn) confirmBtn.addEventListener('click', confirmImport);
  if (cancelBtn)  cancelBtn.addEventListener('click', resetImport);
}

// ── Export modal ──────────────────────────────────────────────
function initExportModal() {
  const openBtn  = document.getElementById('openExportModal');
  const modal    = document.getElementById('exportModal');
  const closeBtn = document.getElementById('closeExportModal');
  const fmtBtns  = document.querySelectorAll('[data-export-fmt]');
  const selOnlyChk = document.getElementById('exportSelectedOnly');

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => modal.classList.add('show'));
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.remove('show'));
  }
  if (modal) {
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
  }
  fmtBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modal && modal.classList.remove('show');
      exportLinks(btn.dataset.exportFmt);
    });
  });
}

// ── Download helper ───────────────────────────────────────────
function downloadFile(content, filename, mime) {
  const a   = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Utility ───────────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escAttr(s) {
  return String(s || '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function safeText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text);
}
function getDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}
function getDomainInitial(url) {
  return getDomain(url).charAt(0).toUpperCase() || '?';
}
function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)   return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000)return Math.floor(diff/3600000) + 'h ago';
  return Math.floor(diff/86400000) + 'd ago';
}

// ── Dropdowns ─────────────────────────────────────────────────
function toggleDropdown(id) {
  const dd = document.getElementById(id);
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  closeDropdowns();
  if (!isOpen) dd.classList.add('open');
}
function closeDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
}
window.toggleDropdown = toggleDropdown;
window.closeDropdowns = closeDropdowns;
document.addEventListener('click', e => {
  if (!e.target.closest('[id$="DropWrap"]') && !e.target.closest('.dropdown')) closeDropdowns();
});

// ── Option checkboxes ─────────────────────────────────────────
function toggleOpt(label, key) {
  const chk = label.querySelector('.checkbox');
  if (!chk) return;
  state.settings[key] = !state.settings[key];
  chk.classList.toggle('checked', state.settings[key]);
  saveSettings();
}
window.toggleOpt = toggleOpt;

// ── Copy all URLs ─────────────────────────────────────────────
function copyAllUrls() {
  const urls = state.currentLinks.map(l => l.url).join('\n');
  navigator.clipboard.writeText(urls).then(() =>
    toast(`Copied ${state.currentLinks.length} URLs`, 'success'));
}
window.copyAllUrls = copyAllUrls;

// ── Analytics domain breakdown ────────────────────────────────
function renderDomainBreakdown() {
  const wrap = document.getElementById('domainBreakdownList');
  if (!wrap) return;
  const counts = {};
  state.currentLinks.forEach(l => {
    const d = l.domain || getDomain(l.url);
    counts[d] = (counts[d] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 20);
  const max = sorted[0]?.[1] || 1;
  wrap.innerHTML = sorted.map(([d, c]) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
      <div class="mono" style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(d)}</div>
      <div style="width:80px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
        <div style="width:${(c/max*100).toFixed(0)}%;height:100%;background:var(--accent);border-radius:2px;"></div>
      </div>
      <div class="mono" style="font-size:11px;width:24px;text-align:right;">${c}</div>
    </div>`).join('');
}

// ── Wire up misc buttons ──────────────────────────────────────
function initMiscButtons() {
  bindBtn('btnDashExtract',   extractLinks);
  bindBtn('btnExtract',       extractLinks);
  bindBtn('btnGoHistory',     () => navigate('history'));
  bindBtn('viewAllBtn',       () => navigate('history'));
  bindBtn('clearHistBtn',     clearAllHistory);
  bindBtn('expAllHistBtn',    exportAllSessions);
  bindBtn('exportFavBtn',     exportFavorites);
  bindBtn('clearFavsBtn',     clearAllFavorites);

  // Note modal
  bindBtn('saveNoteBtn',    saveNote);
  bindBtn('cancelNoteBtn',  closeNoteModal);
  bindBtn('closeNoteModal', closeNoteModal);

  const noteModal = document.getElementById('noteModal');
  if (noteModal) noteModal.addEventListener('click', e => { if (e.target === noteModal) closeNoteModal(); });
}

function clearAllFavorites() {
  if (!confirm('Clear all favorites?')) return;
  state.favorites = [];
  saveFavorites();
  updateFavBadge();
  renderFavorites();
  toast('Favorites cleared', 'info');
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  console.log('[Links Extractor PRO] v3.0.0 initializing…');

  await loadAllData();

  // Apply saved theme
  applyTheme(state.settings.theme || 'dark');

  // Wire up everything
  initSettings();
  initFilterTabs();
  initSearch();
  initImportDrop();
  initExportModal();
  initMiscButtons();
  initExtractorTab();

  // Render initial UI
  updateDashboard();
  renderResults();
  updateFavBadge();
  updateHistoryBadge();
  updateStorageDisplay();

  console.log('[Links Extractor PRO] Ready. History:', state.historyData.length, 'sessions, Current links:', state.currentLinks.length);
}

document.addEventListener('DOMContentLoaded', init);
