/**
 * ImageUpload — componente de upload de imagem com drag & drop, preview
 * compacto e fallback para URL manual. Usa POST /api/upload/imagem (multipart).
 *
 * Logo (aspectRatio="square") usa preview em miniatura fixa — não faz sentido
 * esticar um logo até a largura do card. Capa (aspectRatio="wide") usa preview
 * full-width mas compacto. Com imagem já definida, mostra só o preview + ações
 * (Trocar / URL / Remover) — sem repetir a área de arrastar-e-soltar embaixo.
 */
import { useRef, useState, useCallback } from 'react';
import { Upload, Link2, X, Image as ImageIcon, Loader2, RefreshCw, Images, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, tokenSessao } from '@/lib/api';
import { reduzirImagem } from '@/lib/reduzir-imagem';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  /**
   * MOSTRA A GALERIA DAS IMAGENS QUE A LOJA JÁ TEM.
   *
   * Opcional porque a rota é do painel do LOJISTA: no painel admin (marca,
   * landing) ela devolveria 403, e um botão que só sabe dar erro é pior que
   * botão nenhum.
   *
   * Pedido do lojista cadastrando foto de complemento: o item "MONSTER ULTRA
   * FIESTA" aponta para o produto MONSTER ULTRA FIESTA, que JÁ tem foto — e ele
   * ia procurar o arquivo no computador para subir a mesma imagem de novo.
   * Dezesseis energéticos, dezesseis uploads do que já estava lá.
   */
  galeria?: boolean;
  /**
   * `square`     — miniatura de 96px com as ações ao lado (logo, favicon).
   * `square-lg`  — 256px com as ações EMBAIXO: usado onde a foto é o assunto da
   *                seção (cadastro de produto), e onde miniatura pequena não deixa
   *                julgar se o recorte ficou bom.
   */
  aspectRatio?: 'square' | 'square-lg' | 'wide' | 'free';
  className?: string;
}

