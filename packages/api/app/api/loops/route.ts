import { listLoops } from "@/lib/routes";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return listLoops();
}
