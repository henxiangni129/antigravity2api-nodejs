import fs from 'fs';

/**
 * 解析 .env 文件内容为对象
 * 支持多行字符串（用双引号或单引号包裹）
 */
export function parseEnvFile(filePath) {
  const envData = {};
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  let currentKey = null;
  let currentValue = '';
  let inMultiline = false;
  let quoteChar = null;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    if (inMultiline) {
      // 继续收集多行值
      currentValue += '\n' + line;
      // 检查是否结束（以引号结尾）
      if (line.trimEnd().endsWith(quoteChar)) {
        // 移除结尾引号
        currentValue = currentValue.slice(0, -1);
        envData[currentKey] = currentValue;
        inMultiline = false;
        currentKey = null;
        currentValue = '';
        quoteChar = null;
      }
    } else {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;
      
      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1);
      
      // 检查是否是引号开头的多行字符串
      const trimmedValue = value.trimStart();
      if ((trimmedValue.startsWith('"') || trimmedValue.startsWith("'")) &&
          !trimmedValue.endsWith(trimmedValue[0])) {
        // 多行字符串开始
        quoteChar = trimmedValue[0];
        currentKey = key;
        currentValue = trimmedValue.slice(1); // 移除开头引号
        inMultiline = true;
      } else {
        // 单行值，移除可能的引号
        value = value.trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        envData[key] = value;
      }
    }
  }
  
  // 处理未闭合的多行字符串
  if (inMultiline && currentKey) {
    envData[currentKey] = currentValue;
  }
  
  return envData;
}

/**
 * 更新 .env 文件中的键值对
 */
export function updateEnvFile(filePath, updates) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  Object.entries(updates).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  });
  
  fs.writeFileSync(filePath, content, 'utf8');
}
