"use client";

import { useState } from "react";
import { Check, Download, RefreshCw, AlertCircle } from "lucide-react";
import { checkForUpdate, getCurrentVersion, UpdateInfo } from "../../../../lib/updater";

export default function UpdatePage() {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [noUpdate, setNoUpdate] = useState(false);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setNoUpdate(false);
    setUpdateInfo(null);
    
    const update = await checkForUpdate();
    
    if (update) {
      setUpdateInfo(update);
    } else {
      setNoUpdate(true);
    }
    setChecking(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="flex items-center justify-between px-8 py-6 shrink-0 border-b border-[var(--border-default)]">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-serif font-bold flex items-center gap-2 tracking-wide">
            检查更新
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[600px] mx-auto p-8">
          <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="text-[14px] text-[var(--text-secondary)] mb-1">当前版本</div>
                <div className="text-[20px] font-medium">v{getCurrentVersion()}</div>
              </div>
              <button
                onClick={handleCheckUpdate}
                disabled={checking}
                className="btn-primary flex items-center gap-2"
              >
                {checking ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
                检查更新
              </button>
            </div>

            {updateInfo && (
              <div className="mt-6 p-4 bg-[var(--gold-transparent)] border border-[var(--gold-primary)]/20 rounded-lg">
                <div className="flex items-center gap-2 text-[var(--gold-primary)] mb-2">
                  <AlertCircle size={16} />
                  <span className="font-medium">发现新版本 v{updateInfo.version}</span>
                </div>
                <div className="text-[13px] text-[var(--text-secondary)] mb-3">{updateInfo.releaseNotes}</div>
                <a
                  href={updateInfo.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary flex items-center justify-center gap-2 w-full"
                >
                  <Download size={16} />
                  下载最新版本
                </a>
              </div>
            )}

            {noUpdate && (
              <div className="mt-6 p-4 bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg text-center text-[var(--text-secondary)]">
                已是最新版本
              </div>
            )}
          </div>

          <div className="mt-6 text-[12px] text-[var(--text-muted)] text-center">
            如需手动更新，请联系作者获取最新版本
          </div>
        </div>
      </div>
    </div>
  );
}
