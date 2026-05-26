<template>
  <MyCard class="ten-palace-simulator" :statusClass="{ active: running }">
    <template #icon>
      <img src="/icons/1733492491706152.png" alt="十殿模拟" />
    </template>
    <template #title>
      <h3>十殿官方模拟采样</h3>
      <p>调用官方模拟接口并沉淀战斗样本</p>
    </template>
    <template #badge>
      <span>{{ running ? "模拟中" : `${samples.length} 条样本` }}</span>
    </template>

    <template #default>
      <div class="simulator-content">
        <n-alert type="warning" :show-icon="false" class="simulator-note">
          实验功能：默认只调用模拟/查询类命令。若后续确认官方十殿模拟接口名或参数不同，可在这里直接校准。
        </n-alert>

        <div class="form-grid">
          <label>
            <span>殿数</span>
            <n-input-number v-model:value="palaceId" :min="1" :max="10" size="small" />
          </label>
          <label>
            <span>星级目标</span>
            <n-input-number v-model:value="targetStar" :min="1" :max="3" size="small" />
          </label>
          <label>
            <span>阵容槽位</span>
            <n-input-number v-model:value="teamId" :min="1" :max="5" size="small" />
          </label>
          <label>
            <span>超时秒数</span>
            <n-input-number v-model:value="timeoutSeconds" :min="3" :max="30" size="small" />
          </label>
        </div>

        <label class="field-block">
          <span>官方命令</span>
          <n-select
            v-model:value="officialCommand"
            :options="commandOptions"
            filterable
            tag
            size="small"
          />
        </label>

        <div class="mode-row">
          <n-radio-group v-model:value="paramMode" size="small">
            <n-radio-button value="compatible">兼容参数</n-radio-button>
            <n-radio-button value="manual">仅手动 JSON</n-radio-button>
          </n-radio-group>
          <n-checkbox v-model:checked="allowRiskyCommand">
            允许非模拟命令
          </n-checkbox>
          <n-checkbox v-model:checked="saveRawResponse">
            保存原始响应
          </n-checkbox>
        </div>

        <label class="field-block">
          <span>手动 JSON 参数</span>
          <n-input
            v-model:value="manualParamsText"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 9 }"
            placeholder='例如：{"palaceId":1,"star":3}'
          />
        </label>

        <div v-if="contextSummary" class="context-summary">
          <div>
            <span>角色</span>
            <strong>{{ contextSummary.roleName || "未知" }}</strong>
          </div>
          <div>
            <span>当前阵容</span>
            <strong>{{ contextSummary.teamText || "未读取" }}</strong>
          </div>
        </div>

        <div v-if="lastResult" class="result-panel" :class="{ failed: !lastResult.ok }">
          <div class="result-title">
            <strong>{{ lastResult.ok ? "最近结果" : "最近错误" }}</strong>
            <span>{{ lastResult.createdAt }}</span>
          </div>
          <pre>{{ lastResult.preview }}</pre>
        </div>

        <div v-if="samples.length" class="sample-list">
          <div v-for="sample in samples.slice(0, 5)" :key="sample.id" class="sample-row">
            <span>{{ formatSampleTitle(sample) }}</span>
            <strong>{{ sample.summary?.win === true ? "胜" : sample.summary?.win === false ? "败" : "已采样" }}</strong>
          </div>
        </div>
      </div>
    </template>

    <template #action>
      <div class="button-row">
        <button :disabled="running" @click="refreshContext">
          刷新上下文
        </button>
        <button :disabled="running || !canRun" @click="runOfficialSimulation">
          {{ running ? "模拟中..." : "执行模拟" }}
        </button>
        <button :disabled="running || samples.length === 0" @click="exportSamples">
          导出样本
        </button>
        <button :disabled="running || samples.length === 0" @click="clearSamples">
          清空
        </button>
      </div>
    </template>
  </MyCard>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import MyCard from "../Common/MyCard.vue";
import { useTokenStore } from "@/stores/tokenStore";
import { HERO_DICT } from "@/utils/HeroList.js";
import {
  addTenPalaceSample,
  clearTenPalaceSamples,
  exportTenPalaceSamples,
  listTenPalaceSamples,
  sanitizeTenPalaceSampleValue,
  summarizeTenPalaceResponse,
} from "@/utils/tenPalaceSamples.js";

const tokenStore = useTokenStore();
const message = useMessage();

const running = ref(false);
const palaceId = ref(1);
const targetStar = ref(3);
const teamId = ref(1);
const timeoutSeconds = ref(10);
const officialCommand = ref("hero_simulation");
const paramMode = ref("compatible");
const allowRiskyCommand = ref(false);
const saveRawResponse = ref(true);
const manualParamsText = ref("{}");
const contextSummary = ref(null);
const latestContext = ref(null);
const lastResult = ref(null);
const samples = ref([]);

