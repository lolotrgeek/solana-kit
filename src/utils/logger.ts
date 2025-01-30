
export async function error(msg: string): Promise<void> {
    await this.log(`❌ Error: ${msg}`);
    await console.error(this.botId, this.version, msg);
}

export async function log(msg: string): Promise<void> {
    if (typeof msg !== 'string') msg = JSON.stringify(msg)
    await console.log(msg);
}
