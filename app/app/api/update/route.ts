import { NextResponse } from "next/server";

const UPDATE_CONFIG = {
  version: "1.0.0",
  downloadUrl: "https://guzhiaixs-1416888225.cos.ap-chengdu.myqcloud.com/",
  releaseNotes: "首发版本",
};

export async function GET() {
  return NextResponse.json(UPDATE_CONFIG);
}
