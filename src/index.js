const express = require('express');
const path = require('path');
const { runBot } = require('./bot');
const { TempEmail } = require('./email');

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
  const lastIndex = parseInt(req.query.lastIndex || '-1');
  const newLogs = botStatus.logs.slice(lastIndex + 1);

  res.json({
    running: botStatus.running,
    logs: newLogs,
    result: botStatus.result,
    startTime: botStatus.startTime,
    endTime: botStatus.endTime || null,
  });
});

// --- Email Temp State ---
let emailSession = null; // { address, sid, auth, emailTimestamp }

app.post('/api/email/init', async (req, res) => {
  try {
    const email = new TempEmail();

    if (emailSession) {
      email.restoreSession(
        emailSession.address,
        emailSession.sid,
        emailSession.auth
      );
    } else {
      await email.createAccount();
      email.logger(`Email creado: ${email.address}`);
    }

    emailSession = {
      address: email.address,
      sid: email.sid,
      auth: email.auth,
      emailTimestamp: email.emailTimestamp,
    };

    res.json({ address: email.address, restored: !!emailSession });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/email/inbox', async (req, res) => {
  try {
    if (!emailSession) {
      return res.status(400).json({ error: 'No hay sesión de email activa. Inicia primero.' });
    }
    const email = new TempEmail();
    email.restoreSession(emailSession.address, emailSession.sid, emailSession.auth);
    const data = await email.getMessages();
    const messages = (data['hydra:member'] || []).map((msg) => ({
      id: msg.id,
      from: msg.from,
      subject: msg.subject,
      intro: msg.intro,
      createdAt: msg.createdAt,
    }));
    res.json({ messages, total: data['hydra:totalItems'] || messages.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/email/read/:id', async (req, res) => {
  try {
    if (!emailSession) {
      return res.status(400).json({ error: 'No hay sesión de email activa.' });
    }
    const email = new TempEmail();
    email.restoreSession(emailSession.address, emailSession.sid, emailSession.auth);
    const msg = await email.getMessage(req.params.id);
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/email/delete/:id', async (req, res) => {
  try {
    if (!emailSession) {
      return res.status(400).json({ error: 'No hay sesión de email activa.' });
    }
    const email = new TempEmail();
    email.restoreSession(emailSession.address, emailSession.sid, emailSession.auth);
    await email._apiCall('del_email', { sid: email.sid, email_ids: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/email/delete-account', async (req, res) => {
  try {
    if (!emailSession) {
      return res.status(400).json({ error: 'No hay sesión de email activa.' });
    }
    const email = new TempEmail();
    email.restoreSession(emailSession.address, emailSession.sid, emailSession.auth);
    await email.deleteAccount();
    emailSession = null;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
