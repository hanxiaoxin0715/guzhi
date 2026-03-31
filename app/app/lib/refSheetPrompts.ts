/**
 * 参考图规格表（Specification Sheet）统一提示词模块
 *
 * ★ 单一事实来源（Single Source of Truth）★
 * 所有生成参考图提示词的地方（AI提取Phase2、翻译、单阶段提取）统一引用此模块，
 * 修改一处即全局生效，确保不同模式生成的参考图风格完全一致。
 *
 * 消费者：
 * - extractPrompts.ts (Phase 2 并发生成)
 * - defaultPrompts.ts (TRANSLATE_PROMPT 手动翻译)
 * - api/extract/route.ts (SINGLE_PASS 单阶段提取)
 */

// ═══════════════════════════════════════════════════════════
// 通用常量
// ═══════════════════════════════════════════════════════════

/** 画质关键词 — 所有类型共用 */
export const QUALITY_KEYWORDS = "masterpiece, best quality, ultra detailed, 8K";

/** 词数限制说明 — 所有类型共用 */
export const WORD_LIMIT_RULE = "Prompt总词数控制在 80-120 英文单词（总字符不超过750）— 过长会导致图像模型忽略布局指令";

// ═══════════════════════════════════════════════════════════
// 角色（Character）规格表规则
// ═══════════════════════════════════════════════════════════

/** 角色触发关键词 */
export const CHAR_TRIGGER_KEYWORDS = [
  "character design reference sheet",
  "character makeup and costume specification sheet",
  "multiple views on single dark gray background",
  "professional concept art page layout",
  "single composite image",
  "labeled panels",
].join(", ");

/** 角色美化规则 */
export const CHAR_BEAUTY_RULES = `### 角色美化规则（★强制★）
- ★ 角色必须美观、符合大众审美，五官精致立体
- ★ Prompt 必须包含美化关键词：'beautiful, attractive, refined facial features'
- ★ 肌肤质感：'highly detailed skin texture with subtle pores'（高清细腻肌肤）
- ★ 人物五官：清晰的双眸、精致的鼻梁、自然的唇部轮廓、层次分明的发型
- 目的：确保生成的角色参考图视觉上美观大方，适合影视级制作`;

/** 角色干净状态规则 */
export const CHAR_CLEAN_STATE_RULES = `### 干净中立状态规则（★强制★）
- 角色必须处于**完全干净、中立的默认状态**
- ★ 禁止任何情绪表情描述 — 不允许出现 sorrow, defiance, fierce, angry, sad, crying, smiling 等情绪词
- ★ 表情统一为：'neutral calm expression'（面无表情/平静自然）
- ★ 禁止任何污渍/状态描述 — 不允许出现 blood, mud, dirt, dust, water, sweat, tears, wounds, scars, stains, worn-out, frayed, faded 等
- ★ 服装必须干净崭新：'clean pristine condition'
- ★ 身体必须干净无瑕：'clean unblemished skin'
- 目的：角色参考图是**中立模板**，需要适配任何场景，不能带有特定状态`;

/** 角色版面布局规则 */
export const CHAR_LAYOUT_RULES = `### 版面布局规则（★核心★）
Prompt 必须生成一张单一复合图像，在深灰背景上包含以下面板：
  1) 左上面板 = 面部特写肖像 + 下方色板色块（6-10个HEX色值）
  2) 中央三面板 = 正面(front view)、四分之三侧面(three-quarter view)、背面(back view) 全身站姿并排
  3) 右侧面板 = 全身正面站姿 + 金色人体轮廓剪影 + 身高cm标注
  4) 底部行 = 四个矩形细节特写面板，每个标注中文名称（面部妆容、肩部装饰、衣料纹理、鞋靴配饰等）
  5) 左上角标题 = 红色粗体 'Character: {角色名}'`;

