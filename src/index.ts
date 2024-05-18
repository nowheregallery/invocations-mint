import {
  Address,
  configureChains,
  connect,
  createConfig,
  writeContract,
} from "@wagmi/core";
import { InjectedConnector } from "@wagmi/core/connectors/injected";
import { WalletConnectConnector } from "@wagmi/core/connectors/walletConnect";
import { alchemyProvider } from "@wagmi/core/providers/alchemy";
import { parseAbi, parseEther } from "viem";
import { mainnet, sepolia } from "viem/chains";

// should these be configurable? maybe if we want to support multiple contracts
const ABI = parseAbi([
  "function buy() payable",
  "event NonceUsed(uint256 indexed nonce)",
  "function invocationVoucher(uint256, uint256, uint8, bytes32, bytes32) payable"
]);
const buyPriceEth = "0.15";

type SupportedChain = "sepolia" | "mainnet";

type Config = {
  chain: SupportedChain;
  contractAddress: Address;
  alchemyKey: string;
  walletConnectProjectId: string;
};

type StartFunc = () => void;
type CompleteFunc = (result: any, error: any) => void;

type RegisterArgs = {
  element: HTMLElement;
  onStart: StartFunc;
  onComplete: CompleteFunc;
};

// we only support sepolia or mainnet
function getChain(chainStr: SupportedChain) {
  switch (chainStr) {
    case "sepolia":
      return sepolia;
    case "mainnet":
      return mainnet;
  }
}

export function configure(config: Config) {
  const chainUsed = getChain(config.chain);
  if (!chainUsed) {
    console.error(`Invalid chain given in NWG config "${config.chain}"`);
    return;
  }

  // initialize config
  const { publicClient, webSocketPublicClient } = configureChains(
    [chainUsed],
    [alchemyProvider({ apiKey: config.alchemyKey })],
  );
  const wagmiConfig = createConfig({
    autoConnect: true,
    publicClient,
    webSocketPublicClient,
    connectors: [
      new InjectedConnector(),
      new WalletConnectConnector({
        options: {
          projectId: config.walletConnectProjectId,
        },
      }),
    ],
  });

  async function connectWallet() {
    let data: { account: Address } | undefined;
    if (wagmiConfig.data && wagmiConfig.data.account) {
      // already connected
      data = { account: wagmiConfig.data.account };
    } else {
      for (const connector of wagmiConfig.connectors) {
        if (!connector.ready || !connector.isAuthorized) {
          continue;
        }
        data = await connect({ chainId: chainUsed.id, connector });
        break;
      }
    }
    if (!data) {
      throw new Error("No connector found");
    }
    return data;
  }

  function handleBuy(onStart: StartFunc, onComplete: CompleteFunc) {
    return async () => {
      try {
        onStart();
        await connectWallet();
        const { hash } = await writeContract({
          address: config.contractAddress,
          abi: ABI,
          functionName: "buy",
          value: parseEther(buyPriceEth),
        });
        let txUrl = chainUsed.blockExplorers.etherscan.url + "/tx/" + hash;
        onComplete(txUrl, null);
      } catch (e) {
        onComplete(null, e);
      }
    };
  }

  // TODO: vouchers
  let usedVouchers = {};
  async function checkVouchersAvailable() {}
  async function handleVoucherMint() {}

  return {
    registerBuyButton: ({ element, onStart, onComplete }: RegisterArgs) => {
      element.addEventListener("click", handleBuy(onStart, onComplete));
    },
  };
}
