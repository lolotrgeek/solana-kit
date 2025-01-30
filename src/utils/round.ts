/**
 * Round a number to the nearest whole number using Banker's rounding.
 * @param {number} num - The number to round.
 * @return {number} The rounded number.
 */
export function bankersRound(num: number): number {
    const rounded = Math.round(num);
    const isHalf = num - Math.floor(num) === 0.5;

    return isHalf && rounded % 2 !== 0 ? rounded - 1 : rounded;
}