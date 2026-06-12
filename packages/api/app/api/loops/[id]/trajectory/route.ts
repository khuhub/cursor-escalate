import { getTrajectory } from "@/lib/routes";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  return getTrajectory(id);
}
