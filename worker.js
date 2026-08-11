const SESSION_TTL_DAYS = 30;
const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function randomHex(size = 16) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hashPassword(password) {
  const salt = randomHex(16);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return `${salt}:${bytesToHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash || '').split(':');
  if (!salt || !expected) return false;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  return bytesToHex(new Uint8Array(bits)) === expected;
}

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatar: user.avatar || '/icons/xiaoyugan.png',
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function validateCredentials({ username, email, password }, isRegister = false) {
  const cleanUsername = String(username || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  if (isRegister) {
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(cleanUsername)) {
      return '用户名只能包含字母、数字、下划线和中横线，长度 3-20 位';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return '邮箱格式不正确';
    }
  } else if (!cleanUsername) {
    return '请输入用户名或邮箱';
  }

  if (cleanPassword.length < 6) {
    return '密码长度不能少于 6 位';
  }

  return null;
}

async function getAuthUser(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1]);
  const now = new Date().toISOString();

  return env.DB.prepare(
    `SELECT users.id, users.username, users.email, users.avatar, users.created_at, users.updated_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  )
    .bind(tokenHash, now)
    .first();
}

function mergeByKey(existingItems, incomingItems, getKey) {
  const merged = new Map();

  for (const item of existingItems || []) {
    const key = getKey(item);
    if (key) merged.set(key, item);
  }

  for (const item of incomingItems || []) {
    const key = getKey(item);
    if (key) merged.set(key, item);
  }

  return [...merged.values()];
}

function mergeTokenGroups(existingGroups, incomingGroups) {
  const merged = new Map();

  for (const group of existingGroups || []) {
    if (group?.id) merged.set(group.id, group);
  }

  for (const group of incomingGroups || []) {
    if (!group?.id) continue;
    const existing = merged.get(group.id);
    merged.set(group.id, {
      ...existing,
      ...group,
      tokenIds: [...new Set([...(existing?.tokenIds || []), ...(group.tokenIds || [])])],
    });
  }

  return [...merged.values()];
}

function mergeSnapshots(existingSnapshot, incomingSnapshot) {
  const existing = existingSnapshot && typeof existingSnapshot === 'object' ? existingSnapshot : {};
  const incoming = incomingSnapshot && typeof incomingSnapshot === 'object' ? incomingSnapshot : {};

  return {
    version: Math.max(Number(existing.version) || 1, Number(incoming.version) || 1),
    updatedAt: new Date().toISOString(),
    tokens: mergeByKey(existing.tokens, incoming.tokens, (token) => token?.id),
    tokenGroups: mergeTokenGroups(existing.tokenGroups, incoming.tokenGroups),
    selectedTokenId: incoming.selectedTokenId || existing.selectedTokenId || '',
    indexedDbTokens: mergeByKey(
      existing.indexedDbTokens,
      incoming.indexedDbTokens,
      (item) => item?.key,
    ),
  };
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), userId, tokenHash, now.toISOString(), expiresAt)
    .run();

  return { token, expiresAt };
}