/** 角色色板提取规则 */
export const CHAR_PALETTE_RULES = `### 色板提取规则
从描述中推断 6-10 个 HEX 色值：
  - 主色调 2-3 个（服装/发色主体色）
  - 辅助色 2-3 个（装饰/配件色）
  - 点缀色 1-2 个（特效/武器/眼瞳色）
  - 肤色 1 个 + 阴影色 1 个
  在 Prompt 中写为: 'Color palette swatches below: #XXXXXX, #XXXXXX, ...'`;

/** 角色面板标注规则 */
export const CHAR_LABEL_RULES = `### 面板标注规则（重要）
- 每个面板下方必须有文字标注说明该面板内容
- 色板区域必须有 "Primary" / "Secondary" / "Accent" 分组标题
- 角色面板标注使用简洁中文（2-4个字），色板分组标题保留英文`;

/** 角色Prompt结构模板（用于 SINGLE_PASS 示例和教学） */
export const CHAR_PROMPT_TEMPLATE = `'character design reference sheet, multiple views on single dark gray background, professional concept art page layout. [角色名], [年龄/气质], [发型/发色], [服装完整描述], [标志性特征]. Red bold title: "Character: [角色名]". Top-left panel labeled "面部特写": face close-up portrait, [妆容/五官细节]. Color palette swatches below: [#HEX1], [#HEX2], [#HEX3], [#HEX4], [#HEX5], [#HEX6]. Center three panels labeled "正面" / "侧面" / "背面": front view, three-quarter view, back view, full body standing poses side by side, neutral calm expression, clean pristine condition. Right panel labeled "全身像": full body front pose with golden human silhouette height chart marked [身高]cm. Bottom row: four rectangular detail close-up panels with Chinese labels — [细节1], [细节2], [细节3], [细节4]. Studio lighting, 8K, highly detailed, single composite image, masterpiece, best quality, ultra detailed.'`;

/** 角色形态拆分规则 */
export const CHAR_FORM_SPLIT_RULES = `### 角色视觉形态拆分规则（★关键★）
- 如果同一角色有**不可逆的重大外观变化**（如：从石像变成人形、觉醒前后形象完全不同、变身/进化导致外观质变），必须拆分为多个独立条目
- 命名格式：\`角色名·形态名\`，例如：'角色名·常态'、'角色名·觉醒态'
- 每个形态拥有独立的 name、aliases、description、prompt，完全当作不同角色处理
- 拆分标准：外观发生了不可逆的重大变化（材质改变、形态转换、装备彻底更换等）
- 不拆分的情况：仅表情变化、光影变化、角度差异、轻微动作变化等临时性差异`;

// ═══════════════════════════════════════════════════════════
// 场景（Scene）规格表规则
// ═══════════════════════════════════════════════════════════

/** 场景触发关键词 */
export const SCENE_TRIGGER_KEYWORDS = [
  "scene design concept art reference sheet",
  "scene design specification sheet",
  "environment design",
  "multiple lighting conditions",
  "multiple viewpoints",
  "labeled panels",
  "single composite image",
].join(", ");

/** 场景版面布局规则 */
export const SCENE_LAYOUT_RULES = `### 版面布局规则（★核心★）
场景规范页面必须在单一图像中包含以下面板：
  1) 顶部行 = 四个小缩略图（Front View / Side View / Top-Down View / Low-Angle View），各标注英文名称
  2) 左侧列 = 三个纵向面板，展示不同光照条件（如 "Daytime (Clear)" / "Dusk (Cloudy)" / "Night (Moonlit)"），各标注英文时段天气
  3) 中央 = 大尺寸主图，展示最关键的光照氛围（故事发生时的时间状态）
  4) 底部行 = 四个圆形细节特写（场景内关键道具/材质纹理），每个下标注英文材质/元素名称
  5) 右侧边栏 = 色板色块，分三层：Primary Colors / Secondary Colors / Accent Colors
  6) 左上角标题 = 红色粗体 'Scene: {场景名}'`;

/** 场景光照条件推断规则 */
export const SCENE_LIGHTING_RULES = `### 光照条件推断规则
从文本中场景出现的时间和天气推断 3 种光照条件：
  1) 基础明亮态（白天/晴天）—— 结构清晰参考
  2) 过渡态（黄昏/阴天/雾天）—— 中间氛围
  3) 核心叙事态（故事实际发生时的光照）—— 这将是中央主图的状态`;