const commandOptions = [
  { label: "hero_simulation（客户端已有模拟命令）", value: "hero_simulation" },
  { label: "tenpalace_simulation（候选）", value: "tenpalace_simulation" },
  { label: "tenpalace_getinfo（候选）", value: "tenpalace_getinfo" },
  { label: "palace_simulation（候选）", value: "palace_simulation" },
  { label: "temple_simulation（候选）", value: "temple_simulation" },
];

const riskyCommandPattern =
  /(fight|start|claim|buy|open|sweep|upgrade|quench|load|unload|exchange|commit|send|save|set|go)/i;

const canRun = computed(() => {
  if (!tokenStore.selectedToken) return false;
  if (!officialCommand.value) return false;
  if (!allowRiskyCommand.value && riskyCommandPattern.test(officialCommand.value)) {
    return false;
  }
  return true;
});

const selectedStatus = computed(() => {
  return tokenStore.getWebSocketStatus(tokenStore.selectedToken?.id);
});

const getHeroName = (heroId) => {
  return HERO_DICT[Number(heroId)]?.name || `武将${heroId}`;
};

const parseManualParams = () => {
  const text = manualParamsText.value?.trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("手动 JSON 参数必须是对象");
  }
  return parsed;
};

const buildCompatibleParams = () => ({
  scene: "tenPalace",
  mode: "simulation",
  isSimulation: true,
  palaceId: palaceId.value,
  templeId: palaceId.value,
  towerType: palaceId.value,
  stageId: palaceId.value,
  star: targetStar.value,
  targetStar: targetStar.value,
  teamId: teamId.value,
});

const buildRequestParams = () => {
  const manual = parseManualParams();
  if (paramMode.value === "manual") return manual;
  return {
    ...buildCompatibleParams(),
    ...manual,
  };
};

const normalizePresetTeam = (presetResp) => {
  const root = presetResp?.presetTeamInfo || presetResp || {};
  const useTeamId = Number(root.useTeamId || root.presetTeamInfo?.useTeamId || teamId.value || 1);
  const teamDict = root.presetTeamInfo || root.teams || root || {};
  const team = teamDict[useTeamId] || teamDict[String(useTeamId)] || {};
  const teamInfo = team.teamInfo || team.heroes || {};
  const heroIds = Object.values(teamInfo)
    .map((item) => item?.heroId || item?.id)
    .filter(Boolean);

  return {
    useTeamId,
    heroIds,
    heroNames: heroIds.map(getHeroName),
    raw: sanitizeTenPalaceSampleValue(root),
  };
};

const buildContextSummary = (roleResp, presetResp) => {
  const role = roleResp?.role || roleResp || {};
  const team = normalizePresetTeam(presetResp);

  return {
    roleId: role.roleId || role.id || null,
    roleName: role.name || null,
    level: role.level || null,
    power: role.power || null,
    serverId: role.serverId || null,
    teamId: team.useTeamId,
    teamHeroIds: team.heroIds,
    teamHeroNames: team.heroNames,
    teamText: team.heroNames.length ? team.heroNames.join(" / ") : `阵容${team.useTeamId}`,
  };
};

const ensureConnected = () => {
  if (!tokenStore.selectedToken) {
    throw new Error("请先选择 Token");
  }

  if (selectedStatus.value !== "connected") {
    throw new Error("当前 Token 未连接，请先连接后再执行");
  }
};

const loadContext = async () => {
  ensureConnected();
  const tokenId = tokenStore.selectedToken.id;
  const [roleResp, presetResp] = await Promise.all([
    tokenStore.sendGetRoleInfo(tokenId),
    tokenStore.sendMessageWithPromise(tokenId, "presetteam_getinfo", {}, 8000),
  ]);
  const summary = buildContextSummary(roleResp, presetResp);
  teamId.value = summary.teamId || teamId.value;
  contextSummary.value = summary;
  latestContext.value = {
    role: sanitizeTenPalaceSampleValue(roleResp),
    presetTeam: sanitizeTenPalaceSampleValue(presetResp),
    summary,
  };
  return latestContext.value;
};

const refreshContext = async () => {
  try {
    running.value = true;
    await loadContext();
    message.success("十殿模拟上下文已刷新");
  } catch (error) {
    message.error(error.message || "刷新上下文失败");
  } finally {
    running.value = false;
  }
};

