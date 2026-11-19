# Despensa | Controle de estoque

Repositório do MVP de controle de estoque.

MVP mobile-first para cadastro de produtos, saldo atual, níveis mínimos e registro de entradas e saídas. A API ASP.NET Core serve também o frontend HTML/CSS/JavaScript, e a persistência usa o Supabase REST API.

## Estrutura

```text
backend/
  src/
    Estoque.Domain/          Entidades de domínio
    Estoque.Application/     Contratos, validações e casos de uso
    Estoque.Infrastructure/  Repositório HTTP do Supabase
    Estoque.Api/             Endpoints REST e configuração
  supabase/schema.sql        Tabelas, índices, RLS e trigger de saldo
frontend/
  Program.cs                Servidor de arquivos do cliente
  wwwroot/                   Interface web e arquivos estáticos
Estoque.Frontend.csproj     Host estático independente (ASP.NET Core)
```

## Configuração do Supabase

1. No SQL Editor do projeto Supabase `oaukruzqhijxgvjlyyqk`, execute `backend/supabase/schema.sql`.
2. Em **Project Settings > API Keys**, crie/copiei uma chave secreta (`sb_secret_...`) e coloque-a em `SUPABASE_SECRET_KEY` no arquivo `.env` da raiz do projeto. A URL fica em `SUPABASE_URL`; o arquivo já vem preenchido com a URL configurada. Também é aceita a chave JWT legada `service_role` usando `SUPABASE_SERVICE_ROLE_KEY`.
  A chave secreta ignora RLS e nunca deve ser colocada no JavaScript, no `appsettings.json` versionado, em variáveis `VITE_*`, enviada por chat ou commitada. O `.env` é ignorado pelo Git.

Ao aplicar esta atualização a um banco existente, o schema limpa os produtos e movimentações atuais uma única vez para converter `code` em numeração automática. A coluna antiga de códigos é substituída e os valores anteriores não são preservados.

Execute o SQL no Supabase. Depois, inicie o MVP com um único comando:

```cmd
run-mvp.cmd
```

O inicializador carrega as configurações de `.env` e inicia a API, que também serve a interface. Abra `http://localhost:5080`; a API e o frontend usam o mesmo endereço. Para encerrar, pressione `Ctrl+C` na janela do inicializador.

## Camadas e dados

- `Domain`: produtos e movimentações.
- `Application`: contratos do repositório, validação e regras de negócio.
- `Infrastructure`: integração server-side com a API REST do Supabase.
- `Api`: endpoints HTTP, configuração e hospedagem dos arquivos estáticos do frontend em `frontend/wwwroot/`.
- `Estoque.Frontend.csproj`: host estático independente, disponível para desenvolvimento isolado do frontend.
- A trigger `apply_stock_movement` atualiza o saldo na mesma transação da inserção da movimentação. Saídas abaixo de zero são permitidas após confirmação na interface, preservando o alerta não bloqueante do requisito.
- Produtos com movimentações não podem ser excluídos, para não apagar o histórico de auditoria.
- O frontend mantém o catálogo em `localStorage`, usa service worker para abrir a interface sem rede e guarda operações pendentes localmente para sincronizar quando a conexão voltar. O código do produto é atribuído automaticamente pelo banco e a descrição deve ser única. A tela Movimentações lista descrição, tipo, quantidade, data e estoque atual, ordenada da mais recente para a mais antiga.

## Execução e validação

Requer .NET SDK 9.0 ou superior:

```powershell
dotnet build Estoque.slnx
```

## Executar com Docker

Com Docker instalado e o `.env` preenchido, construa e execute a imagem:

```powershell
docker build -t controle-estoque .
docker run --rm -p 8080:8080 --env-file .env controle-estoque
```

Abra `http://localhost:8080`. O `.dockerignore` impede que o `.env` seja incluído na imagem. No Render, crie um Web Service usando o runtime Docker e configure `SUPABASE_URL` e `SUPABASE_SECRET_KEY` nas variáveis de ambiente do serviço; o container escuta a porta informada por `PORT`.

## Segurança e escopo

A chave secreta (ou `service_role` legada) ignora RLS e fica exclusivamente no servidor. Este MVP não implementa autenticação de operadores; mantenha a API em localhost ou em rede privada confiável. Não publique o serviço na internet antes de adicionar autenticação, autorização por perfil, proteção contra abuso e política de auditoria. Para implantação, use HTTPS e gerencie a chave por secret manager.

O banco ativa RLS sem políticas para clientes anon; o acesso deste backend ocorre usando a chave de serviço no servidor.
