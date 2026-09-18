import type { Metadata } from "next";

import { LegalDocument } from "@/components/layout/legal-document";

export const metadata: Metadata = {
  title: "Privacidade — Nexo",
  description:
    "Nexo é software auto-hospedado: este documento explica o que a aplicação guarda e para onde envia dados, e serve de ponto de partida para quem sobe a própria instância.",
};

export default function PrivacidadePage() {
  return (
    <LegalDocument
      title="Privacidade"
      summary="Nexo não é um serviço que alguém opera por você — é software que você sobe com as suas próprias chaves. Esta página explica o que a aplicação guarda e para onde ela envia dados, e serve de modelo para quem for disponibilizar a própria instância a outras pessoas."
      updatedAt="17 de setembro de 2026"
    >
      <section>
        <h2>1. O que este documento é (e o que não é)</h2>
        <p>
          O Nexo é distribuído como código aberto para você rodar na sua
          própria infraestrutura: o seu projeto Supabase, e as suas próprias
          chaves de IA e de pagamento, quando aplicável. Não existe um servidor
          central operado pelas pessoas que mantêm este projeto onde o seu
          conteúdo ou o de terceiros seja processado — ele fica na instância
          que você configurou.
        </p>
        <p>
          Se você é a única pessoa usando a sua instância, você é ao mesmo
          tempo quem trata os dados e quem os fornece — este documento
          descreve, nesse caso, apenas o comportamento do software.
        </p>
        <p>
          Se você disponibiliza a sua instância para outras pessoas usarem
          (uma equipe, a família, um produto seu), <strong>você</strong> passa
          a ser quem responde pelos dados delas perante a Lei Geral de
          Proteção de Dados (Lei 13.709/2018) ou legislação equivalente. Este
          texto é um ponto de partida para a sua própria política — troque o
          e-mail de contato abaixo pelo seu, e revise com alguém que conheça a
          lei que se aplica a você antes de publicar.
        </p>
      </section>

      <section>
        <h2>2. O que a aplicação guarda</h2>
        <p>Tudo abaixo fica no projeto Supabase que você mesmo configurou:</p>
        <ul>
          <li>
            <strong>Dados de conta:</strong> e-mail, nome e foto de perfil, se
            fornecidos.
          </li>
          <li>
            <strong>O conteúdo:</strong> as notas, tarefas, ideias e arquivos
            enviados, além dos resumos, tipos e tags que a classificação
            automática gera a partir deles.
          </li>
          <li>
            <strong>Dados de assinatura</strong>, só se o operador da instância
            tiver configurado links de cobrança: plano, status e período
            vigente. Os dados do cartão nunca passam pela aplicação — ficam
            com a Stripe.
          </li>
          <li>
            <strong>Registros técnicos:</strong> data, endereço IP e navegador
            associados a alterações e exclusões de dados sensíveis, guardados
            numa trilha de auditoria para investigar acessos indevidos naquela
            instância.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Para que serve cada dado</h2>
        <ul>
          <li>
            <strong>Operar a aplicação</strong> — guardar, classificar e
            devolver o conteúdo enviado.
          </li>
          <li>
            <strong>Cobrança</strong>, se o operador da instância habilitou
            pagamento.
          </li>
          <li>
            <strong>Segurança e auditoria</strong> — detectar e investigar
            acesso indevido dentro daquela instância.
          </li>
          <li>
            <strong>Comunicação de serviço</strong> — avisos sobre conta,
            cobrança ou mudanças neste documento, quando o operador enviar
            esse tipo de aviso.
          </li>
        </ul>
        <p>
          O software em si não vende dados, não os usa para publicidade
          direcionada e não os usa para treinar modelo nenhum.
        </p>
      </section>

      <section>
        <h2>4. Para onde os dados saem — e só quando você configura</h2>
        <p>
          Nada disto acontece por padrão: cada item abaixo depende de uma
          chave que o operador da instância preencheu no próprio{" "}
          <code>.env</code>. Sem a chave, aquele envio simplesmente não
          acontece.
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — banco de dados, autenticação e
            armazenamento de arquivos. É a própria infraestrutura escolhida
            pelo operador, não um serviço de terceiro alheio à instância.
          </li>
          <li>
            <strong>Groq ou OpenAI</strong> — o provedor de modelo de
            linguagem usado na classificação automática, se uma das duas
            chaves estiver configurada. Recebe o texto extraído da captura
            para produzir resumo, tipo e tags daquele item, e nada além disso.
            A seção 5 detalha exatamente o que sai.
          </li>
          <li>
            <strong>Stripe</strong> — processamento de pagamento, só se o
            operador tiver configurado links de cobrança.
          </li>
        </ul>
        <p>
          Sem nenhuma chave de IA configurada, a classificação automática
          simplesmente não roda: entra um classificador determinístico local,
          sem custo e sem nada saindo da instância.
        </p>
      </section>

      <section>
        <h2>5. Inteligência artificial</h2>
        <p>
          Quando a classificação automática está ativa (seção 4), uma parte do
          que é capturado sai da instância — e vale dizer exatamente o quê:
        </p>
        <ul>
          <li>
            <strong>O que é enviado:</strong> o nome do arquivo, o tipo dele e
            o texto extraído do documento, cortado nos primeiros 8.000
            caracteres.
          </li>
          <li>
            <strong>O que não é enviado:</strong> nada que identifique a
            pessoa. A requisição não leva e-mail, nome nem identificador de
            conta — do lado do provedor, aquele texto não tem dono.
          </li>
          <li>
            <strong>Quando acontece:</strong> só no envio de um arquivo, uma
            vez por captura. Nem a busca, nem as notas escritas à mão, nem o
            que já está guardado são enviados para lá.
          </li>
        </ul>
        <p>
          O trecho enviado é processado nos servidores do provedor escolhido
          (Groq ou OpenAI) e sob os termos dele — é um tratamento que acontece
          fora da instância. Se um documento for sensível demais para
          atravessar essa fronteira, ele não deve ser enviado para
          classificação automática.
        </p>
        <p>
          A classificação é sempre identificada como automática e sempre
          reversível: o que a IA escreveu ou marcou pode ser editado ou
          apagado.
        </p>
      </section>

      <section>
        <h2>6. Por que existe login, e como o isolamento entre contas funciona</h2>
        <p>
          Uma instância auto-hospedada não é sempre de uma pessoa só. O
          cenário comum é o oposto: alguém sobe o Nexo num servidor pessoal e
          disponibiliza para quem mora na casa, para a própria organização, ou
          simplesmente porque duas pessoas dividem o mesmo computador e cada
          uma quer o próprio espaço, sem ver o conteúdo da outra. O sistema de
          contas continua existindo por causa desse caso — não é resquício do
          modelo antigo de serviço hospedado.
        </p>
        <p>
          Numa instância com mais de uma conta, a separação entre elas não é
          uma regra da aplicação, que poderia falhar num bug: ela está no
          banco de dados.
        </p>
        <ul>
          <li>
            Todas as tabelas têm <strong>Row Level Security</strong> ativa, e
            cada consulta é filtrada pelo identificador do usuário autenticado
            dentro do próprio banco.
          </li>
          <li>
            Os arquivos ficam em <strong>buckets privados</strong>, alcançáveis
            apenas por links temporários assinados para quem os enviou.
          </li>
          <li>
            A sessão vive num <strong>cookie httpOnly</strong>, que scripts da
            página não conseguem ler.
          </li>
          <li>
            Alterações e exclusões em dados sensíveis geram registro na trilha
            de auditoria daquela instância.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Cookies e armazenamento no navegador</h2>
        <p>
          A aplicação não usa cookies de publicidade nem de rastreamento de
          terceiros. Existem dois itens apenas:
        </p>
        <ul>
          <li>
            O <strong>cookie de sessão</strong>, necessário para manter a
            pessoa conectada.
          </li>
          <li>
            A escolha de <strong>tema claro ou escuro</strong>, guardada
            localmente no navegador e nunca enviada ao servidor.
          </li>
        </ul>
      </section>

      <section>
        <h2>8. Por quanto tempo os dados ficam guardados</h2>
        <p>
          O conteúdo fica enquanto a conta existir naquela instância. Ao
          excluir uma nota ou um arquivo, ele sai do banco; ao encerrar a
          conta, os dados associados são removidos, exceto o que a lei exigir
          reter — como registros fiscais de pagamento, quando houver cobrança,
          e a trilha de auditoria, pelo prazo legal aplicável. Backups do
          próprio projeto Supabase seguem a política de retenção que o
          operador da instância configurou lá.
        </p>
      </section>

      <section>
        <h2>9. Os direitos de quem tem dados numa instância</h2>
        <p>
          A LGPD garante confirmar a existência de tratamento, acessar os
          dados, corrigir dados incompletos ou desatualizados, solicitar
          anonimização ou eliminação, pedir portabilidade, saber com quem os
          dados são compartilhados e revogar consentimento.
        </p>
        <p>
          Para exercer qualquer um deles, escreva para{" "}
          <a href="mailto:contato@exemplo.com">contato@exemplo.com</a>{" "}
          <em>
            — endereço de exemplo: quem administra esta instância deve
            substituí-lo pelo próprio contato antes de publicá-la para
            terceiros.
          </em>
        </p>
      </section>

      <section>
        <h2>10. Mudanças neste documento</h2>
        <p>
          Este texto acompanha o código do projeto. Se algo relevante mudar no
          que a aplicação guarda ou para onde envia dados, a data no topo
          desta página é atualizada junto — e quem administra uma instância
          para terceiros deve avisá-los antes de a mudança valer.
        </p>
      </section>
    </LegalDocument>
  );
}
