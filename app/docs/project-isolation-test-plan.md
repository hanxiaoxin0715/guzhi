# 项目隔离功能 — QA 测试计划

> **版本**：V1.88（第100次修改）  
> **测试范围**：宫格图片（grid-images）项目级磁盘隔离  
> **变更文件**：`paths.ts`、`local-file/route.ts`、`projects.ts`、`api/active-project/route.ts`（新增）  
> **测试优先级**：P0（数据安全）

---

## 一、架构变更概述

### 旧架构（无隔离）
```
outputs/grid-images/
  ├── nine-ep01-0.png    ← 所有项目共享同一目录
  ├── nine-ep01-1.png
  ├── four-ep02-g0-0.png
  └── ...
```

### 新架构（项目隔离）
```
outputs/grid-images/
  ├── _default/           ← 未关联项目时的默认目录
  │   ├── nine-ep01-0.png
  │   └── ...
  ├── proj_1740000000_abc123/  ← 项目A的专属目录
  │   ├── nine-ep01-0.png
  │   └── ...
  └── proj_1740000001_def456/  ← 项目B的专属目录
      ├── nine-ep01-0.png
      └── ...
```

### 核心机制
1. 磁盘文件 `outputs/.active-project` 记录当前活跃项目ID
2. 服务端 `getGridImagesDir()` 根据此文件返回项目专属目录
3. 客户端通过 `PUT /api/active-project` 切换项目ID
4. 旧版无子目录的图片自动迁移到 `_default/`

---

## 二、测试用例

### TC-01: 旧数据自动迁移
**前置条件**：`outputs/grid-images/` 目录下有散落的 `.png` 文件（模拟旧版数据）  
**步骤**：
1. 手动在 `outputs/grid-images/` 放置几张 `nine-ep01-0.png`、`four-ep01-g0-0.png` 等测试图片
2. 确保不存在任何子目录
3. 启动 dev server / 访问任意涉及 grid-image 的页面
4. 检查 `outputs/grid-images/_default/` 是否已创建
5. 检查原图片是否已移动到 `_default/` 子目录
6. 检查 `outputs/grid-images/` 根目录是否不再有散落图片

**预期结果**：
- [  ] 所有散落图片迁移到 `_default/` ✓
- [  ] 根目录无残留图片文件 ✓
- [  ] 迁移仅执行一次（刷新页面不再触发） ✓
- [  ] 工作台能正常显示迁移后的图片 ✓

---

### TC-02: 新项目创建（归档后新建）
**前置条件**：工作台有活跃项目，已生成若干九宫格/四宫格图片  
**步骤**：
1. 点击侧边栏「新项目」→ 输入项目名 → 「归档并新建」
2. 检查磁盘：
   - `outputs/.active-project` 文件应 **不存在** 或内容为空
   - 旧项目图片仍在 `outputs/grid-images/{oldProjectId}/` 中（归档到 IDB 后被删除，属正常行为）
3. 在新工作台生成新的九宫格图片
4. 检查磁盘：
   - 新图片应出现在 `outputs/grid-images/_default/` 中（因为是新项目，尚未归档所以用 _default）

**预期结果**：
- [  ] 归档成功，项目出现在首页项目列表 ✓
- [  ] 新工作台为空白状态 ✓
- [  ] 新工作台不显示旧项目的图片 ✓
- [  ] 新生成的图片不会污染旧项目目录 ✓

---

### TC-03: 新项目创建（不存档直接清除）
**前置条件**：工作台有图片数据  
**步骤**：
1. 点击侧边栏「新项目」→ 「不存档直接清除」
2. 检查磁盘：旧项目目录中的图片已被删除
3. 检查工作台：完全空白

**预期结果**：
- [  ] 旧图片从磁盘删除 ✓
- [  ] 工作台空白，无旧数据残留 ✓
- [  ] `.active-project` 文件不存在 ✓

---

### TC-04: 项目恢复
**前置条件**：已有至少一个归档项目  
**步骤**：
1. 从首页项目列表点击「恢复」
2. 等待恢复完成 → 自动跳转到工作台
3. 检查工作台：
   - 九宫格/四宫格图片是否正确显示
   - 切换 EP 是否只显示该项目的图片
