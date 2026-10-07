// LaTeX escape: escape characters that have special meaning in LaTeX.
export function escTex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/—/g, "---")
    .replace(/–/g, "--")
    .replace(/₹/g, "\\rupee{}")
    .replace(/“|”/g, '"')
    .replace(/‘|’/g, "'");
}
