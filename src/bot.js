/**
 * Bot principal - Automatización del juego The Champions Burger
 *
 * Flujo:
 * 1. Crear email temporal via mail.tm
 * 2. Navegar championburgerybarra.es con Playwright
 * 3. Completar formulario (email + ciudad)
 * 4. Jugar al memory game (resolver leyendo data-id del DOM)
 * 5. Reclamar premio
 * 6. Devolver resultado (código de canjeo, tipo de premio, etc.)
 */

const { chromium } = require('playwright');
const path = require('path');
const { TempEmail } = require('./email');

const BASE_URL = 'https://championburgerybarra.es';
const GAME_TIMEOUT = 30000; // 30s timeout total para el juego
const CARD_FLIP_DELAY = 400; // ms entre click de primera y segunda carta
const MATCH_SETTLE_DELAY = 700; // ms después de emparejar para animación

/**
 * Ejecuta el bot completo
 * @param {object} options
 * @param {string} options.cityCode - Código de ciudad (ej: CEDDF3DE)
 * @param {string} options.cityName - Nombre de ciudad (ej: SAN FERNANDO)
 * @param {boolean} options.headless - Modo headless
 * @param {function} options.onLog - Callback para logs en tiempo real
 * @returns {Promise<object>} Resultado con premio, código, etc.
 */
