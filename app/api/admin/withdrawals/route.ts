import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { approveWithdrawal, rejectWithdrawal } from "@/domain/wallet";
import { notifyHairdresser, notifyCustomer } from "@/bot/notify";

function checkAuth(req: NextRequest): boolean {
  const secret = req.headers.get("x-admin-secret") ?? new URL(req.url).searchParams.get("secret");
  return secret === process.env.ADMIN_SECRET;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = new URL(req.url).searchParams.get("status") ?? "PENDING";
  const requests = await prisma.withdrawalRequest.findMany({
    where: { status: status as "PENDING" | "APPROVED" | "REJECTED" },
    include: {
      wallet: {
        include: { hairdresser: true, customer: true },
      },
    },
    orderBy: { requestedAt: "desc" },
  });

  return NextResponse.json(requests);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { requestId: string; action: "approve" | "reject"; adminNote?: string };
  const { requestId, action, adminNote } = body;

  if (!requestId || !action) {
    return NextResponse.json({ error: "requestId and action required" }, { status: 400 });
  }

  try {
    if (action === "approve") {
      await approveWithdrawal(requestId, adminNote);
    } else {
      await rejectWithdrawal(requestId, adminNote);
    }

    // Notify user
    const req2 = await prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: { wallet: { include: { hairdresser: true, customer: true } } },
    });
    if (req2) {
      const msg = action === "approve"
        ? `✅ درخواست برداشت ${req2.amountToman.toLocaleString()} تومان تایید شد. مبلغ به شبا ${req2.iban} واریز خواهد شد.`
        : `❌ درخواست برداشت ${req2.amountToman.toLocaleString()} تومان رد شد.${adminNote ? ` دلیل: ${adminNote}` : ""}`;

      if (req2.wallet.hairdresser) {
        await notifyHairdresser(req2.wallet.hairdresser, msg);
      } else if (req2.wallet.customer) {
        await notifyCustomer(req2.wallet.customer, msg);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
