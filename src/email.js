const API_BASE = 'https://tempmailc.com/api/v1';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_TIME_MS = 120000;

class TempEmail {
  constructor(logger) {
    this.logger = logger || ((msg) => console.log(`[email] ${msg}`));
    this.address = null;
  }

  async _fetch(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'API error');
    return data;
  }

  async createAccount() {
    const data = await this._fetch(`${API_BASE}/new`);
    this.address = data.email;
    this.logger(`Email temporal: ${this.address}`);
    return this.address;
  }

  async getMessages() {
    if (!this.address) throw new Error('No email address');
    const data = await this._fetch(`${API_BASE}/inbox?email=${encodeURIComponent(this.address)}`);
    const messages = (data.messages || []).map((msg) => ({
      id: String(msg.id),
      from: msg.from || '',
      subject: msg.subject || '',
      intro: msg.intro || '',
      createdAt: msg.ts ? new Date((msg.ts || 0) * 1000).toISOString() : '',
    }));
    return {
      'hydra:member': messages,
      'hydra:totalItems': messages.length,
    };
  }

  async getMessage(messageId) {
    const data = await this._fetch(
      `${API_BASE}/message?email=${encodeURIComponent(this.address)}&msg_id=${messageId}`
    );
    return {
      id: String(messageId),
      from: data.from || '',
      subject: data.subject || '',
      html: [data.html || ''],
      text: [data.text || ''],
      createdAt: new Date().toISOString(),
    };
  }

  async waitForMessage(filterFn = () => true, timeoutMs = MAX_POLL_TIME_MS) {
    const startTime = Date.now();
    let delay = POLL_INTERVAL_MS;

    this.logger(`Esperando email... (timeout: ${timeoutMs / 1000}s)`);

    while (Date.now() - startTime < timeoutMs) {
      const data = await this._fetch(`${API_BASE}/inbox?email=${encodeURIComponent(this.address)}`);
      const messages = (data.messages || []).map((msg) => ({
        id: String(msg.id),
        from: msg.from,
        subject: msg.subject,
        intro: msg.intro || '',
        createdAt: msg.ts ? new Date((msg.ts || 0) * 1000).toISOString() : '',
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

  restoreSession(address) {
    if (!address) {
      throw new Error('Address is required to restore a session');
    }
    this.address = address;
    this.logger(`Sesión restaurada: ${this.address}`);
    return this.address;
  }

  async deleteMessage(messageId) {
    try {
      await fetch(
        `${API_BASE}/message?email=${encodeURIComponent(this.address)}&msg_id=${messageId}`,
        { method: 'DELETE' }
      );
    } catch (err) {
      this.logger(`Error al eliminar mensaje: ${err.message}`);
    }
  }

  async deleteAccount() {
    this.logger('Cuenta descartada (expirar automáticamente)');
  }
}

module.exports = { TempEmail };
