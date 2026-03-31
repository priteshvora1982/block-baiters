// background.js — MV3 service worker
// Initializes default settings on first install

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      enabled: true,
      sensitivity: 'moderate',
      filteredCount: 0,
    });
  }
});
