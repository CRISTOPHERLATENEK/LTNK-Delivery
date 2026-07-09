import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { Tooltip } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EstadoVisual } from '../types';

interface Props {
  estado: EstadoVisual;
  atualizar: (caminho: string, valor: any) => void;
}

interface CampoPixel {
  campo: keyof EstadoVisual['avancado'];
  label: string;
  placeholder: string;
  regex: RegExp;
  ajuda: string;
}

const CAMPOS_PIXEL: CampoPixel[] = [
  { campo: 'ga_measurement_id', label: 'Google Analytics (GA4)', placeholder: 'G-XXXXXXX', regex: /^G-[A-Z0-9]{6,}$/i, ajuda: 'Measurement ID do GA4, começa com G-.' },
  { campo: 'gtm_container_id', label: 'Google Tag Manager', placeholder: 'GTM-XXXXXXX', regex: /^GTM-[A-Z0-9]{4,}$/i, ajuda: 'Container ID do GTM, começa com GTM-.' },
  { campo: 'fb_pixel_id', label: 'Facebook Pixel', placeholder: '123456789012345', regex: /^\d{5,20}$/, ajuda: 'Só números — o ID do Pixel do Meta Ads.' },
  { campo: 'tiktok_pixel_id', label: 'TikTok Pixel', placeholder: 'C4A1B2C3D4E5F6G7H8I9', regex: /^[A-Z0-9]{10,30}$/i, ajuda: 'Pixel Code do TikTok Ads.' },
  { campo: 'clarity_project_id', label: 'Microsoft Clarity', placeholder: 'abcdefghij', regex: /^[a-z0-9]{6,20}$/i, ajuda: 'Project ID do Microsoft Clarity.' },
];

export function AvancadoTab({ estado, atualizar }: Props) {
  const [erros, setErros] = useState<Record<string, string>>({});

  function validarNoBlur(campo: CampoPixel) {
    const v = estado.avancado[campo.campo];
    if (v && !campo.regex.test(v)) {
      setErros(e => ({ ...e, [campo.campo]: `Formato inválido (ex.: ${campo.placeholder}).` }));
    } else {
      setErros(e => { const n = { ...e }; delete n[campo.campo]; return n; });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">SEO / Compartilhamento</p>
          <div>
            <Label>Meta descrição</Label>
            <textarea value={estado.avancado.meta_description}
              onChange={e => atualizar('avancado.meta_description', e.target.value)}
              maxLength={300} rows={3}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Resumo curto que aparece no Google e ao compartilhar o link." />
          </div>
          <div>
            <Label>Palavras-chave</Label>
            <Input value={estado.avancado.meta_keywords}
              onChange={e => atualizar('avancado.meta_keywords', e.target.value)}
              maxLength={200} placeholder="pizza, delivery, hamburguer" className="mt-1.5" />
          </div>
          <ImageUpload label="Imagem de compartilhamento (Open Graph)" value={estado.avancado.og_image}
            onChange={url => atualizar('avancado.og_image', url)} aspectRatio="wide" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pixels de rastreamento</p>
            <Tooltip texto="Só aceitamos IDs — a plataforma injeta sempre o código oficial de cada ferramenta, nunca script livre (segurança).">
              <Info className="size-3.5 text-muted-foreground" />
            </Tooltip>
          </div>
          {CAMPOS_PIXEL.map(c => (
            <div key={c.campo}>
              <Label>{c.label}</Label>
              <Input value={estado.avancado[c.campo]}
                onChange={e => atualizar(`avancado.${c.campo}`, e.target.value)}
                onBlur={() => validarNoBlur(c)}
                placeholder={c.placeholder}
                className={cn('mt-1.5 font-mono text-xs', erros[c.campo] && 'border-destructive')} />
              {erros[c.campo]
                ? <p className="mt-1 text-[11px] text-destructive">{erros[c.campo]}</p>
                : <p className="mt-1 text-[11px] text-muted-foreground">{c.ajuda}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
