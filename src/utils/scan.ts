// Source: https://gist.github.com/Sahilsen/6b31b37b4e66d2d636705b17711f788e
// reference: https://www.youtube.com/watch?v=1LUY_5lPB4I

import { PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js";
import { RAYDIUM_PUBLIC_KEY } from "../utils/constants";
import { PoolAddress } from "./types";
import { NATIVE_MINT } from "@solana/spl-token";

type ParsedInstruction = {
    /** Name of the program for this instruction */
    program: string;
    /** ID of the program for this instruction */
    programId: PublicKey;
    /** Parsed instruction info */
    parsed: InstructionParsed;
}
type ParsedInnerInstruction = {
    index: number;
    instructions: (ParsedInstruction | any)[];
};

interface InstructionParsed {
    info: any;
    type: string;
}

interface TokenTransfer {
    amount: string;
    authority: string;
    destination: string;
    source: string;
}
interface PoolAllocation {
    account: string;
    space: number;
}

export interface PoolInitialInfo {
    id: PoolAddress;
    baseMint: string; // #10
    quoteMint: string; // #9
    baseVault: string;
    quoteVault: string;
    lpMint: string; // #8 
    lpDecimals: number; //#8
    openOrders: string;
    targetOrders: string;
    marketProgramId: string; // #24 - openBook unknown -> accounts 3
    marketId: string;
}

export interface PoolData {
    info: PoolInitialInfo;
    createdAt: number;
    initialLiquidity?: number;
    validated?: boolean;
    nativeVault?: string;    
}


export function parsePoolTransaction(tx: ParsedTransactionWithMeta | null) {
    if (!tx) throw new Error("❗ No transaction found.")
    const poolInstructions = tx.transaction.message.instructions.find(ix => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY)
    if (!poolInstructions) throw new Error("❗ No Raydium instruction found in the transaction.");

    let accounts = tx.transaction.message.accountKeys;
    if (!accounts) throw new Error("❗ No accounts found in the transaction.");

    let innerInstructions = tx.meta?.innerInstructions;
    if (!innerInstructions) throw new Error("❗ No inner instructions found in the transaction.")
    let instructions = innerInstructions.map((instruction: any) => (instruction as ParsedInnerInstruction).instructions).flat()
    return instructions
}

export function parsePoolInstructions(instructions: ParsedInstruction | any): PoolInitialInfo {
    //TODO: this is a very basic parser, it needs to be improved to be more robust, array order could change...
    const id = instructions[19].parsed.info.account
    const baseMint = instructions[12].parsed.info.mint
    const quoteMint = instructions[16].parsed.info.mint
    const baseVault = instructions[10].parsed.info.account
    const quoteVault = instructions[14].parsed.info.account
    const lpMint = instructions[8].parsed.info.mint
    const lpDecimals = instructions[8].parsed.info.decimals
    const openOrders = instructions[21].parsed.info.account
    const targetOrders = instructions[3].parsed.info.account
    const marketProgramId = instructions[22].parsed.info.owner
    const marketId = String(instructions[23].accounts[2])

    if (!id || !baseMint || !quoteMint) throw new Error("❗ No pool or token instructions found in the transaction instructions.")


    return { id, baseMint, quoteMint, baseVault, quoteVault, lpMint, lpDecimals, openOrders, targetOrders, marketProgramId, marketId };
}

export async function parseTransaction(tx: ParsedTransactionWithMeta | null) {
    if (!tx) throw new Error("❗ No transaction found.")
    let accounts = tx.transaction.message.accountKeys;
    if (!accounts) throw new Error("❗ No accounts found in the transaction.");
    let innerInstructions = tx.meta?.innerInstructions;
    if (!innerInstructions) throw new Error("❗ No inner instructions found in the transaction.")
    const instructions = innerInstructions.map((instruction: ParsedInnerInstruction) => instruction.instructions).flat()
    const filteredInstructions = instructions.filter(instr =>
        typeof instr === 'object' && instr !== null && instr.parsed && instr.parsed.info && instr.program === 'spl-token' &&
        (instr.parsed.type === 'transfer' || instr.parsed.type === 'transferChecked')
    );
    if (!tx) throw new Error("No transaction found.")
    if (!tx.meta) throw new Error("No transaction meta found.")
    if (!tx.meta.postTokenBalances) throw new Error("No post token balances found.")
    return filteredInstructions
}


/**
 * 
 * @param instructions 
 * @param validAuthority give an authority address to validate the transaction
 * @returns 
 */
export async function parseForInitialLiquidity(instructions: any[], validAuthority?: string): Promise<{ nativeVault: string, initialLiquidity: number, validated: boolean }> {
    let initialLiquidity = 0
    let nativeVault = ''
    let validated = false
    const transfers = instructions.filter((instruction: any) => instruction?.parsed?.type === 'transfer')
    const accounts = instructions.filter((instruction: any) => instruction?.parsed?.type === 'initializeAccount')

    if (accounts) accounts.map((account: any) => {
        if (account.program === 'spl-token') {
            if (account?.parsed?.info?.mint === NATIVE_MINT.toString()) {
                // console.log('🌊 Sol Liquidity Account:', account?.parsed?.info?.account)
                nativeVault = account?.parsed?.info?.account
            }
        }
    })
    if (transfers) transfers.map((transfer: any) => {
        const amount = transfer?.parsed?.info?.amount
        const source = transfer?.parsed?.info?.source
        const authority = transfer?.parsed?.info?.authority
        const destination = transfer?.parsed?.info?.destination

        if (transfer.program === 'spl-token') {
            if (validAuthority && authority === validAuthority) {
                validated = true
            }
            if (destination === nativeVault) {
                initialLiquidity = Number(amount)
            }
        }

    })
    return { nativeVault, initialLiquidity, validated }
}