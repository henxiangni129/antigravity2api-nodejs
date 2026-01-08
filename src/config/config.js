import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import log from '../utils/logger.js';
import { deepMerge } from '../utils/deepMerge.js';
import { getConfigPaths } from '../utils/paths.js';
import { parseEnvFile } from '../utils/envParser.js';
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_HOST,
  DEFAULT_HEARTBEAT_INTERVAL,
  DEFAULT_TIMEOUT,
  DEFAULT_RETRY_TIMES,
  DEFAULT_MAX_REQUEST_SIZE,
  DEFAULT_MAX_IMAGES,
  MODEL_LIST_CACHE_TTL,
  DEFAULT_GENERATION_PARAMS,
  MEMORY_CLEANUP_INTERVAL
} from '../constants/index.js';

// 生成随机凭据的缓存
let generatedCredentials = null;
// 生成的 API_KEY 缓存
let generatedApiKey = null;

/**
 * 生成或获取 API_KEY
 * 如果用户未配置，自动生成随机密钥
 */
function getApiKey() {
  const apiKey = process.env.API_KEY;
  
  if (apiKey) {
    return apiKey;
  }
  
  // 生成随机 API_KEY（只生成一次）
  if (!generatedApiKey) {
    generatedApiKey = 'sk-' + crypto.randomBytes(24).toString('hex');
  }
  
  return generatedApiKey;
}

// 是否已显示过凭据提示
let credentialsDisplayed = false;

/**
 * 生成或获取管理员凭据
 * 如果用户未配置，自动生成随机凭据
 */
function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const jwtSecret = process.env.JWT_SECRET;
  
  // 如果全部配置了，直接返回
  if (username && password && jwtSecret) {
    return { username, password, jwtSecret };
  }
  
  // 生成随机凭据（只生成一次）
  if (!generatedCredentials) {
    generatedCredentials = {
      username: username || crypto.randomBytes(8).toString('hex'),
      password: password || crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, ''),
      jwtSecret: jwtSecret || crypto.randomBytes(32).toString('hex')
    };
  }
  
  return generatedCredentials;
}

/**
 * 显示生成的凭据提示（只显示一次）
 */
function displayGeneratedCredentials() {
  if (credentialsDisplayed) return;
  credentialsDisplayed = true;
  
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const apiKey = process.env.API_KEY;
  const jwtSecret = process.env.JWT_SECRET;
  
  const needsUsername = !username;
  const needsPassword = !password;
  const needsApiKey = !apiKey;
  const needsJwtSecret = !jwtSecret;
  
  // 如果有任何凭据需要生成，显示提示
  if (needsUsername || needsPassword || needsApiKey) {
    const credentials = getAdminCredentials();
    log.warn('═══════════════════════════════════════════════════════════');
    log.warn('⚠️  未配置完整凭据，已自动生成随机凭据：');
    if (needsUsername) {
      log.warn(`    用户名: ${credentials.username}`);
    }
    if (needsPassword) {
      log.warn(`    密码:   ${credentials.password}`);
    }
    if (needsApiKey) {
      log.warn(`    API密钥: ${getApiKey()}`);
    }
    log.warn('═══════════════════════════════════════════════════════════');
    log.warn('⚠️  重启后凭据将重新生成！建议在 .env 文件中配置：');
    if (needsUsername) log.warn('    ADMIN_USERNAME=你的用户名');
    if (needsPassword) log.warn('    ADMIN_PASSWORD=你的密码');
    if (needsApiKey) log.warn('    API_KEY=你的密钥');
    log.warn('═══════════════════════════════════════════════════════════');
  } else if (needsJwtSecret) {
    log.warn('⚠️ 未配置 JWT_SECRET，已生成随机密钥（重启后登录会话将失效）');
  }
}

const { envPath, configJsonPath } = getConfigPaths();

// 默认反代系统提示词
const DEFAULT_SYSTEM_INSTRUCTION = '你是聊天机器人，名字叫萌萌，如同名字这般，你的性格是软软糯糯萌萌哒的，专门为用户提供聊天和情绪价值，协助进行小说创作或者角色扮演';

