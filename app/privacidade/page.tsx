import type { Metadata } from "next";

import { LegalDocument } from "@/components/layout/legal-document";

export const metadata: Metadata = {
  title: "Privacidade — Nexo",
  description:
    "Que dados a Nexo guarda, por que guarda, com quem compartilha e como você exerce seus direitos sob a LGPD.",
};

export default function PrivacidadePage() {
  return (
    <LegalDocument
      title="Privacidade"
      summary="A Nexo vende a ideia de que privacidade é estrutura, não selo. Esta página descreve a estrutura — o que é guardado, onde, por quanto tempo e quem alcança."
      updatedAt="28 de agosto de 2026"
    >
      <section>
        <h2>1. Quem trata os seus dados</h2>
        <p>
          A Nexo é a controladora dos dados descritos abaixo, nos termos da Lei
          Geral de Proteção de Dados (Lei 13.709/2018). Contato para qualquer
          assunto desta página:{" "}
          <a href="mailto:contato@nexo.app">contato@nexo.app</a>.
        </p>
      </section>

      <section>
        <h2>2. O que guardamos</h2>
        <ul>
          <li>
            <strong>Dados de conta:</strong> e-mail, nome e foto de perfil, se
            você fornecer.
          </li>
          <li>
            <strong>Seu conteúdo:</strong> as notas, tarefas, ideias e arquivos
            que você envia, além dos resumos, tipos e tags que a Nexo gera a
            partir deles.
          </li>
          <li>
            <strong>Dados de assinatura:</strong> plano, status e período
            vigente. Os dados do cartão ficam com a Stripe — nós nunca os vemos.
          </li>
          <li>
            <strong>Registros técnicos:</strong> data, endereço IP e navegador
            associados a alterações e exclusões de dados sensíveis, guardados
            numa trilha de auditoria para investigar acessos indevidos.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Para que usamos, e com que base legal</h2>
        <ul>
          <li>
            <strong>Operar o serviço</strong> — guardar, classificar e devolver
            o seu conteúdo. Base: execução do contrato.
          </li>
          <li>
            <strong>Cobrar a assinatura</strong> — Base: execução do contrato.
          </li>
          <li>
            <strong>Segurança e auditoria</strong> — detectar e investigar
            acesso indevido. Base: legítimo interesse.
          </li>
          <li>
            <strong>Comunicação de serviço</strong> — avisos sobre a conta,
            cobrança e mudanças nestes documentos. Base: execução do contrato.
          </li>
        </ul>
        <p>
          Não vendemos os seus dados, e não os usamos para publicidade
          direcionada.
        </p>
      </section>

      <section>
        <h2>4. Com quem compartilhamos</h2>
        <p>
          Somente com os fornecedores necessários para o serviço funcionar, e
          apenas com o que cada um precisa:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — banco de dados, autenticação e
            armazenamento de arquivos.
          </li>
          <li>
            <strong>Stripe</strong> — processamento de pagamento da assinatura.
          </li>
          <li>
            <strong>Provedor de modelo de linguagem</strong> — recebe o texto
            extraído da captura para produzir o resumo, o tipo e as tags daquele
            item, e nada além disso.
          </li>
        </ul>
        <p>
          Alguns desses fornecedores processam dados fora do Brasil. A
          transferência acontece com as salvaguardas contratuais previstas na
          LGPD.
        </p>
      </section>

      <section>
        <h2>5. Inteligência artificial</h2>
        <p>
          A Nexo <strong>não treina modelos com o seu conteúdo</strong>. O texto
          enviado ao provedor de modelo serve exclusivamente para gerar a
          classificação daquela captura, e o resultado volta para a sua conta.
        </p>
        <p>
          A classificação é sempre identificada como automática e sempre
          reversível: o que a IA escreveu ou marcou, você edita ou apaga.
        </p>
      </section>

      <section>
        <h2>6. Como o isolamento funciona na prática</h2>
        <p>
          A separação entre contas não é uma regra da aplicação, que poderia
          falhar num bug: ela está no banco de dados.
        </p>
        <ul>
          <li>
            Todas as tabelas têm <strong>Row Level Security</strong> ativa, e
            cada consulta é filtrada pelo identificador do usuário autenticado
            dentro do próprio banco.
          </li>
          <li>
            Os arquivos ficam em <strong>buckets privados</strong>, alcançáveis
            apenas por links temporários assinados para você.
          </li>
          <li>
            A sessão vive num <strong>cookie httpOnly</strong>, que scripts da
            página não conseguem ler.
          </li>
          <li>
            Alterações e exclusões em dados sensíveis geram registro na trilha
            de auditoria.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Cookies e armazenamento no navegador</h2>
        <p>
          A Nexo não usa cookies de publicidade nem de rastreamento de
          terceiros. Existem dois itens apenas:
        </p>
        <ul>
          <li>
            O <strong>cookie de sessão</strong>, necessário para manter você
            conectado.
          </li>
          <li>
            A sua escolha de <strong>tema claro ou escuro</strong>, guardada
            localmente no seu navegador e nunca enviada para nós.
          </li>
        </ul>
      </section>

      <section>
        <h2>8. Por quanto tempo guardamos</h2>
        <p>
          O seu conteúdo fica enquanto a sua conta existir. Ao excluir uma nota
          ou um arquivo, ele sai do serviço; ao encerrar a conta, os dados
          associados são removidos, exceto o que a lei nos obriga a reter — como
          registros fiscais de pagamento e a trilha de auditoria, mantida pelo
          prazo legal aplicável.
        </p>
      </section>

      <section>
        <h2>9. Os seus direitos</h2>
        <p>
          A LGPD garante a você confirmar a existência de tratamento, acessar os
          dados, corrigir dados incompletos ou desatualizados, solicitar
          anonimização ou eliminação, pedir portabilidade, saber com quem
          compartilhamos e revogar consentimento.
        </p>
        <p>
          Para exercer qualquer um deles, escreva para{" "}
          <a href="mailto:contato@nexo.app">contato@nexo.app</a>. Respondemos em
          até 15 dias.
        </p>
      </section>

      <section>
        <h2>10. Mudanças nesta política</h2>
        <p>
          Se algo relevante mudar, atualizamos a data no topo desta página e
          avisamos por e-mail antes de a mudança valer.
        </p>
      </section>
    </LegalDocument>
  );
}
