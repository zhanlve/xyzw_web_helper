const API_BASE = "/api/v1";

function getAuthToken() {
  return localStorage.getItem("token");
}

async function cloudRequest(path, options = {}) {
  const token = getAuthToken();
  if (!token) {
    throw new Error("请先登录账户");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({
    success: false,
    message: "接口返回格式错误",
  }));

  if (!response.ok || !data.success) {
    throw new Error(data.message || "云端同步失败");
  }

  return data;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

export async function createCloudSnapshot(tokenStore, indexedDb) {
  let indexedDbTokens = [];

  if (tokenStore.isCloudTokenMode) {
    const buffers = tokenStore.getCloudArrayBuffers();
    indexedDbTokens = Object.entries(buffers).map(([key, data]) => ({
      key,
      data: arrayBufferToBase64(data),
    }));
  } else {
    const keys = await indexedDb.getAllKeys();

    for (const key of keys) {
      const data = await indexedDb.getArrayBuffer(key);
      if (data) {
        indexedDbTokens.push({
          key,
          data: arrayBufferToBase64(data),
        });
      }
    }
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tokens: tokenStore.exportTokens().tokens || [],
    tokenGroups: tokenStore.tokenGroups || [],
    selectedTokenId: tokenStore.selectedTokenId || "",
    indexedDbTokens,
  };
}

function mergeByKey(existingItems, incomingItems, getKey) {
  const merged = new Map();

  for (const item of existingItems || []) {
    const key = getKey(item);
    if (key) merged.set(key, item);
  }

  // 本次上传的数据优先，确保同一角色的 Token 刷新能同步到云端。
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

// 云端快照是用户全部角色的集合。上传本机新增角色时必须保留另一设备已有的数据。
export function mergeCloudSnapshots(existingSnapshot, incomingSnapshot) {
  const existing = parseSnapshot(existingSnapshot) || {
    tokens: [],
    tokenGroups: [],
    selectedTokenId: "",
    indexedDbTokens: [],
  };
  const incoming = parseSnapshot(incomingSnapshot) || {
    tokens: [],
    tokenGroups: [],
    selectedTokenId: "",
    indexedDbTokens: [],
  };

  return {
    version: Math.max(Number(existingSnapshot?.version) || 1, Number(incomingSnapshot?.version) || 1),
    updatedAt: new Date().toISOString(),
    tokens: mergeByKey(existing.tokens, incoming.tokens, (token) => token?.id),
    tokenGroups: mergeTokenGroups(existing.tokenGroups, incoming.tokenGroups),
    selectedTokenId: incoming.selectedTokenId || existing.selectedTokenId || "",
    indexedDbTokens: mergeByKey(
      existing.indexedDbTokens,
      incoming.indexedDbTokens,
      (item) => item?.key,
    ),
  };
}

function parseSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  const tokens = Array.isArray(snapshot.tokens) ? snapshot.tokens : [];
  const indexedDbTokens = Array.isArray(snapshot.indexedDbTokens)
    ? snapshot.indexedDbTokens
    : [];
  const buffers = {};

  for (const item of indexedDbTokens) {
    if (item?.key && item?.data) {
      buffers[item.key] = base64ToArrayBuffer(item.data);
    }
  }

  return {
    tokens,
    tokenGroups: Array.isArray(snapshot.tokenGroups)
      ? snapshot.tokenGroups
      : [],
    selectedTokenId: snapshot.selectedTokenId || "",
    indexedDbTokens,
    buffers,
    updatedAt: snapshot.updatedAt,
  };
}

export async function loadCloudSnapshotToMemory(snapshot, tokenStore) {
  const parsed = parseSnapshot(snapshot);

  if (!parsed) {
    return {
      success: false,
      message: "云端还没有保存过数据",
    };
  }

  tokenStore.setCloudTokenSession({
    tokens: parsed.tokens,
    groups: parsed.tokenGroups,
    selectedId: parsed.selectedTokenId,
    buffers: parsed.buffers,
  });

  return {
    success: true,
    tokenCount: parsed.tokens.length,
    binCount: parsed.indexedDbTokens.length,
    updatedAt: parsed.updatedAt,
  };
}

export async function applyCloudSnapshot(snapshot, tokenStore, indexedDb) {
  const parsed = parseSnapshot(snapshot);

  if (!parsed) {
    return {
      success: false,
      message: "云端还没有保存过数据",
    };
  }

  if (tokenStore.isCloudTokenMode) {
    tokenStore.exitCloudTokenMode();
  }

  const importResult = tokenStore.importTokens({ tokens: parsed.tokens });
  if (!importResult.success) {
    throw new Error(importResult.message || "Token 数据导入失败");
  }

  tokenStore.tokenGroups = parsed.tokenGroups;
  tokenStore.selectedTokenId = parsed.selectedTokenId;

  await indexedDb.clearAll();

  for (const item of parsed.indexedDbTokens) {
    if (item?.key && item?.data) {
      await indexedDb.storeArrayBuffer(
        item.key,
        base64ToArrayBuffer(item.data),
        { source: "cloud" }
      );
    }
  }

  return {
    success: true,
    tokenCount: parsed.tokens.length,
    binCount: parsed.indexedDbTokens.length,
    updatedAt: parsed.updatedAt,
  };
}

export async function uploadCloudSnapshot(tokenStore, indexedDb) {
  const localSnapshot = await createCloudSnapshot(tokenStore, indexedDb);
  const remote = await fetchCloudSnapshot();
  const snapshot = mergeCloudSnapshots(remote.snapshot, localSnapshot);
  const result = await cloudRequest("/cloud/snapshot", {
    method: "PUT",
    body: JSON.stringify({ snapshot }),
  });

  return {
    success: true,
    updatedAt: result.data?.updatedAt,
    tokenCount: snapshot.tokens.length,
    binCount: snapshot.indexedDbTokens.length,
  };
}

export async function fetchCloudSnapshot() {
  const result = await cloudRequest("/cloud/snapshot", {
    method: "GET",
  });

  return result.data;
}
