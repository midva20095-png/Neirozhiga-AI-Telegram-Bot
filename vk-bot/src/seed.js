const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./csv');
const { classify } = require('./templates');

function readTable(file) {
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

function parseRuDate(value) {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hour - 3, minute, second));
}

function loadSeed(dir) {
  const root = dir || path.join(__dirname, '..', 'seed');
  const balanceRows = readTable(path.join(root, 'balance.csv')).slice(1);
  const users = new Map();
  for (const row of balanceRows) {
    const id = String(row[0] || '').trim();
    if (!/^\d+$/.test(id)) continue;
    const balance = Math.round(Number(String(row[1] || '').replace(',', '.')));
    users.set(id, { userId: id, balance: Number.isFinite(balance) ? balance : 0, updated: row[2] || '' });
  }

  const templateRows = readTable(path.join(root, 'templates.csv')).slice(1);
  const templates = [];
  templateRows.forEach((row, index) => {
    const item = classify(row, index);
    if (item) templates.push(item);
  });

  const usage = [];
  for (const row of readTable(path.join(root, 'usage.csv')).slice(1)) {
    const at = parseRuDate(row[0]);
    const templateId = String(row[1] || '').trim();
    const userId = String(row[2] || '').trim();
    if (!at || !templateId || !/^\d+$/.test(userId)) continue;
    usage.push({ at, templateId, userId });
  }

  const daily = [];
  for (const row of readTable(path.join(root, 'daily.csv')).slice(1)) {
    const userId = String(row[0] || '').trim();
    if (!/^\d+$/.test(userId)) continue;
    daily.push({
      userId,
      lastDay: String(row[1] || '').slice(0, 10),
      streak: Number(row[2]) || 0,
      total: Number(row[3]) || 0
    });
  }

  const payers = [];
  const seen = new Set();
  for (const row of readTable(path.join(root, 'payers.csv')).slice(1)) {
    const userId = String(row[0] || '').trim();
    if (!/^\d+$/.test(userId) || seen.has(userId)) continue;
    seen.add(userId);
    payers.push({ userId, firstAt: row[1] || '' });
  }

  return {
    users: [...users.values()],
    templates,
    usage,
    daily,
    payers,
    capturedAt: '2026-11-14'
  };
}

module.exports = { loadSeed, parseRuDate };
