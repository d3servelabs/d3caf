# D3CAF Protocol

Repo for D3CAF Protocol.

For full introduction, see [Introducing the D3CAF Protocol V1 Beta and Associated Bounty Program](https://hackmd.io/@d3servelabs/d3caf)


## Deployment

### Ethereum Mainnet

| Contract | Address  |
| -------- | -------- |
| D3CAF    | [`0x13ad7efAfAcd463740222186f0f3DE6AD04B6787`](https://etherscan.io/address/0x13ad7efAfAcd463740222186f0f3DE6AD04B6787#code) |
| ImplV1   | [`0xcFbD663cf943ACE12646A0f92c53F5B21Db32833`](https://etherscan.io/address/0xcFbD663cf943ACE12646A0f92c53F5B21Db32833#code) |
| ProxyAdmin | [`0x85Be40f281E31c5B01D5E172bbA472bb27C2b240`](https://etherscan.io/address/0x85Be40f281E31c5B01D5E172bbA472bb27C2b240#code) |

### Goerli 

| Contract | Address  |
| -------- | -------- |
| D3CAF    | [`0xd5e892d06b6933d93e74a4ac4ea9be84c99b2cd2`](https://goerli.etherscan.io/address/0xd5e892d06b6933d93e74a4ac4ea9be84c99b2cd2#code) |
| ImplV1   | [`0xc509ac56d04545b83f2e6fea160760f3307dea42`](https://goerli.etherscan.io/address/0xc509ac56d04545b83f2e6fea160760f3307dea42#code) |
| ProxyAdmin | [`0x26c9e4c75e740d9f771c0339dc48d893858add2a`](https://goerli.etherscan.io/address/0x26c9e4c75e740d9f771c0339dc48d893858add2a#code) |

## Development

We use [truffle dashboard plugin for hardhat](https://www.npmjs.com/package/@truffle/dashboard-hardhat-plugin).

### Example of Goerli testnet transactions

We provide examples in the format of hardhat task:

- [`d3caf-register`](https://github.com/d3servelabs/d3caf/blob/8f975af1a5331aebd3f8ccd0a3116fea0ab0c8d2/tasks/mine.ts#L8)
- [`d3caf-mine`](https://github.com/d3servelabs/d3caf/blob/8f975af1a5331aebd3f8ccd0a3116fea0ab0c8d2/tasks/mine.ts#L44) 
- [`d3caf-claim`](https://github.com/d3servelabs/d3caf/blob/8f975af1a5331aebd3f8ccd0a3116fea0ab0c8d2/tasks/mine.ts#L128)

Here is how they are run:

```sh
npx hardhat d3caf-register --network goerli \
  --d3caf 0xd5e892d06b6933d93e74a4ac4ea9be84c99b2cd2 \
  --factory 0x660CA455230Cddf3A28e6316F369064369A4494f \
  --bytecode 0x608060405234801561001057600080fd5b5060ec8061001f6000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80631003e2d21460375780633fa4f245146048575b600080fd5b604660423660046079565b6062565b005b605060005481565b60405190815260200160405180910390f35b80600080828254607191906091565b909155505050565b600060208284031215608a57600080fd5b5035919050565b6000821982111560b157634e487b7160e01b600052601160045260246000fd5b50019056fea2646970667358221220250305f422fb28c519beb578b5efc779a8ddd12539b894bda7e31c705e59b25764736f6c63430008090033
```

Which will yield a `RequestId`. For example, `0xd9c0da744b334f08f6009996b220b23ac51c68f5132344bbbdb50b80574c45dc`.

See the [TX1 on Goerli](https://goerli.etherscan.io/tx/0xaee9082f36b251f245cbcb30c42781d7a8a2d4bf34cf55ddd8190ffed6165c02)

```sh
npx hardhat d3caf-mine --d3caf 0xd5e892d06b6933d93e74a4ac4ea9be84c99b2cd2 \
  --request 0xd9c0da744b334f08f6009996b220b23ac51c68f5132344bbbdb50b80574c45dc \
  --solver 0x968B377cf7256485c1dEB9Ad813844FC16CA824D \
  --network goerli --submit
```

See the [TX2 on Goerli](https://goerli.etherscan.io/tx/0x9dbb13f270925c216ae1c64e9dc8a473ba4cd79dae55cf8b6f3e4f3481a65289)

Note you could run this script multiple time to get multiple zeros, each time it will be exponatially longer. 
For example, see this [TX3 on Goerli](https://goerli.etherscan.io/tx/0x4a7f32960c888d64e2b874d4f3905b5f4eeee0c8bbae07b3251e806bd9e65dfc)

And when it expire, you could send the following script to claim reward

```sh
npx hardhat d3caf-claim --d3caf 0xd5e892d06b6933d93e74a4ac4ea9be84c99b2cd2 \
  --request 0xe1c3d59e4b2bf17152bbf2e093f046dd3207d71bf767e98f7cff42869292cb91 \
  --solver 0x968B377cf7256485c1dEB9Ad813844FC16CA824D \
  --source-salt 0x0000000000000000000000000000000000000000000000000000000000000b46 \
  --network goerli
```

See this [TX4 on Goerli](https://goerli.etherscan.io/tx/0x3cde3b1720ddfb0aa5bd6b8dc2ef84fa4cbbbfb032b39c55c593d95196f32650)

