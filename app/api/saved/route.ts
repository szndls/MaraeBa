import { addSavedName } from "../../lib/savedStore.server.js";

// POST: "저장하기"를 누른 수업을 기록 목록에 추가한다
export async function POST(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  if (!name || !/^[\w-]+$/.test(name)) return Response.json({ error: "잘못된 이름이에요." }, { status: 400 });
  await addSavedName(name);
  return Response.json({ ok: true });
}
