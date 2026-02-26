export async function loader() {
  return new Response("pong", { headers: { "Content-Type": "text/plain" } });
}
