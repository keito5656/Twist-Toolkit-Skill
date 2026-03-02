// twist_api.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Robust path resolution: Find root based on script location
const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const AUTH_FILE_NAME = '.twist_toolkit_auth.json';
const AUTH_PATH = path.join(PROJECT_ROOT, AUTH_FILE_NAME);
const CACHE_FILE_NAME = '.twist_cache.json';
const CACHE_PATH = path.join(PROJECT_ROOT, CACHE_FILE_NAME);

const DEFAULT_CLIENT_ID = '75986781489b9a94891f7a510622bd38efd3';
const DEFAULT_CLIENT_SECRET = '75980aefb8cab11453be255a5df06b1805e2';
const DEFAULT_REDIRECT_URI = 'https://twist-toolkit.web.app';

function loadConfig() {
  let config = {};
  if (fs.existsSync(AUTH_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    } catch (e) {
      config = {};
    }
  }
  if (!config.client_id) config.client_id = DEFAULT_CLIENT_ID;
  if (!config.client_secret) config.client_secret = DEFAULT_CLIENT_SECRET;
  if (!config.redirect_uri) config.redirect_uri = DEFAULT_REDIRECT_URI;
  return config;
}

function saveConfig(config) {
  fs.writeFileSync(AUTH_PATH, JSON.stringify(config, null, 2));
  ensureGitIgnore();
}

function ensureGitIgnore() {
  const gitIgnorePath = path.join(PROJECT_ROOT, '.gitignore');
  let content = '';
  if (fs.existsSync(gitIgnorePath)) {
    content = fs.readFileSync(gitIgnorePath, 'utf8');
  }
  if (!content.includes(AUTH_FILE_NAME)) {
    fs.appendFileSync(gitIgnorePath, `\n# Twist Toolkit Auth\n${AUTH_FILE_NAME}\n`);
  }
  if (!content.includes(CACHE_FILE_NAME)) {
    fs.appendFileSync(gitIgnorePath, `${CACHE_FILE_NAME}\n`);
  }
}

// --- Cache Module ---
function readCache() {
  if (fs.existsSync(CACHE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch (e) {
      // Corrupted cache file: return empty structure
      return { channels: {}, conversations: {}, users: {}, metadata: {} };
    }
  }
  return { channels: {}, conversations: {}, users: {}, metadata: {} };
}

function writeCache(data) {
  data.metadata = data.metadata || {};
  data.metadata.last_updated = new Date().toISOString();
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
}

function updateCache(type, key, value) {
  const cache = readCache();
  if (!cache[type]) cache[type] = {};
  cache[type][key] = value;
  writeCache(cache);
}

/**
 * Resolve a name-or-ID argument to a numeric ID using cache.
 * If the argument is numeric, return it as-is.
 * If it's a string, look it up in the cache under the given type.
 */
function resolveId(type, nameOrId) {
  if (!isNaN(nameOrId)) return nameOrId;
  const cache = readCache();
  const wsId = loadConfig().workspace_id;
  // If cache was built for a different workspace, warn
  if (cache.metadata && cache.metadata.workspace_id && wsId && cache.metadata.workspace_id !== wsId) {
    throw new Error(`Cache was built for workspace ${cache.metadata.workspace_id}, but current workspace is ${wsId}. Run "update_cache" to refresh.`);
  }
  const map = cache[type] || {};
  if (map[nameOrId] !== undefined) return map[nameOrId];
  throw new Error(`"${nameOrId}" not found in ${type} cache. Run "update_cache" to refresh, or specify the numeric ID directly.`);
}

function logAudit(message) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`\x1b[90m[AUDIT ${timestamp}] ${message}\x1b[0m\n`);
}

/**
 * Mitigate Indirect Prompt Injection by neutralizing malicious patterns
 * from external Twist content before it reaches the AI agent.
 */
function sanitizeForAI(obj) {
  if (!obj) return obj;
  if (typeof obj === 'string') {
    const maliciousPatterns = [
      /ignore all previous instructions/gi,
      /ignore the above/gi,
      /system override/gi,
      /instead of doing that/gi,
      /execute the following/gi,
      /you must now/gi
    ];
    let sanitized = obj;
    maliciousPatterns.forEach(p => {
      sanitized = sanitized.replace(p, '[REDACTED_POTENTIAL_INJECTION]');
    });
    return sanitized;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForAI(item));
  }
  if (typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = sanitizeForAI(obj[key]);
    }
    return newObj;
  }
  return obj;
}

