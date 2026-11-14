const db = require('./db');
const { safeDeliver } = require('./generate');

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const jobs = await db.pendingJobs();
    for (const job of jobs) await safeDeliver(job);
  } catch (error) {
    console.error('Очередь:', error.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(error => console.error(error)); }, 12000);
  tick().catch(error => console.error(error));
}

module.exports = { start, tick };
