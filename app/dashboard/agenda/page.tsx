import { redirect } from "next/navigation";

import { AgendaView } from "@/components/agenda/agenda-view";
import { addDays } from "@/lib/agenda/day";
import { getAgendaDay, listAgendaDays } from "@/lib/agenda/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Agenda — Nexo" };

/** Quantos dias para trás a sala carrega de uma vez. */
const WINDOW_DAYS = 35;

/**
 * A sala da Agenda.
 *
 * **Este componente não decide que dia é hoje**, e isso é regra, não
 * omissão: o fuso é do navegador, e qualquer texto derivado do relógio local
 * renderizado aqui divergiria na hidratação — em UTC no servidor, no fuso da
 * pessoa no cliente. O que ele faz é mandar uma *faixa* larga o bastante para
 * conter o "hoje" de qualquer fuso (de UTC−12 a UTC+14), e deixar o cliente
 * escolher. Ver o cabeçalho de `components/agenda/agenda-view.tsx`.
 *
 * A margem de um dia para cada lado da faixa é exatamente isso: em UTC+14 já
 * é amanhã, e sem ela a lista de hoje daquela pessoa ficaria fora do retrato.
 */
export default async function AgendaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // O layout do dashboard já barra, mas nada se assume: mesma postura das
  // outras salas.
  if (!user) redirect("/login");

  // `toISOString()` é UTC, e aqui isso é **deliberado**: este não é o dia de
  // ninguém, é só a âncora da faixa. O dia da pessoa é decidido no cliente
  // (`localDayKey`), e usar `toISOString` lá seria o defeito que
  // `lib/agenda/day.ts` existe para não ter.
  const utcToday = new Date().toISOString().slice(0, 10);
  const from = addDays(utcToday, -WINDOW_DAYS);
  const to = addDays(utcToday, 1);

  // O dia de hoje pelo relógio do servidor entra com o documento junto, para
  // o caso comum (quem está no fuso do servidor, ou perto) pintar o editor já
  // preenchido no primeiro paint. Quem estiver em outro dia cai no andaime, e
  // o `key` do editor cuida da troca.
  const [days, todayNote] = await Promise.all([
    listAgendaDays(user.id, from, to),
    getAgendaDay(user.id, utcToday),
  ]);

  return (
    <AgendaView initial={days} initialToday={todayNote} from={from} to={to} />
  );
}
