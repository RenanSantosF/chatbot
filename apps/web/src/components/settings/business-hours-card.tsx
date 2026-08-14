"use client";

import { CalendarClock, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Faixa = [string, string];
type Semana = Record<string, Faixa[]>;

const DIAS = [
  { chave: "1", nome: "Segunda" },
  { chave: "2", nome: "Terça" },
  { chave: "3", nome: "Quarta" },
  { chave: "4", nome: "Quinta" },
  { chave: "5", nome: "Sexta" },
  { chave: "6", nome: "Sábado" },
  { chave: "0", nome: "Domingo" },
] as const;

/**
 * Segunda a sexta, 8h às 18h com almoço.
 *
 * Ligar o recurso já preenche a semana comum em vez de abrir catorze campos
 * vazios: quem atende nesse horário só confere e salva, e quem atende em
 * outro mexe em dois campos. Um formulário em branco faria as duas pessoas
 * trabalharem.
 */
const PADRAO: Semana = Object.fromEntries(
  ["1", "2", "3", "4", "5"].map((dia) => [
    dia,
    [
      ["08:00", "12:00"],
      ["13:00", "18:00"],
    ] as Faixa[],
  ]),
);

function mesmaSemana(a: Semana | null, b: Semana | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Fechamento antes da abertura não é faixa, e o navegador não barra isso. */
function faixaInvalida(faixa: Faixa): boolean {
  return Boolean(faixa[0] && faixa[1] && faixa[1] <= faixa[0]);
}

export function BusinessHoursCard({
  value,
  onSave,
}: {
  value: Semana | null;
  onSave: (semana: Semana | null) => Promise<unknown>;
}) {
  const [semana, setSemana] = useState<Semana | null>(value);
  const [salvando, setSalvando] = useState(false);

  const ligado = semana !== null;
  const temErro = Object.values(semana ?? {})
    .flat()
    .some(faixaInvalida);
  const mudou = !mesmaSemana(semana, value);

  function ajustar(dia: string, faixas: Faixa[]) {
    setSemana((atual) => {
      const proxima = { ...(atual ?? {}) };
      // Dia sem faixa nenhuma sai do objeto: "não atende" e "atende de
      // vazio a vazio" precisam ser a mesma coisa pro back-end.
      if (faixas.length === 0) delete proxima[dia];
      else proxima[dia] = faixas;
      return proxima;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" />
          Horário de atendimento
        </CardTitle>
        <CardDescription>
          A IA passa a saber quando a empresa está aberta: ela responde &ldquo;que horas vocês
          atendem?&rdquo; com o que estiver aqui e, fora do expediente, diz quando a equipe volta em vez
          de prometer resposta imediata. Sem isso configurado, o sistema atende em qualquer horário.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-4 rounded-md border p-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Definir horário de atendimento</span>
            <span className="block text-xs text-muted-foreground text-pretty">
              Desligado, a empresa é tratada como aberta o tempo todo.
            </span>
          </span>
          <Switch
            checked={ligado}
            onCheckedChange={(marcado) => setSemana(marcado ? PADRAO : null)}
            aria-label="Definir horário de atendimento"
          />
        </label>

        {ligado ? (
          <div className="flex flex-col gap-1.5">
            {DIAS.map(({ chave, nome }) => {
              const faixas = semana[chave] ?? [];
              const atende = faixas.length > 0;

              return (
                <div
                  key={chave}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2"
                >
                  <Switch
                    checked={atende}
                    onCheckedChange={(marcado) =>
                      ajustar(chave, marcado ? [["08:00", "18:00"]] : [])
                    }
                    aria-label={`Atende ${nome.toLowerCase()}`}
                  />
                  <span
                    className={cn(
                      "w-20 shrink-0 text-sm",
                      atende ? "font-medium" : "text-muted-foreground",
                    )}
                  >
                    {nome}
                  </span>

                  {atende ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {faixas.map((faixa, indice) => (
                        // O índice como chave é seguro aqui: as faixas de um
                        // dia não são reordenadas, só criadas e removidas.
                        <div key={indice} className="flex items-center gap-1.5">
                          {indice > 0 ? (
                            <span className="text-xs text-muted-foreground">e</span>
                          ) : null}
                          <Input
                            type="time"
                            value={faixa[0]}
                            aria-label={`Abertura de ${nome.toLowerCase()}`}
                            onChange={(evento) =>
                              ajustar(
                                chave,
                                faixas.map((item, i) =>
                                  i === indice ? [evento.target.value, item[1]] : item,
                                ),
                              )
                            }
                            className={cn("h-8 w-[6.5rem]", faixaInvalida(faixa) && "border-destructive")}
                          />
                          <span className="text-xs text-muted-foreground">às</span>
                          <Input
                            type="time"
                            value={faixa[1]}
                            aria-label={`Fechamento de ${nome.toLowerCase()}`}
                            onChange={(evento) =>
                              ajustar(
                                chave,
                                faixas.map((item, i) =>
                                  i === indice ? [item[0], evento.target.value] : item,
                                ),
                              )
                            }
                            className={cn("h-8 w-[6.5rem]", faixaInvalida(faixa) && "border-destructive")}
                          />
                          {indice > 0 ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Remover intervalo"
                              onClick={() =>
                                ajustar(
                                  chave,
                                  faixas.filter((_, i) => i !== indice),
                                )
                              }
                            >
                              <X className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      ))}

                      {/* Um dia com duas faixas é o almoço. Mais que isso
                          existe (plantão, turno partido), mas o botão some
                          depois da segunda pra a linha não virar um
                          formulário. */}
                      {faixas.length < 2 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs text-muted-foreground"
                          onClick={() => ajustar(chave, [...faixas, ["13:00", "18:00"]])}
                        >
                          <Plus className="size-3.5" />
                          Intervalo
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Não atende</span>
                  )}
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                disabled={!mudou || temErro || salvando}
                onClick={async () => {
                  setSalvando(true);
                  await onSave(semana);
                  setSalvando(false);
                }}
              >
                {salvando ? <Spinner /> : null}
                Salvar horário
              </Button>
              {temErro ? (
                <span className="text-xs text-destructive">
                  O fechamento precisa vir depois da abertura.
                </span>
              ) : null}
            </div>
          </div>
        ) : mudou ? (
          <Button
            size="sm"
            className="self-start"
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              await onSave(null);
              setSalvando(false);
            }}
          >
            {salvando ? <Spinner /> : null}
            Salvar
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
