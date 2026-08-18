/**
 * Marca — identidade visual da plataforma.
 *
 * Era uma tela de 1.781 linhas com QUATRO coisas independentes empilhadas:
 * marca, landing, configurações gerais e backup, cada uma com form e endpoint
 * próprios. Salvar uma parecia salvar as outras, e pra chegar no WhatsApp era
 * preciso rolar por cores e SEO. Agora é só identidade.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Palette, Save, Eye, Type, SquareDashedBottom, Image as ImageIcon, Megaphone, Store, Code2 } from 'lucide-react';
import { AdminLayout } from '../layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useTema, FONTES, foregroundContraste } from '@/lib/tema';
import { cn } from '@/lib/utils';
import { alturaLogo, ESCALA_PADRAO } from '@/lib/logo-escala';
import { PreviewApp } from './PreviewApp';
import { Secao, CampoCor } from './campos';
import type { TemaMarca, RaioMarca, FonteMarca } from '@/types';
const RAIO_OPCOES: { valor: RaioMarca; label: string; classe: string }[] = [
  { valor: 'reto', label: 'Reto', classe: 'rounded-[3px]' },
  { valor: 'suave', label: 'Suave', classe: 'rounded-xl' },
  { valor: 'redondo', label: 'Redondo', classe: 'rounded-[1.4rem]' },
];

export function TelaMarca() {
  const { marca, previsualizar, recarregar } = useTema();
  const { mostrar } = useToast();
  const [form, setForm] = useState<TemaMarca>(marca);
  const [enviando, setEnviando] = useState(false);

  /*
   * ALTERAÇÕES NÃO SALVAS viram uma barra fixa no rodapé.
   *
   * O Salvar era um botão no fim de uma página longa: quem mexia numa cor lá em
   * cima e rolava pra ver o preview perdia o botão de vista, e saía da tela sem
   * salvar. A barra acompanha a rolagem e só aparece quando há o que salvar —
   * então não rouba espaço de quem está só olhando.
   */
  const sujo = JSON.stringify(form) !== JSON.stringify(marca);

  // Lojas para o seletor de "loja única" (white label)
  const lojasQ = useQuery({
    queryKey: ['admin-lojas-marca'],
    queryFn: () => api<{ lojas: { id: number; nome: string; status_aprovacao: string }[] }>('GET', '/api/admin/lojas').then(r => r.lojas),
  });

  useEffect(() => { setForm(marca); }, [marca]);

  // Preview ao vivo de TODA a marca enquanto edita
  useEffect(() => { previsualizar(form); }, [form, previsualizar]);

  // Ao sair sem salvar, reverte o preview para o tema persistido
  useEffect(() => () => { recarregar(); }, [recarregar]);

  function up<K extends keyof TemaMarca>(k: K, v: TemaMarca[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('PUT', '/api/admin/tema', form);
      await recarregar();
      mostrar({ tipo: 'sucesso', titulo: 'Marca atualizada!', descricao: 'O visual aplicou em toda a plataforma.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  /*
   * `logo_escala` pode não existir em cliente que nunca salvou a marca depois
   * desta versão — sem o padrão aqui, o `input range` viria sem valor e o React
   * o trataria como campo não controlado.
   */
  const escalaLogo = form.logo_escala ?? ESCALA_PADRAO;

  const corFg = foregroundContraste(form.cor_primaria);
  const contrasteClaro = corFg === '0 0% 100%';

  return (
    <AdminLayout titulo="Marca">
    <div className="space-y-5 pb-24 max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Palette className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Marca da plataforma</h1>
          <p className="text-sm text-muted-foreground">White label — identidade que todos os clientes vão ver.</p>
        </div>
      </div>

      <form id="form-marca" onSubmit={salvar} className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* ───────────── Coluna de edição ───────────── */}
        <div className="space-y-5 order-2 lg:order-1">
          {/* Identidade */}
          <Secao icone={Store} titulo="Identidade">
            <div>
              <Label htmlFor="nome">Nome da marca</Label>
              <Input id="nome" required maxLength={60} value={form.nome}
                onChange={e => up('nome', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="slogan">Slogan</Label>
              <Input id="slogan" maxLength={120} value={form.slogan}
                onChange={e => up('slogan', e.target.value)}
                placeholder="Ex.: Peça das melhores lojas da sua região" />
            </div>
          </Secao>

          {/* Imagens */}
          <Secao icone={ImageIcon} titulo="Imagens">
            <ImageUpload label="Logo" value={form.logo_url}
              onChange={v => up('logo_url', v)} aspectRatio="square" />

            {/*
              TAMANHO DA LOGO numa barra de 0 a 100.
              Antes a altura era fixa no código, e o resultado depende do
              arquivo: logo com muita margem branca em volta aparece minúscula
              na mesma altura em que uma logo justa fica grande. Só quem vê o
              arquivo pronto na tela sabe qual é o certo.

              A prévia ao lado mostra a logo no tamanho real que vai sair, com a
              altura em px — a barra sozinha não diz nada sobre o resultado.
            */}
            {form.logo_url && (
              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="logo-escala" className="mb-0">Tamanho da logo</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {escalaLogo} · {alturaLogo(44, escalaLogo)}px
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">0</span>
                  <input
                    id="logo-escala"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={escalaLogo}
                    onChange={e => up('logo_escala', Number(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">100</span>
                </div>

                {/* Prévia sobre a cor da marca: logo clara em fundo claro
                    parece sumida, e é justamente onde ela vai ficar. */}
                <div className="mt-3 flex items-center gap-3 rounded-lg bg-primary p-3">
                  <img
                    src={form.logo_url}
                    alt=""
                    style={{ height: alturaLogo(44, escalaLogo) }}
                    className="w-auto max-w-[200px] object-contain"
                  />
                  {form.mostrar_nome !== false && (
                    <span className="truncate text-sm font-extrabold text-primary-foreground">
                      {form.nome || 'Sua marca'}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    50 é o tamanho original. Vale no painel, no login e na página pública.
                  </p>
                  {escalaLogo !== ESCALA_PADRAO && (
                    <button type="button" onClick={() => up('logo_escala', ESCALA_PADRAO)}
                      className="shrink-0 text-xs font-semibold text-primary hover:underline">
                      Voltar ao padrão
                    </button>
                  )}
                </div>
              </div>
            )}

            {/*
              MOSTRAR O NOME AO LADO DA LOGO.
              Existe porque as duas situações são comuns e opostas: logo só de
              símbolo precisa do nome ao lado, e logo com o nome escrito
              (wordmark) fica repetindo — ou pior, mostrando dois nomes
              diferentes, se a logo e o cadastro não combinarem.
            */}
            {form.logo_url && (
              <button
                type="button"
                onClick={() => up('mostrar_nome', !(form.mostrar_nome !== false))}
                className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/40"
              >
                <span className={cn('relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors',
                  form.mostrar_nome !== false ? 'bg-primary' : 'bg-muted-foreground/30')}>
                  <span className={cn('absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-all',
                    form.mostrar_nome !== false ? 'left-[19px]' : 'left-[3px]')} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Mostrar o nome ao lado da logo</span>
                  <span className="block text-xs text-muted-foreground">
                    {form.mostrar_nome !== false
                      ? 'Desligue se a sua logo já traz o nome escrito — senão ele aparece duas vezes.'
                      : 'Só a logo aparece no cabeçalho. Bom pra logo que já tem o nome.'}
                  </span>
                </span>
              </button>
            )}
            <ImageUpload label="Favicon (ícone da aba)" value={form.favicon_url}
              onChange={v => up('favicon_url', v)} aspectRatio="square" />
            <div>
              <ImageUpload label="Banner da tela de login" value={form.login_banner_url}
                onChange={v => up('login_banner_url', v)} aspectRatio="wide" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Aparece no topo do card de login (/conta). Vazio = usa a ilustração padrão. Ideal ~1200×480px.
              </p>
            </div>
          </Secao>

          {/* Cores */}
          <Secao icone={Palette} titulo="Cores">
            <CampoCor label="Cor primária" valor={form.cor_primaria}
              onChange={v => up('cor_primaria', v)} />
            <div className={cn(
              'rounded-lg px-3 py-2 text-xs flex items-center gap-2',
              contrasteClaro ? 'bg-foreground text-background' : 'bg-foreground/5'
            )}>
              <span className="inline-flex size-4 items-center justify-center rounded-full"
                style={{ background: form.cor_primaria, color: `hsl(${corFg})` }}>A</span>
              Texto sobre a cor será <b>{contrasteClaro ? 'branco' : 'escuro'}</b> (contraste automático).
            </div>
            <CampoCor label="Cor secundária (opcional)" valor={form.cor_secundaria}
              onChange={v => up('cor_secundaria', v)} permiteVazio />
          </Secao>

          {/* Cantos */}
          <Secao icone={SquareDashedBottom} titulo="Cantos">
            <div className="flex gap-2">
              {RAIO_OPCOES.map(op => (
                <button key={op.valor} type="button" onClick={() => up('raio', op.valor)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-2 border-2 p-3 transition-colors',
                    op.classe,
                    form.raio === op.valor ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}>
                  <span className={cn('size-9 bg-primary', op.classe)} />
                  <span className="text-xs font-semibold">{op.label}</span>
                </button>
              ))}
            </div>
          </Secao>

          {/* Tipografia */}
          <Secao icone={Type} titulo="Tipografia">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(FONTES) as FonteMarca[]).map(f => (
                <button key={f} type="button" onClick={() => up('fonte', f)}
                  style={{ fontFamily: FONTES[f].stack }}
                  className={cn(
                    'rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                    form.fonte === f ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}>
                  <div className="text-base font-bold leading-none">Aa</div>
                  <div className="mt-1 text-xs text-muted-foreground">{FONTES[f].label}</div>
                </button>
              ))}
            </div>
          </Secao>

          {/* SEO / Compartilhamento */}
          <Secao icone={Megaphone} titulo="SEO e compartilhamento">
            <div>
              <Label htmlFor="descricao">Descrição (Google e redes sociais)</Label>
              <textarea id="descricao" rows={2} maxLength={200} value={form.descricao}
                onChange={e => up('descricao', e.target.value)}
                placeholder="Uma frase que descreve a plataforma. Aparece no Google e ao compartilhar o link."
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
              <p className="text-xs text-muted-foreground mt-1">{form.descricao.length}/200</p>
            </div>
            <ImageUpload label="Imagem de compartilhamento (Open Graph)"
              value={form.og_image} onChange={v => up('og_image', v)} aspectRatio="wide" />
          </Secao>

          {/*
            CRÉDITO NO RODAPÉ do painel do lojista.
            Configurável e não fixo no código porque, num white-label, o crédito
            nem sempre é da plataforma: um revendedor que entrega o sistema com
            a marca dele quer o nome dele ali. Vazio = não aparece nada.
          */}
          <Secao icone={Code2} titulo="Crédito no rodapé">
            <p className="text-xs text-muted-foreground">
              Aparece no fim do painel de quem contratou. Deixe o texto vazio para não mostrar nada.
            </p>
            <div>
              <Label htmlFor="rodape-texto">Texto</Label>
              <Input id="rodape-texto" maxLength={60}
                value={form.rodape_credito_texto || ''}
                onChange={e => up('rodape_credito_texto', e.target.value)}
                placeholder="Ex.: Desenvolvido por" />
            </div>
            <ImageUpload label="Logo abaixo do texto (opcional)"
              value={form.rodape_credito_logo_url || ''}
              onChange={v => up('rodape_credito_logo_url', v)} aspectRatio="wide" />
            <div>
              <Label htmlFor="rodape-url">Link (opcional)</Label>
              <Input id="rodape-url" maxLength={300}
                value={form.rodape_credito_url || ''}
                onChange={e => up('rodape_credito_url', e.target.value)}
                placeholder="https://seusite.com.br" />
              <p className="mt-1 text-xs text-muted-foreground">Abre em outra aba, pra não tirar o lojista do painel.</p>
            </div>
            <div>
              <Label htmlFor="rodape-botao">Texto do botão (opcional)</Label>
              <Input id="rodape-botao" maxLength={60}
                value={form.rodape_credito_botao || ''}
                onChange={e => up('rodape_credito_botao', e.target.value)}
                placeholder="Ex.: Conheça a Unimaxx" />
              {/* Sem link o botão não leva a lugar nenhum — melhor avisar aqui do
                  que deixar o lojista achando que salvou e não apareceu. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {form.rodape_credito_botao && !form.rodape_credito_url
                  ? 'Preencha o link acima, senão o botão não aparece.'
                  : 'Só aparece se o link estiver preenchido.'}
              </p>
            </div>
            <div>
              <Label htmlFor="rodape-copy">Linha de copyright (opcional)</Label>
              <Input id="rodape-copy" maxLength={160}
                value={form.rodape_credito_copyright || ''}
                onChange={e => up('rodape_credito_copyright', e.target.value)}
                placeholder="© 2026 Sua Empresa LTDA — CNPJ 00.000.000/0001-00" />
            </div>
          </Secao>

          {/* Modo de exibição: loja única (white label) ou marketplace */}
          <Secao icone={Eye} titulo="Modo de exibição">
            <div className="space-y-2">
              {/* Landing page do produto */}
              <button type="button" onClick={() => up('loja_id', 0)}
                className={cn('w-full flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors',
                  form.loja_id === 0 ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}>
                <Store className="size-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-sm">Landing page do produto</div>
                  <div className="text-xs text-muted-foreground">A home vende a plataforma (recursos + botão "Ver demonstração"), sem listar lojas de terceiros.</div>
                </div>
              </button>
              {/* Loja única */}
              <div className={cn('rounded-xl border-2 p-3 transition-colors',
                form.loja_id > 0 ? 'border-primary bg-primary/5' : 'border-border')}>
                <div className="flex items-start gap-3">
                  <Eye className="size-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm">Loja única (white label)</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Este link abre direto <b>uma loja</b>, sem listar as outras.
                    </div>
                    <select
                      value={form.loja_id || ''}
                      onChange={e => up('loja_id', Number(e.target.value))}
                      className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Selecione a loja deste link…</option>
                      {(lojasQ.data ?? []).map(l => (
                        <option key={l.id} value={l.id}>
                          {l.nome}{l.status_aprovacao !== 'aprovada' ? ' (não aprovada)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </Secao>
          {/* O Salvar agora mora na barra fixa do rodapé — ver o fim deste arquivo. */}
        </div>

        {/* ───────────── Preview fixo ───────────── */}
        <div className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-4 space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Eye className="size-3.5" /> Pré-visualização ao vivo
            </div>
            <PreviewApp form={form} />
          </div>
        </div>
      </form>
      {/* Landing, Configurações gerais e Backup viraram páginas próprias.
          Ver marca/landing.tsx e configuracoes.tsx. */}

      {/*
        Barra fixa de "não salvo". `pb-24` no wrapper acima reserva o espaço
        dela — sem isso ela cobriria o último campo do formulário.
      */}
      {sujo && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-medium">Alterações não salvas</span>
            <div className="flex gap-2">
              <Button
                type="button" variant="outline" size="sm" disabled={enviando}
                onClick={() => setForm(marca)}
              >
                Descartar
              </Button>
              <Button type="submit" form="form-marca" size="sm" disabled={enviando}>
                <Save className="size-4" />
                {enviando ? 'Salvando…' : 'Salvar marca'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminLayout>
  );
}
