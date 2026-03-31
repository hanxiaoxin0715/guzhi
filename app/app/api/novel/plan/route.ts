import { NextRequest, NextResponse } from "next/server";
import { generateGlobalPlan, OutlineRequest } from "../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body: OutlineRequest = await req.json();
    
    if (!body.title || !body.description) {
      return NextResponse.json({ error: "Missing title or description" }, { status: 400 });
    }

    const plan = await generateGlobalPlan(body);
    
    return NextResponse.json(plan);
  } catch (error: any) {
    console.error("Plan API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate global plan" }, { status: 500 });
  }
}
