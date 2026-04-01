// content.js — Block Baiters
// LinkedIn feed posts: each post has an <h2> containing a span "Feed post" (a11y text).
// That H2's parentElement is the post card.

const LOG  = (...a) => console.log('[BlockBaiters]', ...a);
const WARN = (...a) => console.warn('[BlockBaiters]', ...a);

LOG('🎣 loaded on', location.href);

// ── State ─────────────────────────────────────────────────────────────────────
let enabled     = true;
let sensitivity = 'moderate';
let count       = 0;
const seen        = new WeakSet();
const blockedPosts = []; // { el, wrapper, author, preview }

// ── Settings ──────────────────────────────────────────────────────────────────
chrome.storage.sync.get(['enabled','sensitivity','filteredCount'], d => {
  enabled     = d.enabled !== false;
  sensitivity = d.sensitivity || 'moderate';
  count       = d.filteredCount || 0;
  LOG('⚙️ settings:', {enabled, sensitivity, count});
  injectPanel();
  scanAll();
  startObserver();
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.enabled)     { enabled = changes.enabled.newValue; if (!enabled) revealAll(); }
  if (changes.sensitivity) { sensitivity = changes.sensitivity.newValue; }
  if (changes.filteredCount?.newValue === 0) { count = 0; blockedPosts.length = 0; updatePanel(); }
});

// ── Extract author + preview from post text ───────────────────────────────────
function extractMeta(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const header = (lines[0] || '').replace(/^Feed post\s+/i, '');
  const author  = header.split(/\s*[•·]\s*/)[0].trim().slice(0, 40) || 'Unknown';
  const preview = lines.slice(1).find(l => l.length > 15) || '';
  return { author, preview: preview.slice(0, 60) };
}

// ── Side panel ────────────────────────────────────────────────────────────────
function injectPanel() {
  if (document.getElementById('bb-container')) return;

  const container = document.createElement('div');
  container.id = 'bb-container';
  container.innerHTML = `
    <div id="bb-panel">
      <div class="bb-panel__header">
        <span>🎣 Block Baiters</span>
        <button id="bb-close" title="Close">✕</button>
      </div>
      <div class="bb-panel__stats" id="bb-stats">No posts blocked yet</div>
      <div class="bb-panel__list" id="bb-list"></div>
      <div class="bb-panel__footer">
        <button id="bb-reset">Reset stats</button>
      </div>
    </div>
    <div id="bb-tab" title="Block Baiters">
      <span class="bb-tab-icon">🎣</span>
      <span class="bb-tab-count" id="bb-count">0</span>
    </div>
  `;
  document.body.appendChild(container);

  document.getElementById('bb-tab').addEventListener('click', () => {
    container.classList.toggle('open');
  });
  document.getElementById('bb-close').addEventListener('click', () => {
    container.classList.remove('open');
  });
  document.getElementById('bb-reset').addEventListener('click', () => {
    count = 0;
    blockedPosts.length = 0;
    chrome.storage.sync.set({ filteredCount: 0 });
    updatePanel();
  });
}

function updatePanel() {
  const countEl = document.getElementById('bb-count');
  const statsEl = document.getElementById('bb-stats');
  const listEl  = document.getElementById('bb-list');
  const tabEl   = document.getElementById('bb-tab');
  if (!countEl) return;

  countEl.textContent = blockedPosts.length;
  statsEl.textContent = blockedPosts.length === 0
    ? 'No posts blocked yet'
    : `${blockedPosts.length} post${blockedPosts.length === 1 ? '' : 's'} blocked this session`;

  listEl.innerHTML = '';
  blockedPosts.forEach((post, i) => {
    const item = document.createElement('div');
    item.className = 'bb-panel__item';
    item.innerHTML = `
      <div class="bb-panel__item-meta">
        <div class="bb-panel__item-author">${post.author}</div>
        <div class="bb-panel__item-preview">${post.preview}</div>
      </div>
      <button class="bb-panel__item-jump" data-index="${i}">Jump →</button>
    `;
    item.querySelector('.bb-panel__item-jump').addEventListener('click', () => {
      const p = blockedPosts[i];
      if (!p) return;
      document.getElementById('bb-container').classList.remove('open');
      p.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Peek the post
      setTimeout(() => {
        const peekBtn = p.wrapper.querySelector('.bait-banner__peek');
        if (peekBtn && p.el.classList.contains('bait-hidden')) peekBtn.click();
      }, 600);
    });
    listEl.appendChild(item);
  });

  // Pulse the tab on new block
  if (tabEl) {
    tabEl.classList.remove('bb-tab-pulse');
    void tabEl.offsetWidth; // reflow to restart animation
    tabEl.classList.add('bb-tab-pulse');
  }
}

