"use client";

export interface UpdateInfo {
  version: string;
  downloadUrl: string;
  releaseNotes: string;
}

const CURRENT_VERSION = "1.0.0";

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch("/api/update");
    const data = await res.json();
    
    if (data.version && data.version !== CURRENT_VERSION) {
      return data as UpdateInfo;
    }
    return null;
  } catch {
    return null;
  }
}

export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
