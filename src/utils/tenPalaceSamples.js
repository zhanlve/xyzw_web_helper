const STORAGE_KEY = "xyzw_ten_palace_simulation_samples";
const MAX_SAMPLES = 200;

const sensitiveKeyPattern =
  /(token|password|pwd|bin|qrcode|qrCode|session|auth|cookie|secret|^sid$)/i;

export const sanitizeTenPalaceSampleValue = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTenPalaceSampleValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [
      key,
      sensitiveKeyPattern.test(key)
        ? "[REDACTED]"
        : sanitizeTenPalaceSampleValue(val, seen),
    ]),
  );
};

const readStorage = () => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStorage = (samples) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(samples.slice(0, MAX_SAMPLES)),
  );
};

const findNestedValue = (source, keys, depth = 0) => {
  if (!source || typeof source !== "object" || depth > 8) return undefined;

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }

  for (const value of Object.values(source)) {
    const found = findNestedValue(value, keys, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
};

export const summarizeTenPalaceResponse = (response) => {
  const battleData = response?.battleData || findNestedValue(response, ["battleData"]);
  const result = battleData?.result || findNestedValue(response, ["result"]);
  const accept = result?.accept || findNestedValue(result, ["accept"]);
  const curHP = accept?.ext?.curHP ?? findNestedValue(response, ["curHP"]);
  const win =
    response?.win ??
    response?.isWin ??
    result?.win ??
    (typeof curHP === "number" ? curHP === 0 : undefined);
  const round =
    response?.round ??
    result?.round ??
    battleData?.round ??
    findNestedValue(response, ["round", "roundId", "turn"]);

  return {
    win: typeof win === "boolean" ? win : null,
    round: typeof round === "number" ? round : null,
    bossCurHP: typeof curHP === "number" ? curHP : null,
    hasBattleData: Boolean(battleData),
    topLevelKeys:
      response && typeof response === "object" ? Object.keys(response).slice(0, 12) : [],
  };
};

export const listTenPalaceSamples = () => readStorage();

export const addTenPalaceSample = (sample) => {
  const samples = readStorage();
  const safeSample = sanitizeTenPalaceSampleValue(sample);
  const next = [safeSample, ...samples].slice(0, MAX_SAMPLES);
  writeStorage(next);
  return next;
};

export const clearTenPalaceSamples = () => {
  writeStorage([]);
};

export const exportTenPalaceSamples = (filePrefix = "ten_palace_samples") => {
  const samples = readStorage();
  const blob = new Blob(
    [
      JSON.stringify(
        {
          schema: "xyzw-ten-palace-official-simulation-samples",
          version: 1,
          exportedAt: new Date().toISOString(),
          privacy: {
            containsGameToken: false,
            containsBinData: false,
            containsQrCode: false,
          },
          samples,
        },
        null,
        2,
      ),
    ],
    { type: "application/json;charset=utf-8" },
  );

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filePrefix}_${new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, "")}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};
