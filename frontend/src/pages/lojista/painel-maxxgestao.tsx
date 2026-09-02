/**
 * INTEGRAÇÃO COM O MAXX GESTÃO (Meu ERP Online).
 *
 * Card próprio, separado do TEF de propósito: são dois caminhos DIFERENTES para
 * a mesma nota, e juntá-los na mesma tela faria a pessoa configurar um pensando
 * que está mexendo no outro.
 *
 * O que este caminho tem que os outros não têm: o documento do ERP aceita a
 * forma de pagamento real (NSU, bandeira, tipo de cartão), então a NFC-e para
 * de declarar "todo cartão é crédito" por palpite.
 */
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface EstadoErp {
  /** Mascarado (`****abcd`). O valor em claro nunca sai do servidor. */
  token: string | null;
  configurado: boolean;
}

interface EmpresaErp {
  razao_social: string;
  cnpj: string;
  local: string;
  regime: string;
}

export function PainelMaxxGestao({ emissor, aoMudarEmissor }: {
  /** Quem emite a NFC-e hoje. Vem de `/api/lojista/tef`, fonte única. */
  emissor: 'sistema' | 'maquininha' | 'erp';
  aoMudarEmissor: (novo: 'sistema' | 'erp') => Promise<void> | void;
}) {
  const { mostrar } = useToast();
  const [token, setToken] = useState('');
  const [configurado, setConfigurado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [empresa, setEmpresa] = useState<EmpresaErp | null>(null);

  /*
   * O campo nasce com a MÁSCARA que veio do servidor, não vazio. Vazio
   * pareceria "nunca configurado" numa loja que está, e o primeiro reflexo
   * seria colar o token de novo. O backend ignora valor que comece com `****`.
   */
  useEffect(() => {
    let vivo = true;
    api<EstadoErp>('GET', '/api/lojista/erp')
      .then(r => { if (!vivo) return; setToken(r.token || ''); setConfigurado(r.configurado); })
      .catch(() => { /* a tela não cai por causa disso */ });
    return () => { vivo = false; };
  }, []);

  async function salvarETestar() {
    setEnviando(true);
    setEmpresa(null);
    try {
      const r = await api<EstadoErp>('PUT', '/api/lojista/erp', { token });
      setToken(r.token || '');
      setConfigurado(r.configurado);
      /*
       * Salva e testa na MESMA ação. Dois botões deixariam "salvei mas não sei
       * se funciona" ser um estado possível — e é exatamente o estado em que a
       * nota não sai.
       */
      setEmpresa(await api<EmpresaErp>('POST', '/api/lojista/erp/testar', {}));
      mostrar({ tipo: 'sucesso', titulo: 'Conectado ao Maxx Gestão' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-bold">Emitir a NFC-e pelo Maxx Gestão</h3>
        <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-muted-foreground">
          Cada pedido vira documento no ERP e a nota sai de lá, com a bandeira e
          o NSU reais do cartão — não como "crédito" por padrão.
        </p>
      </div>

      <div>
        <p className="text-[13px] font-bold">Token da API</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Nasce no painel do Maxx Gestão e não expira. Guardado criptografado —
          trate como senha: quem tem ele emite nota no seu CNPJ.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="cole o token aqui"
            className="min-w-[220px] flex-1 font-mono text-sm"
            disabled={enviando}
          />
          <Button type="button" variant="outline" disabled={enviando || !token.trim()} onClick={() => void salvarETestar()}>
            Salvar e testar
          </Button>
        </div>
      </div>

      {/*
        MOSTRA A RAZÃO SOCIAL, não um visto verde. Ver o próprio CNPJ é o que
        prova que o token é da conta certa — token da conta errada só apareceria
        na primeira nota emitida no CNPJ de outra empresa.
      */}
      {empresa && (
        <div className="rounded-xl bg-muted/50 p-3.5 text-[12.5px] leading-relaxed">
          <p className="font-bold text-foreground">{empresa.razao_social}</p>
          <p className="text-muted-foreground">
            CNPJ {empresa.cnpj} · {empresa.local} · {empresa.regime}
          </p>
          <p className="mt-1 text-muted-foreground">
            Confira se é a sua empresa antes de deixar o Maxx Gestão emitir.
          </p>
        </div>
      )}

      {/*
        O INTERRUPTOR VEM DEPOIS DO TESTE, na ordem em que a coisa acontece: sem
        token o servidor recusa ligar, e recusar depois do clique ensina menos
        que a ordem da tela ensinar sozinha.
      */}
      <button
        type="button"
        disabled={enviando || (!configurado && emissor !== 'erp')}
        aria-pressed={emissor === 'erp'}
        onClick={() => void aoMudarEmissor(emissor === 'erp' ? 'sistema' : 'erp')}
        className="flex w-full items-center justify-between gap-4 rounded-xl border border-border p-4 text-left disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold">O Maxx Gestão emite a NFC-e</span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
            {emissor === 'erp'
              ? 'Este sistema não emite mais. O botão de emitir de um pedido continua, para o dia em que o ERP estiver fora do ar.'
              : configurado
                ? 'Ligando, este sistema para de emitir e a nota passa a sair do ERP.'
                : 'Salve e teste o token primeiro.'}
          </span>
        </span>
        <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors',
          emissor === 'erp' ? 'bg-primary' : 'bg-muted-foreground/30')}>
          <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            emissor === 'erp' ? 'left-[22px]' : 'left-0.5')} />
        </span>
      </button>

      {/*
        DOIS EMISSORES NÃO CONVIVEM. Se a maquininha estiver marcada como
        emissora e o ERP for ligado, quem vale é o último clique — dizer isso
        aqui evita a descoberta pelo caminho caro, que é a nota duplicada.
      */}
      {emissor === 'maquininha' && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Hoje quem emite é <b className="text-foreground">a maquininha</b>. Ligar
          aqui passa a emissão para o Maxx Gestão — a maquininha volta a só cobrar.
        </p>
      )}
    </div>
  );
}
