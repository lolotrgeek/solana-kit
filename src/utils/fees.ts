import { clusterApiUrl } from "@solana/web3.js";
import { RAYDIUM_PUBLIC_KEY } from "./constants";

interface RequestPayload {
    method: string;
    params: {
        last_n_blocks: number;
        account: string;
    };
    id: number;
    jsonrpc: string;
}

interface FeeEstimates {
    extreme: number;
    high: number;
    low: number;
    medium: number;
    percentiles: {
        [key: string]: number;
    };
}

interface ResponseData {
    jsonrpc: string;
    result: {
        context: {
            slot: number;
        };
        per_compute_unit: FeeEstimates;
        per_transaction: FeeEstimates;
    };
    id: number;
}

interface EstimatePriorityFeesParams {
    // The number of blocks to consider for the fee estimate
    last_n_blocks?: number;
    // The program account to use for fetching the local estimate (e.g., Jupiter: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4)
    account?: string;
    // Your Add-on Endpoint (found in your QuickNode Dashboard - https://dashboard.quicknode.com/endpoints)
    endpoint: string;
}

export interface Fees {
    [key: string]: number;
    max: number;
    high: number;
    medium: number;
    low: number;
    average: number;
    median: number;
}
// TODO: use default rpc endpoint instead of quicknode api... 
// https://www.quicknode.com/guides/solana-development/transactions/how-to-use-priority-fees
async function fetchEstimatePriorityFees({
    last_n_blocks,
    account,
    endpoint
}: EstimatePriorityFeesParams): Promise<ResponseData> {
    // Only include params that are defined
    const params: any = {};
    if (last_n_blocks !== undefined) {
        params.last_n_blocks = last_n_blocks;
    }
    if (account !== undefined) {
        params.account = account;
    }

    const payload: RequestPayload = {
        method: 'qn_estimatePriorityFees',
        params,
        id: 1,
        jsonrpc: '2.0',
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: ResponseData = await response.json();
    return data;
}

const defaultParams: EstimatePriorityFeesParams = {
    last_n_blocks: 100,
    account: RAYDIUM_PUBLIC_KEY,
    endpoint: clusterApiUrl('mainnet-beta'),
};

/**
 * Uses the QuickNode API to fetch the latest prioritization fees
 * @returns in microlamports
 */
export async function getPrioritizationFees(params?: EstimatePriorityFeesParams): Promise<Fees> {
    params = { ...defaultParams, ...params };
    const { result } = await fetchEstimatePriorityFees(params);
    const max = result.per_compute_unit.extreme; // 👈 Insert business logic to calculate fees depending on your transaction requirements (e.g., low, medium, high, or specific percentile)
    const high = result.per_compute_unit.high;
    const average = result.per_compute_unit.medium;
    const median = result.per_compute_unit.percentiles['50'];
    const low = result.per_compute_unit.low;
    const medium = result.per_compute_unit.medium;
    return {max, high, medium, low, average, median};
}

