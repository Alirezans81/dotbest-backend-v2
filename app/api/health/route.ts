import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    service: "dotbest-backend",
    timezone: process.env.DEFAULT_TIMEZONE ?? "Asia/Tehran",
  });
}
