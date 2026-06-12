import { getIteration, json } from "@/lib/routes";

type RouteContext = { params: Promise<{ id: string; n: string }> };

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  const { id, n } = await context.params;
  const iterationIndex = Number.parseInt(n, 10);
  if (!Number.isInteger(iterationIndex) || iterationIndex < 0) {
    return json({ error: "invalid_iteration_index" }, { status: 400 });
  }
  return getIteration(id, iterationIndex);
}
