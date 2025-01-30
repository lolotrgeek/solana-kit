import { jsonInfo2PoolKeys, LiquidityPoolKeys, ApiPoolInfoV4, LIQUIDITY_STATE_LAYOUT_V4, Liquidity, MARKET_STATE_LAYOUT_V3, Market, SPL_MINT_LAYOUT, } from '@raydium-io/raydium-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import { isNativeAddress, TokenData } from "./token";
import { RAYDIUM_AUTHORITY, RAYDIUM_PUBLIC_KEY } from "../utils/constants";
import { PoolInitialInfo } from './scan';

export interface Pool {
    poolInfo: ApiPoolInfoV4
    poolKeys: LiquidityPoolKeys
}

export async function formatAmmKeysById(connection: Connection, poolId: string): Promise<ApiPoolInfoV4> {
    //TODO: might be able to make this more efficient by using getMultipleAccounts
    const account = await connection.getAccountInfo(new PublicKey(poolId) , {commitment: 'confirmed' })
    if (account === null) throw Error(' get id info error ')
    const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data)

    const marketId = info.marketId
    const marketAccount = await connection.getAccountInfo(marketId, {commitment: 'confirmed' })
    if (marketAccount === null) throw Error(' get market info error')
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data)

    const lpMint = info.lpMint
    const lpMintAccount = await connection.getAccountInfo(lpMint, {commitment: 'confirmed' })
    if (lpMintAccount === null) throw Error('get lp mint info error')
    const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data)

    return {
        id: poolId,
        baseMint: info.baseMint.toString(),
        quoteMint: info.quoteMint.toString(),
        lpMint: info.lpMint.toString(),
        baseDecimals: info.baseDecimal.toNumber(),
        quoteDecimals: info.quoteDecimal.toNumber(),
        lpDecimals: lpMintInfo.decimals,
        version: 4,
        programId: account.owner.toString(),
        authority: Liquidity.getAssociatedAuthority({ programId: account.owner }).publicKey.toString(),
        openOrders: info.openOrders.toString(),
        targetOrders: info.targetOrders.toString(),
        baseVault: info.baseVault.toString(),
        quoteVault: info.quoteVault.toString(),
        withdrawQueue: info.withdrawQueue.toString(),
        lpVault: info.lpVault.toString(),
        marketVersion: 3,
        marketProgramId: info.marketProgramId.toString(),
        marketId: info.marketId.toString(),
        marketAuthority: Market.getAssociatedAuthority({ programId: info.marketProgramId, marketId: info.marketId }).publicKey.toString(),
        marketBaseVault: marketInfo.baseVault.toString(),
        marketQuoteVault: marketInfo.quoteVault.toString(),
        marketBids: marketInfo.bids.toString(),
        marketAsks: marketInfo.asks.toString(),
        marketEventQueue: marketInfo.eventQueue.toString(),
        lookupTableAccount: PublicKey.default.toString()
    }
}

/**
 * Consumes existing Pool and Token data and adds market Data to build an ApiPoolInfo object
 * @param connection 
 * @param pool_info 
 * @param token 
 * @returns 
 */
export async function buildPoolInfo(connection: Connection, pool_info: PoolInitialInfo, token: TokenData): Promise<ApiPoolInfoV4> {
    const {baseMint, quoteMint, marketProgramId, marketId } = pool_info
    
    let baseDecimals = 0
    let quoteDecimals = 0
    if(isNativeAddress(baseMint)) baseDecimals = 9
    else baseDecimals = token.decimals
    if(isNativeAddress(quoteMint)) quoteDecimals = 9
    else quoteDecimals = token.decimals

    const programId = new PublicKey(marketProgramId)
    const market_Id = new PublicKey(marketId)

    const marketAccount = await connection.getAccountInfo(market_Id, {commitment: 'confirmed' })
    if (marketAccount === null) throw Error(' get market info error')
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data)

    return {
        ...pool_info,
        baseDecimals,
        quoteDecimals,
        version: 4,
        authority: RAYDIUM_AUTHORITY,
        programId: RAYDIUM_PUBLIC_KEY,
        withdrawQueue: PublicKey.default.toString(),
        lpVault: PublicKey.default.toString(),
        marketVersion: 3,
        marketProgramId: marketProgramId,
        marketAuthority: Market.getAssociatedAuthority({ programId, marketId: market_Id }).publicKey.toString(),
        marketBaseVault: marketInfo.baseVault.toString(),
        marketQuoteVault: marketInfo.quoteVault.toString(),
        marketBids: marketInfo.bids.toString(),
        marketAsks: marketInfo.asks.toString(),
        marketEventQueue: marketInfo.eventQueue.toString(),
        lookupTableAccount: PublicKey.default.toString()
    }
}

export function buildPool(poolInfo: ApiPoolInfoV4): Pool {
    const poolKeys = jsonInfo2PoolKeys(poolInfo) as LiquidityPoolKeys
    return {poolKeys, poolInfo}
}

/**
 * fetches and returns the pool info and keys
 * @param connection 
 * @param poolId 
 * @returns 
 */
export async function getPool(connection: Connection, poolId: string): Promise<Pool> {
    try {
        const poolInfo = await formatAmmKeysById(connection, poolId)
        if (!poolInfo) throw new Error('cannot find the target pool')
        const poolKeys = jsonInfo2PoolKeys(poolInfo) as LiquidityPoolKeys
        return {poolKeys, poolInfo}
    } catch (error) {
        throw new Error(`getPool error: ${error}`)
    }
}

export function comparePools(pool1: ApiPoolInfoV4, pool2: ApiPoolInfoV4): boolean {
    const keys = Object.keys(pool1) as (keyof ApiPoolInfoV4)[];
    
    for (const key of keys) {
        if (pool1[key] !== pool2[key]) {
            return false;
        }
    }
    
    return true;
}

export function isNativePool(pool: Pool): boolean {
    return isNativeAddress(pool.poolInfo.baseMint) || isNativeAddress(pool.poolInfo.quoteMint);
}