/** 场景无人物规则 */
export const SCENE_NO_HUMANS_RULE = "场景Prompt必须包含 'no people, no humans, no characters' — 严禁任何人物出现";

/** 场景Prompt结构模板 */
export const SCENE_PROMPT_TEMPLATE = `'scene design concept art reference sheet, multiple panels on single image, professional page layout, no people, no humans. [场景英文名] — [场景中文名]. [一句话核心描述]. Red bold title: "Scene: [场景中文名]". Top row: four small thumbnails — front view, side view, top-down view, low-angle view, each labeled. Left column: three vertical panels showing different lighting — "Daytime (Clear)", "Dusk (Cloudy)", "Night ([天气])", each labeled. Center: large main image, [核心描述], [关键物件], [光照], [色调], [情绪]. Bottom row: four circular detail close-ups — [细节1], [细节2], [细节3], [细节4], each labeled. Right sidebar: color palette — Primary: [色名1], [色名2], [色名3]; Secondary: [色名1], [色名2], [色名3]; Accent: [色名1], [色名2]. Single composite image, highly detailed, cinematic lighting, 8K, masterpiece, best quality.'`;

// ═══════════════════════════════════════════════════════════
// 道具（Prop）规格表规则
// ═══════════════════════════════════════════════════════════

/** 道具触发关键词 */
export const PROP_TRIGGER_KEYWORDS = [
  "prop design reference",
  "prop design specification sheet",
  "multiple angles",
  "detailed item sheet",
  "labeled panels",
  "single composite image",
].join(", ");

/** 道具版面布局规则 */
export const PROP_LAYOUT_RULES = `### 版面布局规则（★核心★）
道具规范页面必须在单一图像中包含以下面板：
  1) 左上角标题 = 红色粗体 'Prop: {道具名}'
  2) 上方一排 = 3-4个不同角度视图（正面/侧面/背面/俯视），每个标注英文（Front / Side / Rear / Top）
  3) 中央 = 大幅正面英雄镜头（hero shot），占画面最大面积
  4) 底部行 = 3-4个圆形微距特写面板（材质纹理/发光效果/机关细节/铭文雕刻等），每个标注英文名称
  5) 右侧 = 竖排色彩调色盘 + 尺寸标注`;

/** 道具无人物规则 */
export const PROP_NO_HUMANS_RULE = "道具Prompt结尾必须包含 'no hands, no humans'";

/** 道具Prompt结构模板 */
export const PROP_PROMPT_TEMPLATE = `'prop design reference, prop design specification sheet, multiple angles, detailed item sheet, labeled panels, single composite image. Red bold title: "Prop: [道具名]". [道具描述]. Top row: [角度1] labeled "Front", [角度2] labeled "Side", [角度3] labeled "Rear", [角度4] labeled "Top". Center: large hero shot, [核心描述]. Bottom row: [数量] circular macro detail panels — [细节1], [细节2], [细节3], [细节4], each labeled. Right sidebar: color palette + size annotation. 8K, masterpiece, best quality, ultra detailed, no hands, no humans.'`;

// ═══════════════════════════════════════════════════════════
// 色板通用规则
// ═══════════════════════════════════════════════════════════

/** 色板分组规则 — 所有类型通用 */
export const PALETTE_GROUP_RULES = `### 色板规则
右侧竖排色彩调色盘，分 Primary (3色) / Secondary (3色) / Accent (2色) 三组，每组有英文标题`;

// ═══════════════════════════════════════════════════════════
// 组合构建器 — 按消费者场景组装完整提示词
// ═══════════════════════════════════════════════════════════

/**
 * 构建 Phase 2 角色提示词（供 extractPrompts.ts 使用）
 * 包含：任务说明 + 布局规则 + 触发/画质关键词 + 干净状态 + 标注规则 + 风格融入 + 输出要求
 */
