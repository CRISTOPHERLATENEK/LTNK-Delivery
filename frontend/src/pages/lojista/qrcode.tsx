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

/**
 * Quantas cópias por folha, e para que serve cada arranjo.
 *
 * O QR é o MESMO nas quatro opções — o que muda é quantos saem de uma folha.
 * Um cartaz grande vai na porta; doze pequenos viram os adesivos que vão em
 * doze sacolas. Imprimir doze folhas com um código cada era o trabalho que esta
 * tela existe para tirar.
 */
const ARRANJOS: Array<{ copias: number; colunas: string; rotulo: string; para: string }> = [
  { copias: 1, colunas: 'grid-cols-1', rotulo: '1 por folha', para: 'porta e parede' },
  { copias: 4, colunas: 'grid-cols-2', rotulo: '4 por folha', para: 'balcão e mesa' },
  { copias: 8, colunas: 'grid-cols-2', rotulo: '8 por folha', para: 'sacola' },
  { copias: 12, colunas: 'grid-cols-3', rotulo: '12 por folha', para: 'cartão de mão' },
];

/** Tamanhos de PNG com o uso ao lado — "1024 px" não diz nada sozinho. */
const TAMANHOS: Array<{ px: number; para: string }> = [
  { px: 512, para: 'WhatsApp e redes' },
  { px: 1024, para: 'adesivo e cartaz A4' },
  { px: 2048, para: 'banner e fachada' },
];

export function QrCodeLoja() {
  const [tamanho, setTamanho] = useState(1024);
  const [copias, setCopias] = useState(1);
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
  const arranjo = ARRANJOS.find(a => a.copias === copias) ?? ARRANJOS[0];
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
        {/*
          A GRADE É A MESMA NA TELA E NO PAPEL, de propósito: o que se vê aqui é
          o que sai da impressora. Pré-visualização que não bate com a impressão
          faz gastar folha para descobrir o arranjo.

          `break-inside: avoid` em cada cartão: sem isso, o último da página sai
          cortado ao meio, com o código metade numa folha e metade na outra —
          e um QR pela metade não lê.
        */}
        <div
          id="qr-para-impressao"
          className={cn('grid gap-2 rounded-2xl border border-border bg-white p-3 text-black',
            arranjo.colunas)}
        >
          {Array.from({ length: copias }, (_, i) => (
            <div
              key={i}
              style={{ breakInside: 'avoid' }}
              className={cn('rounded-xl border border-dashed border-neutral-300 text-center',
                copias === 1 ? 'p-5' : copias <= 4 ? 'p-3' : 'p-2')}
            >
              {loja?.logo_url && copias <= 4 && (
                <img src={loja.logo_url} alt="" className={cn('mx-auto mb-2 object-contain',
                  copias === 1 ? 'h-12' : 'h-8')} />
              )}
              <p className={cn('font-extrabold uppercase leading-tight tracking-tight',
                copias === 1 ? 'text-[17px]' : copias <= 4 ? 'text-[13px]' : 'text-[11px]')}>
                {loja?.nome || 'Sua loja'}
              </p>
              <p className={cn('mt-0.5 font-semibold leading-tight text-neutral-600',
                copias === 1 ? 'text-[12.5px]' : copias <= 4 ? 'text-[10.5px]' : 'text-[9px]')}>
                {chamada}
              </p>
              <img
                src={`${base}/api/qr-da-loja.svg`}
                alt={`QR code de ${loja?.nome || 'sua loja'}`}
                className={cn('mx-auto mt-2 aspect-square w-full',
                  copias === 1 ? 'max-w-[240px]' : copias <= 4 ? 'max-w-[130px]' : 'max-w-[92px]')}
              />
              <p className={cn('mt-1 break-all font-bold leading-tight text-neutral-700',
                copias === 1 ? 'text-[12px]' : copias <= 4 ? 'text-[9.5px]' : 'text-[8px]')}>
                {enderecoCurto}
              </p>
            </div>
          ))}
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
              Quantos por folha
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ARRANJOS.map(a => (
                <button
                  key={a.copias}
                  type="button"
                  onClick={() => setCopias(a.copias)}
                  className={cn('whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors',
                    copias === a.copias ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground')}
                >
                  {a.rotulo} · {a.para}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              É sempre o mesmo código — muda só quantos saem de uma folha. A linha
              tracejada é onde recortar.
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
                <Printer className="size-4" /> Imprimir {copias === 1 ? 'o cartaz' : `${copias} por folha`}
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
