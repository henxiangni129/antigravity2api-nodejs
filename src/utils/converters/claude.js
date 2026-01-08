// Claude 格式转换工具
import config from '../../config/config.js';
import { convertClaudeToolsToAntigravity } from '../toolConverter.js';
import {
  getSignatureContext,
  pushUserMessage,
  findFunctionNameById,
  pushFunctionResponse,
  createThoughtPart,
  createFunctionCallPart,
  processToolName,
  pushModelMessage,
  buildRequestBody,
  mergeSystemInstruction,
  modelMapping,
  isEnableThinking,
  generateGenerationConfig
} from './common.js';

function extractImagesFromClaudeContent(content) {
  const result = { text: '', images: [] };
  if (typeof content === 'string') {
    result.text = content;
    return result;
  }
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'text') {
        result.text += item.text || '';
      } else if (item.type === 'image') {
        const source = item.source;
        if (source && source.type === 'base64' && source.data) {
          result.images.push({
            inlineData: {
              mimeType: source.media_type || 'image/png',
              data: source.data
            }
          });
        }
      }
    }
  }
  return result;
}

function handleClaudeAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, sessionId, hasTools) {
  const content = message.content;
  const { reasoningSignature, reasoningContent, toolSignature, toolContent } = getSignatureContext(sessionId, actualModelName, hasTools);

  let textContent = '';
  let thinkingContent = '';
  const toolCalls = [];
  let messageSignature = null;

  if (typeof content === 'string') {
    textContent = content;
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'text') {
        textContent += item.text || '';
      } else if (item.type === 'thinking') {
        // Claude thinking block: collect thinking content and signature
        if (item.thinking) thinkingContent += item.thinking;
        if (!messageSignature && item.signature) messageSignature = item.signature;
      } else if (item.type === 'tool_use') {
        const safeName = processToolName(item.name, sessionId, actualModelName);
        const signature = enableThinking ? (item.signature || toolSignature || reasoningSignature) : null;
        toolCalls.push(createFunctionCallPart(item.id, safeName, JSON.stringify(item.input || {}), signature));
      }
    }
  }

  const hasContent = textContent && textContent.trim() !== '';
  const parts = [];
  
  if (enableThinking) {
    const signature = messageSignature || reasoningSignature || toolSignature;
    // 只有在有签名时才添加 thought part，避免 API 报错
    if (signature) {
      // 优先使用消息自带的思考内容，否则使用缓存的内容（与签名绑定）
      let reasoningText = ' ';
      if (thinkingContent.length > 0) {
        reasoningText = thinkingContent;
      } else if (signature === reasoningSignature) {
        reasoningText = reasoningContent || ' ';
      } else if (signature === toolSignature) {
        reasoningText = toolContent || ' ';
      }
      parts.push(createThoughtPart(reasoningText, signature));
    }
  }
  if (hasContent) {
    const part = { text: textContent.trimEnd() };
    parts.push(part);
  }
  if (!enableThinking && parts[0]) delete parts[0].thoughtSignature;

  pushModelMessage({ parts, toolCalls, hasContent }, antigravityMessages);
}

function handleClaudeToolResult(message, antigravityMessages) {
  const content = message.content;
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (item.type !== 'tool_result') continue;

    const toolUseId = item.tool_use_id;
    const functionName = findFunctionNameById(toolUseId, antigravityMessages);

    let resultContent = '';
    if (typeof item.content === 'string') {
      resultContent = item.content;
    } else if (Array.isArray(item.content)) {
      resultContent = item.content.filter(c => c.type === 'text').map(c => c.text).join('');
    }

    pushFunctionResponse(toolUseId, functionName, resultContent, antigravityMessages);
  }
}

function claudeMessageToAntigravity(claudeMessages, enableThinking, actualModelName, sessionId, hasTools) {
  const antigravityMessages = [];
  for (const message of claudeMessages) {
    if (message.role === 'user') {
      const content = message.content;
      if (Array.isArray(content) && content.some(item => item.type === 'tool_result')) {
        handleClaudeToolResult(message, antigravityMessages);
      } else {
        const extracted = extractImagesFromClaudeContent(content);
        pushUserMessage(extracted, antigravityMessages);
      }
    } else if (message.role === 'assistant') {
      handleClaudeAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, sessionId, hasTools);
    }
  }
  return antigravityMessages;
}

export function generateClaudeRequestBody(claudeMessages, modelName, parameters, claudeTools, systemPrompt, token) {
  const enableThinking = isEnableThinking(modelName);
  const actualModelName = modelMapping(modelName);
  // 直接传递用户的系统提示词，让 buildSystemInstruction 处理所有合并逻辑
  // 包括反重力官方提示词、萌萌提示词和用户提示词的位置配置

  const tools = convertClaudeToolsToAntigravity(claudeTools, token.sessionId, actualModelName);
  const hasTools = tools && tools.length > 0;

  return buildRequestBody({
    contents: claudeMessageToAntigravity(claudeMessages, enableThinking, actualModelName, token.sessionId, hasTools),
    tools: tools,
    generationConfig: generateGenerationConfig(parameters, enableThinking, actualModelName),
    sessionId: token.sessionId,
    systemInstruction: systemPrompt
  }, token, actualModelName);
}
