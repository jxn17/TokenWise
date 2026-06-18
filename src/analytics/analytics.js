/**
 * TokenWise Analytics Dashboard
 * Reads from chrome.storage.local only — Chart.js bundled locally via esbuild.
 */

import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  PieController,
  Tooltip,
  Legend,
} from 'chart.js';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  PieController,
  Tooltip,
  Legend
);

(function tokenWiseAnalytics() {
  'use strict';

  const SITE_LABELS = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
  };

  const SITE_COLORS = {
    chatgpt: '#10a37f',
    claude: '#d97757',
    gemini: '#4285f4',
  };

  let dailyChart = null;
  let siteChart = null;

  const elements = {
    total7day: document.getElementById('total-7day'),
    totalMessages: document.getElementById('total-messages'),
    totalSavings: document.getElementById('total-savings'),
    totalSessions: document.getElementById('total-sessions'),
    savingsHighlightValue: document.getElementById('savings-highlight-value'),
    savingsBreakdown: document.getElementById('savings-breakdown'),
    btnClear: document.getElementById('btn-clear'),
    dailyCanvas: document.getElementById('daily-chart'),
    siteCanvas: document.getElementById('site-chart'),
  };

  function formatNumber(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    return n.toLocaleString();
  }

  function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }

  function formatDayLabel(isoDate) {
    const d = new Date(isoDate + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  async function loadStorageData() {
    try {
      const result = await chrome.storage.local.get(['sessions', 'estimatedSavings']);
      return {
        sessions: Array.isArray(result.sessions) ? result.sessions : [],
        estimatedSavings: typeof result.estimatedSavings === 'number' ? result.estimatedSavings : 0,
      };
    } catch {
      return { sessions: [], estimatedSavings: 0 };
    }
  }

  function filterRecentSessions(sessions, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return sessions.filter((s) => s.date >= cutoffStr);
  }

  function aggregateByDay(sessions, dayList) {
    const totals = {};
    for (const day of dayList) {
      totals[day] = 0;
    }
    for (const session of sessions) {
      if (totals[session.date] !== undefined) {
        totals[session.date] += session.totalTokens || 0;
      }
    }
    return dayList.map((day) => totals[day]);
  }

  function aggregateBySite(sessions) {
    const totals = { chatgpt: 0, claude: 0, gemini: 0 };
    for (const session of sessions) {
      if (totals[session.site] !== undefined) {
        totals[session.site] += session.totalTokens || 0;
      }
    }
    return totals;
  }

  function renderDailyChart(dayList, tokenCounts) {
    if (dailyChart) {
      dailyChart.destroy();
      dailyChart = null;
    }

    dailyChart = new Chart(elements.dailyCanvas, {
      type: 'bar',
      data: {
        labels: dayList.map(formatDayLabel),
        datasets: [
          {
            label: 'Tokens',
            data: tokenCounts,
            backgroundColor: 'rgba(99, 102, 241, 0.7)',
            borderColor: 'rgba(129, 140, 248, 1)',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e1e2e',
            titleColor: '#e0e0e8',
            bodyColor: '#a0a0b8',
            callbacks: {
              label: (ctx) => '~' + formatNumber(ctx.parsed.y) + ' tokens',
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#8888a8', font: { size: 11 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#8888a8',
              font: { size: 11 },
              callback: (v) => formatNumber(v),
            },
          },
        },
      },
    });
  }

  function renderSiteChart(siteTotals) {
    if (siteChart) {
      siteChart.destroy();
      siteChart = null;
    }

    const labels = [];
    const data = [];
    const colors = [];

    for (const [site, tokens] of Object.entries(siteTotals)) {
      if (tokens > 0) {
        labels.push(SITE_LABELS[site] || site);
        data.push(tokens);
        colors.push(SITE_COLORS[site] || '#8888a8');
      }
    }

    if (data.length === 0) {
      labels.push('No data');
      data.push(1);
      colors.push('#333');
    }

    siteChart = new Chart(elements.siteCanvas, {
      type: 'pie',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderColor: '#1a1a2e',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#a0a0b8', padding: 16, font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: '#1e1e2e',
            titleColor: '#e0e0e8',
            bodyColor: '#a0a0b8',
            callbacks: {
              label: (ctx) => {
                if (ctx.label === 'No data') return 'No usage recorded yet';
                return '~' + formatNumber(ctx.parsed) + ' tokens';
              },
            },
          },
        },
      },
    });
  }

  function renderSavingsReport(estimatedSavings, recentSessions) {
    elements.savingsHighlightValue.textContent = formatNumber(estimatedSavings);

    while (elements.savingsBreakdown.firstChild) {
      elements.savingsBreakdown.removeChild(elements.savingsBreakdown.firstChild);
    }

    const siteTotals = aggregateBySite(recentSessions);
    const totalTokens = Object.values(siteTotals).reduce((a, b) => a + b, 0);

    if (estimatedSavings === 0 && totalTokens === 0) {
      const li = document.createElement('li');
      li.textContent = 'Start applying suggestions in chat to track savings here.';
      elements.savingsBreakdown.appendChild(li);
      return;
    }

    const savingsPct = totalTokens > 0
      ? Math.round((estimatedSavings / (totalTokens + estimatedSavings)) * 100)
      : 0;

    const items = [
      { label: 'Total tokens saved', value: formatNumber(estimatedSavings) },
      { label: 'Reduction vs. usage', value: savingsPct + '%' },
      { label: 'Sessions tracked (7d)', value: String(recentSessions.length) },
    ];

    for (const item of items) {
      const li = document.createElement('li');
      const labelSpan = document.createElement('span');
      labelSpan.textContent = item.label;
      const valueSpan = document.createElement('span');
      valueSpan.textContent = item.value;
      li.appendChild(labelSpan);
      li.appendChild(valueSpan);
      elements.savingsBreakdown.appendChild(li);
    }
  }

  function updateSummary(recentSessions, estimatedSavings) {
    const totalTokens = recentSessions.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
    const totalMessages = recentSessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);

    elements.total7day.textContent = formatNumber(totalTokens);
    elements.totalMessages.textContent = formatNumber(totalMessages);
    elements.totalSavings.textContent = formatNumber(estimatedSavings);
    elements.totalSessions.textContent = formatNumber(recentSessions.length);
  }

  async function renderDashboard() {
    const { sessions, estimatedSavings } = await loadStorageData();
    const recentSessions = filterRecentSessions(sessions, 7);
    const dayList = getLast7Days();
    const dailyTokens = aggregateByDay(recentSessions, dayList);
    const siteTotals = aggregateBySite(recentSessions);

    updateSummary(recentSessions, estimatedSavings);
    renderDailyChart(dayList, dailyTokens);
    renderSiteChart(siteTotals);
    renderSavingsReport(estimatedSavings, recentSessions);
  }

  async function clearAllData() {
    const confirmed = window.confirm(
      'Clear all TokenWise data? This cannot be undone. Settings will reset to defaults.'
    );
    if (!confirmed) return;

    try {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        sessions: [],
        settings: {
          showWidget: true,
          showSuggestions: true,
          defaultModel: 'gpt-4o',
          warningThreshold: 8000,
          criticalThreshold: 30000,
        },
        widgetPosition: { x: -1, y: -1 },
        widgetVisible: true,
        activeSessions: {},
        estimatedSavings: 0,
        onboardingCompleted: false,
      });
      await renderDashboard();
    } catch {
      // Fail silently
    }
  }

  function setupEventListeners() {
    elements.btnClear.addEventListener('click', clearAllData);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    renderDashboard();
  });
})();
