const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// 日志存储配置
const MAX_LOG_ENTRIES = 1000; // 最大存储条数
const logStore = [];

/**
 * 格式化日志参数为字符串
 */
function formatArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

/**
 * 判断是否为分隔符行（只包含重复的特殊字符）
 */
function isSeparatorLine(message) {
  if (!message || typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (trimmed.length < 3) return false;
  return /^[═─=\-*_~]+$/.test(trimmed);
}

/**
 * 存储日志条目
 */
function storeLog(level, message) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    level,
    message
  };
  
  logStore.push(entry);
  
  // 超过最大条数时删除最旧的
  while (logStore.length > MAX_LOG_ENTRIES) {
    logStore.shift();
  }
}

function logMessage(level, ...args) {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const color = { info: colors.green, warn: colors.yellow, error: colors.red }[level];
  const message = formatArgs(args);
  
  // 输出到控制台
  console.log(`${colors.gray}${timestamp}${colors.reset} ${color}[${level}]${colors.reset}`, ...args);
  
  // 存储日志
  storeLog(level, message);
}

function logRequest(method, path, status, duration) {
  const statusColor = status >= 500 ? colors.red : status >= 400 ? colors.yellow : colors.green;
  const message = `[${method}] - ${path} ${status} ${duration}ms`;
  
  // 输出到控制台
  console.log(`${colors.cyan}[${method}]${colors.reset} - ${path} ${statusColor}${status}${colors.reset} ${colors.gray}${duration}ms${colors.reset}`);
  
  // 存储日志（根据状态码决定级别）
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'request';
  storeLog(level, message);
}

/**
 * 获取所有日志
 * @param {Object} options - 筛选选项
 * @param {string} options.level - 日志级别筛选
 * @param {string} options.search - 搜索关键词
 * @param {number} options.limit - 返回条数限制
 * @param {number} options.offset - 偏移量
 * @returns {Object} 日志列表和总数
 */
function getLogs(options = {}) {
  const { level, search, limit = 100, offset = 0 } = options;
  
  // 先过滤掉分隔符行
  let filtered = logStore.filter(log => !isSeparatorLine(log.message));
  
  // 按级别筛选
  if (level && level !== 'all') {
    filtered = filtered.filter(log => log.level === level);
  }
  
  // 按关键词搜索
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(log =>
      log.message.toLowerCase().includes(searchLower)
    );
  }
  
  // 按时间倒序排列（最新的在前）
  filtered.reverse();
  
  const total = filtered.length;
  const logs = filtered.slice(offset, offset + limit);
  
  return { logs, total };
}

/**
 * 清空所有日志
 */
function clearLogs() {
  logStore.length = 0;
}

/**
 * 获取日志统计
 */
function getLogStats() {
  const stats = {
    total: 0,
    info: 0,
    warn: 0,
    error: 0,
    request: 0
  };
  
  // 过滤掉分隔符行后统计
  for (const log of logStore) {
    if (isSeparatorLine(log.message)) continue;
    stats.total++;
    if (stats[log.level] !== undefined) {
      stats[log.level]++;
    }
  }
  
  return stats;
}

export const log = {
  info: (...args) => logMessage('info', ...args),
  warn: (...args) => logMessage('warn', ...args),
  error: (...args) => logMessage('error', ...args),
  request: logRequest,
  // API 方法
  getLogs,
  clearLogs,
  getLogStats
};

export default log;
