import { getDiff } from "@/lib/routes";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  return getDiff(id, new URL(request.url).searchParams);
}
