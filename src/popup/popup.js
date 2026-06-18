/**
 * TokenWise Popup Dashboard
 * All data fetched locally via chrome.storage and service worker messages.
 */

(function tokenWisePopup() {
  'use strict';

  const HEALTH_LABELS = {
    fresh: { text: '🟢 Fresh', className: 'health-fresh' },
    getting_long: { text: '🟡 Getting Long', className: 'health-getting-long' },
    very_expensive: { text: '🔴 Very Expensive', className: 'health-very-expensive' },
  };

  const elements = {
    sessionTokens: document.getElementById('session-tokens'),
    messageCount: document.getElementById('message-count'),
    avgTokens: document.getElementById('avg-tokens'),
    estSavings: document.getElementById('est-savings'),
    healthBadge: document.getElementById('health-badge'),
    miniChart: document.getElementById('mini-chart'),
    chartEmpty: document.getElementById('chart-empty'),
    toggleWidget: document.getElementById('toggle-widget'),
    toggleSuggestions: document.getElementById('toggle-suggestions'),
    defaultModel: document.getElementById('default-model'),
    btnAnalytics: document.getElementById('btn-analytics'),
  };

  function formatNumber(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    return n.toLocaleString();
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || {});
        });
      } catch (error) {
        const safeMessage = error instanceof Error ? error.message : 'Message error';
        resolve({ error: safeMessage });
      }
    });
  }

  function updateHealthBadge(health) {
    if (!elements.healthBadge) return;
    const info = HEALTH_LABELS[health] || HEALTH_LABELS.fresh;
    elements.healthBadge.textContent = info.text;
    elements.healthBadge.className = 'health-badge ' + info.className;
  }

  function renderMiniChart(history) {
    if (!elements.miniChart || !elements.chartEmpty) return;

    if (!history || history.length === 0) {
      elements.miniChart.classList.add('hidden');
      elements.chartEmpty.classList.remove('hidden');
      return;
    }

    elements.miniChart.classList.remove('hidden');
    elements.chartEmpty.classList.add('hidden');

    while (elements.miniChart.firstChild) {
      elements.miniChart.removeChild(elements.miniChart.firstChild);
    }

    const maxVal = Math.max(...history, 1);

    for (const tokens of history) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      if (tokens > 2000) bar.classList.add('high');
      else if (tokens > 500) bar.classList.add('medium');
      bar.style.height = Math.max(4, (tokens / maxVal) * 56) + 'px';
      bar.title = '~' + formatNumber(tokens) + ' tokens';
      elements.miniChart.appendChild(bar);
    }
  }

  function updateDashboard(stats) {
    if (!stats || stats.error) return;

    const sessionTokens = stats.activeConversationTokens || stats.todayTokens || 0;
    const messages = stats.activeMessages || stats.todayMessages || 0;
    const avg = stats.avgTokensPerMessage || (messages > 0 ? Math.round(sessionTokens / messages) : 0);

    if (elements.sessionTokens) elements.sessionTokens.textContent = formatNumber(sessionTokens);
    if (elements.messageCount) elements.messageCount.textContent = formatNumber(messages);
    if (elements.avgTokens) elements.avgTokens.textContent = formatNumber(avg);
    if (elements.estSavings) elements.estSavings.textContent = formatNumber(stats.estimatedSavings || 0);

    updateHealthBadge(stats.health || 'fresh');
    renderMiniChart(stats.perMessageHistory || []);
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings', 'widgetVisible']);
      const settings = result.settings || {};

      if (elements.toggleWidget) {
        elements.toggleWidget.checked = result.widgetVisible !== false;
      }
      if (elements.toggleSuggestions) {
        elements.toggleSuggestions.checked = settings.showSuggestions !== false;
      }
      if (elements.defaultModel && settings.defaultModel) {
        elements.defaultModel.value = settings.defaultModel;
      }
    } catch {
      // Use defaults
    }
  }

  async function saveSettings(partial) {
    try {
      await sendMessage({
        type: 'SETTINGS_CHANGED',
        data: partial,
      });
    } catch {
      // Fail silently
    }
  }

  async function refreshStats() {
    const stats = await sendMessage({ type: 'GET_STATS' });
    updateDashboard(stats);
  }

  function setupEventListeners() {
    if (elements.toggleWidget) {
      elements.toggleWidget.addEventListener('change', () => {
        saveSettings({ showWidget: elements.toggleWidget.checked });
      });
    }

    if (elements.toggleSuggestions) {
      elements.toggleSuggestions.addEventListener('change', () => {
        saveSettings({ showSuggestions: elements.toggleSuggestions.checked });
      });
    }

    if (elements.defaultModel) {
      elements.defaultModel.addEventListener('change', () => {
        saveSettings({ defaultModel: elements.defaultModel.value });
      });
    }

    if (elements.btnAnalytics) {
      elements.btnAnalytics.addEventListener('click', () => {
        try {
          chrome.windows.create({
            url: chrome.runtime.getURL('src/analytics/analytics.html'),
            type: 'normal',
            width: 1000,
            height: 800,
          });
        } catch {
          // Fail silently
        }
      });
    }

    // Refresh when content scripts push new token data
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.liveStats || changes.estimatedSavings || changes.sessions) {
          refreshStats();
        }
      });
    } catch {
      // Non-critical
    }
  }

  async function init() {
    setupEventListeners();
    await loadSettings();
    await refreshStats();

    setInterval(refreshStats, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
