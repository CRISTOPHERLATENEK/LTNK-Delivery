/**
 * INTEGRAÇÕES — onde o sistema conversa com sistemas de fora.
 *
 * A maquininha (Smart TEF) nasceu como uma aba dentro de Pagamentos, ao lado de
 * Pix e cartão online. Fazia sentido enquanto ela era "mais uma forma de
 * receber". Não faz mais: Pix e cartão online são dinheiro que cai pela
 * internet, configurados uma vez com um token; maquininha e iFood são
 * APARELHOS E EMPRESAS DE FORA que precisam ser conectados, autorizados, e que
 * quebram por motivos próprios — credencial revogada, aparelho desligado,
 * aprovação pendente.
 *
 * Quando o lojista pensa "o iFood parou", ele não pensa "vou em Pagamentos".
 * Esta tela é o lugar que ele procura.
 */
import { useEffect, useState } from 'react';
import { Plug, Smartphone, ShoppingBag, ExternalLink } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface EstadoIfood {
  merchant_id: string;
  ativo: boolean;
  /** A PLATAFORMA tem credenciais de app iFood? Não depende do lojista. */
  plataforma_integrada: boolean;
  configurado: boolean;
}

/** Interruptor desenhado à mão, como no resto do painel. */
function Chave({ ativo, onAlternar, disabled }: {
  ativo: boolean; onAlternar: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button" disabled={disabled} onClick={onAlternar} aria-pressed={ativo}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60',
        ativo ? 'bg-primary' : 'bg-muted-foreground/30')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
        ativo ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

export function IntegracoesLoja() {
  const { mostrar } = useToast();
  const [ifood, setIfood] = useState<EstadoIfood | null>(null);
  const [merchantId, setMerchantId] = useState('');
  const [carregado, setCarregado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<EstadoIfood>('GET', '/api/lojista/ifood')
      .then(r => { setIfood(r); if (!carregado) { setMerchantId(r.merchant_id); setCarregado(true); } })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvarIfood(campos: Record<string, unknown>) {
    setEnviando(true);
    try {
      const r = await api<EstadoIfood>('PUT', '/api/lojista/ifood', campos);
      setIfood(r);
      setMerchantId(r.merchant_id);
      return r;
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
      return null;
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-[860px] space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Plug className="size-5 text-primary" /> Integrações
        </h2>
        <p className="mt-1 max-w-[640px] text-sm leading-relaxed text-muted-foreground">
          Aqui ficam as conexões com sistemas de fora. Diferente de Pix e cartão
          online, que você configura uma vez e esquece, estas dependem de
          aparelhos e de aprovações — e podem parar por conta própria.
        </p>
      </div>

      {/* ─────────────── iFood ─────────────── */}
      <Card>
        <CardContent className="space-y-5 py-6">
          <div className="flex items-start gap-3">
            <ShoppingBag className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-bold">iFood</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Os pedidos do iFood entram direto no seu painel, junto com os do
                seu cardápio próprio — mesma tela, mesma cozinha, mesma impressora.
              </p>
            </div>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold',
              ifood?.configurado
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-500'
                : 'bg-muted text-muted-foreground')}>
              {ifood?.configurado ? 'Ligado' : 'Desligado'}
            </span>
          </div>

          {/*
            A DISTINÇÃO QUE EVITA CHAMADO ABERTO À TOA.

            "A plataforma ainda não está integrada" é problema NOSSO, não do
            lojista — e sem dizer isso ele olharia o próprio cadastro
            procurando o que fez de errado num campo que já estava certo.
          */}
          {ifood && !ifood.plataforma_integrada && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
              <p className="text-[13px] font-bold text-amber-700 dark:text-amber-500">
                Ainda não disponível
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                A integração com o iFood está sendo habilitada pela plataforma.
                Não há nada para você fazer aqui ainda — avisaremos quando abrir.
              </p>
            </div>
          )}

          {ifood?.plataforma_integrada && (
            <>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold">Receber pedidos do iFood</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    Desligado, os pedidos continuam só no aplicativo do iFood.
                  </p>
                </div>
                <Chave
                  ativo={!!ifood.ativo}
                  disabled={enviando}
                  onAlternar={() => void salvarIfood({ ativo: !ifood.ativo })}
                />
              </div>

              {ifood.ativo && !ifood.merchant_id && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4 text-[12.5px] leading-relaxed text-muted-foreground">
                  <b className="text-amber-700 dark:text-amber-500">Falta o código da loja.</b>{' '}
                  Enquanto ele não for preenchido, nenhum pedido do iFood chega aqui.
                </div>
              )}

              <form
                className="space-y-2"
                onSubmit={async e => {
                  e.preventDefault();
                  const r = await salvarIfood({ merchant_id: merchantId });
                  if (r) mostrar({ tipo: 'sucesso', titulo: 'Código da loja salvo' });
                }}
              >
                <Label htmlFor="ifood-merchant">Código da sua loja no iFood</Label>
                <div className="flex gap-2">
                  <Input
                    id="ifood-merchant" value={merchantId} disabled={enviando}
                    onChange={e => setMerchantId(e.target.value)}
                    placeholder="0a0000aa-0aa0-00aa-aa00-0000aa000001"
                    className="font-mono text-sm"
                  />
                  <Button type="submit" disabled={enviando} className="shrink-0">Salvar</Button>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  É o identificador da sua loja no Portal do Parceiro iFood. Peça
                  ao seu contato no iFood se não souber onde encontrar.
                </p>
              </form>

              <p className="border-t border-border pt-4 text-[12px] leading-relaxed text-muted-foreground">
                <b className="text-foreground">Importante:</b> além de ligar aqui,
                o iFood precisa aprovar o acesso do nosso aplicativo à sua loja.
                Essa autorização é feita do lado deles, uma loja por vez.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─────────────── Maquininha ─────────────── */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-start gap-3">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-bold">Maquininha (TEF)</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Manda o valor da venda direto para a maquininha e recebe de volta
                se aprovou, se foi crédito ou débito, a bandeira e o NSU.
              </p>
              {/*
                Fica em Pagamentos e não aqui, apesar de ser uma integração.
                Mover a tela agora obrigaria quem já configurou a procurar de
                novo; o link resolve sem quebrar o caminho que já existe.
              */}
              <a
                href="/lojista/config?secao=pagamentos"
                className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline"
              >
                Configurar em Pagamentos <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
