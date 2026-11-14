/**
 * Categorical palette for multi-series charts, assigned in this fixed order (never cycled).
 * Validated with the dataviz palette checker on the dark surface #171a1e:
 * lightness band, chroma floor, CVD separation (worst adjacent ΔE 8.2) and contrast all pass.
 * More than 6 series → fold into "Other" or use small multiples.
 */
export const CATEGORICAL = ["#3f97cc", "#d3735c", "#2f9e8f", "#b08a2e", "#8a78e0", "#c2577f"];
