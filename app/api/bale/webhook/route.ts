import { NextRequest, NextResponse } from "next/server";
import { dispatch } from "@/bot/dispatcher";
import type { TelegramUpdate } from "@/bot/telegram/types";

const processedUpdates = new Map<number, number>();
const TTL_MS = 10 * 60 * 1000;

function isDuplicate(updateId: number): boolean {
  const now = Date.now();
  for (const [id, ts] of processedUpdates.entries()) {
    if (now - ts > TTL_MS) processedUpdates.delete(id);
  }
  if (processedUpdates.has(updateId)) return true;
  processedUpdates.set(updateId, now);
  return false;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = req.headers.get("x-bale-bot-api-secret-token");
  if (secret !== process.env.BALE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json() as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (isDuplicate(update.update_id)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  dispatch(update, { platform: "BALE" }).catch((err) => {
    console.error("[webhook/bale] dispatch error:", err);
  });

  return NextResponse.json({ ok: true });
}
