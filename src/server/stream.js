/**
 * SSE 流式响应和心跳机制工具模块
 * 提供统一的流式响应处理、心跳保活、429重试等功能
 */

import config from '../config/config.js';
import logger from '../utils/logger.js';
import memoryManager, { registerMemoryPoolCleanup } from '../utils/memoryManager.js';
import { DEFAULT_HEARTBEAT_INTERVAL } from '../constants/index.js';

// ==================== 心跳机制（防止 CF 超时） ====================
const HEARTBEAT_INTERVAL = config.server.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL;
const SSE_HEARTBEAT = Buffer.from(': heartbeat\n\n');

/**
 * 创建心跳定时器
 * @param {Response} res - Express响应对象
 * @returns {NodeJS.Timeout} 定时器
 */
export const createHeartbeat = (res) => {
  const timer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(SSE_HEARTBEAT);
    } else {
      clearInterval(timer);
    }
  }, HEARTBEAT_INTERVAL);
  
  // 响应结束时清理
  res.on('close', () => clearInterval(timer));
  res.on('finish', () => clearInterval(timer));
  
  return timer;
};

// ==================== 预编译的常量字符串（避免重复创建） ====================
const SSE_PREFIX = Buffer.from('data: ');
const SSE_SUFFIX = Buffer.from('\n\n');
const SSE_DONE = Buffer.from('data: [DONE]\n\n');

/**
 * 生成响应元数据
 * @returns {{id: string, created: number}}
 */
export const createResponseMeta = () => ({
  id: `chatcmpl-${Date.now()}`,
  created: Math.floor(Date.now() / 1000)
});

/**
 * 设置流式响应头
 * @param {Response} res - Express响应对象
 */
export const setStreamHeaders = (res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲
  // 立即发送响应头，确保客户端尽快建立连接
  res.flushHeaders();
};

// ==================== 对象池（减少 GC） ====================
const chunkPool = [];

/**
 * 从对象池获取 chunk 对象
 * @returns {Object}
 */
export const getChunkObject = () => chunkPool.pop() || { choices: [{ index: 0, delta: {}, finish_reason: null }] };

/**
 * 释放 chunk 对象回对象池
 * @param {Object} obj 
 */
export const releaseChunkObject = (obj) => {
  const maxSize = memoryManager.getPoolSizes().chunk;
  if (chunkPool.length < maxSize) chunkPool.push(obj);
};

// 注册内存清理回调
registerMemoryPoolCleanup(chunkPool, () => memoryManager.getPoolSizes().chunk);

/**
 * 获取当前对象池大小（用于监控）
 * @returns {number}
 */
export const getChunkPoolSize = () => chunkPool.length;

/**
 * 清空对象池
 */
export const clearChunkPool = () => {
  chunkPool.length = 0;
};

/**
 * 零拷贝写入流式数据
 * @param {Response} res - Express响应对象
 * @param {Object} data - 要发送的数据
 */
export const writeStreamData = (res, data) => {
  const json = JSON.stringify(data);
  res.write(SSE_PREFIX);
  res.write(json);
  res.write(SSE_SUFFIX);
  // 立即刷新缓冲区，确保数据实时发送给客户端
  if (typeof res.flush === 'function') {
    res.flush();
  }
};

/**
 * 结束流式响应
 * @param {Response} res - Express响应对象
 */
export const endStream = (res, isWriteDone = true) => {
  if (res.writableEnded) return;
  if (isWriteDone) res.write(SSE_DONE);
  res.end();
};

// ==================== 通用重试工具（处理 429） ====================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDurationToMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value !== 'string') return null;

  const s = value.trim();
  if (!s) return null;

  // e.g. "295.285334ms"
  const msMatch = s.match(/^(\d+(\.\d+)?)\s*ms$/i);
  if (msMatch) return Math.max(0, Math.floor(Number(msMatch[1])));

  // e.g. "0.295285334s"
  const secMatch = s.match(/^(\d+(\.\d+)?)\s*s$/i);
  if (secMatch) return Math.max(0, Math.floor(Number(secMatch[1]) * 1000));

  // plain number in string: treat as ms
  const num = Number(s);
  if (Number.isFinite(num)) return Math.max(0, Math.floor(num));
  return null;
}

function tryParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    // Some messages embed JSON inside a string; try to salvage a JSON object substring.
    const first = value.indexOf('{');
    const last = value.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const sliced = value.slice(first, last + 1);
      try {
        return JSON.parse(sliced);
      } catch {}
    }
    return null;
  }
}

