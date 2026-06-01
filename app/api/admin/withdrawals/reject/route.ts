import { NextRequest, NextResponse } from "next/server";
import { rejectWithdrawal } from "@/domain/wallet";
import { prisma } from "@/lib/prisma";
import { notifyHairdresser, notifyCustomer } from "@/bot/notify";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const secret = searchParams.get("secret");
  const note = searchParams.get("note") ?? undefined;

  if (!id || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await rejectWithdrawal(id, note);

    const w = await prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { wallet: { include: { hairdresser: true, customer: true } } },
    });
    if (w) {
      const msg = `❌ درخواست برداشت ${w.amountToman.toLocaleString()} تومان رد شد.${note ? ` دلیل: ${note}` : ""}`;
      if (w.wallet.hairdresser) await notifyHairdresser(w.wallet.hairdresser, msg);
      else if (w.wallet.customer) await notifyCustomer(w.wallet.customer, msg);
    }

    return NextResponse.redirect(new URL(`/admin?secret=${secret}&tab=REJECTED`, req.url));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
