# x402-bch Protocol Specification

**Document Scope**

This specification defines the x402-bch protocol, an adaptation of the x402 internet-native payments standard for the Bitcoin Cash (BCH) blockchain. It details the BCH-specific data structures, message flows, verification rules, and facilitator interfaces that enable HTTP 402-powered access to APIs and resources.

The document covers:

- Protocol fundamentals tailored to UTXO-based blockchains
- BCH-specific payment payloads and validation logic
- Facilitator responsibilities for UTXO verification and debit tracking
- Error handling and security considerations unique to BCH

**Out of Scope**

- Transport-specific wire formats beyond HTTP (e.g., MCP, A2A)
- Client wallet UX patterns or budget management policies
- Server-specific pricing strategies or dynamic pricing logic
- Facilitator infrastructure scaling and monitoring guidance

**Architecture**

x402-bch retains the core x402 actor model—Clients, Servers, and Facilitators—while reorienting settlement around BCH UTXOs:

1. **Types**: JSON schemas for BCH payment requirements, payment payloads, facilitator responses, and UTXO ledger entries
2. **Logic**: UTXO validation, signature verification, debit accounting, and replay protection
3. **Representation**: HTTP headers (`X-PAYMENT`, `X-PAYMENT-RESPONSE`) and REST APIs used to negotiate and verify BCH payments

---

## 1. Overview

x402-bch extends the x402 protocol to networks where value transfer is handled through unspent transaction outputs (UTXOs). Instead of authorization-based ERC-20 transfers, clients prepay servers directly in BCH and present signed proofs that reference funded UTXOs. Servers use a facilitator to verify that each request debits from a valid, adequately funded UTXO until the prepaid balance is exhausted.

Key differentiators from the Base/USDC reference implementation:

- **Direct settlement**: Clients broadcast the on-chain BCH payment; facilitators never custody funds.
- **Batch debiting**: A single UTXO funds multiple requests by decrementing an off-chain ledger maintained by the facilitator.
- **Lightweight signatures**: BCH `signMessage`/`verifyMessage` primitives authenticate authorization payloads instead of EIP-712.
- **UTXO introspection**: Facilitators query blockchain state and persist UTXO balances in LevelDB for replay and double-spend protection.

---

## 2. Core Payment Flow

The BCH payment loop mirrors the canonical x402 flow with UTXO-specific nuances:

1. **Initial Request**: Client calls a protected resource without a payment header.
2. **Payment Required Response**: Server responds with HTTP 402, including BCH `PaymentRequirements` describing the minimum satoshis, recipient address, and metadata.
3. **Funding Transaction (off-band)**: The client optionally broadcasts a BCH transaction that funds a reusable UTXO for subsequent requests.
4. **Signed Authorization**: For the retry, the client attaches an `X-PAYMENT` header referencing the funded UTXO, the amount to debit, and a signature proving control of the payer address.
5. **Facilitator Verification**: The server forwards the payment payload and requirements to the facilitator `/verify` endpoint. The facilitator validates the signature, confirms the UTXO exists and pays the server address, and decrements the available balance in its ledger.
6. **Resource Response**: Upon successful verification, the server processes the request and returns the protected resource (e.g., HTTP 200) with an optional `X-PAYMENT-RESPONSE`.

Repeated calls reuse the same UTXO until the facilitator’s ledger indicates the prepaid balance is exhausted, at which point the client must fund a new UTXO.

---

## 3. Protocol Components

- **Client**: Manages BCH keys, broadcasts funding transactions, and signs authorization payloads that reference funded UTXOs. Responsible for tracking when a new UTXO is needed.
- **Resource Server**: Exposes HTTP endpoints and enforces payment requirements. Delegates BCH validation to the facilitator while remaining the ultimate recipient of funds.
- **Facilitator**: Stateless with respect to custody, but stateful regarding UTXO accounting. Verifies signatures, checks blockchain state, tracks remaining satoshis for each `(txid, vout)`, and returns verification decisions to the server.

---

## 4. Response Types

x402-bch reuses the x402 semantic response categories, mapped to HTTP status codes:

- **Success (200/2xx)**: Payment verified and request fulfilled.
- **Payment Required (402)**: Payment missing, invalid, or insufficient; includes BCH payment requirements.
- **Invalid Request (400/422)**: Malformed payment payload or unsupported scheme/network.
- **Server Error (500)**: Facilitator or server experienced an unexpected error during verification.

