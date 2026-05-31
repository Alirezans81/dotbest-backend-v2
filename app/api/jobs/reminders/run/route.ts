import { NextRequest, NextResponse } from "next/server";
import { runReminderJob } from "@/jobs/reminders";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = req.headers.get("x-job-secret");
  if (!secret || secret !== process.env.CRON_REMINDER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReminderJob();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[jobs/reminders]", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
