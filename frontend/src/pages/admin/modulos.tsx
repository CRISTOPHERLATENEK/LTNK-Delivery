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
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Valores extras que somam na conta do revendedor. Ligue em cada cliente na aba Clientes.
        </p>
        <Button size="sm" onClick={() => { setEditando(null); setCriando(true); }}>
          <Plus className="size-4" /> Novo módulo
        </Button>
      </div>

      <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <b className="text-foreground">Isto é cobrança, não permissão.</b> Ligar um módulo não habilita o
        recurso no painel do lojista, e desligar não tira. O acesso continua sendo controlado por você.
      </p>

      {(criando || editando) && (
        <FormModulo
          editando={editando}
          onFechar={() => { setCriando(false); setEditando(null); }}
          onSalvo={() => {
            setCriando(false); setEditando(null);
            qc.invalidateQueries({ queryKey: ['admin-modulos'] });
          }}
        />
      )}

      {consulta.isLoading && <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>}
      {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

      {!consulta.isLoading && lista.length === 0 && !consulta.isError && (
        <Card><CardContent className="space-y-2 p-10 text-center text-muted-foreground">
          <Boxes className="mx-auto size-10 opacity-20" />
          <p className="font-medium">Nenhum módulo cadastrado</p>
          <p className="text-sm">Ex.: NFC-e, PDV, WhatsApp oficial — cada um com o preço que você cobra por ele.</p>
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {lista.map(m => (
          <Card key={m.id}>
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Boxes className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-semibold">{m.nome}</span>
                {m.descricao && <p className="text-xs text-muted-foreground">{m.descricao}</p>}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ligado em {m.clientes} cliente{m.clientes !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-lg font-extrabold tabular-nums">{brl(m.preco_centavos)}</div>
                <div className="text-[11px] text-muted-foreground">por cliente/mês</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setCriando(false); setEditando(m); }}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remover(m)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
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

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <Card className="border-primary/30">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold">{editando ? `Editar ${editando.nome}` : 'Novo módulo'}</h3>
          <Button variant="ghost" size="sm" onClick={onFechar}><X className="size-4" /></Button>
        </div>
        <form onSubmit={salvar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="m-nome">Nome</Label>
              <Input id="m-nome" required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex.: NFC-e" />
            </div>
            <div>
              <Label htmlFor="m-preco">Preço por cliente/mês</Label>
              <Input id="m-preco" inputMode="decimal" value={form.preco} onChange={e => setForm(f => ({ ...f, preco: e.target.value }))} placeholder="Ex.: 30,00" />
            </div>
          </div>
          <div>
            <Label htmlFor="m-desc">Descrição (opcional)</Label>
            <Input id="m-desc" value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} />
          </div>
          {editando && (
            <p className="text-xs text-muted-foreground">
              Mudar o preço vale só para os próximos. Quem já tem o módulo mantém o valor combinado —
              senão a conta do mês passado deixaria de bater com o que foi cobrado.
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar'}</Button>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
