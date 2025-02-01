export interface ConfirmationStatus {
    status: 'pending' | 'processed' | 'confirmed' | 'finalized' | 'error'
    value?: string
}

export async function checkTransaction(txid: string): Promise<ConfirmationStatus> {
    try {
        // NOTE: may want to set searchTransactionHistory to true if we are checking a transaction that is older
        const status = await this.transactionConnection.getSignatureStatuses([txid], { searchTransactionHistory: false })
        if (!status) return { status: 'pending', value: 'No status found' }
        if (!status.value) return { status: 'pending', value: 'No status value found' }
        if (!status.value[0]) return { status: 'pending', value: 'No status value found' }
        if (status.value[0].err) return { status: 'error', value: JSON.stringify(status.value[0].err) }
        if (status && status.value && status.value[0].confirmationStatus) return { status: status.value[0].confirmationStatus }
        return { status: 'pending' }
    } catch (error) {
        return { status: 'pending', value: JSON.stringify(error) }
    }
}