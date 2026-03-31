// 角色库 API — 扫描磁盘参考图，返回分类后的图片列表
//
// GET /api/character-library
//   → 扫描 outputs/ref-images/ 目录，识别旧格式（char-xxx/scene-xxx/prop-xxx）和新格式（角色-xxx/场景-xxx/道具-xxx）
//   → 返回 { items: [{ key, type, name, imageUrl }] }
//
// Phase 1: 仅扫描当前 ref-images/ 目录（扁平结构）
// Phase 2+: 将扫描 outputs/{项目名}/参考图/ 子目录
import { NextResponse } from "next/server";
import { readdirSync, existsSync } from "fs";
import { getRefImagesDir } from "../../lib/paths";

export interface LibraryDiskItem {
  key: string;
  type: "character" | "scene" | "prop" | "style";
  /** 从文件名推断的显示名称 */
  name: string;
  /** 可直接用于 <img src> 的 URL */
  imageUrl: string;
}

/** 从 ref-image key 推断类型 */
function inferType(key: string): LibraryDiskItem["type"] {
  if (key.startsWith("char-") || key.startsWith("角色-")) return "character";
  if (key.startsWith("scene-") || key.startsWith("场景-")) return "scene";
  if (key.startsWith("prop-") || key.startsWith("道具-")) return "prop";
  return "style";
}

/** 从 ref-image key 推断显示名称 */
function inferName(key: string, type: LibraryDiskItem["type"]): string {
  // 新格式：角色-林骁-1 → 林骁
  const cnMatch = key.match(/^(?:角色|场景|道具)-(.+?)(?:-\d+)?$/);
  if (cnMatch) return cnMatch[1];

  // 旧格式：char-1234567890-0 → 无法推断有意义名称，按类型+序号
  const oldMatch = key.match(/^(?:char|scene|prop)-\d+-(\d+)$/);
  if (oldMatch) {
    const typeNames = { character: "角色", scene: "场景", prop: "道具", style: "风格" };
    return `${typeNames[type]} #${parseInt(oldMatch[1]) + 1}`;
  }

  // style-image 等
  if (key === "style-image") return "风格参考";

  return key;
}

export async function GET() {
  try {
    const refDir = getRefImagesDir();
    if (!existsSync(refDir)) {
      return NextResponse.json({ items: [] });
    }

    const files = readdirSync(refDir);
    const items: LibraryDiskItem[] = files
      .filter((f) => {
        // 排除 .json 文件（如 style-prompt.json）
        if (f.endsWith(".json")) return false;
        // 只包含图片文件
        return /\.(png|jpg|jpeg|webp|gif)$/i.test(f);
      })
      .map((f) => {
        const key = f.replace(/\.\w+$/, "");
        const type = inferType(key);
        return {
          key,
          type,
          name: inferName(key, type),
          imageUrl: `/api/ref-image?key=${encodeURIComponent(key)}`,
        };
      });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[character-library] 扫描参考图失败:", err);
    return NextResponse.json({ items: [] });
  }
}
