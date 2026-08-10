/**
 * Preview da landing page. Movido do antigo marca.tsx sem alteração.
 *
 * `LandingConfig` mora aqui, e não na página: o preview é quem renderiza a
 * configuração inteira, então importar o tipo daqui evita um ciclo entre a
 * página e o componente.
 */
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { LandingRecurso, LandingDepoimento, LandingDestaque, LandingPlano, LandingFaq, LandingIconeTituloDesc, LandingStat, LandingAutomacaoItem, LandingCupomItem } from '@/types';
export interface LandingConfig {
  cta_texto: string;
  recursos: LandingRecurso[];
  beneficios: string[];
  comparativo_sem: string[];
  comparativo_com: string[];
  segmentos: string[];
  depoimentos: LandingDepoimento[];
  destaques: LandingDestaque[];
  planos: LandingPlano[];
  faq: LandingFaq[];
  hero_eyebrow: string;
  hero_titulo: string;
  hero_subtitulo: string;
  hero_imagem: string;
  hero_imagem_mobile: string;
  whatsapp: string;
  demo_url: string;
  como_funciona_titulo: string;
  como_funciona_subtitulo: string;
  como_funciona: LandingIconeTituloDesc[];
  atendimento_titulo: string;
  atendimento_subtitulo: string;
  stats: LandingStat[];
  automacao_titulo: string;
  automacao_subtitulo: string;
  automacao: LandingAutomacaoItem[];
  fiscal_eyebrow: string;
  fiscal_titulo: string;
  fiscal_texto: string;
  fiscal_selo_titulo: string;
  fiscal_selo_desc: string;
  fiscal_mini: LandingIconeTituloDesc[];
  cupom_itens: LandingCupomItem[];
  cupom_total: string;
  recursos_titulo: string;
  planos_titulo: string;
  planos_subtitulo: string;
  duvidas_titulo: string;
  cta_titulo: string;
  cta_subtitulo: string;
  cta_botao_demo_texto: string;
  whatsapp_msg_hero: string;
  whatsapp_msg_cta: string;
  whatsapp_msg_flutuante: string;
  footer_coluna_sistema: string;
  footer_coluna_contato: string;
  endereco: string;
  social_instagram: string;
  social_facebook: string;
  social_tiktok: string;
  social_youtube: string;
  social_x: string;
}


/**
 * Preview ao vivo = a própria landing pública (`/?preview=1`) dentro de um
 * <iframe> same-origin, recebendo o estado ainda não salvo via postMessage —
 * mesmo padrão do preview da loja (visual/PhonePreview.tsx). Não é um mockup
 * à parte: é literalmente o mesmo componente que o visitante vê, então nunca
 * diverge da página real (era esse o problema do mock anterior — ficava pra
 * trás toda vez que a landing mudava de estrutura).
 */
export function PreviewLanding({ form }: { form: LandingConfig }) {
  const [pronto, setPronto] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function aoReceberMensagem(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'preview-ready') setPronto(true);
    }
    window.addEventListener('message', aoReceberMensagem);
    return () => window.removeEventListener('message', aoReceberMensagem);
  }, []);

  useEffect(() => {
    if (!pronto) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({
      type: 'landing-preview',
      payload: {
        landing_cta_texto: form.cta_texto,
        landing_recursos: form.recursos,
        landing_beneficios: form.beneficios,
        landing_comparativo_sem: form.comparativo_sem,
        landing_comparativo_com: form.comparativo_com,
        landing_segmentos: form.segmentos,
        landing_depoimentos: form.depoimentos,
        landing_destaques: form.destaques,
        landing_planos: form.planos,
        landing_faq: form.faq,
        landing_hero_eyebrow: form.hero_eyebrow,
        landing_hero_titulo: form.hero_titulo,
        landing_hero_subtitulo: form.hero_subtitulo,
        landing_hero_imagem: form.hero_imagem,
        landing_hero_imagem_mobile: form.hero_imagem_mobile,
        landing_whatsapp: form.whatsapp,
        landing_demo_url: form.demo_url,
        landing_como_funciona_titulo: form.como_funciona_titulo,
        landing_como_funciona_subtitulo: form.como_funciona_subtitulo,
        landing_como_funciona: form.como_funciona,
        landing_atendimento_titulo: form.atendimento_titulo,
        landing_atendimento_subtitulo: form.atendimento_subtitulo,
        landing_stats: form.stats,
        landing_automacao_titulo: form.automacao_titulo,
        landing_automacao_subtitulo: form.automacao_subtitulo,
        landing_automacao: form.automacao,
        landing_fiscal_eyebrow: form.fiscal_eyebrow,
        landing_fiscal_titulo: form.fiscal_titulo,
        landing_fiscal_texto: form.fiscal_texto,
        landing_fiscal_selo_titulo: form.fiscal_selo_titulo,
        landing_fiscal_selo_desc: form.fiscal_selo_desc,
        landing_fiscal_mini: form.fiscal_mini,
        landing_cupom_itens: form.cupom_itens,
        landing_cupom_total: form.cupom_total,
        landing_recursos_titulo: form.recursos_titulo,
        landing_planos_titulo: form.planos_titulo,
        landing_planos_subtitulo: form.planos_subtitulo,
        landing_duvidas_titulo: form.duvidas_titulo,
        landing_cta_titulo: form.cta_titulo,
        landing_cta_subtitulo: form.cta_subtitulo,
        landing_cta_botao_demo_texto: form.cta_botao_demo_texto,
        landing_whatsapp_msg_hero: form.whatsapp_msg_hero,
        landing_whatsapp_msg_cta: form.whatsapp_msg_cta,
        landing_whatsapp_msg_flutuante: form.whatsapp_msg_flutuante,
        landing_footer_coluna_sistema: form.footer_coluna_sistema,
        landing_footer_coluna_contato: form.footer_coluna_contato,
        landing_endereco: form.endereco,
        landing_social_instagram: form.social_instagram,
        landing_social_facebook: form.social_facebook,
        landing_social_tiktok: form.social_tiktok,
        landing_social_youtube: form.social_youtube,
        landing_social_x: form.social_x,
      },
    }, window.location.origin);
  }, [form, pronto]);

  function recarregar() {
    setPronto(false);
    const el = iframeRef.current;
    if (el) el.src = el.src;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <button type="button" onClick={recarregar} title="Recarregar preview"
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="rounded-2xl border-2 border-dashed border-border p-2 bg-muted/30">
        <div className="rounded-xl overflow-hidden border border-border bg-background shadow-sm">
          <iframe
            ref={iframeRef}
            src="/?preview=1"
            title="Pré-visualização da landing"
            className="w-full border-0 bg-white"
            style={{ height: '70vh' }}
            onLoad={() => setPronto(false)}
          />
        </div>
      </div>
      <p className="text-[10px] text-center text-muted-foreground">
        É a página real, ao vivo — não um mockup.
      </p>
    </div>
  );
}