export function buildPhase2CharacterPrompt(): string {
  return `你是一名顶级概念美术师，擅长为 AI 绘画生成 Character Design Reference Sheet 英文提示词。

## 任务
根据提供的角色名称和中文描述，生成一段 80-120 词的英文绘画提示词（prompt），总字符数不超过750。

## 画面构图规则（必须严格遵循）
提示词描述的是一张**角色定妆/造型规格参考表（Character Makeup & Costume Specification Sheet）**，画面布局：
${CHAR_LAYOUT_RULES.replace("### 版面布局规则（★核心★）\n", "")}

## 触发关键词（必须包含）
${CHAR_TRIGGER_KEYWORDS.split(", ").map(k => `'${k}'`).join(", ")}

## 画质关键词（必须包含）
${QUALITY_KEYWORDS}

${CHAR_BEAUTY_RULES}

${CHAR_CLEAN_STATE_RULES}

${CHAR_LABEL_RULES}

${PALETTE_GROUP_RULES}

## 风格融入
如果提供了【风格参考】，请将风格关键词自然融入 prompt（如画风、色调、氛围等）。

## 输出格式（★严格遵守★）
先生成英文 prompt，再将英文逐句翻译为中文作为 description，严格输出以下 JSON，不要输出任何其他文字：
{"prompt": "英文 prompt（80-120 词，总字符不超过750，一整段逗号分隔）", "description": "上述英文的完整逐句中文翻译，必须包含全部面板布局、色板HEX值、画质标签的中文翻译，与 prompt 逐句对应"}`;
}

/**
 * 构建 Phase 2 场景提示词（供 extractPrompts.ts 使用）
 */
export function buildPhase2ScenePrompt(): string {
  return `你是一名顶级概念美术师，擅长为 AI 绘画生成 Scene Design Reference Sheet 英文提示词。

## 任务
根据提供的场景名称和中文描述，生成一段 80-120 词的英文绘画提示词（prompt），总字符数不超过750。

## 画面构图规则（必须严格遵循）
提示词描述的是一张**场景设计规格参考表（Scene Design Specification Sheet）**，画面布局：
${SCENE_LAYOUT_RULES.replace("### 版面布局规则（★核心★）\n", "")}

## 触发关键词（必须包含）
${SCENE_TRIGGER_KEYWORDS.split(", ").map(k => `'${k}'`).join(", ")}

## 画质关键词（必须包含）
${QUALITY_KEYWORDS}

## 无人物规则
- 必须包含: 'no people, no humans, no characters'

${SCENE_LIGHTING_RULES}

${PALETTE_GROUP_RULES}

## 风格融入
如果提供了【风格参考】，请将风格关键词自然融入 prompt。

## 输出格式（★严格遵守★）
先生成英文 prompt，再将英文逐句翻译为中文作为 description，严格输出以下 JSON，不要输出任何其他文字：
{"prompt": "英文 prompt（80-120 词，总字符不超过750，一整段逗号分隔）", "description": "上述英文的完整逐句中文翻译，必须包含全部面板布局、色板HEX值、画质标签的中文翻译，与 prompt 逐句对应"}`;
}

/**
 * 构建 Phase 2 道具提示词（供 extractPrompts.ts 使用）
 */
export function buildPhase2PropPrompt(): string {
  return `你是一名顶级概念美术师，擅长为 AI 绘画生成 Prop Design Reference 英文提示词。

## 任务
根据提供的道具名称和中文描述，生成一段 80-120 词的英文绘画提示词（prompt），总字符数不超过750。

## 画面构图规则（必须严格遵循）
提示词描述的是一张**道具设计规格参考表（Prop Design Specification Sheet）**，画面布局：
${PROP_LAYOUT_RULES.replace("### 版面布局规则（★核心★）\n", "")}

## 触发关键词（必须包含）
${PROP_TRIGGER_KEYWORDS.split(", ").map(k => `'${k}'`).join(", ")}

## 画质关键词（必须包含）
${QUALITY_KEYWORDS}

## 无人物规则
- 必须包含: 'no hands, no humans'

${PALETTE_GROUP_RULES}

## 风格融入
如果提供了【风格参考】，请将风格关键词自然融入 prompt。

## 输出格式（★严格遵守★）
先生成英文 prompt，再将英文逐句翻译为中文作为 description，严格输出以下 JSON，不要输出任何其他文字：
{"prompt": "英文 prompt（80-120 词，总字符不超过750，一整段逗号分隔）", "description": "上述英文的完整逐句中文翻译，必须包含全部面板布局、色板HEX值、画质标签的中文翻译，与 prompt 逐句对应"}`;
}

