const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const OUTPUT_DIR = 'captured_data';
const TEXTURES_DIR = path.join(OUTPUT_DIR, 'textures');
const SCRIPTS_DIR = path.join(OUTPUT_DIR, 'scripts');
const HTTP_LOG_FILE = path.join(OUTPUT_DIR, 'http_log.jsonl');
const WS_LOG_FILE = path.join(OUTPUT_DIR, 'websocket_log.jsonl');

// Ensure output directories exist
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(TEXTURES_DIR)) fs.mkdirSync(TEXTURES_DIR);
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR);

(async () => {
  // Check for headless mode argument
  const headless = process.argv.includes('--headless');

  console.log(`Starting parser (Headless: ${headless})...`);

  const browser = await chromium.launch({
    headless: headless, // User will run with headless: false to see the game
    args: ['--start-maximized'] // Start maximized for better experience
  });

  const context = await browser.newContext({
    viewport: null // Disable viewport locking for max window
  });
  const page = await context.newPage();

  // Create streams for logs
  const httpLogStream = fs.createWriteStream(HTTP_LOG_FILE, { flags: 'a' });
  const wsLogStream = fs.createWriteStream(WS_LOG_FILE, { flags: 'a' });

  // Helper to determine extension from content-type
  const getExtension = (response, type) => {
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('image/png')) return '.png';
    if (contentType.includes('image/jpeg')) return '.jpg';
    if (contentType.includes('image/webp')) return '.webp';
    if (contentType.includes('image/gif')) return '.gif';
    if (contentType.includes('javascript') || contentType.includes('application/x-javascript')) return '.js';

    // Fallback to URL extension or default
    const urlExt = path.extname(new URL(response.url()).pathname);
    if (urlExt) return urlExt;

    return type === 'image' ? '.png' : '.js';
  };

  // Helper to save files uniquely
  const saveFile = async (response, type, dir) => {
    try {
      const url = response.url();
      const buffer = await response.body();

      // Use hash of content to avoid duplicates
      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      const ext = getExtension(response, type);
      const filename = `${hash}${ext}`;
      const filepath = path.join(dir, filename);

      if (!fs.existsSync(filepath)) {
        fs.writeFileSync(filepath, buffer);
        console.log(`Saved ${type}: ${url} -> ${filename}`);
      }
    } catch (e) {
      console.error(`Failed to save ${type} from ${response.url()}:`, e.message);
    }
  };

  // Helper to append to log stream
  const logToStream = (stream, data) => {
    stream.write(JSON.stringify(data) + '\n');
  };

  // Intercept HTTP Responses
  page.on('response', async (response) => {
    const request = response.request();
    const type = request.resourceType();
    const url = response.url();

    // Log HTTP Traffic
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'HTTP_RESPONSE',
      method: request.method(),
      url: url,
      status: response.status(),
      headers: response.headers(),
      contentType: response.headers()['content-type']
    };
    logToStream(httpLogStream, logEntry);

    // Save Assets
    if (response.ok()) {
      if (type === 'image') {
        await saveFile(response, 'image', TEXTURES_DIR);
      } else if (type === 'script') {
        await saveFile(response, 'script', SCRIPTS_DIR);
      }
    }
  });

  page.on('request', async (request) => {
      const logEntry = {
          timestamp: new Date().toISOString(),
          type: 'HTTP_REQUEST',
          method: request.method(),
          url: request.url(),
          headers: request.headers(),
          postData: request.postData()
      };
      logToStream(httpLogStream, logEntry);
  });

  // Intercept WebSocket
  page.on('websocket', (ws) => {
    console.log(`WebSocket opened: ${ws.url()}`);

    ws.on('framesent', (event) => {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'WS_SENT',
        url: ws.url(),
        payload: event.payload
      };
      logToStream(wsLogStream, logEntry);
    });

    ws.on('framereceived', (event) => {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'WS_RECEIVED',
        url: ws.url(),
        payload: event.payload
      };
      logToStream(wsLogStream, logEntry);
    });
  });

  // Navigate to the game
  console.log('Navigating to https://skazka.mobi/ ...');
  await page.goto('https://skazka.mobi/');

  console.log('Ready! Please interact with the game browser window.');
  console.log('Close the browser window to stop the parser (or press Ctrl+C in terminal).');

  // Keep alive until browser is closed
  await page.waitForEvent('close', { timeout: 0 });

  await browser.close();
  httpLogStream.end();
  wsLogStream.end();
  console.log('Browser closed. Session ended.');
})();
