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
import { Upload, Link2, X, Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { tokenSessao } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  aspectRatio?: 'square' | 'wide' | 'free';
  className?: string;
}

export function ImageUpload({ value, onChange, label, aspectRatio = 'free', className }: Props) {
  const [urlAberta, setUrlAberta] = useState(false);
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
      const token = tokenSessao();
      const form = new FormData();
      form.append('imagem', file);
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

  const isQuadrado = aspectRatio === 'square';
  const previewClasse = isQuadrado
    ? 'size-24 rounded-2xl' // logo: miniatura fixa, não estica até a largura do card
    : cn('w-full rounded-xl max-h-32', aspectRatio === 'wide' ? 'aspect-video object-cover' : 'object-cover');

  return (
    <div className={cn('space-y-2', className)}>
      {label && <p className="text-sm font-medium">{label}</p>}

      {value ? (
        // ── Já tem imagem: preview compacto + ações, sem repetir o dropzone ──
        <div className={cn('flex gap-3', isQuadrado ? 'items-center' : 'flex-col')}>
          <img src={value} alt="Preview" className={cn(previewClasse, 'border border-border object-cover bg-muted shrink-0')} />
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={carregando}>
              {carregando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Trocar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setUrlAberta(v => !v); setUrlDigitada(value); }}>
              <Link2 className="size-3.5" /> URL
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onChange('')} className="text-destructive hover:text-destructive">
              <X className="size-3.5" /> Remover
            </Button>
          </div>
        </div>
      ) : (
        // ── Sem imagem: dropzone compacto ──
        <div
          onClick={() => !carregando && inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setArrastandoSobre(true); }}
          onDragLeave={() => setArrastandoSobre(false)}
          className={cn(
            'relative flex items-center justify-center gap-2.5 rounded-xl border-2 border-dashed p-3.5 cursor-pointer transition-colors',
            arrastandoSobre ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/50',
            carregando && 'pointer-events-none opacity-60',
          )}
        >
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
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setUrlAberta(v => !v); }}
            className="ml-auto shrink-0 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Link2 className="size-3" /> URL
          </button>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onInputChange} />

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
          <Button type="button" size="sm" onClick={confirmarUrl} className="shrink-0">OK</Button>
        </div>
      )}

      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
