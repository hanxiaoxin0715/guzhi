import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * POST /api/jianying-draft
 * 生成剪映草稿文件夹，引用已有视频的绝对路径
 * Body: { draftName, ratio, videos: [{ filename, durationSec, width, height, label }] }
 * Returns: { draftPath, videoCount }
 */

// 读取 feicai-paths.json 获取 outputs 根目录
function getBaseOutputDir(): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "feicai-paths.json"), "utf-8");
    return JSON.parse(raw).baseOutputDir || path.join(process.cwd(), "outputs");
  } catch {
    return path.join(process.cwd(), "outputs");
  }
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  }).toUpperCase();
}

// 解析 ratio 字符串为宽高
function parseRatio(ratio: string): { w: number; h: number } {
  const map: Record<string, { w: number; h: number }> = {
    "16:9": { w: 1920, h: 1080 },
    "9:16": { w: 1080, h: 1920 },
    "4:3": { w: 1440, h: 1080 },
    "3:4": { w: 1080, h: 1440 },
    "1:1": { w: 1080, h: 1080 },
    "21:9": { w: 2520, h: 1080 },
  };
  return map[ratio] || { w: 1920, h: 1080 };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { draftName = "飞彩工作室导出", ratio = "16:9", videos = [] } = body as {
      draftName: string;
      ratio: string;
      videos: { filename: string; durationSec: number; width?: number; height?: number; label: string }[];
    };

    if (videos.length === 0) {
      return NextResponse.json({ error: "没有可导出的视频" }, { status: 400 });
    }

    const baseDir = getBaseOutputDir();
    const videosDir = path.join(baseDir, "videos");
    const draftsDir = path.join(baseDir, "jianying-drafts");
    const draftFolder = path.join(draftsDir, draftName);

    // 创建草稿目录
    fs.mkdirSync(draftFolder, { recursive: true });

    const draftId = uuid();
    const canvasSize = parseRatio(ratio);
    const now = Date.now() * 1000; // 微秒时间戳
    const draftContentId = uuid();

    // 构建 materials 和 tracks
    const videoMaterials: object[] = [];
    const speedMaterials: object[] = [];
    const canvasMaterials: object[] = [];
    const soundChannelMaterials: object[] = [];
    const vocalSepMaterials: object[] = [];
    const segments: object[] = [];

    let timelinePos = 0; // 微秒
    let totalDuration = 0;

    for (const v of videos) {
      const videoAbsPath = path.join(videosDir, v.filename).replace(/\\/g, "/");

      // 检查视频文件是否存在
      if (!fs.existsSync(path.join(videosDir, v.filename))) {
        console.warn(`[JianyingDraft] 视频文件不存在: ${v.filename}`);
        continue;
      }

      const durationUs = Math.round(v.durationSec * 1_000_000);
      const matId = uuid();
      const speedId = uuid();
      const canvasId = uuid();
      const soundId = uuid();
      const vocalId = uuid();
      const segId = uuid();

      // 视频材料
      videoMaterials.push({
        id: matId,
        type: "video",
        path: videoAbsPath,
        media_path: "",
        local_id: "",
        has_audio: true,
        width: v.width || canvasSize.w,
        height: v.height || canvasSize.h,
        duration: durationUs,
        material_id: "",
        material_name: v.filename,
        material_url: "",
        category_id: "",
        category_name: "local",
        crop_ratio: "free",
        crop_scale: 1.0,
        extra_type_option: 0,
        source: 0,
        source_platform: 0,
        formula_id: "",
        check_flag: 65535,
        is_unified_beauty_mode: false,
        picture_from: "none",
        picture_set_category_id: "",
        picture_set_category_name: "",
        team_id: "",
        local_material_id: "",
        origin_material_id: "",
        request_id: "",
        has_sound_separated: false,
        is_text_edit_overdub: false,
        is_ai_generate_content: false,
        aigc_type: "none",
        is_copyright: false,
        aigc_history_id: "",
        aigc_item_id: "",
        local_material_from: "",
        beauty_body_preset_id: "",
        live_photo_cover_path: "",
        live_photo_timestamp: -1,
        reverse_path: "",
        intensifies_path: "",
        reverse_intensifies_path: "",
        intensifies_audio_path: "",
        cartoon_path: "",
        crop: {
          upper_left_x: 0, upper_left_y: 0,
          upper_right_x: 1, upper_right_y: 0,
          lower_left_x: 0, lower_left_y: 1,
          lower_right_x: 1, lower_right_y: 1,
        },
        stable: { stable_level: 0, matrix_path: "", time_range: { start: 0, duration: 0 } },
        matting: { path: "", has_use_quick_brush: false, has_use_quick_eraser: false, reverse: false, custom_matting_id: "", blendMode: 0, blendColor: "", flag: 0, expansion: 0, feather: 0, interactiveTime: [], strokes: [] },
        video_algorithm: { path: "", time_range: null, algorithms: [], gameplay_configs: [], ai_background_configs: [] },
        audio_fade: null,
        object_locked: null,
        smart_motion: null,
        multi_camera_info: null,
        freeze: null,
        smart_match_info: { type: 0, query: "", is_hd: false },
        beauty_face_preset_infos: [],
      });

      // 速度材料
      speedMaterials.push({ id: speedId, type: "speed", mode: 0, speed: 1.0, curve_speed: null });

      // 画布材料
      canvasMaterials.push({
        id: canvasId, type: "canvas_blur", color: "", blur: 0.375, image: "",
        album_image: "", image_id: "", image_name: "", source_platform: 0, team_id: "",
      });

      // 音频通道映射
      soundChannelMaterials.push({
        id: soundId, type: "sound_channel_mapping", audio_channel_mapping: 0, is_config_open: false,
      });

      // 人声分离
      vocalSepMaterials.push({
        id: vocalId, type: "vocal_separation", choice: 0, production_path: "", time_range: null, removed_sounds: [],
      });

      // 片段
      segments.push({
        id: segId,
        material_id: matId,
        render_index: segments.length + 1,
        track_render_index: 0,
        visible: true,
        speed: 1.0,
        volume: 1.0,
        last_nonzero_volume: 1.0,
        reverse: false,
        is_placeholder: false,
        offset: 0,
        source_timerange: { start: 0, duration: durationUs },
        target_timerange: { start: timelinePos, duration: durationUs },
        render_timerange: { start: 0, duration: 0 },
        clip: {
          rotation: 0,
          alpha: 1.0,
          scale: { x: 1.0, y: 1.0 },
          transform: { x: 0.0, y: 0.0 },
          flip: { vertical: false, horizontal: false },
        },
        uniform_scale: { on: true, value: 1.0 },
        hdr_settings: { mode: 1, intensity: 1.0, nits: 1000 },
        extra_material_refs: [speedId, canvasId, soundId, vocalId],
        desc: "",
        state: 0,
        is_loop: false,
        is_tone_modify: false,
        intensifies_audio: false,
        cartoon: false,
        enable_lut: true,
        enable_adjust: true,
        enable_hsl: true,
        enable_color_curves: true,
        enable_color_wheels: true,
        enable_smart_color_adjust: false,
        enable_color_match_adjust: false,
        enable_color_correct_adjust: false,
        enable_adjust_mask: true,
        enable_video_mask: true,
        group_id: "",
        template_id: "",
        template_scene: "default",
        track_attribute: 0,
        raw_segment_id: "",
        caption_info: null,
        responsive_layout: { enable: false, target_follow: "", size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
        lyric_keyframes: null,
        keyframe_refs: [],
        common_keyframes: [],
      });

      timelinePos += durationUs;
      totalDuration += durationUs;
    }

    if (segments.length === 0) {
      return NextResponse.json({ error: "没有找到有效的视频文件" }, { status: 400 });
    }

    const trackId = uuid();

    // 构建 draft_content.json
    const draftContent = {
      id: draftContentId,
      version: 400000,
      new_version: "127.0.0",
      name: "",
      fps: 30,
      is_drop_frame_timecode: false,
      color_space: -1,
      render_index_track_mode_on: true,
      free_render_index_mode_on: false,
      static_cover_image_path: "",
      source: "default",
      path: "",
      duration: totalDuration,
      create_time: now,
      update_time: now,
      canvas_config: {
        dom_width: 0,
        dom_height: 0,
        ratio,
        width: canvasSize.w,
        height: canvasSize.h,
        background: null,
      },
      config: {
        video_mute: false,
        record_audio_last_index: 1,
        extract_audio_last_index: 1,
        original_sound_last_index: 1,
        subtitle_recognition_id: "",
        lyrics_recognition_id: "",
        subtitle_sync: true,
        lyrics_sync: true,
        sticker_max_index: 1,
        adjust_max_index: 1,
        material_save_mode: 0,
        maintrack_adsorb: false,
        combination_max_index: 1,
        multi_language_mode: "none",
        multi_language_main: "none",
        multi_language_current: "none",
        export_range: null,
        zoom_info_params: null,
        subtitle_keywords_config: null,
        subtitle_taskinfo: [],
        lyrics_taskinfo: [],
        attachment_info: [],
        system_font_list: [],
        multi_language_list: [],
      },
      platform: {
        os: "windows",
        os_version: "",
        app_version: "15.4.0",
        app_source: "",
        device_id: "",
        hard_disk_id: "",
        mac_address: "",
        app_id: 348188,
      },
      last_modified_platform: {
        os: "windows",
        os_version: "",
        app_version: "15.4.0",
        app_source: "",
        device_id: "",
        hard_disk_id: "",
        mac_address: "",
        app_id: 348188,
      },
      tracks: [
        {
          id: trackId,
          type: "video",
          flag: 0,
          attribute: 0,
          name: "Screen",
          is_default_name: false,
          segments,
        },
      ],
      materials: {
        videos: videoMaterials,
        audios: [],
        texts: [],
        canvases: canvasMaterials,
        speeds: speedMaterials,
        sound_channel_mappings: soundChannelMaterials,
        vocal_separations: vocalSepMaterials,
        beats: [],
        effects: [],
        stickers: [],
        transitions: [],
        images: [],
        flowers: [],
        tail_leaders: [],
        audio_effects: [],
        audio_fades: [],
        material_animations: [],
        placeholders: [],
        placeholder_infos: [],
        common_mask: [],
        chromas: [],
        text_templates: [],
        realtime_denoises: [],
        video_trackings: [],
        hsl: [],
        drafts: [],
        color_curves: [],
        primary_color_wheels: [],
        log_color_wheels: [],
        video_effects: [],
        audio_balances: [],
        handwrites: [],
        manual_deformations: [],
        plugin_effects: [],
        green_screens: [],
        shapes: [],
        material_colors: [],
        digital_humans: [],
        smart_crops: [],
        ai_translates: [],
        audio_track_indexes: [],
        loudnesses: [],
        vocal_beautifys: [],
        smart_relights: [],
        time_marks: [],
        multi_language_refs: [],
      },
      keyframes: {
        videos: [], audios: [], texts: [], stickers: [],
        filters: [], adjusts: [], handwrites: [], effects: [],
      },
      keyframe_graph_list: [],
      relationships: [],
      lyrics_effects: [],
      group_container: null,
      mutable_config: null,
      cover: null,
      retouch_cover: null,
      time_marks: null,
      extra_info: {
        text_to_video: { version: "", type: 0, template_id: "", video_generator_type: 0, picture_set_id: "", recommend_info: { title: "", link: "", custom_title: "", event_id: 0, section_segment_relationship: "" }, text: [], video: [], bgm: [], mismatch_audio_ids: [] },
        track_info: null,
        subtitle_fragment_info_list: [],
      },
    };

    // 写入文件
    fs.writeFileSync(path.join(draftFolder, "draft_content.json"), JSON.stringify(draftContent, null, 2), "utf-8");
    fs.writeFileSync(path.join(draftFolder, "draft_content.json.bak"), JSON.stringify(draftContent, null, 2), "utf-8");

    // draft_settings
    const nowSec = Math.floor(Date.now() / 1000);
    fs.writeFileSync(path.join(draftFolder, "draft_settings"), `[General]\ndraft_create_time=${nowSec}\ndraft_last_edit_time=${nowSec}\nreal_edit_seconds=0\nreal_edit_keys=0\n`, "utf-8");

    // 辅助 JSON 文件
    fs.writeFileSync(path.join(draftFolder, "draft_agency_config.json"), JSON.stringify({ is_auto_agency_enabled: false, is_auto_agency_popup: false, is_single_agency_mode: false, marterials: null, use_converter: false, video_resolution: 720 }), "utf-8");
    fs.writeFileSync(path.join(draftFolder, "draft_biz_config.json"), "", "utf-8");
    fs.writeFileSync(path.join(draftFolder, "draft_virtual_store.json"), JSON.stringify({ draft_materials: [], draft_virtual_store: [{ type: 0, value: [{ creation_time: 0, display_name: "", filter_type: 0, id: "", import_time: 0, import_time_us: 0, sort_sub_type: 0, sort_type: 0, subdraft_filter_type: 0 }] }, { type: 1, value: [{ child_id: "", parent_id: "" }] }, { type: 2, value: [] }] }), "utf-8");
    fs.writeFileSync(path.join(draftFolder, "performance_opt_info.json"), JSON.stringify({ manual_cancle_precombine_segs: null, need_auto_precombine_segs: null }), "utf-8");
    fs.writeFileSync(path.join(draftFolder, "key_value.json"), "{}", "utf-8");

    const timelineId = uuid();
    fs.writeFileSync(path.join(draftFolder, "timeline_layout.json"), JSON.stringify({ dockItems: [{ dockIndex: 0, ratio: 1, timelineIds: [timelineId], timelineNames: ["时间线01"] }], layoutOrientation: 1 }), "utf-8");
    fs.writeFileSync(path.join(draftFolder, "attachment_pc_common.json"), JSON.stringify({ ai_packaging_infos: [], ai_packaging_report_info: { caption_id_list: [], commercial_material: "", material_source: "", method: "", page_from: "", style: "", task_id: "", text_style: "", tos_id: "", video_category: "" }, broll: { ai_packaging_infos: [], ai_packaging_report_info: { caption_id_list: [], commercial_material: "", material_source: "", method: "", page_from: "", style: "", task_id: "", text_style: "", tos_id: "", video_category: "" } }, commercial_music_category_ids: [], pc_feature_flag: 0, recognize_tasks: [], template_item_infos: [], unlock_template_ids: [] }), "utf-8");

    // 创建子目录
    for (const sub of ["audio", "video", "image", "effect", "cover", "common_attachment", "matting", "smart_crop", "subdraft", "Resources", "Timelines"]) {
      fs.mkdirSync(path.join(draftFolder, sub), { recursive: true });
    }

    // 写入导入说明
    const readmeTxt = `
╔═══════════════════════════════════════════════════╗
║           飞彩工作室 → 剪映草稿导入教程             ║
╚═══════════════════════════════════════════════════╝

本草稿由飞彩工作室自动生成，包含 ${segments.length} 个视频片段。

【导入方法（推荐）】
1. 打开剪映专业版
2. 在首页点击「导入草稿」或「导入项目」
3. 选择本文件夹（${draftName}）
4. 剪映会自动识别并加载到时间线

【手动导入方法】
1. 找到剪映草稿存储位置：
   - 默认路径：C:\\Users\\你的用户名\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft\\
   - 或自定义路径（剪映 → 设置 → 草稿位置）
2. 将整个「${draftName}」文件夹复制到上述目录中
3. 重启剪映，草稿将出现在首页列表中

【注意事项】
- 视频文件引用的是绝对路径，请勿移动 outputs/videos/ 下的源视频文件
- 如果剪映无法识别，请确认剪映版本 ≥ 5.0
- 草稿画布比例：${ratio}（${canvasSize.w}×${canvasSize.h}）
- 总时长：${(totalDuration / 1_000_000).toFixed(1)} 秒
`.trim();

    fs.writeFileSync(path.join(draftFolder, "导入教程.txt"), readmeTxt, "utf-8");

    // 返回草稿路径
    const draftPathNormalized = draftFolder.replace(/\\/g, "/");
    return NextResponse.json({
      draftPath: draftPathNormalized,
      videoCount: segments.length,
      totalDurationSec: totalDuration / 1_000_000,
      draftName,
    });
  } catch (e) {
    console.error("[JianyingDraft] Error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "未知错误" }, { status: 500 });
  }
}
