// content.js — LinkedIn feed scanner
// Depends on patterns.js (loaded first via manifest content_scripts order)

const FEED_PATH_RE = /^\/($|feed|mynetwork|in\/|search\/)/;
const POST_SELECTOR = [
  'div.feed-shared-update-v2',
  'div[data-id^="urn:li:activity"]',
  'div[data-id^="urn:li:aggregate"]',
].join(', ');

const TEXT_SELECTOR = [
  '.feed-shared-update-v2__description',
  '.feed-shared-text',
  '.feed-shared-text-view',
  '.update-components-text',
  'span[dir="ltr"]',
].join(', ');

let settings = { enabled: true, sensitivity: 'moderate' };
let filteredCount = 0;
let processedPosts = new WeakSet();

// ── Settings ────────────────────────────────────────────────────────────────

function loadSettings(cb) {
  chrome.storage.sync.get(['enabled', 'sensitivity', 'filteredCount'], (data) => {
    settings.enabled = data.enabled !== false; // default true
    settings.sensitivity = data.sensitivity || 'moderate';
    filteredCount = data.filteredCount || 0;
    cb && cb();
  });
}

function saveFilteredCount() {
  chrome.storage.sync.set({ filteredCount });
}

// Listen for settings changes from popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled !== undefined) {
    settings.enabled = changes.enabled.newValue;
    if (!settings.enabled) {
      revealAll();
    } else {
      scanAll();
    }
  }
  if (changes.sensitivity !== undefined) {
    settings.sensitivity = changes.sensitivity.newValue;
    // Re-evaluate all already-processed posts
    processedPosts = new WeakSet();
    document.querySelectorAll('.bait-blocker-wrapper').forEach(el => el.remove());
    scanAll();
  }
  if (changes.filteredCount !== undefined && changes.filteredCount.newValue === 0) {
    filteredCount = 0;
  }
});

// ── Post processing ──────────────────────────────────────────────────────────

function getPostText(postEl) {
  // Try dedicated text containers first
  const textEl = postEl.querySelector(TEXT_SELECTOR);
  if (textEl) return textEl.innerText || textEl.textContent || '';
  // Fall back to the whole post text (noisier but catches edge cases)
  return postEl.innerText || postEl.textContent || '';
}

function processPost(postEl) {
  if (processedPosts.has(postEl)) return;
  processedPosts.add(postEl);

  if (!settings.enabled) return;

  const text = getPostText(postEl);
  if (!text.trim()) return;

  if (isBait(text, settings.sensitivity)) {
    hidePost(postEl, text);
    filteredCount++;
    saveFilteredCount();
    // Notify popup if open
    chrome.runtime.sendMessage({ type: 'COUNT_UPDATE', count: filteredCount }).catch(() => {});
  }
}

function hidePost(postEl, text) {
  // Wrap in a container so we can swap between hidden/visible state
  const wrapper = document.createElement('div');
  wrapper.className = 'bait-blocker-wrapper';
  postEl.parentNode.insertBefore(wrapper, postEl);
  wrapper.appendChild(postEl);

  // Hide the real post
  postEl.classList.add('bait-hidden');

  // Inject the placeholder banner
  const banner = document.createElement('div');
  banner.className = 'bait-banner';
  const BAIT_MESSAGES = [
    'Hook, line, and blocked. 🎣',
    'Caught a baiter. Threw it back. 🐟',
    'Not today, engagement farmer. 🚜',
    'Bait detected. Reel it in elsewhere. 🎣',
    'This post was fishing for you. We cut the line. ✂️',
    'Comment YES if you want this blocked. Oh wait — already done. ✅',
    'Another one bites the bait. Gone. 🎣',
    'Your feed thanks us. You\'re welcome. 🙏',
  ];
  const msg = BAIT_MESSAGES[Math.floor(Math.random() * BAIT_MESSAGES.length)];

  banner.innerHTML = `
    <span class="bait-banner__icon">🎣</span>
    <span class="bait-banner__text">${msg}</span>
    <button class="bait-banner__peek" type="button">I'm curious...</button>
    <button class="bait-banner__dismiss" type="button">✕</button>
  `;
  wrapper.insertBefore(banner, postEl);

  // Peek: toggle visibility without removing from processed set
  const peekBtn = banner.querySelector('.bait-banner__peek');
  let peeking = false;
  peekBtn.addEventListener('click', () => {
    peeking = !peeking;
    postEl.classList.toggle('bait-hidden', !peeking);
    banner.classList.toggle('bait-peeking', peeking);
    peekBtn.textContent = peeking ? 'Put it back 🙈' : 'I\'m curious...';
  });

  // Dismiss: permanently show this post for this session
  banner.querySelector('.bait-banner__dismiss').addEventListener('click', () => {
    postEl.classList.remove('bait-hidden');
    banner.remove();
    // Unwrap — move post back out of wrapper
    wrapper.parentNode.insertBefore(postEl, wrapper);
    wrapper.remove();
  });
}

function revealAll() {
  document.querySelectorAll('.bait-hidden').forEach(el => el.classList.remove('bait-hidden'));
  document.querySelectorAll('.bait-banner').forEach(el => el.remove());
}

function scanAll() {
  document.querySelectorAll(POST_SELECTOR).forEach(processPost);
}

// ── MutationObserver ─────────────────────────────────────────────────────────

function startObserver() {
  const feedRoot = document.querySelector('main') || document.body;

  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Check if node itself is a post
        if (node.matches && node.matches(POST_SELECTOR)) {
          processPost(node);
        }
        // Check descendants
        node.querySelectorAll && node.querySelectorAll(POST_SELECTOR).forEach(processPost);
      }
    }
  });

  observer.observe(feedRoot, { childList: true, subtree: true });
}

// ── Init ─────────────────────────────────────────────────────────────────────

loadSettings(() => {
  scanAll();
  startObserver();
});
