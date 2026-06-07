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
  // Bale does not support secret_token header; use query param instead.
  // Register webhook as: .../api/bale/webhook?secret=<BALE_WEBHOOK_SECRET>
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.BALE_WEBHOOK_SECRET || secret !== process.env.BALE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    const rawText = await req.text();
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawText);
      const raw = params.get("update") ?? rawText;
      update = JSON.parse(raw) as TelegramUpdate;
    } else {
      update = JSON.parse(rawText) as TelegramUpdate;
    }
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
