# Logos das integrações

Dois arquivos são esperados aqui:

- `ifood.png`     — Portal do Parceiro iFood, seção de marca
- `whatsapp.png`  — about.meta.com/brand/resources/whatsapp

A extensão precisa bater com o conteúdo. Os primeiros arquivos chegaram como PNG
com nome `.svg`: o navegador renderiza assim mesmo, por adivinhação, mas o nome
mente e servidor que confia na extensão devolve o tipo errado.

Esta pasta é a FONTE (`frontend/public/`). A pasta `public/` da raiz é o
resultado do build — arquivo colocado só lá some no próximo `npm run build`.

**Não desenhe uma réplica do logo à mão.** São marcas registradas, e uma cópia
aproximada é pior que nenhuma: parece oficial de longe e está errada de perto —
inclusive para quem licencia o uso.

Enquanto o arquivo não existir, a tela cai sozinha num monograma cinza
(`LogoIntegracao` em `src/pages/lojista/integracoes-ui.tsx`). Nada quebra, e
nenhum logo falso é exibido.
