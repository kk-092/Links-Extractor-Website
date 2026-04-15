// ============================================================
// content.js — Injected into every page (all_frames: true)
// Handles real link extraction from live DOM
// ============================================================

(function () {
  'use strict';

  // Listen for extraction requests from popup / background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'extractLinks') {
      try {
        const links = extractAllLinks(msg.options || {});
        sendResponse({ success: true, links, url: location.href, title: document.title });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true; // keep channel open for async
    }

    if (msg.action === 'ping') {
      sendResponse({ alive: true });
      return true;
    }
  });

  // ============================================================
  // Core extraction logic
  // ============================================================
  function extractAllLinks(opts) {
    const {
      includeAnchors  = true,
      includeImages   = true,
      includeVideos   = true,
      includePdfs     = true,
      removeDuplicates = true,
      normalize       = true,
      filterJs        = true
    } = opts;

    const base = document.baseURI || location.href;
    const pageHost = location.hostname;
    const seen = new Set();
    const links = [];

    function add(rawUrl, type, textHint) {
      if (!rawUrl || typeof rawUrl !== 'string') return;
      rawUrl = rawUrl.trim();
      if (!rawUrl || rawUrl === '#' || rawUrl === 'javascript:void(0)') return;

      // Filter non-http schemes
      if (filterJs) {
        if (rawUrl.startsWith('javascript:') || rawUrl.startsWith('mailto:') ||
            rawUrl.startsWith('tel:') || rawUrl.startsWith('data:')) return;
      }

      // Normalize relative → absolute
      let url = rawUrl;
      if (normalize) {
        try { url = new URL(rawUrl, base).href; } catch(e) { return; }
      }

      if (removeDuplicates && seen.has(url)) return;
      seen.add(url);

      let domain = '';
      try { domain = new URL(url).hostname; } catch(e) { domain = pageHost; }

      // Classify
      let category = type;
      if (type === 'anchor') {
        category = domain === pageHost ? 'internal' : 'external';
        // Override for file types
        const lower = url.toLowerCase();
        if (/\.(pdf)(\?|$)/i.test(lower)) category = 'pdf';
        else if (/\.(zip|rar|7z|tar|gz|exe|dmg|pkg|deb|apk)(\?|$)/i.test(lower)) category = 'file';
        else if (/\.(mp4|webm|ogg|avi|mov|mkv)(\?|$)/i.test(lower)) category = 'video';
      }

      links.push({ url, type: category, domain, text: textHint || '' });
    }

    // 1. Anchor tags
    if (includeAnchors) {
      document.querySelectorAll('a[href]').forEach(el => {
        const text = (el.textContent || el.title || el.getAttribute('aria-label') || '').trim().substring(0, 80);
        add(el.getAttribute('href'), 'anchor', text || 'Link');
      });
    }

    // 2. Images
    if (includeImages) {
      document.querySelectorAll('img[src]').forEach(el => {
        const alt = (el.alt || el.title || 'Image').trim().substring(0, 60);
        add(el.getAttribute('src'), 'image', alt);
      });
      // Srcset
      document.querySelectorAll('img[srcset], source[srcset]').forEach(el => {
        const srcset = el.getAttribute('srcset') || '';
        srcset.split(',').forEach(part => {
          const src = part.trim().split(/\s+/)[0];
          if (src) add(src, 'image', 'Srcset image');
        });
      });
      // Background images inline
      document.querySelectorAll('[style*="url("]').forEach(el => {
        const match = el.style.backgroundImage.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        if (match) add(match[1], 'image', 'Background image');
      });
      // data-src (lazy load)
      document.querySelectorAll('[data-src],[data-lazy],[data-original]').forEach(el => {
        const src = el.getAttribute('data-src') || el.getAttribute('data-lazy') || el.getAttribute('data-original');
        if (src) add(src, 'image', 'Lazy image');
      });
    }

    // 3. Videos
    if (includeVideos) {
      document.querySelectorAll('video[src]').forEach(el => {
        add(el.getAttribute('src'), 'video', el.title || 'Video');
      });
      document.querySelectorAll('source[src]').forEach(el => {
        add(el.getAttribute('src'), 'video', 'Video source');
      });
      // YouTube / Vimeo embeds
      document.querySelectorAll('iframe[src*="youtube"],iframe[src*="vimeo"],iframe[src*="youtu.be"]').forEach(el => {
        add(el.getAttribute('src'), 'video', 'Embedded video');
      });
    }

    // 4. PDFs / Files / Iframes
    if (includePdfs) {
      document.querySelectorAll('iframe[src]:not([src*="youtube"]):not([src*="vimeo"])').forEach(el => {
        add(el.getAttribute('src'), 'file', 'Iframe');
      });
      document.querySelectorAll('embed[src]').forEach(el => {
        add(el.getAttribute('src'), 'pdf', 'Embedded file');
      });
      document.querySelectorAll('object[data]').forEach(el => {
        add(el.getAttribute('data'), 'pdf', 'Object');
      });
      // link[href] stylesheet / preload
      document.querySelectorAll('link[href]').forEach(el => {
        const rel = el.getAttribute('rel') || '';
        const href = el.getAttribute('href') || '';
        if (/stylesheet|preload|prefetch|dns-prefetch/.test(rel)) {
          add(href, 'file', `Resource (${rel})`);
        }
      });
      // Script tags
      document.querySelectorAll('script[src]').forEach(el => {
        add(el.getAttribute('src'), 'file', 'Script');
      });
    }

    return links;
  }

})();
