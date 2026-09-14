# @assinafy/sdk

*Português · [Read in English](README.en.md)*

SDK oficial em TypeScript para a [API Assinafy](https://api.assinafy.com.br/v1/docs) — plataforma
brasileira de assinatura eletrônica de documentos.

Cobre as 89 operações do documento OpenAPI oficial: contas, autenticação, usuários, documentos,
assignments, signatários, fluxos do lado do signatário, templates, tags, campos, webhooks, identidade
visual, estatísticas e o fluxo de alto nível `uploadAndRequestSignatures`.

> **Referência completa em inglês.** Este documento cobre instalação, autenticação e os fluxos
> principais. O manual de referência por recurso — com todos os métodos, payloads e exemplos — está em
> **[README.en.md](README.en.md)**.

## Requisitos

- Node.js 22+ (usa as APIs nativas `FormData` / `Blob` para upload). Os imports CJS e ESM empacotados
  são testados no 22 (LTS de manutenção), 24 (LTS ativo) e 26 (Current). O Node 20 chegou ao fim da
  vida em abril de 2026 e não é suportado.
- ou Bun 1.4.0 (versão fixada no desenvolvimento e na CI)

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

A API aceita dois métodos. Prefira `apiKey` — corresponde ao header `X-Api-Key`, recomendado pela
Assinafy para serviços de back-end.

```ts
// Preferido: header X-Api-Key
new AssinafyClient({ apiKey: 'k_xxx', accountId: 'acc_xxx' });

// Token de acesso: Authorization: Bearer <token>
new AssinafyClient({ token: 'jwt_xxx', accountId: 'acc_xxx' });
```

As credenciais são opcionais na construção. Um cliente sem credenciais usa um transporte separado,
sem autenticação, para as operações públicas e as que usam código de acesso do signatário — assim uma
chave de API ou token Bearer nunca é anexada por acidente:

```ts
const clientePublico = new AssinafyClient({
  baseUrl: 'https://sandbox.assinafy.com.br/v1',
});

await clientePublico.auth.login('eu@exemplo.com.br', 'senha');
await clientePublico.documents.getPublic(documentId);
await clientePublico.signerDocuments.self(signerAccessCode);
```

Métodos protegidos continuam exigindo `apiKey` ou `token`; sem credencial, a API devolve o `401`
normal.

Todos os transportes do SDK — inclusive os públicos e os por código de acesso — enviam
`User-Agent: Assinafy-Typescript-SDK/v<VERSÃO>`. O valor exato também é exportado como
`SDK_USER_AGENT`.

## Configuração

| Opção           | Tipo     | Padrão                           | Descrição |
| --------------- | -------- | -------------------------------- | --------- |
| `apiKey`        | string   | —                                | Credencial preferida (enviada como `X-Api-Key`). |
| `token`         | string   | —                                | Token de acesso (enviado como `Authorization: Bearer`). |
| `accountId`     | string   | —                                | ID padrão da conta / workspace. |
| `baseUrl`       | string   | `https://api.assinafy.com.br/v1` | Base absoluta da API, sem credenciais, query ou fragmento. Precisa ser `https`, salvo em loopback. |
| `webhookSecret` | string   | —                                | Segredo HMAC opcional usado pelo `WebhookVerifier`. |
| `timeout`       | number   | `30000`                          | Timeout da requisição, em milissegundos. |
| `maxRetries`    | number   | `2`                              | Retenta automaticamente respostas `429` elegíveis, respeitando `Retry-After`. `0` desativa. |
| `logger`        | `Logger` | no-op                            | Logger opcional `{debug,info,warn,error}`. |

## Métodos de verificação do signatário

Definidos por signatário em `signers[].verification_method` ao criar o assignment. O método de
verificação e o de notificação são **acoplados**: envie um, os dois ou nenhum — o lado que faltar é
inferido. Sem nenhum dos dois, ambos assumem `Email`.

| Método | Como funciona | Custo por signatário |
| --- | --- | --- |
| `Email` *(padrão)* | Código de uso único (OTP) por e-mail, exigido antes de assinar | Gratuito |
| `Whatsapp` | Código de uso único (OTP) por WhatsApp | Verificação gratuita; notificação 0,45 crédito, só em planos pagos |
| `DigitalCertificate` | O signatário assina com o **próprio certificado ICP-Brasil (A1/A3)**, pela extensão de navegador Web PKI, gerando uma assinatura **PAdES qualificada** | 2 créditos |

Combinações permitidas: `Email` → notifica por `Email`; `Whatsapp` → notifica por `Whatsapp`;
`DigitalCertificate` → notifica por `Email` **ou** `Whatsapp`. Apenas um método de notificação por
signatário.

## Ramos pagos de assinatura

Mantenha o fluxo por e-mail como padrão. Habilite os ramos abaixo apenas depois de confirmar que a
conta tem o plano ou recurso necessário e que a estimativa de custo é aceitável.

### Verificação e notificação por WhatsApp

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
```

O helper de alto nível escolhe esse ramo pago automaticamente para um signatário que tenha telefone e
não tenha e-mail. As URLs dos botões podem conter credenciais do signatário — não registre em log nem
encaminhe fora do fluxo de assinatura.

### Certificado digital ICP-Brasil

`DigitalCertificate` exige o recurso **Certificado Digital** na conta (planos Standard e Pro), CPF ou
CNPJ em `government_id` do signatário, e exatamente **um signatário por certificado naquele passo de
assinatura**. Custa 2 créditos por signatário, além do custo da notificação escolhida.

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

## Trilha de atividades e artefatos

`documents.activities(documentId)` devolve todos os eventos registrados do documento, cada um com um
snapshot do `payload` do evento e a `origin` da requisição (`ip`, `user-agent`).

`documents.download(documentId, artefato)` aceita:

| Artefato | Conteúdo |
| --- | --- |
| `original` | O PDF enviado, como recebido |
| `certificated` | O documento assinado, com a certificação da plataforma |
| `certificate-page` | Apenas a página de certificação |
| `pades` | Assinaturas ICP-Brasil dos signatários + caixa de certificação da plataforma — só existe em documentos que tiveram signatários por certificado digital |
| `bundle` | Zip com `original`, `certificated` e `certificate-page`, mais o `pades` quando houver |

`documents.verify(documentSignatureHash)` confere um documento assinado pelo hash da assinatura, sem
autenticação.

## Cobertura de endpoints

As 89 operações documentadas em https://api.assinafy.com.br/v1/docs estão cobertas. Resumo por
recurso — o mapa detalhado por operação está em [docs/API_COVERAGE.md](docs/API_COVERAGE.md).

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
| `client.auth` | getSocialLoginUrl, getSocialLoginCallbackUrl, login, socialLogin, linkSocialLogin, createApiKey, getApiKey, deleteApiKey, changePassword, requestPasswordReset, resetPassword |
| `client.users` | getCurrent, getStats, getNotificationPreferences, updateNotificationPreferences |
| `client.signerDocuments` | getCurrent, list, search, download, signMultiple, declineMultiple, self, acceptTerms, verifyEmail, confirmData, uploadSignature, downloadSignature, getAssignment, sign, decline |
| `client.webhookVerifier` | verify, extractEvent, getEventType, getEventData |

Todo wrapper HTTP tem tipos de requisição e resposta verificados pelo TypeScript e JSDoc por método,
cobrindo o payload de rede, o formato de retorno, validação, erros relevantes da API e um exemplo
copiável. As declarações acompanham o pacote.

## Ambientes

| | |
| --- | --- |
| Produção | `https://api.assinafy.com.br/v1` |
| Sandbox | `https://sandbox.assinafy.com.br/v1` |

O sandbox é gratuito e espelha a produção para testar a integração de ponta a ponta — com a exceção
das rotas de certificado digital, que existem apenas em produção.

## Documentação

- **[README.en.md](README.en.md)** — referência completa por recurso, em inglês
- [docs/API_COVERAGE.md](docs/API_COVERAGE.md) — mapa de operações
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — variações de requisição e resposta por deploy
- [Documentação da API](https://api.assinafy.com.br/v1/docs)

## Licença

Distribuído sob a licença [MIT](LICENSE).
