# Flor de Lotus — demonstração

Protótipo de **artesanato, acessórios autorais e sebo de livros e discos**, com detalhes discretos inspirados em Nana no desktop e três artes da marca fornecidas pelo usuário. O catálogo inicial tem **12 exemplos: 8 de artesanato + 4 livros**, sem disco inventado; o painel permite acrescentar anúncios demonstrativos. Dez exemplos permitem compra simulada; Bubu e Pipo são encomendas apenas informativas, sem preço fechado ou contratação.

**U25/010: demonstração com backend Node e SQLite local**, login separado do apelido editável, nome de teste no checkout, catálogo, cupons, compras/pedidos persistentes e painel de operador separado. **Compra, Pix/cartão, frete e entrega continuam fictícios**: sem cobrança, email, transportadora ou dados pessoais/cartão reais nos testes. Use nomes fictícios e não reutilize senhas reais. O CEP demonstrativo não é enviado à API nem guardado.

**Os ajustes de conta, checkout e foco estão prontos na versão local**, nos recortes verificados em Windows: revisão independente com **115/115 testes, 7 grupos HTTP e 8 grupos Chrome**, sem bloqueante confirmado. Contas e pedidos legados foram verificados em fixtures separadas; **seu banco não foi migrado pelos testes**. Antes de iniciar com dados existentes, siga o [backup offline](#antes-de-atualizar-um-banco-existente). Isso não é aceite de produção, publicação ou operação comercial.

Os aceites APP137 e INFRA008 são históricos: o segundo cobria arquivos **estáticos/NGINX**, não este runtime Node/API. Houve provas locais em Windows; **Docker/Linux/Swarm/Registry/TLS/produção não foram executados ou aprovados**. Nenhum push ou deploy foi realizado.

## Explorar a demonstração

- Clique em um produto: ele tem página própria em `produto.html?id=<ID>`, com acesso direto, recarregamento e histórico do navegador. Exemplo, depois de iniciar na porta padrão: `http://127.0.0.1:5173/produto.html?id=FDL-CRAFT-MORANGO`. Catálogo e filtros consultam a API, inclusive anúncios/categorias novos; não é marketplace multivendedor.
- Galeria, descrição e relacionados usam fotos existentes. Quando não há outra foto real, a página mantém foto única; aproximações são identificadas como detalhes da mesma fotografia, não ângulos inventados.
- **Preços de/por, descontos, avaliações e frete são fictícios.** As avaliações são genéricas e rotuladas individualmente, não relatos de clientes reais. Bubu/Pipo continuam encomendas apenas informativas, sem preço fechado ou compra.
- Nos dez exemplos compráveis, use quantidade inteira de 1 a 9. Comprar soma à sacola e abre o checkout de todos os itens. Cancelar/erro preserva os itens. Uma confirmação válida pode esvaziar a sacola; **se outra aba a modificar durante o envio, a sacola inteira é preservada**, com aviso para revisão, inclusive itens que talvez já tenham sido comprados.
- Para testar o frete no PDP, use **CEP demonstrativo `00000-000`**, nunca dados reais. Valida-se só o formato, não endereço/existência. Correios/Sedex/Jadlog/Loggi são opções fictícias; a prévia final é calculada no servidor, **sem transmitir ou persistir o CEP** e sem consultar logística externa.
- Animações autorais em CSS/JavaScript/WAAPI preservam a escolha anterior **Completas/Full já consentida pelo usuário**. Perfis novos em Auto respeitam o movimento reduzido do sistema; Reduzidas continua imediato. **O controle do topo foi removido a pedido do usuário**: não há botão de movimento para clicar. Não altere o sistema operacional para reproduzir a preferência do site.
- A navegação entre seções da home e de PDP→home foi aprovada no 137: em Full, rolagem progressiva e foco estável no título do destino; em Auto/Reduced efetivo, chegada imediata. Histórico, interrupções e fallback nativo foram conferidos nos limites da QA. Não é promessa de animação em todo tipo de alteração manual do fragmento.
- As funções continuam utilizáveis sem as APIs de animação. Frontend Vite/JavaScript vanilla; **Sharp é uma dependência do servidor para validar/reencodar imagens**, não uma biblioteca visual nem um módulo a importar no navegador.

## Antes de atualizar um banco existente

**Se você já usa um banco e quer preservar seus dados, faça isto antes de iniciar a versão nova ou executar o bootstrap.** Uma instalação nova, sem dados anteriores, pode seguir para [Iniciar](#iniciar-no-windows--powershell).

1. **Localize o diretório efetivo antigo.** Use o caminho que apareceu depois de **“Dados privados:”** no terminal da instância anterior, ou confira seu setup antigo e o `FDL_DATA_DIR` usado por ele. **Se não sabe o caminho, não execute a versão nova só para descobri-lo:** ela pode migrar o banco ao abrir. Não reconstrua o hash do nome da pasta por conta própria; peça ajuda para localizar a configuração, sem enviar banco ou senhas.
2. **Pare somente o seu processo**, no terminal em que o iniciou, e aguarde o encerramento e a liberação do banco. Não mate serviços alheios nem copie um banco ainda em uso.
3. Faça um **backup offline consistente do diretório privado completo**, incluindo banco, journal e demais arquivos que pertençam a ele. Destino: local dedicado e privado, **fora do projeto, do volume da aplicação e de áreas públicas/servidas**. Copie, não recorte/mova, não apague nem edite os originais; não copie só o arquivo SQLite ou reutilize pastas de QA.
4. Preserve essa cópia sem abrir a aplicação contra ela. Recomenda-se validar uma **restauração em outra pasta/fixture isolada**, com proteção e versão compatíveis, nunca por cima dos dados ativos. **Nenhum backup ou restauração do seu banco foi feito ou validado por esta entrega.**
5. Com o backup protegido, inicie a nova versão com **exatamente o mesmo `FDL_DATA_DIR` efetivo**. A abertura realiza a migração **SQLite V1→V2 automaticamente, de forma aditiva e transacional**, sem resetar contas, logins, senhas ou pedidos existentes.
6. **O binário anterior recusa o esquema V2.** Voltar ao backup pré-migração não inclui as gravações posteriores; não é rollback sem perda. Não apague banco, lock ou marcadores, nem troque o diretório para contornar um erro.

**Se já há operador, não execute o bootstrap novamente.** Seu login e sua senha continuam válidos; contas de cliente antigas podem cadastrar o apelido em Minha conta. Pedidos antigos sem nome completo mostram **“Não informado”**.

## Iniciar no Windows / PowerShell

Requisito atual do [package.json](package.json): **Node.js `^26.13.1` (linha 26)**, Vite 8.3.8 e Sharp 0.35.5. Os comandos abaixo são instruções para você executar posteriormente; **nenhum foi executado nesta janela documental**. As dependências deste ambiente já foram preparadas. Se faltarem em outra máquina, planeje uma instalação pelo lock para a plataforma correta antes de iniciar; não copie módulos nativos Windows para Linux nem atualize versões por tentativa.

Banco existente: **conclua a seção de backup acima antes deste comando**. Instalação nova: siga o fluxo normal.

```powershell
# Execute na raiz do repositório clonado.
npm start
```

Se o PowerShell bloquear `npm.ps1`, use `npm.cmd start`. O script cria um **snapshot estático novo e filtrado** em `.fdl-build/build-<id>/site` e inicia **um Node único para API e interfaces**. Não é Vite dev/HMR: `npm run dev` e `npm run preview` usam o mesmo fluxo; mudanças exigem reiniciar somente seu processo.

| Finalidade | Endereço padrão após iniciar |
| --- | --- |
| Loja, conta e compras | `http://127.0.0.1:5173/` e `/conta.html` |
| Painel de operador | `http://localhost:5173/` |

**Use as URLs e o caminho “Dados privados:” impressos no seu terminal.** `5173` é apenas a porta padrão, não um diagnóstico de disponibilidade. As instâncias isoladas de QA foram encerradas e seus endereços não são entrega; nenhum serviço preexistente foi reiniciado pelos testes. Não se presume que a aplicação esteja rodando agora. Não use bancos, perfis ou credenciais das fixtures de QA.

- Os hostnames separam as sessões: mantenha loja em **127.0.0.1** e operador em **localhost**, mesmo serviço/porta; uma sessão ativa por hostname/perfil de navegador. Para duas contas de cliente simultâneas, use perfis/contextos separados; duas abas do mesmo perfil compartilham sessão.
- O processo local só faz bind em127.0.0.1 e tenta um relay loopback `::1` para localhost, preservando Host. Não edite o arquivo hosts nem troque o painel para o hostname da loja. Se IPv6 não estiver disponível, siga o aviso de resolução local; não se certificou todo ambiente de rede.
- Se a porta estiver ocupada, o início **falha**, não escolhe outra sozinho e não mata ninguém. Escolha uma porta realmente livre para ambas as origens:

```powershell
$env:FDL_PORT = '5188' # Exemplo; confirme disponibilidade, não é porta reservada.
npm start
```

As origens passam a 127.0.0.1:5188 e localhost:5188. Se você já definiu `FDL_SHOP_ORIGIN`/`FDL_OPERATOR_ORIGIN`, elas precisam corresponder exatamente à porta escolhida. `.env` **não é carregado automaticamente** por esses scripts.

### Banco persistente e primeiro operador — offline

O default Windows é uma pasta dedicada **sob LocalAppData, fora de toda a raiz da aplicação**, com sufixo derivado da raiz. Não use `<projeto>/.fdl-data`, `public`, build ou `dist`. A alternativa `FDL_DATA_DIR` deve ser um caminho privado dedicado sem sobreposição/links; o diretório pai deve existir. Pastas existentes desconhecidas não são adotadas.

Mover/renomear a pasta do projeto não migra o estado: pode mudar o default e invalidar a identidade do marcador. Não edite marcadores nem crie outro banco para contornar isso; planeje migração/recuperação offline antes da mudança.

**Somente para criar o primeiro operador de uma instalação nova ou de um banco já protegido conforme a seção de atualização. Se o operador já existe, pule esta criação e entre com os dados escolhidos anteriormente.** `operador_demo` no exemplo é um identificador de login, não uma conta provisionada nem senha padrão.

**Sequência obrigatória, conferida por leitura das fontes:**

1. **Instalação nova:** inicie seu próprio `npm start` na raiz; ele prepara/identifica a pasta e imprime **“Dados privados: CAMINHO”** depois de abrir o banco. Em banco existente, só faça isso **após o backup**, usando o caminho antigo já identificado. Guarde o caminho completo/canônico; **não reconstrua o hash do nome por conta própria**. O mesmo diretório precisa continuar existindo entre reinícios.
2. Solicite o encerramento normal **desse processo no seu terminal** (Ctrl+C) e aguarde sua saída/liberação do banco e lock. O wrapper tem handlers de encerramento; a prova automatizada anterior usou SIGTERM controlado, não certificou Ctrl+C em todo terminal Windows. **Não execute a CLI enquanto qualquer processo usa esse banco.**
3. Na mesma raiz, defina `FDL_DATA_DIR` com **exatamente o caminho efetivo impresso**, inclusive se antes foi usado o default. A CLI não calcula o default do wrapper. Forneça **nome de usuário fictício do operador** e senha única de teste por **stdin não interativo protegido**; não existe senha inicial/padrão.
4. Aguarde a CLI encerrar. Depois execute novamente `npm start` **com o mesmo `FDL_DATA_DIR`**, abra localhost e entre com esse operador. Cadastro público só cria cliente; operador não compra em nome de cliente.

O exemplo abaixo é para **PowerShell 7/.NET, terminal local privado**, sem gravação/depuração de credenciais. Solicita senha sem eco e redireciona UTF-8 diretamente para stdin; a senha não é argumento, variável de ambiente, literal no histórico nem saída do comando. Foi **conferido pelas fontes, não executado/testado pelo documentalista**. O segredo passa transitoriamente pela memória gerenciada; não há promessa de apagamento forense. Use somente senha fictícia, nunca reutilizada.

```powershell
# Só depois de parar seu npm start e confirmar que esse banco não está em uso.
# Execute da raiz do projeto. O caminho é configuração, NÃO uma senha.
$env:FDL_DATA_DIR = Read-Host 'Cole o caminho exato de Dados privados'
$senha = Read-Host 'Senha fictícia única (mínimo 12 caracteres)' -AsSecureString
$inicio = [System.Diagnostics.ProcessStartInfo]::new()
$inicio.FileName = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$inicio.WorkingDirectory = (Get-Location).ProviderPath
$inicio.UseShellExecute = $false
$inicio.RedirectStandardInput = $true
$inicio.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
$inicio.ArgumentList.Add('--import')
$inicio.ArgumentList.Add('./scripts/runtime-umask.mjs')
$inicio.ArgumentList.Add('server/bootstrap-operador.js')
$inicio.ArgumentList.Add('operador_demo') # Apelido fictício, não senha padrão.
$processo = [System.Diagnostics.Process]::new()
$processo.StartInfo = $inicio
$ponteiro = [IntPtr]::Zero
$iniciado = $false
try {
    $iniciado = $processo.Start()
    if (-not $iniciado) { throw 'A CLI não iniciou.' }
    $ponteiro = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($senha)
    $texto = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro)
    $processo.StandardInput.WriteLine($texto)
    $processo.StandardInput.Close()
    $processo.WaitForExit()
    if ($processo.ExitCode -ne 0) { throw 'Bootstrap não concluído; confira a mensagem segura da CLI.' }
} finally {
    try {
        if ($iniciado) {
            try { $processo.StandardInput.Close() } finally { $processo.WaitForExit() }
        }
    } finally {
        $texto = $null
        if ($ponteiro -ne [IntPtr]::Zero) {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro)
        }
        $senha.Dispose()
        $processo.Dispose()
    }
}
```

Escolha outro **nome de usuário do operador** antes de executar se necessário: 3–32 caracteres ASCII, letras/dígitos/`_`/`-`; senha de teste de pelo menos 12 caracteres e no máximo 256 bytes UTF-8. O comentário “Apelido fictício” do bloco preservado refere-se a esse login, não ao apelido Unicode do cliente. Login já existente é recusado, **não redefine senha**. Se não puder usar esse mecanismo, siga o contrato de stdin de [server/API.md](server/API.md) com um provedor local seguro; **não substitua por `echo SENHA`, senha em arquivo, argumento, `.env` ou YAML**.

Locks/pastas com erro de propriedade ou conteúdo desconhecido **não devem ser apagados para “resolver” o início**. Pare, identifique o dono e os processos; não mate serviços alheios nem reutilize dados de QA. O diretório guarda SQLite e journal; cópias/restaurações devem ser administradas **offline**, preservando o conjunto e o formato. Modo POSIX não certifica ACL efetiva do Windows: revise privacidade da pasta no ambiente real, sem mudanças globais automáticas.

### Percorrer a loja integrada

1. **Painel/localhost:** entre como operador fictício; em categorias crie pai/nicho/subnicho ativos (máximo 6 níveis). Sem ciclos; para desativar um pai, resolva filhos ativos e anúncios publicados primeiro.
2. Crie anúncio **rascunho**, selecione categoria, nome/descrição/preços fictícios (por exemplo R$ 100,00; comparação R$ 120,00). Envie JPEG/PNG estático de até 3 MiB/4 MP, máximo 5 fotos. Preencha alt e legenda, ordene as imagens e publique. Só anúncios publicados e suas referências públicas entram na loja. O backend reencoda a imagem; não é depósito de arquivos arbitrários.
3. Configure cupons no painel e compatibilidade entre os pares. Exemplo demonstrativo: produto 20% com teto R$ 15; categoria 10% com mínimo R$ 100 elegíveis; terceiro cupom de frete grátis. Para usar os três juntos, **todos devem permitir combinação e os três pares precisam de ALLOW explícito**.
4. **Loja/127.0.0.1:** confira categoria/PDP/foto. Cadastre **nome de usuário**, senha de teste e **apelido**, ou entre com seu login/senha existentes. Em **Minha conta**, edite o apelido sem trocar login ou senha. Adicione à sacola e informe os cupons; no checkout, digite separadamente um **nome completo fictício**, selecione frete e Pix/cartão simulados e peça a prévia. Ela vem do servidor e explica os cupons aplicados/recusados; confira o total antes de confirmar.
5. Para uma peça de R$ 100,00, o exemplo desconta R$ 15,00, depois R$ 8,50, zera o frete uma vez e resulta em **R$ 76,50**. Não é cobrança nem promessa comercial.
6. No painel consulte o pedido e avance **PENDENTE → PROCESSANDO → ENVIADO → ENTREGUE**, sem saltos/retrocesso. Na conta da loja, abra Compras/histórico para acompanhar. O **nome completo aparece só no detalhe privado do dono e do operador**, inclusive ao atualizar status, não na lista ou recibo. Nome completo informado, itens, preços, cupons e pagamento fictício são snapshots; editar o apelido ou catálogo não reescreve a compra. O histórico mostra o status atual; nome ausente em pedido legado aparece **“Não informado”**.

**Três campos diferentes:**

| Campo | Uso |
| --- | --- |
| **Nome de usuário** | Login de 3–32 caracteres ASCII: letras, números, `_` ou `-`, **sem espaços** e sem distinção de maiúsculas ao entrar. Logins/senhas legados continuam válidos. |
| **Apelido** | Saudação editável em Minha conta: 2–60 caracteres Unicode, com espaços, acentos e maiúsculas preservados; apenas espaços externos são aparados, controles/invisíveis recusados. Cliente legado sem apelido vê seu login identificado como “Nome de usuário” até escolher um. |
| **Nome completo no checkout** | Campo separado, inicialmente vazio, **não preenchido por login/apelido**. Use nome fictício de 2–120 caracteres; não se exige duas palavras nem se verifica identidade. Guardado como snapshot do pedido privado, não em prévia, recibo, listas, sessão, URL, logs ou storage do navegador. |

**Prévia e recuperação:** quote vale 10 min e é revalidada no servidor; mudar nome, itens, preço, frete, pagamento ou cupons pode exigir nova revisão. Em erro/cancelamento não esvazie a sacola. Em resposta incerta, a UI mantém **a mesma chave/cotação/conta/nome somente em memória**, com o nome bloqueado, para **“Retentar mesma confirmação”** sem duplicar compra. “Confirmando…” fica desabilitado durante o envio; não há reenvio automático. **Após recarregar ou fechar a página, consulte Compras antes de iniciar outro pedido.** A QA010 interrompeu uma resposta 201 real e confirmou replay 200 com mesmo recibo/uma compra, mantendo a sacola alterada em outra aba.

- **409 STALE/EXPIRED:** obtenha uma nova prévia.
- **409 CONSUMED/IDEMPOTENCY_CONFLICT:** pode já haver compra; **consulte Compras antes de outra ordem**. A UI não oferece nova revisão imediata; a ação “Já consultei Compras; revisar novamente” exige sua escolha, não verifica automaticamente a leitura do histórico.

**Foco e teclado:** nas páginas testadas, entrada/reload passivos não chamam foco de script nem mostram o contorno sozinhos. `Tab`, skiplink, validação, login, consulta explícita, navegação Full/Reduced e modais mantêm foco visível/intencional; não se escondeu outline globalmente. Em fragmento direto/reload, o navegador pode iniciar o Tab pela âncora nativa, não pelo skiplink do topo. Edição de nome durante quote pendente e escolha de perfil durante detalhe retido preservaram o input/foco nas amostras. Escape não reabre o diálogo quando chega uma falha tardia. **Não é garantia de todo navegador, nó ou sequência de foco.**

**Políticas demonstrativas atuais:**

- Até 6 níveis de categorias e 5 códigos distintos por sacola; escopo global/produto/categoria, descendentes de categoria habilitados por padrão, configuráveis.
- Mínimo sobre mercadoria **elegível ao cupom, pelo preço de venda antes dos cupons**, sem frete. Teto monetário opcional limita o desconto percentual.
- Cupom é exclusivo por padrão. Combinar exige ambos combináveis **e ALLOW simétrico para cada par**; DENY ou ausência bloqueia. Servidor escolhe o subconjunto de maior economia, desempata por menos cupons e ordem ASCII dos códigos.
- Percentuais aplicados sobre o saldo elegível, na ordem produto→categoria→global, com piso em centavos, teto e saldo não negativo; frete por último, **uma tarifa zerada no máximo**. Veja regras de alocação no contratoAPI.
- Upload não tem precondição atômica de versão: o painel faz GET prévio, mas uma corrida pode já ter gravado a foto. Não há reenvio/rollback automático; consulte o registro após conflito. Pares de cupons são última mutação aceita, **não transação multi-pair da UI**. São limites divulgados, não exploração confirmada pela QA.

## Testes e build

```powershell
npm test
npm run build
```

Comandos de verificação para uma futura janela autorizada/congelada; não foram executados ao escrever este guia. `npm test` é a suíte abrangente, não um comando a rodar contra arquivos em edição.

`npm run build` usa [scripts/build.mjs](scripts/build.mjs), **não copia todo `public`**: cria geração exclusiva sob `.fdl-build`, exige 4 HTML (`index`, `produto`, `conta`, `operador`), bundles hashados e 53 ativos aprovados (48 imagens/3 fontes/2 licenças). A evidência integrada tinha 9 bundles, não um número garantido após alteração futura. O manifesto `fdl-static.json` não é servido. **Nunca sirva `dist` legado, public cru ou a raiz**, nem use ViteCLI direto para contornar o builder.

**Aceite local atual U25/010:** revisão independente com **115/115 testes, build e `npm start` reais em Windows**, Node 26.13.1/SQLite 3.54.1/Chrome 157.0.8103.79. Passaram **7/7 grupos HTTP (75 chamadas)** e **8/8 grupos Chrome em uma execução**: identidade/perfil, migração V1→V2/rollback em fixtures, legado, nome privado/binding/replay, duas contas isoladas/operador, quatro status e recuperação sem duplicar compra.

Foco: 17 entradas/reloads medidos com **zero chamadas de foco JS**; primeiro Tab no skiplink em 15 sem fragmento, com exceção nativa documentada nas 2 de fragmento direto. Full/Reduced, Back e cancelamento por wheel foram amostrados, sem repetir toda a matriz NAV007. Dois setups HTTP anteriores falharam **antes de qualquer chamada**, foram preservados e corrigidos só no coletor; não transformados em PASS bruto.

TTL da API foi medido com **relógio injetado**, não espera real de 10 min. 5xx/recibo inválido e certas variantes passaram na suíte, não foram reinjetados no Chrome. **Não foram feitos backup/migração/restauração de seu banco, auditoria WCAG/segurança/carga universal ou validação de produção.** O exemplo PowerShell do operador permanece apenas conferido por leitura/parse, não executado pelo documentalista.

**Histórico U20/009 preservado:** a QA integrada anterior aprovou build real/86 testes e a jornada categoria de 3 níveis → anúncio com foto/publicação → 3 cupons/R$ 76,50 nos 4 fretes → compra → quatro status, duas contas/isolamento e persistência após restart em outro processo. Seu CHANGES_REQUESTED por QA009-01 continua histórico, não foi apagado ou convertido retroativamente em PASS.

Na revalidação009, após uma correção focal, passaram **95/95 testes (86 + 9) e 5/5 grupos Chrome** em Windows: resposta 201 perdida, trava pendente, retry/replay 200/uma compra, sacola concorrente, sucesso scroll 0/foco no título em 320 px, 409 real, Escape e clique duplicado. **QA009-01 resolvido nos casos medidos**, sem apagar o parecer inicial. A API também tinha revisão independente com 512 casos de cupons/HTTP; essa matriz não foi repetida integralmente na QA010.

Na revalidação009, a expiração no navegador usou fixture explícita de `expiresAt`, sem esperar TTL real; a ressalva de foco em BODY após um input removido pertencia àquela medição, **não uma garantia nem prova do fluxo novo**. Aceites e discrepâncias históricas mantêm seus recortes; a integração010 não retroage.

**Histórico preservado, não transferido automaticamente a U20:** APP137 teve38/38 testes,104Full/16Reduced e reparos de navegação/foco aceitos nos limites; **7/7 ciclos consumidos**. INFRA008 teve seis arquivos estáticos revisados, não imagem NGINX em execução. Índices históricos locais: `docs/ai/evidence/NAV007-ACCEPTANCE.md` e `docs/ai/evidence/DELIVERY-INFRA008.md`.

**GATE OPEN30 é histórico**, inalterado, não PASS automático da nova estética. Revisão atual inclui avaliação manual e amostras de desempenho local, não certificação WCAG integral, INP/Lighthouse, Safari/Firefox, hardware móvel ou jurídica.

No aceite histórico APP137, houve um gap RAF de 106,5 ms em um percurso, sem longtask correlata ou causa determinada; posição monotônica e foco foram preservados. Não se afirma “zero jank”. A ressalva sobre canal in-app desconectado pertence àquela etapa; não substitui a QA Chrome integrada U20 posterior, também em perfil próprio, não na aba exata do usuário.

## Arquivos para Docker e Portainer/Swarm

| Arquivo na raiz | Função |
| --- | --- |
| [Dockerfile](Dockerfile) | Builder Node26.13.1/bookworm-slim e dependências de produção da plataforma alvo; runtime **Node não-root1000:1000/8080**, API e saída filtrada, sem Vite dev em serviço. |
| [.dockerignore](.dockerignore) | Contexto com negação por padrão e allowlist explícita **antes do envio ao builder**. |
| [.gitignore](.gitignore) | Preserva quatro regras anteriores e exclui originais, memória privada, segredos e artefatos locais; permite `.env.example`. |
| [nginx.conf](nginx.conf) | **Histórico da INFRA008**, excluído do contexto/runtime Node atual. Não usar `nginx -t` como validação deste serviço. |
| [stack.yml](stack.yml) | Modelo Swarm3.8: dois routers para o **mesmo serviço8080**, volume externo/pin de nó/réplica única; não builda nem cria Traefik. |
| [.env.example](.env.example) | Parâmetros sem credenciais, incluindo domínio de operador e volume; não é configuração real nem arquivo carregado automaticamente. |
| [scripts/container-guard.mjs](scripts/container-guard.mjs) | Guarda fail-closed de origens, volume/sentinela, banco pré-provisionado e permissões; não cria banco vazio como fallback do serviço. |
| [scripts/start.mjs](scripts/start.mjs) / [scripts/safe-paths.mjs](scripts/safe-paths.mjs) | Caminhos reais/ownership e início local filtrado com pasta privada, lock e separação de origens. |
| [server/API.md](server/API.md) | Contrato de rotas, sessões, bootstrap offline, prévia, idempotência, cupons e pedidos demonstrativos. |

**Tudo nesta seção é preparação para operação FUTURA, não executada nem autorizada por este guia.** Build/pull/run/push, login Registry, DNS/TLS e deploy exigem autorização operacional própria, direitos de exposição e validações pendentes. Não são próximos comandos automáticos.

O host da loja continua **`prototipo-flor-de-lotus-carlone.kelbyte.com.br`**. O administrador deverá escolher **OPERATOR_HOST diferente**, confirmar DNS/TLS/proxy existentes e provisionar os dados antes de qualquer operação futura; nada disso foi operado aqui.

Node26.13.1-bookworm-slim permanece pinado por digest. O Dockerfile prevê instalação Linux com opcionaisSharp e scripts de instalação desativados, sem copiar módulosWindows; **isso não foi executado em Linux**. Serviço final usa Node/healthcheckNode, **não NGINX/curl/UID101**. Pin não certifica atualizações, PIE/ASLR, isolamento do decoder, licenças nativas ou recursos sob carga.

### Preencher os parâmetros

Use `.env.example` somente como referência sem segredos. Não sobrescreva um `.env` seu. Na futura configuração autorizada, forneça as variáveis da stack pela UI/importação compatível do Portainer; **nem npm nem Swarm carregam este exemplo automaticamente**. Nunca coloque senha/token nesses modelos.

| Variável | O que informar |
| --- | --- |
| `APP_IMAGE` | Referência completa da imagem privada, incluindo host, nome e tag ou digest. Exemplo de formato: `<ip_local_vps>:5000/flor-de-lotus-carlone:prototipo`. **Substitua `<ip_local_vps>`; não é um IP real.** Sem prefixo `http://` ou `https://`. Prefira tag única/imutável e, após publicação da imagem, referência por digest para a stack. |
| `OPERATOR_HOST` | **Obrigatório, diferente do host da loja**, somente FQDN, sem esquema/caminho/credenciais. Deve chegar ao Node no Host original; role/CSRF/sessão continuam obrigatórios além do hostname. |
| `TRAEFIK_NETWORK` | Nome real da **overlay externa existente**, compartilhada com o Traefik. |
| `HTTPS_ENTRYPOINT` | Nome do entrypoint HTTPS já configurado no proxy. |
| `TRAEFIK_CERTRESOLVER` | Nome de um resolver TLS existente; veja a alternativa wildcard/default abaixo. |
| `TRAEFIK_NETWORK_LABEL` | Chave correspondente ao provider/versão reais: `traefik.swarm.network` para Traefik 3/provider Swarm; `traefik.docker.network` para Traefik 2/Docker swarmMode. O valor v3 do exemplo **não identifica a versão da sua VPS**. |
| `FDL_DATA_NODE` | Hostname Swarm do **único nó** onde o volume foi preparado offline. Não é descoberta automática de nó. |
| `FDL_DATA_VOLUME` | Nome real do volume **externo, exclusivo, já provisionado** nesse nó; será montado em`/data`, com`nocopy`. |
| `FDL_DATA_VOLUME_ID` | Identificador do volume preparado, igual ao conteúdo da sentinela `.fdl-volume-id`; não é senha nem autorização para criar sentinela por tentativa. |

As expressões `${VAR:?mensagem}` exigem valores não vazios. Os placeholders textuais também precisam ser substituídos: não são credenciais, nomes de recursos descobertos ou defaults prontos para deploy.

- **Wildcard/default já configurado no Traefik:** remova/comente **as DUAS labels `tls.certresolver`**, loja e operador, antes de dispensar a variável. Não basta deixá-la vazia. Essa personalização exige revalidar o modelo resultante.
- Labels em`deploy.labels`, dois routers/um serviço8080, sem portas de host/build/newTraefik. A stack fornece também ambiente de runtime/origensHTTPS e volume; não aceita origens adivinhadas ou confiança implícita em`X-Forwarded-*`.
- **Não presuma `.env` automático em `docker stack` nem use `env_file: stack.env`.** ParâmetrosRequired não vazios e placeholders substituídos continuam necessários.
- Cadastre a autenticação do Registry separadamente, no mecanismo seguro do Portainer; todos os nós elegíveis precisam conseguir puxar a imagem. Nunca coloque senha/token em YAML, labels, argumentos de build, `.env.example`, Git ou mensagens de suporte.
- A porta 5000 **não demonstra HTTP nem HTTPS**. Prefira TLS e confirme confiança/autenticação do Registry. Caso seu Registry use HTTP, os requisitos de confiança dos nós são responsabilidade operacional do administrador; este kit **não configura `insecure-registries` nem desabilita TLS**.
- Confirme versões Docker/Portainer/Traefik, provider, plataforma amd64/arm64, overlay, permissões, DNS e certificado. A stack ainda não foi testada na sua instalação.

### Volume e bootstrap de container — checklist FUTURO, não executado

**Não iniciar o serviço com volume vazio e esperar que ele se autoconfigure.** Um volume local com o mesmo nome em outro worker pode estar vazio. O administrador precisa preparar o volume correto **offline**, no nó fixado, antes de subir qualquer writer:

1. Um único processo/réplica; nó e volume exclusivos, sem outra stack/CLI usando o mesmo arquivo. Não presumir HA/NFS/migração automática de SQLite.
2. Diretório privado pertencente ao UID/GID**1000:1000**, modoPOSIX**0700**; arquivos privados**0600**. Permissões reais e UID montado precisam de validação Linux; `mkdir/chown` da imagem não provisiona o volume externo.
3. Sentinela **`.fdl-volume-id`** igual a`FDL_DATA_VOLUME_ID` e banco **`flor-de-lotus.sqlite` já bootstrapado**, no formato da app. O guard recusa volume errado, banco ausente/inválido, links, permissões ou conteúdo desconhecidos; não cria substituto silencioso. Não transportar `.fdl-owner.json`/lock do wrapper Windows como provisionamento do container.
4. Bootstrap por CLI do backend **offline e no mesmo UID1000/volume**, senha somente em stdin protegido, sem guard do servidor — o guard exige banco já preparado. Conferir `server/API.md`, `.env.example` e a guarda; este guia **não inventa comandos de sentinela/chown/provisionamento** ou usa dados de QA.
5. SQLite usa journal de rollback; preservar diretório/banco/journal em procedimentos consistentes, **backup e restauração offline** administrados. Nunca apagar banco/lock/sentinela para contornar recusa; restauração/schema compatíveis são operação separada.

O modelo usa`stop-first`, uma réplica, pausa em falha de atualização/rollback e monitor150s; healthcheckNode tem intervalo30s/início30s/três tentativas. Isso não é garantia de disponibilidade, recuperação de schema ou recursos suficientes para Sharp/Argon2. Não mudar hardening/filesystem/cgroups ou permissões por inferência.

### Antes de qualquer exposição futura autorizada

Validar no ambiente alvo: instalação limpa de opcionaisLinux/Sharp, Node/SQLite nativos, UID/permissões do volume, guarda/sentinela/bootstrap, `/healthz`204, filtros/404/headers reais, origens/cookiesHTTPS/CSRF/Host/proxy, reinício/persistência e restauração offline. Revisar PIE/ASLR, isolamento/limites do decoder, capacidade de disco/journal e consumo sob carga. **HTTPWindows não comprova nada disso em Linux/TLS/Swarm.**

Somente com autorização operacional própria, direitos e parâmetros confirmados poderá haver procedimento de build/publicação/Registry/Portainer. Nenhum comando de enviar imagem ou implantar foi executado ou liberado por este guia. Não usar `docker compose up` como substituto da stackSwarm, não criar proxy/cluster ou desabilitar TLS por tentativa.

### Contexto filtrado, privacidade e futuro versionamento

- O builder usa53ativos explícitos (48imagens/3WOFF2/2OFL) e fontes aprovadas, não pastas inteiras. O contextoDocker009 teve **116entradas no modelo estático revisado**, não os79arquivos do kit008. A negação ocorre antes de enviar ao builder/cache; isso não é execução comprovada do motorDocker.
- O levantamento por referências corrigiu a estimativa antiga de 49: `assinatura-256.jpg` não é ativa. `morango-uso-inteiro-003` é usado; Contos e Sakura usam os derivados `clean`. Favicon e todos os ativos efetivamente referenciados foram considerados.
- Dos 105 arquivos públicos locais, 52 ficam fora do contexto, incluindo **20 originais imutáveis** com UI/dados históricos, kits antigos e crops superados. Nada foi apagado localmente. `docs/ai`, harness, segredos, logs, testes, módulos Windows e `dist` anterior também não entram.
- Verificações de contexto/YAML/Swarm continuam estáticas; build e serviçoWindows foram exercitados, não DockerLinux. Adicionar fonte/ativo exige atualizar e revalidar as políticas, sem ampliar para copiar tudo. Não é scanner universal de segredos, licença de publicação ou limpeza forense de todo metadado.
- `.gitignore` preserva as quatro regras anteriores e mantém `.env*` privado, com exceção `.env.example`. Fontes, testes, lock, seis configs, README e derivados ativos são elegíveis a versionamento; revise a seleção. **Originais privados e memória AI/harness não devem ir ao GitHub.** Alguns legados não privados continuam elegíveis: o ignore não é curadoria automática de tudo que deveria ser publicado.
- Ignorar não apaga arquivos, não remove conteúdo já rastreado nem limpa histórico anterior. **Nenhum `git init`, commit ou push foi executado** nesta preparação. Antes de um futuro versionamento, revise índice/histórico se já existir Git; não envie credenciais ou material de terceiros por inferência.

### Alcance do aceite e pendências

**U25/010 local VERIFIED→DONE nos recortes:** Backend/UI/QA e REQ038–042 aceitos após revisão independente, 115 testes/7 grupos HTTP/8 grupos Chrome, sem novo reparo de produto. **Não produção DONE.** U20/009/APP137/INFRA008 permanecem históricos, sem reset GATE OPEN30/budgets ou nova tentativa NAV; a correção focal009 permanece contabilizada.

**NÃO EXECUTADOS/APROVADOS:** Linux/containers/SharpSQLiteLinux, Dockerbuild/pull/run/health/parseroficial, Swarm/Portainer/Registryprivado/VPS/SSH/DNS/TLS/volumePOSIX/carga/backups em produção/auditoriaCVE-SBOM-jurídica integral. Fonte prevê UID1000/8080/guard; não houve prova desses recursos em container.

**A imagem Docker não foi construída nem executada. Nenhum push ou deploy foi realizado.** Configuração de produção e validações operacionais permanecem pendentes para seu ambiente.

## Créditos e licenças

- **Imagens atuais fornecidas pelo usuário, não Pexels.** Autoria/licenças/direitos de exposição de fotografias, pessoas, artes e capas não foram verificados. Confirme permissão com a cliente/titulares **antes da publicação**. Capas e nomes de obras pertencem aos respectivos titulares. Créditos na interface e em [`src/ui/storefront.js`](src/ui/storefront.js).
- 20 originais preservados localmente em `public/images/referencias/`, fora do contexto Docker e da seleção Git por padrão. Derivados ativos e legados não foram reprocessados para preparar infraestrutura. Crucifixo: recorte no espaço original, depois 90° anti-horário e redução sem ampliação.
- **Jamais servir/publicar `dist` legado ou `public` cru** com originais/UI histórica. O pipeline atual gera outra saída filtrada; excluir raws não concede direitos sobre derivados/capas nem garante sanitização universal. Intenção de publicação não substitui permissão, autorização e validação operacional.
- Cormorant Garamond e DM Sans locais, SIL Open Font License1.1: [Cormorant](public/licenses/cormorantgaramond-OFL.txt) e [DM Sans](public/licenses/dmsans-OFL.txt).
- Traços laterais são desenhos originais discretos, sem reprodução do logo/personagens de Nana. As três imagens da marca têm prioridade; o fundo preto opaco foi preservado.
- `X-Robots-Tag: noindex, nofollow, noarchive` é apenas indicação a buscadores: **não é autenticação nem proteção de acesso**. Um protótipo publicamente acessível continua exposto; acesso restrito exige configuração própria autorizada.

## Contexto local não incluído no repositório

Na pasta original, a memória canônica está em `docs/ai/PROJECT_STATE.md`, `docs/ai/sessions/BOOT-001.md` e `docs/ai/evidence/`; o índice conclusivo atual é `docs/ai/evidence/DELIVERY-010.md`. `DELIVERY-009.md`, `QA-009.md`, APP137 e INFRA008 preservam seus pareceres históricos. `AGENTS.md` e protocolo/harness também são locais. O formulário opcional de decisões preserva perguntas/defaults da etapa009; decisões posteriores de nomes/foco foram consolidadas em010. Ele não é outra fonte de estado nem autorização automática de mudanças.

Esses caminhos locais não são dependências de execução nem links prometidos para um clone público. Não transportar docs/memória privada, banco/BLOB/sessões/journal, segredos, fixtures ou originais para imagem/Git/logs. O contrato técnico versionável continua em `server/API.md`.

O ignore mantém essa memória privada no disco, **sem commit, sincronização ou backup**. Ela não virá automaticamente de um clone Git futuro. Continuidade em outro computador exige handoff/backup privado separado e autorizado, ainda não realizado. Não apague a memória local nem a envie a um repositório público para “resolver” essa ausência.
