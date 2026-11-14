require('dotenv').config();
const db = require('./src/db');
const { loadSeed } = require('./src/seed');
const { createApp } = require('./src/server');
const worker = require('./src/worker');
const poll = require('./src/poll');

async function main() {
  await db.init();
  const seed = loadSeed();
  const force = process.argv.includes('--import');
  const result = await db.importSeed(seed, { force });
  if (result.imported) {
    console.log(`База перенесена: ${result.users} балансов, ${result.templates} шаблонов, ${result.usage} использований. Снимок ${seed.capturedAt}.`);
  } else {
    console.log('База уже была перенесена. Повторный снимок: npm run import');
  }
  if (force) return;

  const port = Number(process.env.PORT) || 10000;
  createApp().listen(port, () => console.log(`ЯгаГенератор слушает порт ${port}`));
  worker.start();
  poll.start();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
