"use client";

import { useState, useEffect } from "react";
import { 
  Settings, 
  Loader2, 
  Save, 
  ShieldCheck,
  Eye,
  EyeOff,
  Sparkles,
  Server,
  HardDrive,
  Wrench,
  ChevronRight,
  Zap,
  RefreshCw,
  Download,
  AlertCircle,
} from "lucide-react";
import NovelToolsPage from "../tools/page"; // Import the Tools page content
import GeneratingOverlay from "../../components/GeneratingOverlay";

export default function NovelSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingMainApi, setTestingMainApi] = useState(false);
  const [testingAnalystApi, setTestingAnalystApi] = useState(false);
  const [testResult, setTestResult] = useState<{type: "success" | "error"; message: string} | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  const showToast = (type: "success" | "error", message: string) => {
      setTestResult({ type, message });
      setTimeout(() => setTestResult(null), 5000);
  };
  
  // Settings State
  const [activeTab, setActiveTab] = useState<"api" | "tools" | "update">("api"); // New Tab State

  // ... (keep existing state)
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("gemini-2.0-flash");
  const [showKey, setShowKey] = useState(false);
  const [analystApiKey, setAnalystApiKey] = useState("");
  const [analystBaseUrl, setAnalystBaseUrl] = useState("");
  const [analystModel, setAnalystModel] = useState("");
  const [showAnalystKey, setShowAnalystKey] = useState(false);
  const [activeProvider, setActiveProvider] = useState("Google");
  const [apiProvider, setApiProvider] = useState("openai");

  // File Storage
  const [storagePath, setStoragePath] = useState("");
  const [defaultStoragePath, setDefaultStoragePath] = useState("");
  const [mockLLM, setMockLLM] = useState("");
  const [mockLLMMode, setMockLLMMode] = useState("");

  useEffect(() => {
    const init = async () => {
        try {
            // Load Workspace Settings
            const keys = [
                "GEMINI_API_KEY", "GEMINI_BASE_URL", "GEMINI_MODEL", 
                "API_PROVIDER_TYPE", "ACTIVE_PROVIDER_TAB",
                "ANALYST_API_KEY", "ANALYST_BASE_URL", "ANALYST_MODEL",
                "MOCK_LLM", "MOCK_LLM_MODE"
            ];
            const results = await Promise.all(
                keys.map(key => 
                    fetch(`/api/workspace-file?key=${key}`)
                        .then(res => res.ok ? res.json() : { value: "" })
                        .catch(() => ({ value: "" }))
                )
            );

            // Load Path Config
            const pathRes = await fetch("/api/settings/storage-path");
            if (pathRes.ok) {
                const pathData = await pathRes.json();
                setStoragePath(pathData.path);
                setDefaultStoragePath(pathData.defaultPath);
            }

            const parseValue = (val: any) => {
                if (!val) return "";
                if (typeof val !== 'string') return String(val);
                try {
                    const parsed = JSON.parse(val);
                    if (parsed && typeof parsed === 'object' && parsed.content) return parsed.content;
                    return typeof parsed === 'string' ? parsed : val;
                } catch {
                    return val;
                }
            };

            const [
                keyData,
                urlData,
                modelData,
                providerTypeData,
                activeTabData,
                analystKeyData,
                analystUrlData,
                analystModelData,
                mockData,
                mockModeData
            ] = results;
            if (keyData.value) setApiKey(parseValue(keyData.value));
            if (urlData.value) setBaseUrl(parseValue(urlData.value));
            if (modelData.value) setModelName(parseValue(modelData.value));
            if (providerTypeData.value) setApiProvider(parseValue(providerTypeData.value));
            if (activeTabData.value) setActiveProvider(parseValue(activeTabData.value));
            if (analystKeyData?.value) setAnalystApiKey(parseValue(analystKeyData.value));
            if (analystUrlData?.value) setAnalystBaseUrl(parseValue(analystUrlData.value));
            if (analystModelData?.value) setAnalystModel(parseValue(analystModelData.value));
            if (mockData.value) setMockLLM(parseValue(mockData.value));
            if (mockModeData.value) setMockLLMMode(parseValue(mockModeData.value));
            
        } catch (e) {
            console.error("Settings load error:", e);
        } finally {
            setLoading(false);
        }
    };
    init();
  }, []);

  const handleSave = async () => {
      setSaving(true);
      setShowSaveConfirm(false);
      try {
          await Promise.all([
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "GEMINI_API_KEY", value: apiKey })
              }),
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "GEMINI_BASE_URL", value: baseUrl })
              }),
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "GEMINI_MODEL", value: modelName })
              }),
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "ANALYST_API_KEY", value: analystApiKey })
              }),
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "ANALYST_BASE_URL", value: analystBaseUrl })
              }),
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "ANALYST_MODEL", value: analystModel })
              }),
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "API_PROVIDER_TYPE", value: apiProvider })
              }),
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "ACTIVE_PROVIDER_TAB", value: activeProvider })
              }),
              fetch("/api/settings/storage-path", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ path: storagePath })
              })
          ]);
          showToast("success", "设置已保存成功！");
      } catch (e) {
          showToast("error", "保存失败，请重试");
      } finally {
          setSaving(false);
      }
  };

  const disableMockLLM = async () => {
      setSaving(true);
      try {
          await Promise.all([
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "MOCK_LLM", value: "" })
              }),
              fetch("/api/workspace-file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "MOCK_LLM_MODE", value: "" })
              })
          ]);
          setMockLLM("");
          setMockLLMMode("");
          showToast("success", "已关闭测试模式（Mock LLM）");
      } catch {
          showToast("error", "关闭失败，请重试");
      } finally {
          setSaving(false);
      }
  };

  const handleTestMainApi = async () => {
      if (!apiKey) {
          showToast("error", "请先填写 API Key");
          return;
      }
      setTestingMainApi(true);
      setTestResult(null);
      try {
          const res = await fetch("/api/ai/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: "Hi" })
          });
          if (res.ok) {
              showToast("success", "主要写作模型 API 连接成功！");
          } else {
              const err = await res.json();
              throw new Error(err.error || "连接失败");
          }
      } catch (e: any) {
          showToast("error", `连接失败: ${e.message}`);
      } finally {
          setTestingMainApi(false);
      }
  };

  const handleTestAnalystApi = async () => {
      if (!analystApiKey) {
          showToast("error", "请先填写审计模型 API Key");
          return;
      }
      setTestingAnalystApi(true);
      setTestResult(null);
      try {
          const res = await fetch("/api/ai/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: "Hi", useAnalyst: true })
          });
          if (res.ok) {
              showToast("success", "审计模型 API 连接成功！");
          } else {
              const err = await res.json();
              throw new Error(err.error || "连接失败");
          }
      } catch (e: any) {
          showToast("error", `连接失败: ${e.message}`);
      } finally {
          setTestingAnalystApi(false);
      }
  };

  const restoreDefaultPath = () => {
      setStoragePath(defaultStoragePath);
  };

  if (loading) {
      return <div className="flex items-center justify-center h-full text-[var(--text-muted)]"><Loader2 size={24} className="animate-spin mr-2"/> 加载中...</div>;
  }

  const isMainApiConfigured = apiKey.trim().length > 0;
  const isAnalystConfigured = analystApiKey.trim().length > 0;

  return (
    <div className="flex h-full overflow-hidden bg-[#0a0a0a] text-[#ededed]">
      <GeneratingOverlay open={saving} title="正在保存设置" detail="请稍候" />
      
      {/* Save Confirmation Modal */}
      {showSaveConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="w-full max-w-md p-6 mx-4 bg-[#151515] border border-[#2a2a2a] rounded-2xl shadow-2xl">
                  <div className="flex items-center gap-4 mb-5">
                      <div className="w-12 h-12 bg-[#e8c060]/10 rounded-xl flex items-center justify-center">
                          <Save size={24} className="text-[#e8c060]" />
                      </div>
                      <div>
                          <h3 className="text-[16px] font-bold text-[#ededed]">确认保存</h3>
                          <p className="text-[12px] text-[#666]">确定要保存当前所有设置吗？</p>
                      </div>
                  </div>
                  <div className="flex gap-3">
                      <button 
                          onClick={() => setShowSaveConfirm(false)}
                          className="flex-1 px-4 py-2.5 bg-[#1a1a1a] border border-[#2a2a2a] text-[#888] text-[13px] font-medium rounded-lg hover:bg-[#222] hover:text-[#ededed] transition"
                      >
                          取消
                      </button>
                      <button 
                          onClick={handleSave}
                          disabled={saving}
                          className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#e8c060] to-[#d4a94d] text-[#0a0a0a] text-[13px] font-bold rounded-lg hover:brightness-110 transition disabled:opacity-50"
                      >
                          {saving ? "保存中..." : "确认保存"}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Test Result Toast */}
      {testResult && (
          <div className="fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-[#151515] border rounded-xl shadow-2xl animate-in slide-in-from-right-full">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${testResult.type === "success" ? "bg-[#22c55e]/10" : "bg-[#ef4444]/10"}`}>
                  {testResult.type === "success" ? (
                      <svg className="w-5 h-5 text-[#22c55e]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                  ) : (
                      <svg className="w-5 h-5 text-[#ef4444]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                  )}
              </div>
              <span className={`text-[13px] font-medium ${testResult.type === "success" ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                  {testResult.message}
              </span>
          </div>
      )}
      {/* Sidebar Navigation */}
      <div className="w-[260px] border-r border-[#1f1f1f] flex flex-col h-full bg-[#0a0a0a] shrink-0">
          <div className="p-6 border-b border-[#1f1f1f]">
              <h1 className="text-[18px] font-bold text-[#ededed] flex items-center gap-3">
                  <div className="w-9 h-9 bg-gradient-to-br from-[#e8c060] to-[#c49a3d] rounded-xl flex items-center justify-center shadow-lg">
                      <Settings size={18} className="text-[#0a0a0a]" />
                  </div>
                  <span className="font-serif">系统设置</span>
              </h1>
          </div>
          <div className="flex-1 py-4 flex flex-col gap-2 px-3">
              <div className="px-3 py-2 text-[10px] font-bold text-[#444] uppercase tracking-widest">配置</div>
              <button 
                  onClick={() => setActiveTab("api")}
                  className={`flex items-center justify-between px-4 py-3.5 text-[13px] font-medium rounded-lg transition group ${activeTab === "api" ? "bg-[#e8c060]/10 text-[#e8c060]" : "text-[#888] hover:text-[#ededed] hover:bg-[#141414]"}`}
              >
                  <div className="flex items-center gap-3">
                      <Server size={16} />
                      <span>API 连接</span>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${isMainApiConfigured ? "bg-[#22c55e]" : "bg-[#444] group-hover:bg-[#666]"}`} />
              </button>
              <button 
                  onClick={() => setActiveTab("tools")}
                  className={`flex items-center justify-between px-4 py-3.5 text-[13px] font-medium rounded-lg transition group ${activeTab === "tools" ? "bg-[#e8c060]/10 text-[#e8c060]" : "text-[#888] hover:text-[#ededed] hover:bg-[#141414]"}`}
              >
                  <div className="flex items-center gap-3">
                      <Wrench size={16} />
                      <span>创作工具</span>
                  </div>
                  <ChevronRight size={14} className="text-[#444]" />
              </button>
              <button 
                  onClick={() => setActiveTab("update")}
                  className={`flex items-center justify-between px-4 py-3.5 text-[13px] font-medium rounded-lg transition group ${activeTab === "update" ? "bg-[#e8c060]/10 text-[#e8c060]" : "text-[#888] hover:text-[#ededed] hover:bg-[#141414]"}`}
              >
                  <div className="flex items-center gap-3">
                      <RefreshCw size={16} />
                      <span>在线更新</span>
                  </div>
                  <ChevronRight size={14} className="text-[#444]" />
              </button>
              
              <div className="mt-6 px-3 py-2 text-[10px] font-bold text-[#444] uppercase tracking-widest">状态</div>
              <div className="px-4 py-3 rounded-lg bg-[#111] border border-[#1f1f1f]">
                  <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-[#666]">主要 API</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${isMainApiConfigured ? "bg-[#22c55e]/10 text-[#22c55e]" : "bg-[#ef4444]/10 text-[#ef4444]"}`}>
                          {isMainApiConfigured ? "已配置" : "未配置"}
                      </span>
                  </div>
                  <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#666]">审计 API</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${isAnalystConfigured ? "bg-[#22c55e]/10 text-[#22c55e]" : "bg-[#666]/10 text-[#666]"}`}>
                          {isAnalystConfigured ? "已配置" : "默认"}
                      </span>
                  </div>
              </div>
          </div>
          
          <div className="p-4 border-t border-[#1f1f1f]">
              <button 
                  onClick={() => setShowSaveConfirm(true)}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#e8c060] to-[#d4a94d] text-[#0a0a0a] text-[13px] font-bold rounded-lg hover:brightness-110 transition disabled:opacity-50"
              >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  保存全部设置
              </button>
          </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
          {activeTab === "tools" ? (
              <NovelToolsPage />
          ) : activeTab === "update" ? (
              <UpdatePanel />
          ) : (
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                  <div className="max-w-[900px] mx-auto p-8 flex flex-col gap-8">
                      {String(mockLLM).trim() && (
                          <div className="p-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 backdrop-blur-sm">
                              <div className="flex items-center justify-between gap-4">
                                  <div className="flex items-start gap-3">
                                      <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                                          <Zap size={16} className="text-amber-500" />
                                      </div>
                                      <div className="flex flex-col gap-1">
                                          <div className="text-[13px] font-bold text-amber-500">测试模式已启用</div>
                                          <div className="text-[12px] text-[#888] leading-relaxed">
                                              离线冒烟测试用，秒出结果。要获得真实 AI 质量请关闭。
                                              {mockLLMMode && <span className="text-amber-500 ml-1">当前：{mockLLMMode}</span>}
                                          </div>
                                      </div>
                                  </div>
                                  <button
                                      onClick={disableMockLLM}
                                      disabled={saving}
                                      className="px-4 py-2 bg-[#1a1a1a] border border-amber-500/30 text-amber-500 text-[12px] font-medium rounded-lg hover:bg-amber-500/10 transition disabled:opacity-50"
                                  >
                                      关闭
                                  </button>
                              </div>
                          </div>
                      )}
                      
                      {/* Header */}
                      <div className="flex items-center justify-between">
                          <div>
                              <h2 className="text-[22px] font-bold text-[#ededed]">API 连接配置</h2>
                              <p className="text-[13px] text-[#666] mt-1">配置 AI 模型的 API 连接信息</p>
                          </div>
                      </div>

                      {/* Card 1: 主要写作模型 */}
                      <div className="flex flex-col gap-5 p-6 rounded-2xl bg-[#0d0d0d] border border-[#1f1f1f] hover:border-[#e8c060]/20 transition">
                          <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-gradient-to-br from-[#e8c060]/20 to-[#e8c060]/5 rounded-xl flex items-center justify-center">
                                      <Sparkles size={20} className="text-[#e8c060]" />
                                  </div>
                                  <div>
                                      <div className="flex items-center gap-2">
                                          <span className="text-[15px] font-bold text-[#ededed]">主要写作模型</span>
                                          <span className="text-[10px] px-2 py-0.5 bg-[#e8c060]/10 text-[#e8c060] rounded">必填</span>
                                      </div>
                                      <p className="text-[12px] text-[#666] mt-0.5">用于大纲生成、正文生成、续写、润色等核心写作任务</p>
                                  </div>
                              </div>
                              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium ${isMainApiConfigured ? "bg-[#22c55e]/10 text-[#22c55e]" : "bg-[#ef4444]/10 text-[#ef4444]"}`}>
                                  <div className={`w-1.5 h-1.5 rounded-full ${isMainApiConfigured ? "bg-[#22c55e]" : "bg-[#ef4444]"}`} />
                                  {isMainApiConfigured ? "已配置" : "请配置"}
                              </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                              <div className="flex flex-col gap-2">
                                  <label className="text-[11px] text-[#666] font-medium">Model 模型</label>
                                  <input 
                                      value={modelName}
                                      onChange={(e) => setModelName(e.target.value)}
                                      placeholder="gemini-2.0-flash"
                                      className="w-full px-4 py-2.5 bg-[#080808] border border-[#2a2a2a] rounded-lg text-[13px] text-[#ededed] outline-none focus:border-[#e8c060]/50 focus:ring-1 focus:ring-[#e8c060]/20 transition font-mono"
                                  />
                              </div>
                              <div className="flex flex-col gap-2">
                                  <label className="text-[11px] text-[#666] font-medium">API Provider</label>
                                  <input 
                                      value={apiProvider}
                                      onChange={(e) => setApiProvider(e.target.value)}
                                      placeholder="openai / google"
                                      className="w-full px-4 py-2.5 bg-[#080808] border border-[#2a2a2a] rounded-lg text-[13px] text-[#ededed] outline-none focus:border-[#e8c060]/50 focus:ring-1 focus:ring-[#e8c060]/20 transition font-mono"
                                  />
                              </div>
                              <div className="col-span-2 flex flex-col gap-2">
                                  <label className="text-[11px] text-[#666] font-medium">API Key</label>
                                  <div className="relative">
                                      <input 
                                          type={showKey ? "text" : "password"}
                                          value={apiKey}
                                          onChange={(e) => setApiKey(e.target.value)}
                                          placeholder="sk-..."
                                          className="w-full px-4 py-2.5 pr-12 bg-[#080808] border border-[#2a2a2a] rounded-lg text-[13px] text-[#ededed] outline-none focus:border-[#e8c060]/50 focus:ring-1 focus:ring-[#e8c060]/20 transition font-mono"
                                      />
                                      <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888]">
                                          {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                      </button>
                                  </div>
                              </div>
                              <div className="col-span-2 flex flex-col gap-2">
                                  <label className="text-[11px] text-[#666] font-medium">Base URL（可选）</label>
                                  <input 
                                      value={baseUrl}
                                      onChange={(e) => setBaseUrl(e.target.value)}
                                      placeholder="留空使用默认地址"
                                      className="w-full px-4 py-2.5 bg-[#080808] border border-[#2a2a2a] rounded-lg text-[13px] text-[#ededed] outline-none focus:border-[#e8c060]/50 focus:ring-1 focus:ring-[#e8c060]/20 transition font-mono"
                                  />
                              </div>
                          </div>
                          
                          <div className="flex justify-end pt-2 border-t border-[#1f1f1f]">
                              <button 
                                  onClick={handleTestMainApi}
                                  disabled={testingMainApi || !apiKey}
                                  className="flex items-center gap-2 px-4 py-2 bg-[#141414] border border-[#2a2a2a] text-[#888] text-[12px] font-medium rounded-lg hover:border-[#22c55e]/50 hover:text-[#22c55e] transition disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                  {testingMainApi ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
                                  {testingMainApi ? "测试中..." : "测试连接"}
                              </button>
                          </div>
                      </div>

                      {/* Card 2: 审计模型 */}
                      <div className="flex flex-col gap-5 p-6 rounded-2xl bg-[#0d0d0d] border border-[#1f1f1f] hover:border-[#8b5cf6]/20 transition">
                          <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-gradient-to-br from-[#8b5cf6]/20 to-[#8b5cf6]/5 rounded-xl flex items-center justify-center">
                                      <ShieldCheck size={20} className="text-[#8b5cf6]" />
                                  </div>
                                  <div>
                                      <div className="flex items-center gap-2">
                                          <span className="text-[15px] font-bold text-[#ededed]">审计模型</span>
                                          <span className="text-[10px] px-2 py-0.5 bg-[#8b5cf6]/10 text-[#8b5cf6] rounded">可选</span>
                                      </div>
                                      <p className="text-[12px] text-[#666] mt-0.5">用于审计、审稿、角色分析、世界观检查等辅助分析任务，可节省成本</p>
                                  </div>
                              </div>
                              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium ${isAnalystConfigured ? "bg-[#22c55e]/10 text-[#22c55e]" : "bg-[#444]/10 text-[#666]"}`}>
                                  <div className={`w-1.5 h-1.5 rounded-full ${isAnalystConfigured ? "bg-[#22c55e]" : "bg-[#666]"}`} />
                                  {isAnalystConfigured ? "已配置" : "使用主API"}
                              </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                              <div className="flex flex-col gap-2">
                                  <label className="text-[11px] text-[#666] font-medium">Model 模型</label>
                                  <input
                                      value={analystModel}
                                      onChange={(e) => setAnalystModel(e.target.value)}
                                      placeholder="gemini-2.0-flash (省钱)"
                                      className="w-full px-4 py-2.5 bg-[#080808] border border-[#2a2a2a] rounded-lg text-[13px] text-[#ededed] outline-none focus:border-[#8b5cf6]/50 focus:ring-1 focus:ring-[#8b5cf6]/20 transition font-mono"
                                  />
                              </div>
                              <div className="flex flex-col gap-2">
                                  <label className="text-[11px] text-[#666] font-medium">Base URL（可选）</label>
                                  <input
                                      value={analystBaseUrl}
                                      onChange={(e) => setAnalystBaseUrl(e.target.value)}
                                      placeholder="留空使用默认"
                                      className="w-full px-4 py-2.5 bg-[#080808] border border-[#2a2a2a] rounded-lg text-[13px] text-[#ededed] outline-none focus:border-[#8b5cf6]/50 focus:ring-1 focus:ring-[#8b5cf6]/20 transition font-mono"
                                  />
                              </div>
                              <div className="col-span-2 flex flex-col gap-2">
                                  <label className="text-[11px] text-[#666] font-medium">API Key</label>
                                  <div className="relative">
                                      <input
                                          type={showAnalystKey ? "text" : "password"}
                                          value={analystApiKey}
                                          onChange={(e) => setAnalystApiKey(e.target.value)}
                                          placeholder="留空则使用主要写作模型的 API"
                                          className="w-full px-4 py-2.5 pr-12 bg-[#080808] border border-[#2a2a2a] rounded-lg text-[13px] text-[#ededed] outline-none focus:border-[#8b5cf6]/50 focus:ring-1 focus:ring-[#8b5cf6]/20 transition font-mono"
                                      />
                                      <button onClick={() => setShowAnalystKey(!showAnalystKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888]">
                                          {showAnalystKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                      </button>
                                  </div>
                              </div>
                          </div>
                          
                          <div className="flex justify-end pt-2 border-t border-[#1f1f1f]">
                              <button 
                                  onClick={handleTestAnalystApi}
                                  disabled={testingAnalystApi}
                                  className="flex items-center gap-2 px-4 py-2 bg-[#141414] border border-[#2a2a2a] text-[#888] text-[12px] font-medium rounded-lg hover:border-[#8b5cf6]/50 hover:text-[#8b5cf6] transition disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                  {testingAnalystApi ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
                                  {testingAnalystApi ? "测试中..." : "测试连接"}
                              </button>
                          </div>
                      </div>

                      {/* Card 3: 存储路径 */}
                      <div className="flex flex-col gap-5 p-6 rounded-2xl bg-[#0d0d0d] border border-[#1f1f1f] hover:border-[#3b82f6]/20 transition">
                          <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-gradient-to-br from-[#3b82f6]/20 to-[#3b82f6]/5 rounded-xl flex items-center justify-center">
                                      <HardDrive size={20} className="text-[#3b82f6]" />
                                  </div>
                                  <div>
                                      <div className="flex items-center gap-2">
                                          <span className="text-[15px] font-bold text-[#ededed]">文件存储路径</span>
                                      </div>
                                      <p className="text-[12px] text-[#666] mt-0.5">项目文件保存目录</p>
                                  </div>
                              </div>
                          </div>
                          
                          <div className="flex flex-col gap-3">
                              <input 
                                  value={storagePath}
                                  onChange={(e) => setStoragePath(e.target.value)}
                                  className="w-full px-4 py-3 bg-[#080808] border border-[#2a2a2a] rounded-lg text-[13px] text-[#ededed] outline-none focus:border-[#3b82f6]/50 focus:ring-1 focus:ring-[#3b82f6]/20 transition font-mono"
                              />
                              <div className="flex items-center justify-between">
                                  <p className="text-[11px] text-[#555]">默认: <span className="text-[#666] font-mono">{defaultStoragePath}</span></p>
                                  <button 
                                      onClick={restoreDefaultPath}
                                      className="text-[11px] text-[#666] hover:text-[#888] transition"
                                  >
                                      恢复默认
                                  </button>
                              </div>
                          </div>
                      </div>

                  </div>
              </div>
          )}
      </div>
    </div>
  );
}

function UpdatePanel() {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{version: string; downloadUrl: string; releaseNotes: string} | null>(null);
  const [noUpdate, setNoUpdate] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setNoUpdate(false);
    setUpdateInfo(null);
    
    try {
      const res = await fetch("/api/update");
      const data = await res.json();
      
      if (data.version && data.version !== "1.0.0") {
        setUpdateInfo(data);
      } else {
        setNoUpdate(true);
      }
    } catch {
      setNoUpdate(true);
    }
    setChecking(false);
  };

  const handleDownload = () => {
    if (updateInfo?.downloadUrl) {
      window.open(updateInfo.downloadUrl, '_blank');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-[700px] mx-auto p-8">
        <div className="bg-[#0d0d0d] border border-[#1f1f1f] rounded-2xl p-8">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-[#e8c060]/20 to-[#e8c060]/5 rounded-xl flex items-center justify-center">
              <RefreshCw size={24} className="text-[#e8c060]" />
            </div>
            <div>
              <h2 className="text-[18px] font-bold text-[#ededed]">在线更新</h2>
              <p className="text-[12px] text-[#666] mt-1">检查并更新到最新版本</p>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-[#111] border border-[#1f1f1f] rounded-xl mb-6">
            <div>
              <div className="text-[12px] text-[#666]">当前版本</div>
              <div className="text-[16px] font-medium text-[#e0e0e0] mt-1">v1.0.0</div>
            </div>
            <button
              onClick={handleCheckUpdate}
              disabled={checking}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#e8c060] to-[#d4a94d] text-black text-[13px] font-bold rounded-lg hover:brightness-110 transition disabled:opacity-50"
            >
              {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {checking ? "检查中..." : "检查更新"}
            </button>
          </div>

          {updateInfo && (
            <div className="p-5 bg-[#e8c060]/10 border border-[#e8c060]/20 rounded-xl mb-6">
              <div className="flex items-center gap-2 text-[#e8c060] mb-3">
                <AlertCircle size={18} />
                <span className="font-bold">发现新版本 v{updateInfo.version}</span>
              </div>
              <div className="text-[13px] text-[#888] mb-4">{updateInfo.releaseNotes}</div>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center justify-center gap-2 w-full py-3 bg-gradient-to-r from-[#e8c060] to-[#d4a94d] text-black font-bold rounded-lg hover:brightness-110 transition"
              >
                <Download size={18} />
                下载最新版本
              </button>
              <p className="text-[11px] text-[#666] text-center mt-3">
                下载后解压覆盖到当前目录，然后重启软件
              </p>
            </div>
          )}

          {noUpdate && (
            <div className="p-5 bg-[#111] border border-[#1f1f1f] rounded-xl text-center text-[#666]">
              已是最新版本
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-[12px] text-[#444]">
          如遇更新问题，请联系作者获取帮助
        </div>
      </div>
    </div>
  );
}
