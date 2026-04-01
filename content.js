// content.js — LinkedIn feed scanner
// Depends on patterns.js (loaded first via manifest content_scripts order)

const LOG = (...args) => console.log('[BlockBaiters]', ...args);
const WARN = (...args) => console.warn('[BlockBaiters]', ...args);
const ERR  = (...args) => console.error('[BlockBaiters]', ...args);

LOG('🎣 content.js loaded on', location.href);

// ── Selectors ────────────────────────────────────────────────────────────────
// DOM spy confirmed: LinkedIn's new UI has NO data-urn/data-testid/data-id on
// post elements. Only stable hook is the semantic class 'hasBreakWordsNoHyphen'
// on post text containers. Strategy: anchor on text, walk UP to post container.

// The one confirmed text anchor class from the DOM spy
const TEXT_ANCHOR = '.hasBreakWordsNoHyphen';

// Walk up from a text element to find its post container
// Posts are wrapped in <section> or <article> or <li> in LinkedIn's feed
function findPostContainer(textEl) {
  let el = textEl.parentElement;
  for (let i = 0; i < 15; i++) {
    if (!el || el === document.body) break;
    const tag = el.tagName;
    // section/article/li are the strongest post container signals
    if (tag === 'SECTION' || tag === 'ARTICLE' || tag === 'LI') {
      LOG(`  🎯 Found post container: <${tag.toLowerCase()}> at depth ${i+1}`);
      return el;
    }
    el = el.parentElement;
  }
  // Fallback: go up 6 levels from the text element
  el = textEl;
  for (let i = 0; i < 6; i++) {
    if (!el.parentElement || el.parentElement === document.body) break;
    el = el.parentElement;
  }
  LOG(`  ⚠️  No section/article/li found — using ancestor at depth 6`);
  return el;
}

const POST_SELECTOR  = POST_SELECTORS.join(', ');
const TEXT_SELECTOR  = TEXT_SELECTORS.join(', ');

let settings = { enabled: true, sensitivity: 'moderate' };
let filteredCount = 0;
let processedPosts = new WeakSet();

// ── DOM selector discovery ───────────────────────────────────────────────────
// Logs what's actually in the page so we can tune selectors if needed.

function discoverDOM() {
  LOG('🔍 Running DOM discovery on', location.pathname);

  const anchors = document.querySelectorAll(TEXT_ANCHOR);
  LOG(`  📝 .hasBreakWordsNoHyphen anchors in DOM: ${anchors.length}`);
  Array.from(anchors).slice(0, 3).forEach((el, i) => {
    LOG(`    [${i}] text: "${(el.innerText || '').slice(0,80).replace(/\n/g,' ')}"`);
  });

  const main = document.querySelector('main');
  LOG(`  📄 <main> found: ${!!main}`);
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

function getPostText(textAnchorEl) {
  const text = textAnchorEl.innerText || textAnchorEl.textContent || '';
  LOG(`  📝 Text from .hasBreakWordsNoHyphen (${text.length} chars): "${text.slice(0,80).replace(/\n/g,' ')}"`);
  return text;
}

// Process a .hasBreakWordsNoHyphen text anchor — score it, find its post container, hide if bait
function processTextAnchor(textEl) {
  if (processedPosts.has(textEl)) return;
  processedPosts.add(textEl);

  if (!settings.enabled) return;

  const text = getPostText(textEl);
  if (!text.trim()) {
    WARN('  ⚠️  Empty text anchor — skipping');
    return;
  }

  const { score, labels } = scoreText(text, settings.sensitivity);
  const threshold = { strict: 2, moderate: 3, loose: 5 }[settings.sensitivity] ?? 3;

  LOG(`🔎 Text anchor scored: ${score}/${threshold} [${labels.join(', ') || 'none'}] → "${text.slice(0,60).replace(/\n/g,' ')}"`);

  if (score >= threshold) {
    const postEl = findPostContainer(textEl);
    if (processedPosts.has(postEl)) {
      LOG('  ↩️  Post container already processed — skipping');
      return;
    }
    processedPosts.add(postEl);
    LOG(`  🚫 BAIT — hiding <${postEl.tagName.toLowerCase()}>`);
    hidePost(postEl);
    filteredCount++;
    saveFilteredCount();
    chrome.runtime.sendMessage({ type: 'COUNT_UPDATE', count: filteredCount }).catch(() => {});
  } else {
    LOG(`  ✅ Clean (${score} < ${threshold})`);
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
  const anchors = document.querySelectorAll(TEXT_ANCHOR);
  LOG(`🔍 scanAll() — found ${anchors.length} .hasBreakWordsNoHyphen text anchors`);
  if (anchors.length === 0) {
    WARN('  ⚠️  No text anchors found — feed may not have rendered yet, observer will catch them');
    discoverDOM();
  }
  anchors.forEach(processTextAnchor);
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

        // ── Anchor-based matching: look for text anchors in added subtree ────
        if (node.matches && node.matches(TEXT_ANCHOR)) {
          found++;
          processTextAnchor(node);
        }
        if (node.querySelectorAll) {
          const nested = node.querySelectorAll(TEXT_ANCHOR);
          if (nested.length > 0) {
            LOG(`  🎯 Found ${nested.length} text anchor(s) inside added node`);
            nested.forEach(el => { found++; processTextAnchor(el); });
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
