# x402-bch Server Demo

This directory contains the reference **Server** implementation for the Bitcoin Cash adaptation of the x402 protocol. The demo application (`bch-express.js`) exposes a simple `/weather` API that requires BCH payment headers before returning data. It demonstrates how a resource server publishes pricing metadata, returns HTTP `402` responses, and delegates payment validation to a Facilitator as described in the core [x402 specification](../../specs/x402-specification.md) and the BCH-focused [x402-bch specification](../../specs/x402-bch-specification.md).

## Where the Server Fits
- **Clients** discover prices from `402` responses, fund BCH UTXOs, and attach signed `X-PAYMENT` headers.
- **Servers** (this project) guard API routes, define resource pricing, and call the Facilitator to verify payment payloads.
- **Facilitators** validate BCH signatures/UTXOs and keep track of remaining prepaid balances.

This example implements the Server role using Express plus the reusable `paymentMiddleware` exported by the [x402-bch-express](https://www.npmjs.com/package/x402-bch-express) library to advertise payment requirements and enforce verification before the request reaches the handler.

## Features
- Leverages the BCH-specific `paymentMiddleware` from the [x402-bch-express](https://www.npmjs.com/package/x402-bch-express) package that inspects routes, constructs `PaymentRequirements`, and communicates with the Facilitator `/verify` endpoint.
- Demonstrates fine-grained pricing metadata per route (HTTP verb + path) while sharing global defaults such as network and Facilitator URL.
- Automatically responds with HTTP `402` and `accepts` metadata when the `X-PAYMENT` header is missing or invalid.
- Forwards parsed payment payloads to the Facilitator and only allows the request through when verification succeeds.

## Prerequisites
- Node.js 20 LTS or newer (required for native ES modules).
- npm 9+ (bundled with Node 20).
- An instance of the x402-bch Facilitator (see [Facilitator](../facilitator/)) reachable over HTTP.
- A BCH cash address controlled by the server operator to receive funding UTXOs.

## Installation
```bash
cd x402-bch/examples/server
npm install
```

## Configuration
Copy `.env-local` to `.env` and adjust the values for your environment.

- `FACILITATOR_URL`: Base URL for the Facilitator service (`http://localhost:4345/facilitator` by default). The middleware will call `${FACILITATOR_URL}/verify`.
- `SERVER_BCH_ADDRESS`: Cash address that must be paid by the client UTXO. The Facilitator enforces that the advertised payment actually credited this address.
- `PORT`: HTTP port for the demo server (default `4021`).

You can further customize `paymentMiddleware` to expose additional routes, change minimum requirement amounts, or update per-route descriptions from inside `bch-express.js`.

## Running the Server
```bash
npm start
```

The script:
1. Loads environment variables and constructs the Express app.
2. Installs the `paymentMiddleware`, configured with the BCH payment parameters for `GET /weather`.
3. Launches an HTTP server (default `http://localhost:4021`) that advertises x402 requirements when unauthenticated requests are received.

When a request is made to `/weather` without an `X-PAYMENT` header, the server responds with:
- HTTP status `402`.
- `x402Version` and a single-entry `accepts` array describing the BCH `utxo` scheme, required satoshi amount, and metadata for clients to display.

When a client retries with a valid payment header—typically after contacting the Facilitator for quoting/signing—the server calls `/facilitator/verify`. If the Facilitator confirms `isValid: true`, the route handler responds with the JSON weather payload.

## Integration with the Ecosystem
- Works alongside the [Facilitator demo](../facilitator) that manages BCH validation and prepaid balances.
- Designed to interoperate with the [Client demo](../client) or any HTTP client that implements the x402-bch `utxo` scheme.
- Shows how to migrate a resource from traditional authentication to payment-gated access while keeping business logic isolated from payment verification.

## Troubleshooting
- **Persistent `402` responses**: Confirm the Facilitator is running and `FACILITATOR_URL` points to its `/facilitator` base path.
- **`insufficient_utxo_balance` errors**: Fund a higher-value UTXO or lower the route’s `minAmountRequired` inside the middleware.
- **Network mismatches**: Ensure the server and client both use the `bch` network and `utxo` scheme. Adjust route configuration accordingly.
- **Signature or address errors**: Verify that `SERVER_BCH_ADDRESS` matches the address funded in the client’s UTXO.

For deeper architectural details, review the [x402-bch examples overview](../README.md) and the full protocol specifications linked above.

