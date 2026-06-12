import { readIndex } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function Page() {
  const loops = await readIndex();

  return (
    <main>
      <h1>cursor-looper loops</h1>
      <ul>
        {loops.map((loop) => (
          <li key={loop.id}>
            <a href={`/api/loops/${loop.id}`}>{loop.id}</a> {loop.goal}
          </li>
        ))}
      </ul>
    </main>
  );
}
