import { appendComment, listComments, requireWriteAuth } from "@/lib/routes";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  return listComments(id, new URL(request.url).searchParams.get("pending") === "1");
}

export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const unauthorized = requireWriteAuth(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await context.params;
  return appendComment(id, await request.json());
}
