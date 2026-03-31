
// ComfyUI API Types

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, any>;
  _meta?: {
    title?: string;
  };
}

export interface ComfyWorkflow {
  [nodeId: string]: ComfyNode;
}

export interface ComfyQueuePromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, any>;
}

export interface ComfyHistoryResponse {
  [promptId: string]: {
    prompt: [number, string, any, any, string[]];
    outputs: Record<string, {
      images: Array<{
        filename: string;
        subfolder: string;
        type: "output" | "preview";
      }>;
    }>;
    status: {
      status_str: "success" | "error";
      completed: boolean;
      messages: any[];
    };
  };
}

// 简化的文生图 Workflow 模板
// 注意：这只是一个基础模板，实际使用时可能需要根据 ComfyUI 服务器上安装的节点进行调整
export const DEFAULT_TXT2IMG_WORKFLOW: ComfyWorkflow = {
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 0,
      "steps": 20,
      "cfg": 8,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1,
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": {
      "ckpt_name": "v1-5-pruned-emaonly.ckpt" // 用户需在设置中指定模型名称
    }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": {
      "width": 512,
      "height": 512,
      "batch_size": 1
    }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "", // 动态填充
      "clip": ["4", 1]
    }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "text, watermark",
      "clip": ["4", 1]
    }
  },
  "8": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["8", 0]
    }
  }
};
