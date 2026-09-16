import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, QrCode as IconeQr } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * O QR CODE DA LOJA, PARA IMPRIMIR.
 *
 * Pedido do lojista do Galdério: um código para colar e, ao apontar a câmera,
 * abrir a loja.
 *
 * ──────────────────── POR QUE SÓ O DA LOJA, POR ENQUANTO ────────────────────
 *
 * O sistema já sabe abrir um produto por link (`/?produto=123`), então QR por
 * produto é possível. Mas QR IMPRESSO NÃO SE ATUALIZA: num cardápio de 1.211
 * itens que pausam, esgotam e mudam de nome, o adesivo da prateleira vira uma
 * decepção que fica lá por meses. O da loja nunca desatualiza — aponta para o
 * cardápio inteiro.
 *
 * ──────────────────────── O QUE BAIXA E O QUE IMPRIME ───────────────────────
 *
 * SVG é o que se manda para a gráfica: é geometria, não foto, e não perde
 * qualidade em nenhum tamanho — do adesivo de 3 cm ao banner de 2 m. O PNG
 * existe porque WhatsApp, Instagram e a maioria dos editores não abrem SVG.
 *
 * E o CARTÃO DE IMPRIMIR é uma terceira coisa: o QR sozinho num papel não diz o
 * que fazer com ele. Quem passa na frente do balcão precisa ler "aponte a
 * câmera" e ver o nome da loja, senão o código é um quadrado preto que ninguém
 * escaneia.
 */

interface Loja {
  nome: string;
  logo_url?: string | null;
}

/** Tamanhos de PNG com o uso ao lado — "1024 px" não diz nada sozinho. */
const TAMANHOS: Array<{ px: number; para: string }> = [
  { px: 512, para: 'WhatsApp e redes' },
  { px: 1024, para: 'adesivo e cartaz A4' },
  { px: 2048, para: 'banner e fachada' },
];

export function QrCodeLoja() {
  const [tamanho, setTamanho] = useState(1024);
  const [chamada, setChamada] = useState('Aponte a câmera e peça pelo celular');

  const { data: loja } = useQuery({
    queryKey: ['lojista-loja-qr'],
    queryFn: () => api<{ loja: Loja }>('GET', '/api/lojista/loja').then(r => r.loja),
  });

  /*
   * O ENDEREÇO É O DA ABA, e não um campo cadastrado: é exatamente o endereço
   * que o cliente vai abrir, e é o mesmo que o servidor usa para gerar o código.
   * Qualquer outra fonte poderia divergir — e um QR que aponta para o lugar
   * errado só se descobre depois de impresso.
   */
  const base = `${window.location.protocol}//${window.location.host}`;
  const enderecoCurto = window.location.host.replace(/^www\./, '');

  function baixar(formato: 'svg' | 'png') {
    const url = formato === 'svg'
      ? `${base}/api/qr-da-loja.svg`
      : `${base}/api/qr-da-loja.png?tamanho=${tamanho}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcode-loja.${formato}`;
    a.click();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <IconeQr className="size-6" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold">QR Code da loja</h1>
          <p className="text-sm text-muted-foreground">
            Imprima e cole. Quem apontar a câmera abre o seu cardápio.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/*
          ─── O CARTÃO, QUE É O QUE VAI PARA O PAPEL ───

          `qr-para-impressao` é o que a folha mostra: o resto da tela some no
          @media print (ver index.css). Imprimir a tela inteira gastaria uma
          página com menu e botões em volta de um quadrado de 4 cm.
        */}
        <div id="qr-para-impressao" className="rounded-2xl border border-border bg-white p-6 text-center text-black">
          {loja?.logo_url && (
            <img src={loja.logo_url} alt="" className="mx-auto mb-3 h-12 object-contain" />
          )}
          <p className="text-[17px] font-extrabold uppercase tracking-tight">{loja?.nome || 'Sua loja'}</p>
          <p className="mt-1 text-[12.5px] font-semibold text-neutral-600">{chamada}</p>
          <img
            src={`${base}/api/qr-da-loja.svg`}
            alt={`QR code de ${loja?.nome || 'sua loja'}`}
            className="mx-auto mt-3 aspect-square w-full max-w-[240px]"
          />
          <p className="mt-2 break-all text-[12px] font-bold text-neutral-700">{enderecoCurto}</p>
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl border border-border p-4">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              O que o código abre
            </p>
            <p className="mt-1.5 break-all font-mono text-[13px]">{base}/</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              É o endereço desta aba — o mesmo que o cliente vai ver. Se um dia a loja
              ganhar domínio próprio, gere o código de novo pelo endereço novo.
            </p>
          </section>

          <section className="rounded-2xl border border-border p-4">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Frase do cartaz
            </p>
            <Input
              value={chamada}
              onChange={e => setChamada(e.target.value)}
              maxLength={60}
              aria-label="Frase que aparece acima do código"
              className="mt-2 h-9 text-[13px]"
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              O código sozinho é um quadrado preto. A frase é o que faz alguém apontar
              a câmera.
            </p>
          </section>

          <section className="rounded-2xl border border-border p-4">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Baixar
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="h-10 whitespace-nowrap" onClick={() => baixar('svg')}>
                <Download className="size-4" /> SVG (gráfica)
              </Button>
              <Button type="button" variant="outline" className="h-10 whitespace-nowrap" onClick={() => baixar('png')}>
                <Download className="size-4" /> PNG
              </Button>
              <Button type="button" className="h-10 whitespace-nowrap" onClick={() => window.print()}>
                <Printer className="size-4" /> Imprimir o cartaz
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {TAMANHOS.map(t => (
                <button
                  key={t.px}
                  type="button"
                  onClick={() => setTamanho(t.px)}
                  className={cn('whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors',
                    tamanho === t.px ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground')}
                >
                  {t.px} px · {t.para}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              SVG não perde qualidade em tamanho nenhum — é o que a gráfica quer. O PNG é
              para WhatsApp e redes, que não abrem SVG.
            </p>
          </section>

          <section className="rounded-2xl border border-dashed border-border p-4">
            <p className="text-[12.5px] font-semibold">Antes de mandar imprimir</p>
            <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted-foreground">
              <li>· Teste com a câmera do seu celular, na tela mesmo.</li>
              <li>· Deixe uma borda branca em volta do código — colado junto de uma borda
                escura, parte dos celulares não lê.</li>
              <li>· Menor que 3 cm só funciona de perto. Para porta e fachada, 8 cm ou mais.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
