import { Connection, Transaction, TransactionError, VersionedTransaction } from "@solana/web3.js";
import { CurrencyAmount, Percent, Token, TokenAmount, LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { Wallet } from "../wallets/solanaWallet";
import { Pool } from "../utils/pool";

export interface Quote {
    amountOut: TokenAmount | CurrencyAmount,
    minAmountOut: TokenAmount | CurrencyAmount,
    amountIn?: TokenAmount | CurrencyAmount,
    inputToken?: Token,
    outputToken?: Token,
    instructions?: any,
    poolKeys?: LiquidityPoolKeysV4,
    slippage?: Percent,
}

export interface SwapRequest {
    amountIn: TokenAmount;
    outputToken: Token;
    pool: Pool;
    slippage: Percent;
}

export interface QuoteRequest {
    amountIn: TokenAmount;
    inputToken: Token;
    outputToken: Token;
    poolKeys: LiquidityPoolKeysV4
    slippage: Percent;
}

export type FeeLevel = 'max' | 'high' | 'medium' | 'low' | 'average' | 'median'

export interface BuiltSwap {
    transaction: Transaction | VersionedTransaction,
    lastValidBlockHeight: number,
    priorityFee: number
}

export interface Swap {
    /** the quoted amount out, typically will be the same as what gets swapped */
    amountOut: TokenAmount | CurrencyAmount;
    minAmountOut: TokenAmount | CurrencyAmount;
    txid: string;
    fee: number;
    /** the amount actually swapped out via transfer txn */
    swapAmountOut?: number
    err?: SwapError | null
    timestamp?: number;
}

export interface ConfirmedSwap {
    swapAmountOut: number
    fee: number
    err: SwapError | null
}

export interface SwapError {
    status: string;
    value: string;
}

export interface ExchangeConfig {
    transactionEndpoint: string;
}

export class Exchange {
    public version = "0.0.2";
    public transactionConnection: Connection; // a dedicated connection just for sending transactions
    public quoteErrors = 0;
    public botId: string;
    public botLog: string;
    /** Ensure that all transactions are finalized, `default: false` */
    public finalize = false

    constructor(config: ExchangeConfig) {
        const { transactionEndpoint } = config;
        this.transactionConnection = new Connection(transactionEndpoint, { commitment: 'confirmed' });
    }

    public async getPool(poolId: string): Promise<Pool> {
        throw new Error("Method not implemented.");
    }

    public async getQuote(trade: QuoteRequest, tradeId = ''): Promise<Quote> {
        throw new Error("Method not implemented.");
    }

    public async buildSwap(wallet: Wallet, quote: Quote, maxFee?: number, computeBudgetMargin?: Number, sim = true, reQuote = true, maxRetries = 0, feeLevel: FeeLevel = 'high'): Promise<BuiltSwap> {
        throw new Error("Method not implemented.");
    }

    public async executeSwap(wallet: Wallet,quote: Quote, maxFee?: number, computeBudgetMargin?: Number, sim = true, reQuote = true, maxRetries = 0, feeLevel: FeeLevel = 'high', waitForBlock = true, sendOnly = true): Promise<Swap> {
        throw new Error("Method not implemented.");
    }

    public async confirmTransaction(wallet: Wallet, txid: string, priorityFee: number): Promise<ConfirmedSwap> {
        throw new Error("Method not implemented.");
    }
    
    public async handleInstructionErrors(error: TransactionError): Promise<string> {
        throw new Error("Method not implemented.");
    }
}

