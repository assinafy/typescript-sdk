# @assinafy/sdk

*Português · [Read in English](README.en.md)*

SDK oficial em TypeScript para a [API Assinafy](https://api.assinafy.com.br/v1/docs) — plataforma
brasileira de assinatura eletrônica de documentos.

Cobre as 93 operações do documento OpenAPI oficial: contas, autenticação, aplicações OAuth 2.1,
usuários, documentos, assignments, signatários, fluxos do lado do signatário, templates, tags,
campos, webhooks, identidade visual, estatísticas e o fluxo de alto nível
`uploadAndRequestSignatures`. Cinco rotas adicionais de gestão de templates usadas por integrações
existentes e dois helpers de URL de navegador são mantidos por compatibilidade.

O mapa operação a operação está em [docs/API_COVERAGE.md](docs/API_COVERAGE.md); as variações por
deploy, em [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Sumário

Este documento vai da instalação ao fluxo completo de assinatura e, depois, ao detalhe de cada
recurso. Leia na ordem na primeira vez; use como referência depois.

**Preparação** — [Requisitos](#requisitos) · [Instalação](#instalação) ·
[Início rápido](#início-rápido) · [Autenticação](#autenticação) ·
[Aplicações OAuth](#aplicações-oauth) · [Configuração](#configuração)
([limite de requisições](#limite-de-requisições), [fábricas](#fábricas)) ·
[Cobertura de endpoints](#cobertura-de-endpoints)

**O fluxo ponta a ponta** — [Ciclo de vida do documento](#ciclo-de-vida-do-documento):
[envio do PDF](#1-envie-o-pdf) → [signatários](#2-crie-ou-reaproveite-os-signatários-por-e-mail) →
[orçamento e pedido de assinatura](#3-orce-depois-peça-as-assinaturas) →
[o lado do signatário](#4-conclua-o-fluxo-do-signatário-por-e-mail) →
[conclusão e artefatos](#5-acompanhe-a-conclusão-e-baixe-os-artefatos)

**Detalhe por recurso** — [Referência de recursos](#referência-de-recursos):
[documentos](#documentos) · [signatários](#signatários) · [assignments](#assignments) ·
[ramos pagos de assinatura](#ramos-pagos-de-assinatura) · [templates](#templates) · [tags](#tags) ·
[workspaces](#workspaces) · [definições de campo](#definições-de-campo) ·
[autenticação e chaves de API](#autenticação--gestão-de-chaves-de-api) ·
[usuário autenticado](#usuário-autenticado) · [webhooks](#webhooks)
([verificação](#verificação-de-webhooks)) ·
[endpoints do signatário](#endpoints-do-signatário)

**O restante** — [Helper de alto nível](#helper-de-alto-nível) · [Erros](#erros) ·
[Ambientes](#ambientes) · [Desenvolvimento](#desenvolvimento) · [Licença](#licença)

## Requisitos

- Node.js 22+ (usa as APIs nativas `FormData` / `Blob` para upload). Os imports CJS e ESM
  empacotados são testados no 22 (LTS de manutenção), 24 (LTS ativo) e 26 (Current). O Node 20
  chegou ao fim da vida em abril de 2026 e não é suportado.
- ou Bun 1.4.0 (versão fixada no desenvolvimento e na CI)
- HTTPS com TLS 1.2 ou superior, exigido pela API; o Node.js 22+ e o Bun já negociam isso por padrão

## Instalação

```bash
npm install @assinafy/sdk
# ou
bun add @assinafy/sdk
```

O pacote é publicado no [npmjs.com](https://www.npmjs.com/package/@assinafy/sdk) e no
[GitHub Packages](https://github.com/assinafy/typescript-sdk/packages). Para instalar do GitHub
Packages, adicione ao seu `.npmrc`:

```
@assinafy:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Início rápido

```ts
import { AssinafyClient } from '@assinafy/sdk';

const baseUrl = process.env.ASSINAFY_BASE_URL ?? 'https://api.assinafy.com.br/v1';
const client = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
  baseUrl,
});

const resultado = await client.uploadAndRequestSignatures({
  source: { filePath: './contrato.pdf' },
  signers: [
    { name: 'João Silva', email: 'joao@exemplo.com.br' },
    { name: 'Maria Souza', email: 'maria@exemplo.com.br' },
  ],
  message: 'Por favor, assine este contrato',
});

console.log('ID do documento:', resultado.document.id);
console.log('ID do assignment:', resultado.assignment.id);
```

Esse caminho usa verificação e notificação por e-mail para todos os signatários. WhatsApp e
certificado digital ICP-Brasil têm pré-requisitos e custos próprios — veja
[Ramos pagos de assinatura](#ramos-pagos-de-assinatura) antes de habilitar qualquer um dos dois.

## Autenticação

A API aceita três credenciais. A escolha depende de **em qual workspace** você está agindo.

| Credencial | Age sobre | Use quando |
| --- | --- | --- |
| `apiKey` (`X-Api-Key`) | **Seu próprio** workspace | Você automatiza a sua conta. Recomendada para serviços de back-end. |
| `token` (`Authorization: Bearer`) | O usuário autenticado | Você obteve uma sessão com `auth.login()`. |
| Token de acesso OAuth (`Authorization: Bearer`) | O workspace **de outra pessoa**, com autorização dela | Você constrói um app que outras pessoas conectam. Veja [Aplicações OAuth](#aplicações-oauth). |

Prefira `apiKey` para integração servidor a servidor — corresponde ao header `X-Api-Key`
recomendado pela Assinafy.

```ts
// Preferido: header X-Api-Key
new AssinafyClient({ apiKey: 'k_xxx', accountId: 'acc_xxx' });

// Token de acesso: Authorization: Bearer <token>
new AssinafyClient({ token: 'jwt_xxx', accountId: 'acc_xxx' });
```

As credenciais são opcionais na construção. Um cliente sem credenciais usa um transporte separado,
sem autenticação, para as operações públicas e as que usam código de acesso do signatário — assim
uma chave de API ou token Bearer nunca é anexada por acidente:

```ts
const clientePublico = new AssinafyClient({
  baseUrl: 'https://api.assinafy.com.br/v1',
});

await clientePublico.auth.login('eu@exemplo.com.br', 'senha');
await clientePublico.documents.getPublic(documentId);
await clientePublico.signerDocuments.self(signerAccessCode);
```

Métodos protegidos continuam exigindo `apiKey` ou `token`; sem credencial, a API devolve o `401`
normal.

Todos os transportes do SDK — inclusive os públicos e os por código de acesso — enviam
`User-Agent: Assinafy-Typescript-SDK/v<VERSÃO>`, onde `<VERSÃO>` é a versão instalada do pacote. O
valor exato também é exportado como `SDK_USER_AGENT`.

## Aplicações OAuth

Use OAuth quando o seu produto for conectado **pelos usuários dele** aos workspaces **deles** na
Assinafy, sem que você jamais tenha a senha ou a chave de API dessas pessoas. Para automatizar o seu
próprio workspace nada disso é necessário — continue com a chave de API.

Registre a aplicação no app da Assinafy em **Configurações → Aplicações OAuth → Nova aplicação**.
Você define as URIs de redirecionamento (`https://`, sem fragmento, comparadas caractere a
caractere), as permissões máximas que a aplicação poderá pedir, e se ela é **confidencial** (roda no
seu servidor e recebe um `client_secret`) ou **pública** (roda no dispositivo do usuário, só PKCE).
Aplicações não são criadas pela API.

O fluxo passa por dois hosts de propósito: a tela de consentimento fica no servidor de autorização
(`https://auth.assinafy.com.br`), enquanto os endpoints de token, revogação e userinfo ficam nesta
API. Leia os dois da descoberta em vez de fixá-los no código.

```ts
import { AssinafyClient, OAuthError } from '@assinafy/sdk';

const client = new AssinafyClient();                  // nenhuma credencial necessária

// 1 — antes de redirecionar o usuário. Guarde a requisição inteira na sessão dele:
//     `state` e `issuer` provam que o callback é seu, `codeVerifier` completa o
//     PKCE e `nonce` valida o id_token.
const requisicao = await client.oauth.createAuthorizationUrl({
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  redirectUri: 'https://meuapp.com.br/oauth/callback',
  scopes: ['documents:read', 'documents:write', 'offline_access'],
});
sessao.oauth = requisicao;
resposta.redirect(requisicao.url);                    // navegação de página inteira

// 2 — em https://meuapp.com.br/oauth/callback
const { code } = client.oauth.readAuthorizationCallback(query, sessao.oauth);
const tokens = await client.oauth.exchangeCode({
  code,
  codeVerifier: sessao.oauth.codeVerifier,
  redirectUri: 'https://meuapp.com.br/oauth/callback',
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  clientSecret: process.env.ASSINAFY_CLIENT_SECRET,   // só aplicações confidenciais
});
// → { access_token, token_type: 'Bearer', expires_in: 3600,
//     scope: 'documents:read documents:write',
//     refresh_token?, id_token? }

// 3 — um token vale para EXATAMENTE UM workspace: o que o usuário escolheu.
const conectado = new AssinafyClient({ token: tokens.access_token });
const { data } = await conectado.workspaces.list();
const accountId = data[0]?.id;                        // guarde junto com os tokens

// 4 — renove antes de completar uma hora (exige `offline_access`)
const renovado = await client.oauth.refreshToken({
  refreshToken: conexao.refreshToken,
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
});
await conexao.save({ refreshToken: renovado.refresh_token });  // ANTES de usar

// 5 — quando o usuário desconectar: revogue o token salvo mais recentemente
const atual = await conexao.load();                   // nunca uma cópia aposentada
await client.oauth.revokeToken({
  token: atual.refreshToken,
  tokenTypeHint: 'refresh_token',
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
});
```

Descoberta e identidade, quando precisar:

```ts
await client.oauth.getProtectedResourceMetadata();    // RFC 9728, na raiz do host da API
await client.oauth.getAuthorizationServerMetadata();  // RFC 8414, em auth.assinafy.com.br
await client.oauth.getUserInfo(tokens.access_token);  // claims OIDC; exige `openid`
```

### Permissões (escopos)

| Escopo | Permite ao seu app |
| --- | --- |
| `documents:read` | Ler documentos, seus signatários, assignments e atividades |
| `documents:write` | Criar documentos e enviá-los para assinatura |
| `templates:read` | Ler templates |
| `templates:write` | Criar e alterar templates |
| `account:read` | Ler perfil, tema e logotipo do workspace |
| `webhooks:write` | Atualizar ou inativar a assinatura de webhooks do workspace |
| `openid` | Receber um `id_token` identificando o usuário |
| `profile` | Ler o nome do usuário |
| `email` | Ler o e-mail do usuário e se está verificado |
| `offline_access` | Receber um refresh token |

Peça o mínimo: o usuário aprova todos ou nenhum. Leia o `scope` devolvido pelo endpoint de token em
vez de supor que o pedido foi atendido por inteiro — `offline_access` nunca aparece ali, porque é um
sinal de requisição, não uma permissão. Faturamento, membros do workspace, credenciais e
administração nunca são alcançáveis por um token OAuth, quaisquer que sejam seus escopos.

### O que o SDK garante para você

- Um verificador RFC 7636 (S256) e um `state` novos a cada tentativa.
- `state` comparado em tempo constante e `iss` conferido (RFC 9207) **antes** de qualquer confiança
  na resposta.
- O `issuer` do documento RFC 8414 conferido contra a URL de onde ele veio.
- `redirect_uri` obrigatoriamente `https://` absoluta e sem fragmento.
- O indicador de recurso RFC 8707 preenchido com a origem da API configurada e mantido idêntico
  entre a etapa de autorização e a de token.

### Tratamento de falhas

```ts
try {
  await conectado.documents.upload({ filePath: './contrato.pdf' });
} catch (erro) {
  if (erro instanceof ApiError && erro.challenge?.error === 'insufficient_scope') {
    // Reconecte pedindo erro.challenge.scope — por exemplo 'documents:write'.
  }
}
```

| Situação | O que você vê | O que fazer |
| --- | --- | --- |
| O usuário recusou | `OAuthError` com `error: 'access_denied'` em `readAuthorizationCallback` | Nada; avise o usuário |
| Código usado, expirado (60 s) ou divergente | `OAuthError` `invalid_grant` | Recomece o fluxo de autorização |
| Refresh token reutilizado ou expirado | `OAuthError` `invalid_grant` | A conexão inteira acabou; peça para reconectar |
| `client_id`/segredo errado, app desativado | `OAuthError` `invalid_client` | Corrija a configuração; repetir não resolve |
| Token expirado ou revogado | `ApiError` `401` | Renove; se falhar, peça para reconectar |
| Falta de permissão | `ApiError` `403` com `challenge.error === 'insufficient_scope'` | Reconecte pedindo `challenge.scope` |
| `403` sem challenge | `ApiError` `403` | Outro workspace, ou área que OAuth não alcança |

Refresh tokens **rotacionam**: cada renovação devolve um novo e aposenta o anterior, e reutilizar um
token aposentado encerra a conexão inteira. Persista o novo valor antes de usar a resposta, trate um
timeout como "talvez tenha funcionado" e nunca renove a mesma conexão duas vezes em paralelo. Após
um timeout, releia o token guardado; se ainda for o enviado, nunca o envie de novo — peça ao
usuário para reconectar. Só uma falha que comprovadamente ocorreu antes do envio (DNS, conexão
recusada, handshake TLS) pode ser repetida. Um refresh token vale 30 dias, e cada renovação
devolve um novo com mais 30 dias: a conexão só expira se o seu app passar 30 dias sem renová-la, e
aí o usuário precisa conectar de novo. Os endpoints de autorização e token aceitam 50 requisições
por minuto por IP.

Assistentes de IA como Claude, Claude Code e ChatGPT se conectam à Assinafy pelas próprias
configurações de conector; seus usuários não precisam que você registre nada para eles.

## Configuração

| Opção           | Tipo     | Padrão                           | Descrição |
| --------------- | -------- | -------------------------------- | --------- |
| `apiKey`        | string   | —                                | Credencial preferida (enviada como `X-Api-Key`). |
| `token`         | string   | —                                | Token de acesso (enviado como `Authorization: Bearer`). Serve também para tokens OAuth. |
| `accountId`     | string   | —                                | ID padrão da conta / workspace. |
| `baseUrl`       | string   | `https://api.assinafy.com.br/v1` | Base absoluta da API, sem credenciais, query ou fragmento. Precisa ser `https`, salvo em loopback. |
| `webhookSecret` | string   | —                                | Segredo HMAC opcional usado pelo `WebhookVerifier`; veja a [ressalva de contrato](docs/COMPATIBILITY.md#webhook-signature-verification-is-not-in-the-openapi-contract). |
| `timeout`       | number   | `30000`                          | Timeout da requisição, em milissegundos. |
| `maxRetries`    | number   | `2`                              | Retenta automaticamente respostas `429` elegíveis, respeitando `Retry-After`. `0` desativa. |
| `logger`        | `Logger` | no-op                            | Logger opcional `{debug,info,warn,error}`. |

### Limite de requisições

Em um HTTP `429` o cliente retenta até `maxRetries` vezes, aguardando o `Retry-After` (ou
`X-Rate-Limit-Reset`) devolvido pelo servidor antes de cada tentativa. A repetição automática vale
apenas para `GET`, `HEAD`, `OPTIONS` e `DELETE`, que são seguros de repetir. `GET /sign` fica de
fora porque registra que o signatário visualizou o assignment. Escritas não são repetidas por
padrão. Um `Idempotency-Key` não vazio inscreve uma requisição customizada na repetição do SDK, mas
ele **não** faz parte do contrato OpenAPI atual: confirme antes que a rota alvo de fato deduplica
essa chave no servidor. Nenhum outro status é retentado.

### Fábricas

```ts
// Fábrica posicional
const client = AssinafyClient.create('chave-de-api', 'id-da-conta');

// A partir de um objeto simples (aceita chaves snake_case ou camelCase)
const client = AssinafyClient.fromConfig({
  api_key: process.env.ASSINAFY_API_KEY!,
  account_id: process.env.ASSINAFY_ACCOUNT_ID!,
});
```

## Cobertura de endpoints

As 93 operações documentadas em https://api.assinafy.com.br/v1/docs estão cobertas. A tabela abaixo
é o resumo por recurso; o mapa detalhado por operação está em
[docs/API_COVERAGE.md](docs/API_COVERAGE.md).

| Recurso | Endpoints |
| --- | --- |
| `client.documents` | list, search, upload, details, get, rename, activities, waitUntilReady, download, thumbnail, downloadPage, statuses, delete, verify, createFromTemplate, estimateCostFromTemplate, getPublic, sendToken, listTags, replaceTags, addTags, detachTag, isFullySigned, getSigningProgress |
| `client.signers` | create, get, list, update, delete, findByEmail |
| `client.assignments` | list, create, estimateCost, resetExpiration, resendNotification, estimateResendCost, listWhatsAppNotifications |
| `client.templates` | create, list, get, update, delete, downloadPage |
| `client.tags` | list, create, update, delete |
| `client.workspaces` | create, list, get, update, delete, getTheme, downloadLogo, uploadLogo, deleteLogo, getStats |
| `client.webhooks` | register, get, inactivate, listEventTypes, listDispatches, retryDispatch |
| `client.fields` | create, list, get, update, delete, validate, validateMultiple, listTypes |
| `client.oauth` | **getProtectedResourceMetadata**, **getAuthorizationServerMetadata**, **createAuthorizationUrl**, **readAuthorizationCallback**, **exchangeCode**, **refreshToken**, **revokeToken**, **getUserInfo** |
| `client.auth` | getSocialLoginUrl, getSocialLoginCallbackUrl, login, socialLogin, linkSocialLogin, createApiKey, getApiKey, deleteApiKey, changePassword, requestPasswordReset, resetPassword |
| `client.users` | getCurrent, getStats, getNotificationPreferences, updateNotificationPreferences |
| `client.signerDocuments` | getCurrent, list, search, download, signMultiple, declineMultiple, self, acceptTerms, verifyEmail, confirmData, uploadSignature, downloadSignature, getAssignment, sign, decline |
| `client.webhookVerifier` | verify, extractEvent, getEventType, getEventData |

Todo wrapper HTTP tem tipos de requisição e resposta verificados pelo TypeScript e JSDoc por método,
cobrindo o payload de rede, o formato de retorno, validação, erros relevantes da API e um exemplo
copiável. As declarações acompanham o pacote.

## Ciclo de vida do documento

A integração normal tem uma fase do dono da conta, uma fase do signatário e uma fase final de
artefatos. O exemplo abaixo mantém todos os signatários no e-mail e usa um assignment `virtual`,
então não exige coordenadas de página nem canal pago de notificação.

### 1. Envie o PDF

```ts
const enviado = await client.documents.upload({ filePath: './contrato.pdf' });
```

O corpo multipart oficial contém a parte `file`. O SDK também aceita um nome de exibição (usado como
nome de arquivo dessa parte) e uma parte JSON `metadata` opcional, para deploys que a aceitem. A
resposta de sucesso é `IDocumentUploadResponse`:

```ts
{
  resource?: string;
  id: string;
  account_id: string;
  template_id: string | null;
  name: string;
  status: DocumentStatus;
  assignment?: IAssignment | null;
  artifacts: {
    original: string;
    certificated?: string;
    'certificate-page'?: string;
    pades?: string;
    bundle?: string;
    thumbnail?: string;
  };
  signing_url?: string;
  pages: Array<{ id: string; number: number; height: number; width: number; download_url: string }>;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
  created_at: string;
  updated_at: string;
  is_closed: boolean;
  decline_reason: string | null;
  declined_by: ISigner | null;
}
```

`DocumentStatus` cobre `uploading`, `uploaded`, `metadata_processing`, `metadata_ready`,
`pending_signature`, `expired`, `certificating`, `certificated`, `rejected_by_signer`,
`rejected_by_user` e `failed`.

O envio precisa ser um PDF de no máximo 25 MB e 2.000 páginas. O SDK confere extensão, tamanho e o
cabeçalho `%PDF-` antes de enviar. Um upload novo pode ter `pages` vazio até o processamento de
metadados terminar. Espere antes de criar um assignment `collect`, porque seus campos referenciam
IDs de páginas renderizadas; um assignment `virtual` pode ser criado imediatamente.

```ts
const preparado = await client.documents.waitUntilReady(enviado.id, {
  maxWaitMs: 30_000,
  pollIntervalMs: 2_000,
});
```

### 2. Crie ou reaproveite os signatários por e-mail

```ts
const signatarioA = await client.signers.create({
  full_name: 'João Silva',
  email: 'joao@exemplo.com.br',
});
const signatarioB = await client.signers.create({
  full_name: 'Maria Souza',
  email: 'maria@exemplo.com.br',
});
```

O corpo de rede é `{ full_name, email }`. Cada resposta é um `ISigner`:

```ts
{
  resource?: string;
  id: string;
  full_name: string;
  email: string | null;
  whatsapp_phone_number?: string | null;
  cpf?: string | null;                // tipo de compatibilidade; a API não devolve
  has_accepted_terms?: boolean;
  has_signature?: boolean;            // só na resposta de signers/self
  has_initial?: boolean;              // só na resposta de signers/self
  is_signature_reusable?: boolean;    // só na resposta de signers/self
  metadata?: Record<string, unknown>;
}
```

Quando há e-mail, `signers.create()` primeiro procura esse endereço no workspace e reaproveita o
signatário correspondente; uma requisição só com nome ou só com telefone sempre cria um novo.

### 3. Orce, depois peça as assinaturas

A estimativa de custo recebe descritores de canal, não IDs de signatário:

```ts
const estimativa = await client.assignments.estimateCost(enviado.id, {
  method: 'virtual',
  signers: [{}, {}], // `{}` seleciona Email para cada signatário
});

if (!estimativa.has_sufficient_resources) {
  throw new Error(estimativa.blocking_reason ?? estimativa.message ?? 'Recursos insuficientes');
}
```

A resposta é `ICostEstimate`:

```ts
{
  documents: number;
  credits: number;
  needs_extra_document: boolean;
  extra_document_cost: number;
  total_credits: number;
  breakdown: Array<{ code: string; name: string; cost: number; quantity?: number; unit_cost?: number }>;
  document_balance: number;
  credit_balance: number;
  has_sufficient_resources: boolean;
  blocking_reason: 'PendingPayment' | 'InsufficientDocuments' | 'InsufficientCredits' | null;
  message: string | null;
}
```

Crie o assignment por e-mail só depois de aceitar essa estimativa:

```ts
const assignment = await client.assignments.create(enviado.id, {
  method: 'virtual',
  signers: [
    { id: signatarioA.id, verification_method: 'Email', notification_methods: ['Email'] },
    { id: signatarioB.id, verification_method: 'Email', notification_methods: ['Email'] },
  ],
  message: 'Por favor, revise e assine',
  expires_at: '2027-12-31T23:59:00Z',
});
```

A requisição devolve um `IAssignment`:

```ts
{
  resource?: string;
  id: string;
  sender_email?: string;
  method: 'virtual' | 'collect';
  expires_at?: string | null;
  expiration?: string;
  message?: string | null;
  signers: IAssignmentSigner[];
  copy_receivers?: Array<Record<string, unknown>>;
  items?: IAssignmentItem[];
  summary?: {
    signer_count: number;
    completed_count: number;
    signers: Array<ISigner & { completed?: boolean }>;
  };
  signing_urls?: Array<{ signer_id: string; url: string }>;
}
```

As URLs e as mensagens entregues contêm credenciais do signatário; trate-as como segredo.

### 4. Conclua o fluxo do signatário por e-mail

A Assinafy envia a cada signatário um link com o código de acesso dele e manda o código de
verificação de uso único pelo canal escolhido. Nenhum dos dois valores é devolvido como campo
autônomo do lado do dono da conta. Um portal de assinatura próprio precisa obter os dois pelo fluxo
de entrega ao signatário; não os fabrique nem os registre em log.

```ts
// Cliente do signatário: nenhuma credencial da conta é necessária nem enviada.
const clienteSignatario = new AssinafyClient({ baseUrl });

const self = await clienteSignatario.signerDocuments.self(accessCode); // ISignerSelf

// Query: signer-access-code=<accessCode>
// Corpo: { 'verification-code': '<código de seis dígitos>' }
await clienteSignatario.signerDocuments.verifyEmail({
  signerAccessCode: accessCode,
  verificationCode,
}); // Promise<void>

const confirmado = await clienteSignatario.signerDocuments.confirmData(
  enviado.id,
  accessCode,
  { full_name: self.full_name, email: self.email ?? undefined },
); // ISigner

const assinavel = await clienteSignatario.signerDocuments.getAssignment(accessCode, true);
// `getAssignment` devolve IDocumentDetailsResponse e registra que o signatário
// visualizou o assignment. Não use como simples healthcheck.

await clienteSignatario.signerDocuments.signMultiple([assinavel.id], accessCode);
// Corpo de rede: { document_ids: [assinavel.id] }; o reconhecimento não traz dados.
```

Repita esta fase separadamente para cada signatário, com o código de acesso e o código de uso único
dele. Os dois signatários deste exemplo compartilham o passo padrão e podem assinar em paralelo.

`signMultiple` serve apenas a assignments `virtual`. Para `collect`, leia `assinavel.assignment.items`
e chame `sign(documentId, assignmentId, accessCode, entries)` com um array não vazio de
`{ itemId, fieldId, pageId, value }`. Um signatário virtual precisa confirmar os dados antes de
assinar. Um signatário `DigitalCertificate` não pode usar `sign`; esse ramo passa pelo fluxo de
certificado da Assinafy, descrito em
[Certificado digital ICP-Brasil](#certificado-digital-icp-brasil).

### 5. Acompanhe a conclusão e baixe os artefatos

Assine o evento `document_ready` para saber da conclusão por evento, ou consulte
`documents.details(documentId)` até `status === 'certificated'`. As entregas de webhook podem se
repetir — use o `id` numérico como chave de idempotência. Concluído:

```ts
const documentoFinal = await client.documents.details(enviado.id);
const pdfAssinado = await client.documents.download(enviado.id, 'certificated');
const paginaCertificado = await client.documents.download(enviado.id, 'certificate-page');
const pacoteZip = await client.documents.download(enviado.id, 'bundle');

// Valide um hash de assinatura Assinafy que o seu fluxo tenha extraído.
const validacao = await client.documents.verify(documentSignatureHash);
```

`original`, `certificated` e `certificate-page` são PDFs. `bundle` é um ZIP com esses três artefatos
e também o `pades` quando o documento teve signatário por certificado ICP-Brasil. O PDF `pades`
existe apenas nesses documentos. Um artefato pode devolver `404` antes de terminar de ser gerado.
`decline_reason` só aparece nos detalhes do documento quando o token pertence a quem criou o
documento.

## Referência de recursos

A maioria dos métodos com escopo de conta aceita um `accountId` opcional que sobrepõe o padrão do
cliente. Os métodos de workspace `get`, `update`, `delete`, identidade visual e estatísticas sempre
exigem um ID de conta explícito.

### Documentos

```ts
// Envio a partir de um caminho de arquivo (recomendado)
const doc = await client.documents.upload(
  { filePath: './contrato.pdf' },
  { name: 'Contrato de prestação', metadata: { tipo: 'servico' } },
);
// `name` e `metadata` são partes multipart de compatibilidade, fora do schema
// oficial (que só define o arquivo). `name` é opcional e assume o nome do
// arquivo. A API deriva o nome de exibição do arquivo enviado e acrescenta
// `.pdf` quando falta, então o documento acima é salvo como
// 'Contrato de prestação.pdf'. A API translitera acentos
// ('Contrato de Serviço' → 'Contrato de Servico.pdf').
// → {
//   resource: 'document', id: '1031…', account_id: '102d…', template_id: null,
//   name: 'Contrato de prestacao.pdf', status: 'uploaded',
//   artifacts: { original: 'https://…/download/original' },
//   signing_url: 'https://app…/sign/1031…',
//   pages: [],                 // preenchido quando o status chega a `metadata_ready`
//   tags: [], is_closed: false, created_at: '2026-…', updated_at: '2026-…'
// }

// …ou a partir de um Buffer já em memória
await client.documents.upload({ buffer, fileName: 'contrato.pdf' });

// Listagem → { data: IDocumentListItem[], meta?: { current_page, per_page, total, last_page } }
const { data, meta } = await client.documents.list({ page: 1, 'per-page': 20, sort: 'updated_at' });

// `search` é a alternativa leve a `list`: mesmo formato de item, mas a API não
// expande `assignment`/`pages`. Prefira-a para buscar por nome.
const achados = await client.documents.search({ search: 'contrato', status: 'pending_signature', 'per-page': 20 });

await client.documents.details(doc.id);
await client.documents.activities(doc.id);
await client.documents.waitUntilReady(doc.id, { maxWaitMs: 30_000 });

// Renomear. A API responde 400 enquanto o documento está em
// `metadata_processing`, então chame waitUntilReady() antes em um upload novo.
// (Passar `name` ao upload() evita tanto a ida extra quanto a corrida.)
await client.documents.rename(doc.id, 'Contrato assinado.pdf');

await client.documents.download(doc.id, 'certificated');    // PDF assinado
await client.documents.download(doc.id, 'certificate-page');
await client.documents.download(doc.id, 'bundle');          // ZIP
// `pades` existe apenas quando algum signatário usou DigitalCertificate.
await client.documents.download(doc.id, 'pades');
await client.documents.thumbnail(doc.id);
await client.documents.downloadPage(doc.id, pageId);

await client.documents.statuses();                          // todos os códigos de status + flag deletable
await client.documents.isFullySigned(doc.id);
await client.documents.getSigningProgress(doc.id);
await client.documents.delete(doc.id);

// Verifique um documento assinado pelo hash de assinatura Assinafy
await client.documents.verify('FE32EDDADE7CBDDCBB934E7402047450B0E59C02');

// Endpoints públicos (sem autenticação)
await client.documents.getPublic(doc.id);
// Corpo oficial: { email: 'maria@exemplo.com.br' }
await client.documents.sendToken(doc.id, 'maria@exemplo.com.br');

// Sobrecarga explícita de compatibilidade para deploys mais antigos:
// { recipient: '+5548999990000', channel: 'whatsapp' }
await client.documents.sendToken(doc.id, '+5548999990000', 'whatsapp');

// O contrato OpenAPI atual exige IDs de tags já existentes.
const tagContratos = await client.tags.create({ name: 'Contratos' });
const tagTrimestre = await client.tags.create({ name: '2026-T1' });
const tagUrgente = await client.tags.create({ name: 'Urgente' });
await client.documents.listTags(doc.id);
await client.documents.replaceTags(doc.id, [tagContratos.id, tagTrimestre.id]); // [] desanexa tudo
await client.documents.addTags(doc.id, [tagUrgente.id]);                          // acrescenta
await client.documents.detachTag(doc.id, tagUrgente.id); // → { detached: true }
```

Os uploads são validados localmente: só arquivos `.pdf` de até 25 MB cujos bytes começam com o
cabeçalho mágico (`%PDF-`) são aceitos. A API também limita o documento a 2.000 páginas.

As URLs de página e de artefato embutidas nas respostas JSON continuam exigindo a mesma autenticação
de conta das operações de download. Prefira `documents.downloadPage()` e `documents.download()`,
que aplicam a credencial e devolvem um `Buffer`. `bundle` contém `original`, `certificated` e
`certificate-page`, mais o `pades` quando existir.

As listagens devolvem `{ data, meta }`, com `meta` preenchido a partir dos headers
`X-Pagination-*`. Dois comportamentos da API merecem atenção porque são silenciosos, não erros:

- Só o `per-page` com hífen é lido. `per_page` é aceito e ignorado, caindo para 20 linhas — por isso
  o SDK reescreve `per_page` como `per-page` em toda listagem, e um `per-page` explícito vence
  quando os dois são enviados.
- `per-page` é limitado a **50**. Pedir 100 devolve 50 linhas com `200`. A constante exportada
  `MAX_LIST_PAGE_SIZE` é esse teto; pagine com `page` em vez de pedir páginas maiores, e confie no
  `meta.per_page` mais do que no valor pedido.

### Signatários

```ts
await client.signers.create({
  full_name: 'João Silva',
  email: 'joao@exemplo.com.br',
  cpf: '123.456.789-00', // entrada de compatibilidade; não dígitos são removidos
});
// → { id: '19e6…', full_name: 'João Silva', email: 'joao@exemplo.com.br',
//     whatsapp_phone_number: null, has_accepted_terms: false }
// (observação: `cpf` é aceito na entrada, mas a API nunca o devolve)

// Ambos os contatos são opcionais. Um signatário só com nome não pode ser
// notificado até que um contato seja adicionado.
await client.signers.create({ full_name: 'Contato Pendente' });

await client.signers.get(signerId);
await client.signers.list({ page: 1, 'per-page': 50, search: 'joao' });
await client.signers.update(signerId, {
  full_name: 'João da Silva',
  government_id: '390.533.447-05', // campo oficial de atualização; enviado só com dígitos
});
await client.signers.delete(signerId);

const existente = await client.signers.findByEmail('joao@exemplo.com.br');
```

Quando um `email` é informado, `signers.create()` é idempotente por e-mail: reaproveita o signatário
existente com o mesmo endereço no workspace. Signatários sem e-mail são sempre criados do zero. Veja
[Ramos pagos de assinatura](#ramos-pagos-de-assinatura) para signatários só com telefone.

### Assignments

```ts
// Lista todos os assignments do workspace.
// → { data: IAssignment[], meta?: { current_page, per_page, total, last_page } }
const { data, meta } = await client.assignments.list({ page: 1, 'per-page': 20 });

// Signatários podem ser ids ou objetos — o SDK normaliza para o formato da API.
await client.assignments.create(documentId, {
  method: 'virtual',
  signers: ['signer-1', 'signer-2'],
  message: 'Por favor, revise e assine',
  expires_at: '2027-12-31T23:59:00Z',
  copy_receivers: ['id-do-signatario-em-copia'],
});

// Assinatura sequencial: `step` controla a ordem (paralelo dentro de um passo).
await client.assignments.create(documentId, {
  method: 'virtual',
  signers: [
    { id: 'signer-1', step: 1 },
    { id: 'signer-2', step: 2 }, // notificado só depois que o passo 1 terminar
  ],
});

// Campos de `collect` usam pixels da imagem de página a 150 DPI, medidos do canto superior esquerdo.
await client.assignments.create(documentId, {
  method: 'collect',
  signers: [{ id: signerId }],
  entries: [{
    page_id: pageId,
    fields: [{
      signer_id: signerId,
      field_id: fieldId,
      display_settings: {
        left: 69, top: 282, width: 421, height: 45.86, fontSize: 22,
        fontFamily: 'Arial', backgroundColor: '#D5EBFF',
      },
    }],
  }],
});

// Estimativa de custo (o endpoint orça descritores de canal, não IDs) → ICostEstimate
await client.assignments.estimateCost(documentId, { signers: [{}] }); // Email padrão
// → {
//   documents: 1, credits: 0, needs_extra_document: false, extra_document_cost: 0,
//   total_credits: 0, breakdown: [], document_balance: 67, credit_balance: 0,
//   has_sufficient_resources: true, blocking_reason: null, message: null
// }

await client.assignments.resetExpiration(documentId, assignmentId, '2027-06-30T00:00:00Z');
// Só compatibilidade: a requisição publicada exige uma data-hora.
// Confirme o suporte do destino antes de usar `null` para limpar a expiração.
await client.assignments.resetExpiration(documentId, assignmentId, null);

await client.assignments.resendNotification(documentId, assignmentId, signerId);
// → { is_sent: true, document_id: '…', signer_id: '…' }

const custoReenvio = await client.assignments.estimateResendCost(documentId, assignmentId, signerId);
// Resposta oficial: ICostEstimate. Deploys antigos podem devolver o ramo compacto
// IResendCostEstimate, com `total` e `has_sufficient_credits`; estreite com
// `'total_credits' in custoReenvio` antes de ler campos específicos de um ramo.
```

A resposta de `create` é um `IAssignment`: `{ id, method, signers: [...],
items: [{ display_settings, ... }], signing_urls: [{ signer_id, url }], … }`.

Por compatibilidade, o SDK também aceita os payloads antigos `signer_ids` e `signerIds` e os
reescreve no formato atual `signers: [{ id }]` esperado pela API.

**Cancelar um pedido de assinatura.** A Assinafy não tem endpoint de cancelamento do lado do
workspace. Para interromper um pedido pendente, apague o documento (quando o status permitir) ou
peça que o signatário recuse:

```ts
await client.documents.delete(documentId);                                       // lado do workspace
await client.signerDocuments.decline(documentId, assignmentId, accessCode, 'Não é mais necessário'); // lado do signatário
```

### Ramos pagos de assinatura

Mantenha o fluxo por e-mail como padrão. Habilite os ramos abaixo apenas depois de confirmar que a
conta tem o plano ou recurso necessário e que a estimativa de custo é aceitável.

O método de verificação e o de notificação são **acoplados**: envie um, os dois ou nenhum — o lado
que faltar é inferido. Sem nenhum dos dois, ambos assumem `Email`.

| Verificação | Como o signatário prova quem é | Notificação permitida | Custo por signatário |
| --- | --- | --- | --- |
| `Email` *(padrão)* | Código de uso único (OTP) por e-mail | `Email` | Gratuito |
| `Whatsapp` | Código de uso único (OTP) por WhatsApp | `Whatsapp` | 0,45 crédito (a notificação), só em planos pagos |
| `DigitalCertificate` | O signatário assina com o **próprio certificado ICP-Brasil — A1 ou A3 —** pela extensão Web PKI, gerando uma assinatura **PAdES qualificada** | `Email` **ou** `Whatsapp` | 2 créditos + a notificação |

Apenas um método de notificação por signatário. O SDK recusa uma combinação inválida antes da
requisição; a API responderia `400`.

#### Verificação e notificação por WhatsApp

Disponível apenas em assinaturas pagas, a 0,45 crédito por notificação. Crie um signatário só com
telefone (ou adicione telefone a um existente) e peça o canal `Whatsapp` explicitamente:

```ts
const signatarioTelefone = await client.signers.create({
  full_name: 'Signatário Mobile',
  whatsapp_phone_number: '+5511999990000',
});

const custoWhatsapp = await client.assignments.estimateCost(documentId, {
  method: 'virtual',
  signers: [{ verification_method: 'Whatsapp', notification_methods: ['Whatsapp'] }],
});

const assignmentWhatsapp = await client.assignments.create(documentId, {
  method: 'virtual',
  signers: [{
    id: signatarioTelefone.id,
    verification_method: 'Whatsapp',
    notification_methods: ['Whatsapp'],
  }],
});

const avisos = await client.assignments.listWhatsAppNotifications(
  documentId,
  assignmentWhatsapp.id,
);
// IWhatsAppNotification[]:
// [{ sent_at, header, body, buttons: [{ text, url? }], phone_number, signer_id }]
```

O helper de alto nível escolhe esse ramo pago automaticamente para um signatário que tenha telefone
e não tenha e-mail. As URLs dos botões podem conter credenciais do signatário — não registre em log
nem encaminhe fora do fluxo de assinatura.

#### Certificado digital ICP-Brasil

`DigitalCertificate` exige o recurso **Certificado Digital** na conta (planos Standard e Pro), CPF ou
CNPJ em `government_id` do signatário, e exatamente **um signatário por certificado naquele passo de
assinatura**. Custa 2 créditos por signatário, além do custo da notificação escolhida.

**A1 e A3 são mídias de certificado**, escolhidas pelo próprio signatário no navegador na hora de
assinar: A1 fica em software (um arquivo na máquina) e A3 em hardware (token ou cartão). A API
modela as duas com o único valor `DigitalCertificate` — não existe campo `A1`/`A3` a enviar, e a
assinatura PAdES resultante é qualificada nos dois casos.

Um CPF exige o certificado daquela pessoa (e-CPF, ou e-CNPJ que a nomeie como representante legal);
um CNPJ exige um e-CNPJ da empresa, de qualquer um dos seus representantes.

```ts
const signatarioCertificado = await client.signers.update(signerId, {
  government_id: '390.533.447-05',
});

const custoCertificado = await client.assignments.estimateCost(documentId, {
  method: 'virtual',
  signers: [{ verification_method: 'DigitalCertificate', notification_methods: ['Email'] }],
});

await client.assignments.create(documentId, {
  method: 'virtual',
  signers: [{
    id: signatarioCertificado.id,
    step: 1,
    verification_method: 'DigitalCertificate',
    notification_methods: ['Email'],
  }],
});
```

Antes de abrir o assignment, o signatário precisa confirmar os dados de identidade e aceitar os
termos, com `confirmData(..., { has_accepted_terms: true })` ou `acceptTerms()`.

O endpoint comum `sign()` **rejeita** signatários por certificado: a assinatura deles é produzida por
um handshake de dois passos com a extensão Web PKI, pela integração de navegador da Assinafy.

```
POST /v1/signers/certificate/start     → data.token   (token da operação Web PKI)
        ↓  o navegador assina o token com o certificado do signatário
POST /v1/signers/certificate/complete  → data.signerName
```

> Essas duas rotas são extensões implantadas **somente em produção**: o sandbox não as expõe e elas
> não constam do documento OpenAPI publicado.

Concluído o fluxo, `documents.download(documentId, 'pades')` devolve o artefato PAdES qualificado.

### Templates

`templates.list()` faz parte do documento OpenAPI atual. Integrações existentes também podem usar
cinco rotas de gestão de templates — `create`, `get`, `update`, `delete` e `downloadPage` — ausentes
daquele documento; veja as
[notas de compatibilidade](docs/COMPATIBILITY.md#template-management-extensions). A caixa do status
de template varia por deploy; normalize com `template.status.toLowerCase()` antes de comparar.

```ts
// Cria um template enviando um PDF (multipart). O template começa enviado e
// fica pronto quando suas páginas são processadas.
const criado = await client.templates.create(
  { filePath: './nda.pdf' },          // ou { buffer, fileName: 'nda.pdf' }
  { name: 'Template de NDA' },
);
// →
// {
//   resource: 'template', id: '1032...', name: 'nda.pdf',
//   document_name: 'nda.pdf', message: null, status: 'Uploaded',
//   roles: [{ id: '1032...', name: 'TemplateEditor', assignment_type: 'Editor' }],
//   pages: [], tags: [], created_at: '2026-…', updated_at: '2026-…'
// }

const { data, meta } = await client.templates.list({ search: 'NDA', 'per-page': 20 });
const template = await client.templates.get(criado.id);   // inclui pages[] + default_document_tags
await client.templates.update(criado.id, { name: 'NDA v2', message: 'Por favor, assine' });
const primeiraPagina = template.pages?.[0];
if (primeiraPagina) await client.templates.downloadPage(criado.id, primeiraPagina.id); // → Buffer (JPEG)
await client.templates.delete(criado.id);

// Cria um documento a partir de um template já configurado. Uploads novos têm
// apenas o papel Editor; adicione papéis de signatário no editor da Assinafy antes.
const configurado = await client.templates.get(templateId);
const papelSignatario = configurado.roles?.find(
  (papel) => typeof papel.assignment_type === 'string'
    && papel.assignment_type.toLowerCase() !== 'editor',
);
if (!papelSignatario) throw new Error('O template não tem papel de signatário');
await client.documents.createFromTemplate(
  templateId,
  [{ role_id: papelSignatario.id, id: signerId, verification_method: 'Email', notification_methods: ['Email'] }],
  { name: 'NDA - João Silva', message: 'Por favor, assine assim que puder.' },
);

// Estime o custo antes de criar → ICostEstimate
await client.documents.estimateCostFromTemplate(templateId, [
  { role_id: 'role_id', verification_method: 'Email', notification_methods: ['Email'] },
]);
// → { documents: 1, total_credits: 0, document_balance: 67, credit_balance: 0,
//     has_sufficient_resources: true, blocking_reason: null, breakdown: [], … }
```

Os descritores de signatário de template também aceitam
`verification_method: 'DigitalCertificate'`, com os mesmos pré-requisitos de
[Certificado digital ICP-Brasil](#certificado-digital-icp-brasil).

Criar um template apenas envia o PDF e provisiona o papel de editor padrão — configure papéis e
campos no editor da Assinafy depois. Os `download_url` dos objetos de página do template são URLs
protegidas; prefira `templates.downloadPage()`, que anexa a credencial da API.

### Tags

Rótulos com escopo de workspace que podem ser anexados a documentos e templates. Os nomes são únicos
por workspace (sem diferenciar maiúsculas).

```ts
await client.tags.list({ search: 'contrato' });           // ITag[]
const tag = await client.tags.create({ name: 'Contratos', color: 'ff8800' });
await client.tags.update(tag.id, { name: 'Contratos Comerciais' });
await client.tags.update(tag.id, { color: null });        // limpa a cor
await client.tags.delete(tag.id);                         // 409 se ainda estiver anexada
await client.tags.delete(tag.id, { force: true });        // desanexa de tudo e apaga
```

Anexe/desanexe tags em um documento específico com `client.documents.listTags / replaceTags /
addTags / detachTag` (veja [Documentos](#documentos)).

### Workspaces

Os schemas oficiais de criação/atualização definem `name` e `notification_sender_type`. O sandbox
também aceita os campos de cor abaixo; eles ficam mantidos como extensão de compatibilidade
documentada.

```ts
// As cores são hex de 6 caracteres SEM '#' inicial (ao contrário das tags, que o removem).
// '#ff0066' é rejeitado — os endpoints de conta querem exatamente 6 caracteres.
await client.workspaces.create({
  name: 'Meu Workspace',
  notification_sender_type: 'Account',
  primary_color: 'ff0066',
  secondary_color: '0066ff',
});
// → { id, name, primary_color: 'ff0066', secondary_color: '0066ff', created_at }
await client.workspaces.list();
await client.workspaces.get(accountId);
await client.workspaces.update(accountId, {
  name: 'Renomeado',
  notification_sender_type: 'User',
  primary_color: '112233',
});

// Identidade visual
const tema = await client.workspaces.getTheme(accountId);
const logo = await client.workspaces.downloadLogo(accountId); // Buffer
await client.workspaces.uploadLogo(accountId, { filePath: './logo.png' });
await client.workspaces.uploadLogo(accountId, {
  buffer: logoBuffer,
  fileName: 'logo.png',
  contentType: 'image/png',
});
await client.workspaces.deleteLogo(accountId);

// Últimos 12 meses por padrão; estatísticas diárias exigem um mês YYYY-MM.
await client.workspaces.getStats(accountId);
await client.workspaces.getStats(accountId, {
  granularity: 'daily',
  month: '2026-06',
});

await client.workspaces.delete(accountId);
// `force` cancela uma assinatura paga ativa como parte da exclusão da conta. Não
// é um atalho geral para outras restrições de exclusão.
await client.workspaces.delete(contaRestrita, { force: true });
```

### Definições de campo

Tipos de campo personalizados usados por assignments com método `collect`.

```ts
await client.fields.create({ type: 'text', name: 'Número do contrato' });
await client.fields.list({ include_inactive: true, include_standard: true });
await client.fields.get(fieldId);
await client.fields.update(fieldId, { name: 'Nome atualizado' });
await client.fields.delete(fieldId);

// Valida um único valor (o código de acesso só é exigido nas chamadas do signatário)
await client.fields.validate(fieldId, '400.676.228-36', { signerAccessCode });

// Valida vários valores de uma vez
await client.fields.validateMultiple(
  [
    { field_id: 'f1', value: '1111111111111' },
    { field_id: 'f2', value: 'valor@exemplo.com.br' },
  ],
  { signerAccessCode },
);

// Catálogo de todos os tipos de campo reconhecidos pela plataforma
await client.fields.listTypes();
```

### Autenticação / gestão de chaves de API

A maioria das integrações de servidor deve usar `X-Api-Key` diretamente. Use estes endpoints quando
precisar abrir uma sessão para uma pessoa. Para apps conectados por terceiros, use
[Aplicações OAuth](#aplicações-oauth).

```ts
// OAuth de navegador (rota de compatibilidade): redirecione o usuário para esta URL.
// O helper de callback devolve a URL de retorno da Assinafy para configurar o
// provedor; nenhum dos dois segue o redirecionamento.
const inicioOauth = client.auth.getSocialLoginUrl('google');
const callbackOauth = client.auth.getSocialLoginCallbackUrl();

const { access_token, user, accounts } = await client.auth.login('eu@exemplo.com.br', 'senha');
await client.auth.socialLogin({ provider: 'google', token: 'google-id-token', has_accepted_terms: true });
await client.auth.linkSocialLogin({ provider: 'google', token: 'google-id-token' });

// Chave de API pessoal
await client.auth.createApiKey('senha-atual');
await client.auth.getApiKey();                     // → { api_key: '****...nBNr' } ou null
await client.auth.deleteApiKey();

// Ciclo de vida da senha
await client.auth.changePassword({ email, password: 'atual', new_password: 'nova' });
await client.auth.requestPasswordReset('eu@exemplo.com.br');
await client.auth.resetPassword({ email, token: 'tk', new_password: 'nova' });
```

### Usuário autenticado

```ts
const usuario = await client.users.getCurrent();
// → { id, name, email, telephone, government_id, is_email_verified,
//     has_accepted_terms, created_at, to_be_deleted_at }

// Funil de documentos entre contas, últimos 12 períodos mensais por padrão.
const mensal = await client.users.getStats();
const diario = await client.users.getStats({
  granularity: 'daily',
  month: '2026-06',
});
// Cada linha traz período, totais de envio/remessa/certificação, contagens de
// notificação por e-mail/WhatsApp/bypass, contagens de verificação por
// e-mail/WhatsApp/bypass/certificado digital, visualizados e concluídos.

const preferencias = await client.users.getNotificationPreferences();
await client.users.updateNotificationPreferences({
  SignerDeclined: false,
  DocumentExpired: false,
});
// A atualização é um merge: chaves omitidas mantêm o valor atual. Os dois
// métodos devolvem o mapa completo de nove preferências.
```

### Webhooks

Tokens OAuth exigem `webhooks:write` para `register()` e `inactivate()`.

```ts
await client.webhooks.register({
  url: 'https://exemplo.com.br/webhooks/assinafy',
  email: 'admin@exemplo.com.br',
  is_active: true,
  // `events` assume o conjunto padrão do SDK, abaixo
  events: [
    'document_ready',
    'document_prepared',
    'signer_signed_document',
    'signer_rejected_document',
    'document_processing_failed',
  ],
});

await client.webhooks.get();          // IWebhookSubscription | null
await client.webhooks.inactivate();   // interrompe entregas (não existe rota de exclusão)
await client.webhooks.listEventTypes();
const historico = await client.webhooks.listDispatches({
  delivered: false,
  page: 1,
  'per-page': 20,
}); // { data: IWebhookDispatch[], meta?: PaginationMeta }
const reenviado = await client.webhooks.retryDispatch(dispatchId); // IWebhookDispatch
```

`register` envia `{ events, is_active, url, email }` e devolve
`{ events, is_active, url, email, updated_at? }`. A Assinafy entrega cada evento como um `POST` HTTP
com `Content-Type: application/json` e `Connection: close`. Qualquer `2xx` é sucesso. São no máximo
duas tentativas automáticas, com três segundos de intervalo. Depois de dez eventos falhos
consecutivos, a entrega comum é pausada e cerca de 5% dos eventos seguintes são tentados até um dar
certo; use `retryDispatch()` para reenviar manualmente na hora. O histórico guarda apenas os
primeiros 2.000 caracteres do corpo de resposta do receptor.

Cada item do histórico (ou resultado de reenvio) é um `IWebhookDispatch`:

```ts
{
  resource?: string;
  id: string;
  event: string;
  activity_id: number;
  endpoint: string | null;
  payload: IWebhookPayload | Record<string, unknown> | null;
  delivered: boolean;
  http_status: number | null;
  response_body: string | null;
  error: string | null;
  created_at: string;
  updated_at?: string;
}
```

Todo corpo de entrega usa este envelope:

```ts
{
  id: number;                         // use para processamento idempotente
  event: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  origin: { ip?: string; 'user-agent'?: string } | null;
  created_at: number;                 // segundos Unix
  subject: { type: 'User' | 'Signer' | 'Account' | 'Document' | 'Template'; [key: string]: unknown };
  object: { type: 'User' | 'Signer' | 'Account' | 'Document' | 'Template'; [key: string]: unknown };
  account_id: string;
}
```

Os valores por evento são:

| `event` | `subject.type` | `object.type` | chaves de `payload` |
| --- | --- | --- | --- |
| `document_uploaded` | `User` | `Document` | — |
| `document_metadata_ready` | `User` | `Document` | — |
| `document_prepared` | `User` | `Document` | — |
| `assignment_created` | `User` | `Document` | `user_name`, `user_email`, `user_telephone` |
| `document_ready` | `Account` | `Document` | — |
| `document_processing_failed` | `Account` | `Document` | `error_message` |
| `signature_requested` | `User` | `Document` | `signer_email`, `signer_full_name` ou `signer_whatsapp_phone_number`, conforme o canal |
| `signer_created` | `User` | `Signer` | `signer_full_name` |
| `signer_email_verified` | `Signer` | `Document` | `signer_email` |
| `signer_whatsapp_verified` | `Signer` | `Document` | `signer_whatsapp_phone_number` |
| `signer_data_confirmed` | `Signer` | `Document` | `signer_email` |
| `signer_viewed_document` | `Signer` | `Document` | `signer_full_name` |
| `signer_signed_document` | `Signer` | `Document` | `signer_full_name` |
| `signer_rejected_document` | `Signer` | `Document` | `signer_full_name` |
| `user_rejected_document` | `User` | `Document` | `user_name` |
| `template_created` | `User` | `Template` | — |
| `template_processed` | `User` | `Template` | — |
| `template_processing_failed` | `Account` | `Template` | `error_message` |

`payload`, `subject` e `object` dependem do evento. Aceite campos desconhecidos para compatibilidade
futura e só confirme o recebimento depois de um processamento durável e idempotente. Respostas
não-`2xx`, timeouts e falhas de conexão contam como entregas falhas. `assignment_created` e
`document_metadata_ready` não têm ordem garantida. Para entidades de conta, a Assinafy remove a
propriedade `integration` antes de entregar.

### Verificação de webhooks

`WebhookVerifier` é um utilitário HMAC-SHA256 opcional, para integrações cujo ambiente Assinafy
forneça um segredo compartilhado e um header de assinatura. O documento OpenAPI oficial atual
**não** define esquema nem nome de header de assinatura de webhook. Confirme o contrato de entrega
do seu ambiente antes de habilitar essa checagem; não rejeite callbacks de produção com base em um
header presumido. O exemplo abaixo usa um nome de header configurado pela aplicação.

```ts
import express from 'express';

const webhookSecret = process.env.ASSINAFY_WEBHOOK_SECRET;
const signatureHeader = process.env.ASSINAFY_SIGNATURE_HEADER;
if (!webhookSecret || !signatureHeader) {
  throw new Error('Este ambiente não tem contrato confirmado de assinatura de webhook');
}

const webhookClient = new AssinafyClient({ webhookSecret });

app.post('/webhooks/assinafy', express.raw({ type: 'application/json' }), (req, res) => {
  const assinatura = req.header(signatureHeader) ?? '';
  const corpoBruto = req.body as Buffer;

  if (!webhookClient.webhookVerifier.verify(corpoBruto, assinatura)) {
    return res.status(401).send('Assinatura inválida');
  }

  const evento = webhookClient.webhookVerifier.extractEvent(corpoBruto);
  const tipo = webhookClient.webhookVerifier.getEventType(evento);
  const dados = webhookClient.webhookVerifier.getEventData(evento);

  switch (tipo) {
    case 'document_ready':             break;
    case 'signer_signed_document':     break;
    case 'signer_rejected_document':   break;
    case 'document_processing_failed': break;
  }
  res.sendStatus(200);
});
```

### Endpoints do signatário

Para construir portais de assinatura próprios. Quase todas as chamadas exigem o parâmetro de URL
`signer-access-code` que a Assinafy envia ao signatário por e-mail/WhatsApp. O download de artefato
é a exceção pública documentada; seu quarto argumento opcional de código de acesso existe apenas por
compatibilidade com deploys que ainda esperam a query antiga.

```ts
await client.signerDocuments.self(accessCode);
await client.signerDocuments.verifyEmail({ signerAccessCode: accessCode, verificationCode: '123456' });

await client.signerDocuments.getCurrent(signerId, accessCode);
const { data } = await client.signerDocuments.list(signerId, accessCode, { 'per-page': 20 });
// Equivalente a documents.search() do lado do signatário, autorizado pelo código de acesso.
const achados = await client.signerDocuments.search(signerId, accessCode, 'nota fiscal');
await client.signerDocuments.download(signerId, documentId, 'original');
// Disponível só depois que um signatário por certificado ICP-Brasil concluir a assinatura.
await client.signerDocuments.download(signerId, documentId, 'pades');

await client.signerDocuments.confirmData(documentId, accessCode, {
  email: 'eu@exemplo.com.br',
  full_name: 'Signatário Exemplo',
  government_id: '123.456.789-00',
  has_accepted_terms: true,
});
// Como alternativa, aceite os termos separadamente antes de getAssignment():
// await client.signerDocuments.acceptTerms(accessCode);

// Gestão da imagem de assinatura ({ reuse: true } guarda para documentos futuros)
await client.signerDocuments.uploadSignature(accessCode, pngBuffer, { imageType: 'signature', reuse: true });
await client.signerDocuments.downloadSignature(accessCode, 'signature');

// Assinar / recusar
const assinavel = await client.signerDocuments.getAssignment(accessCode);
// `sign()` é para assignments collect e exige o valor de cada campo posicionado.
await client.signerDocuments.sign(documentId, assignmentId, accessCode, [
  { itemId, fieldId, pageId, value: 'Assinado por João' },
]);
await client.signerDocuments.decline(documentId, assignmentId, accessCode, 'Sem autorização');

// `signMultiple()` é só para assignments virtual.
await client.signerDocuments.signMultiple(['doc-1', 'doc-2'], accessCode);
await client.signerDocuments.declineMultiple(['doc-1'], 'Condições desfavoráveis', accessCode);
```

`sign()` também exige que signatários virtuais já tenham confirmado os dados, mas assignments
virtuais normalmente devem usar `signMultiple()`. Signatários por certificado não podem usar
`sign()`; veja [Ramos pagos de assinatura](#ramos-pagos-de-assinatura).

## Helper de alto nível

Envia um PDF, reaproveita ou cria signatários por e-mail, cria um assignment virtual imediatamente e,
opcionalmente, espera o processamento antes de retornar.

```ts
const resultado = await client.uploadAndRequestSignatures({
  source: { filePath: './contrato.pdf' },
  signers: [
    { name: 'João', email: 'joao@exemplo.com.br' },
    { name: 'Maria', email: 'maria@exemplo.com.br' },
  ],
  message: 'Por favor, assine',
  metadata: { ano: 2026 }, // parte de compatibilidade; omita para o formato só-arquivo
  waitForReady: true,
  waitOptions: { maxWaitMs: 30_000, pollIntervalMs: 1_000 },
  expiresAt: '2027-12-31T00:00:00Z',
  copyReceivers: ['id-de-signatario-em-copia'],
});

resultado.document;   // IDocumentDetailsResponse já processado (waitForReady: true, o padrão);
                      // o IDocumentUploadResponse cru quando waitForReady: false
resultado.assignment; // IAssignment
resultado.signer_ids; // string[]
```

`waitForReady: false` pula a espera pós-assignment e devolve a resposta inicial do upload. Com o
padrão `true`, o helper cria o assignment primeiro e só então espera os detalhes atuais do
documento. Produção e sandbox permitem assignments virtuais em `uploaded` e `metadata_processing` e
os promovem automaticamente; só assignments `collect` exigem páginas renderizadas. Todos os
signatários acima usam o canal de e-mail padrão. Um signatário só com telefone seleciona o ramo pago
de WhatsApp descrito antes. `copyReceivers` aceita IDs de signatários existentes, não endereços de
e-mail; confira o assignment devolvido antes de considerar uma cópia registrada.

O helper não é transacional. Um erro depois do assignment inclui `documentId`, `assignmentId` e
`signerIds` criados no `context` do erro (e em `ValidationError.errors` para timeouts); inspecione
esses IDs antes de decidir se repete o fluxo.

## Erros

Os métodos HTTP rejeitam com uma subclasse de `AssinafyError`. Helpers síncronos como
`getSocialLoginUrl()` e `readAuthorizationCallback()` podem lançar antes de qualquer requisição.

| Classe | Quando | O que inspecionar |
| --- | --- | --- |
| `ValidationError` | O SDK recusou a entrada antes de enviar | `err.errors` |
| `OAuthError` | Um endpoint OAuth devolveu `{ error, error_description }`, ou o callback trouxe `?error=` | `err.error`, `err.errorDescription` |
| `ApiError` | A API respondeu com status de falha | `err.statusCode`, `err.responseData`, `err.challenge` |
| `NetworkError` | DNS, conexão ou timeout | `err.message` (já sem credenciais) |
| `AssinafyError` | Classe base de todas as acima | `err.context` |

```ts
import { ApiError, OAuthError, ValidationError, NetworkError, AssinafyError } from '@assinafy/sdk';

try {
  await client.documents.upload({ filePath: './x.pdf' });
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('Falha de validação:', err.errors);
  } else if (err instanceof OAuthError) {
    // OAuthError estende ApiError; ramifique pelo código RFC 6749, não pela mensagem.
    console.error('Erro OAuth:', err.error, err.errorDescription);
  } else if (err instanceof ApiError) {
    console.error(`Erro da API ${err.statusCode}:`, err.responseData);
    // `err.challenge` traz o header WWW-Authenticate já interpretado quando a API
    // envia um — em um 403 ele nomeia o escopo OAuth que está faltando.
  } else if (err instanceof NetworkError) {
    console.error('Erro de rede:', err.message);
  } else if (err instanceof AssinafyError) {
    console.error('Erro do SDK:', err.message, err.context);
  }
}
```

## Ambientes

| | |
| --- | --- |
| Produção | `https://api.assinafy.com.br/v1` |
| Sandbox | `https://sandbox.assinafy.com.br/v1` |

O sandbox tem servidor de autorização próprio em `https://auth-sandbox.assinafy.com.br`, com a tela
de consentimento em `/oauth/authorize`. Os documentos de descoberta dele não são alcançáveis:
o nginx recusa caminhos iniciados por ponto, então informe os endpoints explicitamente:

```ts
const client = new AssinafyClient({ baseUrl: 'https://sandbox.assinafy.com.br/v1' });

const requisicao = await client.oauth.createAuthorizationUrl({
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  redirectUri: 'https://meuapp.com.br/oauth/callback',
  scopes: ['documents:read'],
  issuer: 'https://auth-sandbox.assinafy.com.br',
  authorizationEndpoint: 'https://auth-sandbox.assinafy.com.br/oauth/authorize',
});
```

Os endpoints de token, revogação e userinfo seguem o `baseUrl` configurado. Confirme que o sandbox
os expõe antes de rodar a etapa de troca por lá — veja
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Desenvolvimento

```bash
bun install --frozen-lockfile
bun run typecheck    # tipos de src, scripts e testes
bun run lint
bun test             # suítes bun:test
bun run test:coverage
bun run build        # tsup → dist/ (CJS + ESM + .d.ts)
bun run lint:pkg     # publint + arethetypeswrong
bun run audit:api    # confere o SDK contra o OpenAPI publicado
bun run verify       # portão completo de release local
```

## Documentação

- **[README.en.md](README.en.md)** — a mesma referência completa, em inglês
- [docs/API_COVERAGE.md](docs/API_COVERAGE.md) — mapa de operações
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — variações de requisição e resposta por deploy
- [docs/RELEASING.md](docs/RELEASING.md) — processo de publicação
- [Documentação da API](https://api.assinafy.com.br/v1/docs)

## Licença

Distribuído sob a licença [MIT](LICENSE).
