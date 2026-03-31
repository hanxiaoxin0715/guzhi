
"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "../components/Sidebar";
import MarkdownViewer from "../components/MarkdownViewer";
import { Send, Bot, User, Loader, Eraser } from "lucide-react";

export default function AIChatPage() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      // 从 localStorage 获取已配置的 LLM 设置
      const savedSettings = JSON.parse(localStorage.getItem("feicai-settings") || "{}");

      const response = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: savedSettings["llm-key"],
          baseUrl: savedSettings["llm-url"],
          model: savedSettings["llm-model"],
          provider: savedSettings["llm-provider"] || "openAi",
          prompt: userMsg,
          // 如果需要多轮对话，可以在此拼接之前的 messages 历史
          // 目前简单起见，只发送当前 prompt，如果 API 支持 system prompt 或 history，可以在这里扩展
        }),
      });

      const data = await response.json();
      if (response.ok && data.content) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
      } else {
        throw new Error(data.error || "请求失败");
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `**错误**: ${error.message}\n\n请检查 [设置](/settings) 页面中的 LLM 配置是否正确。` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    if (confirm("确定要清空对话记录吗？")) {
      setMessages([]);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[var(--bg-page)] overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full min-w-0">
        {/* Header */}
        <div className="h-16 px-6 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--bg-page)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--gold-transparent)] flex items-center justify-center border border-[var(--gold-primary)]">
              <Bot size={18} className="text-[var(--gold-primary)]" />
            </div>
            <h1 className="font-serif text-lg font-bold text-[var(--text-primary)]">AI 智能助手</h1>
          </div>
          <button 
            onClick={handleClear}
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition"
            title="清空对话"
          >
            <Eraser size={18} />
          </button>
        </div>

        {/* Message List */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-4">
              <Bot size={48} className="opacity-20" />
              <p>有什么我可以帮您的吗？</p>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-[var(--bg-surface)] flex items-center justify-center shrink-0 border border-[var(--border-default)] mt-1">
                  <Bot size={16} className="text-[var(--gold-primary)]" />
                </div>
              )}
              
              <div className={`max-w-[85%] p-4 rounded-lg shadow-sm ${
                msg.role === 'user' 
                  ? 'bg-[var(--gold-primary)] text-[#0A0A0A]' 
                  : 'bg-[var(--bg-surface)] border border-[var(--border-default)]'
              }`}>
                {msg.role === 'assistant' ? (
                  <div className="markdown-content">
                    <MarkdownViewer content={msg.content} />
                  </div>
                ) : (
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-[var(--bg-surface)] flex items-center justify-center shrink-0 border border-[var(--border-default)] mt-1">
                  <User size={16} className="text-[var(--text-secondary)]" />
                </div>
              )}
            </div>
          ))}
          
          {loading && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-surface)] flex items-center justify-center shrink-0 border border-[var(--border-default)]">
                <Bot size={16} className="text-[var(--gold-primary)]" />
              </div>
              <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] p-4 rounded-lg flex items-center gap-2">
                <Loader className="animate-spin text-[var(--gold-primary)]" size={16} />
                <span className="text-[13px] text-[var(--text-secondary)]">思考中...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-6 border-t border-[var(--border-default)] bg-[var(--bg-page)] shrink-0">
          <div className="max-w-4xl mx-auto relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="输入消息... (Shift + Enter 换行)"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-4 pr-12 text-[14px] text-[var(--text-primary)] focus:border-[var(--gold-primary)] outline-none resize-none scrollbar-thin transition min-h-[56px] max-h-[200px]"
              rows={1}
              style={{ height: 'auto', minHeight: '56px' }} 
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="absolute right-3 bottom-3 p-2 bg-[var(--gold-primary)] text-[#0A0A0A] rounded-lg hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={18} />
            </button>
          </div>
          <p className="text-center text-[11px] text-[var(--text-muted)] mt-2">
            AI 生成内容仅供参考，请仔细核对重要信息。
          </p>
        </div>
      </main>
    </div>
  );
}