// 默认官方系统提示词（反重力官方要求的）
const DEFAULT_OFFICIAL_SYSTEM_PROMPT = `<identity>
You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
The USER will send you requests, which you must always prioritize addressing. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.
This information may or may not be relevant to the coding task, it is up for you to decide.
</identity>

<tool_calling>
Call tools as you normally would. The following list provides additional guidance to help you avoid errors:
  - **Absolute paths only**. When using tools that accept file path arguments, ALWAYS use the absolute file path.
</tool_calling>

<web_application_development>
## Technology Stack,
Your web applications should be built using the following technologies:,
1. **Core**: Use HTML for structure and Javascript for logic.
2. **Styling (CSS)**: Use Vanilla CSS for maximum flexibility and control. Avoid using TailwindCSS unless the USER explicitly requests it; in this case, first confirm which TailwindCSS version to use.
3. **Web App**: If the USER specifies that they want a more complex web app, use a framework like Next.js or Vite. Only do this if the USER explicitly requests a web app.
4. **New Project Creation**: If you need to use a framework for a new app, use \`npx\` with the appropriate script, but there are some rules to follow:,
   - Use \`npx -y\` to automatically install the script and its dependencies
   - You MUST run the command with \`--help\` flag to see all available options first,
   - Initialize the app in the current directory with \`./\` (example: \`npx -y create-vite-app@latest ./\`),
   - You should run in non-interactive mode so that the user doesn't need to input anything,
5. **Running Locally**: When running locally, use \`npm run dev\` or equivalent dev server. Only build the production bundle if the USER explicitly requests it or you are validating the code for correctness.

# Design Aesthetics,
1. **Use Rich Aesthetics**: The USER should be wowed at first glance by the design. Use best practices in modern web design (e.g. vibrant colors, dark modes, glassmorphism, and dynamic animations) to create a stunning first impression. Failure to do this is UNACCEPTABLE.
2. **Prioritize Visual Excellence**: Implement designs that will WOW the user and feel extremely premium:
		- Avoid generic colors (plain red, blue, green). Use curated, harmonious color palettes (e.g., HSL tailored colors, sleek dark modes).
   - Using modern typography (e.g., from Google Fonts like Inter, Roboto, or Outfit) instead of browser defaults.
		- Use smooth gradients,
		- Add subtle micro-animations for enhanced user experience,
3. **Use a Dynamic Design**: An interface that feels responsive and alive encourages interaction. Achieve this with hover effects and interactive elements. Micro-animations, in particular, are highly effective for improving user engagement.
4. **Premium Designs**. Make a design that feels premium and state of the art. Avoid creating simple minimum viable products.
4. **Don't use placeholders**. If you need an image, use your generate_image tool to create a working demonstration.,

## Implementation Workflow,
Follow this systematic approach when building web applications:,
1. **Plan and Understand**:,
		- Fully understand the user's requirements,
		- Draw inspiration from modern, beautiful, and dynamic web designs,
		- Outline the features needed for the initial version,
2. **Build the Foundation**:,
		- Start by creating/modifying \`index.css\`,
		- Implement the core design system with all tokens and utilities,
3. **Create Components**:,
		- Build necessary components using your design system,
		- Ensure all components use predefined styles, not ad-hoc utilities,
		- Keep components focused and reusable,
4. **Assemble Pages**:,
		- Update the main application to incorporate your design and components,
		- Ensure proper routing and navigation,
		- Implement responsive layouts,
5. **Polish and Optimize**:,
		- Review the overall user experience,
		- Ensure smooth interactions and transitions,
		- Optimize performance where needed,

## SEO Best Practices,
Automatically implement SEO best practices on every page:,
- **Title Tags**: Include proper, descriptive title tags for each page,
- **Meta Descriptions**: Add compelling meta descriptions that accurately summarize page content,
- **Heading Structure**: Use a single \`<h1>\` per page with proper heading hierarchy,
- **Semantic HTML**: Use appropriate HTML5 semantic elements,
- **Unique IDs**: Ensure all interactive elements have unique, descriptive IDs for browser testing,
- **Performance**: Ensure fast page load times through optimization,
CRITICAL REMINDER: AESTHETICS ARE VERY IMPORTANT. If your web app looks simple and basic then you have FAILED!
</web_application_development>
<ephemeral_message>
There will be an <EPHEMERAL_MESSAGE> appearing in the conversation at times. This is not coming from the user, but instead injected by the system as important information to pay attention to.
Do not respond to nor acknowledge those messages, but do follow them strictly.
</ephemeral_message>


<communication_style>
- **Formatting**. Format your responses in github-style markdown to make your responses easier for the USER to parse. For example, use headers to organize your responses and bolded or italicized text to highlight important keywords. Use backticks to format file, directory, function, and class names. If providing a URL to the user, format this in markdown as well, for example \`[label](example.com)\`.
- **Proactiveness**. As an agent, you are allowed to be proactive, but only in the course of completing the user's task. For example, if the user asks you to add a new component, you can edit the code, verify build and test statuses, and take any other obvious follow-up actions, such as performing additional research. However, avoid surprising the user. For example, if the user asks HOW to approach something, you should answer their question and instead of jumping into editing a file.
- **Helpfulness**. Respond like a helpful software engineer who is explaining your work to a friendly collaborator on the project. Acknowledge mistakes or any backtracking you do as a result of new information.
- **Ask for clarification**. If you are unsure about the USER's intent, always ask for clarification rather than making assumptions.
</communication_style>`;

