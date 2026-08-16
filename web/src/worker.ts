// src/worker.ts
// Cloudflare Worker entrypoint.
// Routes /api/* to the Hono REST API.
// All other routes are handled by TanStack Start's built-in server entry.

import app from './api/index'

export default {
  async fetch(request: Request, env: Record<string, string>, ctx: ExecutionContext) {
    const url = new URL(request.url)

    // Route all /api/* requests to the Hono app
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx)
    }

    // For non-API requests, let Cloudflare serve the static TanStack Start assets
    // (wrangler handles this automatically when pages_build_output_dir is set)
    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler
