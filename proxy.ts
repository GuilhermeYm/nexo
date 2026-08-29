import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rotas que só fazem sentido para usuário deslogado.
const AUTH_PAGES = new Set(["/login", "/registro"]);

/** Para onde vai quem já está logado e tenta abrir uma página de auth. */
const APP_HOME = "/dashboard";

/**
 * Monta o CSP por request. O nonce muda a cada resposta e é o que libera o
 * script de tema inline e os scripts que o Next injeta — sem 'unsafe-inline'.
 * Padrão da v16: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // 'strict-dynamic' faz scripts confiáveis (com nonce) carregarem suas
    // dependências (chunks dinâmicos). 'unsafe-eval' só em dev (Turbopack).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.supabase.co",
    "media-src 'self' blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Next.js 16: "middleware" virou "proxy" (ver docs em
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 * Aqui geramos o nonce do CSP por request, refrescamos a sessão do Supabase
 * (rotaciona o JWT nos cookies) e desviamos usuário logado das páginas de
 * auth. Autorização de verdade acontece nas rotas/páginas via
 * supabase.auth.getUser() + RLS.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // O Next extrai o nonce do CSP presente no REQUEST e o aplica aos scripts
  // que ele mesmo injeta (framework, RSC). 'x-nonce' fica disponível para
  // Server Components via headers() — é assim que app/layout.tsx lê o nonce.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && AUTH_PAGES.has(request.nextUrl.pathname)) {
    const redirect = NextResponse.redirect(new URL(APP_HOME, request.url));
    // Preserva os cookies de sessão recém-refrescados no redirect.
    response.cookies.getAll().forEach(({ name, value }) => {
      redirect.cookies.set(name, value);
    });
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  // O callback setAll pode ter recriado a response; o CSP vai por último.
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Tudo exceto assets estáticos e otimizações internas do Next.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm)$).*)",
  ],
};
