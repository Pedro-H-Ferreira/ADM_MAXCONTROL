# Catalogo de produtos e servicos do Fluig

## Origem dos dados

O catalogo ADM e alimentado pelas solicitacoes do modulo `compras` persistidas em
`fluig_requests`. O identificador pai e `fluig_request_id` e os itens ficam em
`raw_payload.formFields` com o sufixo Fluig `___N`.

| Etapa | Tabela Fluig | Descricao | Especificacao | Quantidade | Unidade | Preco |
| --- | --- | --- | --- | --- | --- | --- |
| Pedido | `solTabelaProdutos` | `solProdutoServico___N` | `SolEspecTecnica___N` | `solQtdProduto___N` | `solUnMedidaProduto___N` | nao disponivel |
| Cotacao | `tabelaProdutos` | `ItemSelect___N` | `especTecnica___N` | `qtdProduto___N` | `unMedidaProduto___N` | `valorProduto___N` |

A linha do pedido e a origem principal. A linha da cotacao complementa preco,
quantidade e especificacao quando a sequencia `numProduto___N` corresponde a
`solnumProdutoPedido___N`. A cotacao nao substitui a descricao solicitada e nao
gera um segundo produto para a mesma linha.

## Identidade e deduplicacao

Sao usadas duas identidades diferentes:

- A ocorrencia Fluig e unica por solicitacao, tabela logica e indice filho. Isso
  torna a sincronizacao idempotente mesmo quando o historico e consultado de novo.
- O item de catalogo usa tipo, nome canonico e detalhes distintivos como modelo,
  medida, voltagem ou apresentacao. Quantidade, preco, filial e numero da
  solicitacao sao evidencias da ocorrencia e nao fazem parte da identidade global.

Descricoes especificas podem convergir depois de normalizar caixa, acentos,
espacos e numeracao inicial. Descricoes genericas como `DESCRICAO ACIMA`,
`NA DESCRICAO`, `EM ANEXO`, `PEDIDO EM ANEXO`, `TESTE`, `EPI` ou `MANUTENCAO`
sem especificacao suficiente nunca sao mescladas globalmente. Elas permanecem
isoladas e pendentes de revisao.

## Classificacao

O formulario Fluig nao possui um campo confiavel que diferencie produto de
servico. A classificacao ADM usa os valores:

- `MATERIAL`
- `SERVICO`
- `MISTO`
- `INDEFINIDO`

A classificacao registra confianca e necessidade de revisao. Termos claros como
`conserto`, `reforma`, `locacao`, `frete`, `instalacao` e `manutencao` indicam
servico. Modelo, medida, voltagem, embalagem e unidade fisica ajudam a identificar
material. Quando sinais de ambos aparecem, o item fica como `MISTO`.

## Categorias e filiais

No historico de compras, a categoria financeira vem de:

- codigo: `contaCentroCusto`
- descricao: `codContaFin`

`centroCusto` identifica a area consumidora e nao deve ser tratado como categoria
do produto. A categoria sugerida pode ser revisada no ADM.

O produto e global para evitar duplicidade, mas cada ocorrencia guarda filial,
solicitacao Fluig, quantidade, unidade e preco. Administradores consultam o
catalogo completo; demais usuarios recebem somente itens com ocorrencias ou
vinculos nas filiais liberadas no perfil.

## Fotos e links

Fotos ficam no bucket privado `product-images` e sao entregues por URL assinada.
Uploads aceitam apenas JPG, PNG ou WebP e passam pela API server-side. O link
externo do produto e separado do numero e do vinculo da solicitacao Fluig.
