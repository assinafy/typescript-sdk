# @assinafy/sdk

*Português · [Read in English](README.en.md)*

SDK oficial em TypeScript para a [API Assinafy](https://api.assinafy.com.br/v1/docs), com suporte
a Node.js e Bun, tipos completos e builds ESM/CJS.

O SDK mapeia as 147 operações do OpenAPI publicado (146 com métodos; a troca da sessão incorporada
é reservada à página de embed da Assinafy), além das extensões de compatibilidade mantidas
pela API. A referência completa, com payloads, respostas, erros e exemplos de cada recurso, está no
**[manual em português](docs/README.md)**.

## Requisitos

- Node.js 22+ ou Bun 1.4.4
- HTTPS com TLS 1.2 ou superior

## Instalação

```bash
npm install @assinafy/sdk
# ou
bun add @assinafy/sdk
```

## Início rápido

```ts
import { AssinafyClient } from '@assinafy/sdk';

const client = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
});

const resultado = await client.uploadAndRequestSignatures({
  source: { filePath: './contrato.pdf' },
  signers: [
    {
      name: 'Signatário Exemplo',
      email: 'signatario@exemplo.com.br',
    },
  ],
  message: 'Por favor, assine este contrato',
});

console.log(resultado.document.id, resultado.assignment.id);
```

O helper envia o PDF, cria ou reaproveita os signatários e solicita as assinaturas. Para controlar
cada etapa separadamente, siga o [fluxo completo do documento](docs/README.md#ciclo-de-vida-do-documento).

## Autenticação

| Credencial | Uso |
| --- | --- |
| `apiKey` | Automação servidor a servidor no seu próprio workspace |
| `token` | Sessão autenticada ou token de acesso OAuth |
| Sem credencial | Login, recuperação de senha, leituras públicas, código do signatário e endpoints OAuth |

```ts
const comChave = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
});

const comOAuth = new AssinafyClient({
  token: process.env.ASSINAFY_ACCESS_TOKEN!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
});
```

Aplicações conectadas a workspaces de terceiros devem usar OAuth 2.1 com PKCE S256. Veja o
[guia de OAuth](docs/README.md#aplicações-oauth) para descoberta, autorização, callback, rotação de
refresh token e revogação.

## Configuração

| Opção | Padrão | Finalidade |
| --- | --- | --- |
| `apiKey` | — | Credencial `X-Api-Key` |
| `token` | — | Credencial `Authorization: Bearer` |
| `accountId` | — | Workspace padrão |
| `baseUrl` | `https://api.assinafy.com.br/v1` | Ambiente da API |
| `webhookSecret` | — | Verificação de assinatura Standard Webhooks |
| `timeout` | `30000` | Timeout em milissegundos |
| `maxRetries` | `2` | Retentativas seguras para HTTP 429 |
| `logger` | no-op | Logger opcional |

O [manual de configuração](docs/README.md#configuração) explica retentativas, limites e fábricas.

## Fluxo de integração

1. Configure o cliente com uma chave de API ou conclua o fluxo OAuth no mesmo ambiente do
   workspace.
2. Crie ou localize os signatários.
3. Envie o PDF e aguarde o processamento dos metadados.
4. Estime o custo e crie o assignment com a verificação e a notificação desejadas, ou envie vários
   documentos aos mesmos signatários de uma vez com `client.envelopes`.
5. Entregue a URL de assinatura, ou exiba a tela de assinatura dentro do seu app com
   `client.embed`, e valide os webhooks antes de processar eventos.
6. Acompanhe a conclusão e baixe o documento assinado ou o certificado.

WhatsApp, biometria com documento e face, certificado digital ICP-Brasil e a verificação `Bypass`
(habilitada por conta) têm pré-requisitos específicos; `workspaces.get(id, { expand:
'signing_features' })` informa quais o plano habilita. O SDK representa A1 e A3 como `DigitalCertificate`; a mídia é escolhida pelo
signatário no navegador. Consulte os [ramos de assinatura](docs/README.md#ramos-pagos-de-assinatura).

## Recursos da API

| Recurso | Área |
| --- | --- |
| `client.documents` | Upload, consulta, artefatos, tags e criação por template |
| `client.signers` | Cadastro, busca e atualização de signatários |
| `client.assignments` | Solicitações, custos, notificações e revisão de identidade |
| `client.envelopes` | Vários documentos aos mesmos signatários, um convite e uma cobrança |
| `client.embed` | Origens e sessões de uso único para assinar dentro do seu app |
| `client.contracts` | Termos, famílias, renovação e encerramento de contratos |
| `client.templates`, `client.tags`, `client.fields` | Conteúdo reutilizável e campos |
| `client.workspaces`, `client.users` | Workspace, tema, uso do plano, política de notificações, preferências e MFA/TOTP |
| `client.auth`, `client.oauth` | Login, chaves de API e OAuth 2.1 |
| `client.webhooks`, `client.webhookVerifier` | Endpoints, entregas e autenticação de eventos |
| `client.signerDocuments` | Fluxo público e autenticado do signatário |

Veja a [referência por recurso](docs/README.md#referência-de-recursos) e o
[mapa operação a operação](docs/API_COVERAGE.md). As declarações TypeScript e o JSDoc distribuídos
com o pacote documentam os payloads completos.

## Documentação

- [Manual completo em português](docs/README.md)
- [Complete manual in English](docs/README.en.md)
- [Cobertura da API](docs/API_COVERAGE.md)
- [Compatibilidade entre ambientes](docs/COMPATIBILITY.md)
- [Processo de release](docs/RELEASING.md)
- [Documentação oficial da API](https://api.assinafy.com.br/v1/docs)

## Desenvolvimento

```bash
bun install --frozen-lockfile
bun run verify
bun run audit
bun run audit:api
```

`bun run verify` executa a checagem de tipos, lint, testes, cobertura, build e validações do pacote.

## Licença

Distribuído sob a licença [MIT](LICENSE).
