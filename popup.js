// popup.js

const HINTS = {
  loose:    'Only the most shameless baiters get caught. 🎣',
  moderate: 'Catches the usual suspects. Good vibes only. ✌️',
  strict:   'Zero tolerance. Not even a nibble gets through. 🚫',
};

const enabledToggle = document.getElementById('enabledToggle');
const filteredCountEl = document.getElementById('filteredCount');
const sensitivityGroup = document.getElementById('sensitivityGroup');
const sensitivityHint = document.getElementById('sensitivityHint');
const resetBtn = document.getElementById('resetBtn');

// ── Load current settings ────────────────────────────────────────────────────

chrome.storage.sync.get(['enabled', 'sensitivity', 'filteredCount'], (data) => {
  const enabled = data.enabled !== false;
  const sensitivity = data.sensitivity || 'moderate';
  const count = data.filteredCount || 0;

  enabledToggle.checked = enabled;
  filteredCountEl.textContent = count;
  setSensitivity(sensitivity, false);
});

// ── Toggle ───────────────────────────────────────────────────────────────────

enabledToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledToggle.checked });
});

// ── Sensitivity buttons ──────────────────────────────────────────────────────

sensitivityGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.sens-btn');
  if (!btn) return;
  setSensitivity(btn.dataset.value, true);
});

function setSensitivity(value, save) {
  sensitivityGroup.querySelectorAll('.sens-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
  sensitivityHint.textContent = HINTS[value] || '';
  if (save) {
    chrome.storage.sync.set({ sensitivity: value });
  }
}

// ── Reset count ──────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  chrome.storage.sync.set({ filteredCount: 0 }, () => {
    filteredCountEl.textContent = '0';
  });
});

// ── Live count updates from content script ───────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'COUNT_UPDATE') {
    filteredCountEl.textContent = msg.count;
  }
});
