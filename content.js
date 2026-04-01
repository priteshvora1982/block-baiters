// content.js — Block Baiters
// DOM spy confirmed: LinkedIn feed posts are <section> elements added to <main>
// Strategy: watch for sections, wait 500ms for React to populate, score text.

const LOG  = (...a) => console.log('[BlockBaiters]', ...a);
const WARN = (...a) => console.warn('[BlockBaiters]', ...a);

LOG('🎣 loaded on', location.href);

// ── State ─────────────────────────────────────────────────────────────────────
let enabled     = true;
let sensitivity = 'moderate';
let count       = 0;
const seen      = new WeakSet(); // sections already processed

// ── Settings ──────────────────────────────────────────────────────────────────
chrome.storage.sync.get(['enabled','sensitivity','filteredCount'], d => {
  enabled     = d.enabled !== false;
  sensitivity = d.sensitivity || 'moderate';
  count       = d.filteredCount || 0;
  LOG('⚙️ settings:', {enabled, sensitivity, count});
  scanAll();
  startObserver();
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.enabled)     { enabled     = changes.enabled.newValue;     if (!enabled) revealAll(); }
  if (changes.sensitivity) { sensitivity = changes.sensitivity.newValue; seen.__reset = true; }
  if (changes.filteredCount?.newValue === 0) count = 0;
});

// ── Core: process one <section> ───────────────────────────────────────────────
function processSection(el) {
  if (seen.has(el)) return;
  seen.add(el);

  // Wait for React to populate the section with text
  setTimeout(() => {
    if (!enabled) return;

    const text = (el.innerText || '').trim();
    if (text.length < 30) {
      WARN('⚠️ section too short, skipping:', text.length, 'chars');
      return;
    }

    const { score, labels } = scoreText(text, sensitivity);
    const threshold = { strict:2, moderate:3, loose:5 }[sensitivity] ?? 3;

    LOG(`📊 score=${score}/${threshold} [${labels.join(',')||'clean'}] → "${text.slice(0,70).replace(/\n/g,' ')}"`);

    if (score >= threshold) {
      LOG('🚫 BAIT — hiding');
      hidePost(el);
      count++;
      chrome.storage.sync.set({ filteredCount: count });
      chrome.runtime.sendMessage({ type: 'COUNT_UPDATE', count }).catch(() => {});
    }
  }, 600);
}

// ── Hide / reveal ─────────────────────────────────────────────────────────────
function hidePost(el) {
  const MSGS = [
    'Hook, line, and blocked. 🎣',
    'Not today, engagement farmer. 🚜',
    'Caught a baiter. Threw it back. 🐟',
    'This post was fishing for you. We cut the line. ✂️',
    "Comment YES if you want this blocked. Oh wait — done. ✅",
    'Another one bites the bait. Gone. 🎣',
  ];

  const wrapper = document.createElement('div');
  wrapper.className = 'bait-blocker-wrapper';
  el.parentNode.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  el.classList.add('bait-hidden');

  const banner = document.createElement('div');
  banner.className = 'bait-banner';
  banner.innerHTML = `
    <span class="bait-banner__icon">🎣</span>
    <span class="bait-banner__text">${MSGS[Math.floor(Math.random()*MSGS.length)]}</span>
    <button class="bait-banner__peek">I'm curious...</button>
    <button class="bait-banner__dismiss">✕</button>
  `;
  wrapper.insertBefore(banner, el);

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
  });
}

function revealAll() {
  document.querySelectorAll('.bait-hidden').forEach(el => el.classList.remove('bait-hidden'));
  document.querySelectorAll('.bait-banner').forEach(el => el.remove());
}

// ── Scan & observe ────────────────────────────────────────────────────────────
function scanAll() {
  // Watch entire body — LinkedIn renders feed posts OUTSIDE of <main>
  const sections = document.querySelectorAll('section');
  const eligible = Array.from(sections).filter(s => {
    // Skip sections inside header, nav, footer, aside
    return !s.closest('header, nav, footer, aside');
  });
  LOG(`🔍 scanAll — ${sections.length} total sections, ${eligible.length} eligible`);
  eligible.forEach(processSection);
}

function startObserver() {
  const root = document.body;  // must be body — feed is outside <main>
  LOG('👁️ observer on BODY');

  new MutationObserver(mutations => {
    if (!enabled) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'SECTION') {
          LOG('👁️ new <section> added');
          processSection(node);
        }
        node.querySelectorAll?.('section').forEach(s => {
          LOG('👁️ nested <section> found');
          processSection(s);
        });
      }
    }
  }).observe(root, { childList: true, subtree: true });

  // Safety net: re-scan every 3s to catch anything the observer missed
  setInterval(scanAll, 3000);
  LOG('✅ observer + interval scanner running');
}
