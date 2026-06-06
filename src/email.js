const API_BASE = 'https://api.guerrillamail.com/ajax.php';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_TIME_MS = 120000;

class TempEmail {
  constructor(logger) {
    this.logger = logger || ((msg) => console.log(`[email] ${msg}`));
    this.address = null;
    this.sid = null;
    this.auth = null;
    this.emailTimestamp = null;
    this._cookies = '';
  }

  async _apiCall(func, params = {}) {
    const url = new URL(API_BASE);
    url.searchParams.set('f', func);
    url.searchParams.set('ip', '127.0.0.1');
    url.searchParams.set('agent', 'Mozilla/5.0');
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }

    const headers = {};
    if (this._cookies) {
      headers['Cookie'] = this._cookies;
    }

    const res = await fetch(url.toString(), { headers });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this._cookies = setCookie.split(';')[0];
    }

    return res.json();
  }

  async createAccount() {
    const data = await this._apiCall('get_email_address');
    this.address = data.email_addr;
    this.sid = data.sid;
    this.auth = data.auth;
    this.emailTimestamp = data.email_timestamp;
    this.logger(`Email temporal: ${this.address}`);
    return this.address;
  }

  async getMessages() {
    const data = await this._apiCall('check_email', { sid: this.sid, seq: 0 });
    const messages = (data.list || []).map((msg) => ({
      id: String(msg.mail_id),
      from: msg.mail_from,
      subject: msg.mail_subject,
      intro: msg.mail_excerpt,
      createdAt: new Date((msg.mail_timestamp || 0) * 1000).toISOString(),
      mail_read: msg.mail_read,
    }));
    return {
      'hydra:member': messages,
      'hydra:totalItems': messages.length,
    };
  }

  async getMessage(messageId) {
    const data = await this._apiCall('fetch_email', {
      sid: this.sid,
      email_id: messageId,
    });
    return {
      id: String(data.mail_id),
      from: data.mail_from || '',
      subject: data.mail_subject || '',
      html: [data.mail_body || ''],
      text: [data.mail_body || ''],
      createdAt: new Date((data.mail_timestamp || 0) * 1000).toISOString(),
    };
  }

  async waitForMessage(filterFn = () => true, timeoutMs = MAX_POLL_TIME_MS) {
    const startTime = Date.now();
    let delay = POLL_INTERVAL_MS;

    this.logger(`Esperando email... (timeout: ${timeoutMs / 1000}s)`);

    while (Date.now() - startTime < timeoutMs) {
      const data = await this._apiCall('check_email', { sid: this.sid, seq: 0 });
      const messages = (data.list || []).map((msg) => ({
        id: String(msg.mail_id),
        from: msg.mail_from,
        subject: msg.mail_subject,
        intro: msg.mail_excerpt,
        createdAt: new Date((msg.mail_timestamp || 0) * 1000).toISOString(),
      }));

      const matchingMsg = messages.find(filterFn);
      if (matchingMsg) {
        this.logger(`Email recibido: "${matchingMsg.subject || '(sin asunto)'}"`);
        const fullMsg = await this.getMessage(matchingMsg.id);
        return fullMsg;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 10 === 0 && elapsed > 0) {
        this.logger(`Esperando email... ${elapsed}s transcurridos`);
      }

      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(15000, delay + 2000);
    }

    throw new Error(`Timeout esperando email (${timeoutMs / 1000}s)`);
  }

  extractExchangeCode(message) {
    const html = message.html && message.html.length > 0
      ? message.html.join('')
      : '';
    const text = message.text && message.text.length > 0
      ? message.text.join('')
      : '';

    const content = html || text;

    const patterns = [
      /código[:\s]*([A-Z0-9]{6,12})/i,
      /codigo[:\s]*([A-Z0-9]{6,12})/i,
      /código de canjeo[:\s]*([A-Z0-9]{6,12})/i,
      /exchange.code[:\s]*([A-Z0-9]{6,12})/i,
      /([A-Z0-9]{6,12})/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  restoreSession(address, sid, auth) {
    if (!address) {
      throw new Error('Address is required to restore a session');
    }
    this.address = address;
    this.sid = sid || null;
    this.auth = auth || null;
    this.logger(`Sesión restaurada: ${this.address}`);
    return this.address;
  }

  async deleteAccount() {
    try {
      if (this.sid) {
        await this._apiCall('forget_me', { sid: this.sid });
      }
      this.logger('Cuenta temporal eliminada');
    } catch (err) {
      this.logger(`Error al eliminar cuenta: ${err.message}`);
    }
  }
}

module.exports = { TempEmail };
