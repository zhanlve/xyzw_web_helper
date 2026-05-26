<template>
  <MyCard class="data-analysis-export" :statusClass="{ active: exporting }">
    <template #icon>
      <img src="/icons/Ob7pyorzmHiJcbab2c25af264d0758b527bc1b61cc3b.png" alt="导出图标" />
    </template>
    <template #title>
      <h3>数据分析导出</h3>
      <p>导出武将进度、当前阵容、洗炼孔位和御灵信息</p>
    </template>
    <template #badge>
      <span>{{ exporting ? "导出中" : "就绪" }}</span>
    </template>
    <template #default>
      <div class="export-content">
        <n-alert type="info" :show-icon="false" class="export-note">
          仅导出角色分析数据，不包含 Token、BIN、二维码、登录密码等敏感凭据。
        </n-alert>

        <div class="export-options">
          <n-checkbox v-model:checked="anonymize">
            匿名导出角色名、区服和角色ID
          </n-checkbox>
        </div>

        <div class="export-summary" v-if="lastSummary">
          <div>
            <span class="summary-label">全武将</span>
            <strong>{{ lastSummary.heroCount }}</strong>
          </div>
          <div>
            <span class="summary-label">当前阵容</span>
            <strong>{{ lastSummary.lineupCount }}</strong>
          </div>
          <div>
            <span class="summary-label">阵容槽位</span>
            <strong>{{ lastSummary.teamId }}</strong>
          </div>
        </div>
      </div>
    </template>
    <template #action>
      <button :disabled="exporting" @click="exportAnalysisData">
        {{ exporting ? "正在导出..." : "导出分析数据" }}
      </button>
    </template>
  </MyCard>
</template>

<script setup>
import { ref } from "vue";
import { useMessage } from "naive-ui";
import MyCard from "../Common/MyCard.vue";
import { useTokenStore } from "@/stores/tokenStore";
import {
  FishMap,
  HERO_DICT,
  LEGION_TECH_NAME,
  PearlMap,
  color,
  weapon,
} from "@/utils/HeroList.js";

const tokenStore = useTokenStore();
const message = useMessage();

const exporting = ref(false);
const anonymize = ref(false);
const lastSummary = ref(null);

const attrMap = {
  1: "攻击",
  2: "血量",
  3: "防御",
  4: "速度",
  5: "破甲",
  6: "破甲抵抗",
  7: "精准",
  8: "格挡",
  9: "减伤",
  10: "暴击",
  11: "暴击抵抗",
  12: "爆伤",
  13: "爆伤抵抗",
  14: "技能伤害",
  15: "免控",
  16: "眩晕免疫",
  17: "冰冻免疫",
  18: "沉默免疫",
  19: "流血免疫",
  20: "中毒免疫",
  21: "灼烧免疫",
};

const partMap = {
  1: "武器",
  2: "铠甲",
  3: "头冠",
  4: "坐骑",
};

const sensitiveKeyPattern =
  /(token|password|pwd|bin|qrcode|qrCode|session|auth|cookie|secret|^sid$)/i;

const getHeroQuality = (heroId) => {
  const prefix = Math.floor(Number(heroId) / 100);
  if (prefix === 1) return "红将";
  if (prefix === 2) return "橙将";
  if (prefix === 3) return "紫将";
  return "其他";
};

const sanitizeValue = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" : sanitizeValue(val, seen),
    ]),
  );
};

const pickExisting = (source, keys) => {
  const result = {};
  keys.forEach((key) => {
    if (source && source[key] !== undefined) {
      result[key] = source[key];
    }
  });
  return result;
};

const formatDateForFile = () => {
  const date = new Date();
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
};

const safeFileName = (name) => {
  return String(name || "role")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 40);
};

const normalizePresetTeams = (presetTeamResp) => {
  const root = presetTeamResp?.presetTeamInfo ?? presetTeamResp ?? {};
  const teamDict =
    root.presetTeamInfo || root.teams || root.teamList || root || {};
  const useTeamId = Number(root.useTeamId || findUseTeamId(root) || 1);
  const teams = {};

  Object.entries(teamDict).forEach(([key, value]) => {
    if (/^\d+$/.test(key) && value && typeof value === "object") {
      teams[Number(key)] = value;
    }
  });

  return {
    useTeamId,
    teams,
    raw: sanitizeValue(root),
  };
};

