import { getLoop, requireWriteAuth, upsertLoop } from "@/lib/routes";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  return getLoop(id);
}

export async function PUT(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const unauthorized = requireWriteAuth(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await context.params;
  return upsertLoop(id, await request.json());
}
