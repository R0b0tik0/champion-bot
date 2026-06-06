const express = require('express');
const path = require('path');
const { runBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

const CITY_CODE = process.env.CITY_CODE || 'CEDDF3DE';
const CITY_NAME = process.env.CITY_NAME || 'SAN FERNANDO';
const HEADLESS = process.env.HEADLESS !== 'false';

let botStatus = {
  running: false,
  logs: [],
  result: null,
  startTime: null,
};

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/start', async (req, res) => {
  if (botStatus.running) {
    return res.status(400).json({ error: 'El bot ya está en ejecución' });
  }

  botStatus = {
    running: true,
    logs: [],
    result: null,
    startTime: new Date().toISOString(),
  };

  const log = (msg) => {
    botStatus.logs.push(msg);
    if (botStatus.logs.length > 500) botStatus.logs.shift();
  };

  log(`🚀 Bot iniciado - ${new Date().toLocaleString('es-ES')}`);
  log(`📍 Ciudad: ${CITY_NAME} (${CITY_CODE})`);
  log(`🔧 Headless: ${HEADLESS}`);

  runBot({
    cityCode: CITY_CODE,
    cityName: CITY_NAME,
    headless: HEADLESS,
    onLog: log,
  })
    .then((result) => {
      botStatus.result = result;
      botStatus.endTime = new Date().toISOString();
      if (result && result.success) {
        log('✅ Bot completado exitosamente');
      } else {
        log(`❌ Bot falló: ${(result && result.error) || (result && result.message) || 'Error desconocido'}`);
      }
    })
    .catch((err) => {
      botStatus.result = { success: false, error: err.message };
      botStatus.endTime = new Date().toISOString();
      log(`❌ Error crítico: ${err.message}`);
    })
    .finally(() => {
      botStatus.running = false;
    });

  res.json({ status: 'started' });
});

app.get('/api/status', (req, res) => {
  const status = {
    running: botStatus.running,
    logs: botStatus.logs,
    result: botStatus.result,
    startTime: botStatus.startTime,
    endTime: botStatus.endTime || null,
  };
  // Para SSE polling de logs
  if (req.query.format === 'sse') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const lastIndex = parseInt(req.query.lastIndex || '-1');
    const newLogs = botStatus.logs.slice(lastIndex + 1);

    if (newLogs.length > 0) {
      res.write(`data: ${JSON.stringify({ logs: newLogs, running: botStatus.running, result: botStatus.result })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ logs: [], running: botStatus.running, result: botStatus.result })}\n\n`);
    }

    res.end();
  } else {
    res.json(status);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏆 Champion Bot server listening on port ${PORT}`);
  console.log(`📍 Ciudad configurada: ${CITY_NAME}`);
  console.log(`🔧 Headless: ${HEADLESS}`);
});
