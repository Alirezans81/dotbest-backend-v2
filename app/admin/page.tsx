import { prisma } from "@/lib/prisma";
import { WalletOwnerType } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function getWithdrawals(status: string) {
  return prisma.withdrawalRequest.findMany({
    where: { status: status as "PENDING" | "APPROVED" | "REJECTED" },
    include: { wallet: { include: { hairdresser: true, customer: true } } },
    orderBy: { requestedAt: "desc" },
  });
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const secret = params.secret;
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return (
      <div style={{ fontFamily: "Tahoma", direction: "rtl", padding: "40px", textAlign: "center" }}>
        <h2>دسترسی محدود</h2>
        <p>برای ورود به پنل ادمین باید پارامتر secret را وارد کنید.</p>
        <code>?secret=YOUR_ADMIN_SECRET</code>
      </div>
    );
  }

  const tab = params.tab ?? "PENDING";
  const withdrawals = await getWithdrawals(tab);

  const tabStyle = (t: string) => ({
    padding: "8px 20px",
    marginLeft: "8px",
    background: tab === t ? "#1d4ed8" : "#e5e7eb",
    color: tab === t ? "#fff" : "#111",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    textDecoration: "none",
    fontSize: "14px",
  });

  return (
    <div style={{ fontFamily: "Tahoma", direction: "rtl", padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "22px", marginBottom: "20px" }}>پنل ادمین — درخواست‌های برداشت</h1>

      <div style={{ marginBottom: "20px" }}>
        {["PENDING", "APPROVED", "REJECTED"].map((t) => (
          <a key={t} href={`?secret=${secret}&tab=${t}`} style={tabStyle(t)}>
            {t === "PENDING" ? "⏳ در انتظار" : t === "APPROVED" ? "✅ تایید شده" : "❌ رد شده"}
          </a>
        ))}
      </div>

      {withdrawals.length === 0 ? (
        <p style={{ color: "#6b7280" }}>موردی وجود ندارد.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>صاحب حساب</th>
              <th style={th}>نوع</th>
              <th style={th}>مبلغ (تومان)</th>
              <th style={th}>شبا</th>
              <th style={th}>تاریخ درخواست</th>
              {tab === "PENDING" && <th style={th}>عملیات</th>}
              {tab !== "PENDING" && <th style={th}>یادداشت ادمین</th>}
            </tr>
          </thead>
          <tbody>
            {withdrawals.map((w) => {
              const ownerName =
                w.wallet.ownerType === WalletOwnerType.HAIRDRESSER
                  ? w.wallet.hairdresser?.fullName ?? "—"
                  : w.wallet.customer?.fullName ?? "—";
              const ownerType = w.wallet.ownerType === WalletOwnerType.HAIRDRESSER ? "آرایشگر" : "مشتری";

              return (
                <tr key={w.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={td}>{ownerName} ({w.accountHolder})</td>
                  <td style={td}>{ownerType}</td>
                  <td style={td}>{w.amountToman.toLocaleString()}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: "12px" }}>{w.iban}</td>
                  <td style={td}>{new Date(w.requestedAt).toLocaleDateString("fa-IR")}</td>
                  {tab === "PENDING" && (
                    <td style={td}>
                      <ApproveRejectButtons id={w.id} secret={secret} />
                    </td>
                  )}
                  {tab !== "PENDING" && <td style={td}>{w.adminNote ?? "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ApproveRejectButtons({ id, secret }: { id: string; secret: string }) {
  return (
    <span>
      <a
        href={`/api/admin/withdrawals/approve?id=${id}&secret=${secret}`}
        style={{ ...btn, background: "#16a34a", color: "#fff", marginLeft: "4px", textDecoration: "none" }}
      >
        ✅ تایید
      </a>
      <a
        href={`/api/admin/withdrawals/reject?id=${id}&secret=${secret}`}
        style={{ ...btn, background: "#dc2626", color: "#fff", textDecoration: "none" }}
      >
        ❌ رد
      </a>
    </span>
  );
}

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "right",
  fontWeight: "bold",
  borderBottom: "2px solid #d1d5db",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "middle",
};

const btn: React.CSSProperties = {
  padding: "4px 12px",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "13px",
  display: "inline-block",
};
