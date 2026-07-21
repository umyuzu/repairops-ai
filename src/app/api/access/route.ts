import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { accessCode } = (await request.json()) as { accessCode?: string };
  const requiredCode = process.env.DEMO_ACCESS_CODE?.trim();

  if (!requiredCode || accessCode?.trim() === requiredCode) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, message: "Invalid demo access code." }, { status: 401 });
}
