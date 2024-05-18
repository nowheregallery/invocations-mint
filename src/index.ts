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

import vouchersSepolia from "./vouchers-sepolia.json"
import vouchersMainnet from "./vouchers-mainnet.json"

// should these be configurable? maybe if we want to support multiple contracts
const ABI = parseAbi([
  "function buy() payable",
  "event NonceUsed(uint256 indexed nonce)",
  "function invocationVoucher(uint256, uint256, uint8, bytes32, bytes32) payable"
]);
const buyPriceEth = "0.15";

type SupportedChain = "sepolia" | "mainnet";

interface Voucher {
  signer: string;
  sender: string;
  value: string;
  created: string;
  nonce: string;
  v: number;
  r: string;
  s: string;
};

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
type HexString = `0x${string}`;

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

  const vouchers: Voucher[] = config.chain === "mainnet" ? vouchersMainnet : vouchersSepolia;
  console.log("vouchers", vouchers);

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

  async function getAvailableVouchers() {
    const {account} = await connectWallet();
    const logs = await wagmiConfig.publicClient.getContractEvents({
      address: config.contractAddress,
      abi: ABI,
      eventName: "NonceUsed",
      fromBlock: BigInt(0),
    });
    console.log("logs read", logs);
    const usedNonces = logs.map((log) => {
      return log.args.nonce;
    });
    console.log("nonces used", usedNonces);
    return vouchers.filter((v) => {
      console.log("v", v, account);
      return v.sender === account && !usedNonces.includes(BigInt(v.nonce));
    })
  }

  function handleVoucherMint(onStart: StartFunc, onComplete: CompleteFunc) {
    return async () => {
      try {
        onStart();
        const vouchers = await getAvailableVouchers();
        if (vouchers.length === 0) {
          onComplete(null, new Error("No available vouchers"));
          return;
        }
        const voucher = vouchers[0];
        const { hash } = await writeContract({
          address: config.contractAddress,
          abi: ABI,
          functionName: "invocationVoucher",
          args: [
            BigInt(voucher.created),
            BigInt(voucher.nonce),
            voucher.v,
            voucher.r as HexString,
            voucher.s as HexString
          ],
          value: parseEther(voucher.value),
        });
        let txUrl = chainUsed.blockExplorers.etherscan.url + "/tx/" + hash;
        onComplete(txUrl, null);
      } catch (e) {
        onComplete(null, e);
      }
    }
  }

  return {
    registerBuyButton: ({ element, onStart, onComplete }: RegisterArgs) => {
      element.addEventListener("click", handleBuy(onStart, onComplete));
    },
    registerVoucherButton: ({ element, onStart, onComplete }: RegisterArgs) => {
      element.addEventListener("click", handleVoucherMint(onStart, onComplete));
    },
  };
}
