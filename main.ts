import { clusterApiUrl, Connection, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import { Exchange } from "./src/exchanges/exchange";
import { Raydium } from "./src/exchanges/raydium";
import { Wallet } from "./src/wallets/solanaWallet";
import { PoolAddress, SOL, TokenId } from "./src/utils/types";
import { Percent, Token, TOKEN_PROGRAM_ID, TokenAmount } from "@raydium-io/raydium-sdk";
import { getToken, isNativeAddress, SOLTOKEN, TokenData } from "./src/utils/token";
import { isNativePool, Pool } from "./src/utils/pool";
import { bankersRound } from "./src/utils/round";
import { parseToPercent } from "./src/utils/percent";
import { checkTransaction } from "./src/utils/check";

export interface Config {
    cluster: string;
    exchange: string;
}

export interface PoolToken {
    token: Token;
    pool: Pool;
}

export interface Success {
    value: number;
    valueUI: number;
}

export class SolanaKit {
    endpoint: string = clusterApiUrl("devnet")
    connection: Connection;
    exchange: Exchange
    tokens: Map<TokenId, TokenData> = new Map<string, TokenData>();
    pools: Map<PoolAddress, Pool> = new Map<string, Pool>();

    constructor(config: Config) {
        this.connection = new Connection(this.endpoint, "confirmed");
        if (config.exchange === "raydium") {
            this.exchange = new Raydium({ transactionEndpoint: this.endpoint });

        }
    }

    createWallet(): Wallet {
        return new Wallet({ transactionEndpoint: this.endpoint });
    }

    async getPoolToken(poolId: PoolAddress): Promise<PoolToken> {
        let pool = this.pools.get(poolId)
        if (!pool) {
            pool = await this.exchange.getPool(poolId)
            this.pools.set(poolId, pool)
        }
        const validPool = isNativePool(pool)
        if (!validPool) throw Error('Invalid Pool: Non-Native')
        let tokenId = isNativeAddress(pool.poolInfo.baseMint) ? pool.poolInfo.quoteMint : pool.poolInfo.baseMint
        let tokenData = this.tokens.get(tokenId)
        if (!tokenData) {
            tokenData = await getToken(tokenId, this.connection)
            this.tokens.set(tokenId, tokenData)
        }
        const token = new Token(new PublicKey(TOKEN_PROGRAM_ID), new PublicKey(tokenData.address), tokenData.decimals, tokenData.symbol, tokenData.name);
        return { token, pool };
    }

    /**
     * Get the price of pool in SOL
     * @param poolId 
     * @returns amount of SOL for 1 Token
     */
    async price(poolId: PoolAddress): Promise<number> {
        const { token, pool } = await this.getPoolToken(poolId);
        if (!token) throw Error('No Token Data')
        if (!pool) throw Error('No Pool Data')
        const amountIn = new TokenAmount(token, 10 ** token.decimals);
        const quote = await this.exchange.getQuote(
            { amountIn, inputToken: token, outputToken: SOLTOKEN, poolKeys: pool.poolKeys, slippage: new Percent(1, 100) }
        )
        if (!quote) throw Error('No Quote')
        return Number(quote.minAmountOut.raw);
    }

    async buy(wallet: Wallet, poolId: PoolAddress, amount: number, slippage = 0.5): Promise<Success> {
        const { token, pool } = await this.getPoolToken(poolId);
        if (!token) throw Error('No Token Data')
        if (!pool) throw Error('No Pool Data')
        const amountIn = new TokenAmount(SOLTOKEN, bankersRound(amount * LAMPORTS_PER_SOL));
        const quote = await this.exchange.getQuote(
            { amountIn, inputToken: SOLTOKEN, outputToken: token, poolKeys: pool.poolKeys, slippage: parseToPercent(slippage) }
        )
        const swap = await this.exchange.executeSwap(wallet, quote);
        if (swap.err) throw Error(`Swap Error: ${swap.err.value}`);
        const value = Number(swap.amountOut.raw)
        const valueUI = amount / (10 ** token.decimals)
        return { value, valueUI };
    }

    async sell(wallet: Wallet, poolId: PoolAddress, amount: number, slippage = 0.5): Promise<Success> {
        const { token, pool } = await this.getPoolToken(poolId);
        if (!token) throw Error('No Token Data')
        if (!pool) throw Error('No Pool Data')
        const amountIn = new TokenAmount(token, bankersRound(amount * (10 ** token.decimals)));
        const quote = await this.exchange.getQuote(
            { amountIn, inputToken: token, outputToken: SOLTOKEN, poolKeys: pool.poolKeys, slippage: parseToPercent(slippage) }
        )
        const swap = await this.exchange.executeSwap(wallet, quote);
        if (swap.err) throw Error(`Swap Error: ${swap.err.value}`);
        const value = Number(swap.amountOut.raw)
        const valueUI = value / LAMPORTS_PER_SOL
        return { value, valueUI };
    }

    async send(wallet: Wallet, to: string, amount: SOL): Promise<Success> {
        const amountIn = new TokenAmount(SOLTOKEN, bankersRound(amount * LAMPORTS_PER_SOL));
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: wallet.keypair.publicKey,
                toPubkey: new PublicKey(to),
                lamports: amount * LAMPORTS_PER_SOL,
            })
        );
        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [wallet.keypair]
        )
        await checkTransaction(signature)
        return { value: amountIn.raw, valueUI: amount };
    }
}