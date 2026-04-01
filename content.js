// content.js — LinkedIn feed scanner
// Depends on patterns.js (loaded first via manifest content_scripts order)

const LOG = (...args) => console.log('[BlockBaiters]', ...args);
const WARN = (...args) => console.warn('[BlockBaiters]', ...args);
const ERR  = (...args) => console.error('[BlockBaiters]', ...args);

LOG('🎣 content.js loaded on', location.href);

// ── Selectors ────────────────────────────────────────────────────────────────
// LinkedIn migrated to hashed atomic CSS (e.g. _393f7ff0) — class selectors
// are unreliable. We rely exclusively on data-* attributes which are stable.

const POST_SELECTORS = [
  // New LinkedIn Renaissance UI (2024+) — data-urn is the most stable
  'div[data-urn^="urn:li:activity"]',
  'div[data-urn^="urn:li:aggregate"]',
  'div[data-urn^="urn:li:share"]',
  // data-id variants (older/parallel UI)
  'div[data-id^="urn:li:activity"]',
  'div[data-id^="urn:li:aggregate"]',
  // Occludable feed items (both old and new UI)
  '[data-occludable-entity-urn]',
  'li[data-occludable-entity-urn]',
  // testid-based (semi-stable)
  '[data-testid="main-feed-activity-card"]',
  '[data-testid="feed-shared-update"]',
];

const TEXT_SELECTORS = [
  // New UI — testid is the most stable anchor for text
  '[data-testid="main-feed-activity-card__commentary"]',
  '[data-testid="feed-shared-text"]',
  // Expandable text (see more / see less button sibling)
  '[data-testid="expandable-text-content"]',
  // Old class names — still present on some LinkedIn rollouts
  '.feed-shared-update-v2__description',
  '.feed-shared-text',
  '.feed-shared-text-view',
  '.update-components-text',
  '.feed-shared-inline-show-more-text',
  // Generic fallbacks
  '.break-words',
  'span[dir="ltr"]',
];

const POST_SELECTOR  = POST_SELECTORS.join(', ');
const TEXT_SELECTOR  = TEXT_SELECTORS.join(', ');

let settings = { enabled: true, sensitivity: 'moderate' };
let filteredCount = 0;
let processedPosts = new WeakSet();

// ── DOM selector discovery ───────────────────────────────────────────────────
// Logs what's actually in the page so we can tune selectors if needed.

function discoverDOM() {
  LOG('🔍 Running DOM discovery on', location.pathname);

  // Check each selector individually
  POST_SELECTORS.forEach(sel => {
    const matches = document.querySelectorAll(sel);
    if (matches.length > 0) {
      LOG(`  ✅ POST selector "${sel}" → ${matches.length} elements`);
    } else {
      WARN(`  ❌ POST selector "${sel}" → 0 elements`);
    }
  });

  // Log first few data-* attributes of likely post containers to help tune selectors
  const candidates = document.querySelectorAll('[data-id],[data-urn],[data-occludable-entity-urn]');
  LOG(`  📦 Elements with data-id/data-urn/data-occludable-entity-urn: ${candidates.length}`);
  Array.from(candidates).slice(0, 5).forEach((el, i) => {
    LOG(`    [${i}] <${el.tagName.toLowerCase()} class="${el.className.slice(0,60)}..." data-id="${el.dataset.id || ''}" data-urn="${el.dataset.urn || ''}">`);
  });

  // Check text selectors
  TEXT_SELECTORS.forEach(sel => {
    const matches = document.querySelectorAll(sel);
    if (matches.length > 0) {
      LOG(`  ✅ TEXT selector "${sel}" → ${matches.length} elements`);
    } else {
      WARN(`  ❌ TEXT selector "${sel}" → 0 elements`);
    }
  });

  // Log main/feed element
  const main = document.querySelector('main');
  LOG(`  📄 <main> found: ${!!main}`);
  const feedContainer = document.querySelector('.scaffold-finite-scroll__content, .core-rail, [role="main"]');
  LOG(`  📄 feed container: ${feedContainer ? feedContainer.className.slice(0,80) : 'NOT FOUND'}`);
}

// ── Settings ─────────────────────────────────────────────────────────────────

function loadSettings(cb) {
  chrome.storage.sync.get(['enabled', 'sensitivity', 'filteredCount'], (data) => {
    if (chrome.runtime.lastError) {
      ERR('storage.sync.get failed:', chrome.runtime.lastError);
      cb && cb(); return;
    }
    settings.enabled    = data.enabled !== false;
    settings.sensitivity = data.sensitivity || 'moderate';
    filteredCount        = data.filteredCount || 0;
    LOG('⚙️  Settings loaded:', JSON.stringify(settings), '| filteredCount:', filteredCount);
    cb && cb();
  });
}

