import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * O caminho de saída de quem bateu no teto do plano.
 *
 * Aparece **colado à mensagem** que explica o teto, nunca sozinho: um convite
 * para assinar solto no meio da interface é anúncio, e o produto não tem
 * anúncio. Aqui ele é a resposta a uma pergunta que a pessoa acabou de fazer
 * sem querer ("por que isso não foi?").
 *
 * Leva para a seção de Planos da landing, que é onde a comparação linha a
 * linha mora. Enquanto o checkout não existe, é lá também que o botão explica
 * que o pagamento ainda não abriu — melhor descobrir isso na página de planos
 * do que num botão que não faz nada aqui dentro.
 */
export function UpgradeLink({
  label = "Ver o Pro",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href="/#planos"
      className={cn(
        "inline-flex items-center gap-0.5 font-medium text-foreground underline decoration-border underline-offset-2",
        "transition-colors duration-150 hover:decoration-foreground",
        className
      )}
    >
      {label}
      <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
    </Link>
  );
}
