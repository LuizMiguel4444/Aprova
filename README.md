# Aprova

Webapp mobile (HTML, CSS e JavaScript puros, sem build) para planejar e acompanhar estudos de um ou mais concursos: ciclo de estudos, cronômetro por etapa, revisões em 1, 7 e 30 dias, caderno de erros com filtros, desempenho, simulados, disciplinas editáveis e backup.

## Rodar localmente
Abra o `index.html` no navegador, ou rode `python3 -m http.server 8000` e acesse http://localhost:8000.

## Publicar no GitHub
```bash
git init
git add .
git commit -m "Aprova"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/aprova.git
git push -u origin main
```

## Hospedar no Render (Static Site)
1. No Render, clique em **New > Static Site** e conecte o repositório.
2. Deixe o **Build Command** vazio (ou `echo ok`) e use **Publish Directory** = `.`
3. Clique em **Create Static Site**. Se preferir, use **New > Blueprint**, que lê o `render.yaml` deste projeto.

## Instalar como app (PWA)
O projeto já inclui `manifest.webmanifest`, `sw.js` (funciona offline) e os ícones. Depois de publicado no Render (que usa HTTPS), abra o endereço no celular:

- **Android (Chrome):** use o botão **Instalar app** que aparece no app, ou o menu do navegador > **Instalar app**.
- **iPhone (Safari):** toque em **Compartilhar** > **Adicionar à Tela de Início**.

Ao mexer em arquivos da lista `A` do `sw.js`, troque o valor de `V` (por exemplo, `aprova-v3`) para atualizar o cache nos aparelhos.

## Seus dados
Tudo fica salvo no `localStorage` do navegador, neste aparelho e neste endereço. Ao mudar de endereço (por exemplo, do Claude para o Render), use **Metas > Backup**: exporte no lugar antigo e importe no novo. Faça um backup de vez em quando.