/**
 * 构建 TRANSLATE_PROMPT 中的参考表规则部分（供 defaultPrompts.ts 使用）
 * 输出三种类型的布局规则（A/B/C），嵌入到翻译提示词中
 */
export function buildTranslateRefRules(): string {
  return `#### A. 角色类型 — Character Makeup & Costume Specification Sheet
1. **总体页面描述**："${CHAR_TRIGGER_KEYWORDS}"
2. **标题**：左上角红色粗体 "Character: {角色名}"
3. **角色美化**：角色必须美观、五官精致立体，Prompt 必须包含 'beautiful, attractive, refined facial features, highly detailed skin texture with subtle pores'
4. **面板布局**：
   - Upper left panel labeled "面部特写": facial close-up portrait, 6-10 color HEX palette swatches below it
   - Upper center three panels labeled "正面" / "侧面" / "背面": full body side-by-side standing poses, neutral calm expression
   - Upper right panel labeled "全身像": full body front pose, golden body silhouette height chart marked at Xcm
   - Bottom row: four rectangular detail close-up panels, each labeled with Chinese name (e.g. "腰带扣环", "衣料纹理", "臂甲细节", "发饰特征")
   - Right side: vertical color palette organized as Primary (3 colors) / Secondary (3 colors) / Accent (2 colors) with group titles

#### B. 场景类型 — Scene Design Specification Sheet
1. **总体页面描述**："${SCENE_TRIGGER_KEYWORDS}"
2. **标题**：左上角红色粗体 "Scene: {场景名}"
3. **面板布局**：
   - Top row: 4 thumbnails showing different viewpoints, each labeled ("Front View" / "Side View" / "Top-Down View" / "Low-Angle View")
   - Left column: 3 lighting condition panels, each labeled (e.g. "Daytime (Overcast)" / "Dusk (Foggy)" / "Night (Moonlit)")
   - Center: large main environment panorama
   - Bottom row: 4 circular texture detail close-ups, each labeled (e.g. "Gnarled Bark" / "Mossy Ground" / "Stone Path" / "Dense Canopy")
   - Right side: vertical color palette organized as Primary / Secondary / Accent with group titles

#### C. 道具类型 — Prop Design Specification Sheet
1. **总体页面描述**："${PROP_TRIGGER_KEYWORDS}"
2. **标题**：左上角红色粗体 "Prop: {道具名}"
3. **面板布局**：
   - Top row: 3-4 angle views labeled ("Front" / "Side" / "Rear" / "Top")
   - Center: large hero shot
   - Bottom row: 3-4 circular macro detail panels labeled with material/component names
   - Right side: vertical color palette + size annotations`;
}

/**
 * 构建 SINGLE_PASS 中角色的完整规则段（供 extract/route.ts 使用）
 * 包含：版面布局 + 触发关键词 + 干净状态 + 色板 + 身高 + 形态拆分 + 字段说明
 */
