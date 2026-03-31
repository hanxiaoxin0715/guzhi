"use client";

/**
 * ════════════════════════════════════════════════════════════
 * AgentChat — 智能体对话面板组件
 * ════════════════════════════════════════════════════════════
 *
 * 参考 Toonflow 的右侧聊天面板设计。
 * 特性：
 * - 不同 Agent 显示不同颜色/图标
 * - 工具调用/操作卡片内联展示
 * - 思考过程可折叠
 * - Agent 转移通知
 * - 底部输入 + 智能体预提示
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Loader,
  Trash2,
  Settings,
  Sparkles,
  Play,
  Zap,
  CheckCircle,
  XCircle,
  User,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { ChatMessage, AgentRole, CanvasAction } from "../lib/director/types";
import { AGENTS } from "../lib/director/types";
import { inferAgent } from "../lib/director/orchestrator";

interface AgentChatProps {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
  onExecuteActions: (msgId: string) => void;
  onClear: () => void;
  settingsOk: boolean;
  onGoSettings: () => void;
}

// ── 操作状态图标 ──
function ActionStatusIcon({ status }: { status: CanvasAction["status"] }) {
  switch (status) {
    case "pending": return <div className="w-3 h-3 rounded-full border-2 border-[var(--text-muted)]" />;
    case "executing": return <Loader size={12} className="text-[var(--gold-primary)] animate-spin" />;
    case "completed": return <CheckCircle size={12} className="text-emerald-400" />;
    case "failed": return <XCircle size={12} className="text-red-400" />;
  }
}

// ── 操作卡片 ──
function ActionCard({ action }: { action: CanvasAction }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-page)] border border-[var(--border-default)] rounded text-[11px]">
      <ActionStatusIcon status={action.status} />
      <span className="text-[var(--text-secondary)] font-mono">{action.type}</span>
      {action.result && (
        <span className={`ml-auto truncate max-w-[200px] ${action.status === "failed" ? "text-red-400" : "text-[var(--text-muted)]"}`}>
          {action.result.slice(0, 80)}
        </span>
      )}
    </div>
  );
}

// ── 消息气泡 ──
function MessageBubble({
  msg,
  onExecuteActions,
}: {
  msg: ChatMessage;
  onExecuteActions: (msgId: string) => void;
}) {
  const isUser = msg.role === "user";
  const agent = msg.agent ? AGENTS[msg.agent] : null;
  const hasPendingActions = msg.actions?.some((a) => a.status === "pending");
  const [showThinking, setShowThinking] = useState(false);

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* 头像 */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[12px]"
        style={{
          background: isUser ? "var(--gold-transparent)" : agent ? `${agent.color}20` : "var(--bg-surface)",
          border: `1px solid ${isUser ? "var(--gold-primary)" : agent?.color || "var(--border-default)"}`,
        }}
      >
        {isUser ? <User size={12} className="text-[var(--gold-primary)]" /> : agent?.icon || "🤖"}
      </div>

      {/* 内容 */}
      <div className={`flex flex-col gap-1 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        {/* 智能体名称 */}
        {!isUser && agent && (
          <span className="text-[9px] font-medium" style={{ color: agent.color }}>
            {agent.icon} {agent.name}
          </span>
        )}

        {/* 思考过程 */}
        {msg.thinking && (
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="flex items-center gap-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            💭 思考过程 {showThinking ? <ChevronUp size={8} /> : <ChevronDown size={8} />}
          </button>
        )}
        {showThinking && msg.thinking && (
          <div className="px-3 py-2 bg-[#0D0D0D] border-l-2 border-[var(--text-muted)] text-[10px] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap rounded max-h-[120px] overflow-auto">
            {msg.thinking}
          </div>
        )}

        {/* 消息文本 */}
        <div
          className={`px-3 py-2 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap ${
            isUser
              ? "bg-[var(--gold-primary)] text-[#0A0A0A]"
              : "bg-[#111111] text-[var(--text-primary)] border border-[var(--border-default)]"
          }`}
        >
          {msg.content}
        </div>

        {/* 操作卡片列表 */}
        {msg.actions && msg.actions.length > 0 && (
          <div className="flex flex-col gap-1 w-full">
            <div className="flex items-center gap-1.5 text-[9px] text-[var(--text-muted)] mt-0.5">
              <Zap size={9} />
              <span>画布操作 ({msg.actions.length})</span>
            </div>
            {msg.actions.map((action) => (
              <ActionCard key={action.id} action={action} />
            ))}
            {hasPendingActions && (
              <button
                onClick={() => onExecuteActions(msg.id)}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 mt-0.5 bg-[var(--gold-primary)] text-[#0A0A0A] text-[10px] font-medium rounded hover:brightness-110 transition cursor-pointer"
              >
                <Play size={11} />
                执行操作
              </button>
            )}
          </div>
        )}

        {/* 时间戳 */}
        <span className="text-[8px] text-[var(--text-muted)]">
          {new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════

export default function AgentChat({
  messages,
  loading,
  onSend,
  onExecuteActions,
  onClear,
  settingsOk,
  onGoSettings,
}: AgentChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput("");
    inputRef.current?.focus();
  }, [input, loading, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const hintAgent = input.trim() ? inferAgent(input) : "director";
  const hintInfo = AGENTS[hintAgent];

  // 统计各 Agent 消息数
  const agentStats = (["story", "shot", "image"] as AgentRole[]).map((role) => ({
    ...AGENTS[role],
    count: messages.filter((m) => m.agent === role).length,
  }));

  return (
    <div className="flex flex-col h-full bg-[#0D0D0D]">
      {/* ── 头部 ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-default)] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[var(--text-primary)]">AI 对话</span>
          {/* 在线 Agent 指示器 */}
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[9px] text-[var(--text-muted)]">3 Agent</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!settingsOk && (
            <button
              onClick={onGoSettings}
              className="flex items-center gap-1 px-2 py-1 text-[9px] text-red-400 border border-red-400/30 rounded hover:bg-red-400/10 transition cursor-pointer"
            >
              <Settings size={10} />
              配置
            </button>
          )}
          <button
            onClick={onClear}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
            title="清除对话"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* ── Agent 状态条 ── */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--border-default)] shrink-0">
        {agentStats.map((a) => (
          <div key={a.role} className="flex items-center gap-1 text-[9px]" style={{ color: a.color }}>
            <span>{a.icon}</span>
            <span>{a.name}</span>
            {a.count > 0 && (
              <span className="px-1 py-0.5 rounded text-[8px]" style={{ background: `${a.color}15` }}>
                {a.count}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ── 消息列表 ── */}
      <div ref={scrollRef} className="flex-1 px-4 py-3 space-y-3 overflow-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
            <span className="text-[32px] opacity-20">🤖</span>
            <span className="text-[11px]">开始对话，让智能体创建分镜</span>
            <div className="flex flex-col gap-1.5 w-full">
              {[
                "帮我分析这段剧本，创建6格分镜",
                "添加角色：叶云，男，黑发红眸",
                "生成所有格子的图片",
              ].map((hint) => (
                <button
                  key={hint}
                  onClick={() => setInput(hint)}
                  className="px-3 py-1.5 text-left text-[10px] text-[var(--text-secondary)] bg-[#111111] border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] transition cursor-pointer"
                >
                  &ldquo;{hint}&rdquo;
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onExecuteActions={onExecuteActions} />
          ))
        )}

        {/* 加载指示器 */}
        {loading && (
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: `${hintInfo.color}20`, border: `1px solid ${hintInfo.color}` }}
            >
              <Loader size={12} className="animate-spin" style={{ color: hintInfo.color }} />
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2 bg-[#111111] border border-[var(--border-default)] rounded-lg">
              <span className="text-[11px] text-[var(--text-muted)]">
                {hintInfo.icon} {hintInfo.name} 思考中...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── 输入区 ── */}
      <div className="border-t border-[var(--border-default)] px-3 py-2.5 shrink-0">
        {/* 智能体预提示 */}
        {input.trim() && (
          <div className="flex items-center gap-1 mb-1.5 text-[9px]" style={{ color: hintInfo.color }}>
            <Sparkles size={9} />
            <span>→ {hintInfo.icon} {hintInfo.name}</span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入指令..."
            className="flex-1 min-h-[36px] max-h-[120px] bg-[#111111] border border-[var(--border-default)] text-[12px] text-[var(--text-primary)] px-3 py-2 outline-none focus:border-[var(--gold-primary)] transition resize-none rounded"
            rows={1}
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="flex items-center justify-center w-[36px] h-[36px] bg-[var(--gold-primary)] text-[#0A0A0A] rounded hover:brightness-110 transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            {loading ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[8px] text-[var(--text-muted)]">
          <span>Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>
    </div>
  );
}