function saveFilteredCount() {
  chrome.storage.sync.set({ filteredCount }, () => {
    if (chrome.runtime.lastError) ERR('saveFilteredCount failed:', chrome.runtime.lastError);
  });
}

// Listen for settings changes from popup
chrome.storage.onChanged.addListener((changes) => {
  LOG('⚙️  Storage changed:', JSON.stringify(changes));
  if (changes.enabled !== undefined) {
    settings.enabled = changes.enabled.newValue;
    LOG(settings.enabled ? '✅ Extension enabled — rescanning' : '⏸️  Extension disabled — revealing all');
    if (!settings.enabled) revealAll(); else scanAll();
  }
  if (changes.sensitivity !== undefined) {
    settings.sensitivity = changes.sensitivity.newValue;
    LOG('🎚️  Sensitivity changed to:', settings.sensitivity, '— re-evaluating all posts');
    processedPosts = new WeakSet();
    document.querySelectorAll('.bait-blocker-wrapper').forEach(el => el.remove());
    scanAll();
  }
  if (changes.filteredCount !== undefined && changes.filteredCount.newValue === 0) {
    filteredCount = 0;
    LOG('🔄 Count reset');
  }
});

// ── Post processing ───────────────────────────────────────────────────────────

function getPostText(postEl) {
  // 1. Try each text selector individually so we can log which one hits
  for (const sel of TEXT_SELECTORS) {
    const el = postEl.querySelector(sel);
    if (el) {
      const text = el.innerText || el.textContent || '';
      if (text.trim()) {
        LOG(`  📝 Text via "${sel}" (${text.length} chars): "${text.slice(0,80).replace(/\n/g,' ')}"`);
        return text;
      }
    }
  }

  // 2. Fallback: look for any span[dir="ltr"] or p inside the post
  const anyText = postEl.querySelector('span[dir="ltr"], p, [role="article"]');
  if (anyText) {
    const text = anyText.innerText || anyText.textContent || '';
    WARN(`  ⚠️  Fallback text via <${anyText.tagName.toLowerCase()}> (${text.length} chars): "${text.slice(0,80).replace(/\n/g,' ')}"`);
    return text;
  }

  // 3. Last resort: entire post element
  const text = postEl.innerText || postEl.textContent || '';
  WARN(`  ⚠️  No text selector matched — using full innerText (${text.length} chars)`);
  return text;
}

function processPost(postEl) {
  if (processedPosts.has(postEl)) return;
  processedPosts.add(postEl);

  if (!settings.enabled) {
    LOG('⏸️  Skipping post (extension disabled)');
    return;
  }

  const tag   = `<${postEl.tagName.toLowerCase()} data-id="${postEl.dataset.id || postEl.dataset.urn || '?'}">`;
  LOG(`🔎 Processing post: ${tag}`);

  const text = getPostText(postEl);
  if (!text.trim()) {
    WARN('  ⚠️  Empty text — skipping post');
    return;
  }

  const { score, labels } = scoreText(text, settings.sensitivity);
  const threshold = { strict: 2, moderate: 3, loose: 5 }[settings.sensitivity] ?? 3;

  LOG(`  📊 Score: ${score}/${threshold} | Labels: [${labels.join(', ') || 'none'}] | Sensitivity: ${settings.sensitivity}`);

  if (score >= threshold) {
    LOG(`  🚫 BAIT DETECTED — hiding post (score ${score} ≥ threshold ${threshold})`);
    hidePost(postEl);
    filteredCount++;
    saveFilteredCount();
    chrome.runtime.sendMessage({ type: 'COUNT_UPDATE', count: filteredCount }).catch(() => {});
  } else {
    LOG(`  ✅ Post clean (score ${score} < threshold ${threshold}) — leaving visible`);
  }
}

