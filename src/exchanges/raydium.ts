
import { VersionedTransaction, LAMPORTS_PER_SOL, ParsedInnerInstruction, TransactionError, ParsedTransactionWithMeta } from "@solana/web3.js";
import { buildSimpleTransaction, Liquidity, TxVersion, LOOKUP_TABLE_CACHE, ComputeBudgetConfig, TokenAmount, Token, Percent, LiquidityPoolKeysV4, CurrencyAmount } from '@raydium-io/raydium-sdk';
import { MICRO_LAMPORTS_PER_LAMPORT } from '../utils/constants';
import { getPrioritizationFees } from '../utils/fees';
import { bankersRound } from '../utils/round';
import { getPool, Pool } from '../utils/pool';
import { Exchange, ExchangeConfig, Swap, ConfirmedSwap, BuiltSwap, SwapError, ConfirmationStatus, QuoteRequest } from "./exchange";
import { delay } from "../utils/delay";
import { log } from "../utils/logger";
import { Wallet } from "../wallets/solanaWallet";

/** The value of a desired Trade. */
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

interface ParsedTransfers {
    transferOut: { amount: number, type: string, authority: string } | undefined,
    transferIn: { amount: number, type: string, source: string } | undefined
}


export class Raydium extends Exchange {
    public version = "0.4.3";

    constructor(config: ExchangeConfig) {
        const { transactionEndpoint } = config;
        super({ transactionEndpoint });
    }

    public async getPool(poolId: string): Promise<Pool> {
        return getPool(this.transactionConnection, poolId);
    }

    public async getQuote(quoteRequest: QuoteRequest): Promise<Quote> {
        try {
            const { amountIn, inputToken, outputToken, poolKeys, slippage } = quoteRequest;
            if (!amountIn || !inputToken || !outputToken || !poolKeys || !slippage) throw new Error('Invalid quote request');
            const quote = Liquidity.computeAmountOut({
                poolKeys,
                poolInfo: await Liquidity.fetchInfo({ connection: this.transactionConnection, poolKeys }),
                amountIn: amountIn,
                currencyOut: outputToken,
                slippage: slippage,
            })
            if (!quote) {
                throw new Error('No quote found');
            }
            this.quoteErrors = 0;
            return {
                amountOut: quote.amountOut,
                minAmountOut: quote.minAmountOut,
                inputToken,
                amountIn,
                outputToken,
                slippage,
                poolKeys
            };
        } catch (error) {
            this.quoteErrors += 1;
            throw new Error(`Quote Error: ${error}`);
        }
    }

