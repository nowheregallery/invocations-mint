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
const buyABI = parseAbi(["function buy() payable"]);
const buyPriceEth = "0.15";

type SupportedChain = "sepolia" | "mainnet";

/**
 * Configuration for blockchain interaction.
 */
type Config = {
  /**
   * The blockchain network to interact with.
   */
  chain: SupportedChain;

  /**
   * The smart contract address on the specified blockchain network.
   */
  contractAddress: Address;

  /**
   * The Alchemy API key used for node services and enhanced API access.
   */
  alchemyKey: string;

  /**
   * The WalletConnect project ID used for establishing a connection between wallets and dapps.
   */
  walletConnectProjectId: string;
};

/**
 * Arguments for attaching logic to a DOM element.
 */
type AttachArgs = {
  /**
   * Configuration object containing blockchain and connection details.
   */
  config: Config;

  /**
   * The HTML element to which the logic will be attached.
   */
  element: HTMLElement;

  /**
   * Callback function to be called when the process starts.
   */
  onStart: () => void;

  /**
   * Callback function to be called upon completion of the process.
   * @param result - The result of the completed operation, if successful.
   * @param error - An error object if an error occurred, otherwise null.
   */
  onComplete: (result: any, error: any) => void;
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

export function attach({ config, element, onStart, onComplete }: AttachArgs) {
  const chainUsed = getChain(config.chain);
  if (!chainUsed) {
    console.error(`Invalid chain given in NWG config "${config.chain}"`);
    return;
  }

  async function buy() {
    const { hash } = await writeContract({
      address: config.contractAddress,
      abi: buyABI,
      functionName: "buy",
      value: parseEther(buyPriceEth),
    });
    return chainUsed.blockExplorers.etherscan.url + "/tx/" + hash;
  }

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

  // @ts-ignore
  element.addEventListener("click", async () => {
    try {
      onStart();

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

      let txUrl = await buy();
      onComplete(txUrl, null);
    } catch (e) {
      onComplete(null, e);
    }
  });
}
