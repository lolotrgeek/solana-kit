import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createCloseAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk";
import { error, log } from "../utils/logger";

export interface Balances {
    solBalance: number;
    baseBalance: number;
    quoteBalance: number;
}

export interface WalletConfig {
    transactionEndpoint: string;
    keypair?: Keypair;
}

export class Wallet {
    public version = "0.0.3";
    public transactionConnection: Connection; // a dedicated connection just for sending transactions
    public keypair: Keypair;

    public solBalance = 0;
    public tokenBalances = new Map<string, number>();

    constructor(walletConfig: WalletConfig) {
        const { transactionEndpoint, keypair } = walletConfig;
        this.transactionConnection = new Connection(transactionEndpoint, { commitment: 'confirmed' });
        if(!keypair) {
            this.keypair = Keypair.generate();
        }
        else {
            this.keypair = keypair
        }

    }

    public async getPairBalances(baseTokenAccount: PublicKey, quoteTokenAccount: PublicKey): Promise<Balances> {
        try {
            let baseBalance, quoteBalance
            const results = await Promise.allSettled([
                this.transactionConnection.getBalance(this.keypair.publicKey),
                this.transactionConnection.getTokenAccountBalance(baseTokenAccount),
                this.transactionConnection.getTokenAccountBalance(quoteTokenAccount)
            ]);

            const solBalanceResult = results[0];
            const baseBalanceResult = results[1];
            const quoteBalanceResult = results[2];

            if (solBalanceResult.status === 'fulfilled') {
                this.solBalance = solBalanceResult.value;
            } else {
                log(`Error fetching SOL balance ${solBalanceResult.reason}`);
            }

            if (baseBalanceResult.status === 'fulfilled') {
                baseBalance = Number(baseBalanceResult.value.value.amount) ?? 0;
            } else {
                baseBalance = 0;
            }
            if (quoteBalanceResult.status === 'fulfilled') {
                quoteBalance = Number(quoteBalanceResult.value.value.amount) ?? 0;
            }
            else {
                quoteBalance = 0;
            }
            return { solBalance: this.solBalance, baseBalance, quoteBalance };
        } catch (error) {
            throw new Error(`Unexpected error during balance refresh: ${error}`);
        }
    }

    public async getTokenBalance(tokenMint: PublicKey): Promise<number> {
        const balance = await this.transactionConnection.getTokenAccountBalance(getAssociatedTokenAddressSync(tokenMint, this.keypair.publicKey));
        if (!balance) throw new Error(`Error fetching token balance for ${tokenMint}`);
        if (!balance.value) throw new Error(`Error fetching token balance, no value for ${tokenMint}`);
        if (!balance.value.amount) throw new Error(`Error fetching token balance, no amount for ${tokenMint}`);
        return Number(balance.value.amount)
    }

    public getTokenAccountAddress(tokenMint: PublicKey) {
        return getAssociatedTokenAddressSync(tokenMint, this.keypair.publicKey);
    }

    public async getWalletTokenAccount(): Promise<TokenAccount[]> {
        try {
            const walletTokenAccount = await this.transactionConnection.getTokenAccountsByOwner(this.keypair.publicKey, {
                programId: TOKEN_PROGRAM_ID,
            });
            return walletTokenAccount.value.map((i) => ({
                pubkey: i.pubkey,
                programId: i.account.owner,
                accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
            }));
        } catch (error) {
            log(`Error fetching wallet token account: ${error}`);
            return [];
        }
    }

    async getTokenBalances() {
        // Get the token accounts of the wallet
        const tokenAccounts = await this.transactionConnection.getParsedTokenAccountsByOwner(this.keypair.publicKey, {
            // programId: TOKEN_2022_PROGRAM_ID,
            programId: TOKEN_PROGRAM_ID,
            // programId: NATIVE_MINT,
            // programId: NATIVE_MINT_2022,
            // programId: ASSOCIATED_TOKEN_PROGRAM_ID

        });
        // For each token account, get the token balance and print it
        return tokenAccounts.value.map(account => {
            const accountKey = account.pubkey;
            const balance = account.account.data.parsed.info.tokenAmount.uiAmount;
            const mint = account.account.data.parsed.info.mint;
            return { mint, balance, accountKey }
        });
    }

    async getSOLBalance(walletPublicKey: PublicKey) {
        // Connect to the Solana cluster
        const connection = new Connection(clusterApiUrl('mainnet-beta'));

        // Get the SOL balance of the wallet
        const balance = await connection.getBalance(walletPublicKey);

        // Convert the balance from lamports to SOL
        const balanceInSOL = balance / LAMPORTS_PER_SOL;

        // const balanceInWSOL = await getWSOLAmount({programId: SYSTEM_PROGRAM_ID, pubKey: walletPublicKey});

        return balanceInSOL
    }

    /**
     * Rent is paid to open and maintain a Token Account. This closes any empty token accounts to reclaim rent.
     */
    public async reClaimRent(): Promise<void> {
        try {

            // Split an array into chunks of length `chunkSize`
            const chunks = <T>(array: T[], chunkSize = 10): T[][] => {
                let res: T[][] = [];
                for (let currentChunk = 0; currentChunk < array.length; currentChunk += chunkSize) {
                    res.push(array.slice(currentChunk, currentChunk + chunkSize));
                }
                return res;
            };
            // Get all token accounts of `wallet`
            const tokenAccounts = await this.transactionConnection.getParsedTokenAccountsByOwner(this.keypair.publicKey, { programId: TOKEN_PROGRAM_ID });
            const filteredAccounts = tokenAccounts.value.filter(account => account.account.data.parsed.info.tokenAmount.uiAmount === 0);
            const transactions: Transaction[] = [];

            const { blockhash, lastValidBlockHeight } = await this.transactionConnection.getLatestBlockhash();

            chunks(filteredAccounts).forEach((chunk) => {
                // New empty transaction
                const txn = new Transaction();
                txn.feePayer = this.keypair.publicKey;
                txn.recentBlockhash = blockhash;
                for (const account of chunk) {
                    // Add a `closeAccount` instruction for every token account in the chunk
                    txn.add(createCloseAccountInstruction(account.pubkey, this.keypair.publicKey, this.keypair.publicKey));
                }
                transactions.push(txn);
            });

            log(`🔗 - Reclaiming Rent for ${transactions.length} empty token accounts`);

            const sendTxns = () => transactions.map(async txn => {
                txn.sign(this.keypair);
                log("✅ - Reclaim Transaction Signed");
                const txid = await this.transactionConnection.sendRawTransaction(txn.serialize());
                log("✅ - ReClaim Transaction sent to network")
                return txid
            })

            const signatures = await Promise.all(sendTxns())

            const confirmations = await this.transactionConnection.getSignatureStatuses(signatures);

            if (confirmations.value) {
                confirmations.value.forEach((confirmation, index) => {
                    const txid = signatures[index];
                    if (confirmation && !confirmation?.err) {
                        log(`🎉 ReClaim Rent Transaction Successfully Confirmed! https://explorer.solana.com/tx/${txid}`);
                    } else {
                        error(`Error reclaiming rent: ${txid}`);
                    }
                });
            }

        } catch (error) {
            error(`Error reclaiming rent: ${error}`);
        }
    }

}

