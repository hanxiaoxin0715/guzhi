import { NextRequest, NextResponse } from "next/server";
import { 
  generateInteractiveSegment, 
  rewriteSegment, 
  migrateStyle,
  batchGenerateSegments,
  InteractiveSegmentRequest,
  RewriteSegmentRequest,
  StyleMigrateRequest,
  BatchGenerateRequest
} from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: "Missing action parameter" }, { status: 400 });
    }

    let result: any;

    switch (action) {
      case "generateSegment": {
        const reqData: InteractiveSegmentRequest = {
          previousContent: body.previousContent || "",
          nextPlotPoint: body.nextPlotPoint || "",
          context: body.context || "",
          segmentLength: body.segmentLength || "medium",
          instruction: body.instruction,
        };
        if (!reqData.nextPlotPoint) {
          return NextResponse.json({ error: "Missing nextPlotPoint" }, { status: 400 });
        }
        result = await generateInteractiveSegment(reqData);
        break;
      }

      case "rewriteSegment": {
        const reqData: RewriteSegmentRequest = {
          content: body.content || "",
          rewriteStyle: body.rewriteStyle || "",
          instruction: body.instruction,
          context: body.context,
        };
        if (!reqData.content || !reqData.rewriteStyle) {
          return NextResponse.json({ error: "Missing content or rewriteStyle" }, { status: 400 });
        }
        result = await rewriteSegment(reqData);
        break;
      }

      case "migrateStyle": {
        const reqData: StyleMigrateRequest = {
          content: body.content || "",
          targetStyle: body.targetStyle || "xuannian",
          preservePlot: body.preservePlot !== false,
        };
        if (!reqData.content || !reqData.targetStyle) {
          return NextResponse.json({ error: "Missing content or targetStyle" }, { status: 400 });
        }
        result = await migrateStyle(reqData);
        break;
      }

      case "batchGenerate": {
        const reqData: BatchGenerateRequest = {
          points: body.points || [],
          context: body.context || "",
          eachLength: body.eachLength,
        };
        if (!reqData.points || reqData.points.length === 0) {
          return NextResponse.json({ error: "Missing points" }, { status: 400 });
        }
        result = await batchGenerateSegments(reqData);
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (error: any) {
    console.error("Interactive Writing API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process request" }, { status: 500 });
  }
}