---

## 5. Types

x402-bch introduces BCH-specific fields on top of the base x402 schemas. All JSON examples use UTF-8 encoding and should be serialized without additional whitespace in transport headers.

### 5.1 PaymentRequirementsResponse Schema

#### 5.1.1 JSON Payload

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "utxo",
      "network": "bch",
      "minAmountRequired": "1000",
      "asset": "0x0000000000000000000000000000000000000001",
      "payTo": "bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d",
      "resource": "http://localhost:4021/weather",
      "description": "Access to weather data",
      "mimeType": "application/json",
      "outputSchema": {
        "input": {
          "type": "http",
          "method": "GET",
          "discoverable": true
        }
      },
      "maxTimeoutSeconds": 60,
      "extra": {}
    }
  ]
}
```

#### 5.1.2 Field Descriptions

| Field Name | Type | Required | Description |
| ---------- | ---- | -------- | ----------- |
| `x402Version` | `number` | Required | Protocol version (must equal `1`). |
| `error` | `string` | Required | Human-readable reason the payment is required. |
| `accepts` | `array` | Required | List of acceptable BCH payment options. |

Each BCH `PaymentRequirements` object within `accepts` includes:

| Field Name | Type | Required | Description |
| ----------- | ---- | -------- | ----------- |
| `scheme` | `string` | Required | Must be `utxo` for BCH debit-by-UTXO scheme. |
| `network` | `string` | Required | Blockchain identifier (`bch` or other BCH-compatible network keys). |
| `minAmountRequired` | `string` | Required | Minimum satoshis to debit for the current request. Expressed as a string to avoid precision loss. |
| `asset` | `string` | Optional | Token identifier; `0x...01` denotes native BCH. |
| `payTo` | `string` | Required | Server-controlled BCH cash address expected to receive funding payments. |
| `resource` | `string` | Required | Fully-qualified URL of the protected resource. |
| `description` | `string` | Required | Human-readable description of the resource. |
| `mimeType` | `string` | Optional | Response MIME type. |
| `outputSchema` | `object` | Optional | JSON schema describing input/output expectations. |
| `maxTimeoutSeconds` | `number` | Required | Maximum time between 402 response and valid authorization submission. |
| `extra` | `object` | Optional | Reserved for scheme-specific hints (e.g., recommended funding multiple). |

> **Note**: Servers may advertise higher `minAmountRequired` values than the actual call cost to encourage batching. Facilitators enforce the provided value per request.

### 5.2 PaymentPayload Schema

#### 5.2.1 JSON Structure

The BCH client serializes `PaymentPayload` directly into the `X-PAYMENT` header as a JSON string (no base64 encoding):

```json
{
  "x402Version": 1,
  "scheme": "utxo",
  "network": "bch",
  "payload": {
    "signature": "IL+rKU8JQz3lTGv4v1sLxojclXMoMLBQniS1h9wLutc8KToVnsVPC0+2S8ifZ5rjIlZJ7GrD7kg3m+tuRnQM+qA=",
    "authorization": {
      "from": "bitcoincash:qz9s2mccqamzppfq708cyfde5ejgmsr9hy7r3unmkk",
      "to": "bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d",
      "value": "1000",
      "txid": "b74dcfc839eb3693be811be64e563171d83e191388fdda900f2d3b952df01ba7",
      "vout": 0,
      "amount": "2000"
    }
  }
}
```

#### 5.2.2 Field Descriptions

| Field Name | Type | Required | Description |
| ----------- | ---- | -------- | ----------- |
| `x402Version` | `number` | Required | Protocol version (must match requirements). |
| `scheme` | `string` | Required | `utxo`. |
| `network` | `string` | Required | `bch` (or compatible network id announced by the server). |
| `payload` | `object` | Required | BCH-specific payload data. |

Within `payload`:

| Field Name | Type | Required | Description |
| ----------- | ---- | -------- | ----------- |
| `signature` | `string` | Required | Base64-encoded result of `BitcoinCash.signMessageWithPrivKey`. |
| `authorization` | `object` | Required | UTXO debit authorization. |

The `authorization` object contains:

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `from` | `string` | Required | Cash address of the payer; used for signature verification. |
| `to` | `string` | Required | Server’s BCH cash address; must match payment requirements. |
| `value` | `string` | Required | Satoshis to debit for this request (typically equal to `minAmountRequired`). |
| `txid` | `string` | Required | Transaction hash funding the reusable UTXO. |
| `vout` | `number` | Required | Output index within `txid` that holds the funds. |
| `amount` | `string` | Required | Total satoshis originally sent in the funding UTXO (>= `value`). |

The facilitator recomputes `JSON.stringify(authorization)` and checks it against the provided signature.

### 5.3 PaymentVerificationResponse Schema

Facilitators return verification results to servers (and optionally to clients via `X-PAYMENT-RESPONSE`) using the following schema:

```json
{
  "isValid": true,
  "payer": "bitcoincash:qz9s2mccqamzppfq708cyfde5ejgmsr9hy7r3unmkk",
  "remainingBalanceSat": "9000",
  "ledgerEntry": {
    "utxoId": "b74dcfc839eb3693be811be64e563171d83e191388fdda900f2d3b952df01ba7:0",
    "transactionValueSat": "20000",
    "totalDebitedSat": "11000",
    "lastUpdated": "2025-11-08T17:05:42.000Z"
  }
}
```

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `isValid` | `boolean` | Required | Indicates whether the authorization passes verification. |
| `payer` | `string` | Required | Payer cash address derived from the authorization. |
| `invalidReason` | `string` | Optional | Error code when `isValid` is `false`. |
| `remainingBalanceSat` | `string` | Optional | Facilitator ledger’s remaining satoshis for the UTXO after this debit. |
| `ledgerEntry` | `object` | Optional | Snapshot of the facilitator’s internal UTXO record for observability. |

Present implementations return `isValid`, `payer`, and `invalidReason`; the additional fields are recommended for transparency but may be omitted.

### 5.4 SettlementResponse Schema

Because BCH funds move on-chain before verification, settlement primarily confirms the facilitator’s final decision or reconciliation event:

```json
{
  "success": true,
  "payer": "bitcoincash:qz9s2mccqamzppfq708cyfde5ejgmsr9hy7r3unmkk",
  "transaction": "b74dcfc839eb3693be811be64e563171d83e191388fdda900f2d3b952df01ba7",
  "network": "bch",
  "remainingBalanceSat": "0"
}
```

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `success` | `boolean` | Required | Facilitator was able to reconcile the payment. |
| `errorReason` | `string` | Optional | Code describing why settlement failed. |
| `transaction` | `string` | Required | Funding transaction hash; empty string if settlement failed. |
| `network` | `string` | Required | `bch`. |
| `payer` | `string` | Required | Payer address. |
| `remainingBalanceSat` | `string` | Optional | Balance remaining in facilitator ledger. |

---

## 6. Payment Scheme: UTXO Debit

### 6.1 Authorization Format

- **Message**: `JSON.stringify(authorization)` using canonical key ordering as emitted by the client library.
- **Signing**: Client calls `BitcoinCash.signMessageWithPrivKey(privateKeyWIF, message)`.
- **Verification**: Facilitator executes `BitcoinCash.verifyMessage(from, signature, message)` to authenticate the payer.
- **UTXO Identification**: Combination of `txid` and `vout` uniquely identifies the prepaid UTXO (`utxoId`).

### 6.2 Facilitator Verification Steps

1. **Schema Validation**: Ensure payload fields are present and match the advertised scheme/network.
2. **Signature Validation**: Reconstruct the message and verify signature against the `from` address.
3. **Requirement Matching**: Confirm `to`, `value`, and `network` align with the server’s payment requirements.
4. **UTXO Discovery**: Fetch the referenced UTXO via BCH APIs to confirm existence, ownership, and raw value.
5. **Receiver Check**: Ensure the UTXO pays the server’s advertised `payTo` address.
6. **Balance Check**: Compare `utxoAmountSat` with requested debit; reject if insufficient.
7. **Double-Spend Mitigation**: Record `(txid, vout)` in LevelDB and update `remainingBalanceSat`. Reject if balance would go negative.
8. **Ledger Update**: Persist `totalDebitedSat`, `remainingBalanceSat`, and timestamps for auditability.

Facilitators may optionally revalidate UTXO confirmations after a configurable interval (`minConfirmations`) to guard against chain reorganizations.

### 6.3 Debit Tracking Model

- **Initial Funding**: First verification inserts a ledger record with the full funding amount and initial debit.
- **Subsequent Calls**: Each verified request decrements `remainingBalanceSat`. Once zero, the facilitator rejects further debits.
- **Concurrency**: Facilitators should serialize ledger updates per `utxoId` to avoid race conditions; a simple mutex or transactional LevelDB operation is sufficient in the reference implementation.
- **Expiration**: Servers may enforce `maxTimeoutSeconds` between 402 issuance and first use; facilitators may also prune old ledger entries to reclaim storage.

### 6.4 Payment Lifecycle

1. **Client Funding**: Wallet sends BCH to the server’s address; a fresh UTXO is created.
2. **Verification**: Each protected request references the funded UTXO until depleted.
3. **Drain Completion**: Once balance reaches zero, the facilitator marks the UTXO as exhausted.
4. **Refill**: Client funds a new transaction; cycle repeats.

This model minimizes on-chain traffic by separating funding transactions from per-request authorization, aligning with BCH’s low-fee, high-throughput design.

---

## 7. Facilitator Interface

The BCH facilitator exposes REST endpoints mirroring the base x402 API surface. All requests and responses use JSON with UTF-8 encoding.

### 7.1 GET `/facilitator/supported`

Returns supported scheme/network pairs.

```json
{
  "kinds": [
    {
      "x402Version": 1,
      "scheme": "utxo",
      "network": "bch"
    }
  ]
}
```

### 7.2 POST `/facilitator/verify`

Verifies a payment authorization without creating a new on-chain transaction.

**Request**

```json
{
  "x402Version": 1,
  "paymentPayload": {
    "x402Version": 1,
    "scheme": "utxo",
    "network": "bch",
    "payload": {
      "signature": "IL+rKU8JQz3lTGv4v1sLxojclXMoMLBQniS1h9wLutc8KToVnsVPC0+2S8ifZ5rjIlZJ7GrD7kg3m+tuRnQM+qA=",
      "authorization": {
        "from": "bitcoincash:qz9s2mccqamzppfq708cyfde5ejgmsr9hy7r3unmkk",
        "to": "bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d",
        "value": "1000",
        "txid": "b74dcfc839eb3693be811be64e563171d83e191388fdda900f2d3b952df01ba7",
        "vout": 0,
        "amount": "2000"
      }
    }
  },
  "paymentRequirements": {
    "scheme": "utxo",
    "network": "bch",
    "minAmountRequired": "1000",
    "resource": "http://localhost:4021/weather",
    "description": "Access to weather data",
    "mimeType": "application/json",
    "payTo": "bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d",
    "maxTimeoutSeconds": 60,
    "asset": "0x0000000000000000000000000000000000000001",
    "extra": {}
  }
}
```

**Success Response**

```json
{
  "isValid": true,
  "payer": "bitcoincash:qz9s2mccqamzppfq708cyfde5ejgmsr9hy7r3unmkk",
  "remainingBalanceSat": "9000"
}
```

**Error Response**

```json
{
  "isValid": false,
  "invalidReason": "insufficient_utxo_balance",
  "payer": "bitcoincash:qz9s2mccqamzppfq708cyfde5ejgmsr9hy7r3unmkk"
}
```

### 7.3 POST `/facilitator/settle`

Optional endpoint used when servers require an additional reconciliation step (e.g., outputting remaining balance or triggering downstream actions). The request mirrors `/verify`. A typical response echoes the settlement schema described in §5.4.

Implementations MAY omit `/settle` if `/verify` provides sufficient guarantees for the application.

---

## 8. Discovery API

BCH deployments can expose discoverable resources identical to the base protocol. Facilitator-hosted marketplaces (Bazaars) return BCH-specific `PaymentRequirements` to signal pricing and accepted schemes.

### GET `/discovery/resources`

```json
{
  "x402Version": 1,
  "items": [
    {
      "resource": "http://localhost:4021/weather",
      "type": "http",
      "x402Version": 1,
      "accepts": [
        {
          "scheme": "utxo",
          "network": "bch",
          "minAmountRequired": "1000",
          "description": "Access to weather data",
          "mimeType": "application/json",
          "payTo": "bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d",
          "maxTimeoutSeconds": 60,
          "asset": "0x0000000000000000000000000000000000000001",
          "extra": {}
        }
      ],
      "lastUpdated": 1703123456,
      "metadata": {
        "category": "weather",
        "provider": "Demo Server"
      }
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 1
  }
}
```

---

## 9. Error Handling

The facilitator and server use consistent error codes to communicate validation outcomes:

- `missing_authorization`: Payment payload lacks an `authorization` object.
- `invalid_payload`: Payment payload is malformed or missing required fields.
- `invalid_scheme`: Scheme does not match `utxo`.
- `invalid_network`: Network does not match advertised requirements.
- `invalid_receiver_address`: Funding UTXO pays an address other than the server’s `payTo`.
- `invalid_exact_bch_payload_signature`: Signature verification failed for the BCH message.
- `insufficient_utxo_balance`: Requested debit exceeds remaining UTXO balance.
- `utxo_not_found`: Facilitator could not locate the referenced `(txid, vout)` on-chain.
- `unexpected_utxo_validation_error`: Downstream wallet or node failure prevented validation.
- `unexpected_verify_error`: Internal facilitator error during `/verify`.
- `unexpected_settle_error`: Internal facilitator error during `/settle`.

Applications MAY extend this list but SHOULD reuse canonical codes to aid interoperability.

---

## 10. Security Considerations

### 10.1 UTXO Replay Protection

- **Ledger tracking**: Facilitators persist remaining balances per `(txid, vout)` preventing re-debit after exhaustion.
- **Signature binding**: Authorization payload binds the UTXO details and per-request debit amount, preventing tampering.
- **Server address verification**: Facilitators reject UTXOs that do not pay the advertised `payTo`, mitigating redirected payments.
- **Timestamp auditing**: Ledger entries maintain `firstSeen` and `lastUpdated` timestamps for fraud analysis.

### 10.2 Double-Spend Detection

- **Node validation**: Facilitators query trusted BCH nodes (e.g., via `minimal-slp-wallet`) to confirm UTXO existence.
- **Confirmations**: Deployments may require `DEFAULT_MIN_CONFIRMATIONS` ≥ 1 before accepting a UTXO.
- **Future enhancements**: Integrations with Double-Spend Proof endpoints or zero-conf risk scoring are recommended for production systems.

### 10.3 Facilitator Trust Model

- Facilitators never handle customer funds, reducing custodial risk compared to ERC-20 authorizations.
- Servers SHOULD operate or trust facilitators that maintain accurate ledgers and access reliable BCH infrastructure.
- Clients SHOULD monitor confirmations of their funding transactions to detect reorgs or double spends that could invalidate future requests.

---

## 11. Implementation Notes

- **Reference Client**: `axios-402-handler.js` wraps Axios to automatically respond to 402s by funding UTXOs, building BCH payment headers, and replaying requests.
- **Server Middleware**: `paymentMiddleware` converts route pricing into BCH payment requirements, validates incoming `X-PAYMENT` headers, and integrates with the facilitator.
- **Facilitator Services**: The reference facilitator uses `minimal-slp-wallet` for blockchain queries, LevelDB for ledger storage, and exposes REST controllers under `/facilitator`.
- **Configuration**: Environment variables set facilitator ports, BCH node endpoints, and server pay-to addresses (`SERVER_BCH_ADDRESS`).
- **Extensibility**: Additional BCH networks (e.g., testnet, chipnet) can be supported by advertising new `network` identifiers and configuring wallet endpoints accordingly.

---

## 12. Use Cases

- **API Monetization**: Charge BCH for HTTP endpoints such as weather data or analytics, reusing existing x402 client libraries with minimal modifications.
- **Agentic Workflows**: BCH-funded AI agents can maintain a single UTXO balance and debit calls autonomously, enabling low-friction micropayments.
- **Marketplace Discovery**: Bazaars list BCH-priced resources, allowing clients to pre-fund once and access multiple APIs within a shared trust domain.
- **Hybrid Deployments**: Servers can advertise both BCH `utxo` and EVM `exact` schemes simultaneously, enabling multi-asset monetization strategies.

---

## Version History

| Version | Date | Changes | Author |
| ------- | ---- | ------- | ------ |
| v0.1 | 2025-11-08 | Initial BCH adaptation draft derived from reference implementation | x402-bch Working Group |

