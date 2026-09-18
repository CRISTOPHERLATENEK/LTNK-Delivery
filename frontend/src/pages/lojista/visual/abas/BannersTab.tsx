import { ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { BannersLoja } from '../../banners';
import type { EstadoVisual } from '../types';
import { cn } from '@/lib/utils';

interface Props {
  estado: EstadoVisual;
  atualizar: (caminho: string, valor: any) => void;
}

function Toggle({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/40">
      {ativo ? <ToggleRight className="size-4 text-primary" /> : <ToggleLeft className="size-4 text-muted-foreground" />}
      {label}
    </button>
  );
}

/**
 * OS DOIS JEITOS DE MOSTRAR OS BANNERS.
 *
 * O desenho de cada um está no próprio botão, em miniatura: descrever "um por
 * vez" e "vários lado a lado" com palavras obriga a imaginar o resultado, e a
 * escolha é justamente sobre aparência.
 */
const ESTILOS = [
  {
    v: 'destaque' as const,
    nome: 'Um por vez',
    desc: 'Banner grande ocupando a largura toda, trocando sozinho.',
    Desenho: () => <div className="h-8 w-full rounded bg-current opacity-80" />,
  },
  {
    v: 'faixa' as const,
    nome: 'Lado a lado',
    desc: 'Três por vez no computador, arrastando com o dedo no celular.',
    Desenho: () => (
      <div className="flex h-8 w-full gap-1">
        <div className="flex-1 rounded bg-current opacity-80" />
        <div className="flex-1 rounded bg-current opacity-80" />
        <div className="flex-1 rounded bg-current opacity-45" />
      </div>
    ),
  },
];

export function BannersTab({ estado, atualizar }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Como os banners aparecem
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ESTILOS.map(({ v, nome, desc, Desenho }) => {
              const ativo = estado.banners.estilo === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => atualizar('banners.estilo', v)}
                  aria-pressed={ativo}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    ativo ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  <Desenho />
                  <div className={cn('mt-2 text-sm font-bold', ativo ? 'text-primary' : 'text-foreground')}>{nome}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </button>
              );
            })}
          </div>

          {/* A arte do banner quase sempre já traz a chamada escrita — repetir
              por cima tapa a imagem que o lojista mandou fazer. */}
          <Toggle label="Mostrar título e subtítulo sobre a imagem" ativo={estado.banners.mostrar_texto}
            onClick={() => atualizar('banners.mostrar_texto', !estado.banners.mostrar_texto)} />

          <p className="pt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Rotação do carrossel (vale pra todos os banners)
          </p>
          <div>
            <Label>Tempo de rotação ({(estado.banners.tempo_rotacao_ms / 1000).toFixed(1)}s)</Label>
            <input type="range" min={2000} max={10000} step={500} value={estado.banners.tempo_rotacao_ms}
              onChange={e => atualizar('banners.tempo_rotacao_ms', Number(e.target.value))} className="mt-2 w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Toggle label="Loop" ativo={estado.banners.loop} onClick={() => atualizar('banners.loop', !estado.banners.loop)} />
            {/* Bolinha marca 'qual dos N' — com varios visiveis ao mesmo tempo
                ela nao tem o que apontar, entao some no estilo faixa. */}
            {estado.banners.estilo !== 'faixa' && (
              <Toggle label="Mostrar indicadores" ativo={estado.banners.mostrar_indicadores}
                onClick={() => atualizar('banners.mostrar_indicadores', !estado.banners.mostrar_indicadores)} />
            )}
            <Toggle label="Mostrar setas" ativo={estado.banners.mostrar_setas}
              onClick={() => atualizar('banners.mostrar_setas', !estado.banners.mostrar_setas)} />
          </div>
        </CardContent>
      </Card>

      {/* CRUD de banners — já salva na hora (não faz parte do fluxo Salvar/dirty deste form). */}
      <BannersLoja />
    </div>
  );
}
