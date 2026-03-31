"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// ═══════════════════════════════════════════════════════════
// Global Task Queue — shared across all pages
// ═══════════════════════════════════════════════════════════

export type TaskType = "llm" | "image" | "video";

export interface Task {
  id: string;
  type: TaskType;
  label: string;          // 简短描述，如 "EP01 格1 视频生成"
  detail?: string;        // 附加信息，如 "veo_3_1-fast · 单图模式"
  startedAt: number;
}

interface TaskQueueContextType {
  tasks: Task[];
  addTask: (task: Omit<Task, "startedAt">) => void;
  removeTask: (id: string) => void;
  updateTask: (id: string, patch: Partial<Pick<Task, "label" | "detail">>) => void;
  clearAll: () => void;
}

const TaskQueueContext = createContext<TaskQueueContextType>({
  tasks: [],
  addTask: () => {},
  removeTask: () => {},
  updateTask: () => {},
  clearAll: () => {},
});

export function useTaskQueue() {
  return useContext(TaskQueueContext);
}

export function TaskQueueProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);

  const addTask = useCallback((task: Omit<Task, "startedAt">) => {
    setTasks((prev) => [...prev, { ...task, startedAt: Date.now() }]);
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Pick<Task, "label" | "detail">>) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const clearAll = useCallback(() => {
    setTasks([]);
  }, []);

  return (
    <TaskQueueContext.Provider value={{ tasks, addTask, removeTask, updateTask, clearAll }}>
      {children}
    </TaskQueueContext.Provider>
  );
}
