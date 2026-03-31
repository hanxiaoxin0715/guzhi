"use client";

// ═══════════════════════════════════════════════════════════
// 即梦生图 · 客户端任务管理器（全局单例）
// 负责后台轮询、结果存储、完成通知
// 组件卸载 / 页面切换不影响轮询进程
// ═══════════════════════════════════════════════════════════

export interface JimengClientTask {
  taskId: string;
  /** 任务标签，如 "角色: 悟空" */
  label: string;
  status: "polling" | "done" | "error";
  /** 生成的图片 URL 列表 */
  images: string[];
  error?: string;
  startTime: number;
  endTime?: number;
  model: string;
  resolution: string;
  /** 生成目标：一致性列表类型（用于历史选图回填） */
  targetListKey?: "characters" | "scenes" | "props";
  /** 生成目标：一致性项目 ID（用于历史选图回填） */
  targetItemId?: string;
  /** 生成目标：宫格 key（如 nine-ep01-2，用于历史选图回填到宫格） */
  targetGridKey?: string;
  /** 用户上次确认选中的图片索引（0-based，持久化） */
  selectedIndex?: number;
  /** 用户已确认锁定选图（切换页面后不会回退到第一张） */
  locked?: boolean;
}

type Listener = () => void;

class JimengClientTaskStore {
  private _tasks: JimengClientTask[] = [];
  private _listeners = new Set<Listener>();
  private _resolvers = new Map<string, (images: string[]) => void>();
  private _newCompletedCount = 0;

  constructor() {
    this._loadFromStorage();
  }

  // ── 持久化 ──

  private _loadFromStorage() {
    try {
      const raw = localStorage.getItem("feicai-jimeng-task-history");
      if (raw) {
        const saved = JSON.parse(raw) as JimengClientTask[];
        // 保留最近 30 条；页面刷新导致中断的活跃任务标记为错误
        this._tasks = saved.slice(-30).map(t =>
          t.status === "polling"
            ? { ...t, status: "error" as const, error: "页面刷新中断", endTime: t.endTime || Date.now() }
            : t,
        );
      } else {
        // localStorage 为空时从磁盘恢复（防止浏览器清除后丢失）
        this._loadFromDisk();
      }
    } catch {
      // localStorage 异常时尝试磁盘恢复
      this._loadFromDisk();
    }
  }

