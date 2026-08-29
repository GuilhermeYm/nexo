import type { Metadata } from "next";

import { LegalDocument } from "@/components/layout/legal-document";

export const metadata: Metadata = {
  title: "Termos de uso — Nexo",
  description:
    "As regras de uso da Nexo: conta, conteúdo, classificação por IA, planos, cancelamento e responsabilidades.",
};

export default function TermosPage() {
  return (
    <LegalDocument
      title="Termos de uso"
      summary="As regras do jogo, em português e sem letra miúda. Ao criar uma conta na Nexo, você concorda com o que está escrito aqui."
      updatedAt="28 de agosto de 2026"
    >
      <section>
        <h2>1. O que é a Nexo</h2>
        <p>
          A Nexo é um organizador pessoal: você envia textos, arquivos, áudios,
          imagens e links, e a aplicação classifica, resume e marca esse
          material para que você o reencontre depois. O serviço é oferecido pela
          internet, no formato de assinatura, e está{" "}
          <strong>em desenvolvimento ativo</strong> — funcionalidades entram,
          mudam e saem enquanto o produto amadurece.
        </p>
      </section>

      <section>
        <h2>2. Sua conta</h2>
        <p>
          Para usar a Nexo você precisa criar uma conta com um e-mail válido e
          ter pelo menos 18 anos, ou usar o serviço com o consentimento de quem
          é responsável por você.
        </p>
        <ul>
          <li>
            Você é responsável pela sua senha e por tudo que acontecer na sua
            conta.
          </li>
          <li>
            Uma conta pertence a uma pessoa. Não compartilhe credenciais.
          </li>
          <li>
            Se perceber acesso indevido, avise em{" "}
            <a href="mailto:contato@nexo.app">contato@nexo.app</a>.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. O que você não pode fazer</h2>
        <ul>
          <li>
            Enviar conteúdo ilegal, ou material sobre o qual você não tem
            direito de uso.
          </li>
          <li>
            Tentar acessar dados de outra pessoa, contornar o isolamento entre
            contas ou testar a segurança do serviço sem autorização escrita.
          </li>
          <li>
            Automatizar uso a ponto de degradar o serviço para os demais, ou
            revender o acesso.
          </li>
        </ul>
        <p>
          Descumprir esta seção pode levar à suspensão ou ao encerramento da
          conta.
        </p>
      </section>

      <section>
        <h2>4. O conteúdo é seu</h2>
        <p>
          Tudo que você envia continua sendo seu. Nós não reivindicamos
          propriedade sobre as suas notas, arquivos ou anotações.
        </p>
        <p>
          Você nos concede apenas a permissão técnica necessária para operar o
          serviço: armazenar o material, processá-lo para gerar resumos, tipos e
          tags, e devolvê-lo a você quando pedir. Essa permissão existe enquanto
          o conteúdo estiver na sua conta e termina quando você o apaga.
        </p>
      </section>

      <section>
        <h2>5. Classificação automática</h2>
        <p>
          A Nexo usa modelos de linguagem para decidir o tipo de cada captura,
          escrever o resumo e criar as tags. <strong>Ela erra.</strong> O
          resultado é uma sugestão automática, sempre identificada como tal e
          sempre editável por você. Não use a Nexo como única fonte para
          decisões jurídicas, médicas ou financeiras.
        </p>
      </section>

      <section>
        <h2>6. Planos, cobrança e cancelamento</h2>
        <ul>
          <li>
            O plano Gratuito não exige cartão e tem limites de captura e de
            armazenamento descritos na página de planos.
          </li>
          <li>
            O plano Pro é cobrado mensal ou anualmente, por meio da Stripe. Nós
            não armazenamos os dados do seu cartão.
          </li>
          <li>
            Você pode cancelar quando quiser, sem multa. O Pro continua valendo
            até o fim do período já pago; depois disso a conta volta ao plano
            Gratuito.
          </li>
          <li>
            Preços podem mudar. Se mudarem, avisamos por e-mail antes da
            renovação seguinte, e você decide se continua.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Serviço em desenvolvimento</h2>
        <p>
          A Nexo é oferecida &ldquo;como está&rdquo;. Não garantimos ausência de
          falhas nem disponibilidade ininterrupta, e não há acordo de nível de
          serviço. Funcionalidades anunciadas como{" "}
          <strong>&ldquo;em breve&rdquo;</strong> são intenção declarada, não
          compromisso de data — e você não deve assinar contando com elas.
        </p>
      </section>

      <section>
        <h2>8. Encerramento</h2>
        <p>
          Você pode encerrar sua conta a qualquer momento. Nós podemos encerrar
          ou suspender uma conta que descumpra estes termos, com aviso prévio
          sempre que for possível dar um.
        </p>
      </section>

      <section>
        <h2>9. Limite de responsabilidade</h2>
        <p>
          Na máxima extensão permitida pela lei brasileira, a nossa
          responsabilidade por qualquer reclamação relacionada ao serviço fica
          limitada ao valor que você pagou nos 12 meses anteriores ao fato. Isso
          não afasta os direitos que o Código de Defesa do Consumidor garante a
          você.
        </p>
      </section>

      <section>
        <h2>10. Lei e foro</h2>
        <p>
          Estes termos são regidos pela lei brasileira. Fica eleito o foro do
          domicílio do consumidor para resolver qualquer controvérsia.
        </p>
      </section>

      <section>
        <h2>11. Mudanças nestes termos</h2>
        <p>
          Se mudarmos algo relevante, atualizamos a data no topo desta página e
          avisamos por e-mail antes de a mudança valer. Dúvidas:{" "}
          <a href="mailto:contato@nexo.app">contato@nexo.app</a>.
        </p>
      </section>
    </LegalDocument>
  );
}
