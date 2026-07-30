/**
 * Estados de tela: VAZIO e FALHA.
 *
 * POR QUE ESTE ARQUIVO EXISTE: o projeto tinha 61 `useQuery` e UM único lugar
 * que olhava `error`. Quando a requisição falhava, a tela ficava no skeleton pra
 * sempre, em branco, ou — pior — dizia a coisa errada: a vitrine mostrava "Loja
 * não encontrada" quando o servidor estava fora do ar. O cliente no meio do
 * pedido era informado de que a loja não existe.
 *
 * Três regras que estas peças impõem:
 *  1. Falha nunca se disfarça de vazio. "Não tem nada" e "não conseguimos
 *     buscar" pedem ações diferentes de quem lê.
 *  2. Toda falha oferece uma saída — tentar de novo, sem recarregar a página.
 *  3. A mensagem diz o que fazer, não o código do erro (ver lib/erro.ts).
 *
 * Feito pra celular primeiro: alvo de toque confortável, texto que caiba em tela
 * estreita, nada que dependa de hover.
 */
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { aparenciaDoErro } from '@/lib/erro';

/** Estado "não tem nada aqui" — resultado legítimo, não erro. */
export function Vazio({
  icone, titulo, texto, botao,
}: { icone: ReactNode; titulo: string; texto: string; botao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center space-y-4 py-20 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-accent">{icone}</div>
      <h2 className="text-xl font-bold">{titulo}</h2>
      <p className="max-w-sm text-muted-foreground">{texto}</p>
      {botao}
    </div>
  );
}

/**
 * Estado de FALHA. `aoTentar` costuma ser o `refetch` da consulta — recarregar a
 * página inteira faz o cliente perder onde estava e é sempre mais lento.
 */
export function Falha({
  erro, aoTentar, acao, compacto,
}: {
  erro: unknown;
  aoTentar?: () => void;
  /** Substitui o botão padrão (ex.: "Entrar de novo" quando a sessão caiu). */
  acao?: ReactNode;
  /** Versão em faixa, para falha dentro de um bloco da tela. */
  compacto?: boolean;
}) {
  const { Icone, titulo, texto, temRetentativa } = aparenciaDoErro(erro);

  if (compacto) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
        <Icone className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{titulo}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{texto}</p>
        </div>
        {acao ?? (temRetentativa && aoTentar && (
          <Button type="button" size="sm" variant="outline" onClick={aoTentar} className="shrink-0">
            <RefreshCw className="size-3.5" /> Tentar
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center space-y-4 px-6 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
        <Icone className="size-8" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-bold">{titulo}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      {acao ?? (temRetentativa && aoTentar && (
        <Button type="button" size="lg" onClick={aoTentar}>
          <RefreshCw className="size-4" /> Tentar de novo
        </Button>
      ))}
    </div>
  );
}