4. 检查磁盘：
   - `outputs/.active-project` 内容是否为恢复的项目 ID
   - `outputs/grid-images/{projectId}/` 目录是否包含恢复的图片
5. 在恢复的工作台上继续生成新图片
6. 新图片应存储在同一项目目录下

**预期结果**：
- [  ] 恢复后图片全部正确显示 ✓
- [  ] 磁盘项目目录与 `.active-project` 一致 ✓
- [  ] 新生成图片存入正确的项目目录 ✓
- [  ] 不会看到其他项目的图片 ✓

---

### TC-05: 覆盖保存（新项目 → 覆盖旧项目）
**前置条件**：工作台有数据，已有同名归档项目  
**步骤**：
1. 点击「新项目」→ 选择已有项目 → 「覆盖保存」
2. 验证归档项目数据已更新
3. 新工作台应为空白

**预期结果**：
- [  ] 覆盖保存成功（版本号递增） ✓
- [  ] 新工作台空白 ✓
- [  ] 旧归档项目的恢复仍正常 ✓

---

### TC-06: EP 切换隔离
**前置条件**：恢复项目 A（有 ep01-ep03 的图片），确保其他项目也有 ep01 的图片  
**步骤**：
1. 在工作台切换 EP（ep01 → ep02 → ep03 → ep01）
2. 每次切换检查：图片是否属于当前项目，无其他项目的图片

**预期结果**：
- [  ] EP 切换只显示当前项目的图片 ✓
- [  ] 不出现其他项目的旧图片 ✓

---

### TC-07: 清除画布
**前置条件**：工作台九宫格/四宫格/智能分镜有图片  
**步骤**：
1. 点击「清除画布」
2. 确认图片从界面消失
3. 切换 EP 后再切回
4. 检查磁盘：对应的单个图片文件是否已删除

**预期结果**：
- [  ] 画布清空 ✓
- [  ] 切换回不会复活旧图片 ✓
- [  ] 磁盘文件已删除 ✓

---

### TC-08: 模式切换隔离（九宫格 ↔ 智能分镜 ↔ 四宫格）
**前置条件**：九宫格模式有图片  
**步骤**：
1. 切换到智能分镜模式
2. 检查：不应显示九宫格模式的提示词（但图片 key 不同，本身就隔离的）
3. 切换到四宫格模式，检查同上
4. 切回九宫格模式，原图片应恢复

**预期结果**：
- [  ] 各模式数据独立，不互相干扰 ✓
- [  ] 切换后能正确恢复各自模式的图片 ✓

---

### TC-09: 多项目快速切换
**前置条件**：已有 2-3 个归档项目  
**步骤**：
1. 恢复项目 A → 记录看到的图片
2. 回到首页 → 恢复项目 B → 记录看到的图片
3. 回到首页 → 再恢复项目 A
4. 检查：项目 A 的图片是否与第一次恢复时一致

**预期结果**：
- [  ] 每次恢复看到的图片都正确对应该项目 ✓
- [  ] 无跨项目数据泄漏 ✓
- [  ] 快速切换不导致数据丢失或混乱 ✓

---

### TC-10: 热更新兼容性
**前置条件**：模拟热更新场景  
**步骤**：
1. 在旧版（无隔离）下生成若干图片（散落在 `outputs/grid-images/` 根目录）
2. 升级到新版（有隔离）
3. 启动系统 → 访问工作台
4. 验证：旧图片自动迁移到 `_default/` 子目录
5. 验证：工作台仍能正常显示这些迁移后的图片
6. 正常进行归档、新建、恢复等操作

**预期结果**：
- [  ] 旧数据无损迁移 ✓
- [  ] 热更新后所有功能正常 ✓
- [  ] 迁移不影响后续的项目隔离功能 ✓

---

### TC-11: 图生视频工作台 — 宫格导入
**前置条件**：当前项目有九宫格/四宫格图片  
**步骤**：
1. 进入图生视频页面
2. 打开「从宫格导入」弹窗
3. 检查：弹窗中只显示当前项目的图片
4. 选择图片导入 → 验证正确

**预期结果**：
- [  ] 宫格导入只列出当前项目的图片 ✓
- [  ] 导入后图片正确显示 ✓

---

### TC-12: API 端点直接测试
**步骤**（可用浏览器 DevTools / curl）：