  /** 从磁盘恢复任务历史（异步，localStorage 为空时触发） */
  private _loadFromDisk() {
    fetch("/api/jimeng-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load-history" }),
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.tasks) && data.tasks.length > 0) {
          this._tasks = (data.tasks as JimengClientTask[]).slice(-30).map(t =>
            t.status === "polling"
              ? { ...t, status: "error" as const, error: "页面刷新中断", endTime: t.endTime || Date.now() }
              : t,
          );
          // 回写 localStorage 作为快速缓存
          try { localStorage.setItem("feicai-jimeng-task-history", JSON.stringify(this._tasks.slice(-30))); } catch { /* */ }
          this._listeners.forEach(fn => { try { fn(); } catch { /* */ } });
          console.log(`[JimengTaskStore] ✓ 从磁盘恢复 ${this._tasks.length} 条任务历史`);
        }
      })
      .catch(() => { /* 磁盘加载失败也不影响正常流程 */ });
  }

  private _saveToStorage() {
    const data = this._tasks.slice(-30);
    // 1. localStorage 快速缓存
    try { localStorage.setItem("feicai-jimeng-task-history", JSON.stringify(data)); } catch { /* */ }
    // 2. 磁盘持久化（异步，不阻塞 UI）
    this._saveToDisk(data);
  }

  /** 异步写入磁盘（防抖 300ms） */
  private _diskSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _saveToDisk(tasks: JimengClientTask[]) {
    if (this._diskSaveTimer) clearTimeout(this._diskSaveTimer);
    this._diskSaveTimer = setTimeout(() => {
      fetch("/api/jimeng-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-history", tasks }),
      }).catch(err => console.warn("[JimengTaskStore] 磁盘保存失败:", err));
    }, 300);
  }

  // ── 事件 ──

  private _emit() {
    this._listeners.forEach(fn => { try { fn(); } catch { /* */ } });
    this._saveToStorage();
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ── 公开 API ──

  getSnapshot(): JimengClientTask[] {
    // 返回新数组引用，确保 React setState 检测到变化并触发重渲染
    return [...this._tasks];
  }

  getNewCompletedCount(): number {
    return this._newCompletedCount;
  }

  clearNewCompleted(): void {
    this._newCompletedCount = 0;
  }

  addTask(info: {
    taskId: string;
    label: string;
    model: string;
    resolution: string;
    startTime: number;
    targetListKey?: "characters" | "scenes" | "props";
    targetItemId?: string;
    targetGridKey?: string;
  }): void {
    this._tasks.push({ ...info, status: "polling", images: [] });
    this._emit();
  }

  /**
   * 开始后台轮询，返回 Promise<图片URL[]>。
   * 即使调用方 Promise 被丢弃（如组件卸载），轮询仍会继续。
   */
  pollUntilDone(taskId: string): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
      this._resolvers.set(taskId, resolve);
      this._runPollLoop(taskId);
    });
  }

  clearHistory(): void {
    this._tasks = this._tasks.filter(t => t.status === "polling");
    this._newCompletedCount = 0;
    this._emit();
  }

  removeTask(taskId: string): void {
    this._tasks = this._tasks.filter(t => t.taskId !== taskId);
    this._emit();
  }

  /** 更新任务的用户选中图片索引（持久化到 localStorage） */
  updateSelectedIndex(taskId: string, index: number): void {
    const task = this._tasks.find(t => t.taskId === taskId);
    if (task) {
      task.selectedIndex = index;
      this._emit();
    }
  }

  /** 锁定当前选中图片（防止意外切换/回退） */
  lockSelection(taskId: string): void {
    const task = this._tasks.find(t => t.taskId === taskId);
    if (task) {
      task.locked = true;
      this._emit();
    }
  }

  /** 解锁选图（允许重新选择） */
  unlockSelection(taskId: string): void {
    const task = this._tasks.find(t => t.taskId === taskId);
    if (task) {
      task.locked = false;
      this._emit();
    }
  }

  requestNotificationPermission(): void {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  // ── 内部轮询（独立于 React 生命周期） ──

  private async _runPollLoop(taskId: string) {
    const maxWait = 600_000; // 10 分钟
    const start = Date.now();

    // 首次等待稍长（服务端需要时间启动生成）
    await new Promise<void>(r => setTimeout(r, 4000));

    while (Date.now() - start < maxWait) {
      const task = this._tasks.find(t => t.taskId === taskId);
      if (!task || task.status !== "polling") break;

      try {
        const res = await fetch("/api/jimeng-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", taskId }),
        });

        // 404 = 任务在服务端已丢失（热重载/重启）
        if (res.status === 404) {
          this._finishTask(taskId, "error", [], "任务已丢失（服务端重启），请重新生成");
          return;
        }

        const data = await res.json();

        // ★ 终态: done（无论是否有图片）
        if (data.status === "done") {
          const images: string[] = (data.results || []).map((r: { url: string }) => r.url).filter(Boolean);
          if (images.length > 0) {
            this._finishTask(taskId, "done", images);
          } else {
            this._finishTask(taskId, "error", [], "生成完成但未获取到图片");
          }
          return;
        }

        // ★ 终态: error
        if (data.status === "error") {
          this._finishTask(taskId, "error", [], data.error || "生成失败");
          return;
        }
      } catch (err) {
        console.warn("[JimengTaskStore] 轮询异常:", err);
      }

      await new Promise<void>(r => setTimeout(r, 3000));
    }

    // 超时
    this._finishTask(taskId, "error", [], "生成超时（10分钟）");
  }

  private _finishTask(taskId: string, status: "done" | "error", images: string[], error?: string) {
    const idx = this._tasks.findIndex(t => t.taskId === taskId);
    if (idx >= 0) {
      this._tasks[idx] = { ...this._tasks[idx], status, images, error, endTime: Date.now() };
    }
    if (status === "done") {
      this._newCompletedCount++;
      this._showNotification(taskId);
      // ★ 持久化全部图片到磁盘（防止即梦 CDN URL 过期）
      this._persistAllImages(taskId, images);
    }
    this._emit();
    const resolver = this._resolvers.get(taskId);
    if (resolver) {
      resolver(images);
      this._resolvers.delete(taskId);
    }
  }

  /**
   * 后台保存全部图片到磁盘，替换 task.images 中的 HTTP URL 为本地 URL
   * 即梦 CDN URL 有时效限制，存盘后用户随时可以从历史中导入
   */
  private async _persistAllImages(taskId: string, images: string[]) {
    const localUrls: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      if (!url || !url.startsWith("http")) { localUrls.push(url); continue; }
      const key = `jimeng-hist-${taskId.replace(/\W/g, "")}-${i}`;
      try {
        const res = await fetch("/api/jimeng-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", imageUrl: url, key }),
        });
        const data = await res.json();
        if (data.diskUrl) {
          localUrls.push(data.diskUrl);
        } else {
          localUrls.push(url);
        }
      } catch {
        localUrls.push(url); // 保存失败则保留原 URL
      }
    }
    // 替换 task 中的图片 URL 为本地 URL
    const idx = this._tasks.findIndex(t => t.taskId === taskId);
    if (idx >= 0) {
      this._tasks[idx] = { ...this._tasks[idx], images: localUrls };
      this._emit();
    }
  }

  private _showNotification(taskId: string) {
    if (typeof document === "undefined") return;
    const task = this._tasks.find(t => t.taskId === taskId);
    if (!task) return;
    // 仅页面不可见时弹浏览器通知
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("飞彩工作室 · 即梦生图完成", {
          body: `「${task.label}」${task.images.length} 张图片已就绪`,
          icon: "/favicon.ico",
        });
      } catch { /* */ }
    }
  }
}

// 全局单例（仅客户端）
let _instance: JimengClientTaskStore | null = null;

export function getJimengTaskStore(): JimengClientTaskStore {
  if (!_instance && typeof window !== "undefined") {
    _instance = new JimengClientTaskStore();
  }
  return _instance!;
}
