import type { Metadata } from "next";
import { Cormorant_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "./components/Toast";
import { TaskQueueProvider } from "./lib/taskQueue";
import { PipelineProvider } from "./lib/pipelineContext";
import TaskQueuePanel from "./components/TaskQueuePanel";
import AgentFAB from "./components/AgentFAB";

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--nf-serif",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--nf-ui",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--nf-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Novel Workshop - AI 小说工作坊",
  description: "AI-powered novel writing and script generation studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`h-full ${cormorantGaramond.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="h-full overflow-hidden bg-[#0a0a0a] text-[var(--text-primary)] font-ui antialiased">
        <TaskQueueProvider>
          <ToastProvider>
            <PipelineProvider>
              {children}
              <TaskQueuePanel />
              <AgentFAB />
            </PipelineProvider>
          </ToastProvider>
        </TaskQueueProvider>
      </body>
    </html>
  );
}
