import { Mint, NATIVE_MINT, NATIVE_MINT_2022, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { Metaplex } from "@metaplex-foundation/js";
import { Connection, PublicKey } from "@solana/web3.js";
import { PoolAddress, TimeStamp } from "./types";
import { ApiPoolInfoV4, Token } from "@raydium-io/raydium-sdk";

export const SOLTOKEN = new Token(TOKEN_PROGRAM_ID, NATIVE_MINT, 9, 'SOL');

export interface TokenMetaData {
    tokenName: string;
    tokenSymbol: string;
    tokenLogo: string;
    tokenWebsite: string;
}

export interface RawTokenData {
    tokenMetadata: TokenMetaData;
    unpackedMint: Mint;
}

export interface TokenData {
    address: string;
    chainId: number;
    decimals: number;
    name: string;
    symbol: string;
    logoURI: string;
    tags: string[];
    extensions: {
        coingeckoId: string;
    };
    tokenProgram: string;
    date: string;
    poolId: string;
    poolCreatedAt?: number;
    total_supply?: number
    initialOutstanding?: number
    initialOutstandingPercent?: number;
    poolInfo?: ApiPoolInfoV4
    firstAudit?: TimeStamp
    firstSelection?: TimeStamp
}

export function isNativeAddress(tokenId: string) {
    return tokenId === NATIVE_MINT.toString() || tokenId === NATIVE_MINT_2022.toString();
}

/**
 * 
 * @param tokenId 
 * @returns 
 * https://github.com/cryptoloutre/fetch-token-and-its-metadata
 * https://github.com/metaplex-foundation/js#the-nft-model
 * 
 */
export async function getTokenMetadata(tokenId: string, connection: Connection): Promise<TokenMetaData> {
    const metaplex = Metaplex.make(connection);

    const mintAddress = new PublicKey(tokenId);

    let tokenName = '';
    let tokenSymbol = '';
    let tokenLogo = '';
    let tokenWebsite = ''

    const metadataAccount = metaplex
        .nfts()
        .pdas()
        .metadata({ mint: mintAddress });

    const metadataAccountInfo = await connection.getAccountInfo(metadataAccount);

    if (metadataAccountInfo) {
        const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });
        tokenName = token.name;
        tokenSymbol = token.symbol;
        tokenLogo = token?.json?.image || '';
        tokenWebsite = token?.json?.external_url || ''
    }
    return { tokenName, tokenSymbol, tokenLogo, tokenWebsite };
}

/**
 * Fetches Token data from the chain
 * @param tokenId 
 * @param poolId 
 * @returns 
 */
export async function getToken(tokenId: string, connection: Connection, poolId?: PoolAddress, ): Promise<TokenData> {
    try {
        const tokenInfo = await connection.getAccountInfo(new PublicKey(tokenId));
        const { address, decimals } = unpackMint(new PublicKey(tokenId), tokenInfo, TOKEN_PROGRAM_ID);
        const { tokenName, tokenSymbol, tokenLogo } = await getTokenMetadata(tokenId, connection);
        //TODO: could add freeze and mint authority
        const tokenData = {
            address: address.toString(),
            chainId: 101,
            decimals,
            name: tokenName,
            symbol: tokenSymbol,
            logoURI: tokenLogo,
            tags: [],
            extensions: { coingeckoId: '' },
            tokenProgram: TOKEN_PROGRAM_ID.toString(),
            date: new Date().toISOString(),
            poolId: poolId || ''
        } as TokenData
        return tokenData

    } catch (error) {
        throw error
    }
}

export async function getRaydiumToken(tokenId: string, connection: Connection): Promise<Token> {
    try {
        const tokenInfo = await connection.getAccountInfo(new PublicKey(tokenId));
        const { address, decimals } = unpackMint(new PublicKey(tokenId), tokenInfo, TOKEN_PROGRAM_ID);
        const { tokenName, tokenSymbol } = await getTokenMetadata(tokenId, connection);
        return new Token(TOKEN_PROGRAM_ID, address, decimals, tokenSymbol, tokenName)
    } catch (error) {
        throw error
    }
}