const findUseTeamId = (obj) => {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.useTeamId === "number") return obj.useTeamId;

  for (const value of Object.values(obj)) {
    const found = findUseTeamId(value);
    if (found) return found;
  }

  return null;
};

const getRole = (roleInfoResp) => {
  return roleInfoResp?.role || roleInfoResp || {};
};

const getHeroMeta = (heroId) => {
  return HERO_DICT[Number(heroId)] || {};
};

const normalizeHeroProgress = (heroId, heroData) => {
  const meta = getHeroMeta(heroId);

  return {
    heroId: Number(heroId),
    name: meta.name || `武将${heroId}`,
    country: meta.type || null,
    quality: getHeroQuality(heroId),
    level: heroData?.level ?? null,
    order: heroData?.order ?? null,
    star: heroData?.star ?? heroData?.stars ?? null,
    power: heroData?.power ?? null,
    attack: heroData?.attack ?? null,
    hp: heroData?.hp ?? null,
    speed: heroData?.speed ?? null,
    artifactId: heroData?.artifactId ?? null,
    hasEquipment: Boolean(
      heroData?.equipment && Object.keys(heroData.equipment).length > 0,
    ),
    extraProgress: pickExisting(heroData, [
      "quality",
      "stage",
      "grade",
      "awaken",
      "skinId",
      "breakLevel",
      "fragment",
      "piece",
    ]),
  };
};

const buildAllHeroProgress = (heroes) => {
  return Object.entries(heroes || {})
    .filter(([, heroData]) => heroData && typeof heroData === "object")
    .map(([heroId, heroData]) => normalizeHeroProgress(heroId, heroData))
    .sort((a, b) => {
      const countryOrder = { 魏国: 1, 蜀国: 2, 吴国: 3, 群雄: 4 };
      const qualityOrder = { 红将: 1, 橙将: 2, 紫将: 3, 其他: 4 };
      const countryDiff =
        (countryOrder[a.country] || 99) - (countryOrder[b.country] || 99);
      if (countryDiff) return countryDiff;
      const qualityDiff =
        (qualityOrder[a.quality] || 99) - (qualityOrder[b.quality] || 99);
      if (qualityDiff) return qualityDiff;
      return a.heroId - b.heroId;
    });
};

const normalizeEquipment = (equipment) => {
  return Object.entries(equipment || {})
    .map(([partId, equip]) => {
      const numericPartId = Number(partId);
      const bonusField =
        numericPartId === 1
          ? "quenchAttackExt"
          : numericPartId === 3
            ? "quenchDefenseExt"
            : "quenchHpExt";

      return {
        partId: numericPartId,
        partName: partMap[numericPartId] || `装备${partId}`,
        level: equip?.level ?? null,
        quenchTimes: equip?.quenchTimes ?? 0,
        quenchBonus: {
          field: bonusField,
          name:
            numericPartId === 1
              ? "攻击"
              : numericPartId === 3
                ? "防御"
                : "血量",
          value: equip?.[bonusField] ?? 0,
        },
        slots: normalizeQuenchSlots(equip?.quenches || {}),
        raw: sanitizeValue(equip || {}),
      };
    })
    .sort((a, b) => a.partId - b.partId);
};

const normalizeQuenchSlots = (quenches) => {
  return Object.entries(quenches || {})
    .map(([slotId, slot]) => {
      const colorInfo = color[slot?.colorId];
      return {
        slotId: Number(slotId),
        attrId: slot?.attrId ?? null,
        attrName: attrMap[slot?.attrId] || null,
        attrNum: slot?.attrNum ?? 0,
        colorId: slot?.colorId ?? 0,
        colorName: colorInfo?.color || null,
        colorValue: colorInfo?.value || null,
        isLocked: Boolean(slot?.isLocked || slot?.locked),
        raw: sanitizeValue(slot || {}),
      };
    })
    .sort((a, b) => a.slotId - b.slotId);
};

