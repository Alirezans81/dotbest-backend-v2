import { NextRequest, NextResponse } from "next/server";
import { initiatePayment } from "@/domain/payment";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as { bookingId?: string };
    const { bookingId } = body;

    if (!bookingId) {
      return NextResponse.json({ error: "bookingId required" }, { status: 400 });
    }

    const result = await initiatePayment(bookingId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[payments/initiate]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
