/**
 * Gestão de admins — apenas o super admin acessa.
 * Cria/remove admins operacionais (que NÃO podem editar marca/comissão).
 *
 * "Trocar minha senha" e "Resetar meu 2FA" NÃO moram aqui: foram para
 * /painel-admin/minha-conta. Esta tela é sobre administrar OUTRAS pessoas, e
 * juntar as duas coisas convidava a mexer na conta errada.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from './layout';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError, sessaoUsuario } from '@/lib/api';
import { dataLocal } from '@/lib/format';
import {
  Cabecalho, Tabela, TabelaCabecalho, TabelaLinha, TabelaRodape, CelulaNome,
  Num, Status, Botao, PainelLateral, LinhaRotulada, Campo, Secao,
} from './ui';

interface Admin {
  id: number;
  nome: string;
  email: string;
  telefone: string;
  super_admin: 0 | 1;
  bloqueado: 0 | 1;
  criado_em: string;
}

export function TelaAdmins() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const eu = sessaoUsuario();

  const consulta = useQuery({
    queryKey: ['admins'],
    queryFn: () => api<{ admins: Admin[] }>('GET', '/api/admin/admins').then(r => r.admins),
  });

  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState({ nome: '', email: '', telefone: '', senha: '' });
  const [enviando, setEnviando] = useState(false);
  const [alvoPromocao, setAlvoPromocao] = useState<{ admin: Admin; acao: 'promover' | 'rebaixar' } | null>(null);
  const [senhaPromocao, setSenhaPromocao] = useState('');
  const [enviandoPromocao, setEnviandoPromocao] = useState(false);

  async function criar() {
    if (!form.nome || !form.email || form.senha.length < 6) {
      mostrar({ tipo: 'erro', titulo: 'Preencha nome, e-mail e uma senha de ao menos 6 caracteres.' });
      return;
    }
    setEnviando(true);
    try {
      await api('POST', '/api/admin/admins', form);
      mostrar({ tipo: 'sucesso', titulo: 'Admin operacional criado', descricao: `${form.nome} já pode entrar.` });
      setForm({ nome: '', email: '', telefone: '', senha: '' });
      setCriando(false);
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function remover(admin: Admin) {
    if (!(await confirmar({
      titulo: `Remover ${admin.nome}?`,
      descricao: 'Ele perderá o acesso imediatamente.',
      confirmar: 'Remover',
      destrutivo: true,
    }))) return;
    try {
      await api('DELETE', `/api/admin/admins/${admin.id}`);
      mostrar({ tipo: 'info', titulo: 'Admin removido.' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function confirmarPromocao() {
    if (!alvoPromocao) return;
    setEnviandoPromocao(true);
    try {
      await api('POST', `/api/admin/admins/${alvoPromocao.admin.id}/${alvoPromocao.acao}`, { senha: senhaPromocao });
      mostrar({
        tipo: 'sucesso',
        titulo: alvoPromocao.acao === 'promover' ? 'Promovido a super admin' : 'Rebaixado a admin operacional',
        descricao: alvoPromocao.admin.nome,
      });
      setAlvoPromocao(null);
      setSenhaPromocao('');
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviandoPromocao(false);
    }
  }

  const admins = consulta.data ?? [];
  const supers = admins.filter(a => a.super_admin).length;

  return (
    <AdminLayout titulo="Admins">
      <div className="mx-auto max-w-3xl">
        <Cabecalho
          titulo="Admins"
          subtitulo={
            consulta.isLoading ? 'Carregando…' : (
              <>
                {admins.length} {admins.length === 1 ? 'admin' : 'admins'} · {supers} super
                {' · '}operacionais aprovam lojas e veem pedidos, mas não mexem na marca nem na comissão
              </>
            )
          }
          acoes={<Botao variante="primario" onClick={() => setCriando(true)}>Novo admin</Botao>}
        />

        {consulta.isLoading ? (
          <Skeleton className="h-56" />
        ) : (
          <Tabela colunas="minmax(0,1.5fr) 130px 120px 150px">
            <TabelaCabecalho>
              <span>Nome</span>
              <span>Desde</span>
              <span>Papel</span>
              <span />
            </TabelaCabecalho>
            {admins.map((a, i) => (
              <TabelaLinha key={a.id} primeira={i === 0}>
                <CelulaNome
                  nome={
                    <>
                      {a.nome}
                      {a.id === eu?.id && (
                        <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--adm-rotulo)' }}>
                          você
                        </span>
                      )}
                    </>
                  }
                  sub={a.email}
                />
                <Num className="text-[12px]">{dataLocal(a.criado_em)}</Num>
                <Status tom={a.bloqueado ? 'erro' : a.super_admin ? 'atencao' : 'neutro'}>
                  {a.bloqueado ? 'Bloqueado' : a.super_admin ? 'Super' : 'Operacional'}
                </Status>
                {/* Ninguém age sobre a própria conta aqui: rebaixar a si mesmo
                    ou se remover são os dois jeitos de perder o acesso sem
                    ninguém para devolver. */}
                <div className="flex items-center justify-end gap-1.5">
                  {a.id !== eu?.id && (
                    <>
                      <Botao
                        altura={30}
                        onClick={() => setAlvoPromocao({ admin: a, acao: a.super_admin ? 'rebaixar' : 'promover' })}
                      >
                        {a.super_admin ? 'Rebaixar' : 'Promover'}
                      </Botao>
                      {!a.super_admin && (
                        <Botao altura={30} variante="perigo" onClick={() => void remover(a)}>Remover</Botao>
                      )}
                    </>
                  )}
                </div>
              </TabelaLinha>
            ))}
            <TabelaRodape total={admins.length} />
          </Tabela>
        )}

        <p className="pt-3 text-[12px] leading-relaxed" style={{ color: 'var(--adm-rotulo)' }}>
          Super admins têm acesso total: marca, comissão, financeiro, outros admins e clientes.
          Promover ou rebaixar exige sua senha como segunda confirmação, e o último super admin
          não pode ser rebaixado.
        </p>
      </div>

      {/* ── Novo admin ── */}
      <PainelLateral
        aberto={criando}
        titulo="Novo admin operacional"
        subtitulo="Aprova lojas e vê pedidos. Não mexe em marca nem comissão."
        aoFechar={() => setCriando(false)}
        rodape={
          <>
            <Botao altura={30} onClick={() => setCriando(false)} desabilitado={enviando}>Cancelar</Botao>
            <Botao altura={30} variante="primario" onClick={() => void criar()} desabilitado={enviando}>
              {enviando ? 'Criando…' : 'Criar'}
            </Botao>
          </>
        }
      >
        <Secao titulo="Dados">
          <LinhaRotulada rotulo="Nome" primeira>
            <Campo valor={form.nome} aoMudar={v => setForm(f => ({ ...f, nome: v }))} />
          </LinhaRotulada>
          <LinhaRotulada rotulo="E-mail">
            <Campo tipo="email" valor={form.email} aoMudar={v => setForm(f => ({ ...f, email: v }))} />
          </LinhaRotulada>
          <LinhaRotulada rotulo="Telefone" apoio="Opcional">
            <Campo tipo="tel" valor={form.telefone} aoMudar={v => setForm(f => ({ ...f, telefone: v }))} />
          </LinhaRotulada>
          <LinhaRotulada rotulo="Senha inicial" apoio="Mínimo 6 caracteres">
            <Campo tipo="password" valor={form.senha} aoMudar={v => setForm(f => ({ ...f, senha: v }))} />
          </LinhaRotulada>
        </Secao>
      </PainelLateral>

      {/* ── Promover / rebaixar ── */}
      <PainelLateral
        aberto={!!alvoPromocao}
        titulo={alvoPromocao?.acao === 'promover' ? 'Promover a super admin' : 'Rebaixar super admin'}
        subtitulo={alvoPromocao?.admin.nome}
        aoFechar={() => { if (!enviandoPromocao) { setAlvoPromocao(null); setSenhaPromocao(''); } }}
        rodape={
          <>
            <Botao altura={30} onClick={() => setAlvoPromocao(null)} desabilitado={enviandoPromocao}>Cancelar</Botao>
            <Botao
              altura={30}
              variante="primario"
              onClick={() => void confirmarPromocao()}
              desabilitado={enviandoPromocao || !senhaPromocao}
            >
              {enviandoPromocao ? 'Confirmando…' : 'Confirmar'}
            </Botao>
          </>
        }
      >
        <p className="pb-4 text-[13px]" style={{ color: 'var(--adm-fg2)' }}>
          {alvoPromocao?.acao === 'promover'
            ? 'Ele passará a ter acesso total à plataforma: marca, comissão, financeiro e outros admins.'
            : 'Ele perderá o acesso total e volta a ser admin operacional.'}
        </p>
        <Secao titulo="Confirmação">
          <LinhaRotulada rotulo="Sua senha" apoio="Segunda confirmação" primeira>
            <input
              type="password"
              autoFocus
              value={senhaPromocao}
              onChange={e => setSenhaPromocao(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void confirmarPromocao(); }}
              className="h-[34px] w-full px-2.5 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }}
            />
          </LinhaRotulada>
        </Secao>
      </PainelLateral>
    </AdminLayout>
  );
}
