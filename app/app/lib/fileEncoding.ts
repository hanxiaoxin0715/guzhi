/**
 * 文件编码检测与文本读取工具
 *
 * 支持编码（按检测顺序）：
 *  1. UTF-8 BOM (EF BB BF) → UTF-8 解码并剥离 BOM
 *  2. UTF-16 LE BOM (FF FE) → UTF-16 LE 解码
 *  3. UTF-16 BE BOM (FE FF) → UTF-16 BE 解码
 *  4. 无 BOM UTF-16 启发式检测（大量 0x00 字节）
 *  5. UTF-8 优先尝试（\uFFFD 替换字符 > 2% 视为非 UTF-8）
 *  6. GBK / GB2312 / GB18030 回退
 *
 * 典型场景：
 *  - Windows 记事本 "另存为 → UTF-8" → UTF-8 BOM
 *  - Windows 记事本 "另存为 → Unicode" → UTF-16 LE BOM
 *  - Windows 记事本 "另存为 → ANSI" → GBK（中文系统）
 *  - Excel 导出 CSV → 通常 GBK（中文 Windows）或 UTF-8 BOM
 *  - macOS 文本编辑 → 默认 UTF-8 无 BOM
 */

/**
 * 读取 File 对象的文本内容，自动检测文件编码。
 * 适用于浏览器端 <input type="file"> 读取的文件。
 */
export async function readFileWithEncoding(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return decodeBuffer(buf);
}

/**
 * 解码 ArrayBuffer 为字符串，自动检测编码。
 * 可直接用于任何拿到 ArrayBuffer 的场景。
 */
export function decodeBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);

  // ── 1. BOM 检测（最可靠的编码标识） ──

  // UTF-8 BOM: EF BB BF
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder("utf-8").decode(bytes.slice(3));
  }
  // UTF-16 LE BOM: FF FE
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder("utf-16le").decode(bytes.slice(2));
  }
  // UTF-16 BE BOM: FE FF
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder("utf-16be").decode(bytes.slice(2));
  }

  // ── 2. 无 BOM 的 UTF-16 启发式检测 ──
  // UTF-16 文本中 ASCII 范围字符的高/低字节为 0x00，
  // 如果前 512 字节中 0x00 超过 25%，大概率是 UTF-16
  if (bytes.length >= 4) {
    let nullCount = 0;
    const sampleSize = Math.min(bytes.length, 512);
    for (let i = 0; i < sampleSize; i++) {
      if (bytes[i] === 0x00) nullCount++;
    }
    if (nullCount > sampleSize * 0.25) {
      // 偶数位多 0x00 → LE；奇数位多 0x00 → BE
      let evenNulls = 0, oddNulls = 0;
      for (let i = 0; i < sampleSize; i++) {
        if (bytes[i] === 0x00) {
          if (i % 2 === 0) evenNulls++;
          else oddNulls++;
        }
      }
      const encoding = oddNulls >= evenNulls ? "utf-16le" : "utf-16be";
      try {
        return new TextDecoder(encoding).decode(bytes);
      } catch { /* 降级继续 */ }
    }
  }

  // ── 3. UTF-8 优先尝试 ──
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const replacements = (utf8.match(/\uFFFD/g) || []).length;
  // 替换字符超过文本长度 2%（且文本 > 20 字符）→ 不是有效 UTF-8
  const isMojibake = utf8.length > 20 && replacements > utf8.length * 0.02;
  if (!isMojibake) {
    // 剥离可能残留的 BOM 字符（某些工具在无 BOM 标记时也会插入 \uFEFF）
    return utf8.replace(/^\uFEFF/, "");
  }

  // ── 4. 回退 GBK ──
  try {
    return new TextDecoder("gbk", { fatal: false }).decode(buf);
  } catch {
    // 浏览器不支持 GBK 解码器时保底返回 UTF-8 结果
    return utf8;
  }
}
