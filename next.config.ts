import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" é para o self-host em VPS+nginx (docs/DASHBOARD.md): empacota
  // um server.js mínimo com só as dependências usadas. Na Vercel ele quebra o
  // build (ENOENT em next-server.js.nft.json) porque o tracing de arquivos dela
  // já faz o equivalente por rota — por isso fica de fora quando `VERCEL` está
  // presente (variável que a própria Vercel define no ambiente de build).
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
          },
          // O Content-Security-Policy não fica aqui: ele usa um nonce por
          // request e é montado no proxy.ts (ver docs de CSP da v16).
        ],
      },
    ];
  },
};

export default nextConfig;
