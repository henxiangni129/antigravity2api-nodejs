// 工具转换公共模块
import { sanitizeToolName, cleanParameters } from './utils.js';
import { setToolNameMapping } from './toolNameCache.js';

/**
 * 将单个工具定义转换为 Antigravity 格式的 functionDeclaration
 * @param {string} name - 工具名称
 * @param {string} description - 工具描述
 * @param {Object} parameters - 工具参数 schema
 * @param {string} sessionId - 会话 ID
 * @param {string} actualModelName - 实际模型名称
 * @returns {Object} functionDeclaration 对象
 */
function convertSingleTool(name, description, parameters, sessionId, actualModelName) {
  const originalName = name;
  const safeName = sanitizeToolName(originalName);
  
  if (actualModelName && safeName !== originalName) {
    setToolNameMapping(actualModelName, safeName, originalName);
  }
  
  const rawParams = parameters || {};
  const cleanedParams = cleanParameters(rawParams) || {};
  // 使用大写 OBJECT 以匹配官方 API 格式
  if (cleanedParams.type === undefined) cleanedParams.type = 'OBJECT';
  else if (cleanedParams.type === 'object') cleanedParams.type = 'OBJECT';
  if ((cleanedParams.type === 'OBJECT' || cleanedParams.type === 'object') && cleanedParams.properties === undefined) cleanedParams.properties = {};
  
  return {
    name: safeName,
    description: description || '',
    parameters: cleanedParams
  };
}

/**
 * 将 OpenAI 格式的工具列表转换为 Antigravity 格式
 * OpenAI 格式: [{ type: 'function', function: { name, description, parameters } }]
 * @param {Array} openaiTools - OpenAI 格式的工具列表
 * @param {string} sessionId - 会话 ID
 * @param {string} actualModelName - 实际模型名称
 * @returns {Array} Antigravity 格式的工具列表（每个工具一个 functionDeclarations 数组元素）
 */
export function convertOpenAIToolsToAntigravity(openaiTools, sessionId, actualModelName) {
  if (!openaiTools || openaiTools.length === 0) return [];
  
  return openaiTools.map((tool) => {
    const func = tool.function || {};
    const declaration = convertSingleTool(
      func.name,
      func.description,
      func.parameters,
      sessionId,
      actualModelName
    );
    
    return {
      functionDeclarations: [declaration]
    };
  });
}

/**
 * 将 Claude 格式的工具列表转换为 Antigravity 格式
 * Claude 格式: [{ name, description, input_schema }]
 * @param {Array} claudeTools - Claude 格式的工具列表
 * @param {string} sessionId - 会话 ID
 * @param {string} actualModelName - 实际模型名称
 * @returns {Array} Antigravity 格式的工具列表（每个工具一个 functionDeclarations 数组元素）
 */
export function convertClaudeToolsToAntigravity(claudeTools, sessionId, actualModelName) {
  if (!claudeTools || claudeTools.length === 0) return [];
  
  return claudeTools.map((tool) => {
    const declaration = convertSingleTool(
      tool.name,
      tool.description,
      tool.input_schema,
      sessionId,
      actualModelName
    );
    
    return {
      functionDeclarations: [declaration]
    };
  });
}

/**
 * 将 Gemini 格式的工具列表转换为 Antigravity 格式
 * Gemini 格式可能是:
 * 1. [{ functionDeclarations: [{ name, description, parameters }] }]
 * 2. [{ name, description, parameters }]
 * @param {Array} geminiTools - Gemini 格式的工具列表
 * @param {string} sessionId - 会话 ID
 * @param {string} actualModelName - 实际模型名称
 * @returns {Array} Antigravity 格式的工具列表（每个工具一个 functionDeclarations 数组元素）
 */
export function convertGeminiToolsToAntigravity(geminiTools, sessionId, actualModelName) {
  if (!geminiTools || geminiTools.length === 0) return [];
  
  const result = [];
  
  for (const tool of geminiTools) {
    // 格式1: 已经是 functionDeclarations 格式
    if (tool.functionDeclarations) {
      // 每个声明单独一个元素
      for (const fd of tool.functionDeclarations) {
        result.push({
          functionDeclarations: [
            convertSingleTool(fd.name, fd.description, fd.parameters, sessionId, actualModelName)
          ]
        });
      }
    }
    // 格式2: 单个工具定义格式
    else if (tool.name) {
      result.push({
        functionDeclarations: [
          convertSingleTool(
            tool.name,
            tool.description,
            tool.parameters || tool.input_schema,
            sessionId,
            actualModelName
          )
        ]
      });
    }
    // 未知格式，跳过
  }
  
  return result;
}
