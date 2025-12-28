const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const OUTPUT_DIR = 'captured_data';
const TEXTURES_DIR = path.join(OUTPUT_DIR, 'textures');
const SCRIPTS_DIR = path.join(OUTPUT_DIR, 'scripts');
const SNAPSHOTS_DIR = path.join(OUTPUT_DIR, 'snapshots');
const HTTP_LOG_FILE = path.join(OUTPUT_DIR, 'http_log.jsonl');
const WS_LOG_FILE = path.join(OUTPUT_DIR, 'websocket_log.jsonl');
const ASSETS_MAP_FILE = path.join(OUTPUT_DIR, 'assets_map.json');

// Ensure output directories exist
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(TEXTURES_DIR)) fs.mkdirSync(TEXTURES_DIR);
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR);
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR);

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

  // Asset Map: Original URL -> Local Filename
  const assetMap = {};

  // Create streams for logs
  const httpLogStream = fs.createWriteStream(HTTP_LOG_FILE, { flags: 'a' });
  const wsLogStream = fs.createWriteStream(WS_LOG_FILE, { flags: 'a' });

  // Expose function to save snapshots from browser
  await page.exposeFunction('saveSnapshot', (jsonString) => {
    try {
      const timestamp = Date.now();
      const hash = crypto.createHash('md5').update(jsonString).digest('hex').substring(0, 8);
      const filename = `snapshot_${timestamp}_${hash}.json`;
      const filepath = path.join(SNAPSHOTS_DIR, filename);

      fs.writeFileSync(filepath, jsonString);
      console.log(`Saved Snapshot: ${filename}`);
    } catch (e) {
      console.error('Failed to save snapshot:', e);
    }
  });

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

      // Update Asset Map
      assetMap[url] = filename;

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

  // Inject Snapshot Logic
  await page.addInitScript(() => {
    // Utility to get relevant styles
    const getComputedStyles = (el) => {
      const s = window.getComputedStyle(el);
      if (!s) return {};

      return {
        // Layout
        display: s.display,
        position: s.position,
        top: s.top,
        left: s.left,
        right: s.right,
        bottom: s.bottom,
        width: s.width,
        height: s.height,
        marginTop: s.marginTop,
        marginRight: s.marginRight,
        marginBottom: s.marginBottom,
        marginLeft: s.marginLeft,
        paddingTop: s.paddingTop,
        paddingRight: s.paddingRight,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,

        // Flexbox
        flexDirection: s.flexDirection,
        flexWrap: s.flexWrap,
        justifyContent: s.justifyContent,
        alignItems: s.alignItems,
        alignContent: s.alignContent,
        flexGrow: s.flexGrow,
        flexShrink: s.flexShrink,

        // Visuals
        backgroundColor: s.backgroundColor,
        backgroundImage: s.backgroundImage,
        opacity: s.opacity,
        visibility: s.visibility,
        zIndex: s.zIndex,

        // Borders
        borderWidth: s.borderWidth,
        borderColor: s.borderColor,
        borderStyle: s.borderStyle,
        borderRadius: s.borderRadius,

        // Typography
        color: s.color,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        textAlign: s.textAlign,
        whiteSpace: s.whiteSpace
      };
    };

    const traverse = (el) => {
      // Ignore script and hidden/system tags usually
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'LINK', 'META', 'HEAD', 'TITLE'].includes(el.tagName)) return null;

      // Simple visibility check (optimization)
      const style = window.getComputedStyle(el);
      if (style.display === 'none') return null;

      const node = {
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        textContent: el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.textContent.trim() : null,
        attributes: {},
        styles: getComputedStyles(el),
        children: []
      };

      // Attributes (src, etc)
      for (const attr of el.attributes) {
        node.attributes[attr.name] = attr.value;
      }

      for (const child of el.children) {
        const childNode = traverse(child);
        if (childNode) {
          node.children.push(childNode);
        }
      }
      return node;
    };

    let lastHash = '';

    // Simple string hash
    const simpleHash = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return hash;
    };

    // Check loop
    setInterval(async () => {
      if (!document.body) return;

      const tree = traverse(document.body);
      if (!tree) return;

      const jsonString = JSON.stringify(tree);
      const currentHash = simpleHash(jsonString).toString();

      if (currentHash !== lastHash) {
        lastHash = currentHash;
        await window.saveSnapshot(jsonString);
      }
    }, 2000); // Check every 2 seconds
  });

  // Navigate to the game
  console.log('Navigating to https://skazka.mobi/ ...');
  await page.goto('https://skazka.mobi/', { timeout: 0 });

  console.log('Ready! Please interact with the game browser window.');
  console.log('Close the browser window to stop the parser (or press Ctrl+C in terminal).');

  // Keep alive until browser is closed
  await page.waitForEvent('close', { timeout: 0 });

  // Save Asset Map on exit
  fs.writeFileSync(ASSETS_MAP_FILE, JSON.stringify(assetMap, null, 2));
  console.log('Saved assets map.');

  await browser.close();
  httpLogStream.end();
  wsLogStream.end();
  console.log('Browser closed. Session ended.');
})();