```bash
# 1. 读取当前活跃项目
GET /api/active-project
# 预期: { "projectId": "_default" } 或 { "projectId": "proj_xxx" }

# 2. 设置活跃项目
PUT /api/active-project  Body: { "projectId": "test_project_123" }
# 预期: { "success": true, "projectId": "test_project_123" }

# 3. 验证 grid-image 列出的是新项目目录
GET /api/grid-image?list=1
# 预期: 返回空列表或该项目目录中的图片

# 4. 清除活跃项目
PUT /api/active-project  Body: { "projectId": null }
# 预期: { "success": true, "projectId": "_default" }

# 5. 验证回退到 _default
GET /api/active-project
# 预期: { "projectId": "_default" }
```

**预期结果**：
- [  ] 所有 API 端点正常响应 ✓
- [  ] 项目切换后 grid-image 列表正确反映当前项目 ✓

---

### TC-13: 安全边界测试
**步骤**：

```bash
# 路径注入尝试
PUT /api/active-project  Body: { "projectId": "../../etc" }
# 预期: 特殊字符被过滤，不会出现路径遍历

PUT /api/active-project  Body: { "projectId": "" }
# 预期: 清除活跃项目（回退 _default）

PUT /api/active-project  Body: { "projectId": 12345 }
# 预期: 清除（非字符串）
```

**预期结果**：
- [  ] 路径注入被正确阻止 ✓
- [  ] 异常输入不导致崩溃 ✓

---

## 三、回归测试清单

| 功能 | 验证点 | 通过 |
|------|--------|------|
| 九宫格生图 | 图片正常保存/显示 | [  ] |
| 四宫格生图 | 图片正常保存/显示 | [  ] |
| 智能分镜生图 | 图片正常保存/显示 | [  ] |
| 清除画布 | 磁盘文件同步删除 | [  ] |
| EP 检测 | detectEpisodes 只扫描当前项目 | [  ] |
| 模式缓存 | studioCache 正确切换 | [  ] |
| 一致性参考图 | 不受项目隔离影响（使用 ref-images/） | [  ] |
| Seedance 视频生成 | 从宫格导入读取正确目录 | [  ] |
| 图生视频 GridImportModal | 只列出当前项目的图片 | [  ] |
| 磁盘路径配置更改 | 切换 outputs 路径后隔离仍有效 | [  ] |

---

## 四、磁盘状态检查脚本

Windows PowerShell 快速检查命令：

```powershell
# 查看活跃项目标识
$outputDir = "D:\BaiduNetdiskDownload\AI智能体分镜\outputs"
if (Test-Path "$outputDir\.active-project") {
    Write-Host "活跃项目:" (Get-Content "$outputDir\.active-project")
} else {
    Write-Host "活跃项目: _default (无标识文件)"
}

# 列出所有项目目录
Write-Host "`n项目目录列表:"
Get-ChildItem "$outputDir\grid-images" -Directory | ForEach-Object {
    $count = (Get-ChildItem $_.FullName -File | Measure-Object).Count
    Write-Host "  $($_.Name): $count 张图片"
}

# 检查是否有散落在根目录的旧图片（应为0）
$loose = (Get-ChildItem "$outputDir\grid-images" -File -Filter "*.png" | Measure-Object).Count
$loose += (Get-ChildItem "$outputDir\grid-images" -File -Filter "*.jpg" | Measure-Object).Count
Write-Host "`n根目录散落图片: $loose 张 $(if ($loose -eq 0) { '✓' } else { '⚠ 需要迁移' })"
```

---

## 五、紧急回滚方案

若发现严重问题需回滚：

1. 将 `paths.ts` 中的 `getGridImagesDir()` 改回 `path.join(getBaseOutputDir(), "grid-images")`
2. 将 `local-file/route.ts` 中的 `resolveDir()` 改回不区分 category 的通用逻辑
3. 手动将 `outputs/grid-images/_default/` 中的文件移回 `outputs/grid-images/`
4. 删除 `outputs/.active-project` 文件

---

## 六、签字确认

| 角色 | 姓名 | 日期 | 签字 |
|------|------|------|------|
| 开发 | | | |
| 测试 | | | |
| 产品 | | | |