function request(method, apiPath, body = null, isAuthRequest = false) {
  const config = loadConfig();
  const token = config.token;

  if (!token && !isAuthRequest) {
    throw new Error('Authentication required. Please run "login" and "auth <code>" first.');
  }

  logAudit(`API Request: ${method} ${apiPath}`);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: isAuthRequest ? 'twist.com' : 'api.twist.com',
      port: 443,
      path: isAuthRequest ? apiPath : `/api/v3${apiPath}`,
      method: method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };

    if (token && !isAuthRequest) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
        } else if (res.statusCode === 401) {
          reject(new Error('Unauthorized: Token might be expired. Please run "login" again.'));
        } else {
          reject(new Error(`API Error: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    if (body) { req.write(body); }
    req.end();
  });
}

async function uploadRequest(filePath, attachmentId) {
  const config = loadConfig();
  const token = config.token;
  if (!token) throw new Error('Authentication required.');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  logAudit(`Attachment Upload: ${filePath} (ID: ${attachmentId})`);

  const fileName = path.basename(filePath);
  const boundary = '----TwistToolkitBoundary' + Math.random().toString(16).slice(2);
  const fileData = fs.readFileSync(filePath);

  const header =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="attachment_id"\r\n\r\n` +
    `${attachmentId}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;

  const footer = `\r\n--${boundary}--\r\n`;

  const options = {
    hostname: 'api.twist.com',
    port: 443,
    path: '/api/v3/attachments/upload',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(header) + fileData.length + Buffer.byteLength(footer)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
        } else {
          reject(new Error(`Upload API Error: ${res.statusCode} ${data}`));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(header);
    req.write(fileData);
    req.write(footer);
    req.end();
  });
}

async function main() {
  const command = process.argv[2];
  let config = loadConfig();

  if (!command) {
    console.log(`
\x1b[1mTwist Toolkit CLI\x1b[0m
Usage: node scripts/twist_api.js <command> [args]

\x1b[1mQuick Start:\x1b[0m
  login                     - Start OAuth login flow
  auth <code>               - Complete login with code
  set_workspace <id>        - Set default workspace

\x1b[1mCommon Commands:\x1b[0m
  inbox                     - View current inbox
  search "<query>"          - Search workspace
  threads <channel_id>      - List threads in a channel
  reply <thread_id> "<msg>" - Reply to a thread
  complete_thread <id>      - Archive thread (complete task)

See \x1b[36mSKILL.md\x1b[0m for the full list of 35+ commands.`);
    return;
  }

  logAudit(`Executing command: ${command}`);

  try {
    switch (command) {
      case 'setup':
        const setupId = process.argv[3] || DEFAULT_CLIENT_ID;
        const setupSecret = process.argv[4] || DEFAULT_CLIENT_SECRET;
        const setupUri = process.argv[5] || DEFAULT_REDIRECT_URI;
        config = { ...config, client_id: setupId, client_secret: setupSecret, redirect_uri: setupUri };
        saveConfig(config);
        console.log(`Setup completed. Auth saved to: ${AUTH_PATH}`);
        break;

      case 'login':
        console.log(`
\x1b[33m[PRE-REQUISITE]\x1b[0m
If you haven't already, please install the integration to your workspace first:
\x1b[36mhttps://twist.com/integrations/install/7598_fede8f25e6ac33e8b89557aa\x1b[0m
`);
        const state = Math.random().toString(36).substring(7);
        const scopes = [
          'workspaces:read', 'workspaces:write', 'channels:read', 'channels:write', 'channels:remove',
          'threads:read', 'threads:write', 'threads:remove',
          'comments:read', 'comments:write', 'comments:remove',
          'messages:read', 'messages:write', 'messages:remove',
          'reactions:read', 'reactions:write', 'reactions:remove',
          'groups:read', 'groups:write', 'groups:remove',
          'attachments:read', 'attachments:write', 'notifications:read', 'search:read',
          'user:read', 'user:write'
        ].join(',');
        const authUrl = `https://twist.com/oauth/authorize?client_id=${config.client_id}&scope=${scopes}&response_type=code&state=${state}&redirect_uri=${encodeURIComponent(config.redirect_uri)}&prompt=login`;
        console.log(`\x1b[33m[TIP]\x1b[0m If switching accounts, sign out of Twist in your browser first: \x1b[36mhttps://twist.com/logout\x1b[0m`);
        console.log('Opening browser...');
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${authUrl}"`);
        break;

      case 'logout':
        if (fs.existsSync(AUTH_PATH)) {
          fs.unlinkSync(AUTH_PATH);
          console.log('\x1b[32mLogged out successfully. Authentication file removed.\x1b[0m');
          console.log('\x1b[33m[TIP]\x1b[0m To switch accounts, also sign out in your browser: \x1b[36mhttps://twist.com/logout\x1b[0m');
        } else {
          console.log('No authentication file found. You are already logged out.');
        }
        break;

      case 'auth':
        const authBody = `client_id=${config.client_id}&client_secret=${config.client_secret}&code=${process.argv[3]}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(config.redirect_uri)}`;
        const authRes = await request('POST', '/oauth/access_token', authBody, true);
        saveConfig({ ...config, token: authRes.access_token });
        console.log('Authenticated! Default workspace is recommended.');
        break;

      case 'set_workspace':
        saveConfig({ ...config, workspace_id: process.argv[3] });
        console.log(`Default workspace: ${process.argv[3]}`);
        break;

      case 'workspaces':
        console.log(JSON.stringify(sanitizeForAI(await request('GET', '/workspaces/get')), null, 2));
        break;
      case 'users': {
        const usersData = sanitizeForAI(await request('GET', `/workspace_users/get?id=${process.argv[3] || config.workspace_id}`));
        // Auto-cache: name -> id
        if (Array.isArray(usersData)) {
          const cache = readCache();
          cache.users = {};
          usersData.forEach(u => { if (u.name && u.id) cache.users[u.name] = u.id; });
          cache.metadata = cache.metadata || {};
          cache.metadata.workspace_id = process.argv[3] || config.workspace_id;
          writeCache(cache);
        }
        console.log(JSON.stringify(usersData, null, 2));
        break;
      }
      case 'add_workspace_user':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/workspace_users/add', `id=${process.argv[3] || config.workspace_id}&email=${encodeURIComponent(process.argv[4])}`)), null, 2));
        break;
      case 'get_user_by_email':
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/users/get_by_email?email=${encodeURIComponent(process.argv[3])}`)), null, 2));
        break;
      case 'get_user_info':
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/workspace_users/get_info?id=${process.argv[3] || config.workspace_id}&user_id=${process.argv[4]}`)), null, 2));
        break;
      case 'update_user':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/users/update', `name=${encodeURIComponent(process.argv[3])}`)), null, 2));
        break;
      case 'channels': {
        const chData = sanitizeForAI(await request('GET', `/channels/get?workspace_id=${process.argv[3] || config.workspace_id}`));
        // Auto-cache: name -> id
        if (Array.isArray(chData)) {
          const cache = readCache();
          cache.channels = {};
          chData.forEach(ch => { if (ch.name && ch.id) cache.channels[ch.name] = ch.id; });
          cache.metadata = cache.metadata || {};
          cache.metadata.workspace_id = process.argv[3] || config.workspace_id;
          writeCache(cache);
        }
        console.log(JSON.stringify(chData, null, 2));
        break;
      }
      case 'add_channel':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/channels/add', `workspace_id=${process.argv[3] || config.workspace_id}&name=${encodeURIComponent(process.argv[4])}`)), null, 2));
        break;
      case 'update_channel':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/channels/update', `id=${process.argv[3]}&name=${encodeURIComponent(process.argv[4])}`)), null, 2));
        break;
      case 'archive_channel':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/channels/archive', `id=${process.argv[3]}`)), null, 2));
        break;
      case 'unarchive_channel':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/channels/unarchive', `id=${process.argv[3]}`)), null, 2));
        break;
      case 'favorite_channel':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/channels/favorite', `id=${process.argv[3]}`)), null, 2));
        break;
      case 'remove_channel':
        await request('POST', '/channels/remove', `id=${process.argv[3]}`);
        console.log('Channel removed.');
        break;
      case 'add_user_to_channel':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/channels/add_user', `id=${process.argv[3]}&user_id=${process.argv[4]}`)), null, 2));
        break;
      case 'remove_user_from_channel':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/channels/remove_user', `id=${process.argv[3]}&user_id=${process.argv[4]}`)), null, 2));
        break;
      case 'threads': {
        const thChId = resolveId('channels', process.argv[3]);
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/threads/get?channel_id=${thChId}`)), null, 2));
        break;
      }
      case 'unread_threads':
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/threads/get_unread?workspace_id=${process.argv[3] || config.workspace_id}`)), null, 2));
        break;
      case 'add_thread': {
        const atChId = resolveId('channels', process.argv[3]);
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/threads/add', `channel_id=${atChId}&title=${encodeURIComponent(process.argv[4])}&content=${encodeURIComponent(process.argv.slice(5).join(' '))}`)), null, 2));
        break;
      }
      case 'star_thread':
        await request('POST', '/threads/star', `id=${process.argv[3]}`);
        console.log('Starred.');
        break;
      case 'unstar_thread':
        await request('POST', '/threads/unstar', `id=${process.argv[3]}`);
        console.log('Unstarred.');
        break;
      case 'close_thread':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/threads/update', `id=${process.argv[3]}&closed=1`)), null, 2));
        break;
      case 'reopen_thread':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/threads/update', `id=${process.argv[3]}&closed=0`)), null, 2));
        break;
      case 'comments':
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/comments/get?thread_id=${process.argv[3]}`)), null, 2));
        break;
      case 'reply':
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/comments/add', `thread_id=${process.argv[3]}&content=${encodeURIComponent(process.argv.slice(4).join(' '))}`)), null, 2));
        break;
      case 'add_reaction':
        await request('POST', '/reactions/add', `comment_id=${process.argv[3]}&reaction=${encodeURIComponent(process.argv[4])}`);
        console.log('Reaction added.');
        break;
      case 'inbox':
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/inbox/get?workspace_id=${process.argv[3] || config.workspace_id}`)), null, 2));
        break;
      case 'get_inbox_count':
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/inbox/get_count?workspace_id=${process.argv[3] || config.workspace_id}`)), null, 2));
        break;
      case 'complete_thread':
      case 'archive_thread':
        await request('POST', '/inbox/archive', `id=${process.argv[3]}`);
        console.log('Archived (completed).');
        break;
      case 'unarchive_inbox_thread':
        await request('POST', '/inbox/unarchive', `id=${process.argv[3]}`);
        console.log('Unarchived.');
        break;
      case 'archive_all_inbox':
        await request('POST', '/inbox/archive_all', `workspace_id=${process.argv[3] || config.workspace_id}`);
        console.log('All archived.');
        break;
      case 'mark_all_inbox_read':
        await request('POST', '/inbox/mark_all_read', `workspace_id=${process.argv[3] || config.workspace_id}`);
        console.log('All marked as read.');
        break;
      case 'conversations': {
        const convData = sanitizeForAI(await request('GET', `/conversations/get?workspace_id=${process.argv[3] || config.workspace_id}`));
        // Auto-cache: title/participants -> id
        if (Array.isArray(convData)) {
          const cache = readCache();
          cache.conversations = {};
          convData.forEach(c => {
            let key = c.title || null;
            if (!key && Array.isArray(c.users) && c.users.length > 0) {
              key = c.users.map(u => u.name || u.short_name || `user_${u.id || u}`).join(', ');
            }
            if (!key) key = `conversation_${c.id}`;
            if (c.id) cache.conversations[key] = c.id;
          });
          cache.metadata = cache.metadata || {};
          cache.metadata.workspace_id = process.argv[3] || config.workspace_id;
          writeCache(cache);
        }
        console.log(JSON.stringify(convData, null, 2));
        break;
      }
      case 'get_or_create_conversation':
        const convWs = process.argv[3] || config.workspace_id;
        const userIds = process.argv[4];
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/conversations/get_or_create', `workspace_id=${convWs}&user_ids=${encodeURIComponent(userIds)}`)), null, 2));
        break;
      case 'archive_conversation':
        await request('POST', '/conversations/archive', `id=${process.argv[3]}`);
        console.log('Conversation archived.');
        break;
      case 'mute_conversation':
        await request('POST', '/conversations/mute', `id=${process.argv[3]}&minutes=${process.argv[4] || 60}`);
        console.log('Muted.');
        break;
      case 'add_message': {
        const amConvId = resolveId('conversations', process.argv[3]);
        console.log(JSON.stringify(sanitizeForAI(await request('POST', '/conversation_messages/add', `conversation_id=${amConvId}&content=${encodeURIComponent(process.argv.slice(4).join(' '))}`)), null, 2));
        break;
      }
      case 'messages': {
        const msgConvId = resolveId('conversations', process.argv[3]);
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/conversation_messages/get?conversation_id=${msgConvId}`)), null, 2));
        break;
      }
      case 'search':
        let searchWs = config.workspace_id;
        let query = "";
        if (process.argv[3] && !isNaN(process.argv[3])) {
          searchWs = process.argv[3];
          query = process.argv.slice(4).join(' ');
        } else {
          query = process.argv.slice(3).join(' ');
        }
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/search?workspace_id=${searchWs}&query=${encodeURIComponent(query)}`)), null, 2));
        break;
      case 'search_in_thread':
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/search/thread?thread_id=${process.argv[3]}&query=${encodeURIComponent(process.argv.slice(4).join(' '))}`)), null, 2));
        break;
      case 'upload_attachment':
        console.log(JSON.stringify(sanitizeForAI(await uploadRequest(process.argv[4], process.argv[3])), null, 2));
        break;
      case 'notification_settings':
        const targetWsNotif = process.argv[3] || config.workspace_id;
        console.log(JSON.stringify(sanitizeForAI(await request('GET', `/notifications_settings/get?workspace_id=${targetWsNotif}`)), null, 2));
        break;

      // --- Cache Management Commands ---
      case 'update_cache': {
        const ucWsId = process.argv[3] || config.workspace_id;
        if (!ucWsId) { console.error('Error: workspace_id is required. Run set_workspace first.'); break; }
        const cache = { channels: {}, conversations: {}, users: {}, metadata: { workspace_id: ucWsId } };
        // Fetch channels
        try {
          const chList = await request('GET', `/channels/get?workspace_id=${ucWsId}`);
          if (Array.isArray(chList)) chList.forEach(ch => { if (ch.name && ch.id) cache.channels[ch.name] = ch.id; });
        } catch (e) { console.error(`Warning: Failed to fetch channels: ${e.message}`); }
        // Fetch conversations
        try {
          const convList = await request('GET', `/conversations/get?workspace_id=${ucWsId}`);
          if (Array.isArray(convList)) convList.forEach(c => {
            let key = c.title || null;
            if (!key && Array.isArray(c.users) && c.users.length > 0) {
              key = c.users.map(u => u.name || u.short_name || `user_${u.id || u}`).join(', ');
            }
            if (!key) key = `conversation_${c.id}`;
            if (c.id) cache.conversations[key] = c.id;
          });
        } catch (e) { console.error(`Warning: Failed to fetch conversations: ${e.message}`); }
        // Fetch users
        try {
          const userList = await request('GET', `/workspace_users/get?id=${ucWsId}`);
          if (Array.isArray(userList)) userList.forEach(u => { if (u.name && u.id) cache.users[u.name] = u.id; });
        } catch (e) { console.error(`Warning: Failed to fetch users: ${e.message}`); }
        writeCache(cache);
        console.log(`Cache updated: ${Object.keys(cache.channels).length} channels, ${Object.keys(cache.conversations).length} conversations, ${Object.keys(cache.users).length} users.`);
        break;
      }
      case 'show_cache': {
        const cacheData = readCache();
        const cacheType = process.argv[3];
        if (cacheType && cacheData[cacheType]) {
          console.log(JSON.stringify(cacheData[cacheType], null, 2));
        } else if (cacheType) {
          console.log(`Unknown cache type: ${cacheType}. Available: channels, conversations, users, metadata`);
        } else {
          console.log(JSON.stringify(cacheData, null, 2));
        }
        break;
      }
      case 'clear_cache':
        if (fs.existsSync(CACHE_PATH)) {
          fs.unlinkSync(CACHE_PATH);
          console.log('Cache cleared.');
        } else {
          console.log('No cache file found.');
        }
        break;

      default:
        console.log(`Unknown command: ${command}. See SKILL.md.`);
    }
  } catch (error) {
    console.error('\x1b[31mError: %s\x1b[0m', error.message);
    process.exit(1);
  }
}

main();
