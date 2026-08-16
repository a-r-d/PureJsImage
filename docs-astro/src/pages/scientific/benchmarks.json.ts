import benchmark from '../../data/scientific-reader-benchmark.json' with { type: 'json' }

export const prerender = true

export const GET = (): Response =>
  new Response(JSON.stringify(benchmark), {
    headers: {
      'cache-control': 'public, max-age=3600',
      'content-type': 'application/json; charset=utf-8',
    },
  })
