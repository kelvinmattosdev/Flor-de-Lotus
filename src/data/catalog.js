// Photographs supplied by the user for local testing; provenance/publication rights unverified.
// Prices and fulfilment states below are demonstration data, never an actual stock offer.
const photo = (name, group, width, height, widths, ext = 'jpg') => ({
  src: `/images/${group}/${name}-${width}.${ext}`,
  width, height,
  srcset: widths.map(w => `/images/${group}/${name}-${w}.${ext} ${w}w`).join(', '),
  thumb: `/images/${group}/${name}-${widths[0]}.${ext}`
});
const craft = (name, w, h, widths) => photo(name, 'artesanato', w, h, widths);
const book = (name, w, h, ext = 'jpg') => photo(name, 'sebo', w, h, [160, w], ext);
const frame = (label, photo, alt) => ({ label, ...photo, alt });
export const products = [
  {
    id: 'FDL-CRAFT-MORANGO', name: 'Brincos de morango', family: 'artesanato', category: 'brincos',
    price: 2990, mode: 'ready', variants: [],
    detail: 'Um par · morangos vermelhos',
    description: 'Par de brincos com pequenos morangos e ganchos em tom prateado. A foto mostra a peça de referência; preço e pronta entrega são apenas exemplos para testar a sacola.',
    gallery: [frame('Peça', craft('brincos-morango', 395, 442, [160, 320, 395]), 'Par de brincos de morango vermelho com folhas verdes e ganchos prateados.')]
  },
  {
    id: 'FDL-CRAFT-ARAME', name: 'Argola de arame', family: 'artesanato', category: 'brincos',
    price: 3490, mode: 'ready', variants: [],
    detail: 'Desenho de arame farpado',
    description: 'Argola em tom prateado com desenho inspirado em arame farpado. A imagem de uso mostra o acessório; outros adornos e objetos não estão incluídos na demonstração.',
    gallery: [frame('Em uso', craft('argola-arame', 288, 410, [160, 288]), 'Argola prateada com detalhes de arame farpado, fotografada em uma orelha.')]
  },
  {
    id: 'FDL-CRAFT-MORCEGO', name: 'Colar de morcego', family: 'artesanato', category: 'colares',
    price: 5990, mode: 'ready', variants: [],
    detail: 'Miçangas · pingente de morcego',
    description: 'Miçangas em rosa e roxo, morcegos em tom prateado e uma ponta alongada. Veja o colar completo na foto, do fecho ao pingente. Materiais e medidas comerciais ainda não foram confirmados.',
    gallery: [frame('Peça', craft('colar-morcego', 475, 1090, [160, 320, 475]), 'Colar inteiro de miçangas rosas e roxas, com fecho, morcegos e pingente pontudo.')]
  },
  {
    id: 'FDL-CRAFT-CRUCIFIXO', name: 'Colar de crucifixo', family: 'artesanato', category: 'colares',
    price: 4990, mode: 'ready', variants: [],
    detail: 'Contas pretas · correntes',
    description: 'Contas pretas e correntes em tom prateado com um crucifixo central. Fotografia de referência, orientada com o busto acima e o pingente abaixo; nenhuma medida ou composição de metal é presumida.',
    gallery: [frame('Peça', craft('colar-crucifixo', 450, 515, [160, 320, 450]), 'Colar com contas pretas, correntes prateadas e crucifixo, em um busto na posição vertical.')]
  },
  {
    id: 'FDL-CRAFT-BUBU', name: 'Chaveiro Bubu', family: 'artesanato', category: 'chaveiros',
    price: null, mode: 'custom', variants: [],
    detail: 'Biscuit · proposta sob encomenda',
    description: 'Chaveiro com maçã em biscuit, miçangas e fecho de coração. Exemplo para conversar sobre uma peça personalizada; não tem orçamento ou contratação nesta demonstração.',
    gallery: [frame('Peça', craft('chaveiro-bubu', 227, 348, [160, 227]), 'Chaveiro com maçã em biscuit, miçangas Bubu e fecho branco de coração.')]
  },
  {
    id: 'FDL-CRAFT-PIPO', name: 'Chaveiro Pipo', family: 'artesanato', category: 'chaveiros',
    price: null, mode: 'custom', variants: [],
    detail: 'Biscuit · proposta sob encomenda',
    description: 'Um passarinho cinza em biscuit, miçangas claras e fecho de coração. Esta referência apresenta a proposta sob encomenda, sem envio de dados, mensagens ou compra real.',
    gallery: [frame('Peça', craft('chaveiro-pipo', 207, 349, [160, 207]), 'Chaveiro de passarinho cinza em biscuit com miçangas Pipo e fecho de coração.')]
  },
  {
    id: 'FDL-CRAFT-BOLSA-GOTICA', name: 'Bolsa gótica', family: 'artesanato', category: 'bolsas',
    price: 6990, mode: 'ready', variants: [],
    detail: 'Preto · correntes e crucifixo',
    description: 'Bolsa preta com correntes e detalhe de crucifixo. O enquadramento original não mostra toda a alça; nenhuma parte foi reconstruída. Os objetos ao fundo não integram o item demonstrativo.',
    gallery: [frame('Detalhe disponível', craft('bolsa-gotica', 282, 280, [160, 282]), 'Bolsa preta com crucifixo e correntes; a alça está parcialmente fora do enquadramento original.')]
  },
  {
    id: 'FDL-CRAFT-BOLSA-COQUETTE', name: 'Bolsa dark coquette', family: 'artesanato', category: 'bolsas',
    price: 7490, mode: 'ready', variants: [],
    detail: 'Rosa e preto · correntes delicadas',
    description: 'Bolsa rosa com bordas pretas, laços e correntes delicadas. A alça aparece parcialmente na referência disponível, sem reconstrução. Preço e pronta entrega são exemplos, não uma oferta comercial.',
    gallery: [frame('Detalhe disponível', craft('bolsa-coquette', 323, 247, [160, 323]), 'Bolsa rosa e preta com correntes e laços; alça parcialmente fora do enquadramento.')]
  },
  {
    id: 'FDL-SEBO-CONTOS', name: 'Contos Macabros', family: 'sebo', category: 'livros',
    price: 2790, mode: 'ready', variants: [],
    detail: 'Kanako Inuki · mangá',
    description: 'Livro do sebo apresentado pelas fotos de capa e contracapa fornecidas. Estado de conservação, edição e disponibilidade atuais não foram verificados. O preço desta página é somente demonstrativo.',
    gallery: [
      frame('Frente', book('contos-frente', 262, 355), 'Capa rosa do mangá Contos Macabros, de Kanako Inuki.'),
      frame('Verso', book('contos-verso-clean', 239, 337, 'png'), 'Contracapa rosa de Contos Macabros.')
    ]
  },
  {
    id: 'FDL-SEBO-MELTING', name: 'The Melting Classroom', family: 'sebo', category: 'livros',
    price: 2490, mode: 'ready', variants: [],
    detail: 'Junji Ito · mangá',
    description: 'The Melting Classroom, de Junji Ito, com frente e verso da referência recebida. A foto não permite confirmar capa adicional, edição ou conservação atual; nenhuma dessas condições é prometida nesta simulação.',
    gallery: [
      frame('Frente', book('melting-frente', 240, 355), 'Capa preta de The Melting Classroom, de Junji Ito.'),
      frame('Verso', book('melting-verso', 236, 334), 'Verso preto do livro The Melting Classroom.')
    ]
  },
  {
    id: 'FDL-SEBO-SAKURA-08', name: 'Sakura CardCaptor · vol. 8', family: 'sebo', category: 'livros',
    price: 1890, mode: 'ready', variants: [],
    detail: 'Mangá · volume 8',
    description: 'Volume 8 de Sakura CardCaptor, conforme a capa fotografada. A inclinação do livro foi preservada. Edição, conservação e disponibilidade comercial dependem de confirmação; aqui a compra é fictícia.',
    gallery: [frame('Frente', book('sakura-frente-clean', 232, 320, 'png'), 'Capa rosa e branca do mangá Sakura CardCaptor volume 8, levemente inclinada.')]
  },
  {
    id: 'FDL-SEBO-BIBLIOTECA', name: 'A Biblioteca da Meia-Noite', family: 'sebo', category: 'livros',
    price: 3290, mode: 'ready', variants: [],
    detail: 'Matt Haig · romance',
    description: 'A Biblioteca da Meia-Noite, de Matt Haig, com capa e contracapa da referência. O sebo reúne livros e discos; este é um exemplo de livro, sem afirmação de estoque ou conservação atual.',
    gallery: [
      frame('Frente', book('biblioteca-frente', 236, 318), 'Capa verde e preta de A Biblioteca da Meia-Noite, de Matt Haig.'),
      frame('Verso', book('biblioteca-verso', 241, 321), 'Contracapa verde e preta de A Biblioteca da Meia-Noite.')
    ]
  }
];
export const findProduct = id => products.find(product => product.id === id);
// Additional views from supplied references. Closeups are explicitly the same photograph.
products[0].gallery.push(frame('Em uso', craft('morango-uso-inteiro-003',620,995,[160,320,620]), 'Brinco de morango pendente em uso; outros adornos na orelha não integram o par.'));
products[2].gallery.push(frame('Detalhe',craft('morcego-detalhe-003',210,190,[120,210]),'Detalhe do pingente de morcego, recortado da mesma fotografia.'));
products[3].gallery.push(frame('Detalhe',craft('crucifixo-detalhe-003',180,250,[120,180]),'Detalhe do crucifixo: recorte da mesma fotografia antes de girar 90 graus anti-horário.'));
products[4].gallery.push(frame('Detalhe',craft('bubu-detalhe-003',145,130,[120,145]),'Detalhe da maçã em biscuit, recortado da mesma fotografia do chaveiro Bubu.'));
// Explicitly fictitious offer/review fixtures, not previous commercial prices or real clients.
const comparePrices = [3990,4490,7990,6490,null,null,8990,9990,3490,3290,2490,4290];
products.forEach((product,index) => {
  product.compareAtPrice = comparePrices[index];
  product.reviews = [
    {demo:true,author:'Perfil de exemplo 01',rating:5,text:`Comentário fictício: a apresentação de ${product.name.toLowerCase()} ajuda a observar os detalhes da referência.`},
    {demo:true,author:'Perfil de exemplo 02',rating:4,text:product.family==='sebo'?'Comentário fictício: a descrição deixa claro que a conservação do exemplar precisa ser confirmada.':'Comentário fictício: gostei da combinação de detalhes apresentada. Este texto ilustra uma avaliação, não uma compra real.'}
  ];
});
export const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const matchesFilter = (product, filter) => filter === 'all' || product.family === filter || product.category === filter;
export const shippingOptions = [
  { id: 'correios', name: 'Correios', price: 1890, days: '6–9 dias úteis' },
  { id: 'sedex', name: 'Sedex', price: 3290, days: '2–4 dias úteis' },
  { id: 'jadlog', name: 'Jadlog', price: 2190, days: '4–7 dias úteis' },
  { id: 'loggi', name: 'Loggi', price: 2490, days: '3–5 dias úteis' }
];