    /**
     * Create and sign a valid swap transaction
     * @param quote 
     * @param maxFee 
     * @param computeBudgetMargin 
     * @param sim 
     * @param reQuote 
     * @param maxRetries 
     * @param feeLevel 
     * @returns 
     */
    public async buildSwap(wallet: Wallet, quote: Quote, maxFee: number, computeBudgetMargin = 0.10, sim = true, reQuote = false, maxRetries = 0, feeLevel = 'high'): Promise<BuiltSwap> {
        const { amountIn, outputToken, inputToken, poolKeys, slippage } = quote;
        let amountOut = quote.amountOut;
        let minAmountOut = quote.minAmountOut;

        if (!amountIn || !outputToken || !inputToken || !poolKeys || !slippage) throw new Error('Invalid quote');
        if (reQuote === true) {
            const new_quote = Liquidity.computeAmountOut({
                poolKeys,
                poolInfo: await Liquidity.fetchInfo({ connection: this.transactionConnection, poolKeys }),
                amountIn,
                currencyOut: outputToken,
                slippage,
            })
            amountOut = new_quote.amountOut;
            minAmountOut = new_quote.minAmountOut;
            log("✅ - Re-Quoted");
        }
        const OutSymbol = outputToken.symbol;
        const InSymbol = inputToken.symbol;
        log(`🔄 Swapping ${String(amountIn.toFixed())} ${InSymbol} for ${String(minAmountOut.toFixed())} ${OutSymbol}`)

        const tokenAccounts = await wallet.getWalletTokenAccount()

        log("✅ - Fetched Wallet Token Accounts");

        const priority_fees = await getPrioritizationFees()

        if (!priority_fees) {
            throw new Error("No prioritization fees found")
        }
        if (!(feeLevel in priority_fees)) {
            throw new Error(`Invalid fee level: ${feeLevel}`)
        }
        const PRIORITY_RATE = priority_fees[feeLevel]
        log(`💰 Setting ${feeLevel} priority rate: ${PRIORITY_RATE} micro-lamports.`);

        let computeBudgetConfig: ComputeBudgetConfig = {
            microLamports: PRIORITY_RATE,
        }
        let priorityFee = 0
        let priority_fee_lamports = 0
        if (sim === true) {
            log("🔄 Simulating Transaction!")
            const pre_innerInstructions = await Liquidity.makeSwapInstructionSimple({
                connection: this.transactionConnection,
                poolKeys,
                userKeys: {
                    tokenAccounts,
                    owner: wallet.keypair.publicKey,
                },
                amountIn,
                amountOut: minAmountOut,
                fixedSide: 'in',
                makeTxVersion: TxVersion.V0,
                computeBudgetConfig
            })

            const block = await this.transactionConnection.getLatestBlockhash();
            log(`✅ - Sim Fetched latest blockhash. Last Valid Height: ${block.lastValidBlockHeight}`);
            const pre_transactions = await buildSimpleTransaction({
                connection: this.transactionConnection,
                makeTxVersion: TxVersion.V0,
                payer: wallet.keypair.publicKey,
                innerTransactions: pre_innerInstructions.innerTransactions,
                addLookupTableInfo: LOOKUP_TABLE_CACHE,
                recentBlockhash: block.blockhash
            })
            log("✅ - Sim Compiled Transaction Message")
            const pre_transaction = pre_transactions[0];

            const simulatedTransaction = await this.transactionConnection.simulateTransaction(pre_transaction as VersionedTransaction)
            if (simulatedTransaction.value.err) {
                const err = await this.handleInstructionErrors(simulatedTransaction.value.err)
                throw new Error(err)
            }
            if (!simulatedTransaction.value.unitsConsumed) {
                throw new Error('No units consumed');
            }
            log("✅ - Transaction Simulated")
            computeBudgetConfig.units = bankersRound((simulatedTransaction.value.unitsConsumed * computeBudgetMargin) + simulatedTransaction.value.unitsConsumed);
            priorityFee = PRIORITY_RATE * computeBudgetConfig.units;
            log(`💰 Setting fee: ${priorityFee} micro-lamports.`);
            priority_fee_lamports = priorityFee / MICRO_LAMPORTS_PER_LAMPORT
            if (priority_fee_lamports > maxFee * Number(minAmountOut.raw)) {
                throw new Error('priority_fee_too_high')
            }
        }

        const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
            connection: this.transactionConnection,
            poolKeys,
            userKeys: {
                tokenAccounts,
                owner: wallet.keypair.publicKey,
            },
            amountIn,
            amountOut: minAmountOut,
            fixedSide: 'in',
            makeTxVersion: TxVersion.V0,
            computeBudgetConfig

        })
        const { blockhash, lastValidBlockHeight } = await this.transactionConnection.getLatestBlockhash();
        log(`✅ - Fetched latest blockhash. Last Valid Height: ${lastValidBlockHeight}`);
        const transactions = await buildSimpleTransaction({
            connection: this.transactionConnection,
            makeTxVersion: TxVersion.V0,
            payer: wallet.keypair.publicKey,
            innerTransactions: innerTransactions,
            addLookupTableInfo: LOOKUP_TABLE_CACHE,
            recentBlockhash: blockhash
        })
        log("✅ - Compiled Transaction Message")
        const transaction = transactions[0];
        if (transaction instanceof VersionedTransaction) {
            transaction.sign([wallet.keypair]);
            log("✅ - Transaction Signed");
            return { transaction, lastValidBlockHeight, priorityFee };
        }
        else {
            throw new Error('Not Versioned: Transaction not created');
        }
    }
    /**
     * 
     * @param quote 
     * @param maxFee 
     * @param computeBudgetMargin 
     * @param sim 
     * @param reQuote 
     * @param maxRetries 
     * @param feeLevel `max`, `high`, `medium`, `low`, `average`, `median`, 
     * @param waitForBlock during confirmation of transaction, wait to check against block height to confirm a failed transaction
     * @param sendOnly if true, will only send the transaction and skip all confirmation steps
     * @returns 
     */
    public async executeSwap(wallet: Wallet, quote: Quote, maxFee: number, computeBudgetMargin = 0.10, sim = true, reQuote = false, maxRetries = 0, feeLevel = 'high', waitForBlock = true, sendOnly = false): Promise<Swap> {
        const { amountIn, outputToken, inputToken, poolKeys, slippage } = quote;
        let amountOut = quote.amountOut;
        let minAmountOut = quote.minAmountOut;

        if (!amountIn || !outputToken || !inputToken || !poolKeys || !slippage) throw new Error('Invalid quote');

        const { transaction, lastValidBlockHeight, priorityFee } = await this.buildSwap(wallet, quote, maxFee, computeBudgetMargin, sim, reQuote, maxRetries, feeLevel);

        if (transaction instanceof VersionedTransaction) {
            if (sendOnly) {
                const txid = await this.transactionConnection.sendTransaction(transaction, { skipPreflight: false, maxRetries: 0 });
                log(`✅ - Transaction sent to network: https://solscan.io/tx/${txid}`)
                return { amountOut, minAmountOut, txid, swapAmountOut: 0, fee: 0, err: null }
            }
            else {
                const txid = await this.sendAndConfirmTransaction(transaction, waitForBlock ? lastValidBlockHeight : 0)
                const { swapAmountOut, fee, err } = this.finalize ? await this.finalizeTransaction(wallet, txid, priorityFee, lastValidBlockHeight) : await this.confirmTransaction(wallet, txid, priorityFee)
                return { amountOut, minAmountOut, txid, swapAmountOut, fee, err }
            }
        }
        else {
            throw new Error('Transaction not created');
        }
    }

    public async handleInstructionErrors(error: TransactionError): Promise<string> {
        if (typeof error === 'string') {
            try {
                error = JSON.parse(error)
            } catch (err) {
                log(`❌ - Transaction simulation failed: ${error}`)
                return String(error)
            }
        }
        if (typeof error === 'object') {
            if ('InstructionError' in error) {
                const instructionError = error.InstructionError;
                if (Array.isArray(instructionError) && instructionError.length > 1 && typeof instructionError[1] === 'object' && 'Custom' in instructionError[1]) {
                    const customErrorCode = instructionError[1].Custom;
                    if (customErrorCode === 40) {
                        log(`❌ - Transaction simulation failed: Insufficient Funds (Custom 40)`);
                        return 'insufficient_funds'
                    } else if (customErrorCode === 30) {
                        log(`❌ - Transaction simulation failed: Slippage (Custom 30)`);
                        return 'slippage'
                    }
                    // Add more custom error handling as needed
                }
                log(`❌ - Transaction simulation failed: ${JSON.stringify(instructionError)}`);
                return JSON.stringify(instructionError)
            }
            log(`❌ - Transaction simulation failed: ${JSON.stringify(error)}`);
            return JSON.stringify(error)
        }
        log(`❌ - Transaction simulation failed: ${error}`);
        return 'unknown_error'
    }

    public async sendAndConfirmTransaction(transaction: VersionedTransaction, blockHeight: number, txid = '', retries = 0): Promise<string> {
        // after 4 seconds, stop sending...
        if (retries < 10) {
            try {
                // TODO: consider preflight checking here, and catching an already processed error
                txid = await this.transactionConnection.sendTransaction(transaction, { skipPreflight: true, maxRetries: 0 });
                log(`✅ - Transaction sent to network: https://solscan.io/tx/${txid}`)
            } catch (error: any) {
                log(`❌ - Transaction failed to send: ${error.message}`)
                await delay(400)
                return this.sendAndConfirmTransaction(transaction, blockHeight, txid, retries + 1)
            }
        }
        const check = await this.checkTransaction(txid)
        log(`🔄 Checking transaction status: ${check.status} ${check.value ?? ''}`)
        // TODO: there is a chance that a confirmed transaction could be reverted or dropped... maybe we check wallet balance after a confirmed transaction to ensure it went through?
        // (possible that RPC node doesn't like being spammed and is dropping the transaction)
        if (check.status === 'confirmed' || check.status === 'finalized') return txid
        if (check.status === 'error') throw (new Error(`Transaction failed: ${check.value}`))
        // after 4 seconds, start checking if it has failed...
        if (retries > 10) {
            // if we are attempting to transact quickly, we should not wait for the transaction to be checked against the block height
            if (blockHeight <= 0) {
                log(` ❗ Transaction MAY have failed: ${check.value}`)
                return txid
            }
            // otherwise wait for block to finalize to ensure that the transaction has definitely failed
            const failed = await this.hasFailed(check, blockHeight)
            if (failed) throw (new Error(`Transaction failed: ${check.value}`))
        }
        retries += 1
        // 400 ms is that the rate at which txns are confirmed, 4 seconds is the rate at which blocks are confirmed
        await delay(400)
        return this.sendAndConfirmTransaction(transaction, blockHeight, txid, retries)
    }

    public async checkTransaction(txid: string): Promise<ConfirmationStatus> {
        try {
            // NOTE: may want to set searchTransactionHistory to true if we are checking a transaction that is older
            const status = await this.transactionConnection.getSignatureStatuses([txid], { searchTransactionHistory: false })
            if (!status) return { status: 'pending', value: 'No status found' }
            if (!status.value) return { status: 'pending', value: 'No status value found' }
            if(!status.value[0]) return { status: 'pending', value: 'No status value found' }
            if (status.value[0].err) return { status: 'error', value: JSON.stringify(status.value[0].err) }
            if (status && status.value && status.value[0].confirmationStatus) return { status: status.value[0].confirmationStatus }
            return { status: 'pending' }
        } catch (error) {
            return { status: 'pending', value: JSON.stringify(error) }
        }

    }

    /**
     * Run this after we get an error from the transaction to ensure that the transaction failed
     * @param blockHeightAtTransaction - is the lastValidBlockHeight at the time of the transaction
     */
    public async hasFailed(check: ConfirmationStatus, blockHeightAtTransaction: number): Promise<boolean> {
        // TODO: could do a wallet check to see if the token transferred in after a failed transaction
        const currentBlockHeight = await this.transactionConnection.getBlockHeight({ commitment: 'finalized' })
        //NOTE: not sure if we need 150 here or not, does that add a second block?
        if (currentBlockHeight > blockHeightAtTransaction) {
            log(`Current Block Height: ${currentBlockHeight}, Block Height at Transaction: ${blockHeightAtTransaction}`)
            if (check.status === 'finalized') return false
            if (check.status === 'confirmed') return false
            if (check.status === 'error') return true
            if (check.status === 'pending') return true
        }
        return false
    }

    public async confirmTransaction(wallet: Wallet, txid: string, priorityFee: number): Promise<ConfirmedSwap> {
        let networkfee = 0
        let swapAmountOut = 0
        let fee = 0
        let err: SwapError | null = null
        const priority_fee_lamports = (priorityFee / MICRO_LAMPORTS_PER_LAMPORT)
        try {
            const result = await this.transactionConnection.getParsedTransaction(txid, { maxSupportedTransactionVersion: TxVersion.V0, commitment: 'confirmed' });
            if (!result) {
                log(`❌ Unable to get transaction details`)
                err = { status: 'maybe', value: 'Txn may have failed. Unable to get transaction details.' }
            }
            else if (!result.meta) {
                log(`❌ Unable to get transaction meta`)
                err = { status: 'maybe', value: 'Txn may have failed. Unable to get transaction meta.' }
            }
            else if (!result.meta.innerInstructions) {
                log(`❌ Unable to get inner instructions`)
                err = { status: 'maybe', value: 'Txn may have failed. Unable to get inner instructions.' }
            }
            else {
                networkfee = (result.meta.fee || 0); // as LAMPORTS
                fee = networkfee + priority_fee_lamports;
                // NOTE: what comes "out" of the swap is what comes in to the wallet from the pool, that's why we use transferIn for swapAmountOut
                const { transferIn } = await this.parseInnerTransaction(wallet, result)
                if (transferIn) swapAmountOut = Number(transferIn.amount)
                else {
                    log(`❌ Unable to find swap amount out in transaction instructions`)
                    err = { status: 'maybe', value: 'Txn may have failed. Unable to get swap out details.' }
                }
            }

            log(`💰 Fees Paid: ${fee / LAMPORTS_PER_SOL} SOL, network: ${networkfee / LAMPORTS_PER_SOL}, priority: ${priority_fee_lamports / LAMPORTS_PER_SOL}`);
            if (!err) log(`🎉 Transaction ${txid} Successfully Confirmed!`)
        } catch (error) {
            log(`❌ Error getting transaction details: ${error}`);
        }
        return { swapAmountOut, fee, err }
    }

    public async finalizeTransaction(wallet: Wallet, txid: string, priorityFee: number, lastValidBlockHeight: number, retries = 0): Promise<ConfirmedSwap> {
        let failed = false
        if (failed) throw (new Error(`Transaction never finalized: ${txid}`))
        try {
            if (retries > 30) {
                const reCheck = await this.checkTransaction(txid)
                failed = await this.hasFailed(reCheck, lastValidBlockHeight)
            }
            log(`🔄 Finalizing Transaction ${txid}...`)
            let networkfee = 0
            let swapAmountOut = 0
            let fee = 0
            const priority_fee_lamports = (priorityFee / MICRO_LAMPORTS_PER_LAMPORT)
            const result = await this.transactionConnection.getParsedTransaction(txid, { maxSupportedTransactionVersion: TxVersion.V0, commitment: 'finalized' });
            if (!result) throw new Error(`Unable to get transaction details`)
            else if (!result.meta) throw new Error(`Unable to get transaction meta`)
            else if (!result.meta.innerInstructions) throw new Error(`Unable to get inner instructions`)
            else {
                networkfee = (result.meta.fee || 0); // as LAMPORTS
                fee = networkfee + priority_fee_lamports;
                // NOTE: what comes "out" of the swap is what comes in to the wallet from the pool, that's why we use transferIn for swapAmountOut
                const { transferIn } = await this.parseInnerTransaction(wallet, result)
                if (transferIn) swapAmountOut = Number(transferIn.amount)
                else log(`❌ Unable to find swap amount out in transaction instructions`)
            }
            log(`💰 Final Fees Paid: ${fee / LAMPORTS_PER_SOL} SOL, network: ${networkfee / LAMPORTS_PER_SOL}, priority: ${priority_fee_lamports / LAMPORTS_PER_SOL}`);
            log(`🎉 Transaction Succesfully Finalized! `)
            return { swapAmountOut, fee, err: null }
        } catch (error) {
            log(`❌ ${error}`);
            retries += 1
            await delay(1000)
            return this.finalizeTransaction(wallet, txid, priorityFee, lastValidBlockHeight, retries)
        }
    }

    /**
     * Not working yet
     * @param txid 
     * @param priority_fee_lamports 
     * @returns 
     */
    public subscribeForConfirmation(wallet: Wallet, txid: string, blockHeight: number, priority_fee_lamports: number): Promise<ConfirmedSwap> {
        // IDEA: keep this, but do a check for the transaction status right away... that way if it fails, we can throw an error right away... then set a timeout on the sub wherein we check status again???? if pending, keep subscribing, if confirmed, resolve the promise and unsubscribe
        return new Promise(async (resolve, reject) => {
            //TODO: issue here is that if the txn fails, we will never resolve this promise
            this.transactionConnection.onSignature(txid, async (message: any) => {
                // TODO: pretty sure we don't need to ubsubscribe given the caution in the docs: https://solana.com/docs/rpc/websocket/signaturesubscribe
                if (message?.value?.err) {
                    const status = await this.checkTransaction(txid)
                    const hasFailed = await this.hasFailed(status, blockHeight)
                }
                if (message?.value?.confirmationStatus === 'confirmed' || message?.value?.confirmationStatus === 'finalized') {
                    const { swapAmountOut, fee } = await this.confirmTransaction(wallet, txid, priority_fee_lamports)
                    resolve({ swapAmountOut, fee, err: null })
                }
            }, 'confirmed');
        })
    }

    parseInnerTransaction(wallet: Wallet, transaction: ParsedTransactionWithMeta): ParsedTransfers {
        let transferOut, transferIn
        const innerInstructions = transaction?.meta?.innerInstructions;
        const flattenedInstructions = innerInstructions?.map((instruction: ParsedInnerInstruction) => instruction.instructions).flat()
        if (flattenedInstructions) {
            const transfers = flattenedInstructions.filter((instruction: any) => instruction?.parsed?.type === 'transfer')
            if (transfers) transfers.map((transfer: any) => {
                const amount = transfer?.parsed?.info?.amount
                const source = transfer?.parsed?.info?.source
                const authority = transfer?.parsed?.info?.authority
                if (authority === wallet.keypair.publicKey.toString()) {
                    transferOut = { amount, type: 'out', authority }
                    return transferOut
                }
                else {
                    transferIn = { amount, type: 'in', source }
                    return transferIn
                }
            })

        }
        return { transferOut, transferIn }
    }

    /**
     * (DEPRECATED)
     * @param txid 
     * @param blockHeight 
     * @param retries 
     * @returns 
     */
    public async waitingForConfirmation(txid: string, blockHeight: number, retries = 0): Promise<boolean> {
        const check = await this.checkTransaction(txid)
        log(`🔄 Checking transaction status: ${check.status} ${check.value ?? ''}`)
        if (check.status === 'confirmed' || check.status === 'finalized') return true
        if (check.status === 'pending') { }
        if (check.status === 'error') {
            throw (new Error(`Transaction failed: ${check.value}`))
        }
        if (retries > 20) {
            const failed = await this.hasFailed(check, blockHeight)
            if (failed) throw (new Error(`Transaction failed: ${check.value}`))
        }
        retries += 1
        await delay(100 * retries)
        return this.waitingForConfirmation(txid, blockHeight, retries)
    }

    /**
     * Send a transaction without confirmation for 4 seconds (DEPRECATED)
     * @param transaction 
     */
    public async reSend(transaction: VersionedTransaction): Promise<void> {
        for (let i = 0; i < 10; i++) {
            const txid = await this.transactionConnection.sendTransaction(transaction, { skipPreflight: true, maxRetries: 0 });
            log(`✅ - Transaction sent to network: https://solscan.io/tx/${txid}`)
            await delay(400)
        }
    }

    /**
     * Send a transaction without confirmation for 4 seconds (DEPRECATED)
     * @param transaction 
     */
    public async reSendUntilConfirmed(transaction: VersionedTransaction, blockHeightAtTransaction: number): Promise<void> {
        while (true) {
            const txid = await this.transactionConnection.sendTransaction(transaction, { skipPreflight: true, maxRetries: 0 });
            log(`✅ - Transaction sent to network: https://solscan.io/tx/${txid}`)
            await delay(400)
            let currentBlockHeight = await this.transactionConnection.getBlockHeight({ commitment: 'finalized' })
            if (currentBlockHeight > blockHeightAtTransaction + 150) {
                break
            }
        }
    }

}