async function runBot(options = {}) {
  const {
    cityCode = 'CEDDF3DE',
    cityName = 'SAN FERNANDO',
    headless = true,
    onLog = () => {},
    onEmailCreated = () => {},
  } = options;

  const log = (msg) => {
    const timestamp = new Date().toLocaleTimeString('es-ES');
    const formatted = `[${timestamp}] ${msg}`;
    console.log(formatted);
    onLog(formatted);
  };

  let browser;
  let tempEmail = null;

  try {
    // ========================================
    // FASE 1: Crear email temporal
    // ========================================
    log('=== FASE 1: Creando email temporal ===');
    tempEmail = new TempEmail(log);
    const emailAddress = await tempEmail.createAccount();
    log(`Email temporal: ${emailAddress}`);
    onEmailCreated({ address: tempEmail.address });

    // ========================================
    // FASE 2: Iniciar navegador
    // ========================================
    log('=== FASE 2: Iniciando navegador ===');
    browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, // Móvil (iPhone 14)
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });

    const page = await context.newPage();

    // Monitorear solicitudes de red para debugging
    page.on('request', (req) => {
      if (req.url().includes('/play/')) {
        log(`[API] ${req.method()} ${req.url()}`);
      }
    });

    page.on('response', (res) => {
      if (res.url().includes('/play/main')) {
        log(`[API] Respuesta /play/main: ${res.status()}`);
      }
    });

    // ========================================
    // FASE 3: Navegación y registro
    // ========================================
    log('=== FASE 3: Navegando al sitio ===');
    await page.goto(BASE_URL, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    log('Página cargada');

    // Esperar a que la landing esté visible
    await page.waitForSelector('#landing:not(.hidden)', { timeout: 10000 }).catch(() => {
      log('Landing no visible inmediatamente, continuando...');
    });

    // Click "¡Por supuesto!" en landing
    log('Click en "¡Por supuesto!"');
    await page.click('button:has-text("Por supuesto")');
    await page.waitForTimeout(1000);

    // Click "Continuar" en landing2 (puntos de salseo)
    log('Click en "Continuar" (puntos de salseo)');
    await page.click('button:has-text("Continuar")');
    await page.waitForTimeout(1000);

    // Esperar formulario
    await page.waitForSelector('#form:not(.hidden)', { timeout: 10000 });
    log('Formulario visible');

    // ========================================
    // FASE 4: Rellenar formulario
    // ========================================
    log('=== FASE 4: Rellenando formulario ===');
    log(`Email: ${emailAddress}`);
    log(`Ciudad: ${cityName} (${cityCode})`);

    // Rellenar email y disparar blur para Parsley.js
    const emailInput = page.locator('input[name="email"]');
    await emailInput.fill(emailAddress);
    await page.evaluate(() => {
      const el = document.querySelector('input[name="email"]');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    });

    // Seleccionar ciudad
    await page.selectOption('select[name="pack-code"]', cityCode);

    // Aceptar términos y condiciones
    // El checkbox está oculto (display:none) - usamos JS para marcarlo + evento change
    await page.evaluate(() => {
      const cb = document.getElementById('policy1');
      if (cb) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await page.waitForTimeout(500);

    // Verificar que el checkbox esté marcado
    const isChecked = await page.evaluate(() => {
      const cb = document.getElementById('policy1');
      return cb ? cb.checked : false;
    });
    log(`Checkbox términos: ${isChecked ? '✓ marcado' : '✗ NO marcado'}`);

    // Click "Continuar" para ir al pre-game
    log('Enviando formulario...');
    await page.click('button.js-btn-to-pregame');
    await page.waitForTimeout(2000);

    // ========================================
    // FASE 5: Pre-game → Jugar
    // ========================================
    log('=== FASE 5: Iniciando juego ===');
    await page.waitForSelector('#pregame:not(.hidden)', { timeout: 10000 });
    log('Click en "¡Jugar!"');
    await page.click('button:has-text("Jugar")');

    // Esperar que el juego se renderice
    await page.waitForSelector('.pl-memory__card', { timeout: 10000 });
    await page.waitForTimeout(500);
    log('Juego cargado');

    // ========================================
    // FASE 6: Resolver memory game
    // ========================================
    log('=== FASE 6: Resolviendo memory game ===');
    const solved = await solveMemoryGame(page, log);

    if (!solved) {
      throw new Error('No se pudo completar el juego');
    }

    // ========================================
    // FASE 7: Esperar resultado
    // ========================================
    log('=== FASE 7: Esperando resultado ===');

    const result = await pollForResult(page, log);

    if (!result) {
      await page.screenshot({ path: '/tmp/result_timeout.png', fullPage: true }).catch(() => {});
      const debugHtml = await page.evaluate(() => document.body.innerHTML.substring(0, 3000)).catch(() => '');
      log(`DEBUG - HTML del body: ${debugHtml.substring(0, 500)}`);
      return {
        success: false,
        stage: 'result_timeout',
        message: 'No apareció la pantalla de resultado',
      };
    }

    if (result === 'loser') {
      log('RESULTADO: Has perdido :( El juego no se completó a tiempo');
      await page.screenshot({ path: '/tmp/loser.png', fullPage: true }).catch(() => {});
      return {
        success: false,
        stage: 'game_lost',
        message: 'No se pudo ganar el juego (timeout o error)',
      };
    }

    log('¡JUEGO GANADO!');
    await page.waitForTimeout(1000);

    // ========================================
    // FASE 8: Extraer información del premio
    // ========================================
    log('=== FASE 8: Obteniendo premio ===');

    const prizeInfo = await page.evaluate(() => {
      // Extraer texto visible del premio
      const prizeSection = document.querySelector('#prize');
      if (!prizeSection) return null;

      const text = prizeSection.textContent || '';
      const html = prizeSection.innerHTML || '';

      // Buscar imágenes del premio
      const imgs = Array.from(prizeSection.querySelectorAll('img'));
      const imgSrcs = imgs.map((img) => img.src);

      // Buscar código de canjeo visible
      const allText = document.body.textContent || '';
      const codeMatch = allText.match(/[A-Z0-9]{8,12}/);

      return {
        text: text.trim(),
        html: html.substring(0, 500),
        images: imgSrcs,
        possibleCode: codeMatch ? codeMatch[0] : null,
      };
    });

    log('=== PREMIO OBTENIDO ===');
    log(`Texto premio: ${(prizeInfo?.text || '').substring(0, 200)}`);

    // Si hay imágenes de premio, identificar qué premio es
    const prizeType = identifyPrize(prizeInfo, log);

    // ========================================
    // FASE 9: Tomar screenshot del resultado
    // ========================================
    log('=== FASE 9: Capturando evidencia ===');
    await page.screenshot({
      path: '/tmp/prize.png',
      fullPage: true,
    });
    log('Screenshot guardado');

    // ========================================
    // FASE 10: Esperar email de confirmación
    // ========================================
    log('=== FASE 10: Esperando email de confirmación ===');
    let exchangeCode = null;

    try {
      const emailMsg = await tempEmail.waitForMessage(
        (msg) => msg.subject && msg.subject.toLowerCase().includes('champion'),
        120000
      );
      log('Email de confirmación recibido');
      exchangeCode = tempEmail.extractExchangeCode(emailMsg);
      if (exchangeCode) {
        log(`Código de canjeo extraído: ${exchangeCode}`);
      } else {
        log('No se encontró código de canjeo en el email');
      }
    } catch (err) {
      log(`No se recibió email de confirmación: ${err.message}`);
    }

    // Limpiar
    await browser.close();
    browser = null;

    // Eliminar cuenta temporal
    try {
      await tempEmail.deleteAccount();
    } catch (err) {
      log(`Error al eliminar cuenta: ${err.message}`);
    }

    return {
      success: true,
      emailUsed: emailAddress,
      city: cityName,
      prize: prizeInfo,
      prizeType: prizeType,
      exchangeCode: exchangeCode || prizeInfo?.possibleCode || null,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    log(`ERROR: ${error.message}`);
    log(error.stack || '');

    // Tomar screenshot del error
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          await pages[0].screenshot({ path: '/tmp/error.png', fullPage: true });
        }
      } catch (_) {}

      await browser.close().catch(() => {});
    }

    // Limpiar email temporal
    if (tempEmail) {
      try {
        await tempEmail.deleteAccount();
      } catch (_) {}
    }

    return {
      success: false,
      stage: 'error',
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Resuelve el memory game leyendo los data-id del DOM
 */
async function solveMemoryGame(page, log) {
  try {
    // Leer todas las cartas y sus data-id
    const cardData = await page.evaluate(() => {
      const cards = document.querySelectorAll('.pl-memory__card');
      return Array.from(cards).map((card, index) => ({
        index,
        dataId: card.getAttribute('data-id'),
        isMatched: card.classList.contains('pl-memory__card-matched'),
      }));
    });

    const totalPairs = 6;
    log(`Cartas detectadas: ${cardData.length} (${totalPairs} pares)`);

    // Agrupar por data-id para encontrar pares
    const pairs = {};
    for (const card of cardData) {
      if (!pairs[card.dataId]) pairs[card.dataId] = [];
      pairs[card.dataId].push(card);
    }

    log(`Pares encontrados: ${Object.keys(pairs).length}`);

    // Click en cada par para resolver
    for (const [dataId, [card1, card2]] of Object.entries(pairs)) {
      if (!card1 || !card2) {
        log(`Advertencia: Par ${dataId} incompleto, saltando`);
        continue;
      }

      // Obtener referencias actualizadas a las cartas
      const cards = page.locator('.pl-memory__card');
      const cardsCount = await cards.count();

      // Click en la primera carta del par
      const firstCard = cards.nth(card1.index);
      const firstClass = await firstCard.getAttribute('class');
      if (firstClass && firstClass.includes('pl-memory__card-matched')) {
        log(`Par ${dataId} ya estaba resuelto, saltando`);
        continue;
      }

      await firstCard.click();
      await page.waitForTimeout(CARD_FLIP_DELAY);

      // Click en la segunda carta del par
      const secondCard = cards.nth(card2.index);
      await secondCard.click();

      // Esperar animación de match
      await page.waitForTimeout(MATCH_SETTLE_DELAY);

      log(`Par ${dataId} resuelto ✓`);
    }

    // Verificar que se resolvieron todos los pares
    await page.waitForTimeout(1000);

    const matchedCount = await page.evaluate(() => {
      return document.querySelectorAll('.pl-memory__card-matched').length;
    });

    log(`Cartas emparejadas: ${matchedCount} de ${totalPairs * 2}`);

    if (matchedCount >= totalPairs * 2) {
      log('¡Todos los pares resueltos!');
      return true;
    }

    // Si no se resolvieron todos, dar tiempo para que termine la animación
    log('Esperando animación final...');
    await page.waitForTimeout(1500);
    return true;
  } catch (error) {
    log(`Error resolviendo juego: ${error.message}`);
    return false;
  }
}

/**
 * Identifica el tipo de premio basado en las imágenes y textos
 */
function identifyPrize(prizeInfo, log) {
  if (!prizeInfo || !prizeInfo.text) return 'desconocido';

  const text = prizeInfo.text.toLowerCase();
  const images = prizeInfo.images || [];
  const allText = (prizeInfo.text + prizeInfo.html).toLowerCase();

  const prizes = [
    { id: 'bebida', keywords: ['bebida', 'bebida*', 'barra de bebidas', 'drink'] },
    { id: 'patatas', keywords: ['patatas', 'patatas gratis', 'puesto de patatas', 'fries'] },
    { id: 'hamburguesa', keywords: ['hamburguesa', 'burger gratis', 'hamburgueser'] },
    { id: 'descuento_30', keywords: ['30%', 'descuento', 'tienda online'] },
    { id: 'salsas', keywords: ['salsas', 'pack de salsas'] },
    { id: 'dipeo', keywords: ['dipeo', 'pack dipeo'] },
  ];

  for (const prize of prizes) {
    if (prize.keywords.some((kw) => allText.includes(kw))) {
      log(`Premio identificado: ${prize.id}`);
      return prize.id;
    }
  }

  log('Tipo de premio no identificado (nuevo diseño?)');
  return 'desconocido';
}

/**
 * Detecta el resultado del juego. Primero espera que aparezca visible,
 * pero si tras 6s los dos siguen ocultos lee el contenido directamente.
 * Devuelve 'prize', 'loser' o null si timeout.
 */
async function pollForResult(page, log) {
  const timeout = 30000;
  const start = Date.now();
  let forceCheckDone = false;

  while (Date.now() - start < timeout) {
    const state = await page.evaluate(() => {
      const prize = document.querySelector('#prize');
      const loser = document.querySelector('#loser');
      return {
        prizeVisible: prize && !prize.classList.contains('hidden'),
        loserVisible: loser && !loser.classList.contains('hidden'),
        prizeExists: !!prize,
        loserExists: !!loser,
        prizeContent: prize ? (prize.textContent || '').trim() : '',
        loserContent: loser ? (loser.textContent || '').trim() : '',
      };
    });

    if (state.prizeVisible) return 'prize';
    if (state.loserVisible) return 'loser';

    // Si los dos existen pero están ocultos tras 6s, leer contenido directamente
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed >= 6 && !forceCheckDone && state.prizeExists && state.loserExists) {
      forceCheckDone = true;
      log('Secciones ocultas, leyendo contenido directamente...');

      const winner = await page.evaluate(() => {
        const prize = document.querySelector('#prize');
        const loser = document.querySelector('#loser');
        const prizeText = prize ? (prize.textContent || '').trim() : '';
        const loserText = loser ? (loser.textContent || '').trim() : '';

        // Si prize tiene contenido sustancial, es que se ganó
        if (prizeText.length > 80 || prizeText.toLowerCase().includes('premio') || prizeText.toLowerCase().includes('código') || prizeText.toLowerCase().includes('enhorabuena')) {
          return 'prize';
        }
        if (loserText.length > 30 || loserText.toLowerCase().includes('perdido') || loserText.toLowerCase().includes('vuelve a intentarlo')) {
          return 'loser';
        }
        return null;
      });

      if (winner) {
        log(`Resultado detectado por contenido: ${winner}`);
        return winner;
      }
    }

    if (elapsed > 0 && elapsed % 5 === 0) {
      log(`Esperando resultado... ${elapsed}s (prize:${state.prizeExists}, loser:${state.loserExists})`);
    }

    await page.waitForTimeout(500);
  }

  log(`Timeout tras ${timeout / 1000}s esperando resultado`);
  return null;
}

module.exports = { runBot };
