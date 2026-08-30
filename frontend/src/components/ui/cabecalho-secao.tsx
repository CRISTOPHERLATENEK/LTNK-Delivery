import { Ajuda } from '@/components/ui/ajuda';

/**
 * O CABEÇALHO DE UMA SEÇÃO DE CONFIGURAÇÕES.
 *
 * Existe porque as treze seções não estavam iguais: cinco não tinham título
 * nenhum (Dados, Horário, Entregadores, Impressão, Segurança) e as que tinham
 * usavam tamanhos e pesos diferentes — algumas com ícone, outras sem.
 *
 * O QUE DÓI É NO CELULAR. Ali a navegação é um `select`, e quem escolhe
 * "Impressão" caía numa tela que começava direto num cartão de impressora, sem
 * nada dizendo onde estava — o `select` sai da vista assim que a pessoa desce.
 *
 * O TÍTULO REPETE O ITEM DO MENU, de propósito. A tela de Dados já se chamou
 * "Loja" e a de Fiscal, "Emissão de NFC-e": clicar num nome e chegar noutro faz
 * a pessoa duvidar se clicou certo, e essa dúvida custa mais que a palavra
 * economizada.
 *
 * SEM LINHA DE DESCRIÇÃO. A primeira versão trazia uma frase explicando cada
 * seção; foram retiradas a pedido. Em tela de configuração o que a pessoa quer
 * é chegar no controle — texto que explica o óbvio empurra o controle para
 * baixo e é pulado de qualquer jeito.
 *
 * USA `h2` DE PROPÓSITO, e só serve para seção DENTRO das configurações.
 */
export function CabecalhoSecao({
  titulo,
  ajuda,
  icone,
  acao,
}: {
  titulo: string;
  /** Chave do verbete de ajuda, quando existe um para esta seção. */
  ajuda?: string;
  /** Ícone à esquerda do título. */
  icone?: React.ReactNode;
  /** Botão ou indicador à direita, quando a seção tem uma ação principal. */
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex min-w-0 items-center gap-2">
        {icone}
        <span className="inline-flex items-baseline gap-1.5">
          <h2 className="truncate text-lg font-bold">{titulo}</h2>
          {ajuda && <Ajuda chave={ajuda} />}
        </span>
      </span>
      {acao && <div className="flex shrink-0 items-center gap-2">{acao}</div>}
    </div>
  );
}
