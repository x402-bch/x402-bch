# x402-bch Facilitator Demo

This directory contains the reference **Facilitator** service for the Bitcoin Cash adaptation of the x402 protocol. The facilitator (`bch-facilitator.js`) provides the `/facilitator` REST endpoints that Servers call to verify BCH payments and maintain prepaid UTXO balances, as described in the core [x402 specification](../../specs/x402-specification.md) and the BCH-focused [x402-bch specification](../../specs/x402-bch-specification.md).

## Where the Facilitator Fits
- **Clients** broadcast BCH funding transactions and attach signed payment payloads to HTTP retries.
- **Servers** price their resources, issue HTTP `402` responses, and forward the client’s payment payload plus requirements to the Facilitator.
- **Facilitators** (this project) validate signatures, inspect UTXOs on-chain, track debit balances in LevelDB, and report whether a request can proceed.

This example implements the Facilitator role. It exposes the canonical `/facilitator/supported`, `/facilitator/verify`, and `/facilitator/settle` endpoints so Servers can outsource BCH-specific validation while still receiving funds directly on-chain.

## Features
- Implements the BCH `utxo` scheme defined in the specification, including signature checks and UTXO-based debit tracking.
- Uses [`minimal-slp-wallet`](https://www.npmjs.com/package/minimal-slp-wallet) plus a retry queue to query BCH infrastructure and validate funding transactions.
- Persists prepaid balances in LevelDB, enabling multiple paid requests against a single UTXO until depleted.
- Built with Clean Architecture boundaries: Adapters (wallet, logging, storage), Use Cases (verification/settlement), and REST Controllers (Express).

## Prerequisites
- Node.js 20 LTS or newer.
- npm 9+ (ships with Node 20).
- Access to BCH node infrastructure compatible with `minimal-slp-wallet`:
  - `consumer-api` (ipfs-bch-wallet-service), or
  - `rest-api` (bch-api, required for Double Spend Proof support).
- A BCH cash address controlled by the resource server to receive funds.

## Installation
```bash
cd /home/trout/work/personal/x402/x402-bch/examples/facilitator
npm install
```

## Configuration
Copy `.env-local` to `.env` and adjust as needed. Key variables:

- `PORT`: HTTP port for the facilitator (default `4345`).
- `SERVER_BCH_ADDRESS`: Cash address that must receive the funding UTXO.
- `API_TYPE`: BCH backend interface (`consumer-api` or `rest-api`).
- `BCH_SERVER_URL`: URL for the BCH infrastructure node or consumer service.
- `LOG_LEVEL`: Logging verbosity (`info`, `debug`, etc.).

Example:
```bash
cp .env-local .env
```
Then edit `.env` to point at your BCH infrastructure and server address.

## Running the Facilitator
```bash
npm start
```

The service starts an Express server (see `bin/server.js`) and exposes:

- `GET /health` – simple health probe.
- `GET /` – welcome payload listing supported facilitator endpoints.
- `GET /facilitator/supported` – announces `x402Version`, `scheme`, and `network` pairs.
- `POST /facilitator/verify` – validates a BCH payment payload against advertised requirements, updates the ledger, and returns `{ isValid, payer, invalidReason? }`.
- `POST /facilitator/settle` – optional reconciliation step that replays `verify` and returns settlement metadata.

Logs include every incoming request plus wallet validation details. LevelDB state is stored in `./leveldb/utxo`.

## How Verification Works
1. **Schema checks** ensure the request matches the `utxo` scheme and `bch` network.
2. **Signature verification** reconstitutes `JSON.stringify(authorization)` and calls `BitcoinCash.verifyMessage`.
3. **UTXO inspection** fetches the funding transaction, verifies it paid `SERVER_BCH_ADDRESS`, and computes the satoshi value.
4. **Ledger updates** subtract the debit amount (`minAmountRequired`) from the stored balance, rejecting if insufficient to cover the call.

This mirrors the flow in the [x402-bch specification](../../specs/x402-bch-specification.md) and allows a single on-chain payment to authorize multiple paid HTTP requests.

## Working with the Demo Server & Client
- Run the Facilitator alongside the example [resource server](../server/) and [client](../client/). The server will POST to `/facilitator/verify` before returning protected data, and the client will automatically retry with BCH payment headers.
- Adjust `PAYMENT_AMOUNT_SATS` and pricing in the server example to observe the ledger decrementing remaining satoshis.

## Troubleshooting
- **`insufficient_utxo_balance`**: Fund a new UTXO or lower the cost per request.
- **Signature errors**: Ensure the client signs with the private key that owns the funding transaction.
- **UTXO not found**: Confirm your BCH backend is reachable.
- **Double-spend protections**: Switch `API_TYPE` to `rest-api` (bch-api) for Double Spend Proof support.

## Next Steps
- Integrate double spend proofs when connected to bch-api back ends.
- Extend `/facilitator/settle` to return ledger snapshots (`remainingBalanceSat`, `ledgerEntry`) as suggested by the spec.
- Combine with additional transports or marketplaces exposed via the Discovery API to build full x402-bch deployments.