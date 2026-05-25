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
  const keys = await indexedDb.getAllKeys();
  const indexedDbTokens = [];

  for (const key of keys) {
    const data = await indexedDb.getArrayBuffer(key);
    if (data) {
      indexedDbTokens.push({
        key,
        data: arrayBufferToBase64(data),
      });
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

export async function uploadCloudSnapshot(tokenStore, indexedDb) {
  const snapshot = await createCloudSnapshot(tokenStore, indexedDb);
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

export async function applyCloudSnapshot(snapshot, tokenStore, indexedDb) {
  if (!snapshot) {
    return {
      success: false,
      message: "云端还没有保存过数据",
    };
  }

  const tokens = Array.isArray(snapshot.tokens) ? snapshot.tokens : [];
  const indexedDbTokens = Array.isArray(snapshot.indexedDbTokens)
    ? snapshot.indexedDbTokens
    : [];

  const importResult = tokenStore.importTokens({ tokens });
  if (!importResult.success) {
    throw new Error(importResult.message || "Token 数据导入失败");
  }

  tokenStore.tokenGroups = Array.isArray(snapshot.tokenGroups)
    ? snapshot.tokenGroups
    : [];
  tokenStore.selectedTokenId = snapshot.selectedTokenId || "";

  await indexedDb.clearAll();

  for (const item of indexedDbTokens) {
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
    tokenCount: tokens.length,
    binCount: indexedDbTokens.length,
    updatedAt: snapshot.updatedAt,
  };
}
