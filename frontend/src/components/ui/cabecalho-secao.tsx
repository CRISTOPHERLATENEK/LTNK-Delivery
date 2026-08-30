import { Ajuda } from '@/components/ui/ajuda';

/**
 * O CABEÇALHO DE UMA SEÇÃO DE CONFIGURAÇÕES.
 *
 * Existe porque as treze seções não estavam iguais: cinco não tinham título
 * nenhum (Loja, Horário, Entregadores, Impressão, Segurança) e as que tinham
 * usavam três tipografias diferentes e dois níveis de cabeçalho — `h1` em
 * algumas, `h2` em outras, dentro da MESMA página.
 *
 * O QUE DÓI É NO CELULAR. Ali a navegação é um `select`, e quem escolhe
 * "Impressão" cai numa tela que começa direto num cartão de impressora, sem
 * nada dizendo onde ele está — o `select` sai da vista assim que a pessoa
 * desce. Voltar para conferir custa um gesto que ninguém deveria precisar
 * fazer.
 *
 * A linha de descrição não é enfeite: "Segurança" não diz se ali se troca senha
 * ou se configura quem entra. Uma frase resolve, e é mais barato que o lojista
 * abrir a seção para descobrir.
 *
 * USA `h2` DE PROPÓSITO, e só serve para seção DENTRO das configurações.
 * `VisualLoja` e `LojaConfiguracao` também são páginas próprias (`/personalizacao`,
 * `/loja`), e ali o `h1` delas está certo — a diferença de nível entre elas e
 * estas não é descuido, é contexto.
 */
export function CabecalhoSecao({
  titulo,
  children,
  ajuda,
  acao,
}: {
  titulo: string;
  /** Uma frase dizendo para que serve. Não repetir o título com outras palavras. */
  children: React.ReactNode;
  /** Chave do verbete de ajuda, quando existe um para esta seção. */
  ajuda?: string;
  /** Botão à direita, quando a seção tem uma ação principal. */
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="inline-flex items-baseline gap-1.5">
          <h2 className="text-lg font-bold">{titulo}</h2>
          {ajuda && <Ajuda chave={ajuda} />}
        </span>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  );
}
