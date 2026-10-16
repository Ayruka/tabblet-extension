# Rádio Tabblet · extensão para o Habblet

Player Manifest V3 para Chrome/Edge 120 ou posterior. Adiciona um player compacto da Rádio Tabblet ao hotel e permite escolher os canais PluZ quando não há locutor ao vivo.

## Instalar para desenvolvimento

1. Abra `chrome://extensions` ou `edge://extensions`.
2. Ative o modo do desenvolvedor e escolha **Carregar sem compactação**.
3. Selecione a pasta deste projeto e abra `https://www.habblet.city/hotel`.
4. Após alterar o código, recarregue a extensão na tela de extensões e depois a página do hotel.

Não há build nem dependências para executar a extensão. O cartão começa alinhado à coluna direita, abaixo da Rádio Habblet e com a mesma largura dos painéis. É possível arrastá-lo pela área do avatar/nome, e a posição escolhida é salva; o player fica sempre aberto, sem cabeçalho ou controle de recolher. O ícone de globo abre a página inicial da Tabblet em outra aba. O ícone da barra do navegador ainda não tem popup.

## Reprodução e preferências

- Sem locutor, o usuário escolhe entre os canais retornados pela API pública da Tabblet, com uma lista local de reserva.
- A entrada ao vivo assume a reprodução; o fim da live devolve o áudio ao canal escolhido. O seletor fica oculto durante a live e preserva o canal anterior.
- O volume usa uma curva quadrática para permitir níveis baixos: 1% no controle aplica amplitude de 0,0001; 0% silencia e 100% mantém o nível máximo. A preferência salva continua sendo a porcentagem escolhida.
- Volume, canal e pausa ficam em `chrome.storage.local`, na chave `radioPreferences`. F5 e uma segunda aba preservam as escolhas. Desinstalar a extensão remove as preferências.
- Existe um único áudio compartilhado entre as abas. Comandos e preferências são sincronizados entre elas. Silenciar todas as abas do hotel silencia esse áudio; fechar a última aba encerra o documento de áudio.
- Uma pausa manual continua valendo durante as transições. Reiniciar reconecta o stream, respeitando a pausa.
- Atualização de status a cada 15 segundos nas páginas abertas; um alarme de 30 segundos também acompanha abas em segundo plano. A entrada ao vivo depende dessa consulta, não é instantânea. Uma falha da API preserva a última programação conhecida.
- O áudio original da Rádio Habblet é silenciado quando a extensão toca. A extensão não recolhe nem remove o player original e não procura desenhos ou caminhos de SVG. A identificação do áudio original ainda usa o nome da rádio na notificação ou o domínio de streaming legado.
- O botão Seguir usa o campo de chat do hotel. Ele precisa estar disponível e vazio. A confirmação de que o hotel aceitou o comando depende do próprio cliente.

## Tema e interface

A extensão consulta `https://tabblet.net/api/public/theme` a cada minuto e aplica uma paleta e artes locais para os temas conhecidos: original, em obras, Halloween/Beta assombrado, eleição e Arena. Temas desconhecidos usam a apresentação neutra. As artes são do projeto Rádio Tabblet. Não há carregamento de JavaScript ou CSS remoto.

A interface usa Shadow DOM para isolar o CSS do hotel. O layout escolhido é o cartão compacto. A prévia usa somente essa versão, sempre aberta e sem o cabeçalho de logo e tema.

## Prévia interativa

```sh
python3 preview/server.py
```

Abra `http://localhost:4187/preview/`. A prévia usa o mesmo componente visual da extensão, com programação simulada e sem tocar áudio. A cabeça e o nome do locutor vêm da API pública real, por um proxy local de leitura; o botão de simulação alterna sua presença no player. As escolhas da prévia ficam no localStorage da prévia, separadas das preferências reais.

## Estrutura

- `radio-core.js`: normalização da API, temas, preferências e escolha de stream.
- `background.js`: estado central, armazenamento, consultas, abas e reconciliação do áudio.
- `offscreen.html` / `offscreen.js`: um único HTMLAudioElement, com validação dos destinos de áudio.
- `player-ui.js` / `player.css`: componente visual compartilhado com a prévia.
- `content.js`: montagem do cartão, mensagens e integração com áudio/chat do hotel.
- `player-placement.js`: encaixe inicial na coluna nativa, arraste, posição salva e limites da janela.

## Validar

Com Node.js instalado:

```sh
npm run check
npm test
```

Os testes de navegador usam Node.js 22 ou posterior, Playwright e Chromium instalados no ambiente. Com o servidor da prévia em execução:

```sh
PLAYWRIGHT_MODULE=/caminho/para/playwright-core CHROME_PATH=/caminho/para/chrome node tests/preview-browser.cjs
PLAYWRIGHT_MODULE=/caminho/para/playwright-core CHROME_PATH=/caminho/para/chrome node tests/extension-browser.cjs
```

O segundo teste carrega a extensão real em um perfil temporário, usa armazenamento e documento offscreen nativos, e reproduz um WAV de teste. A interceptação via CDP cobre o documento offscreen, para que o teste não dependa dos streams reais. Também verifica o ganho em 1%, silêncio em 0%, nível máximo e a persistência após F5. A API e o HTML do hotel são simulados para verificar as transições de forma determinística. A validação final na sessão autenticada real do Habblet continua necessária.
