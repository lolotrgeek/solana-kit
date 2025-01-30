import { Percent } from "@raydium-io/raydium-sdk";

/**
 * Function to parse any number to a percentage
 * @param value 
 * @returns 
 */
export function parseToPercent(value: number): Percent {
    let denominator = 100;
    let numerator = value;

    if (value < 1) {
        numerator = value;
        denominator = 100;

        while (numerator % 1 !== 0) {
            numerator *= 10;
            denominator *= 10;
        }
    }

    return new Percent(numerator, denominator);
}