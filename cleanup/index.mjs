import { runCleanup } from "../worker.mjs";

export default {
  async scheduled(controller, env, ctx) {
    await runCleanup(env, new Date(controller.scheduledTime));
  },
  async fetch() {
    return new Response("No encontrado", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    });
  },
};