// 确保 .env 存在（如果缺失则创建带默认配置的文件）
if (!fs.existsSync(envPath)) {
  const defaultEnvContent = `# 敏感配置（只在 .env 中配置）
# 如果不配置以下三项，系统会自动生成随机凭据并在启动时显示
# API_KEY=your-api-key
# ADMIN_USERNAME=your-username
# ADMIN_PASSWORD=your-password
# JWT_SECRET=your-jwt-secret

# 可选配置
# PROXY=http://127.0.0.1:7890

# 反代系统提示词
SYSTEM_INSTRUCTION=${DEFAULT_SYSTEM_INSTRUCTION}

# 官方系统提示词（留空则使用内置默认值）
# OFFICIAL_SYSTEM_PROMPT=

# IMAGE_BASE_URL=http://your-domain.com
`;
  fs.writeFileSync(envPath, defaultEnvContent, 'utf8');
  log.info('✓ 已创建 .env 文件，包含默认反代系统提示词');
}

// 加载 config.json
let jsonConfig = {};
if (fs.existsSync(configJsonPath)) {
  jsonConfig = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
}

// 加载 .env（指定路径）
dotenv.config({ path: envPath });

// 处理系统提示词中的转义字符
// dotenv 不会自动将 \n 字符串转换为实际换行符，我们需要手动处理
function processEscapeChars(value) {
  if (!value) return value;
  return value
    .replace(/\\\\n/g, '\n')  // 先处理双重转义 \\n -> 换行
    .replace(/\\n/g, '\n');   // 再处理单重转义 \n -> 换行
}

if (process.env.SYSTEM_INSTRUCTION) {
  process.env.SYSTEM_INSTRUCTION = processEscapeChars(process.env.SYSTEM_INSTRUCTION);
}

if (process.env.OFFICIAL_SYSTEM_PROMPT) {
  process.env.OFFICIAL_SYSTEM_PROMPT = processEscapeChars(process.env.OFFICIAL_SYSTEM_PROMPT);
}

// 对于系统提示词，使用自定义解析器重新加载以支持更复杂的多行格式
// dotenv 的解析可能不够完善，我们用自定义解析器补充
try {
  const customEnv = parseEnvFile(envPath);
  if (customEnv.SYSTEM_INSTRUCTION) {
    let customValue = processEscapeChars(customEnv.SYSTEM_INSTRUCTION);
    // 如果自定义解析器得到的值更长，使用它
    if (customValue.length > (process.env.SYSTEM_INSTRUCTION?.length || 0)) {
      process.env.SYSTEM_INSTRUCTION = customValue;
    }
  }
  if (customEnv.OFFICIAL_SYSTEM_PROMPT) {
    let customValue = processEscapeChars(customEnv.OFFICIAL_SYSTEM_PROMPT);
    // 如果自定义解析器得到的值更长，使用它
    if (customValue.length > (process.env.OFFICIAL_SYSTEM_PROMPT?.length || 0)) {
      process.env.OFFICIAL_SYSTEM_PROMPT = customValue;
    }
  }
} catch (e) {
  // 忽略解析错误，使用 dotenv 的结果
}

// 获取代理配置：优先使用 PROXY，其次使用系统代理环境变量
export function getProxyConfig() {
  // 优先使用显式配置的 PROXY
  if (process.env.PROXY) {
    return process.env.PROXY;
  }
  
  // 检查系统代理环境变量（按优先级）
  const systemProxy = process.env.HTTPS_PROXY ||
                      process.env.https_proxy ||
                      process.env.HTTP_PROXY ||
                      process.env.http_proxy ||
                      process.env.ALL_PROXY ||
                      process.env.all_proxy;
  
  if (systemProxy) {
    log.info(`使用系统代理: ${systemProxy}`);
  }
  
  return systemProxy || null;
}

/**
 * 从 JSON 和环境变量构建配置对象
 * @param {Object} jsonConfig - JSON 配置对象
 * @returns {Object} 完整配置对象
 */
