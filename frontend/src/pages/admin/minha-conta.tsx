/**
 * Minha conta — o que é SEU, separado de administrar os outros.
 *
 * "Trocar minha senha" e "Resetar meu 2FA" moravam dentro de Admins, no meio da
 * lista de gerenciar terceiros. São coisas diferentes: uma é a sua credencial,
 * a outra é permissão de gente. Misturadas, o admin procurava a própria conta
 * numa tela de administrar os outros — e corria o risco de mexer na conta
 * errada por estar tudo junto.
 */
import { useState } from 'react';
import { AdminLayout } from './layout';
import { Cabecalho, Secao, LinhaRotulada, Campo, Botao } from './ui';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, sessaoUsuario, ehSuperAdmin } from '@/lib/api';

export function TelaMinhaConta() {
  const { mostrar } = useToast();
  const u = sessaoUsuario();
  const superAdmin = ehSuperAdmin();

  const [formSenha, setFormSenha] = useState({ senha_atual: '', senha_nova: '', senha_confirma: '' });
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [senhaReset2fa, setSenhaReset2fa] = useState('');
  const [resetando2fa, setResetando2fa] = useState(false);

  async function trocarMinhaSenha() {
    if (formSenha.senha_nova !== formSenha.senha_confirma) {
      mostrar({ tipo: 'erro', titulo: 'As senhas novas não coincidem.' });
      return;
    }
    setTrocandoSenha(true);
    try {
      await api('PUT', '/api/admin/minha-senha', {
        senha_atual: formSenha.senha_atual,
        senha_nova: formSenha.senha_nova,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Senha alterada.' });
      setFormSenha({ senha_atual: '', senha_nova: '', senha_confirma: '' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setTrocandoSenha(false);
    }
  }

  async function resetar2fa() {
    setResetando2fa(true);
    try {
      await api('POST', '/api/admin/2fa/resetar', { senha: senhaReset2fa });
      mostrar({
        tipo: 'sucesso',
        titulo: '2FA resetado.',
        descricao: 'No próximo login você configura o autenticador de novo.',
      });
      setSenhaReset2fa('');
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setResetando2fa(false);
    }
  }

  return (
    <AdminLayout titulo="Minha conta">
      {/* 620px: linha de leitura de formulário. Mais largo, o olho perde o
          começo da linha seguinte entre um campo e outro. */}
      <div className="mx-auto max-w-[620px]">
        <Cabecalho
          titulo="Minha conta"
          subtitulo={`${u?.email ?? ''} · ${superAdmin ? 'super admin' : 'operacional'}`}
        />

        <Secao titulo="Trocar minha senha">
          <LinhaRotulada rotulo="Senha atual" primeira>
            <Campo tipo="password" valor={formSenha.senha_atual}
              aoMudar={v => setFormSenha(f => ({ ...f, senha_atual: v }))} />
          </LinhaRotulada>
          <LinhaRotulada rotulo="Nova senha" apoio="Mínimo 6 caracteres">
            <Campo tipo="password" valor={formSenha.senha_nova}
              aoMudar={v => setFormSenha(f => ({ ...f, senha_nova: v }))} />
          </LinhaRotulada>
          <LinhaRotulada rotulo="Confirmar" apoio="Digite a nova senha de novo">
            <Campo tipo="password" valor={formSenha.senha_confirma}
              aoMudar={v => setFormSenha(f => ({ ...f, senha_confirma: v }))} />
          </LinhaRotulada>
          <LinhaRotulada rotulo="">
            <Botao
              variante="primario"
              desabilitado={trocandoSenha || !formSenha.senha_atual || formSenha.senha_nova.length < 6}
              onClick={() => void trocarMinhaSenha()}
            >
              {trocandoSenha ? 'Salvando…' : 'Trocar senha'}
            </Botao>
          </LinhaRotulada>
        </Secao>

        <Secao titulo="Resetar meu 2FA">
          {/*
            A CONSEQUÊNCIA ANTES DO CAMPO.
            Quem chega aqui perdeu o celular e está com pressa — ler depois de
            preencher é ler depois de decidir.
          */}
          <p className="px-3 pt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--adm-fg2)' }}>
            Perdeu o celular ou trocou de aparelho? Isto apaga o app autenticador atual
            e os códigos de backup — no próximo login você configura um novo, do zero.
            O 2FA continua obrigatório.
          </p>
          <LinhaRotulada rotulo="Sua senha" apoio="Confirmação">
            <Campo tipo="password" valor={senhaReset2fa} aoMudar={setSenhaReset2fa} />
          </LinhaRotulada>
          <LinhaRotulada rotulo="">
            {/* `perigo` e não `primario`: apagar o autenticador é o tipo de
                ação que não deveria parecer o caminho normal da tela. */}
            <Botao variante="perigo" desabilitado={resetando2fa || !senhaReset2fa}
              onClick={() => void resetar2fa()}>
              {resetando2fa ? 'Resetando…' : 'Resetar 2FA'}
            </Botao>
          </LinhaRotulada>
        </Secao>
      </div>
    </AdminLayout>
  );
}
