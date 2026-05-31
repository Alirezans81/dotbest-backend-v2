import { NextRequest, NextResponse } from "next/server";
import { verifyPayment } from "@/domain/payment";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as { paymentIntentId?: string };
    const { paymentIntentId } = body;

    if (!paymentIntentId) {
      return NextResponse.json({ error: "paymentIntentId required" }, { status: 400 });
    }

    const result = await verifyPayment(paymentIntentId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[payments/verify]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