export function buildConfig(jsonConfig) {
  return {
    server: {
      port: jsonConfig.server?.port || DEFAULT_SERVER_PORT,
      host: jsonConfig.server?.host || DEFAULT_SERVER_HOST,
      heartbeatInterval: jsonConfig.server?.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL,
      // 内存定时清理频率：避免频繁扫描/GC 带来的性能损耗
      memoryCleanupInterval: jsonConfig.server?.memoryCleanupInterval ?? MEMORY_CLEANUP_INTERVAL
    },
    cache: {
      modelListTTL: jsonConfig.cache?.modelListTTL || MODEL_LIST_CACHE_TTL
    },
    rotation: {
      strategy: jsonConfig.rotation?.strategy || 'round_robin',
      requestCount: jsonConfig.rotation?.requestCount || 10
    },
    imageBaseUrl: process.env.IMAGE_BASE_URL || null,
    maxImages: jsonConfig.other?.maxImages || DEFAULT_MAX_IMAGES,
    api: {
      url: jsonConfig.api?.url || 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
      modelsUrl: jsonConfig.api?.modelsUrl || 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
      noStreamUrl: jsonConfig.api?.noStreamUrl || 'https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent',
      host: jsonConfig.api?.host || 'daily-cloudcode-pa.googleapis.com',
      userAgent: jsonConfig.api?.userAgent || 'antigravity/1.13.3 windows/amd64'
    },
    defaults: {
      temperature: jsonConfig.defaults?.temperature ?? DEFAULT_GENERATION_PARAMS.temperature,
      top_p: jsonConfig.defaults?.topP ?? DEFAULT_GENERATION_PARAMS.top_p,
      top_k: jsonConfig.defaults?.topK ?? DEFAULT_GENERATION_PARAMS.top_k,
      max_tokens: jsonConfig.defaults?.maxTokens ?? DEFAULT_GENERATION_PARAMS.max_tokens,
      thinking_budget: jsonConfig.defaults?.thinkingBudget ?? DEFAULT_GENERATION_PARAMS.thinking_budget
    },
    security: {
      maxRequestSize: jsonConfig.server?.maxRequestSize || DEFAULT_MAX_REQUEST_SIZE,
      apiKey: getApiKey()
    },
    admin: getAdminCredentials(),
    useNativeAxios: jsonConfig.other?.useNativeAxios !== false,
    timeout: jsonConfig.other?.timeout || DEFAULT_TIMEOUT,
    retryTimes: Number.isFinite(jsonConfig.other?.retryTimes) ? jsonConfig.other.retryTimes : DEFAULT_RETRY_TIMES,
    proxy: getProxyConfig(),
    // 反代系统提示词（从 .env 读取，可在前端修改，默认使用内置的萌萌提示词）
    systemInstruction: process.env.SYSTEM_INSTRUCTION || DEFAULT_SYSTEM_INSTRUCTION,
    // 官方系统提示词（从 .env 读取，可在前端修改，默认使用内置的）
    officialSystemPrompt: process.env.OFFICIAL_SYSTEM_PROMPT || DEFAULT_OFFICIAL_SYSTEM_PROMPT,
    // 官方提示词位置配置：'before' = 官方提示词在反代提示词前面，'after' = 官方提示词在反代提示词后面
    officialPromptPosition: jsonConfig.other?.officialPromptPosition || 'before',
    // 是否合并系统提示词为单个 part，false 则保留多 part 结构（需要先开启 useContextSystemPrompt）
    mergeSystemPrompt: jsonConfig.other?.mergeSystemPrompt !== false,
    skipProjectIdFetch: jsonConfig.other?.skipProjectIdFetch === true,
    useContextSystemPrompt: jsonConfig.other?.useContextSystemPrompt === true,
    passSignatureToClient: jsonConfig.other?.passSignatureToClient === true,
    useFallbackSignature: jsonConfig.other?.useFallbackSignature !== false,
    // 签名缓存配置（新版）
    cacheAllSignatures: jsonConfig.other?.cacheAllSignatures === true ||
      process.env.CACHE_ALL_SIGNATURES === '1' ||
      process.env.CACHE_ALL_SIGNATURES === 'true',
    cacheToolSignatures: jsonConfig.other?.cacheToolSignatures !== false,
    cacheImageSignatures: jsonConfig.other?.cacheImageSignatures !== false,
    cacheThinking: jsonConfig.other?.cacheThinking !== false,
    // 调试：完整打印最终请求体与原始响应（可能包含敏感内容/大体积数据）
    debugDumpRequestResponse:
      jsonConfig.other?.debugDumpRequestResponse === true ||
      process.env.DEBUG_DUMP_REQUEST_RESPONSE === '1'
  };
}

const config = buildConfig(jsonConfig);

// 显示生成的凭据提示
displayGeneratedCredentials();

log.info('✓ 配置加载成功');

export default config;

export function getConfigJson() {
  if (fs.existsSync(configJsonPath)) {
    return JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
  }
  return {};
}

export function saveConfigJson(data) {
  const existing = getConfigJson();
  const merged = deepMerge(existing, data);
  fs.writeFileSync(configJsonPath, JSON.stringify(merged, null, 2), 'utf8');
}