function extractUpstreamErrorBody(error) {
  // UpstreamApiError created by createApiError(...) stores rawBody
  if (error?.isUpstreamApiError && error.rawBody) {
    return tryParseJson(error.rawBody) || error.rawBody;
  }
  // axios-like error
  if (error?.response?.data) {
    return tryParseJson(error.response.data) || error.response.data;
  }
  // fallback: try parse message
  return tryParseJson(error?.message);
}

function getUpstreamRetryDelayMs(error) {
  // Prefer explicit hints from upstream payload (RetryInfo/quotaResetDelay/quotaResetTimeStamp)
  const body = extractUpstreamErrorBody(error);
  const root = (body && typeof body === 'object') ? body : null;
  const inner = root?.error || root;
  const details = Array.isArray(inner?.details) ? inner.details : [];

  let bestMs = null;
  for (const d of details) {
    if (!d || typeof d !== 'object') continue;

    // google.rpc.RetryInfo: { retryDelay: "0.295285334s" }
    const retryDelayMs = parseDurationToMs(d.retryDelay);
    if (retryDelayMs !== null) bestMs = bestMs === null ? retryDelayMs : Math.max(bestMs, retryDelayMs);

    // google.rpc.ErrorInfo metadata: { quotaResetDelay: "295.285334ms", quotaResetTimeStamp: "..." }
    const meta = d.metadata && typeof d.metadata === 'object' ? d.metadata : null;
    const quotaResetDelayMs = parseDurationToMs(meta?.quotaResetDelay);
    if (quotaResetDelayMs !== null) bestMs = bestMs === null ? quotaResetDelayMs : Math.max(bestMs, quotaResetDelayMs);

    const ts = meta?.quotaResetTimeStamp;
    if (typeof ts === 'string') {
      const t = Date.parse(ts);
      if (Number.isFinite(t)) {
        const deltaMs = Math.max(0, t - Date.now());
        bestMs = bestMs === null ? deltaMs : Math.max(bestMs, deltaMs);
      }
    }
  }

  // If it's the capacity exhausted case, still retry but avoid hammering.
  const reason = details.find(d => d?.reason)?.reason;
  if (reason === 'MODEL_CAPACITY_EXHAUSTED') {
    bestMs = bestMs === null ? 1000 : Math.max(bestMs, 1000);
  }

  return bestMs;
}

function computeBackoffMs(attempt, explicitDelayMs) {
  // attempt starts from 0 for first call; on first retry attempt=1
  const maxMs = 20_000;
  const hasExplicit = Number.isFinite(explicitDelayMs) && explicitDelayMs !== null;
  const baseMs = hasExplicit ? Math.max(0, Math.floor(explicitDelayMs)) : 500;
  const exp = Math.min(maxMs, Math.floor(baseMs * Math.pow(2, Math.max(0, attempt - 1))));

  // Add small jitter to spread bursts (±20%)
  const jitterFactor = 0.8 + Math.random() * 0.4;
  const expJittered = Math.max(0, Math.floor(exp * jitterFactor));

  if (hasExplicit) {
    // Add a small safety buffer to avoid retrying slightly too early
    const buffered = Math.max(0, Math.floor(explicitDelayMs + 50));
    return Math.min(maxMs, Math.max(expJittered, buffered));
  }

  // Fallback: at least 0.5s for the first retry
  return Math.min(maxMs, Math.max(500, expJittered));
}

/**
 * 带 429 重试的执行器
 * @param {Function} fn - 要执行的异步函数，接收 attempt 参数
 * @param {number} maxRetries - 最大重试次数
 * @param {string} loggerPrefix - 日志前缀
 * @returns {Promise<any>}
 */
export const with429Retry = async (fn, maxRetries, loggerPrefix = '') => {
  const retries = Number.isFinite(maxRetries) && maxRetries > 0 ? Math.floor(maxRetries) : 0;
  let attempt = 0;
  // 首次执行 + 最多 retries 次重试
  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      // 兼容多种错误格式：error.status, error.statusCode, error.response?.status
      const status = Number(error.status || error.statusCode || error.response?.status);
      if (status === 429 && attempt < retries) {
        const nextAttempt = attempt + 1;
        const explicitDelayMs = getUpstreamRetryDelayMs(error);
        const waitMs = computeBackoffMs(nextAttempt, explicitDelayMs);
        logger.warn(
          `${loggerPrefix}收到 429，等待 ${waitMs}ms 后进行第 ${nextAttempt} 次重试（共 ${retries} 次）` +
          (explicitDelayMs !== null ? `（上游提示≈${explicitDelayMs}ms）` : '')
        );
        await sleep(waitMs);
        attempt = nextAttempt;
        continue;
      }
      throw error;
    }
  }
};
