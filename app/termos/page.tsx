import type { Metadata } from "next";

import { LegalDocument } from "@/components/layout/legal-document";
import { NEXO_GITHUB_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Termos de uso — Nexo",
  description:
    "Nexo é software auto-hospedado e sem assinatura: o que estes termos cobrem, o que cabe a quem sobe uma instância, e as garantias que não existem.",
};

export default function TermosPage() {
  return (
    <LegalDocument
      title="Termos de uso"
      summary="Nexo não é um serviço vendido por alguém — é software que você sobe e opera. Isto descreve o que vem junto com o código, o que fica por sua conta, e o que não é prometido."
      updatedAt="17 de setembro de 2026"
    >
      <section>
        <h2>1. O que é o Nexo</h2>
        <p>
          O Nexo é um organizador pessoal: você envia textos, arquivos, áudios,
          imagens e links, e a aplicação classifica, resume e marca esse
          material para que você o reencontre depois. Ele é distribuído como{" "}
          <a href={NEXO_GITHUB_URL} target="_blank" rel="noopener noreferrer">
            código aberto
          </a>{" "}
          para ser executado na sua própria infraestrutura, e está{" "}
          <strong>em desenvolvimento ativo</strong> — funcionalidades entram,
          mudam e saem enquanto o produto amadurece.
        </p>
        <p>
          <strong>Não há assinatura, plano, cobrança nem teto de uso.</strong>{" "}
          Ninguém fatura nada por esta aplicação. O que existe de custo é o da
          sua própria infraestrutura: o projeto Supabase que você criou e, se
          você configurar uma, a chave do provedor de IA — ambos contratados
          por você, diretamente com eles.
        </p>
      </section>

      <section>
        <h2>2. Quem responde por uma instância</h2>
        <p>
          Quem sobe a aplicação responde por ela. Se você a executa só para si,
          isto começa e termina em você. Se você a disponibiliza para outras
          pessoas — a casa, a organização, um produto seu —, é você quem
          responde perante elas: pelas regras de uso que você definir, pelos
          dados que passarem por lá e pela disponibilidade do que você hospeda.
          Quem escreve este código não opera nenhuma instância e não tem acesso
          a nenhuma.
        </p>
        <p>
          A página de <a href="/privacidade">Privacidade</a> descreve o lado de
          dados dessa mesma divisão.
        </p>
      </section>

      <section>
        <h2>3. A licença do código</h2>
        <p>
          O que você pode fazer com o código — usar, modificar, redistribuir,
          e sob quais condições — é o que a licença do repositório diz, e ela
          prevalece sobre qualquer coisa escrita nesta página. Ela está no
          arquivo <strong>LICENSE</strong>, junto ao código.
        </p>
      </section>

      <section>
        <h2>4. O conteúdo é de quem o escreveu</h2>
        <p>
          O material guardado numa instância pertence a quem o colocou lá. O
          software não reivindica nada sobre ele, e nada do que passa por uma
          instância chega a quem mantém este projeto — não há para onde chegar.
        </p>
      </section>

      <section>
        <h2>5. Classificação automática</h2>
        <p>
          Quando configurada, a classificação automática usa modelos de
          linguagem para decidir o tipo de cada captura, escrever o resumo e
          criar as tags. <strong>Ela erra.</strong> O resultado é uma sugestão
          automática, sempre identificada como tal e sempre editável. Não use o
          Nexo como única fonte para decisões jurídicas, médicas ou
          financeiras.
        </p>
        <p>
          A chave do provedor é sua, a conta é sua e os termos dele valem sobre
          o que for enviado. Sem chave configurada, nada é enviado para fora da
          instância.
        </p>
      </section>

      <section>
        <h2>6. Sem garantia</h2>
        <p>
          O software é oferecido <strong>&ldquo;como está&rdquo;</strong>, sem
          garantia de qualquer espécie. Não há promessa de ausência de falhas,
          de disponibilidade, de adequação a uma finalidade específica nem
          acordo de nível de serviço, e não há suporte contratado. Quem executa
          assume o risco de executar — inclusive o de perder dados por uma
          falha, uma migration mal aplicada ou uma configuração errada.
        </p>
        <p>
          Faça backup do seu banco. Funcionalidades anunciadas como{" "}
          <strong>&ldquo;em breve&rdquo;</strong> são intenção declarada, não
          compromisso de data.
        </p>
      </section>

      <section>
        <h2>7. Limite de responsabilidade</h2>
        <p>
          Na máxima extensão permitida pela lei aplicável, quem escreve e
          distribui este código não responde por danos decorrentes do uso ou da
          impossibilidade de uso do software, incluindo perda de dados ou de
          lucros. Nada aqui afasta direitos que a lei garanta de forma
          inafastável a quem, no seu caso concreto, seja consumidor de alguém —
          e esse alguém, se existir, é quem opera a instância, não este
          projeto.
        </p>
      </section>

      <section>
        <h2>8. Mudanças neste documento</h2>
        <p>
          Este texto acompanha o código. Se algo relevante mudar, a data no
          topo muda junto — e quem opera uma instância para terceiros deve
          avisá-los antes de a mudança valer para eles.
        </p>
      </section>
    </LegalDocument>
  );
}
