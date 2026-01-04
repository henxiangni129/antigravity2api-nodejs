// 简单内存缓存：按 model 维度缓存“最新一条”思维链签名和工具签名
// - 不区分 token / sessionId（适配 token 轮询）
// - 每个 model 只保留最新签名（低占用 + 低误用风险）
// - 集成内存管理器，在压力较高时自动清理缓存

import memoryManager, { MemoryPressure } from './memoryManager.js';

const reasoningSignatureByModel = new Map();
const toolSignatureByModel = new Map();

// 正常情况下允许的最大条目数（低压力时）
// 只按 model 缓存，模型数量一般很少；仍加一个上限防止异常输入导致增长
const MAX_MODEL_ENTRIES = 64;

// 过期时间与定时清理间隔（毫秒）
const ENTRY_TTL_MS = 30 * 60 * 1000;      // 30 分钟
const CLEAN_INTERVAL_MS = 10 * 60 * 1000; // 每 10 分钟扫一遍

function makeModelKey(model) {
  if (!model) return null;
  return String(model);
}

function pruneMap(map, targetSize) {
  if (map.size <= targetSize) return;
  const removeCount = map.size - targetSize;
  let removed = 0;
  for (const key of map.keys()) {
    map.delete(key);
    removed++;
    if (removed >= removeCount) break;
  }
}

function pruneExpired(map, now) {
  for (const [key, entry] of map.entries()) {
    if (!entry || typeof entry.ts !== 'number') continue;
    if (now - entry.ts > ENTRY_TTL_MS) {
      map.delete(key);
    }
  }
}

function getValidSignature(map, key, now) {
  if (!key) return null;
  const entry = map.get(key);
  if (!entry) return null;
  if (typeof entry.ts === 'number' && now - entry.ts > ENTRY_TTL_MS) {
    map.delete(key);
    return null;
  }
  return entry.signature || null;
}

function setSignature(map, key, signature, maxEntries) {
  if (!key || !signature) return;
  map.set(key, { signature, ts: Date.now() });
  pruneMap(map, maxEntries);
}

// 注册到内存管理器，在不同压力级别下自动清理缓存
memoryManager.registerCleanup((pressure) => {
  if (pressure === MemoryPressure.MEDIUM) {
    // 中等压力：收缩到一半容量
    pruneMap(reasoningSignatureByModel, Math.floor(MAX_MODEL_ENTRIES / 2));
    pruneMap(toolSignatureByModel, Math.floor(MAX_MODEL_ENTRIES / 2));
  } else if (pressure === MemoryPressure.HIGH) {
    // 高压力：大幅收缩
    pruneMap(reasoningSignatureByModel, Math.floor(MAX_MODEL_ENTRIES / 4));
    pruneMap(toolSignatureByModel, Math.floor(MAX_MODEL_ENTRIES / 4));
  } else if (pressure === MemoryPressure.CRITICAL) {
    // 紧急压力：直接清空，优先保活
    reasoningSignatureByModel.clear();
    toolSignatureByModel.clear();
  }
});

// 定时清理：不依赖压力等级，按 TTL 移除过期签名
setInterval(() => {
  const now = Date.now();
  pruneExpired(reasoningSignatureByModel, now);
  pruneExpired(toolSignatureByModel, now);
}, CLEAN_INTERVAL_MS).unref?.();

export function setReasoningSignature(sessionId, model, signature) {
  if (!signature || !model) return;
  // sessionId 参数保留仅为兼容现有调用方，不参与缓存 key
  setSignature(reasoningSignatureByModel, makeModelKey(model), signature, MAX_MODEL_ENTRIES);
}

export function getReasoningSignature(sessionId, model) {
  const now = Date.now();
  return getValidSignature(reasoningSignatureByModel, makeModelKey(model), now);
}

export function setToolSignature(sessionId, model, signature) {
  if (!signature || !model) return;
  // sessionId 参数保留仅为兼容现有调用方，不参与缓存 key
  setSignature(toolSignatureByModel, makeModelKey(model), signature, MAX_MODEL_ENTRIES);
}

export function getToolSignature(sessionId, model) {
  const now = Date.now();
  return getValidSignature(toolSignatureByModel, makeModelKey(model), now);
}

// 预留：手动清理接口（目前未在外部使用，但方便将来扩展）
export function clearThoughtSignatureCaches() {
  reasoningSignatureByModel.clear();
  toolSignatureByModel.clear();
}
