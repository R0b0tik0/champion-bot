/**
 * mail.tm - Servicio de email temporal
 * API: https://api.mail.tm (OpenAPI)
 *
 * Estrategia:
 * 1. Obtener dominio disponible
 * 2. Crear cuenta (email + password) → obtiene ID
 * 3. Obtener JWT token
 * 4. Polling de /messages hasta que llegue el email
 * 5. Leer mensaje completo
 */

const fetch = require('node-fetch');

const API_BASE = 'https://api.mail.tm';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_TIME_MS = 120000;

class TempEmail {
  constructor(logger) {
    this.logger = logger || ((msg) => console.log(`[email] ${msg}`));
    this.address = null;
    this.password = null;
    this.token = null;
    this.accountId = null;
  }

  /**
   * Dominio de fallback por si la API rate-limit o está caída
   * Confirmado funcionando: wshu.net
   */
  static FALLBACK_DOMAIN = 'wshu.net';

  /**
   * Obtiene los dominios disponibles en mail.tm
   * Reintenta hasta 3 veces con backoff ante rate limiting (8 QPS / IP)
   */
  async _fetchDomains() {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`${API_BASE}/domains`, {
          headers: { Accept: 'application/json' },
        });

        if (res.status === 429) {
          this.logger(`Rate limited (429), reintento ${attempt}/${maxRetries}...`);
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }

        if (!res.ok) {
          this.logger(`Error HTTP ${res.status} en domains, reintento ${attempt}/${maxRetries}...`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }

        const data = await res.json();
        const domains = data['hydra:member'] || [];
        if (domains.length > 0) {
          return domains;
        }

        this.logger(`API devolvió 0 dominios, reintento ${attempt}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      } catch (err) {
        this.logger(`Error de red: ${err.message}, reintento ${attempt}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    this.logger(`Usando dominio de fallback: ${TempEmail.FALLBACK_DOMAIN}`);
    return [{ domain: TempEmail.FALLBACK_DOMAIN }];
  }

  /**
   * Genera un email aleatorio en un dominio de mail.tm
   */
  async createAccount() {
    const domains = await this._fetchDomains();
    // Usar el primer dominio disponible (suele ser @cliptik.net o similar)
    const domain = domains[0].domain;
    const localPart = `champion_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.address = `${localPart}@${domain}`;
    this.password = 'Champion2025!';

    this.logger(`Creando cuenta temporal: ${this.address}`);

    const res = await fetch(`${API_BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: this.address,
        password: this.password,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error creating account (${res.status}): ${text}`);
    }

    const data = await res.json();
    this.accountId = data['@id'] || data.id;
    this.logger(`Cuenta creada: ${this.address} (ID: ${this.accountId})`);

    // Obtener token JWT
    await this._authenticate();
    return this.address;
  }

  /**
   * Autentica y obtiene JWT
   */
  async _authenticate() {
    this.logger('Obteniendo token JWT...');
    const res = await fetch(`${API_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: this.address,
        password: this.password,
      }),
    });

    if (!res.ok) {
      throw new Error(`Error getting token (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    this.token = data.token;
    this.logger('Token JWT obtenido correctamente');
  }

  /**
   * Obtiene la lista de mensajes en la bandeja de entrada
   */
  async getMessages() {
    if (!this.token) throw new Error('Not authenticated');

    const res = await fetch(`${API_BASE}/messages`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      // Si token expiró, reintentar autenticación
      if (res.status === 401) {
        this.logger('Token expirado, reautenticando...');
        await this._authenticate();
        return this.getMessages();
      }
      throw new Error(`Error fetching messages (${res.status})`);
    }

    return res.json();
  }

  /**
   * Obtiene un mensaje completo por ID
   */
  async getMessage(messageId) {
    if (!this.token) throw new Error('Not authenticated');

    const res = await fetch(`${API_BASE}/messages/${messageId}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) throw new Error(`Error fetching message (${res.status})`);
    return res.json();
  }

  /**
   * Espera a que llegue un email que coincida con el filtro
   * @param {Function} filterFn - (message) => boolean
   * @param {number} timeoutMs - tiempo máximo de espera
   * @returns {Promise<object>} mensaje completo
   */
  async waitForMessage(filterFn = () => true, timeoutMs = MAX_POLL_TIME_MS) {
    const startTime = Date.now();
    let delay = POLL_INTERVAL_MS;

    this.logger(`Esperando email... (timeout: ${timeoutMs / 1000}s)`);

    while (Date.now() - startTime < timeoutMs) {
      const data = await this.getMessages();
      const messages = data['hydra:member'] || [];

      const matchingMsg = messages.find(filterFn);
      if (matchingMsg) {
        this.logger(`Email recibido: "${matchingMsg.subject || '(sin asunto)'}"`);
        // Obtener mensaje completo
        const fullMsg = await this.getMessage(matchingMsg.id);
        return fullMsg;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 10 === 0 && elapsed > 0) {
        this.logger(`Esperando email... ${elapsed}s transcurridos`);
      }

      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(30000, delay * 1.5); // Backoff exponencial hasta 30s
    }

    throw new Error(`Timeout esperando email (${timeoutMs / 1000}s)`);
  }

  /**
   * Extrae el código de canjeo del texto del email
   * (depende del formato del email que envíe la promoción)
   */
  extractExchangeCode(message) {
    // Buscar en texto plano o HTML
    const html = message.html && message.html.length > 0
      ? message.html.join('')
      : '';
    const text = message.text && message.text.length > 0
      ? message.text.join('')
      : '';

    const content = html || text;

    // Patrones comunes de código de canjeo
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

  /**
   * Restaura una sesión existente con credenciales guardadas
   */
  restoreSession(address, password, accountId, token) {
    if (!address || !password) {
      throw new Error('Address and password are required to restore a session');
    }
    this.address = address;
    this.password = password;
    this.accountId = accountId || null;
    this.token = token || null;
    this.logger(`Sesión restaurada: ${this.address}`);
    return this.address;
  }

  /**
   * Elimina la cuenta temporal
   */
  async deleteAccount() {
    if (!this.token || !this.accountId) return;
    try {
      await fetch(`${API_BASE}${this.accountId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      this.logger('Cuenta temporal eliminada');
    } catch (err) {
      this.logger(`Error al eliminar cuenta: ${err.message}`);
    }
  }
}

module.exports = { TempEmail };
