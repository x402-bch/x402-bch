# x402-bch Examples

These code examples show how to implement the x402-bch protocol in the three main x402 actors: Clients, Servers, and Facilitators. These examples are written in node.js JavaScript. They are based on the [x402 TypeScript examples](https://github.com/coinbase/x402/tree/main/examples/typescript).

## Client

The Client uses the [axios library](https://www.npmjs.com/package/axios) for making network calls to the Server. Like in the original x402 example, an axios wrapper is created to automatically handle 402 HTTP errors. The axios wrapper will be published as the [x402-bch-axios npm package](https://github.com/x402-bch/x402-bch-axios), similar to [x402-axios](https://www.npmjs.com/package/x402-axios).

## Server

The Server uses the [express framework](https://www.npmjs.com/package/express) for creating a web server. It also has a [x402-bch-express middleware library](https://github.com/x402-bch/x402-bch-express) for handling the 402 error codes and payment handling, similar to [x402-express](https://www.npmjs.com/package/x402-express) for the original x402 protocol.

## Facilitator

The Facilitator example is based on [x402-soverign](https://github.com/Dhaiwat10/x402-sovereign). This handles all blockchain-specific business logic so the Server does not need to. To handle Bitcoin Cash blockchain access, it needs to have access to an instance of [ipfs-bch-wallet-consumer](https://github.com/Permissionless-Software-Foundation/ipfs-bch-wallet-consumer) or [bch-api](https://github.com/Permissionless-Software-Foundation/bch-api), both of which are part of the [CashStack](https://cashstack.info).

If it is connected to bch-api, payments can be checked against [Double Spend Proofs](https://upgradespecs.bitcoincashnode.org/dsproof/). This allows for secure zero-confirmation payments.