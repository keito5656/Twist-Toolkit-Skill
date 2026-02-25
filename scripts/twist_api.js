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
}

function request(method, apiPath, body = null, isAuthRequest = false) {
  const config = loadConfig();
  const token = config.token;

  if (!token && !isAuthRequest) {
    throw new Error('Authentication required. Please run "login" and "auth <code>" first.');
  }

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
          try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
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
          try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
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
        const authUrl = `https://twist.com/oauth/authorize?client_id=${config.client_id}&scope=${scopes}&response_type=code&state=${state}&redirect_uri=${encodeURIComponent(config.redirect_uri)}`;
        console.log('Opening browser...');
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${authUrl}"`);
        break;

      case 'logout':
        if (fs.existsSync(AUTH_PATH)) {
          fs.unlinkSync(AUTH_PATH);
          console.log('\x1b[32mLogged out successfully. Authentication file removed.\x1b[0m');
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
        console.log(JSON.stringify(await request('GET', '/workspaces/get'), null, 2));
        break;
      case 'users':
        console.log(JSON.stringify(await request('GET', `/workspace_users/get?id=${process.argv[3] || config.workspace_id}`), null, 2));
        break;
      case 'add_workspace_user':
        console.log(JSON.stringify(await request('POST', '/workspace_users/add', `id=${process.argv[3] || config.workspace_id}&email=${encodeURIComponent(process.argv[4])}`), null, 2));
        break;
      case 'get_user_by_email':
        console.log(JSON.stringify(await request('GET', `/users/get_by_email?email=${encodeURIComponent(process.argv[3])}`), null, 2));
        break;
      case 'get_user_info':
        console.log(JSON.stringify(await request('GET', `/workspace_users/get_info?id=${process.argv[3] || config.workspace_id}&user_id=${process.argv[4]}`), null, 2));
        break;
      case 'update_user':
        console.log(JSON.stringify(await request('POST', '/users/update', `name=${encodeURIComponent(process.argv[3])}`), null, 2));
        break;
      case 'channels':
        console.log(JSON.stringify(await request('GET', `/channels/get?workspace_id=${process.argv[3] || config.workspace_id}`), null, 2));
        break;
      case 'add_channel':
        console.log(JSON.stringify(await request('POST', '/channels/add', `workspace_id=${process.argv[3] || config.workspace_id}&name=${encodeURIComponent(process.argv[4])}`), null, 2));
        break;
      case 'update_channel':
        console.log(JSON.stringify(await request('POST', '/channels/update', `id=${process.argv[3]}&name=${encodeURIComponent(process.argv[4])}`), null, 2));
        break;
      case 'archive_channel':
        console.log(JSON.stringify(await request('POST', '/channels/archive', `id=${process.argv[3]}`), null, 2));
        break;
      case 'unarchive_channel':
        console.log(JSON.stringify(await request('POST', '/channels/unarchive', `id=${process.argv[3]}`), null, 2));
        break;
      case 'favorite_channel':
        console.log(JSON.stringify(await request('POST', '/channels/favorite', `id=${process.argv[3]}`), null, 2));
        break;
      case 'remove_channel':
        await request('POST', '/channels/remove', `id=${process.argv[3]}`);
        console.log('Channel removed.');
        break;
      case 'add_user_to_channel':
        console.log(JSON.stringify(await request('POST', '/channels/add_user', `id=${process.argv[3]}&user_id=${process.argv[4]}`), null, 2));
        break;
      case 'remove_user_from_channel':
        console.log(JSON.stringify(await request('POST', '/channels/remove_user', `id=${process.argv[3]}&user_id=${process.argv[4]}`), null, 2));
        break;
      case 'threads':
        console.log(JSON.stringify(await request('GET', `/threads/get?channel_id=${process.argv[3]}`), null, 2));
        break;
      case 'unread_threads':
        console.log(JSON.stringify(await request('GET', `/threads/get_unread?workspace_id=${process.argv[3] || config.workspace_id}`), null, 2));
        break;
      case 'add_thread':
        console.log(JSON.stringify(await request('POST', '/threads/add', `channel_id=${process.argv[3]}&title=${encodeURIComponent(process.argv[4])}&content=${encodeURIComponent(process.argv.slice(5).join(' '))}`), null, 2));
        break;
      case 'star_thread':
        await request('POST', '/threads/star', `id=${process.argv[3]}`);
        console.log('Starred.');
        break;
      case 'unstar_thread':
        await request('POST', '/threads/unstar', `id=${process.argv[3]}`);
        console.log('Unstarred.');
        break;
      case 'close_thread':
        console.log(JSON.stringify(await request('POST', '/threads/update', `id=${process.argv[3]}&closed=1`), null, 2));
        break;
      case 'reopen_thread':
        console.log(JSON.stringify(await request('POST', '/threads/update', `id=${process.argv[3]}&closed=0`), null, 2));
        break;
      case 'comments':
        console.log(JSON.stringify(await request('GET', `/comments/get?thread_id=${process.argv[3]}`), null, 2));
        break;
      case 'reply':
        console.log(JSON.stringify(await request('POST', '/comments/add', `thread_id=${process.argv[3]}&content=${encodeURIComponent(process.argv.slice(4).join(' '))}`), null, 2));
        break;
      case 'add_reaction':
        await request('POST', '/reactions/add', `comment_id=${process.argv[3]}&reaction=${encodeURIComponent(process.argv[4])}`);
        console.log('Reaction added.');
        break;
      case 'inbox':
        console.log(JSON.stringify(await request('GET', `/inbox/get?workspace_id=${process.argv[3] || config.workspace_id}`), null, 2));
        break;
      case 'get_inbox_count':
        console.log(JSON.stringify(await request('GET', `/inbox/get_count?workspace_id=${process.argv[3] || config.workspace_id}`), null, 2));
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
      case 'conversations':
        console.log(JSON.stringify(await request('GET', `/conversations/get?workspace_id=${process.argv[3] || config.workspace_id}`), null, 2));
        break;
      case 'get_or_create_conversation':
        const convWs = process.argv[3] || config.workspace_id;
        const userIds = process.argv[4];
        console.log(JSON.stringify(await request('POST', '/conversations/get_or_create', `workspace_id=${convWs}&user_ids=${encodeURIComponent(userIds)}`), null, 2));
        break;
      case 'archive_conversation':
        await request('POST', '/conversations/archive', `id=${process.argv[3]}`);
        console.log('Conversation archived.');
        break;
      case 'mute_conversation':
        await request('POST', '/conversations/mute', `id=${process.argv[3]}&minutes=${process.argv[4] || 60}`);
        console.log('Muted.');
        break;
      case 'add_message':
        console.log(JSON.stringify(await request('POST', '/conversation_messages/add', `conversation_id=${process.argv[3]}&content=${encodeURIComponent(process.argv.slice(4).join(' '))}`), null, 2));
        break;
      case 'messages':
        console.log(JSON.stringify(await request('GET', `/conversation_messages/get?conversation_id=${process.argv[3]}`), null, 2));
        break;
      case 'search':
        let searchWs = config.workspace_id;
        let query = "";
        if (process.argv[3] && !isNaN(process.argv[3])) {
          searchWs = process.argv[3];
          query = process.argv.slice(4).join(' ');
        } else {
          query = process.argv.slice(3).join(' ');
        }
        console.log(JSON.stringify(await request('GET', `/search?workspace_id=${searchWs}&query=${encodeURIComponent(query)}`), null, 2));
        break;
      case 'search_in_thread':
        console.log(JSON.stringify(await request('GET', `/search/thread?thread_id=${process.argv[3]}&query=${encodeURIComponent(process.argv.slice(4).join(' '))}`), null, 2));
        break;
      case 'upload_attachment':
        console.log(JSON.stringify(await uploadRequest(process.argv[4], process.argv[3]), null, 2));
        break;
      case 'notification_settings':
        const targetWsNotif = process.argv[3] || config.workspace_id;
        console.log(JSON.stringify(await request('GET', `/notifications_settings/get?workspace_id=${targetWsNotif}`), null, 2));
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