export function buildSinglePassCharacterRules(): string {
  return `## 1. 角色 (Characters) — 定妆规范照片页面规则（★必须遵守★）
每个角色必须输出一张**角色定妆规范照片页面（Character Makeup & Costume Specification Sheet）**——一张包含多个面板的**单一复合图像**（single composite image），深灰色专业背景，包含多视角、色板、身高剪影、细节特写。

${CHAR_LAYOUT_RULES}

### Prompt 触发关键词组合（★最重要★）
以下关键词组合是触发 AI 图像模型生成复合规范页面的核心，缺一不可：
  - 'character design reference sheet' — 触发参考设定图模式
  - 'multiple views on single dark gray background' — 触发深灰底多面板布局
  - 'professional concept art page layout' — 触发专业板式排版
  - 'single composite image' — 防止模型生成多张独立图片

${CHAR_BEAUTY_RULES}

${CHAR_CLEAN_STATE_RULES}

${CHAR_PALETTE_RULES}

### 身高推断规则
根据文本描述或角色特征推断合理身高（cm），在 Prompt 中写为 'height chart marked XXXcm'

### 字段说明
- description：**英文 prompt 的完整中文翻译版**，必须包含页面布局（左上面板、中央三面板、右侧面板、底部行等）、色板HEX值、质感标记词的中文翻译。与 prompt 逐句对应，不得省略任何面板或标注。不要包含情绪或脏污状态词。
- prompt：英文Prompt，必须严格遵循以下结构：
  ${CHAR_PROMPT_TEMPLATE}
- aliases：别名/同义词数组，包含该元素在文本中可能出现的所有称呼、简称、别名、同义词。这对后续参考图匹配至关重要！
- ★ ${WORD_LIMIT_RULE} ★
- ★ 角色Prompt中绝不能出现情绪词或污渍/磨损词 ★

${CHAR_FORM_SPLIT_RULES}`;
}

/**
 * 构建 SINGLE_PASS 中场景的完整规则段
 */
export function buildSinglePassSceneRules(): string {
  return `## 2. 场景 (Scenes) — 场景设计规范页面规则（★必须遵守★）
每个场景必须输出一张**场景设计规范页面（Scene Design Specification Sheet）**——一张包含多个面板的**单一复合图像**，包含多角度、多光照条件、细节特写和色板。

${SCENE_LAYOUT_RULES}

### Prompt 触发关键词组合（★最重要★）
  - 'scene design concept art reference sheet' — 触发场景规范图模式
  - 'multiple panels on single image' — 触发多面板布局
  - 'professional page layout' — 触发专业板式排版
  - 'single composite image' — 防止模型生成多张独立图片
  - 'no people, no humans' — 场景严禁出现人物

${SCENE_LIGHTING_RULES}

### 色板提取规则
从场景描述推断色彩分三层，每色标注英文描述性名称：
  - Primary（3个）：最大面积色调（建筑主体/地面/天空）
  - Secondary（3个）：次要面积（木质/阴影/雾气）
  - Accent（2个）：点睛色（灯火/特殊光源/植物）

### 字段说明
- description：**英文 prompt 的完整中文翻译版**，必须包含全部面板布局、色板信息、光照条件、质感标记词的中文翻译。与 prompt 逐句对应，不得省略。
- prompt：英文Prompt，必须严格遵循以下结构：
  ${SCENE_PROMPT_TEMPLATE}
- aliases：别名/同义词数组。
- ★ ${WORD_LIMIT_RULE} ★
- ★ ${SCENE_NO_HUMANS_RULE} ★`;
}

/**
 * 构建 SINGLE_PASS 中道具的完整规则段
 */
export function buildSinglePassPropRules(): string {
  return `## 3. 道具 (Props) — 道具设计规格参考表规则（★必须遵守★）
每个道具必须输出一张**道具设计规格参考表（Prop Design Specification Sheet）**——一张包含多个面板的**单一复合图像**，包含多角度、细节特写和色板。

${PROP_LAYOUT_RULES}

### Prompt 触发关键词组合（★最重要★）
  - 'prop design reference, prop design specification sheet' — 触发道具规范图模式
  - 'multiple angles, detailed item sheet' — 触发多角度布局
  - 'labeled panels, single composite image' — 触发标注面板和单一图像

### 字段说明
- description：**英文 prompt 的完整中文翻译版**，必须包含全部角度描述、材质细节、质感标记词的中文翻译。与 prompt 逐句对应，不得省略。
- prompt：英文Prompt，必须严格遵循以下结构：
  ${PROP_PROMPT_TEMPLATE}
- aliases：别名/同义词数组。
- ★ ${WORD_LIMIT_RULE} ★
- ★ ${PROP_NO_HUMANS_RULE} ★`;
}