function hidePost(postEl) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bait-blocker-wrapper';
  postEl.parentNode.insertBefore(wrapper, postEl);
  wrapper.appendChild(postEl);
  postEl.classList.add('bait-hidden');

  const BAIT_MESSAGES = [
    'Hook, line, and blocked. 🎣',
    'Caught a baiter. Threw it back. 🐟',
    'Not today, engagement farmer. 🚜',
    'Bait detected. Reel it in elsewhere. 🎣',
    'This post was fishing for you. We cut the line. ✂️',
    'Comment YES if you want this blocked. Oh wait — already done. ✅',
    'Another one bites the bait. Gone. 🎣',
    "Your feed thanks us. You're welcome. 🙏",
  ];
  const msg = BAIT_MESSAGES[Math.floor(Math.random() * BAIT_MESSAGES.length)];

  const banner = document.createElement('div');
  banner.className = 'bait-banner';
  banner.innerHTML = `
    <span class="bait-banner__icon">🎣</span>
    <span class="bait-banner__text">${msg}</span>
    <button class="bait-banner__peek" type="button">I'm curious...</button>
    <button class="bait-banner__dismiss" type="button">✕</button>
  `;
  wrapper.insertBefore(banner, postEl);
  LOG('  🎨 Banner injected');

  const peekBtn = banner.querySelector('.bait-banner__peek');
  let peeking = false;
  peekBtn.addEventListener('click', () => {
    peeking = !peeking;
    postEl.classList.toggle('bait-hidden', !peeking);
    banner.classList.toggle('bait-peeking', peeking);
    peekBtn.textContent = peeking ? 'Put it back 🙈' : "I'm curious...";
    LOG(peeking ? '👀 User peeked at blocked post' : '🙈 User re-hid post');
  });

  banner.querySelector('.bait-banner__dismiss').addEventListener('click', () => {
    LOG('✕ User dismissed block on post');
    postEl.classList.remove('bait-hidden');
    banner.remove();
    wrapper.parentNode.insertBefore(postEl, wrapper);
    wrapper.remove();
  });
}

function revealAll() {
  const hidden  = document.querySelectorAll('.bait-hidden').length;
  const banners = document.querySelectorAll('.bait-banner').length;
  LOG(`👁️  Revealing all — removing ${hidden} hidden posts and ${banners} banners`);
  document.querySelectorAll('.bait-hidden').forEach(el => el.classList.remove('bait-hidden'));
  document.querySelectorAll('.bait-banner').forEach(el => el.remove());
}

function scanAll() {
  const posts = document.querySelectorAll(POST_SELECTOR);
  LOG(`🔍 scanAll() — found ${posts.length} post elements in DOM`);
  if (posts.length === 0) {
    WARN('  ⚠️  No posts found — selectors may need updating for current LinkedIn DOM');
    discoverDOM();
  }
  posts.forEach(processPost);
}

// ── MutationObserver ──────────────────────────────────────────────────────────

function startObserver() {
  // Watch document.body — LinkedIn may render posts outside <main>
  const feedRoot = document.body;
  LOG(`👁️  MutationObserver attached to: <body>`);

  let mutationCount = 0;
  let newPostCount  = 0;
  let domSpyCount   = 0; // log first 30 added elements to discover real structure

  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    mutationCount += mutations.length;

    let found = 0;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // ── DOM SPY: log first 30 elements to discover LinkedIn's real structure ──
        if (domSpyCount < 30) {
          const urn   = node.dataset?.urn   || node.dataset?.id || node.dataset?.occludableEntityUrn || '';
          const testid = node.dataset?.testid || node.getAttribute?.('data-testid') || '';
          const cls   = (node.className && typeof node.className === 'string')
                          ? node.className.slice(0, 60) : '';
          const childCount = node.children?.length || 0;
          LOG(`🕵️  DOM SPY [${domSpyCount}] <${node.tagName?.toLowerCase()}> ` +
              `data-urn="${urn}" data-testid="${testid}" ` +
              `class="${cls}" children=${childCount}`);

          // Also log data attributes of interesting large elements
          if (childCount > 2) {
            const attrs = Array.from(node.attributes || [])
              .filter(a => a.name.startsWith('data-'))
              .map(a => `${a.name}="${a.value.slice(0,40)}"`)
              .join(' ');
            if (attrs) LOG(`  └─ data attrs: ${attrs}`);
          }
          domSpyCount++;
        }

        // ── Normal selector matching ──────────────────────────────────────────
        if (node.matches && node.matches(POST_SELECTOR)) {
          found++;
          processPost(node);
        }
        if (node.querySelectorAll) {
          const nested = node.querySelectorAll(POST_SELECTOR);
          if (nested.length > 0) {
            LOG(`  🎯 Found ${nested.length} nested post(s) inside added node`);
            nested.forEach(el => { found++; processPost(el); });
          }
        }
      }
    }

    newPostCount += found;
    if (found > 0) {
      LOG(`👁️  Observer: +${found} new post(s) | total mutations: ${mutationCount} | total posts seen: ${newPostCount}`);
    }
  });

  observer.observe(feedRoot, { childList: true, subtree: true });
  LOG('✅ Observer running — spying on first 30 DOM additions to discover LinkedIn structure');
}

// ── Init ──────────────────────────────────────────────────────────────────────

LOG('⏳ Waiting for settings...');
loadSettings(() => {
  LOG('🚀 Init complete — running initial scan');
  discoverDOM();
  scanAll();
  startObserver();
});