export function ImageUpload({ value, onChange, label, aspectRatio = 'free', galeria, className }: Props) {
  const [urlAberta, setUrlAberta] = useState(false);
  const [galeriaAberta, setGaleriaAberta] = useState(false);
  const [buscaGaleria, setBuscaGaleria] = useState('');
  const [doSistema, setDoSistema] = useState<Array<{ imagem: string; nome: string }> | null>(null);

  /*
   * A LISTA SÓ É PEDIDA QUANDO A GALERIA ABRE. São até 400 linhas, e a esmagadora
   * maioria dos cadastros não abre este painel — carregar junto com a tela seria
   * pagar por todos o que um usa.
   *
   * Falha em silêncio com lista vazia: sem galeria, subir arquivo e colar URL
   * continuam funcionando, e um erro aqui não pode travar o cadastro da foto.
   */
  async function abrirGaleria() {
    setGaleriaAberta(v => !v);
    if (doSistema !== null) return;
    try {
      const r = await api<{ imagens: Array<{ imagem: string; nome: string }> }>('GET', '/api/lojista/imagens');
      setDoSistema(r.imagens || []);
    } catch { setDoSistema([]); }
  }
  const [carregando, setCarregando] = useState(false);
  const [arrastandoSobre, setArrastandoSobre] = useState(false);
  const [erro, setErro] = useState('');
  const [urlDigitada, setUrlDigitada] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function enviarArquivo(file: File) {
    if (!file.type.startsWith('image/')) {
      setErro('Envie apenas imagens (JPG, PNG, WebP, GIF).');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setErro('Arquivo muito grande. Máximo 8 MB.');
      return;
    }
    setErro('');
    setCarregando(true);
    try {
      /*
       * REDUZ ANTES DE SUBIR. Nada no caminho reduzia: o servidor grava o
       * arquivo como veio e o serve igual pra todo cliente que abre o cardapio.
       * Foto de celular tem 3-4 MB e 4000px, e e desenhada em miniatura de 44px
       * na lista de sabores. Dezesseis sabores fotografados eram ~50 MB num
       * cardapio que precisa abrir no 4G.
       *
       * `reduzirImagem` NUNCA lanca: se o navegador nao conseguir decodificar,
       * volta o arquivo original. Upload que funcionava nao pode parar de
       * funcionar por causa de uma otimizacao.
       */
      const { arquivo } = await reduzirImagem(file);
      const token = tokenSessao();
      const form = new FormData();
      form.append('imagem', arquivo);
      const resp = await fetch('/api/upload/imagem', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.erro || 'Erro no upload.');
      onChange(json.url);
      setUrlAberta(false);
    } catch (e: any) {
      setErro(e.message || 'Falha no upload.');
    } finally {
      setCarregando(false);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setArrastandoSobre(false);
    const file = e.dataTransfer.files[0];
    if (file) enviarArquivo(file);
  }, []);

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) enviarArquivo(file);
  }

  function confirmarUrl() {
    const url = urlDigitada.trim();
    if (url && !/^https?:\/\//i.test(url) && !url.startsWith('/uploads/')) {
      setErro('Use uma URL começando com https://');
      return;
    }
    setErro('');
    onChange(url);
    setUrlAberta(false);
    setUrlDigitada('');
  }

  const isQuadradoGrande = aspectRatio === 'square-lg';
  const isQuadrado = aspectRatio === 'square' || isQuadradoGrande;
  const previewClasse = isQuadradoGrande
    ? 'size-64 max-w-full rounded-2xl'
    : isQuadrado
    ? 'size-24 rounded-2xl' // logo: miniatura fixa, não estica até a largura do card
    : cn('w-full rounded-xl max-h-32', aspectRatio === 'wide' ? 'aspect-video object-cover' : 'object-cover');

  return (
    <div className={cn('space-y-2', className)}>
      {label && <p className="text-sm font-medium">{label}</p>}

      {value ? (
        // ── Já tem imagem: preview compacto + ações, sem repetir o dropzone ──
        <div className={cn('flex gap-3',
          isQuadradoGrande ? 'flex-col items-start' : isQuadrado ? 'items-center' : 'flex-col')}>
          <img src={value} alt="Preview" className={cn(previewClasse, 'border border-border object-cover bg-muted shrink-0')} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => inputRef.current?.click()} disabled={carregando}>
              {carregando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Trocar
            </Button>
            {galeria && (
              <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={abrirGaleria}>
                <Images className="size-3.5" /> Do sistema
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => { setUrlAberta(v => !v); setUrlDigitada(value); }}>
              <Link2 className="size-3.5" /> URL
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onChange('')} className="min-h-11 text-destructive hover:text-destructive sm:min-h-9">
              <X className="size-3.5" /> Remover
            </Button>
          </div>
        </div>
      ) : (
        // ── Sem imagem: dropzone compacto ──
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setArrastandoSobre(true); }}
          onDragLeave={() => setArrastandoSobre(false)}
          className={cn(
            'relative flex items-center justify-center gap-2.5 border-2 border-dashed transition-colors',
            // Vazio no MESMO formato do preview: assim a área não muda de tamanho ao
            // subir a imagem, e dá pra ver desde o início o espaço que ela vai ocupar.
            isQuadradoGrande ? 'size-64 max-w-full flex-col rounded-2xl p-4 text-center' : 'rounded-xl p-3.5',
            arrastandoSobre ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/50',
            carregando && 'pointer-events-none opacity-60',
          )}
        >
          {/*
            O botao cobre a area inteira em vez de a `div` de fora ter o
            `onClick`: era uma `div` clicavel, ou seja, o mouse funcionava mas o
            Tab nunca parava ali e o leitor de tela nao anunciava nada. O
            `<button>` traz foco visivel, Enter/Espaco e o papel certo de graca —
            e o arrastar-e-soltar continua na `div`, que e quem recebe o arquivo.
          */}
          <button
            type="button"
            onClick={() => !carregando && inputRef.current?.click()}
            aria-label={label ? `Escolher imagem: ${label}` : 'Escolher imagem'}
            className="absolute inset-0 cursor-pointer rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {carregando ? (
            <>
              <Loader2 className="size-4 text-primary animate-spin shrink-0" />
              <p className="text-xs font-medium text-muted-foreground">Enviando…</p>
            </>
          ) : (
            <>
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <ImageIcon className="size-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{arrastandoSobre ? 'Solte aqui!' : 'Arraste ou clique para escolher'}</p>
                <p className="text-[11px] text-muted-foreground">JPG, PNG, WebP ou GIF · máx 8 MB</p>
              </div>
            </>
          )}
          {galeria && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); abrirGaleria(); }}
              className="relative z-10 ml-auto flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Images className="size-3" /> Do sistema
            </button>
          )}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setUrlAberta(v => !v); }}
            className={cn('relative z-10 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              !galeria && 'ml-auto')}
          >
            <Link2 className="size-3" /> URL
          </button>
        </div>
      )}

      <input
        ref={inputRef} type="file" accept="image/*" className="hidden"
        aria-label={label ? `Arquivo de imagem: ${label}` : 'Arquivo de imagem'}
        onChange={onInputChange}
      />

      {urlAberta && (
        <div className="flex gap-2">
          <Input
            autoFocus
            type="url"
            value={urlDigitada}
            onChange={e => setUrlDigitada(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), confirmarUrl())}
            placeholder="https://exemplo.com/foto.jpg"
          />
          <Button type="button" size="sm" onClick={confirmarUrl} className="min-h-11 shrink-0 sm:min-h-9">OK</Button>
        </div>
      )}

      {/*
        ─── AS IMAGENS QUE A LOJA JÁ TEM ───

        Grade de miniaturas, não lista com nome: quem procura foto reconhece a
        FOTO. O nome fica embaixo em letra pequena, para desempatar duas
        parecidas.
      */}
      {galeriaAberta && (
        <div className="rounded-xl border border-border p-2">
          <div className="flex items-center gap-2">
            <span className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={buscaGaleria}
                onChange={e => setBuscaGaleria(e.target.value)}
                placeholder="Buscar pelo nome do produto"
                aria-label="Buscar imagem já salva"
                className="h-8 pl-7 text-xs"
              />
            </span>
            <button type="button" onClick={() => setGaleriaAberta(false)}
              className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-accent">
              <X className="size-4" />
            </button>
          </div>

          {doSistema === null ? (
            <p className="px-1 py-3 text-[11.5px] text-muted-foreground">Carregando…</p>
          ) : (() => {
            const alvo = buscaGaleria.trim().toLowerCase();
            /* TETO DE 60 MINIATURAS: a grade é imagem, e imagem pesa — 400 de
               uma vez travaria a rolagem no celular. */
            const achadas = doSistema
              .filter(x => !alvo || (x.nome || '').toLowerCase().includes(alvo))
              .slice(0, 60);
            if (achadas.length === 0) {
              return (
                <p className="px-1 py-3 text-[11.5px] text-muted-foreground">
                  {alvo ? 'Nenhuma imagem com esse nome.' : 'A loja ainda não tem imagem salva.'}
                </p>
              );
            }
            return (
              <div className="mt-2 grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
                {achadas.map(x => (
                  <button
                    key={x.imagem}
                    type="button"
                    title={x.nome}
                    onClick={() => { onChange(x.imagem); setGaleriaAberta(false); }}
                    className={cn('overflow-hidden rounded-lg border transition-colors hover:border-primary',
                      x.imagem === value ? 'border-primary ring-2 ring-primary/30' : 'border-border')}
                  >
                    <img src={x.imagem} alt={x.nome} loading="lazy"
                      className="aspect-square w-full bg-muted object-cover" />
                    <span className="block truncate px-1 pb-1 pt-0.5 text-[9.5px] leading-tight text-muted-foreground">
                      {x.nome}
                    </span>
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
