# Aprova

App de estudos para concursos (PWA instalável no celular). Funciona 100% sem internet e, se você quiser, **sincroniza na nuvem** entre aparelhos com login do Google. Tudo no plano **gratuito** da Cloudflare, sem cartão de crédito.

```
public/        o app (HTML, service worker, manifesto e ícones)
src/worker.js  a API: login com Google, sessão, estado e arquivos
schema.sql     tabelas do banco (Cloudflare D1)
wrangler.toml  configuração da Cloudflare
```

O site e a API ficam no **mesmo endereço** (`https://aprova.SEU-SUBDOMINIO.workers.dev`). Isso dispensa configuração de CORS e permite cookie de sessão seguro.

## Como publicar (uns 20 minutos)

Você precisa de: conta na [Cloudflare](https://dash.cloudflare.com/sign-up) (grátis, sem cartão), conta Google e [Node.js](https://nodejs.org) 18 ou mais novo.

### Parte 1: Cloudflare

No terminal, dentro desta pasta:

```bash
npm install
npx wrangler login                 # abre o navegador para autorizar
npx wrangler d1 create aprova-db   # cria o banco; copie o "database_id" que ele mostrar
```

Abra o `wrangler.toml` e troque `COLE-AQUI-O-ID-DO-BANCO` pelo `database_id`. Depois:

```bash
npm run db:init                    # cria as tabelas no banco
npm run deploy                     # publica; no fim mostra o endereço do app
```

Na primeira vez, o Wrangler pode pedir para você escolher o seu subdomínio `workers.dev`. Anote o endereço final, por exemplo `https://aprova.maria.workers.dev`. O app já abre e funciona, mas o login ainda não.

### Parte 2: login com Google

Os nomes das telas do Google mudam de vez em quando; se algo não bater, procure por "Google Auth Platform" ou "Credenciais".

1. Entre no [Google Cloud Console](https://console.cloud.google.com) e crie um projeto (grátis).
2. Configure a **tela de consentimento OAuth** (Google Auth Platform): público **Externo**, nome do app "Aprova" e o seu e-mail para contato.
3. Em **Público / Usuários de teste**, adicione o seu Gmail. Enquanto o app estiver em modo de teste, só os e-mails listados ali conseguem entrar. Para uso pessoal isso é o ideal.
4. Crie um **ID do cliente OAuth** do tipo **Aplicativo da Web** com:
   - **Origens JavaScript autorizadas:** `https://aprova.SEU-SUBDOMINIO.workers.dev`
   - **URIs de redirecionamento autorizados:** `https://aprova.SEU-SUBDOMINIO.workers.dev/api/auth/google-redirect`

   Os dois endereços precisam ser exatamente os do seu app, sem barra no final.
5. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).

Volte ao `wrangler.toml` e preencha:

```toml
[vars]
GOOGLE_CLIENT_ID = "123456-abc.apps.googleusercontent.com"
ALLOWED_EMAILS = "seu@gmail.com"
```

`ALLOWED_EMAILS` aceita vários e-mails separados por vírgula. **Se ficar vazio, ninguém consegue entrar** (é proposital, para ninguém usar a sua cota). Publique de novo:

```bash
npm run deploy
```

### Parte 3: usar

1. Abra o endereço do app no celular e vá em **Metas > Nuvem > Entrar com o Google**.
2. No Android (Chrome) toque em **Instalar app**; no iPhone (Safari) use **Compartilhar > Adicionar à Tela de Início**.
3. Entre com a mesma conta nos outros aparelhos. Os dados aparecem sozinhos.

**Trazendo os dados que já tinha** (do Render, do Claude ou de um arquivo): no lugar antigo, vá em **Metas > Backup > Exportar arquivo**. No app novo, importe o arquivo e depois entre com o Google. O backup inclui os materiais.

Depois da migração você pode apagar o serviço do Render: ele não roda a API.

## Como a sincronização funciona

- O app guarda tudo no aparelho primeiro, então abre rápido e funciona sem internet.
- Estando conectado, as alterações sobem sozinhas poucos segundos depois, e o app confere a nuvem ao abrir, ao voltar para a tela e a cada 2 minutos.
- Se dois aparelhos mudaram coisas diferentes, o app abre uma janela com três opções: **Mesclar os dois** (junta registros, erros, simulados, materiais e assuntos concluídos), **Usar os da nuvem** ou **Manter os deste aparelho**. Depois de escolher, dá para desfazer.
- A mesclagem não consegue saber o que foi excluído de propósito. Itens apagados em um aparelho podem reaparecer depois de mesclar.
- Arquivos (PDFs, fotos de erros) sobem em pedaços e são baixados nos outros aparelhos em segundo plano. Um arquivo excluído só é removido do servidor depois de 1 hora.

## Limites do plano gratuito

Confira sempre na página de preços da Cloudflare, porque os limites mudam.

| Recurso | Limite gratuito (na data desta versão) | Uso típico do Aprova |
|---|---|---|
| Requisições do Worker | 100 mil por dia (arquivos estáticos do app não contam) | poucas centenas por dia |
| D1: tamanho por banco | 500 MB | estado em KB; arquivos usam o resto |
| D1: leituras / escritas por dia | 5 milhões / 100 mil linhas | bem abaixo |

**Materiais:** o limite do app é `QUOTA_MB = 400` (editável no `wrangler.toml`). Como os arquivos ficam em texto base64 (cerca de 33% maior), isso dá aproximadamente **300 MB de arquivos reais** na nuvem. Cada arquivo pode ter até 30 MB. Quando a cota enche, o app avisa e os materiais maiores ficam só no aparelho.

Escolhi o D1 e não o R2 para os arquivos porque o R2 exige um cartão cadastrado para ser ativado, mesmo dentro do plano gratuito. Se um dia você quiser mais espaço, o R2 é o caminho, ao custo de cadastrar o cartão.

## Segurança

- O servidor confere a assinatura do token do Google, o emissor, o destinatário (seu ID de cliente) e a validade. Só e-mails de `ALLOWED_EMAILS` entram.
- A sessão é um cookie `HttpOnly`, `Secure` e `SameSite=Lax` com validade de 30 dias. No banco fica só o hash do token.
- Pedidos que alteram dados só valem se vierem do próprio site.
- Os dados ficam no D1 da Cloudflare. Não há criptografia de ponta a ponta: quem administra a conta da Cloudflare pode ver os dados.

## Problemas comuns

- **"Esta conta Google não está liberada":** o e-mail não está em `ALLOWED_EMAILS` ou você ainda não republicou depois de editar.
- **`redirect_uri_mismatch` no Google:** o URI de redirecionamento do passo 4 não é idêntico ao do app (confira `https`, subdomínio e `/api/auth/google-redirect`).
- **Botão do Google não aparece:** a origem não foi autorizada ou há um bloqueador de conteúdo; teste em outra aba anônima.
- **"Sincronização indisponível nesta hospedagem":** o app está aberto fora da Cloudflare (por exemplo, no Render ou aberto como arquivo).
- **"O servidor ainda não tem o login configurado":** falta preencher `GOOGLE_CLIENT_ID` e `ALLOWED_EMAILS` e publicar de novo.

## Atualizar o app

Depois de mudar algo em `public/`, troque `aprova-v6` por `aprova-v7` (e assim por diante) em `public/sw.js` para os aparelhos atualizarem o cache, e rode `npm run deploy`.
