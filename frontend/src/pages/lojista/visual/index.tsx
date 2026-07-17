import { useEffect, useState } from 'react';
import {
  Settings, Palette, Image as ImageIcon, Image, UtensilsCrossed, MousePointerClick,
  Type, GalleryHorizontal, Sparkles, Code, Save, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useVisualForm } from './useVisualForm';
import { PhonePreview } from './PhonePreview';
import { GeralTab } from './abas/GeralTab';
import { CoresTab } from './abas/CoresTab';
import { LogoTab } from './abas/LogoTab';
import { CapaTab } from './abas/CapaTab';
import { CardapioTab } from './abas/CardapioTab';
import { BotoesTab } from './abas/BotoesTab';
import { TipografiaTab } from './abas/TipografiaTab';
import { BannersTab } from './abas/BannersTab';
import { TemasTab } from './abas/TemasTab';
import { AvancadoTab } from './abas/AvancadoTab';

const ABAS_VISUAL = [
  { id: 'geral', label: 'Geral', icone: Settings },
  { id: 'cores', label: 'Cores', icone: Palette },
  { id: 'logo', label: 'Logo', icone: ImageIcon },
  { id: 'capa', label: 'Capa', icone: Image },
  { id: 'cardapio', label: 'Cardápio', icone: UtensilsCrossed },
  { id: 'botoes', label: 'Botões', icone: MousePointerClick },
  { id: 'tipografia', label: 'Tipografia', icone: Type },
  { id: 'banners', label: 'Banners', icone: GalleryHorizontal },
  { id: 'temas', label: 'Temas', icone: Sparkles },
  { id: 'avancado', label: 'Avançado', icone: Code },
] as const;

type AbaId = typeof ABAS_VISUAL[number]['id'];

export function VisualLoja() {
  const form = useVisualForm();
  const [aba, setAba] = useState<AbaId>('geral');
  const [previewAberto, setPreviewAberto] = useState(false);
  const [modoPreview, setModoPreview] = useState<'mobile' | 'desktop'>('mobile');

  // Evita perder alterações não salvas ao fechar/recarregar a aba sem querer.
  // Precisa ficar ANTES do early-return de loading (regra dos hooks).
  useEffect(() => {
    if (!form.dirty) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [form.dirty]);

  if (!form.carregado) return <Skeleton className="h-96" />;

  const { estado, atualizar, aplicarParcial, dirty, salvando, salvar, restaurarPadraoAba, lojaId, tenantSlug } = form;

  return (
    <div className="space-y-4 pb-24 lg:pb-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Visual da loja</h1>
          <p className="text-sm text-muted-foreground">Cores, logo, capa, cardápio, botões e mais.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button type="button" size="sm" variant="outline" className="lg:hidden" onClick={() => setPreviewAberto(true)}>
            <Eye className="size-3.5" /> Preview
          </Button>
          {dirty && (
            <span className="hidden sm:inline rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              Alterações não salvas
            </span>
          )}
          <Button type="button" size="sm" onClick={salvar} disabled={salvando || !dirty}>
            <Save className="size-3.5" /> {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>

      {/* Seletor de aba estilo pill — rola na horizontal no mobile */}
      <div className="flex gap-1 rounded-xl bg-muted p-1 overflow-x-auto scrollbar-hide">
        {ABAS_VISUAL.map(a => {
          const Icone = a.icone;
          return (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap',
                aba === a.id
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icone className="size-3.5 shrink-0" />
              {a.label}
            </button>
          );
        })}
      </div>

      <div className={cn(
        'lg:grid lg:gap-5 lg:items-start',
        // Modo "Desktop" do preview precisa de bem mais espaço horizontal
        // pra não ficar minúsculo (é o site inteiro em 1180px escalado) —
        // a coluna cresce, o formulário cede espaço.
        modoPreview === 'mobile' ? 'lg:grid-cols-[minmax(0,1fr)_430px]' : 'lg:grid-cols-[minmax(280px,1fr)_760px]',
      )}>
        <div className="min-w-0">
          {aba === 'geral' && <GeralTab estado={estado} atualizar={atualizar} />}
          {aba === 'cores' && <CoresTab estado={estado} atualizar={atualizar} restaurarPadrao={() => restaurarPadraoAba('cores')} />}
          {aba === 'logo' && <LogoTab estado={estado} atualizar={atualizar} restaurarPadrao={() => restaurarPadraoAba('logo')} />}
          {aba === 'capa' && <CapaTab estado={estado} atualizar={atualizar} restaurarPadrao={() => restaurarPadraoAba('capa')} />}
          {aba === 'cardapio' && <CardapioTab estado={estado} atualizar={atualizar} restaurarPadrao={() => restaurarPadraoAba('cardapio')} />}
          {aba === 'botoes' && <BotoesTab estado={estado} atualizar={atualizar} restaurarPadrao={() => restaurarPadraoAba('botoes')} />}
          {aba === 'tipografia' && <TipografiaTab estado={estado} atualizar={atualizar} restaurarPadrao={() => restaurarPadraoAba('tipografia')} />}
          {aba === 'banners' && <BannersTab estado={estado} atualizar={atualizar} />}
          {aba === 'temas' && <TemasTab estado={estado} aplicarParcial={aplicarParcial} />}
          {aba === 'avancado' && <AvancadoTab estado={estado} atualizar={atualizar} />}
        </div>

        {/* Preview ao vivo — sticky no desktop, Sheet no mobile */}
        <div className="hidden lg:block lg:sticky lg:top-4">
          <PhonePreview estado={estado} lojaId={lojaId} tenantSlug={tenantSlug} modo={modoPreview} onModoChange={setModoPreview} />
        </div>
      </div>

      <Sheet open={previewAberto} onOpenChange={setPreviewAberto}>
        <SheetContent side="bottom" className="max-h-[85dvh]">
          <SheetHeader>
            <SheetTitle>Pré-visualização</SheetTitle>
          </SheetHeader>
          <div className="flex justify-center overflow-y-auto p-4">
            <PhonePreview estado={estado} lojaId={lojaId} tenantSlug={tenantSlug} modo={modoPreview} onModoChange={setModoPreview} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