// ── Find all feed post containers ─────────────────────────────────────────────
function getFeedPosts() {
  const posts = [];
  for (const h2 of document.querySelectorAll('h2')) {
    for (const span of h2.querySelectorAll('span')) {
      if (span.innerText?.trim() === 'Feed post') {
        posts.push(h2.parentElement);
        break;
      }
    }
  }
  return posts;
}

// ── Core: process one feed post ───────────────────────────────────────────────
function processPost(el) {
  if (!el || seen.has(el)) return;
  seen.add(el);

  setTimeout(() => {
    if (!enabled) return;

    const text = (el.innerText || '').trim();
    if (text.length < 30) return;

    const { score, labels } = scoreText(text, sensitivity);
    const threshold = { strict:2, moderate:3, loose:5 }[sensitivity] ?? 3;

    LOG(`📊 score=${score}/${threshold} [${labels.join(',')||'clean'}] → "${text.slice(0,80).replace(/\n/g,' ')}"`);

    if (score >= threshold) {
      LOG('🚫 BAIT — hiding');
      hidePost(el, text);
      count++;
      chrome.storage.sync.set({ filteredCount: count });
      chrome.runtime.sendMessage({ type: 'COUNT_UPDATE', count }).catch(() => {});
    }
  }, 600);
}

// ── Hide / reveal ─────────────────────────────────────────────────────────────
function hidePost(el, text) {
  if (!el.parentNode) {
    WARN('⚠️ hidePost: element has no parentNode, skipping');
    return;
  }

  const MSGS = [
    'Hook, line, and blocked. 🎣',
    'Not today, engagement farmer. 🚜',
    'Caught a baiter. Threw it back. 🐟',
    'This post was fishing for you. We cut the line. ✂️',
    'Comment YES if you want this blocked. Oh wait — done. ✅',
    'Another one bites the bait. Gone. 🎣',
  ];

  const { author, preview } = extractMeta(text || el.innerText || '');

  const wrapper = document.createElement('div');
  wrapper.className = 'bait-blocker-wrapper';
  el.parentNode.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  el.classList.add('bait-hidden');

  const banner = document.createElement('div');
  banner.className = 'bait-banner';
  banner.innerHTML = `
    <div class="bait-banner__top">
      <span class="bait-banner__icon">🎣</span>
      <span class="bait-banner__text">${MSGS[Math.floor(Math.random()*MSGS.length)]}</span>
    </div>
    <div class="bait-banner__author">${author}</div>
    <div class="bait-banner__actions">
      <button class="bait-banner__peek">I'm curious...</button>
      <button class="bait-banner__dismiss">Dismiss ✕</button>
    </div>
  `;
  wrapper.insertBefore(banner, el);

  // Track for side panel
  const postRecord = { el, wrapper, author, preview };
  blockedPosts.push(postRecord);
  updatePanel();

  let peeking = false;
  banner.querySelector('.bait-banner__peek').addEventListener('click', () => {
    peeking = !peeking;
    el.classList.toggle('bait-hidden', !peeking);
    banner.classList.toggle('bait-peeking', peeking);
    banner.querySelector('.bait-banner__peek').textContent = peeking ? 'Put it back 🙈' : "I'm curious...";
  });

  banner.querySelector('.bait-banner__dismiss').addEventListener('click', () => {
    el.classList.remove('bait-hidden');
    banner.remove();
    wrapper.replaceWith(el);
    const idx = blockedPosts.indexOf(postRecord);
    if (idx !== -1) blockedPosts.splice(idx, 1);
    count = Math.max(0, count - 1);
    chrome.storage.sync.set({ filteredCount: count });
    updatePanel();
  });
}

function revealAll() {
  document.querySelectorAll('.bait-hidden').forEach(el => el.classList.remove('bait-hidden'));
  document.querySelectorAll('.bait-banner').forEach(el => el.remove());
}

// ── Scan & observe ────────────────────────────────────────────────────────────
function scanAll() {
  const posts = getFeedPosts();
  LOG(`🔍 scanAll — ${posts.length} feed posts found`);
  posts.forEach(processPost);
}

function startObserver() {
  LOG('👁️ observer on BODY');

  let debounceTimer = null;
  function debouncedScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanAll, 400);
  }

  new MutationObserver(mutations => {
    if (!enabled) return;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) { debouncedScan(); return; }
    }
  }).observe(document.body, { childList: true, subtree: true });

  setInterval(scanAll, 10000);
  LOG('✅ observer + interval scanner running');
}
