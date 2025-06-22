import path from 'node:path'
import { fileURLToPath } from 'node:url';
import get_response from '../utils/get_response.js';

const agent = fileURLToPath(import.meta.url).split(path.dirname(fileURLToPath(import.meta.url))+'/').pop().split('.')[0];

const normalize_input = (input) => {
    const unitMap = {
        g: "gram", gram: "gram", grams: "gram",
        kg: "kilogram", kgs: "kilogram", kilograms: "kilogram",
        ml: "milliliter", milliliters: "milliliter",
        l: "liter", liters: "liter",
        lb: "pound", lbs: "pound", pounds: "pound",
        oz: "ounce", ounces: "ounce",
        "fl oz": "fluid ounce", "fluid ounces": "fluid ounce",
        tsp: "teaspoon", tsps: "teaspoon", teaspoons: "teaspoon",
        tbsp: "tablespoon", tbsps: "tablespoon", tablespoons: "tablespoon",
        cup: "cup", cups: "cup",
    };

    input = input.toLowerCase();

    const units = Object.keys(unitMap)
        .sort((a, b) => b.length - a.length)
        .map(u => u.replace(/ /g, "\\s+"))
        .join("|");

    const noOfRegex = new RegExp(
        `(\\d+(?:\\.\\d+)?)(?:\\s*)(${units})\\s+(?!of\\b)([a-z][a-z ]*?)(?=[,]|$)`,
        "gi"
    );
    input = input.replace(noOfRegex, (_, qty, rawUnit, item) => {
        const normUnit = unitMap[rawUnit.replace(/\s+/g, " ")] || rawUnit;
        const pluralUnit = parseFloat(qty) !== 1 ? normUnit + "s" : normUnit;
        return `${qty} ${pluralUnit} of ${item.trim()}`;
    });

    const withOfRegex = new RegExp(
        `(\\d+(?:\\.\\d+)?)(?:\\s*)(${units})(\\s+of\\s+[a-z][a-z ]*?)(?=[,]|$)`,
        "gi"
    );
    input = input.replace(withOfRegex, (_, qty, rawUnit, rest) => {
        const normUnit = unitMap[rawUnit.replace(/\s+/g, " ")] || rawUnit;
        const pluralUnit = parseFloat(qty) !== 1 ? normUnit + "s" : normUnit;
        return `${qty} ${pluralUnit}${rest}`;
    });

    input = input.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, (_, a, b) =>
        (parseFloat(a) / parseFloat(b)).toFixed(2)
    );
    input = input.replace(/\b(\d+)\s*(?:-|\sto\s)\s*(\d+)\b/g, (_, a) => a);

    return input.replace(/\s+/g, " ").trim();
}

const test_agent = async (input) => {

    const response = await get_response(agent, normalize_input(input))

    return response
    
}

export default test_agent