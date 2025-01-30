import { Wallet, WalletConfig, Balances } from "./solanaWallet";
import { test_keys } from '../../tests/mocks/test_keys';
import { Keypair, Connection, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL, clusterApiUrl, Transaction } from "@solana/web3.js";
import { TokenAccount } from "@raydium-io/raydium-sdk";


export class DevWallet extends Wallet {

    constructor(walletConfig: WalletConfig) {
        const devWalletConfig = {
            transactionEndpoint: 'https://api.devnet.solana.com',
            keypair: test_keys,
            botId: 'testBotId',
            botLog: 'testBotLog'
        }
        super(devWalletConfig);
        this.solBalance = 100 * LAMPORTS_PER_SOL
    }

    public async getPairBalances(baseTokenAccount: PublicKey, quoteTokenAccount: PublicKey): Promise<Balances> {
        const baseBalance = 0
        const quoteBalance = 0
        return { solBalance: this.solBalance, baseBalance, quoteBalance };
    }

    public getTokenAccountAddress(tokenMint: PublicKey): PublicKey {
        return tokenMint
    }

    public async getWalletTokenAccount(): Promise<TokenAccount[]> {
        return []
    }

    public async reClaimRent(): Promise<void> {
        return
    }
}