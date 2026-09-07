/**
 * Módulos adicionais — os valores extras além da mensalidade do revendedor.
 *
 * COBRANÇA, NÃO PERMISSÃO. Ligar um módulo num cliente soma na conta de quem o
 * revende; não habilita nem bloqueia nada no painel do lojista. Está dito na
 * tela porque a confusão é natural: "cliente tem o módulo NFC-e" soa como
 * permissão, e alguém um dia vai desligar esperando tirar o recurso.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus, Pencil, Trash2, X } from 'lucide-react';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import {
  Toolbar, Tabela, TabelaCabecalho, TabelaLinha, TabelaRodape,
  CelulaNome, Num, Botao, PainelLateral, Secao, LinhaRotulada, Campo,
} from './ui';
import { brl } from '@/lib/format';

export interface Modulo {
  id: number;
  nome: string;
  descricao: string | null;
  preco_centavos: number;
  clientes: number;
}

export function PainelModulos() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Modulo | null>(null);

  const consulta = useQuery({
    queryKey: ['admin-modulos'],
    queryFn: () => api<{ modulos: Modulo[] }>('GET', '/api/admin/modulos').then(r => r.modulos),
  });
  const lista = consulta.data ?? [];

  async function remover(m: Modulo) {
    const ok = await confirmar({
      titulo: `Remover ${m.nome}?`,
      descricao: m.clientes > 0
        ? `Ele está ligado em ${m.clientes} cliente(s) e sai da conta deles a partir de agora. O recurso em si não muda — este módulo é só cobrança.`
        : 'Nenhum cliente usa este módulo.',
      confirmar: 'Remover',
      destrutivo: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/admin/modulos/${m.id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Módulo removido.' });
      qc.invalidateQueries({ queryKey: ['admin-modulos'] });
      qc.invalidateQueries({ queryKey: ['admin-revendedores'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <>
      <Toolbar>
        <p className="min-w-[240px] flex-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--adm-fg2)' }}>
          {/*
            "ISTO É COBRANÇA, NÃO PERMISSÃO" fica junto do que explica a tela,
            não num aviso separado. Era uma faixa própria e virou a segunda
            frase: o alerta em caixa própria lê-se uma vez e depois some da
            vista, e é justamente a confusão que se quer evitar todo dia.
          */}
          Valores extras que somam na conta do revendedor. <b className="font-semibold">
          Isto é cobrança, não permissão</b> — ligar um módulo não habilita o recurso no
          painel do lojista, e desligar não tira.
        </p>
        <Botao variante="primario" onClick={() => { setEditando(null); setCriando(true); }}>
          Novo módulo
        </Botao>
      </Toolbar>

      {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

      {consulta.isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        <Tabela colunas="minmax(0,1.6fr) 110px 120px 150px">
          <TabelaCabecalho>
            <span>Módulo</span>
            <span className="text-right">Clientes</span>
            <span className="text-right">Por cliente</span>
            <span />
          </TabelaCabecalho>
          {lista.map((m, i) => (
            <TabelaLinha key={m.id} primeira={i === 0} aoClicar={() => { setCriando(false); setEditando(m); }}>
              <CelulaNome nome={m.nome} sub={m.descricao || ''} />
              <Num className="text-right">{m.clientes}</Num>
              <div className="text-right">
                <Num className="font-medium">{brl(m.preco_centavos)}</Num>
                <div className="text-[11px]" style={{ color: 'var(--adm-dado)' }}>por mês</div>
              </div>
              <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                <Botao altura={30} variante="perigo" onClick={() => remover(m)}>Remover</Botao>
              </div>
            </TabelaLinha>
          ))}
          <TabelaRodape total={lista.length} />
        </Tabela>
      )}

      {!consulta.isLoading && lista.length === 0 && !consulta.isError && (
        <p className="pt-4 text-center text-[12.5px]" style={{ color: 'var(--adm-dado)' }}>
          Nenhum módulo cadastrado. Ex.: NFC-e, PDV, WhatsApp oficial — cada um com o preço
          que você cobra por ele.
        </p>
      )}

      <PainelLateral
        aberto={criando || !!editando}
        titulo={editando ? editando.nome : 'Novo módulo'}
        subtitulo={editando ? `ligado em ${editando.clientes} cliente(s)` : 'Cobrança por cliente, por mês'}
        aoFechar={() => { setCriando(false); setEditando(null); }}
      >
        <FormModulo
          editando={editando}
          onFechar={() => { setCriando(false); setEditando(null); }}
          onSalvo={() => {
            setCriando(false); setEditando(null);
            qc.invalidateQueries({ queryKey: ['admin-modulos'] });
          }}
        />
      </PainelLateral>
    </>
  );
}

function FormModulo({ editando, onFechar, onSalvo }: {
  editando: Modulo | null; onFechar: () => void; onSalvo: () => void;
}) {
  const { mostrar } = useToast();
  const [form, setForm] = useState(editando
    ? { nome: editando.nome, descricao: editando.descricao || '', preco: (editando.preco_centavos / 100).toFixed(2).replace('.', ',') }
    : { nome: '', descricao: '', preco: '' });
  const [enviando, setEnviando] = useState(false);

  async function salvar() {
    setEnviando(true);
    try {
      if (editando) await api('PUT', `/api/admin/modulos/${editando.id}`, form);
      else await api('POST', '/api/admin/modulos', form);
      mostrar({ tipo: 'sucesso', titulo: editando ? 'Módulo atualizado.' : 'Módulo criado.' });
      onSalvo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  /*
   * O FORMULÁRIO É O CONTEÚDO DO PAINEL, não um card acima da lista.
   *
   * Aberto no topo, ele empurrava os módulos existentes para fora da tela —
   * justamente quando a pessoa quer comparar o preço novo com os que já
   * cobra. O header e o botão de fechar são do painel.
   */
  return (
    <>
      <Secao titulo="Dados">
        <LinhaRotulada rotulo="Nome" primeira>
          <Campo valor={form.nome} aoMudar={v => setForm(f => ({ ...f, nome: v }))} placeholder="Ex.: NFC-e" />
        </LinhaRotulada>
        <LinhaRotulada rotulo="Preço" apoio="Por cliente, por mês">
          <Campo valor={form.preco} aoMudar={v => setForm(f => ({ ...f, preco: v }))} placeholder="Ex.: 30,00" />
        </LinhaRotulada>
        <LinhaRotulada rotulo="Descrição" apoio="Opcional">
          <Campo valor={form.descricao} aoMudar={v => setForm(f => ({ ...f, descricao: v }))} />
        </LinhaRotulada>
      </Secao>

      {editando && (
        <p className="pb-4 text-[12.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
          Mudar o preço vale só para os próximos. Quem já tem o módulo mantém o valor
          combinado — senão a conta do mês passado deixaria de bater com o que foi cobrado.
        </p>
      )}

      <div className="flex gap-2">
        <Botao variante="primario" desabilitado={enviando} onClick={() => void salvar()}>
          {enviando ? 'Salvando…' : 'Salvar'}
        </Botao>
        <Botao onClick={onFechar}>Cancelar</Botao>
      </div>
    </>
  );
}