const findFishByArtifactId = (artifactId, artifactBooks) => {
  if (!artifactId || artifactId === -1) return null;

  const entry = Object.entries(artifactBooks || {}).find(([, book]) => {
    return Number(book?.artifactId) === Number(artifactId);
  });

  if (!entry) return null;
  const [fishId, book] = entry;
  const fishInfo = FishMap[fishId] || {};

  return {
    fishId: Number(fishId),
    name: fishInfo.name || `鱼灵${fishId}`,
    artifactId: book?.artifactId ?? null,
    star: book?.claimedStar ?? book?.star ?? null,
    level: book?.level ?? null,
    rawBook: sanitizeValue(book || {}),
  };
};

const findPearlByArtifactId = (artifactId, pearlMap) => {
  if (!artifactId || artifactId === -1) return null;

  const entry = Object.entries(pearlMap || {}).find(([, pearl]) => {
    return Number(pearl?.artifactId) === Number(artifactId);
  });

  if (!entry) return null;
  const [pearlId, pearlData] = entry;
  return normalizePearl(pearlId, pearlData);
};

const normalizePearl = (pearlId, pearlData) => {
  if (!pearlData) return null;
  const skillId = pearlData.skillId ?? null;
  const skillInfo = PearlMap[skillId] || {};

  return {
    pearlId: Number(pearlId),
    artifactId: pearlData.artifactId ?? null,
    skillId,
    skillName: skillInfo.name || null,
    slots: normalizePearlSlots(pearlData.slotMap || {}),
    raw: sanitizeValue(pearlData),
  };
};

const normalizePearlSlots = (slotMap) => {
  return Object.entries(slotMap || {})
    .map(([slotId, slot]) => {
      const colorInfo = color[slot?.colorId];
      return {
        slotId: Number(slotId),
        colorId: slot?.colorId ?? 0,
        colorName: colorInfo?.color || null,
        colorValue: colorInfo?.value || null,
        raw: sanitizeValue(slot || {}),
      };
    })
    .sort((a, b) => a.slotId - b.slotId);
};

const normalizeLegionResearch = (legionResearch) => {
  return Object.entries(legionResearch || {})
    .map(([researchId, level]) => ({
      researchId: Number(researchId),
      name: LEGION_TECH_NAME[researchId] || `科技${researchId}`,
      level,
    }))
    .sort((a, b) => a.researchId - b.researchId);
};

