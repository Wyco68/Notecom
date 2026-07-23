import { NextResponse } from "next/server";
import { listTags } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../route-helpers";

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ tags: await listTags() });
  } catch (err: any) {
    return errorResponse(err);
  }
}
