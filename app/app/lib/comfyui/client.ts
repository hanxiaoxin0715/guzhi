
import { ComfyWorkflow, DEFAULT_TXT2IMG_WORKFLOW } from "./types";

interface ComfyUIClientConfig {
  baseUrl: string; // e.g., "http://127.0.0.1:8188"
  clientId: string;
}

export class ComfyUIClient {
  private baseUrl: string;
  private clientId: string;

  constructor(config: ComfyUIClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.clientId = config.clientId;
  }

  // 1. 发送 Prompt 到 ComfyUI
  async queuePrompt(workflow: ComfyWorkflow): Promise<string> {
    const p = {
      prompt: workflow,
      client_id: this.clientId,
    };
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to queue prompt: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    if (data.error) throw new Error(`ComfyUI Error: ${JSON.stringify(data.error)}`);
    return data.prompt_id;
  }

  // 2. 轮询历史记录获取结果（简单版，实际生产环境建议用 WebSocket）
  async waitForHistory(promptId: string, timeoutMs = 60000): Promise<string[]> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`${this.baseUrl}/history/${promptId}`);
        if (response.ok) {
          const history = await response.json();
          const taskData = history[promptId];
          if (taskData && taskData.outputs) {
            const images: string[] = [];
            // 遍历所有输出节点，查找图片
            for (const nodeId in taskData.outputs) {
              const nodeOutput = taskData.outputs[nodeId];
              if (nodeOutput.images) {
                for (const img of nodeOutput.images) {
                  // 构建获取图片的 URL
                  const imgUrl = `${this.baseUrl}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`;
                  images.push(imgUrl);
                }
              }
            }
            if (images.length > 0) return images;
          }
        }
      } catch (e) {
        console.warn("Error polling history:", e);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 等待 1 秒重试
    }
    throw new Error("Timeout waiting for ComfyUI generation");
  }

  // 3. 构建生图工作流 (Txt2Img)
  buildTxt2ImgWorkflow(prompt: string, negativePrompt: string = "", width: number = 1024, height: number = 1024, modelName: string = "v1-5-pruned-emaonly.ckpt"): ComfyWorkflow {
    // 深拷贝默认模板
    const workflow = JSON.parse(JSON.stringify(DEFAULT_TXT2IMG_WORKFLOW));

    // 填充参数
    // 注意：这里的节点 ID (3, 4, 5...) 必须与 DEFAULT_TXT2IMG_WORKFLOW 中的一致
    
    // CheckpointLoaderSimple (Node 4)
    if (workflow["4"]) {
      workflow["4"].inputs.ckpt_name = modelName;
    }

    // EmptyLatentImage (Node 5)
    if (workflow["5"]) {
      workflow["5"].inputs.width = width;
      workflow["5"].inputs.height = height;
    }

    // CLIPTextEncode (Positive) (Node 6)
    if (workflow["6"]) {
      workflow["6"].inputs.text = prompt;
    }

    // CLIPTextEncode (Negative) (Node 7)
    if (workflow["7"]) {
      workflow["7"].inputs.text = negativePrompt;
    }

    // KSampler (Node 3)
    if (workflow["3"]) {
        workflow["3"].inputs.seed = Math.floor(Math.random() * 1000000000000);
    }

    return workflow;
  }
}