const buildCurrentLineup = (presetData, role) => {
  const team = presetData.teams[presetData.useTeamId] || {};
  const teamInfo = team.teamInfo || team.heroes || {};
  const heroes = role.heroes || {};
  const artifactBooks = role.artifactBooks || {};
  const rolePearlMap = role.pearlMap || {};

  const currentHeroes = Object.entries(teamInfo)
    .map(([positionKey, teamHero]) => {
      const heroId = teamHero?.heroId || teamHero?.id;
      if (!heroId) return null;

      const position = Number(teamHero?.battleTeamSlot ?? positionKey);
      const heroData = heroes[String(heroId)] || {};
      const progress = normalizeHeroProgress(heroId, heroData);
      const artifactId =
        heroData?.artifactId ?? teamHero?.artifactId ?? progress.artifactId;
      const pearlFromTeam =
        teamHero?.pearlId && rolePearlMap[teamHero.pearlId]
          ? normalizePearl(teamHero.pearlId, rolePearlMap[teamHero.pearlId])
          : null;

      return {
        position,
        positionLabel: position >= 0 && position <= 4 ? position + 1 : position,
        hero: progress,
        teamData: {
          level: teamHero?.level ?? null,
          attachmentUid: teamHero?.attachmentUid ?? null,
          artifactId: teamHero?.artifactId ?? null,
          pearlId: teamHero?.pearlId ?? null,
        },
        stats: pickExisting(heroData, [
          "power",
          "attack",
          "hp",
          "defense",
          "speed",
          "crit",
          "antiCrit",
          "critDamage",
          "antiCritDamage",
          "armorBreak",
          "antiArmorBreak",
          "control",
          "antiControl",
          "damageReduce",
          "skillDamage",
        ]),
        equipment: normalizeEquipment(heroData?.equipment || {}),
        yuling: {
          fish: findFishByArtifactId(artifactId, artifactBooks),
          pearl: pearlFromTeam || findPearlByArtifactId(artifactId, rolePearlMap),
        },
        rawHeroData: sanitizeValue(heroData),
        rawTeamData: sanitizeValue(teamHero),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position);

  const weaponId = team?.weapon?.weaponId ?? team?.weaponId ?? null;

  return {
    teamId: presetData.useTeamId,
    weapon: {
      weaponId,
      name: weaponId ? weapon[weaponId] || `玩具${weaponId}` : null,
      raw: sanitizeValue(team?.weapon || {}),
    },
    heroes: currentHeroes,
    rawTeam: sanitizeValue(team),
  };
};

const buildExportPayload = (roleInfoResp, presetTeamResp) => {
  const role = getRole(roleInfoResp);
  const presetData = normalizePresetTeams(presetTeamResp);
  const currentLineup = buildCurrentLineup(presetData, role);
  const allHeroProgress = buildAllHeroProgress(role.heroes || {});

  const roleIdentity = anonymize.value
    ? {
        roleId: "[ANONYMIZED]",
        name: "[ANONYMIZED]",
        serverId: "[ANONYMIZED]",
        serverName: "[ANONYMIZED]",
      }
    : {
        roleId: role.roleId ?? role.id ?? null,
        name: role.name ?? null,
        serverId: role.serverId ?? null,
        serverName: role.serverName ?? null,
      };

  return {
    schema: "xyzw-ten-palace-analysis-profile",
    version: 1,
    exportedAt: new Date().toISOString(),
    privacy: {
      containsGameToken: false,
      containsBinData: false,
      containsQrCode: false,
      anonymized: anonymize.value,
    },
    role: {
      ...roleIdentity,
      level: role.level ?? null,
      power: role.power ?? role.fighting ?? null,
      vip: role.vip ?? null,
      tower: sanitizeValue(role.tower || null),
      bossTower: sanitizeValue(role.bossTower || null),
      evoTower: sanitizeValue(role.evoTower || null),
    },
    currentLineup,
    allHeroProgress,
    legionResearch: normalizeLegionResearch(role.legionResearch || {}),
    inventorySummary: pickExisting(role.items || {}, ["1022", "1023"]),
    sourceRaw: {
      presetTeam: presetData.raw,
    },
    notes: [
      "allHeroProgress 只保留全武将进度与基础属性。",
      "currentLineup.heroes 才包含当前阵容的装备洗炼、御灵/鱼灵、原始武将数据。",
      "导出数据已按字段名过滤 token、bin、二维码、密码等敏感凭据。",
    ],
  };
};

const downloadJson = (payload, roleName) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ten_palace_profile_${safeFileName(roleName)}_${formatDateForFile()}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

const exportAnalysisData = async () => {
  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择游戏Token");
    return;
  }

  const status = tokenStore.getWebSocketStatus(token.id);
  if (status !== "connected") {
    message.error("WebSocket未连接，请先进入游戏功能页建立连接");
    return;
  }

  exporting.value = true;
  try {
    const [roleInfoResp, presetTeamResp] = await Promise.all([
      tokenStore.sendMessageWithPromise(token.id, "role_getroleinfo", {}, 15000),
      tokenStore.sendMessageWithPromise(token.id, "presetteam_getinfo", {}, 15000),
    ]);

    const payload = buildExportPayload(roleInfoResp, presetTeamResp);
    downloadJson(payload, payload.role.name);
    lastSummary.value = {
      heroCount: payload.allHeroProgress.length,
      lineupCount: payload.currentLineup.heroes.length,
      teamId: payload.currentLineup.teamId,
    };

    message.success("十殿分析数据已导出");
  } catch (error) {
    message.error(`导出失败: ${error.message || "未知错误"}`);
  } finally {
    exporting.value = false;
  }
};
</script>

<style scoped lang="scss">
.export-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.export-note {
  line-height: 1.5;
}

.export-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.export-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--spacing-sm);

  > div {
    padding: var(--spacing-sm);
    border: 1px solid var(--border-light);
    border-radius: var(--border-radius-medium);
    background: var(--bg-secondary);
  }

  strong,
  .summary-label {
    display: block;
  }

  strong {
    color: var(--text-primary);
    font-size: var(--font-size-lg);
  }

  .summary-label {
    margin-bottom: 2px;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
  }
}

@media (max-width: 768px) {
  .export-summary {
    grid-template-columns: 1fr;
  }
}
</style>
