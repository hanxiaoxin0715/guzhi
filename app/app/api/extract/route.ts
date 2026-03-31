import { NextResponse } from "next/server";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getBaseOutputDir } from "@/app/lib/paths";
import { twoPhaseExtract, type TwoPhaseConfig } from "@/app/lib/twoPhaseExtract";
import { buildSinglePassCharacterRules, buildSinglePassSceneRules, buildSinglePassPropRules } from "@/app/lib/refSheetPrompts";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 分钟 — 匹配前端 EXTRACT_TIMEOUT_MS，thinking 模型大剧本需要 2-4 分钟

// Single-pass extraction prompt — NOT the interactive two-phase template file
// Exported so /api/prompts can serve it as the default extract prompt for the editor UI
export const SINGLE_PASS_EXTRACT_PROMPT = [
  "# Role",
  "你是一位顶级好莱坞概念美术指导兼 AI 绘画提示词大师。你擅长从CG电影、游戏原画、概念设计的角度拆解视觉元素，并为每个元素生成**专业级规范设定图页面（Specification Sheet）**的英文 Prompt。",
  "",
  "# 核心质感原则（★每条 Prompt 必须贯彻★）",
  "- 所有 Prompt 必须包含电影级质感修饰词：masterpiece, best quality, ultra detailed, cinematic quality",
  "- 角色必须美观、符合大众审美：五官精致立体、皮肤细腻、发型层次分明、服装材质细节丰富（PBR材质、布料纹理、金属光泽），Prompt 必须包含 beautiful, attractive, refined facial features",
  "- 场景必须磅礴化：史诗级规模感、体积光、大气散射、环境叙事感",
  "- 道具必须精致化：微距级细节、材质质感（磨砂/抛光/氧化/腐蚀）、设计感",
  "",
  "# Extraction Rules（严格遵守）",
  "",
  "## 中英内容同步规则（★最高优先级 — 与提取范围同级★）",
  "- 每个条目的 description（中文）字段必须是对应 prompt（英文）字段的**完整逐句中文翻译版**",
  "- description 必须包含 prompt 中的全部面板布局描述、色板HEX数值、质感描述词、页面结构标注",
  "- ★ 两字段内容必须一一对应，中文不得省略英文中的任何结构信息 ★",
  "- 生成策略：先构思完整的英文 prompt → 再将英文逐句翻译为中文作为 description",
  "",
  "## 0. 提取范围规则（★最高优先级★）",
  "- 提取所有在文本中**有名字**的角色（包括仅被提及一次的次要角色）",
  "- 提取所有**有台词或对话**的角色（即使只有一句话）",
  "- 提取所有**有明确外观描述**的角色（哪怕是路人，只要文本描写了其外貌）",
  "- 不要遗漏次要角色、反派、配角、群众角色",
  "- 只有完全无名、无台词、无外观描述的纯背景人物才可以忽略",
  "- 场景和道具同理：所有有名称或有描述的场景/道具都必须提取，不得遗漏",
  "",
  buildSinglePassCharacterRules(),
  "",
  "### 角色示例（定妆规范页面格式）：",
  '  {"name": "陈凌", "aliases": ["凌", "陈队长", "队长"], "description": "角色设计参考设定图，单一深灰色背景多视角展示，专业概念美术页面布局。陈凌，英俊30岁男性，185cm精壮运动体型，短碎黑发灰白鬓角，深灰色瞳孔，棱角分明下颌线，干净深灰色修身西装，白色衬衫，黑色德比皮鞋，中性冷静表情，干净完好状态。左上面板：面部特写肖像，精致五官细节，高度细节肌肤质感带微妙毛孔，中性冷静表情，干净无瑕肌肤。色板色块：#2C2C2C, #F5F5F5, #1A1A1A, #4A4A4A, #8B7355, #E8C4A0。中央三面板：正面、四分之三侧面、背面，全身站姿并排。右侧面板：全身正面站姿配金色人体轮廓剪影标注185cm。红色粗体标题：Character: 陈凌。底部行：四个矩形细节特写面板——面部妆容、西装翻领、衬衫领口、皮鞋材质。工作室打光，8K，高度细节，单一复合图像，杰作，最佳质量，超精细。", "prompt": "character design reference sheet, multiple views on single dark gray background, professional concept art page layout. Chen Ling, handsome 30-year-old male, 185cm lean athletic build, short messy black hair with grey temples, dark grey eyes, sharp angular jawline, clean dark grey slim-fit suit, white dress shirt, black derby shoes, neutral calm expression, clean pristine condition. Red bold title: \"Character: 陈凌\". Top-left panel labeled \"面部特写\": face close-up portrait, detailed facial features, refined features, highly detailed skin texture with subtle pores, neutral calm expression, clean unblemished skin. Color palette swatches below: #2C2C2C, #F5F5F5, #1A1A1A, #4A4A4A, #8B7355, #E8C4A0. Center three panels labeled \"正面\" / \"侧面\" / \"背面\": front view, three-quarter view, back view, full body standing poses side by side. Right panel labeled \"全身像\": full body front pose with golden human silhouette height chart marked 185cm. Bottom row: four rectangular detail close-up panels with Chinese labels — 面部妆容, 西装翻领, 衬衫领口, 皮鞋材质. Studio lighting, 8K, highly detailed, single composite image, masterpiece, best quality, ultra detailed."}',
  "",
  "### 角色形态拆分示例：",
  '  {"name": "孙悟空·石像形态", "aliases": ["石像", "石猴", "石像悟空", "猴王石像"], "description": "角色设计参考设定图，单一深灰色背景多视角展示，专业概念美术页面布局。孙悟空石像形态，巨型花岗岩猴王石像，莲台之上盘坐禅定姿态，青苔覆盖的风化裂纹，凹陷无光的眼窝，双手合十于胸前，灰褐色调。左上面板：面部特写，雕刻面部特征，凹陷眼窝，风化裂纹纹理，缝隙中的青苔。色板色块：#8B7D6B, #4A5D3C, #6B5C4D, #A09080, #3C4A35, #C0B0A0。中央三面板：正面、四分之三侧面、背面，全身姿态并排。右侧面板：全身正面配金色轮廓剪影标注300cm。红色粗体标题：Character: 孙悟空·石像形态。底部行：四个矩形细节面板——面部雕刻纹理、莲台雕纹、手臂青苔与裂纹、基座石材风化。工作室打光，8K，高度细节，单一复合图像，杰作，最佳质量，超精细。", "prompt": "character design reference sheet, multiple views on single dark gray background, professional concept art page layout. Sun Wukong stone statue form, giant granite monkey king statue, meditation pose on ornate lotus pedestal, moss-covered weathered cracks, hollow eye sockets, hands clasped at chest, grey-brown tone. Red bold title: \"Character: 孙悟空·石像形态\". Top-left panel labeled \"面部特写\": face close-up, carved facial features, hollow eye sockets, weathered crack textures, moss in crevices. Color palette swatches below: #8B7D6B, #4A5D3C, #6B5C4D, #A09080, #3C4A35, #C0B0A0. Center three panels labeled \"正面\" / \"侧面\" / \"背面\": front view, three-quarter view, back view, full body poses side by side. Right panel labeled \"全身像\": full body front with golden silhouette height chart marked 300cm. Bottom row: four rectangular detail panels with Chinese labels — 面部雕刻, 莲台雕纹, 手臂青苔, 基座风化. Studio lighting, 8K, highly detailed, single composite image, masterpiece, best quality, ultra detailed."}',
  "",
  buildSinglePassSceneRules(),
  "",
  "### 场景示例（规范页面格式）：",
  `  {"name": "地下实验室", "aliases": ["实验室", "地下室", "地底实验室"], "description": "场景设计概念美术参考设定图，单一图像多面板布局，专业页面布局，无人物。地下实验室 — Underground Laboratory。巨大洞穴式工业混凝土空间，锈蚀管道与闪烁青绿灯光。红色粗体标题：Scene: 地下实验室。顶部行：四个小缩略图——正面、侧面、俯视、低角度，各有标注。左侧列：三个纵向面板——白天（晴天）明亮顶部工业灯光、黄昏（阴天）仅应急照明、夜晚（雾天）闪烁青绿荧光与大气雾效，各有标注。中央：大尺寸主图，巨大混凝土空间，中央钢制工作台散落碎裂试管，墙面延伸锈蚀管道，青绿荧光投射不均匀阴影，尘土弥漫氛围。底部行：四个圆形细节特写——荧光灯管、锈蚀管道腐蚀纹理、开裂混凝土地面、碎裂玻璃试管，各有标注。右侧边栏：色板——主色：Deep Concrete Grey, Rust Brown, Industrial Green；辅色：Pipe Copper, Dust Beige, Shadow Black；点缀色：Cyan Fluorescent, Emergency Red。单一复合图像，高度细节，电影级打光，8K，杰作，最佳质量。", "prompt": "scene design concept art reference sheet, multiple panels on single image, professional page layout, no people, no humans. Underground Laboratory — 地下实验室. Vast cavernous industrial concrete space with corroded pipes and flickering cyan lights. Red bold title: \"Scene: 地下实验室\". Top row: four small thumbnails — front view, side view, top-down view, low-angle view, each labeled. Left column: three vertical panels — \"Daytime (Clear)\" bright overhead industrial lights, \"Dusk (Cloudy)\" dim emergency lighting only, \"Night (Foggy)\" flickering cyan fluorescent with atmospheric fog, each labeled. Center: large main image, vast concrete chamber, central steel workbench with broken test tubes, corroded rusty pipes along walls, cyan-green fluorescent casting uneven shadows, dusty atmosphere. Bottom row: four circular detail close-ups — fluorescent tube light, rusty pipe corrosion texture, cracked concrete floor, broken glass test tubes, each labeled. Right sidebar: color palette — Primary: Deep Concrete Grey, Rust Brown, Industrial Green; Secondary: Pipe Copper, Dust Beige, Shadow Black; Accent: Cyan Fluorescent, Emergency Red. Single composite image, highly detailed, cinematic lighting, 8K, masterpiece, best quality."}`,
  "",
  buildSinglePassPropRules(),
  "",
  "### 道具示例（规格参考表格式）：",
  '  {"name": "信号追踪器", "aliases": ["追踪器", "信号仪", "定位设备"], "description": "道具设计参考，道具设计规格参考表，多角度，详细物品图，标注面板，单一复合图像。红色粗体标题：Prop: 信号追踪器。巴掌大小哑光黑色阳极氧化金属设备，2英寸圆形OLED屏幕。上方一排：正面标注Front、侧面标注Side、背面标注Rear、俯视标注Top。中央：大尺寸英雄镜头，精密铣削六角形散热孔图案，2英寸OLED屏幕发射绿色脉冲波形，拉丝铬旋钮。底部行：四个圆形微距特写面板——六角形散热孔纹理、OLED屏幕辉光、拉丝金属表面、磁吸快拆卡扣，各有标注。右侧：色板+尺寸标注。8K，杰作，最佳质量，超精细，无手，无人物。", "prompt": "prop design reference, prop design specification sheet, multiple angles, detailed item sheet, labeled panels, single composite image. Red bold title: \"Prop: 信号追踪器\". Palm-sized matte black anodized metal gadget, circular 2-inch OLED screen. Top row: front view labeled \"Front\", side view labeled \"Side\", rear view labeled \"Rear\", top view labeled \"Top\". Center: large hero shot, precision-milled hexagonal heat dissipation holes, OLED screen emitting green pulse waveform with subtle glow, brushed chrome rotary frequency dial. Bottom row: four circular macro detail panels — hexagonal holes micro-texture, OLED screen glow, brushed metal surface grain, magnetic quick-release clip, each labeled. Right sidebar: color palette + size annotation. 8K, masterpiece, best quality, ultra detailed, physically based rendering, no hands, no humans."}',
  "",
  "# Output",
  "严格返回以下JSON格式，不要输出任何其他文字、解释或markdown标记：",
  "{",
  '  "characters": [{"name": "...", "aliases": ["简称", "别名", "同义词"], "description": "...（英文prompt的完整中文翻译版，含面板布局+色板HEX值）", "prompt": "character design reference sheet, multiple views on single dark gray background, professional concept art page layout, single composite image, labeled panels. Red bold title: \"Character: [角色名]\". [角色名], [外貌/服装]. Top-left panel labeled \"面部特写\": face close-up. Color palette swatches below: [HEX...]. Center three panels labeled \"正面\" / \"侧面\" / \"背面\": front view, three-quarter view, back view. Right panel labeled \"全身像\": golden silhouette height chart [身高]cm. Bottom row: four rectangular detail panels with Chinese labels. Studio lighting, 8K, masterpiece, best quality, ultra detailed."}],',
  `  "scenes": [{"name": "...", "aliases": ["简称", "别名"], "description": "...（英文prompt的完整中文翻译版，含面板布局+色板）", "prompt": "scene design concept art reference sheet, multiple panels on single image, professional page layout, no people, no humans. Red bold title: \"Scene: [场景名]\". [场景描述]. Top row: four thumbnails. Left column: three lighting panels. Center: large main image. Bottom row: four circular details. Right sidebar: color palette. Single composite image, 8K, masterpiece, best quality."}],`,
  '  "props": [{"name": "...", "aliases": ["简称", "别名"], "description": "...（英文prompt的完整中文翻译版，含面板布局+材质描述）", "prompt": "prop design reference, prop design specification sheet, multiple angles, detailed item sheet, labeled panels, single composite image. Red bold title: \"Prop: [道具名]\". [道具描述]. Top row: angle views. Center: hero shot. Bottom row: circular macro details. Right sidebar: color palette. 8K, masterpiece, best quality, ultra detailed, no hands, no humans."}],',
  '  "style": {"artStyle": "推荐画风", "colorPalette": "推荐色调", "timeSetting": "时代/世界观背景，如：现代都市、古代中国、未来太空站、中世纪欧洲（仅填时代/世界观，不含具体时间段如早晨/夜晚，时间段将由AI根据剧本自动判断）"}',
  "}",
].join("\n");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, settings, customPrompt, stylePrompt } = body;

    const apiKey = settings?.["llm-key"] || "";
    const baseUrl = settings?.["llm-url"] || "https://api.geeknow.top/v1";
    const model = settings?.["llm-model"] || "gemini-2.5-pro";
    const isResponsesApi = (settings?.["llm-provider"] || "") === "dashscope-responses";

    // 判断是否使用用户自定义提示词（旧单阶段路径）
    const isInteractiveTemplate = customPrompt &&
      (customPrompt.includes("阶段一") || customPrompt.includes("触发条件") || customPrompt.includes("Phase 1") || customPrompt.includes("Interaction Protocol"));
    const useCustomPrompt = customPrompt && customPrompt.length > 50 && !isInteractiveTemplate;

    if (!apiKey) {
      return NextResponse.json(
        { error: "未配置 LLM API Key，请在「设置」页配置" },
        { status: 400 }
      );
    }

    if (!text || text.length < 20) {
      return NextResponse.json(
        { error: "文本内容过短（至少20字），请先在「剧本」页添加内容" },
        { status: 400 }
      );
    }

    // ═══════════════════════════════════════════════════════
    // 两阶段提取（默认路径 — Phase1 实体识别 + Phase2 并发 Prompt 生成）
    // 使用 SSE 流式推送进度事件，最后发送完整结果
    // ═══════════════════════════════════════════════════════
    if (!useCustomPrompt) {
      console.log(`[extract] TWO-PHASE mode: model=${model}, textLen=${text.length}, stylePrompt=${!!stylePrompt}`);

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          // SSE 辅助：发送进度事件
          function sendProgress(message: string) {
            const evt = `data: ${JSON.stringify({ type: "progress", message })}\n\n`;
            controller.enqueue(encoder.encode(evt));
          }

          try {
            const tpConfig: TwoPhaseConfig = {
              apiKey,
              baseUrl,
              model,
              isResponsesApi,
              stylePrompt: (stylePrompt && typeof stylePrompt === "string" && stylePrompt.length > 5) ? stylePrompt : undefined,
              onProgress: sendProgress,
            };

            const tpResult = await twoPhaseExtract(text, tpConfig);

            // 验证结果
            const hasData = (tpResult.characters?.length || 0) + (tpResult.scenes?.length || 0) + (tpResult.props?.length || 0) > 0;
            if (!hasData) {
              const errEvt = `data: ${JSON.stringify({ type: "error", error: "AI 两阶段提取未识别出任何角色/场景/道具，请检查文本内容是否包含可提取的视觉元素" })}\n\n`;
              controller.enqueue(encoder.encode(errEvt));
              controller.close();
              return;
            }

            // 写入调试日志
            try {
              const outDir = getBaseOutputDir();
              if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
              const logPath = join(outDir, "extract-debug.log");
              const timestamp = new Date().toISOString();
              const chars = tpResult.characters?.length || 0;
              const scenes = tpResult.scenes?.length || 0;
              const props = tpResult.props?.length || 0;
              const warnCount = tpResult.warnings?.length || 0;
              const logContent = `\n\n===== ${timestamp} [TWO-PHASE] =====\ncharacters=${chars}, scenes=${scenes}, props=${props}, warnings=${warnCount}\n${tpResult.warnings?.length ? "WARNINGS: " + tpResult.warnings.join(" | ") + "\n" : ""}${JSON.stringify(tpResult, null, 2).slice(0, 5000)}\n===== END =====\n`;
              writeFileSync(logPath, logContent, { flag: "a" });
            } catch (logErr) {
              console.error("[extract] Failed to write debug log:", logErr);
            }

            // 发送最终结果
            const resultEvt = `data: ${JSON.stringify({ type: "result", data: tpResult })}\n\n`;
            controller.enqueue(encoder.encode(resultEvt));
          } catch (err) {
            const errMsg = (err as Error).message || String(err);
            console.error("[extract] TWO-PHASE error:", errMsg);
            const errEvt = `data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`;
            controller.enqueue(encoder.encode(errEvt));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // ═══════════════════════════════════════════════════════
    // 旧单阶段提取路径（仅在用户提供有效自定义提示词时使用）
    // ═══════════════════════════════════════════════════════
    const systemPrompt = customPrompt!;
    console.log(`[extract] SINGLE-PASS mode (custom prompt): model=${model}, textLen=${text.length}, sysPromptLen=${systemPrompt.length}`);

    let url = baseUrl.replace(/\/+$/, "");
    if (isResponsesApi) {
      if (!url.endsWith("/responses")) url += "/responses";
    } else {
      if (!url.includes("/chat/completions")) url += "/chat/completions";
    }

    // Build user message, optionally prepending style reference
    // Send full text to LLM — modern models (Gemini 2.5 Pro, Qwen3-Max) support 128K+ context.
    // Truncating to 8K chars would lose critical plot details needed for accurate extraction.
    let userContent = "请从以下文本中提取角色、场景、道具信息，直接返回JSON：\n\n" + text;
    if (stylePrompt && typeof stylePrompt === "string" && stylePrompt.length > 5) {
      userContent = [
        `【风格参考 — 所有prompt都必须融入以下风格关键词以保持全局一致性】`,
        stylePrompt,
        `请在生成每个角色/场景/道具的英文prompt时，自然融入上述风格关键词（如画风、色调、氛围等），确保所有元素风格统一。`,
        ``,
        userContent,
      ].join("\n");
    }

    const requestMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];

    // Helper: make a streaming request
    async function fetchStreaming(): Promise<string> {
      const reqBody = isResponsesApi
        ? { model, input: requestMessages, max_output_tokens: 16384, stream: true, temperature: 0 }
        : { model, messages: requestMessages, max_tokens: 16384, temperature: 0, stream: true };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(240000), // 240s — thinking 模型需要较长时间处理大剧本
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const err = new Error("API 错误 (" + res.status + "): " + errText.slice(0, 300));
        (err as Error & { status: number }).status = res.status;
        throw err;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let result = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("event:")) continue;
          let jsonStr = trimmed;
          if (trimmed.startsWith("data: ")) jsonStr = trimmed.slice(6);
          else if (trimmed.startsWith("data:")) jsonStr = trimmed.slice(5);
          if (jsonStr === "[DONE]") { buffer = ""; continue; }
          try {
            const chunk = JSON.parse(jsonStr);
            if (isResponsesApi) {
              if (chunk.type === "response.output_text.delta" && chunk.delta) result += chunk.delta;
            } else {
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) result += delta;
            }
          } catch {
            /* skip malformed chunks */
          }
        }
      }
      // Process any remaining data in buffer after stream ends
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        let jsonStr = trimmed;
        if (trimmed.startsWith("data: ")) jsonStr = trimmed.slice(6);
        else if (trimmed.startsWith("data:")) jsonStr = trimmed.slice(5);
        if (jsonStr !== "[DONE]") {
          try {
            const chunk = JSON.parse(jsonStr);
            if (isResponsesApi) {
              if (chunk.type === "response.output_text.delta" && chunk.delta) result += chunk.delta;
            } else {
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) result += delta;
            }
          } catch { /* skip */ }
        }
      }
      return result;
    }

    // Helper: make a non-streaming request (fallback)
    async function fetchNonStreaming(): Promise<string> {
      const reqBody = isResponsesApi
        ? { model, input: requestMessages, max_output_tokens: 16384, temperature: 0 }
        : { model, messages: requestMessages, max_tokens: 16384, temperature: 0 };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(240000), // 240s — thinking 模型需要较长时间处理大剧本
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error("API 错误 (" + res.status + "): " + errText.slice(0, 300));
      }

      const data = await res.json();
      if (isResponsesApi) {
        let content = "";
        if (Array.isArray(data.output)) {
          for (const item of data.output) {
            if (Array.isArray(item.content)) {
              for (const c of item.content) {
                if (c.type === "output_text" && c.text) content += c.text;
              }
            }
          }
        }
        return content || data.output_text || "";
      }
      return data.choices?.[0]?.message?.content || "";
    }

    // Retry logic with streaming; fallback to non-streaming on 400
    const MAX_RETRIES = 1; // Total 2 attempts max (was 3, reduced to avoid 12min waits)
    let content = "";
    let lastErr = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[extract] Retrying attempt ${attempt} after ${3000 * attempt}ms delay...`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }

      // Strategy: first try streaming, then fallback to non-streaming on retry
      const useStreaming = attempt === 0; // First attempt: try streaming; retries: non-streaming
      const attemptStart = Date.now();

      try {
        if (useStreaming) {
          console.log(`[extract] attempt ${attempt}: streaming mode starting...`);
          content = await fetchStreaming();
        } else {
          console.log(`[extract] attempt ${attempt}: non-streaming mode starting...`);
          content = await fetchNonStreaming();
        }
        console.log(`[extract] attempt ${attempt}: completed in ${((Date.now() - attemptStart) / 1000).toFixed(1)}s, contentLen=${content.length}`);
        if (content.trim().length > 10) break; // Success
        lastErr = "AI 返回内容为空";
        if (attempt < MAX_RETRIES) continue;
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : "网络错误";
        const status = (e as Error & { status?: number }).status;
        lastErr = errMsg;
        console.error(`[extract] attempt ${attempt} (${useStreaming ? "stream" : "non-stream"}) failed: ${errMsg}`);

        // On 400/5xx from streaming, immediately try non-streaming fallback
        if (useStreaming && (status === 400 || (status && status >= 500))) {
          console.error("[extract] Trying non-streaming fallback...");
          try {
            content = await fetchNonStreaming();
            if (content.trim().length > 10) break;
            lastErr = "AI 返回内容为空(非流式)";
          } catch (e2: unknown) {
            lastErr = e2 instanceof Error ? e2.message : "非流式请求也失败";
            console.error(`[extract] non-streaming fallback also failed: ${lastErr}`);
          }
        }

        // Retry on 5xx
        if (status && status >= 500 && attempt < MAX_RETRIES) continue;
        if (status && status < 500) break; // Don't retry client errors
        if (attempt < MAX_RETRIES) continue;
      }
    }

    if (!content.trim()) {
      return NextResponse.json(
        { error: lastErr || "AI 返回内容为空，请重试" },
        { status: 422 }
      );
    }

    // ── Save raw AI output to log file for debugging ──
    try {
      const outDir = getBaseOutputDir();
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const logPath = join(outDir, "extract-debug.log");
      const timestamp = new Date().toISOString();
      const logContent = `\n\n===== ${timestamp} =====\n[RAW AI OUTPUT, length=${content.length}]\n${content}\n===== END =====\n`;
      writeFileSync(logPath, logContent, { flag: "a" });
      console.log("[extract] Raw AI output saved to extract-debug.log, length:", content.length);
    } catch (logErr) {
      console.error("[extract] Failed to write debug log:", logErr);
    }

    // ── Robust JSON extraction and repair ──
    function repairAndParseJson(raw: string): Record<string, unknown> | null {
      // Step 1: Strip markdown code block wrapper
      let s = raw.trim();
      s = s.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
      const cbMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (cbMatch) s = cbMatch[1].trim();

      // Step 2: Extract outermost { ... }
      const first = s.indexOf("{");
      const last = s.lastIndexOf("}");
      if (first >= 0 && last > first) {
        s = s.slice(first, last + 1);
      } else if (first >= 0) {
        // Truncated — no closing brace
        s = s.slice(first);
      } else {
        return null;
      }

      // Step 3: Fix control characters inside strings (state machine)
      function escapeControlChars(input: string): string {
        let out = "";
        let inStr = false;
        let esc = false;
        for (let i = 0; i < input.length; i++) {
          const ch = input[i];
          if (esc) { out += ch; esc = false; continue; }
          if (ch === "\\") { out += ch; if (inStr) esc = true; continue; }
          if (ch === '"') { inStr = !inStr; out += ch; continue; }
          if (inStr) {
            const code = ch.charCodeAt(0);
            if (code < 0x20) {
              // Escape all control characters
              if (ch === "\n") { out += "\\n"; }
              else if (ch === "\r") { out += "\\r"; }
              else if (ch === "\t") { out += "\\t"; }
              else { out += "\\u" + code.toString(16).padStart(4, "0"); }
              continue;
            }
          }
          out += ch;
        }
        return out;
      }
      s = escapeControlChars(s);

      // Step 4: Common fixes
      s = s.replace(/,\s*([\]}])/g, "$1");         // trailing commas
      s = s.replace(/\/\/[^\n]*\n/g, "\n");         // JS comments
      s = s.replace(/"\.{3,}"/g, '""');             // "..." placeholders
      s = s.replace(/"…+"/g, '""');                 // "…" placeholders

      // Step 5: Try parse
      try {
        return JSON.parse(s);
      } catch {
        // continue to repair
      }

      // Step 6: Repair truncated JSON — progressively strip incomplete trailing content
      function closeTruncatedJson(input: string): string {
        // Track state
        let inStr2 = false;
        let esc2 = false;
        const stack: string[] = [];

        for (let i = 0; i < input.length; i++) {
          const ch = input[i];
          if (esc2) { esc2 = false; continue; }
          if (ch === "\\" && inStr2) { esc2 = true; continue; }
          if (ch === '"') { inStr2 = !inStr2; continue; }
          if (inStr2) continue;
          if (ch === "{") stack.push("}");
          else if (ch === "[") stack.push("]");
          else if (ch === "}" || ch === "]") {
            if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
          }
        }

        let result = input;
        // If we ended inside a string, just close the string
        if (inStr2) {
          result += '"';
        }
        // Remove any trailing comma
        result = result.replace(/,\s*$/, "");
        // Close remaining brackets/braces
        // Recalculate stack after potential string close
        {
          let is2 = false, es2 = false;
          const st2: string[] = [];
          for (let i = 0; i < result.length; i++) {
            const ch = result[i];
            if (es2) { es2 = false; continue; }
            if (ch === "\\" && is2) { es2 = true; continue; }
            if (ch === '"') { is2 = !is2; continue; }
            if (is2) continue;
            if (ch === "{") st2.push("}");
            else if (ch === "[") st2.push("]");
            else if (ch === "}" || ch === "]") {
              if (st2.length > 0 && st2[st2.length - 1] === ch) st2.pop();
            }
          }
          while (st2.length > 0) result += st2.pop();
        }
        return result;
      }

      // Try parse after closing truncation
      const repaired = closeTruncatedJson(s);
      try {
        return JSON.parse(repaired);
      } catch {
        // continue
      }

      // Step 7: Progressively strip incomplete trailing content and retry
      // Strategy: find the last valid comma-separated item boundary and truncate there
      function findLastValidCut(input: string): string {
        // Try to find the last complete "}" that is part of an array element
        // Walk backwards until we find a } ] pair or a } , pair outside string
        let best = input;
        let inS = false, escp = false;
        let lastGoodPos = -1;
        const depthStack: string[] = [];

        for (let i = 0; i < input.length; i++) {
          const ch = input[i];
          if (escp) { escp = false; continue; }
          if (ch === "\\" && inS) { escp = true; continue; }
          if (ch === '"') { inS = !inS; continue; }
          if (inS) continue;
          if (ch === "{") depthStack.push("}");
          else if (ch === "[") depthStack.push("]");
          else if (ch === "}" || ch === "]") {
            if (depthStack.length > 0 && depthStack[depthStack.length - 1] === ch) {
              depthStack.pop();
              lastGoodPos = i;
            }
          }
        }

        if (lastGoodPos > 0) {
          best = input.slice(0, lastGoodPos + 1);
        }
        return best;
      }

      const cut = findLastValidCut(s);
      const repaired2 = closeTruncatedJson(cut.replace(/,\s*$/, ""));
      try {
        return JSON.parse(repaired2);
      } catch (e) {
        console.error("[extract] All JSON repair attempts failed:", e instanceof Error ? e.message : e);
        return null;
      }
    }

    const result = repairAndParseJson(content);

    if (result) {
      // Validate expected shape
      if (!result.characters && !result.scenes && !result.props) {
        return NextResponse.json(
          {
            error: "AI 返回数据缺少 characters/scenes/props 字段",
            raw: content.slice(0, 500),
          },
          { status: 422 }
        );
      }

      // ★ 补全重试：如果有类别为空，自动补充提取（与流水线提取逻辑对齐）
      let charCount = Array.isArray(result.characters) ? (result.characters as unknown[]).length : 0;
      let sceneCount = Array.isArray(result.scenes) ? (result.scenes as unknown[]).length : 0;
      let propCount = Array.isArray(result.props) ? (result.props as unknown[]).length : 0;

      const missingCategories: string[] = [];
      if (sceneCount === 0) missingCategories.push("scenes（场景）");
      if (propCount === 0) missingCategories.push("props（道具）");
      if (charCount === 0) missingCategories.push("characters（角色）");

      if (missingCategories.length > 0 && text.length > 200) {
        console.log(`[extract] 检测到 ${missingCategories.join("、")} 为空，启动补充提取...`);
        try {
          const supplementPrompt = [
            `你刚才从文本中提取了角色/场景/道具，但以下类别结果为空：${missingCategories.join("、")}。`,
            `请重新仔细阅读原文，专注提取缺失的类别。`,
            `只返回缺失类别的数据，格式与之前相同。`,
            `角色已提取的有：${(result.characters as {name:string}[])?.map(c => c.name).join("、") || "无"}，不要重复。`,
            ``,
            `严格返回JSON格式：`,
            `{`,
            sceneCount === 0 ? `  "scenes": [{"name": "...", "aliases": [...], "description": "...（80字以上中文场景描述，含色板）", "prompt": "scene design concept art reference sheet, ... no people, no humans. 80-120 English words."}],` : `  "scenes": [],`,
            propCount === 0 ? `  "props": [{"name": "...", "aliases": [...], "description": "...（60字以上中文道具描述）", "prompt": "... multi-angle reference; front view ... no hands, no humans. 60-100 English words."}],` : `  "props": [],`,
            charCount === 0 ? `  "characters": [{"name": "...", "aliases": [...], "description": "...（100字以上中文角色描述）", "prompt": "character design reference sheet, ... 80-120 English words."}]` : `  "characters": []`,
            `}`,
            ``,
            `★ 提取所有有名字、有台词或有外观描述的场景/道具/角色，不得遗漏 ★`,
            `★ 场景Prompt必须包含 'no people, no humans' ★`,
            `★ 道具Prompt必须包含 'no hands, no humans' ★`,
          ].join("\n");

          const supplementReqMessages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `以下是原文：\n\n${text}\n\n---\n${supplementPrompt}` },
          ];

          // 使用非流式请求（更稳定）
          const supReqBody = isResponsesApi
            ? { model, input: supplementReqMessages, max_output_tokens: 16384, temperature: 0.2 }
            : { model, messages: supplementReqMessages, max_tokens: 16384, temperature: 0.2 };

          const supRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
            body: JSON.stringify(supReqBody),
            signal: AbortSignal.timeout(240000), // 240s — 补全提取也需要足够时间
          });

          if (supRes.ok) {
            const supData = await supRes.json();
            let supContent = "";
            if (isResponsesApi) {
              if (Array.isArray(supData.output)) {
                for (const item of supData.output) {
                  if (Array.isArray(item.content)) {
                    for (const c of item.content) {
                      if (c.type === "output_text" && c.text) supContent += c.text;
                    }
                  }
                }
              }
              supContent = supContent || supData.output_text || "";
            } else {
              supContent = supData.choices?.[0]?.message?.content || "";
            }

            if (supContent.trim()) {
              const supplementParsed = repairAndParseJson(supContent);
              if (supplementParsed) {
                if (Array.isArray(supplementParsed.scenes) && (supplementParsed.scenes as unknown[]).length > 0 && sceneCount === 0) {
                  result.scenes = supplementParsed.scenes;
                  sceneCount = (supplementParsed.scenes as unknown[]).length;
                }
                if (Array.isArray(supplementParsed.props) && (supplementParsed.props as unknown[]).length > 0 && propCount === 0) {
                  result.props = supplementParsed.props;
                  propCount = (supplementParsed.props as unknown[]).length;
                }
                if (Array.isArray(supplementParsed.characters) && (supplementParsed.characters as unknown[]).length > 0 && charCount === 0) {
                  result.characters = supplementParsed.characters;
                  charCount = (supplementParsed.characters as unknown[]).length;
                }
                console.log(`[extract] ✓ 补充提取完成 — 角色 ${charCount}，场景 ${sceneCount}，道具 ${propCount}`);
              } else {
                console.warn(`[extract] ⚠ 补充提取解析失败，保留首轮结果`);
              }
            }
          } else {
            console.warn(`[extract] ⚠ 补充提取请求失败 (${supRes.status})，保留首轮结果`);
          }
        } catch (supErr) {
          console.warn(`[extract] ⚠ 补充提取异常:`, supErr instanceof Error ? supErr.message : supErr);
        }
      }

      return NextResponse.json(result);
    } else {
      return NextResponse.json(
        {
          error: `AI 返回格式异常，无法解析JSON，已保存原始输出到 outputs/extract-debug.log`,
          raw: content.slice(0, 500),
        },
        { status: 422 }
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    console.error(`[extract] Route-level error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