async function handleApiRequest(request, env, corsHeaders) {
  if (!env.DB) {
    return jsonResponse(
      {
        success: false,
        message: 'Cloudflare D1 数据库未绑定，请先在 Pages 项目中绑定 DB。',
      },
      500,
      corsHeaders
    );
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v1/, '');

  try {
    if (path === '/auth/register' && request.method === 'POST') {
      const body = (await readJson(request)) || {};
      const username = String(body.username || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const validationError = validateCredentials(
        { username, email, password },
        true
      );

      if (validationError) {
        return jsonResponse(
          { success: false, message: validationError },
          400,
          corsHeaders
        );
      }

      const existingUser = await env.DB.prepare(
        'SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)'
      )
        .bind(username, email)
        .first();

      if (existingUser) {
        return jsonResponse(
          { success: false, message: '用户名或邮箱已存在' },
          409,
          corsHeaders
        );
      }

      const now = new Date().toISOString();
      const user = {
        id: crypto.randomUUID(),
        username,
        email,
        avatar: '/icons/xiaoyugan.png',
        created_at: now,
        updated_at: now,
      };
      const passwordHash = await hashPassword(password);

      await env.DB.prepare(
        `INSERT INTO users (id, username, email, password_hash, avatar, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          user.id,
          user.username,
          user.email,
          passwordHash,
          user.avatar,
          user.created_at,
          user.updated_at
        )
        .run();

      return jsonResponse(
        {
          success: true,
          message: '注册成功，请登录',
          data: { user: publicUser(user) },
        },
        201,
        corsHeaders
      );
    }

    if (path === '/auth/login' && request.method === 'POST') {
      const body = (await readJson(request)) || {};
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const validationError = validateCredentials({ username, password });

      if (validationError) {
        return jsonResponse(
          { success: false, message: validationError },
          400,
          corsHeaders
        );
      }

      const user = await env.DB.prepare(
        'SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)'
      )
        .bind(username, username)
        .first();

      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return jsonResponse(
          { success: false, message: '用户名或密码错误' },
          401,
          corsHeaders
        );
      }

      const session = await createSession(env, user.id);

      return jsonResponse(
        {
          success: true,
          message: '登录成功',
          data: {
            token: session.token,
            expiresAt: session.expiresAt,
            user: publicUser(user),
          },
        },
        200,
        corsHeaders
      );
    }

    if (path === '/auth/user' && request.method === 'GET') {
      const user = await getAuthUser(request, env);
      if (!user) {
        return jsonResponse(
          { success: false, message: '登录已过期，请重新登录' },
          401,
          corsHeaders
        );
      }
      return jsonResponse(
        { success: true, data: { user: publicUser(user) } },
        200,
        corsHeaders
      );
    }

    if (path === '/auth/logout' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization') || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        const tokenHash = await sha256Hex(match[1]);
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
          .bind(tokenHash)
          .run();
      }
      return jsonResponse(
        { success: true, message: '已退出登录' },
        200,
        corsHeaders
      );
    }

    if (path === '/cloud/snapshot' && request.method === 'GET') {
      const user = await getAuthUser(request, env);
      if (!user) {
        return jsonResponse(
          { success: false, message: '请先登录' },
          401,
          corsHeaders
        );
      }

      const snapshot = await env.DB.prepare(
        'SELECT payload, updated_at FROM cloud_snapshots WHERE user_id = ?'
      )
        .bind(user.id)
        .first();

      return jsonResponse(
        {
          success: true,
          data: snapshot
            ? {
                snapshot: JSON.parse(snapshot.payload),
                updatedAt: snapshot.updated_at,
              }
            : { snapshot: null, updatedAt: null },
        },
        200,
        corsHeaders
      );
    }

    if (path === '/cloud/snapshot' && request.method === 'PUT') {
      const user = await getAuthUser(request, env);
      if (!user) {
        return jsonResponse(
          { success: false, message: '请先登录' },
          401,
          corsHeaders
        );
      }

      const body = (await readJson(request)) || {};
      const snapshot = body.snapshot;

      if (!snapshot || typeof snapshot !== 'object') {
        return jsonResponse(
          { success: false, message: '同步数据格式不正确' },
          400,
          corsHeaders
        );
      }

      // 服务端再次合并，避免两台设备同时基于旧快照上传时由后一次请求覆盖前一次新增的数据。
      const existing = await env.DB.prepare(
        'SELECT payload FROM cloud_snapshots WHERE user_id = ?'
      )
        .bind(user.id)
        .first();
      let existingSnapshot = null;
      try {
        existingSnapshot = existing?.payload ? JSON.parse(existing.payload) : null;
      } catch {
        existingSnapshot = null;
      }
      const mergedSnapshot = mergeSnapshots(existingSnapshot, snapshot);
      const payload = JSON.stringify(mergedSnapshot);
      const updatedAt = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO cloud_snapshots (user_id, payload, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`
      )
        .bind(user.id, payload, updatedAt)
        .run();

      return jsonResponse(
        {
          success: true,
          message: '云端数据已保存',
          data: {
            updatedAt,
            tokenCount: mergedSnapshot.tokens.length,
            binCount: mergedSnapshot.indexedDbTokens.length,
          },
        },
        200,
        corsHeaders
      );
    }

    return jsonResponse(
      { success: false, message: '接口不存在' },
      404,
      corsHeaders
    );
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        message: error.message || '服务器内部错误',
      },
      500,
      corsHeaders
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    };

    // Handle OPTIONS request
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname.startsWith('/api/v1/')) {
      return handleApiRequest(request, env, corsHeaders);
    }

    // Proxy configuration
    const proxies = [
      {
        prefix: '/api/weixin-long',
        target: 'https://long.open.weixin.qq.com',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN',
          'Accept': '*/*',
          'Referer': 'https://open.weixin.qq.com/'
        }
      },
      {
        prefix: '/api/weixin',
        target: 'https://open.weixin.qq.com',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Referer': 'https://open.weixin.qq.com/'
        }
      },
      {
        prefix: '/api/hortor',
        target: 'https://comb-platform.hortorgames.com',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 12; 23117RK66C Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36',
          'Accept': '*/*',
          'Host': 'comb-platform.hortorgames.com',
          'Connection': 'keep-alive',
          'Content-Type': 'text/plain; charset=utf-8',
          'Origin': 'https://open.weixin.qq.com',
          'Referer': 'https://open.weixin.qq.com/'
        }
      }
    ].sort((a, b) => b.prefix.length - a.prefix.length); // Sort by length descending to match longest prefix first

    // Find matching proxy
    const proxy = proxies.find(p => url.pathname.startsWith(p.prefix));

    if (proxy) {
      // Construct new URL
      const targetUrl = new URL(proxy.target);
      targetUrl.pathname = url.pathname.replace(proxy.prefix, '') || '/';
      targetUrl.search = url.search;

      // Prepare request headers
      const newHeaders = new Headers(request.headers);
      
      // Override headers based on proxy config
      Object.entries(proxy.headers).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      // Special handling for Host header (Cloudflare might override it, but good to set intention)
      if (proxy.headers.Host) {
        newHeaders.set('Host', proxy.headers.Host);
      }

      // Create new request
      const newRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'follow'
      });

      try {
        const response = await fetch(newRequest);
        
        // Re-create response to add CORS headers
        const newResponse = new Response(response.body, response);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          newResponse.headers.set(key, value);
        });
        
        return newResponse;
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // Serve static assets (Cloudflare Pages)
    // If env.ASSETS is available (e.g. in Cloudflare Pages Functions), use it to fetch static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // Default response for non-proxy paths
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
