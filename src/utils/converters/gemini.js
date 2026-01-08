// Gemini 格式转换工具
import config from '../../config/config.js';
import { generateRequestId } from '../idGenerator.js';
import { convertGeminiToolsToAntigravity } from '../toolConverter.js';
import { getSignatureContext, createThoughtPart, modelMapping, isEnableThinking, buildSystemInstruction } from './common.js';
import { normalizeGeminiParameters, toGenerationConfig } from '../parameterNormalizer.js';

/**
 * 为 functionCall 生成唯一 ID
 */
function generateFunctionCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 处理 functionCall 和 functionResponse 的 ID 匹配
 */
function processFunctionCallIds(contents) {
  const functionCallIds = [];
  
  // 收集所有 functionCall 的 ID
  contents.forEach(content => {
    if (content.role === 'model' && content.parts && Array.isArray(content.parts)) {
      content.parts.forEach(part => {
        if (part.functionCall) {
          if (!part.functionCall.id) {
            part.functionCall.id = generateFunctionCallId();
          }
          functionCallIds.push(part.functionCall.id);
        }
      });
    }
  });

  // 为 functionResponse 分配对应的 ID
  let responseIndex = 0;
  contents.forEach(content => {
    if (content.role === 'user' && content.parts && Array.isArray(content.parts)) {
      content.parts.forEach(part => {
        if (part.functionResponse) {
          if (!part.functionResponse.id && responseIndex < functionCallIds.length) {
            part.functionResponse.id = functionCallIds[responseIndex];
            responseIndex++;
          }
        }
      });
    }
  });
}

/**
 * 处理 model 消息中的 thought 和签名
 */
function processModelThoughts(content, reasoningSignature, reasoningContent, toolSignature, toolContent, enableThinking) {
  const parts = content.parts;
  const fallbackSig = reasoningSignature || toolSignature;
  const fallbackContent = (fallbackSig === reasoningSignature) ? (reasoningContent || ' ') : (toolContent || ' ');

  // 非思考模型：仅为 inlineData 自动补签名（避免历史消息回放时报缺签名）
  if (!enableThinking) {
    if (!fallbackSig) return;
    for (const part of parts) {
      if (part.inlineData && !part.thoughtSignature) {
        part.thoughtSignature = fallbackSig;
      }
    }
    return;
  }

  const isStandaloneSignaturePart = (part) =>
    part &&
    part.thoughtSignature &&
    !part.thought &&
    !part.functionCall &&
    !part.functionResponse &&
    !part.text &&
    !part.inlineData;
  
  // 查找 thought 和独立 thoughtSignature 的位置
  let thoughtIndex = -1;
  let signatureIndex = -1;
  let signatureValue = null;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.thought === true && !part.thoughtSignature) {
      thoughtIndex = i;
    }
    if (isStandaloneSignaturePart(part)) {
      signatureIndex = i;
      signatureValue = part.thoughtSignature;
    }
  }
  
  // 合并或添加 thought 和签名
  if (thoughtIndex !== -1 && signatureIndex !== -1) {
    parts[thoughtIndex].thoughtSignature = signatureValue;
    parts.splice(signatureIndex, 1);
  } else if (thoughtIndex !== -1 && signatureIndex === -1) {
    if (fallbackSig) parts[thoughtIndex].thoughtSignature = fallbackSig;
  } else if (thoughtIndex === -1 && fallbackSig) {
    // 只有在有签名时才添加 thought part，避免 API 报错
    // 使用与签名绑定的缓存内容
    parts.unshift(createThoughtPart(fallbackContent, fallbackSig));
  }
  
  // 收集独立的签名 parts（用于 functionCall）
  const standaloneSignatures = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (isStandaloneSignaturePart(part)) {
      standaloneSignatures.unshift({ index: i, signature: part.thoughtSignature });
    }
  }
  
  // 为 functionCall / inlineData 分配签名
  let sigIndex = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if ((!part.thoughtSignature) && (part.functionCall || part.inlineData)) {
      if (sigIndex < standaloneSignatures.length) {
        part.thoughtSignature = standaloneSignatures[sigIndex].signature;
        sigIndex++;
        continue;
      }

      // functionCall 更倾向 toolSignature；inlineData 更倾向 reasoningSignature
      const partFallback = part.functionCall ? (toolSignature || reasoningSignature) : (reasoningSignature || toolSignature);
      if (partFallback) part.thoughtSignature = partFallback;
    }
  }
  
  // 移除已使用的独立签名 parts
  for (let i = standaloneSignatures.length - 1; i >= 0; i--) {
    if (i < sigIndex) {
      parts.splice(standaloneSignatures[i].index, 1);
    }
  }
}

export function generateGeminiRequestBody(geminiBody, modelName, token) {
  const enableThinking = isEnableThinking(modelName);
  const actualModelName = modelMapping(modelName);
  const request = JSON.parse(JSON.stringify(geminiBody));

  if (request.contents && Array.isArray(request.contents)) {
    processFunctionCallIds(request.contents);

    // 转换工具定义（需要在获取签名前完成，以便判断 hasTools）
    if (request.tools && Array.isArray(request.tools)) {
      request.tools = convertGeminiToolsToAntigravity(request.tools, token.sessionId, actualModelName);
    }
    
    const hasTools = request.tools && request.tools.length > 0;
    const { reasoningSignature, reasoningContent, toolSignature, toolContent } = getSignatureContext(token.sessionId, actualModelName, hasTools);

    request.contents.forEach(content => {
      if (content.role === 'model' && content.parts && Array.isArray(content.parts)) {
        processModelThoughts(content, reasoningSignature, reasoningContent, toolSignature, toolContent, enableThinking);
      }
    });
  }

  // 使用统一参数规范化模块处理 Gemini 格式参数
  const normalizedParams = normalizeGeminiParameters(request.generationConfig || {});
  
  // 转换为 generationConfig 格式
  request.generationConfig = toGenerationConfig(normalizedParams, enableThinking, actualModelName);
  request.sessionId = token.sessionId;
  delete request.safetySettings;
  
  // 添加工具配置
  if (request.tools && request.tools.length > 0 && !request.toolConfig) {
    request.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
  }

  // 使用新的系统提示词构建函数，支持多 part 结构和位置配置
  const existingSystemInstruction = request.systemInstruction;
  const systemInstructionObj = buildSystemInstruction(existingSystemInstruction);
  if (systemInstructionObj) {
    request.systemInstruction = systemInstructionObj;
  } else {
    delete request.systemInstruction;
  }
  
  //console.log(JSON.stringify(request, null, 2))

  const requestBody = {
    project: token.projectId,
    requestId: generateRequestId(),
    request: request,
    model: actualModelName,
    userAgent: 'antigravity'
  };

  return requestBody;
}