const saveSample = (payload) => {
  const nextSamples = addTenPalaceSample({
    id: `ten_palace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    token: {
      name: tokenStore.selectedToken?.name || "",
      server: tokenStore.selectedToken?.server || "",
      importMethod: tokenStore.selectedToken?.importMethod || "",
    },
    ...payload,
  });
  samples.value = nextSamples;
};

const formatPreview = (value) => {
  return JSON.stringify(value, null, 2).slice(0, 3000);
};

const runOfficialSimulation = async () => {
  const startedAt = Date.now();

  try {
    ensureConnected();
    if (!canRun.value) {
      throw new Error("当前命令看起来不是模拟/查询命令，如需继续请勾选允许非模拟命令");
    }

    running.value = true;
    const tokenId = tokenStore.selectedToken.id;
    const params = buildRequestParams();

    if (!latestContext.value) {
      await loadContext();
    }

    const response = await tokenStore.sendMessageWithPromise(
      tokenId,
      officialCommand.value,
      params,
      timeoutSeconds.value * 1000,
    );

    const summary = summarizeTenPalaceResponse(response);
    const sample = {
      status: "success",
      source: "official",
      command: officialCommand.value,
      palaceId: palaceId.value,
      targetStar: targetStar.value,
      durationMs: Date.now() - startedAt,
      request: {
        paramMode: paramMode.value,
        params,
      },
      context: latestContext.value?.summary || contextSummary.value,
      summary,
      response: saveRawResponse.value ? response : summary,
    };

    saveSample(sample);
    lastResult.value = {
      ok: true,
      createdAt: new Date().toLocaleTimeString(),
      preview: formatPreview({ summary, response }),
    };
    message.success("官方模拟请求已完成，样本已保存");
  } catch (error) {
    const sample = {
      status: "error",
      source: "official",
      command: officialCommand.value,
      palaceId: palaceId.value,
      targetStar: targetStar.value,
      durationMs: Date.now() - startedAt,
      request: {
        paramMode: paramMode.value,
        params: (() => {
          try {
            return buildRequestParams();
          } catch {
            return {};
          }
        })(),
      },
      context: latestContext.value?.summary || contextSummary.value,
      error: {
        message: error.message || String(error),
      },
    };
    saveSample(sample);
    lastResult.value = {
      ok: false,
      createdAt: new Date().toLocaleTimeString(),
      preview: formatPreview(sample.error),
    };
    message.error(error.message || "官方模拟请求失败");
  } finally {
    running.value = false;
  }
};

const formatSampleTitle = (sample) => {
  const time = sample.createdAt
    ? new Date(sample.createdAt).toLocaleTimeString()
    : "";
  return `${time} ${sample.command} 十殿${sample.palaceId || "-"}-${sample.targetStar || "-"}`;
};

const exportSamples = () => {
  exportTenPalaceSamples("ten_palace_official_samples");
  message.success("十殿模拟样本已导出");
};

const clearSamples = () => {
  clearTenPalaceSamples();
  samples.value = [];
  message.success("本地十殿模拟样本已清空");
};

watch(
  () => [palaceId.value, targetStar.value, teamId.value],
  () => {
    if (manualParamsText.value.trim() === "{}") {
      manualParamsText.value = JSON.stringify(
        {
          palaceId: palaceId.value,
          star: targetStar.value,
          teamId: teamId.value,
        },
        null,
        2,
      );
    }
  },
);

onMounted(() => {
  samples.value = listTenPalaceSamples();
});
</script>

<style scoped lang="scss">
.simulator-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.simulator-note {
  font-size: var(--font-size-sm);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--spacing-sm);

  label {
    min-width: 0;
  }
}

label,
.field-block {
  display: flex;
  flex-direction: column;
  gap: 4px;

  > span {
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
  }
}

.mode-row,
.button-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.button-row button {
  min-width: 86px;
}

.context-summary {
  display: grid;
  grid-template-columns: 0.7fr 1.3fr;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  background: var(--bg-secondary);

  div {
    min-width: 0;
  }

  span {
    display: block;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
  }

  strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.result-panel {
  border: 1px solid var(--border-light);
  border-left: 3px solid var(--success-color);
  border-radius: var(--border-radius-medium);
  background: var(--bg-secondary);
  padding: var(--spacing-sm);

  &.failed {
    border-left-color: var(--error-color);
  }

  pre {
    max-height: 220px;
    overflow: auto;
    margin: var(--spacing-xs) 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--font-size-xs);
  }
}

.result-title,
.sample-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.result-title span,
.sample-row span {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.sample-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sample-row {
  padding: 6px 8px;
  border-radius: var(--border-radius-small);
  background: var(--bg-secondary);

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (max-width: 768px) {
  .form-grid,
  .context-summary {
    grid-template-columns: 1fr 1fr;
  }

  .button-row button {
    flex: 1;
  }
}

@media (max-width: 520px) {
  .form-grid,
  .context-summary {
    grid-template-columns: 1fr;
  }
}
</style>
